"""Module 10 — Quét thông tin nhóm Facebook."""

__all__ = ["router"]


def __getattr__(name):
    # Import router khi cần: import package (vd. khi chạy test) không được mở kết nối DB.
    if name == "router":
        from modules.module_10_group_scan.router import router

        return router
    raise AttributeError(name)
