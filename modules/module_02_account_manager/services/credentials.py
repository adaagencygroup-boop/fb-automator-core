from ..security.encryption import decrypt_data

def decrypt(value, hwid=None):
    return decrypt_data(value)
