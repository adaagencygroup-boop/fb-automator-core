import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent

# Check root .env
root_env = BASE_DIR.parent.parent / ".env"
if root_env.exists():
    load_dotenv(root_env)

class Settings:
    FACEBOOK_API_VERSION: str = os.getenv("FACEBOOK_GRAPH_API_VERSION", os.getenv("FACEBOOK_API_VERSION", "v19.0"))
    FACEBOOK_BASE_URL: str = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}"
    FACEBOOK_WEBHOOK_VERIFY_TOKEN: str = os.getenv("FACEBOOK_WEBHOOK_VERIFY_TOKEN", "omnichannel_verify_token_2026")
    FACEBOOK_APP_ID: str = os.getenv("FACEBOOK_APP_ID", "")
    FACEBOOK_APP_SECRET: str = os.getenv("FACEBOOK_APP_SECRET", "")
    NGROK_AUTHTOKEN: str = os.getenv("NGROK_AUTHTOKEN", "")

settings = Settings()
