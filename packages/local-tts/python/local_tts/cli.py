"""`local-tts` command-line entry point.

Runs the Piper speech studio: FastAPI backend + bundled web UI, both served
from a single port (7878 by default). Nothing else is opened or proxied.
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_PORT = 7878
DEFAULT_HOST = "127.0.0.1"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="local-tts",
        description="Local Piper TTS studio: web UI + OpenAI-compatible speech API on one port.",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("LOCAL_TTS_HOST", DEFAULT_HOST),
        help=f"bind address (default: {DEFAULT_HOST}; use 0.0.0.0 for LAN access)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("LOCAL_TTS_PORT", str(DEFAULT_PORT))),
        help=f"port to serve on (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="print the package version and exit",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.version:
        from importlib.metadata import version

        dist = __package__.replace("_", "-")
        try:
            print(version(dist))
        except Exception:
            print(version("local-tts-studio"))
        return

    try:
        import uvicorn

        from .server.app import app
    except Exception as exc:  # pragma: no cover - defensive startup error path
        print(f"local-tts failed to start: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    scheme = "http"
    display_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "::") else args.host
    url = f"{scheme}://{display_host}:{args.port}/"
    print("")
    print("  Local TTS — Piper speech studio")
    print(f"  Web UI:      {url}")
    print(f"  REST API:    {scheme}://{display_host}:{args.port}/api/health")
    print(f"  OpenAI API:  {scheme}://{display_host}:{args.port}/v1")
    print("  Press Ctrl+C to stop.")
    print("")

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
