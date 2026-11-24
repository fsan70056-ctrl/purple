"""Real resource measurement (no estimates): process CPU, working set, system free memory."""
from __future__ import annotations

import os
import threading
import time


def process_rss_mb() -> float:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        c = Counters()
        c.cb = ctypes.sizeof(c)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(c), c.cb)
        return c.WorkingSetSize / 1048576
    with open("/proc/self/statm") as f:
        return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 1048576


def system_available_mb() -> float:
    if os.name == "nt":
        import ctypes

        class Status(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        s = Status()
        s.dwLength = ctypes.sizeof(s)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))
        return s.ullAvailPhys / 1048576
    with open("/proc/meminfo") as f:
        for line in f:
            if line.startswith("MemAvailable"):
                return int(line.split()[1]) / 1024
    return 0.0


class ResourceSampler(threading.Thread):
    """Samples this process every `interval` s while a job runs."""

    def __init__(self, interval: float = 0.5) -> None:
        super().__init__(daemon=True)
        self.interval = interval
        self._halt = threading.Event()
        self.rows: list[tuple[float, float, float, float]] = []  # t, cores_used, rss_mb, avail_mb
        self.cores = os.cpu_count() or 1

    def run(self) -> None:
        t0 = time.perf_counter()
        last_wall, last_cpu = t0, time.process_time()
        while not self._halt.wait(self.interval):
            now, cpu = time.perf_counter(), time.process_time()
            used = (cpu - last_cpu) / max(1e-6, now - last_wall)
            last_wall, last_cpu = now, cpu
            self.rows.append((now - t0, used, process_rss_mb(), system_available_mb()))

    def finish(self) -> dict:
        self._halt.set()
        self.join(timeout=2)
        if not self.rows:
            return {}
        cores_used = [r[1] for r in self.rows]
        return {
            "samples": len(self.rows),
            "logical_cores": self.cores,
            "cpu_avg_percent_of_machine": round(100 * sum(cores_used) / len(cores_used) / self.cores, 1),
            "cpu_peak_percent_of_machine": round(100 * max(cores_used) / self.cores, 1),
            "cpu_avg_cores_busy": round(sum(cores_used) / len(cores_used), 2),
            "python_working_set_peak_mb": round(max(r[2] for r in self.rows)),
            "system_available_min_mb": round(min(r[3] for r in self.rows)),
            "system_available_start_mb": round(self.rows[0][3]),
        }
