"""AES-256-CBC credential encryption compatible with the source project."""
import os
import base64
import hashlib
import sys
import subprocess
import logging
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from .hwid_collector import get_hwid as _source_get_hwid

_LEGACY_HWID_CACHE = None

logger = logging.getLogger(__name__)

def get_legacy_hwid() -> str:
    """
    Thu thập thông tin phần cứng duy nhất của máy tính (Mainboard UUID + CPU ID).
    Tạo chuỗi băm SHA-256 (64 hex characters) làm hardware fingerprint.
    """
    global _LEGACY_HWID_CACHE
    if _LEGACY_HWID_CACHE:
        return _LEGACY_HWID_CACHE

    raw_ids = []

    if sys.platform == "win32":
        try:
            # Lấy UUID bo mạch chủ (BaseBoard / Motherboard)
            cmd_uuid = "powershell -Command \"(Get-CimInstance Win32_ComputerSystemProduct).UUID\""
            res_uuid = subprocess.run(cmd_uuid, shell=True, capture_output=True, text=True, timeout=5)
            uuid_str = res_uuid.stdout.strip()
            if uuid_str:
                raw_ids.append(uuid_str)
        except Exception as e:
            logger.debug(f"Không thể đọc Win32_ComputerSystemProduct.UUID: {e}")

        try:
            # Lấy Processor ID của CPU
            cmd_cpu = "powershell -Command \"(Get-CimInstance Win32_Processor).ProcessorId\""
            res_cpu = subprocess.run(cmd_cpu, shell=True, capture_output=True, text=True, timeout=5)
            cpu_str = res_cpu.stdout.strip()
            if cpu_str:
                raw_ids.append(cpu_str)
        except Exception as e:
            logger.debug(f"Không thể đọc Win32_Processor.ProcessorId: {e}")

    # Fallback an toàn nếu không đọc được HWID hoặc môi trường khác
    if not raw_ids:
        raw_ids.append(os.environ.get("COMPUTERNAME", "DEFAULT_FALLBACK_HWID_NODE"))

    combined = "##".join(raw_ids).encode("utf-8")
    _LEGACY_HWID_CACHE = hashlib.sha256(combined).hexdigest()
    return _LEGACY_HWID_CACHE



_SOURCE_LEGACY_HWID_CACHE = None

def get_hwid():
    """Return the source-project HWID, cached for this process."""
    global _SOURCE_LEGACY_HWID_CACHE
    if _SOURCE_LEGACY_HWID_CACHE is None:
        _SOURCE_LEGACY_HWID_CACHE = _source_get_hwid()
    return _SOURCE_LEGACY_HWID_CACHE

def _derive_key(hwid):
    return hashlib.sha256(hwid.encode("utf-8")).digest()

def _crypt(plaintext, hwid):
    iv = os.urandom(16)
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plaintext.encode("utf-8")) + padder.finalize()
    encryptor = Cipher(algorithms.AES(_derive_key(hwid)), modes.CBC(iv)).encryptor()
    return base64.b64encode(iv + encryptor.update(padded) + encryptor.finalize()).decode("ascii")

def _decrypt(cipher_text, hwid):
    raw = base64.b64decode(cipher_text.encode("ascii"), validate=True)
    if len(raw) <= 16 or (len(raw) - 16) % 16:
        raise ValueError("Invalid encrypted credential")
    decryptor = Cipher(algorithms.AES(_derive_key(hwid)), modes.CBC(raw[:16])).decryptor()
    padded = decryptor.update(raw[16:]) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    return (unpadder.update(padded) + unpadder.finalize()).decode("utf-8")

def encrypt_data(plain_text):
    if not plain_text:
        return ""
    return _crypt(plain_text, get_hwid())

def decrypt_data(cipher_text):
    if not cipher_text:
        return ""
    try:
        return _decrypt(cipher_text, get_hwid())
    except Exception as exc:
        raise ValueError("Unable to decrypt saved credential") from exc

def decrypt_legacy_data(cipher_text):
    if not cipher_text:
        return ""
    try:
        return _decrypt(cipher_text, get_legacy_hwid())
    except Exception as exc:
        raise ValueError("Unable to decrypt legacy Module 2 credential") from exc
