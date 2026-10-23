"""Paths, persisted settings and startup defaults for the backend."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.environ.get("LOCAL_TTS_DATA_DIR", BACKEND_DIR / "data"))

DEFAULT_VOICES_DIR = DATA_DIR / "voices"

SETTINGS_FILE = DATA_DIR / "settings.json"

CATALOG_DIR = DATA_DIR / "catalog"

VALID_DEVICES = ("auto", "cpu", "cuda")

_voice_dir_lock = threading.Lock()


class Settings:
    """Server-side settings, persisted to data/settings.json."""

    def __init__(self) -> None:
        self._write_lock = threading.Lock()
        self.voices_dir: str = ""
        self.device: str = "auto"
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

    def save(self) -> None:
        payload = {"voices_dir": self.voices_dir, "device": self.device}
        with self._write_lock:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = SETTINGS_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            tmp.replace(SETTINGS_FILE)

    def update(self, voices_dir: str | None = None, device: str | None = None) -> None:
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
        self.save()

    def voices_path(self) -> Path:
        return Path(self.voices_dir).expanduser()


settings = Settings()
