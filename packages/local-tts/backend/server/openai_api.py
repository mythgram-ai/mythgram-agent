"""OpenAI-compatible speech API mounted under /v1 for external clients.

Endpoints:
    GET  /v1/models          — list the logical model ids this server accepts
    POST /v1/audio/speech    — synthesize speech, OpenAI Audio Speech compatible

Server-side configuration policy (see the web UI's API docs page):
clients never need to send model/voice/prosody settings. The server owner
configures default voice and parameters on the API page; `model`, `voice`,
`speed` and related OpenAI request fields are accepted for compatibility but
ignored on purpose. Only `input` and `response_format` change behaviour.

No rate limiting is applied anywhere on this surface.
"""

from __future__ import annotations

import io
import logging
import secrets
import shutil
import subprocess
import time
import wave
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from .config import settings
from .logstore import store
from .piper import PiperNotInstalled, SynthesisControls, VoiceUnavailable, runtime

log = logging.getLogger("openai.api")

router = APIRouter()

STARTED_AT = int(time.time())
OPENAI_OWNED_BY = "piper-studio-local"
MAX_API_TEXT_CHARS = 8000

NATIVE_FORMATS: tuple[str, ...] = ("wav", "pcm")
# compressed formats require the ffmpeg binary on the host
TRANSCODE_FORMATS: tuple[str, ...] = ("mp3", "flac", "aac", "opus")
ALL_FORMATS: tuple[str, ...] = NATIVE_FORMATS + TRANSCODE_FORMATS
DEFAULT_FORMAT = "wav"

MODEL_IDS = ("tts-1", "tts-1-hd")

AUTH_HEADER = "Authorization"
AUTH_SCHEME = "bearer"  # case-insentitive; OpenAI SDKs send "Bearer <key>"
ALT_KEY_HEADER = "x-api-key"

TRANSCODE_PROFILES: dict[str, tuple[list[str], str, str]] = {
    # format -> (ffmpeg output args, file extension, media type)
    "mp3": (["-f", "mp3", "-c:a", "libmp3lame", "-b:a", "128k"], "mp3", "audio/mpeg"),
    "flac": (["-f", "flac"], "flac", "audio/flac"),
    "aac": (["-f", "adts", "-c:a", "aac", "-b:a", "128k"], "aac", "audio/aac"),
    "opus": (["-f", "ogg", "-c:a", "libopus", "-b:a", "96k"], "ogg", "audio/ogg"),
}

_ffmpeg_state: dict[str, bool | None] = {"available": None}


# --------------------------------------------------------------------- errors


def _openai_error(
    status: int,
    code: str,
    message: str,
    *,
    err_type: str = "invalid_request_error",
    param: str | None = None,
) -> HTTPException:
    """HTTPException carrying an OpenAI-shaped error body.

    The app-level handler in app.py detects the {"error": {...}} detail and
    passes it through untouched so /v1 responses always follow this shape.
    """
    return HTTPException(
        status_code=status,
        detail={
            "error": {
                "message": message,
                "type": err_type,
                "param": param,
                "code": code,
            }
        },
    )


# ----------------------------------------------------------------------- auth


def _bearer_token(request: Request) -> str:
    """Extract the shared key from 'Authorization: Bearer <key>' or 'X-Api-Key'."""
    header = (request.headers.get(AUTH_HEADER) or "").strip()
    if header:
        scheme, _, credential = header.partition(" ")
        if scheme.lower() == AUTH_SCHEME and credential.strip():
            return credential.strip()
    return (request.headers.get(ALT_KEY_HEADER) or "").strip()


