"""Voice catalog (remote) + download manager + local (installed) voice registry."""

from __future__ import annotations

import glob
import hashlib
import json
import os
import queue
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

from .config import CATALOG_DIR, settings
from .logstore import store

HF_REPO = "rhasspy/piper-voices"
MODEL_BASE_URL = f"https://huggingface.co/{HF_REPO}/resolve/main"
CATALOG_URL = f"{MODEL_BASE_URL}/voices.json"

CATALOG_TTL_HOURS = 12
CHUNK_SIZE = 1 << 20

QUALITY_ORDER = {"x_low": 0, "low": 1, "medium": 2, "high": 3}


class CatalogError(RuntimeError):
    """No cached catalog and no way to reach the remote repository."""


class CancelledError(RuntimeError):
    pass


class DownloadSpec:
    """Mutable state for a single background voice download."""

    def __init__(self, key: str, entry: dict[str, Any]) -> None:
        self.key = key
        self.entry = entry
        self.state: str = "queued"
        self.error: str | None = None
        self.received: int = 0
        self.total: int = 0
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self.cancel_token = threading.Event()

    def snapshot(self) -> dict[str, Any]:
        progress: float | None = None
        if self.total:
            progress = min(1.0, self.received / self.total)
        return {
            "key": self.key,
            "state": self.state,
            "received_bytes": self.received,
            "total_bytes": self.total,
            "progress": progress,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class VoiceRegistry:
    """Catalog cache, sequential download queue and installed-voice index."""

    def __init__(self) -> None:
        self._catalog: dict[str, dict[str, Any]] | None = None
        self._catalog_loaded_at = 0.0
        self._catalog_lock = threading.Lock()
        self._downloads: dict[str, DownloadSpec] = {}
        self._installed_cache: list[dict[str, Any]] | None = None
        self._gap_lock = threading.Lock()
        self._queue: queue.Queue[DownloadSpec] = queue.Queue()
        self._worker: threading.Thread | None = None
        self._active = threading.Lock()

    # ------------------------------------------------------------------ catalog

    def ensure_catalog(self, force: bool = False) -> None:
        with self._catalog_lock:
            now = time.time()
            if (
                not force
                and self._catalog
                and now - self._catalog_loaded_at < CATALOG_TTL_HOURS * 3600
            ):
                return
            cache_path = CATALOG_DIR / "voices.json"
            stale: dict[str, Any] | None = None
            try:
                parsed = json.loads(cache_path.read_text(encoding="utf-8"))
                if isinstance(parsed, dict) and parsed:
                    stale = parsed
            except Exception:
                stale = None

            fresh = self._fetch_catalog()
            if fresh:
                CATALOG_DIR.mkdir(parents=True, exist_ok=True)
                tmp = cache_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(fresh), encoding="utf-8")
                os.replace(tmp, cache_path)
                self._catalog = fresh
                self._catalog_loaded_at = now
                store.emit("info", "voices.catalog", f"voice catalog updated ({len(fresh)} voices)")
                return
            if stale:
                store.emit(
                    "warning",
                    "voices.catalog",
                    f"remote catalog unavailable, using cached copy ({len(stale)} voices)",
                )
                self._catalog = stale
                self._catalog_loaded_at = now
                return
            raise CatalogError("voice catalog unavailable and no cached copy found")

    def _fetch_catalog(self, attempts: int = 3) -> dict[str, Any] | None:
        for attempt in range(1, attempts + 1):
            try:
                req = urllib.request.Request(
                    CATALOG_URL, headers={"User-Agent": "piper-studio-backend/1.0"}
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, dict) and data:
                    return data
                return None
            except Exception as exc:
                store.emit(
                    "debug",
                    "voices.catalog",
                    f"fetch attempt {attempt} failed: {type(exc).__name__}: {exc}",
                )
                time.sleep(0.8 * attempt)
        return None

    def payload(self) -> dict[str, Any]:
        try:
            self.ensure_catalog()
        except CatalogError as exc:
            return {"voices": [], "error": str(exc), "fresh": False}
        assert self._catalog is not None
        voices = [self._voice_record(key, entry) for key, entry in self._catalog.items()]
        voices.sort(key=lambda v: QUALITY_ORDER.get(v["quality"], 1))
        voices.sort(key=lambda v: v["key"])
        installed = {v["key"] for v in self.installed()}
        for v in voices:
            v["installed"] = v["key"] in installed
        return {"voices": voices, "error": None, "fresh": True}

    def _voice_record(self, key: str, entry: dict[str, Any]) -> dict[str, Any]:
        language = entry.get("language") or {}
        files: dict[str, Any] = entry.get("files") or {}
        total_bytes = sum(
            meta.get("size_bytes", 0)
            for name, meta in files.items()
            if name.endswith(".onnx") or name.endswith(".onnx.json")
        )
        return {
            "key": key,
            "name": entry.get("name", key),
            "language": language.get("code", ""),
            "language_english": language.get("name_english", ""),
            "country_english": language.get("country_english", ""),
            "language_native": language.get("name_native", ""),
            "quality": entry.get("quality", "medium"),
            "num_speakers": entry.get("num_speakers", 1),
            "size_bytes": total_bytes,
        }

    def get_entry(self, key: str) -> dict[str, Any]:
        self.ensure_catalog()
        assert self._catalog is not None
        if key not in self._catalog:
            raise KeyError(f"unknown voice key: {key}")
        return self._catalog[key]

    # ------------------------------------------------------------------ installed

    def invalidate_installed(self) -> None:
        with self._gap_lock:
            self._installed_cache = None

    def installed(self) -> list[dict[str, Any]]:
        with self._gap_lock:
            cached = self._installed_cache
        if cached is not None:
            return cached
        voices: list[dict[str, Any]] = []
        base = settings.voices_path()
        if base.exists():
            for onnx_path in sorted(base.glob("*.onnx")):
                key = onnx_path.stem
                stat = onnx_path.stat()
                meta: dict[str, Any] = {}
                json_path = base / f"{key}.onnx.json"
                if json_path.exists():
                    try:
                        meta = json.loads(json_path.read_text(encoding="utf-8"))
                    except Exception as exc:
                        store.emit(
                            "warning",
                            "voices.registry",
                            f"voice metadata unreadable for {key}: {exc}",
                        )
                language = meta.get("language", {}) if meta else {}
                voices.append(
                    {
                        "key": key,
                        "file": str(onnx_path),
                        "size_bytes": stat.st_size,
                        "mtime": stat.st_mtime,
                        "name": meta.get("name", key),
                        "language": language.get("code") or (key.split("-")[0] if "-" in key else key),
                        "language_english": language.get("name_english", ""),
                        "country_english": language.get("country_english", ""),
                        "quality": meta.get("quality", ""),
                        "num_speakers": meta.get("num_speakers", 1),
                        "speaker_id_map": meta.get("speaker_id_map", {}),
                        "sample_rate": (meta.get("audio") or {}).get("sample_rate"),
                    }
                )
        voices.sort(key=lambda v: QUALITY_ORDER.get(v["quality"], 1))
        voices.sort(key=lambda v: v["key"])
        with self._gap_lock:
            self._installed_cache = voices
        return voices

    def installed_lookup(self, key: str) -> dict[str, Any] | None:
        for voice in self.installed():
            if voice["key"] == key:
                return voice
        return None

    # ------------------------------------------------------------------ downloads

    def queue_download(self, key: str) -> tuple[bool, str | None]:
        active = self.get_spec(key)
        if active and active.state in ("queued", "downloading"):
            return False, "already downloading"
        if self.installed_lookup(key) is not None:
            return False, "already installed"
        entry = self.get_entry(key)
        base = settings.voices_path()
        base.mkdir(parents=True, exist_ok=True)
        spec = DownloadSpec(key, entry)
        files = entry.get("files") or {}
        expected_bytes = sum(
            meta.get("size_bytes", 0)
            for name, meta in files.items()
            if name.endswith(".onnx")
        )
        spec.total = expected_bytes
        with self._gap_lock:
            cutoff = time.time() - 3600
            stale = [
                k
                for k, d in self._downloads.items()
                if d.state in ("done", "failed", "cancelled")
                and d.finished_at is not None
                and d.finished_at < cutoff
            ]
            for k in stale:
                self._downloads.pop(k, None)
            self._downloads[key] = spec
        self._ensure_worker()
        self._queue.put(spec)
        store.emit(
            "info",
            "voices.download",
            f"queued {key} (~{expected_bytes // (1024 * 1024)} MB from the voice repository)",
        )
        return True, None

    def specs(self) -> dict[str, dict[str, Any]]:
        with self._gap_lock:
            return {k: v.snapshot() for k, v in self._downloads.items()}

    def get_spec(self, key: str) -> DownloadSpec | None:
        with self._gap_lock:
            return self._downloads.get(key)

    def cancel_download(self, key: str) -> bool:
        spec = self.get_spec(key)
        if not spec or spec.state not in ("queued", "downloading"):
            return False
        spec.cancel_token.set()
        store.emit("info", "voices.download", f"cancel requested for {key}")
        return True

    def _ensure_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._worker = threading.Thread(target=self._worker_loop, name="voice-downloader", daemon=True)
        self._worker.start()

    def _worker_loop(self) -> None:
        while True:
            spec = self._queue.get()
            self._run_download(spec)

    def _run_download(self, spec: DownloadSpec) -> None:
        spec.state = "downloading"
        spec.started_at = time.time()
        spec.received = 0
        store.emit("info", "voices.download", f"downloading {spec.key}")
        json_files = [
            (f, m) for f, m in (spec.entry.get("files") or {}).items() if f.endswith(".onnx.json")
        ]
        onnx_files = [
            (f, m) for f, m in (spec.entry.get("files") or {}).items() if f.endswith(".onnx")
        ]
        try:
            if not onnx_files:
                raise RuntimeError("catalog entry lists no .onnx file")
            for rel_path, meta in json_files:
                self._download_file(spec, rel_path, meta)
            for rel_path, meta in onnx_files:
                self._download_file(spec, rel_path, meta)
            if spec.cancel_token.is_set():
                raise CancelledError()
            self.invalidate_installed()
            spec.state = "done"
            spec.finished_at = time.time()
            seconds = max(0.001, spec.finished_at - (spec.started_at or spec.finished_at))
            store.emit(
                "info",
                "voices.download",
                f"voice {spec.key} ready ({spec.received // 1024 // 1024} MB in {seconds:.1f}s)",
            )
        except CancelledError:
            spec.state = "cancelled"
            spec.finished_at = time.time()
            store.emit("info", "voices.download", f"download of {spec.key} cancelled")
        except Exception as exc:
            spec.state = "failed"
            spec.error = f"{type(exc).__name__}: {exc}"
            spec.finished_at = time.time()
            store.emit("error", "voices.download", f"download of {spec.key} failed: {spec.error}")
        finally:
            self._cleanup_partials(spec.key)

    def _download_file(self, spec: DownloadSpec, rel_path: str, meta: dict[str, Any]) -> None:
        url = f"{MODEL_BASE_URL}/{rel_path}"
        dest = settings.voices_path() / Path(rel_path).name
        partial_path = dest.with_suffix(dest.suffix + ".part")
        md5 = hashlib.md5()
        request = urllib.request.Request(url, headers={"User-Agent": "piper-studio-backend/1.0"})
        per_file_start = spec.received
        try:
            with urllib.request.urlopen(request, timeout=60) as resp, open(partial_path, "wb") as fh:
                spec.total = int(resp.headers.get("Content-Length") or 0) or meta.get("size_bytes", 0)
                while True:
                    if spec.cancel_token.is_set():
                        raise CancelledError()
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    fh.write(chunk)
                    md5.update(chunk)
                    spec.received += len(chunk)
            expected_md5 = meta.get("md5_digest")
            if expected_md5 and md5.hexdigest() != expected_md5:
                raise RuntimeError(f"md5 checksum mismatch for {dest.name}")
            os.replace(partial_path, dest)
            store.emit(
                "debug",
                "voices.download",
                f"fetched {dest.name} ({(spec.received - per_file_start) // 1024} KiB, md5 verified)",
            )
        except CancelledError:
            partial_path.unlink(missing_ok=True)
            raise
        except Exception:
            partial_path.unlink(missing_ok=True)
            raise

    def _cleanup_partials(self, key: str) -> None:
        base = settings.voices_path()
        for pattern in (f"{key}*.part",):
            for path in glob.glob(str(base / pattern)):
                try:
                    os.unlink(path)
                except OSError:
                    pass

    def cleanup_orphan_partials(self) -> None:
        base = settings.voices_path()
        if not base.exists():
            return
        for path in base.glob("*.part"):
            try:
                os.unlink(path)
                store.emit("debug", "voices.registry", f"removed stale partial {path.name}")
            except OSError:
                pass

    def delete_voice(self, key: str) -> None:
        spec = self.get_spec(key)
        if spec and spec.state in ("queued", "downloading"):
            raise RuntimeError("cannot delete a voice while it is being downloaded")
        base = settings.voices_path()
        removed = 0
        for suffix in (".onnx", ".onnx.json"):
            path = base / f"{key}{suffix}"
            if path.exists():
                path.unlink()
                removed += 1
        self.invalidate_installed()
        if not removed:
            raise KeyError(f"voice {key} is not installed")
        store.emit("info", "voices.registry", f"removed voice {key}")


registry = VoiceRegistry()
