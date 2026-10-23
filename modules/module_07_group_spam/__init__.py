"""Public exports for the Module 7 application package."""

from .app.routes import router
from .app.services.group_source import (
    clean_group_url,
    get_posted_group_keys,
    get_sample_template,
    parse_group_file_content,
    search_facebook_groups,
)


def __getattr__(name: str):
    if name == "GroupSpamWorker":
        from .app.services.worker import GroupSpamWorker

        return GroupSpamWorker
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "GroupSpamWorker",
    "router",
    "clean_group_url",
    "get_posted_group_keys",
    "get_sample_template",
    "parse_group_file_content",
    "search_facebook_groups",
]