def require_api_key(request: Request) -> None:
    """Enforce the optional shared-key auth configured on the API page.

    Fails closed: if the requirement is on but the server has no key stored,
    every request is denied until the owner sets one.
    """
    if not settings.api_key_enabled:
        return
    expected = settings.api_key
    if not expected:
        store.emit("error", "openai.api", "api key requirement is on but no key is stored — denying request (set a key on the API page)")
        raise _openai_error(
            500,
            "auth_not_configured",
            "API key requirement is enabled but no API key is configured on the server. "
            "Open the API page in the web UI and set or generate a key.",
            err_type="server_error",
        )
    provided = _bearer_token(request)
    if not provided:
        raise _openai_error(
            401,
            "missing_api_key",
            "You didn't provide an API key. Include it as 'Authorization: Bearer <key>' "
            "(or 'X-Api-Key: <key>'). You can view or generate the key on the API page "
            "in the web UI.",
        )
    if not secrets.compare_digest(provided, expected):
        raise _openai_error(401, "invalid_api_key", "Incorrect API key provided.")


def _client_addr(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ----------------------------------------------------------------- request io


class SpeechRequest(BaseModel):
    """OpenAI Audio Speech payload.

    Only `input` and `response_format` are honoured. `model`, `voice` and
    `speed` exist purely so standard SDK clients keep working; the actual
    voice, its prosody and the compute device are configured server-side.
    """

    model: str | None = Field(default=None, max_length=100)
    input: str = Field(min_length=1, max_length=MAX_API_TEXT_CHARS)
    voice: str | None = Field(default=None, max_length=200)
    response_format: str | None = Field(default=None, max_length=20)
    speed: float | None = Field(default=None, ge=0.0, le=10.0)

    @field_validator("input")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("input must not be blank")
        return value

    @field_validator("response_format")
    @classmethod
    def _format(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if value not in ALL_FORMATS:
            raise ValueError(f"response_format must be one of: {', '.join(ALL_FORMATS)}")
        return value

    @field_validator("model", "voice")
    @classmethod
    def _trim_optional(cls, value: str | None) -> str | None:
        value = value.strip() if value else value
        return value or None


# -------------------------------------------------------------------- models


def models_payload() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": STARTED_AT,
                "owned_by": OPENAI_OWNED_BY,
            }
            for model_id in MODEL_IDS
        ],
    }


@router.get("/v1/models")
def list_models(request: Request) -> dict[str, Any]:
    require_api_key(request)
    return models_payload()


@router.get("/v1/models/{model_id}")
def read_model(model_id: str, request: Request) -> dict[str, Any]:
    require_api_key(request)
    if model_id.lower() not in MODEL_IDS:
        raise _openai_error(404, "model_not_found", f"The model '{model_id}' does not exist on this server.")
    return {
        "id": model_id.lower(),
        "object": "model",
        "created": STARTED_AT,
        "owned_by": OPENAI_OWNED_BY,
    }


# --------------------------------------------------------------------- speech


def ffmpeg_available() -> bool:
    if _ffmpeg_state["available"] is None:
        _ffmpeg_state["available"] = shutil.which("ffmpeg") is not None
        if not _ffmpeg_state["available"]:
            store.emit(
                "warning",
                "openai.api",
                "ffmpeg not found — compressed response formats (mp3/flac/aac/opus) "
                "will be rejected; install ffmpeg or use response_format=wav/pcm",
            )
    return bool(_ffmpeg_state["available"])


def _pcm_from_wav(wav_bytes: bytes) -> bytes:
    """Strip the RIFF/WAVE container; returns raw little-endian frames."""
    try:
        probe = wave.open(io.BytesIO(wav_bytes), "rb")
        try:
            return probe.readframes(probe.getnframes())
        finally:
            probe.close()
    except wave.Error as exc:
        raise _openai_error(500, "pcm_extract_failed", f"could not decode WAV payload: {exc}", err_type="server_error")


