from config.constants import DATA_DIR

UPLOAD_MEDIA_DIR = (DATA_DIR / "module_07_group_spam" / "uploads").resolve()
MEDIA_CACHE_DIR = (DATA_DIR / "module_07_group_spam" / "cache").resolve()
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".avi", ".mkv"}
ALLOWED_MIME_PREFIXES = ("image/", "video/")
MAX_FILE_COUNT = 20
MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_TOTAL_SIZE = 100 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
