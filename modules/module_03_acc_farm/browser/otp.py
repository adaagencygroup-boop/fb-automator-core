"""
otp_generator.py
Sinh mã TOTP 6 số từ Base32 secret key (2FA Facebook).
"""
import pyotp
import logging

logger = logging.getLogger(__name__)


def generate_totp(secret_key: str) -> str:
    """
    Sinh mã TOTP 6 số từ secret key 2FA.
    Args:
        secret_key: Chuỗi Base32 (16-32 ký tự), có thể chứa khoảng trắng.
    Returns:
        Chuỗi 6 chữ số hiện tại.
    """
    # Loại bỏ khoảng trắng và chuyển thành chữ hoa
    clean_key = secret_key.replace(" ", "").upper()
    totp = pyotp.TOTP(clean_key)
    # Không log mã OTP / secret
    return totp.now()


def verify_totp(secret_key: str, code: str) -> bool:
    """Xác thực mã TOTP (cho phép sai lệch ±30 giây)."""
    clean_key = secret_key.replace(" ", "").upper()
    totp = pyotp.TOTP(clean_key)
    return totp.verify(code, valid_window=1)
