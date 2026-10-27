"""In-memory log store: ring buffer + live subscribers, used by the Logs page."""

from __future__ import annotations

import itertools
import logging
import queue
import threading
import time
from collections import deque

LEVELS = ("debug", "info", "warning", "error")


class LogStore:
    """Thread-safe ring buffer of log entries with push subscribers."""

    def __init__(self, maxlen: int = 2000) -> None:
        self._buf: deque[dict] = deque(maxlen=maxlen)
        self._subs: set[queue.Queue] = set()
        self._lock = threading.Lock()
        self._seq = itertools.count(1)

    def emit(self, level: str, source: str, message: str) -> None:
        level = level.lower()
        if level not in LEVELS:
            level = "info"
        entry = {
            "id": next(self._seq),
            "ts": round(time.time(), 3),
            "level": level,
            "source": source,
            "message": message,
        }
        with self._lock:
            self._buf.append(entry)
            snapshot = tuple(self._subs)
        for sub in snapshot:
            try:
                sub.put_nowait(entry)
            except queue.Full:
                pass

    def history(
        self,
        *,
        level: str | None = None,
        contains: str | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        with self._lock:
            entries = list(self._buf)
        level = level.lower() if level else None
        if level and level in LEVELS:
            rank = LEVELS.index(level)
            entries = [e for e in entries if LEVELS.index(e["level"]) >= rank]
        if contains:
            needle = contains.lower()
            entries = [
                e
                for e in entries
                if needle in e["message"].lower() or needle in e["source"].lower()
            ]
        if limit is not None and limit >= 0:
            entries = entries[-limit:]
        return entries

    def latest_id(self) -> int:
        with self._lock:
            return self._buf[-1]["id"] if self._buf else 0

    def clear(self) -> None:
        with self._lock:
            self._buf.clear()

    def subscribe(self) -> queue.Queue:
        sub: queue.Queue = queue.Queue(maxsize=500)
        sub.put_nowait({"id": self.latest_id()})
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: queue.Queue) -> None:
        with self._lock:
            self._subs.discard(sub)


class StoreHandler(logging.Handler):
    """Bridges stdlib logging records into the log store for the UI."""

    SKIP_SOURCES = {"uvicorn.access", "httpx", "httpcore"}

    def __init__(self, store: LogStore) -> None:
        super().__init__()
        self.store = store

    def emit(self, record: logging.LogRecord) -> None:
        if record.name in self.SKIP_SOURCES:
            return
        try:
            message = record.getMessage()
        except Exception:
            message = record.msg
        level = record.levelname.lower()
        self.store.emit(level, record.name, message)


store = LogStore()


def configure_logging() -> None:
    """Route backend + uvicorn logs through the shared store and stderr."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        console = logging.StreamHandler()
        console.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
        root.addHandler(console)

    # Don't stream uvicorn's per-request access lines into the UI, they flood it.
    store_handler = StoreHandler(store)
    store_handler.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(store_handler)

    for name in ("uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True

    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)

    root.info("Logging ready: ring buffer size %d", store._buf.maxlen)
