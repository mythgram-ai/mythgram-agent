"""local-tts: local Piper speech studio — web UI + REST + OpenAI-compatible API."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

for _dist in ("local-tts-studio", "local-tts"):
    try:
        __version__ = version(_dist)
        break
    except PackageNotFoundError:
        __version__ = "0.0.0"

__all__ = ["__version__"]
