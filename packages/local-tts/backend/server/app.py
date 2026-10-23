"""FastAPI application assembly for the local Piper TTS studio backend."""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .logstore import configure_logging, store
from .piper import runtime
from .voices import registry

APP_VERSION = "1.0.0"

API_PREFIX = "/api"


@asynccontextmanager
async def lifespan(app: FastAPI):
    base = settings.voices_path()
    base.mkdir(parents=True, exist_ok=True)
    registry.cleanup_orphan_partials()
    store.emit(
        "info",
        "backend",
        f"PiperVoice backend starting (backend={APP_VERSION}, "
        f"python={sys.version.split()[0]}, voices_dir={base})",
    )
    ort = runtime.ort_summary()
    if ort["installed"]:
        store.emit(
            "debug",
            "backend",
            f"onnxruntime providers: {', '.join(ort['providers'])}",
        )
    yield
    store.emit("info", "backend", "PiperVoice backend stopped")


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="Local Piper SpeechService",
        version=APP_VERSION,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    from .api import router

    app.include_router(router, prefix=API_PREFIX)
    return app


app = create_app()
