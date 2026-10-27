"""Piper TTS runtime: lazy detection, on-demand install, voice loading, synthesis.

The piper-tts wheel is deliberately *not* bundled up front: the UI exposes an
install button that runs pip inside the backend environment, and modules are
imported lazily afterwards.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import io
import json
import shlex
import subprocess
import sys
import threading
import time
import wave
from collections import OrderedDict
from typing import Any, Sequence

from .config import settings
from .logstore import store

PIPER_DIST = "piper-tts"


class PiperNotInstalled(RuntimeError):
    """Synthesis attempted before the piper-tts wheel is available."""


class VoiceUnavailable(RuntimeError):
    """A voice model files are missing or its metadata is corrupt."""


class InstallFailure(RuntimeError):
    pass


class SynthesisControls:
    """Rendering parameters that map 1:1 onto piper.SynthesisConfig."""

    def __init__(
        self,
        speed: float = 1.0,
        volume: float = 1.0,
        noise_scale: float | None = None,
        noise_w_scale: float | None = None,
        normalize: bool = True,
    ) -> None:
        self.speed = speed
        self.volume = volume
        self.noise_scale = noise_scale
        self.noise_w_scale = noise_w_scale
        self.normalize = normalize


class PiperRuntime:
    """Resolves piper lazily, caches loaded voices and synthesizes WAV files."""

    def __init__(self) -> None:
        self._cache: OrderedDict[tuple[str, str], tuple[Any, int]] = OrderedDict()
        self._cache_limit = 2
        self._load_lock = threading.Lock()
        self._install_lock = threading.Lock()
        self._piper_version: str | None = None
        self._ort_summary: dict[str, Any] | None = None

    # ------------------------------------------------------------- detection

    def ensure_piper_module(self, refresh: bool = False) -> Any:
        """Import and return the piper module; raise PiperNotInstalled if absent."""
        if refresh:
            importlib.invalidate_caches()
        try:
            import piper
        except ModuleNotFoundError as exc:
            raise PiperNotInstalled("piper-tts package is not installed yet") from exc
        if self._piper_version is None or refresh:
            try:
                self._piper_version = importlib.metadata.version(PIPER_DIST)
            except importlib.metadata.PackageNotFoundError:
                self._piper_version = None
        return piper

    def is_installed(self) -> bool:
        try:
            self.ensure_piper_module()
        except PiperNotInstalled:
            return False
        return True

    def ort_summary(self, refresh: bool = False) -> dict[str, Any]:
        """onnxruntime presence + provider list (CUDA capability detection)."""
        if self._ort_summary is not None and not refresh:
            return self._ort_summary
        summary: dict[str, Any] = {"installed": False, "providers": [], "cuda_ok": False}
        try:
            import onnxruntime as ort  # type: ignore[import-not-found]

            providers = list(ort.get_available_providers())
        except ModuleNotFoundError:
            providers = []
        except Exception as exc:
            providers = []
            store.emit("debug", "piper.ort", f"onnxruntime probe failed: {exc}")
        summary["installed"] = bool(providers)
        summary["providers"] = providers
        summary["cuda_ok"] = any("cuda" in p.lower() for p in providers)
        self._ort_summary = summary
        return summary

    def status(self) -> dict[str, Any]:
        installed = self.is_installed()
        ort = self.ort_summary()
        return {
            "installed": installed,
            "version": self._piper_version if installed else None,
            "ort": ort,
            "device": {
                "setting": settings.device,
                "resolved": self.resolve_device(None),
                "choices": ["auto", "cpu", "cuda"],
            },
        }

    # ------------------------------------------------------------- install

    def install(self, extra_dists: Sequence[str] = ()) -> dict[str, Any]:
        """Blocking pip install of piper-tts (+ optional extra wheels)."""
        if not self._install_lock.acquire(blocking=False):
            raise InstallFailure("another installation is already running")
        try:
            targets = [PIPER_DIST, *extra_dists]
            full_cmd = [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--quiet",
                *targets,
            ]
            store.emit("info", "piper.install", f"running: {shlex.join(full_cmd)}")
            result = subprocess.run(
                full_cmd,
                capture_output=True,
                text=True,
                timeout=1200,
                check=False,
            )
            for line in (result.stdout or "").splitlines():
                if line.strip():
                    store.emit("info", "piper.install", f"pip: {line.strip()}")
            err = (result.stderr or "").strip()
            if result.returncode != 0:
                for line in err.splitlines():
                    if line.strip():
                        store.emit("debug", "piper.install", f"pip stderr: {line.strip()}")
                raise InstallFailure(
                    f"pip exited {result.returncode}: {err[-800:] or 'no stderr output'}"
                )
            self.ensure_piper_module(refresh=True)
            self.ort_summary(refresh=True)
            store.emit("info", "piper.install", f"installed {targets} ({self._piper_version})")
            return {"ok": True, "version": self._piper_version}
        finally:
            self._install_lock.release()

    # ------------------------------------------------------------- device

    def resolve_device(self, requested: str | None) -> str:
        """auto -> cuda when the runtime exposes providers, else cpu."""
        choice = (requested or settings.device or "auto").lower()
        ort = self.ort_summary()
        if choice == "cuda":
            return "cuda" if (ort["installed"] and ort["cuda_ok"]) else "cpu"
        if choice == "cpu":
            return "cpu"
        if not ort["installed"]:
            return "cpu"
        return "cuda" if ort["cuda_ok"] else "cpu"

    def clear_cache(self) -> None:
        with self._load_lock:
            self._cache.clear()
        store.emit("debug", "piper.engine", "voice cache cleared")

    # ------------------------------------------------------------- voices

    def _voice_for(self, key: str) -> tuple[Any, int]:
        """Return (PiperVoice, num_speakers); cache is (key, resolved_device) based."""
        resolved = self.resolve_device(None)
        with self._load_lock:
            cached = self._cache.get((key, resolved))
            if cached is not None:
                self._cache.move_to_end((key, resolved))
                return cached

        base = settings.voices_path()
        model_path = base / f"{key}.onnx"
        config_path = base / f"{key}.onnx.json"
        if not model_path.exists() or not config_path.exists():
            raise VoiceUnavailable(f"model files for {key} are missing under {base}")
        try:
            metadata = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise VoiceUnavailable(f"bad voice metadata for {key}: {exc}") from exc
        num_speakers = int(metadata.get("num_speakers", 1) or 1)

        piper = self.ensure_piper_module()
        voice_obj = piper.PiperVoice.load(
            str(model_path.resolve()),
            config_path=str(config_path.resolve()),
            use_cuda=resolved == "cuda",
        )
        with self._load_lock:
            self._cache[(key, resolved)] = (voice_obj, num_speakers)
            self._cache.move_to_end((key, resolved))
            while len(self._cache) > self._cache_limit:
                evicted_key, _ = self._cache.popitem(last=False)
                store.emit("debug", "piper.engine", f"evicted voice {evicted_key[0]} from cache")
        store.emit(
            "info",
            "piper.engine",
            f"loaded voice {key} on {resolved}"
            + (
                f", sample_rate={(metadata.get('audio') or {}).get('sample_rate')} Hz"
                if metadata.get("audio") or {}
                else ""
            ),
        )
        return voice_obj, num_speakers

    def synthesize_wav_bytes(
        self,
        key: str,
        text: str,
        controls: SynthesisControls,
        speaker_id: int | None = None,
    ) -> dict[str, Any]:
        """Render text into a complete .wav kept in memory, returning info dict."""
        piper = self.ensure_piper_module()
        voice_obj, num_speakers = self._voice_for(key)
        effective_speaker = None
        if num_speakers > 1:
            if speaker_id is None:
                speaker_id = 0
            if not isinstance(speaker_id, int) or not 0 <= speaker_id < num_speakers:
                raise ValueError(f"speaker_id must be an integer in [0, {num_speakers - 1}]")
            effective_speaker = speaker_id

        cfg = piper.SynthesisConfig(
            speaker_id=effective_speaker,
            length_scale=(1.0 / controls.speed) if controls.speed > 0 else None,
            noise_scale=controls.noise_scale,
            noise_w_scale=controls.noise_w_scale,
            normalize_audio=controls.normalize,
            volume=controls.volume,
        )
        started = time.perf_counter()
        sink = io.BytesIO()
        with wave.open(sink, "wb") as wav_file:
            voice_obj.synthesize_wav(text, wav_file, syn_config=cfg)
        elapsed_ms = int((time.perf_counter() - started) * 1000)

        data = sink.getvalue()
        probe = wave.open(io.BytesIO(data), "rb")
        sample_rate = probe.getframerate()
        sample_width = probe.getsampwidth()
        channels = probe.getnchannels()
        frames = probe.getnframes()
        probe.close()
        duration = frames / float(sample_rate) if sample_rate else 0.0

        store.emit(
            "info",
            "piper.engine",
            f"synthesized {key} ({sample_rate} Hz, {channels}ch, {duration:.2f}s, "
            f"{len(data) // 1024} KiB, {elapsed_ms} ms)",
        )
        return {
            "wav_bytes": data,
            "sample_rate": sample_rate,
            "sample_width": sample_width,
            "channels": channels,
            "frames": frames,
            "duration_seconds": round(duration, 3),
            "elapsed_ms": elapsed_ms,
            "device": self.resolve_device(None),
        }


runtime = PiperRuntime()
