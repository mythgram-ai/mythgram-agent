"""Hardware/system introspection for the monitoring panel."""

from __future__ import annotations

import os
import platform
import sys
import time
from pathlib import Path

import psutil

from .config import settings


def _cpu_name() -> str:
    name = platform.processor() or ""
    if not name and Path("/proc/cpuinfo").exists():
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.lower().startswith(("model name", "hardware")) and ":" in line:
                name = line.split(":", 1)[1].strip()
                break
    return name or "unknown CPU"


def _loadavg() -> list[float]:
    try:
        la1, la5, la15 = os.getloadavg()
    except OSError:
        return [0.0, 0.0, 0.0]
    core_count = max(psutil.cpu_count(logical=True) or 1, 1)
    return [round(x / core_count, 2) for x in (la1, la5, la15)]


def _cpu_freq_mhz() -> float | None:
    try:
        freq = psutil.cpu_freq()
    except Exception:
        return None
    if freq and freq.current:
        return round(freq.current)
    return None


def snapshot() -> dict:
    """Return a JSON-serializable snapshot of system stats."""
    cpu_percent = psutil.cpu_percent(interval=0.2) or 0.0
    per_cpu = psutil.cpu_percent(interval=None, percpu=True)

    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    voices_path = settings.voices_path()
    stats_target = voices_path if voices_path.exists() else Path.home()
    disk = psutil.disk_usage(str(stats_target))

    return {
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "python_home": sys.executable,
        },
        "cpu": {
            "model": _cpu_name(),
            "cores_physical": psutil.cpu_count(logical=False) or 0,
            "cores_logical": psutil.cpu_count(logical=True) or 0,
            "percent_total": cpu_percent,
            "percent_per_core": per_cpu,
            "load_avg_relative": _loadavg(),
            "freq_mhz": _cpu_freq_mhz(),
        },
        "memory": {
            "total_bytes": mem.total,
            "used_bytes": mem.used,
            "available_bytes": mem.available,
            "percent": mem.percent,
            "swap_total_bytes": swap.total,
            "swap_used_bytes": swap.used,
            "swap_percent": swap.percent,
        },
        "disk": {
            "path": str(stats_target),
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "percent": disk.percent,
        },
        "uptime_seconds": round(time.time() - psutil.boot_time(), 1),
    }