def _transcode_with_ffmpeg(wav_bytes: bytes, fmt: str) -> tuple[bytes, str, str]:
    args, ext, mime = TRANSCODE_PROFILES[fmt]
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        "pipe:0",
        *args,
        "pipe:1",
    ]
    try:
        result = subprocess.run(
            cmd,
            input=wav_bytes,
            capture_output=True,
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise _openai_error(500, "transcode_failed", f"ffmpeg timed out converting to {fmt.upper()}", err_type="server_error") from exc
    if result.returncode != 0 or not result.stdout:
        err = (result.stderr or "").decode(errors="replace").strip()[-400:]
        raise _openai_error(
            500,
            "transcode_failed",
            f"ffmpeg failed converting to {fmt.upper()}: {err or 'no error output'}",
            err_type="server_error",
        )
    return result.stdout, ext, mime


def _render_format(wav_bytes: bytes, fmt: str) -> tuple[bytes, str, str]:
    """Return (payload_bytes, file_extension, media_type) for the request."""
    if fmt == "wav":
        return wav_bytes, "wav", "audio/wav"
    if fmt == "pcm":
        return _pcm_from_wav(wav_bytes), "pcm", "audio/pcm_s16le"  # documented: raw 16-bit LE samples
    if not ffmpeg_available():
        raise _openai_error(
            400,
            "unsupported_response_format",
            f"response_format '{fmt}' needs the ffmpeg binary on the server host, which "
            f"was not found. Use 'wav' (default) or 'pcm', or install ffmpeg.",
        )
    return _transcode_with_ffmpeg(wav_bytes, fmt)


def _resolve_speech_voice() -> str:
    key = settings.api_default_voice
    if not key:
        raise _openai_error(
            503,
            "no_default_voice",
            "No default voice is configured for the API. Open the API page in the web "
            "UI and pick a downloaded voice under 'Default voice for API clients'.",
            err_type="server_error",
        )
    return key


@router.post("/v1/audio/speech")
def create_speech(req: SpeechRequest, request: Request) -> Response:
    started = time.perf_counter()
    require_api_key(request)
    fmt = req.response_format or DEFAULT_FORMAT
    voice_key = _resolve_speech_voice()

    controls = SynthesisControls(
        speed=settings.api_speed,
        volume=settings.api_volume,
        noise_scale=settings.api_noise_scale,
        noise_w_scale=settings.api_noise_w_scale,
        normalize=settings.api_normalize,
    )
    synth_started = time.perf_counter()
    try:
        result = runtime.synthesize_wav_bytes(voice_key, req.input, controls, settings.api_speaker_id)
    except ValueError as exc:
        raise _openai_error(
            400,
            "speaker_config_invalid",
            f"The configured default voice has multiple speakers and its configured "
            f"speaker is invalid: {exc}. Fix it on the API page in the web UI.",
        ) from exc
    except PiperNotInstalled as exc:
        raise _openai_error(
            503,
            "engine_not_installed",
            "The Piper TTS engine is not installed on the server yet. Open the Voices & "
            "setup page in the web UI and install piper-tts.",
        ) from exc
    except VoiceUnavailable as exc:
        raise _openai_error(
            503,
            "voice_not_ready",
            f"The configured default voice '{voice_key}' is not available: {exc}. Pick a "
            f"downloaded voice on the API page in the web UI.",
        ) from exc

    synth_ms = int((time.perf_counter() - synth_started) * 1000)
    payload, ext, media = _render_format(result["wav_bytes"], fmt)
    safe_key = voice_key.replace('"', "")
    store.emit(
        "info",
        "openai.api",
        f"speech reply {_client_addr(request)} · voice={voice_key} · format={fmt} · "
        f"{len(payload) // 1024} KiB · synth {synth_ms} ms · total "
        f"{int((time.perf_counter() - started) * 1000)} ms",
    )
    return Response(
        content=payload,
        media_type=media,
        headers={
            "Content-Disposition": f'inline; filename="piper-{safe_key}.{ext}"',
            "X-Voice-Key": safe_key,
            "X-Sample-Rate": str(result["sample_rate"]),
            "X-Channels": str(result["channels"]),
            "X-Sample-Width": str(result["sample_width"]),
            "X-Duration-Ms": str(int(result["duration_seconds"] * 1000)),
            "X-Elapsed-Ms": str(result["elapsed_ms"]),
            "X-Device": result["device"],
            "X-Audio-Format": fmt,
        },
    )
