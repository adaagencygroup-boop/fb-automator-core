"""
hwid_collector.py
Thu thập Mainboard UUID và CPU Serial Number, tạo HWID bằng SHA-256.
Hoạt động trên Windows qua lệnh wmic kèm fallback PowerShell và Registry.
"""
import subprocess
import hashlib
import logging
import os
import platform

logger = logging.getLogger(__name__)


def _run_cmd(cmd: str) -> str:
    """Chạy lệnh shell và trả về output sạch."""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=8
        )
        return result.stdout.strip()
    except Exception as e:
        logger.warning(f"Command '{cmd}' failed: {e}")
        return ""


def get_mainboard_uuid() -> str:
    """Lấy UUID của mainboard."""
    # 1. Thử wmic
    output = _run_cmd("wmic csproduct get uuid")
    for line in output.splitlines():
        line = line.strip()
        if line and line.lower() not in ("uuid", "csproduct", "none", "unknown", ""):
            return line

    # 2. Fallback qua PowerShell Get-CimInstance
    ps_out = _run_cmd('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"')
    if ps_out and "error" not in ps_out.lower() and len(ps_out) > 5:
        return ps_out.strip()

    # 3. Fallback qua Windows MachineGuid từ Registry
    reg_out = _run_cmd('powershell -NoProfile -Command "(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid"')
    if reg_out and len(reg_out) > 5:
        return reg_out.strip()

    return "DEFAULT_UUID"


def get_cpu_serial() -> str:
    """Lấy ProcessorId của CPU."""
    # 1. Thử wmic
    output = _run_cmd("wmic cpu get processorid")
    for line in output.splitlines():
        line = line.strip()
        if line and line.lower() not in ("processorid", "cpu", "none", "unknown", ""):
            return line

    # 2. Fallback qua PowerShell Get-CimInstance
    ps_out = _run_cmd('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).ProcessorId"')
    if ps_out and "error" not in ps_out.lower() and len(ps_out) > 3:
        return ps_out.strip()

    # 3. Fallback qua biến môi trường PROCESSOR_IDENTIFIER
    env_proc = os.environ.get("PROCESSOR_IDENTIFIER") or platform.processor()
    if env_proc:
        return env_proc.strip()

    return "DEFAULT_CPU"


def get_hwid() -> str:
    """
    Tạo HWID bằng cách kết hợp UUID mainboard + CPU ID rồi băm SHA-256.
    Trả về chuỗi hex 64 ký tự.
    """
    uuid = get_mainboard_uuid()
    cpu_id = get_cpu_serial()
    raw = f"{uuid}::{cpu_id}"
    hwid = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return hwid


if __name__ == "__main__":
    print(f"Mainboard UUID : {get_mainboard_uuid()}")
    print(f"CPU Serial     : {get_cpu_serial()}")
    print(f"HWID (SHA-256) : {get_hwid()}")

