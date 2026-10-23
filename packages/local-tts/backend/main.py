"""Entrypoint: python main.py [--host 0.0.0.0] [--port 7878]"""

from __future__ import annotations

import argparse

import uvicorn

from server.app import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Piper TTS backend")
    parser.add_argument("--host", default="0.0.0.0", help="bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=7878, help="port (default: 7878)")
    args = parser.parse_args()

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_config=None,
        access_log=True,
    )


if __name__ == "__main__":
    main()
