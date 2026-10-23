"""HTTP API surface: settings, piper install, voice catalog/downloads, TTS, logs, system."""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import sys
import threading
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .config import settings
from .logstore import store
from .piper import (
    InstallFailure,
    PiperNotInstalled,
    SynthesisControls,
    VoiceUnavailable,
    runtime,
)
from .system import snapshot
from .voices import CatalogError, registry

log = logging.getLogger("api")

router = APIRouter()

MAX_TEXT_CHARS = 8000


# --------------------------------------------------------------------- models


class TTSRequest(BaseModel):
    key: str = Field(min_length=1, max_length=200, description="voice key e.g. en_US-amy-medium")
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    volume: float = Field(default=1.0, ge=0.05, le=2.0)
    noise_scale: float | None = Field(default=None, ge=0.0, le=2.0)
    noise_w_scale: float | None = Field(default=None, ge=0.0, le=2.0)
    normalize: bool = True
    speaker_id: int | None = Field(default=None, ge=0)

    @field_validator("text")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class VoiceKeyRequest(BaseModel):
    key: str = Field(min_length=1, max_length=200)


class InstallRequest(BaseModel):
    extras: list[str] = Field(default_factory=list, description="e.g. ['onnxruntime-gpu']")

    @field_validator("extras")
    @classmethod
    def _known_extras(cls, value: list[str]) -> list[str]:
        allowed = {"onnxruntime-gpu"}
        for item in value:
            if item not in allowed:
                raise ValueError(f"unknown extra: {item}")
        return value


class SettingsRequest(BaseModel):
    voices_dir: str | None = None
    device: str | None = None


# --------------------------------------------------------------------- helpers


def _http_error(status: int, code: str, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": detail})


def _resolve_voice_or_404(key: str) -> dict[str, Any]:
    voice = registry.installed_lookup(key)
    if voice is None:
        raise _http_error(404, "voice_not_installed", f"voice {key} is not downloaded")
    return voice


# --------------------------------------------------------------------- app meta


@router.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "app": "piper-studio", "python": sys.version.split()[0]}


@router.get("/piper/status")
def piper_status() -> dict[str, Any]:
    return runtime.status()


@router.post("/piper/install")
def piper_install(req: InstallRequest) -> dict[str, Any]:
    try:
        result = runtime.install(extra_dists=req.extras)
    except InstallFailure as exc:
        raise _http_error(502, "install_failed", str(exc)) from exc
    return {**result, "status": runtime.status()}


# --------------------------------------------------------------------- settings


@router.get("/settings")
def read_settings() -> dict[str, Any]:
    return {"voices_dir": settings.voices_dir, "device": settings.device}


@router.post("/settings")
def write_settings(req: SettingsRequest) -> dict[str, Any]:
    if req.voices_dir is not None:
        try:
            settings.update(voices_dir=req.voices_dir)
        except ValueError as exc:
            raise _http_error(422, "bad_voices_dir", str(exc)) from exc
        registry.invalidate_installed()
        store.emit("info", "settings", f"voices directory set to {req.voices_dir}")
    if req.device is not None:
        try:
            settings.update(device=req.device)
        except ValueError as exc:
            raise _http_error(422, "bad_device", str(exc)) from exc
        runtime.clear_cache()
        store.emit("info", "settings", f"compute device set to {req.device}")
    return {"voices_dir": settings.voices_dir, "device": settings.device}


# --------------------------------------------------------------------- voices


@router.get("/voices/catalog")
def voices_catalog(force: bool = False) -> dict[str, Any]:
    """String catalog; force=1 bypasses the 12h cache and re-pulls from the repo."""
    try:
        if force:
            registry.ensure_catalog(force=True)
        return registry.payload()
    except CatalogError as exc:
        raise _http_error(503, "catalog_unavailable", str(exc)) from exc


@router.get("/voices/installed")
def voices_installed() -> dict[str, Any]:
    return {"voices": registry.installed(), "voices_dir": settings.voices_dir}


@router.get("/voices/downloads")
def voices_downloads() -> dict[str, Any]:
    return {"downloads": registry.specs()}


@router.post("/voices/install")
def voices_install(req: VoiceKeyRequest) -> dict[str, Any]:
    try:
        started, reason = registry.queue_download(req.key)
    except KeyError as exc:
        raise _http_error(404, "unknown_voice", f"voice {req.key} is not in the catalog") from exc
    except CatalogError as exc:
        raise _http_error(503, "catalog_unavailable", str(exc)) from exc
    if not started:
        raise _http_error(409, "already_queued" if "downloading" in (reason or "") else "already_installed", reason or "cannot queue download")
    return {"queued": True, "key": req.key}


