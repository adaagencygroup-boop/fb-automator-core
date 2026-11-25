"""Module 05 — Page Manager."""


def __getattr__(name):
    if name == "upload_reel_to_facebook":
        from modules.module_05_page_manager.facebook_client import upload_reel_to_facebook
        return upload_reel_to_facebook
    if name == "AIGenerator":
        from modules.module_05_page_manager.ai_generator import AIGenerator
        return AIGenerator
    if name == "get_image_from_internet":
        from modules.module_05_page_manager.image_downloader import get_image_from_internet
        return get_image_from_internet
    if name == "router":
        from modules.module_05_page_manager.routes import router
        return router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "upload_reel_to_facebook",
    "AIGenerator",
    "get_image_from_internet",
    "router",
]
