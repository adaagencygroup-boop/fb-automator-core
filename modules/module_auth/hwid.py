"""Thu thập HWID máy local: UUID mainboard + CPU, băm SHA-256. Giống hwid_collector.py nguồn."""
import hashlib
import logging
import os
import platform
import subprocess

logger = logging.getLogger(__name__)


def _run_cmd(cmd: str) -> str:
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=8)
        return result.stdout.strip()
    except Exception as exc:
        logger.warning("Command failed: %s", exc)
        return ""


def get_mainboard_uuid() -> str:
    output = _run_cmd("wmic csproduct get uuid")
    for line in output.splitlines():
        line = line.strip()
        if line and line.lower() not in ("uuid", "csproduct", "none", "unknown", ""):
            return line
    ps_out = _run_cmd('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"')
    if ps_out and "error" not in ps_out.lower() and len(ps_out) > 5:
        return ps_out.strip()
    reg_out = _run_cmd(
        "powershell -NoProfile -Command \"(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid\""
    )
    if reg_out and len(reg_out) > 5:
        return reg_out.strip()
    return "DEFAULT_UUID"


def get_cpu_serial() -> str:
    output = _run_cmd("wmic cpu get processorid")
    for line in output.splitlines():
        line = line.strip()
        if line and line.lower() not in ("processorid", "cpu", "none", "unknown", ""):
            return line
    ps_out = _run_cmd('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).ProcessorId"')
    if ps_out and "error" not in ps_out.lower() and len(ps_out) > 3:
        return ps_out.strip()
    env_proc = os.environ.get("PROCESSOR_IDENTIFIER") or platform.processor()
    if env_proc:
        return env_proc.strip()
    return "DEFAULT_CPU"


def get_hwid() -> str:
    raw = f"{get_mainboard_uuid()}::{get_cpu_serial()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
