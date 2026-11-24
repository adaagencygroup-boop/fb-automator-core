"""Module 12 — Quét tài khoản đã tương tác bài viết (Like / Reaction, Share, Comment) + phân tầng tiềm năng."""

__all__ = ["router"]


def __getattr__(name):
    # Import router khi cần: import package (vd. khi chạy test) không được mở kết nối DB.
    if name == "router":
        from modules.module_12_post_engagement.router import router

        return router
    raise AttributeError(name)
