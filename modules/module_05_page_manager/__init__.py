"""
Module 5: Quản lý Fanpage & Auto Post (Page Manager)
Backend logic — UI nằm ở frontend/src/modules/module_05_page_manager
"""
from modules.module_05_page_manager.worker import AutoPostWorker
from modules.module_05_page_manager.facebook_client import (
    post_to_facebook_page,
    upload_reel_to_facebook,
    upload_video_to_facebook,
)
from modules.module_05_page_manager.ai_generator import AIGenerator
from modules.module_05_page_manager.image_downloader import get_image_from_internet
from modules.module_05_page_manager.sheet_logger import save_posted_to_google_sheet
from modules.module_05_page_manager.tiktok_downloader import TikTokBulkDownloader
from modules.module_05_page_manager.youtube_downloader import YouTubeBulkDownloader

__all__ = [
    "AutoPostWorker",
    "post_to_facebook_page",
    "upload_reel_to_facebook",
    "upload_video_to_facebook",
    "AIGenerator",
    "get_image_from_internet",
    "save_posted_to_google_sheet",
    "TikTokBulkDownloader",
    "YouTubeBulkDownloader",
]
