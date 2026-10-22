"""Application package for Module 7 group posting."""

from .routes import router
from .services.group_source import (
    clean_group_url,
    get_posted_group_keys,
    get_sample_template,
    parse_group_file_content,
    search_facebook_groups,
)


def __getattr__(name: str):
    if name == "GroupSpamWorker":
        from .services.worker import GroupSpamWorker

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
