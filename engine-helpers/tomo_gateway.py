"""Starts the Hermes gateway (``python -m tui_gateway.entry``) for Tomo, run with the engine's Python in Hermes' root.

Windows has no process groups that end with their parent: when the gateway exits (normally, by crash, or because Tomo
was killed and stdin closed), the browser it opened and terminal commands it started kept running. So on Windows the
gateway first joins a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. Everything it starts later is in the same
job, and when the gateway process ends for any reason the system closes its job handle and ends them all. Hermes'
own shutdown (session flush, browser close) still runs first on a normal exit. macOS / Linux: plain start; Hermes
cleans up its children itself there.
"""

from __future__ import annotations

import os
import runpy
import sys

JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9


def kill_children_on_exit():
    """Windows: put this process in a kill-on-close job; returns the job handle (keep it open), or None."""
    import ctypes
    from ctypes import wintypes

    class IoCounters(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    k32.SetInformationJobObject.restype = wintypes.BOOL
    k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    k32.AssignProcessToJobObject.restype = wintypes.BOOL
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]

    job = k32.CreateJobObjectW(None, None)  # not inheritable: only this process holds the handle
    if not job:
        return None
    info = ExtendedLimits()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k32.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)):
        return None
    if not k32.AssignProcessToJobObject(job, k32.GetCurrentProcess()):
        return None
    return job


def main() -> None:
    if sys.platform == "win32":
        job = kill_children_on_exit()
        print(f"[tomo] child processes {'end with the engine' if job else 'could not be tied to the engine'}",
              file=sys.stderr, flush=True)
        globals()["_job"] = job  # held for the life of the process
    # like `python -m`: Hermes' root (the working directory) first on sys.path, and not this helper's folder
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:] = [os.getcwd()] + [p for p in sys.path if os.path.abspath(p or ".") != here]
    runpy.run_module("tui_gateway.entry", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
