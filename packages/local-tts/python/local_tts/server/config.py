"""Paths, persisted settings and startup defaults for the backend."""

from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

def _default_data_dir() -> Path:
    """Writable per-user location (site-packages may be read-only)."""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "local-tts"
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        return (Path(base) if base else home / "AppData" / "Local") / "local-tts"
    xdg = os.environ.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg else home / ".local" / "share") / "local-tts"


DATA_DIR = Path(os.environ.get("LOCAL_TTS_DATA_DIR") or _default_data_dir())

DEFAULT_VOICES_DIR = DATA_DIR / "voices"

SETTINGS_FILE = DATA_DIR / "settings.json"

CATALOG_DIR = DATA_DIR / "catalog"

VALID_DEVICES = ("auto", "cpu", "cuda")

API_SPEED_RANGE = (0.25, 4.0)
API_VOLUME_RANGE = (0.05, 2.0)
API_NOISE_RANGE = (0.0, 2.0)
API_KEY_MAX_CHARS = 200

_voice_dir_lock = threading.Lock()


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


class Settings:
    """Server-side settings, persisted to data/settings.json."""

    def __init__(self) -> None:
        self._write_lock = threading.Lock()
        self.voices_dir: str = ""
        self.device: str = "auto"
        # ── OpenAI-compatible API (/v1) ──────────────────────────────
        self.api_key_enabled: bool = False
        self.api_key: str = ""  # plain text on purpose (local app, no secrets vault)
        self.api_default_voice: str = ""
        self.api_speaker_id: int | None = None
        self.api_speed: float = 1.0
        self.api_volume: float = 1.0
        self.api_noise_scale: float | None = None
        self.api_noise_w_scale: float | None = None
        self.api_normalize: bool = True
        self._load()

    def _load(self) -> None:
        raw: dict = {}
        try:
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            pass
        except Exception as exc:  # corrupted settings file should not kill the app
            print(f"[settings] could not read {SETTINGS_FILE}: {exc}")

        with _voice_dir_lock:
            configured_dir = str(raw.get("voices_dir", "")).strip()
            self.voices_dir = configured_dir or str(DEFAULT_VOICES_DIR)
            device = str(raw.get("device", "auto")).strip().lower()
            self.device = device if device in VALID_DEVICES else "auto"
            # a malformed settings file must not take the app down: coerce or skip
            self.api_key_enabled = bool(raw.get("api_key_enabled", False))
            self.api_key = str(raw.get("api_key", "")).strip()[:API_KEY_MAX_CHARS]
            self.api_default_voice = str(raw.get("api_default_voice", "")).strip()[:API_KEY_MAX_CHARS]
            raw_speaker = raw.get("api_speaker_id")
            try:
                self.api_speaker_id = int(raw_speaker) if raw_speaker is not None else None
                if self.api_speaker_id is not None and self.api_speaker_id < 0:
                    self.api_speaker_id = None
            except (TypeError, ValueError):
                self.api_speaker_id = None
            try:
                self.api_speed = _clamp(float(raw.get("api_speed", 1.0)), *API_SPEED_RANGE)
            except (TypeError, ValueError):
                self.api_speed = 1.0
            try:
                self.api_volume = _clamp(float(raw.get("api_volume", 1.0)), *API_VOLUME_RANGE)
            except (TypeError, ValueError):
                self.api_volume = 1.0
            for name, attr, rng in (
                ("api_noise_scale", "api_noise_scale", API_NOISE_RANGE),
                ("api_noise_w_scale", "api_noise_w_scale", API_NOISE_RANGE),
            ):
                try:
                    value = raw.get(name)
                    setattr(self, attr, _clamp(float(value), *rng) if value is not None else None)
                except (TypeError, ValueError):
                    setattr(self, attr, None)
            self.api_normalize = bool(raw.get("api_normalize", True))

    def save(self) -> None:
        payload = {
            "voices_dir": self.voices_dir,
            "device": self.device,
            "api_key_enabled": self.api_key_enabled,
            "api_key": self.api_key,
            "api_default_voice": self.api_default_voice,
            "api_speaker_id": self.api_speaker_id,
            "api_speed": self.api_speed,
            "api_volume": self.api_volume,
            "api_noise_scale": self.api_noise_scale,
            "api_noise_w_scale": self.api_noise_w_scale,
            "api_normalize": self.api_normalize,
        }
        with self._write_lock:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = SETTINGS_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            tmp.replace(SETTINGS_FILE)

    def update(
        self,
        *,
        voices_dir: str | None = None,
        device: str | None = None,
        api_key_enabled: bool | None = None,
        api_key: str | None = None,
        api_default_voice: str | None = None,
        api_speaker_id: int | None = None,
        api_speed: float | None = None,
        api_volume: float | None = None,
        api_noise_scale: float | None = None,
        api_noise_w_scale: float | None = None,
        api_normalize: bool | None = None,
    ) -> None:
        """Merge a partial settings patch; None leaves a field untouched."""
        with _voice_dir_lock:
            if voices_dir is not None:
                candidate = str(voices_dir).strip()
                if not candidate:
                    raise ValueError("voices_dir cannot be empty")
                self.voices_dir = candidate
            if device is not None:
                device = str(device).strip().lower()
                if device not in VALID_DEVICES:
                    raise ValueError("device must be one of: auto, cpu, cuda")
                self.device = device
            # ── openai-compatible api ────────────────────────────────────
            if api_key_enabled is not None:
                self.api_key_enabled = bool(api_key_enabled)
            if api_key is not None:
                candidate = str(api_key).strip()
                if len(candidate) > API_KEY_MAX_CHARS:
                    raise ValueError(f"api_key must be at most {API_KEY_MAX_CHARS} characters")
                self.api_key = candidate
            if api_default_voice is not None:
                candidate = str(api_default_voice).strip()
                if len(candidate) > API_KEY_MAX_CHARS:
                    raise ValueError(f"api_default_voice must be at most {API_KEY_MAX_CHARS} characters")
                self.api_default_voice = candidate
            if api_speaker_id is not None:
                if isinstance(api_speaker_id, bool) or not isinstance(api_speaker_id, int):
                    raise ValueError("api_speaker_id must be an integer")
                if api_speaker_id < 0:
                    raise ValueError("api_speaker_id must not be negative")
                self.api_speaker_id = api_speaker_id
            if api_speed is not None:
                try:
                    api_speed = float(api_speed)
                except (TypeError, ValueError) as exc:
                    raise ValueError("api_speed must be a number") from exc
                if not API_SPEED_RANGE[0] <= api_speed <= API_SPEED_RANGE[1]:
                    raise ValueError(f"api_speed must be within {API_SPEED_RANGE[0]:g}–{API_SPEED_RANGE[1]:g}")
                self.api_speed = api_speed
            if api_volume is not None:
                try:
                    api_volume = float(api_volume)
                except (TypeError, ValueError) as exc:
                    raise ValueError("api_volume must be a number") from exc
                if not API_VOLUME_RANGE[0] <= api_volume <= API_VOLUME_RANGE[1]:
                    raise ValueError(f"api_volume must be within {API_VOLUME_RANGE[0]:g}–{API_VOLUME_RANGE[1]:g}")
                self.api_volume = api_volume
            for attr_name, value in (
                ("api_noise_scale", api_noise_scale),
                ("api_noise_w_scale", api_noise_w_scale),
            ):
                if value is None:
                    setattr(self, attr_name, None)
                    continue
                try:
                    value = float(value)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{attr_name} must be a number") from exc
                if not API_NOISE_RANGE[0] <= value <= API_NOISE_RANGE[1]:
                    raise ValueError(f"{attr_name} must be within {API_NOISE_RANGE[0]:g}–{API_NOISE_RANGE[1]:g}")
                setattr(self, attr_name, value)
            if api_normalize is not None:
                self.api_normalize = bool(api_normalize)
        self.save()

    def voices_path(self) -> Path:
        return Path(self.voices_dir).expanduser()


settings = Settings()
