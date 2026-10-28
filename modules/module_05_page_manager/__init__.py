"""Module 05 — Page Manager.

Tránh import nặng (AutoPostWorker/PyQt5) ở cấp package để Local Engine sidecar
có thể import meta_config / routes mà không cần PyQt5.
"""

def __getattr__(name):
    if name == "AutoPostWorker":
        from modules.module_05_page_manager.worker import AutoPostWorker
        return AutoPostWorker
    if name == "post_to_facebook_page":
        from modules.module_05_page_manager.facebook_client import post_to_facebook_page
        return post_to_facebook_page
    if name == "upload_reel_to_facebook":
        from modules.module_05_page_manager.facebook_client import upload_reel_to_facebook
        return upload_reel_to_facebook
    if name == "upload_video_to_facebook":
        from modules.module_05_page_manager.facebook_client import upload_video_to_facebook
        return upload_video_to_facebook
    if name == "AIGenerator":
        from modules.module_05_page_manager.ai_generator import AIGenerator
        return AIGenerator
    if name == "get_image_from_internet":
        from modules.module_05_page_manager.image_downloader import get_image_from_internet
        return get_image_from_internet
    if name == "save_posted_to_google_sheet":
        from modules.module_05_page_manager.sheet_logger import save_posted_to_google_sheet
        return save_posted_to_google_sheet
    if name == "TikTokBulkDownloader":
        from modules.module_05_page_manager.tiktok_downloader import TikTokBulkDownloader
        return TikTokBulkDownloader
    if name == "YouTubeBulkDownloader":
        from modules.module_05_page_manager.youtube_downloader import YouTubeBulkDownloader
        return YouTubeBulkDownloader
    if name == "router":
        from modules.module_05_page_manager.routes import router
        return router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


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
    "router",
]
