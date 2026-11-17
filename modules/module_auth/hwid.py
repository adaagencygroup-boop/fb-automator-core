"""Thu thập HWID máy local: UUID mainboard + CPU, băm SHA-256. Giống hwid_collector.py nguồn."""
import hashlib
import logging
import os
import platform
import subprocess
import sys

logger = logging.getLogger(__name__)

_HWID_CACHE = None


def _run_cmd(cmd: str, timeout: float = 5) -> str:
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return (result.stdout or "").strip()
    except Exception as exc:
        logger.warning("Command failed: %s", exc)
        return ""


def _cim_uuid_and_cpu() -> tuple[str, str]:
    """Một lần PowerShell lấy UUID + ProcessorId (máy này không có wmic)."""
    if sys.platform != "win32":
        return "", ""
    ps = (
        "$u=(Get-CimInstance Win32_ComputerSystemProduct).UUID; "
        "$c=(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId; "
        "Write-Output ($u + '|' + $c)"
    )
    out = _run_cmd(f'powershell -NoProfile -Command "{ps}"', timeout=6)
    if "|" not in out:
        return "", ""
    uuid, _, cpu = out.partition("|")
    uuid, cpu = uuid.strip(), cpu.strip()
    if uuid.lower() in ("", "none", "unknown") or cpu.lower() in ("", "none", "unknown"):
        return "", ""
    return uuid, cpu


def get_mainboard_uuid() -> str:
    uuid, _ = _cim_uuid_and_cpu()
    if uuid:
        return uuid
    output = _run_cmd("wmic csproduct get uuid", timeout=3)
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
    _, cpu = _cim_uuid_and_cpu()
    if cpu:
        return cpu
    output = _run_cmd("wmic cpu get processorid", timeout=3)
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
    """SHA-256(uuid::cpu), cache theo process."""
    global _HWID_CACHE
    if _HWID_CACHE:
        return _HWID_CACHE
    uuid, cpu = _cim_uuid_and_cpu()
    if not uuid:
        uuid = get_mainboard_uuid()
    if not cpu:
        cpu = get_cpu_serial()
    _HWID_CACHE = hashlib.sha256(f"{uuid}::{cpu}".encode("utf-8")).hexdigest()
    return _HWID_CACHE
