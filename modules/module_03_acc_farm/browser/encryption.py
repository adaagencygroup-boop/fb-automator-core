"""
encryption.py
Mã hóa / Giải mã AES-256-CBC.
Secret key được dẫn xuất từ HWID của máy, đảm bảo dữ liệu chỉ
đọc được trên đúng thiết bị đã import.
"""
import hashlib
import base64
import os
import logging
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

logger = logging.getLogger(__name__)

# Kích thước block AES
BLOCK_SIZE = 16


def _derive_key(hwid: str) -> bytes:
    """
    Dẫn xuất AES key 32 bytes (256-bit) từ chuỗi HWID bằng SHA-256.
    """
    return hashlib.sha256(hwid.encode("utf-8")).digest()


def encrypt(plaintext: str, hwid: str) -> str:
    """
    Mã hóa chuỗi văn bản bằng AES-256-CBC.
    Args:
        plaintext: Văn bản cần mã hóa.
        hwid: HWID của máy làm key nguồn.
    Returns:
        Chuỗi Base64 gồm IV (16 bytes) + ciphertext.
    """
    key = _derive_key(hwid)
    iv = os.urandom(BLOCK_SIZE)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    encrypted = cipher.encrypt(pad(plaintext.encode("utf-8"), BLOCK_SIZE))
    result = base64.b64encode(iv + encrypted).decode("utf-8")
    return result


def decrypt(ciphertext_b64: str, hwid: str) -> str:
    """
    Giải mã chuỗi AES-256-CBC.
    Args:
        ciphertext_b64: Chuỗi Base64 đầu ra của hàm encrypt().
        hwid: HWID của máy.
    Returns:
        Văn bản gốc.
    Raises:
        ValueError: Nếu sai key hoặc dữ liệu bị hỏng.
    """
    try:
        key = _derive_key(hwid)
        raw = base64.b64decode(ciphertext_b64)
        iv = raw[:BLOCK_SIZE]
        encrypted = raw[BLOCK_SIZE:]
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = unpad(cipher.decrypt(encrypted), BLOCK_SIZE)
        return decrypted.decode("utf-8")
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise ValueError("Decryption failed — HWID mismatch or corrupted data")