@router.post("/voices/cancel")
def voices_cancel(req: VoiceKeyRequest) -> dict[str, Any]:
    if not registry.cancel_download(req.key):
        raise _http_error(409, "not_cancellable", f"no queued download found for {req.key}")
    return {"cancelled": True, "key": req.key}


@router.delete("/voices/{key}")
def voices_delete(key: str) -> dict[str, Any]:
    try:
        registry.delete_voice(key)
    except KeyError as exc:
        raise _http_error(404, "voice_not_installed", str(exc)) from exc
    except RuntimeError as exc:
        raise _http_error(409, "download_in_progress", str(exc)) from exc
    return {"deleted": True, "key": key}


# --------------------------------------------------------------------- tts


@router.post("/tts")
def synthesize_speech(req: TTSRequest) -> Response:
    _resolve_voice_or_404(req.key)
    controls = SynthesisControls(
        speed=req.speed,
        volume=req.volume,
        noise_scale=req.noise_scale,
        noise_w_scale=req.noise_w_scale,
        normalize=req.normalize,
    )
    try:
        result = runtime.synthesize_wav_bytes(req.key, req.text, controls, req.speaker_id)
    except ValueError as exc:
        raise _http_error(422, "bad_speaker", str(exc)) from exc
    except PiperNotInstalled as exc:
        raise _http_error(409, "piper_missing", str(exc)) from exc
    except VoiceUnavailable as exc:
        raise _http_error(404, "voice_unavailable", str(exc)) from exc
    safe_key = req.key.replace('"', "")
    return Response(
        content=result["wav_bytes"],
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'inline; filename="piper-{safe_key}.wav"',
            "X-Voice-Key": safe_key,
            "X-Sample-Rate": str(result["sample_rate"]),
            "X-Device": result["device"],
            "X-Duration-Ms": str(int(result["duration_seconds"] * 1000)),
            "X-Elapsed-Ms": str(result["elapsed_ms"]),
        },
    )


# --------------------------------------------------------------------- system


@router.get("/system")
def system_snapshot() -> dict[str, Any]:
    return snapshot()


# --------------------------------------------------------------------- logs


@router.get("/logs")
def read_logs(level: str | None = None, q: str | None = None, limit: int = 1000) -> dict[str, Any]:
    entries = store.history(level=level, contains=q, limit=max(0, min(limit, 2000)))
    return {"entries": entries, "latest_id": store.latest_id()}


@router.post("/logs/clear")
def clear_logs() -> dict[str, Any]:
    store.clear()
    store.emit("info", "logs.ui", "log history cleared from the web UI")
    return {"cleared": True}


@router.post("/logs/test")
def push_test_logs() -> dict[str, Any]:
    samples = [
        ("debug", "sample: a tiny hint that only shows when debug level is on"),
        ("info", "sample: this is a normal info message"),
        ("warning", "sample: something looks off but we keep going"),
        ("error", "sample: pretend an operation broke to see error styling"),
    ]
    for level, message in samples:
        store.emit(level, "logs.test", message)
    return {"written": [lvl for lvl, _ in samples]}


@router.get("/logs/stream")
async def stream_logs(request: Request) -> StreamingResponse:
    sub = store.subscribe()
    try:
        marker = sub.get_nowait()
    except queue.Empty:
        marker = {"id": store.latest_id()}
    since_id = marker.get("id", 0) if isinstance(marker, dict) else 0

    loop = asyncio.get_running_loop()
    live: asyncio.Queue = asyncio.Queue()
    ping: dict[str, Any] = {"__ping__": True}
    keep_pumping = threading.Event()
    keep_pumping.set()

    def pump() -> None:
        while keep_pumping.is_set():
            try:
                entry = sub.get(timeout=0.5)
            except queue.Empty:
                loop.call_soon_threadsafe(live.put_nowait, ping)
                continue
            if not isinstance(entry, dict) or entry.get("id", 0) <= since_id:
                continue
            loop.call_soon_threadsafe(live.put_nowait, entry)

    threading.Thread(target=pump, daemon=True, name="log-sse-pump").start()

    def sse_line(entry: dict[str, Any]) -> str:
        return f"data: {json.dumps(entry, separators=(',', ':'))}\n\n"

    async def generator() -> AsyncIterator[str]:
        try:
            for entry in store.history(limit=500):
                if entry["id"] > since_id:
                    yield sse_line(entry)
            yield f"data: {json.dumps({'__snapshot__': True, 'id': since_id})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                entry = await live.get()
                if entry is ping:
                    yield ": ping\n\n"
                else:
                    yield sse_line(entry)
        finally:
            keep_pumping.clear()
            store.unsubscribe(sub)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
