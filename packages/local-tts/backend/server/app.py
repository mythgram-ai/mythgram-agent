"""FastAPI application assembly for the local Piper TTS studio backend."""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .logstore import configure_logging, store
from .piper import runtime
from .voices import registry

APP_VERSION = "1.0.0"

API_PREFIX = "/api"

V1_PREFIX = "/v1"


def _is_v1(request: Request) -> bool:
    return request.url.path.startswith(V1_PREFIX)


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
    store.emit("info", "openai.api", f"OpenAI-compatible surface ready at {V1_PREFIX} (base_url {V1_PREFIX})")
    yield
    store.emit("info", "backend", "PiperVoice backend stopped")


def _openai_body(
    status: int,
    message: str,
    *,
    err_type: str | None = None,
    param: str | None = None,
    code: str | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "message": message,
            "type": err_type or ("server_error" if status >= 500 else "invalid_request_error"),
            "param": param,
            "code": code,
        }
    }


def _validation_message(errors: list[Any]) -> str:
    first: dict[str, Any] = errors[0] if errors else {}  # type: ignore[assignment]
    loc = ".".join(str(part) for part in first.get("loc", []) if part not in ("body",))
    msg = str(first.get("msg") or "request body is invalid")
    # JSON decode errors carry numeric-only locs (e.g. 0) — they are not fields
    if not loc or loc.isdigit():
        return msg
    return f"invalid request field '{loc}': {msg}"


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
    from .api import router as admin_router
    from .openai_api import router as openai_router

    app.include_router(admin_router, prefix=API_PREFIX)
    app.include_router(openai_router)

    @app.exception_handler(RequestValidationError)
    async def validation_failed(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        sanitized = [
            {k: v for k, v in err.items() if k not in ("input", "url", "ctx", "loc")}
            for err in errors
        ]
        if _is_v1(request):
            param = ".".join(str(part) for part in (errors[0].get("loc", []) if errors else []) if part not in ("body",)) or None
            return JSONResponse(
                status_code=400,
                content=_openai_body(
                    400,
                    _validation_message(errors),
                    param=param,
                    code="invalid_request",
                ),
            )
        return JSONResponse(status_code=422, content={"detail": sanitized})

    @app.exception_handler(StarletteHTTPException)
    async def http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else None
        headers = getattr(exc, "headers", None)
        if _is_v1(request):
            if isinstance(exc.detail, dict) and "error" in exc.detail:
                content: Any = exc.detail
            else:
                content = _openai_body(
                    exc.status_code,
                    detail or "request failed",
                    code="request_error",
                )
        else:
            content = {"detail": exc.detail}
        return JSONResponse(status_code=exc.status_code, content=content, headers=headers)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        store.emit(
            "error",
            "backend",
            f"unhandled error on {request.method} {request.url.path}: "
            f"{type(exc).__name__}: {str(exc)[:400]}",
        )
        if _is_v1(request):
            return JSONResponse(
                status_code=500,
                content=_openai_body(
                    500,
                    "The server hit an unexpected error while processing the request.",
                    err_type="server_error",
                    code="internal_error",
                ),
            )
        return JSONResponse(
            status_code=500,
            content={"detail": {"code": "internal_error", "message": "internal server error"}},
        )

    return app


app = create_app()
