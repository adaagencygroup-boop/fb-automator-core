"""
Backend module package metadata.
UI sống ở frontend/src/modules — không còn PyQt tabs.
"""

MODULE_REGISTRY = [
    {
        "id": "module_01_dashboard",
        "title": "Dashboard",
        "author": "Đức",
    },
    {
        "id": "module_02_account_manager",
        "title": "Quản Lý Acc FB",
        "author": "Mạnh Cường",
    },
    {
        "id": "module_03_acc_farm",
        "title": "Nuôi Acc (Farm)",
        "author": "Cường Trần, Bình Kiến",
    },
    {
        "id": "module_04_page_creator",
        "title": "Tạo Page Hàng Loạt",
        "author": "Minh",
    },
    {
        "id": "module_05_page_manager",
        "title": "Quản Lý Fanpage",
        "author": "Bình Ka, Kiệt",
    },
    {
        "id": "module_06_omnichannel_chat",
        "title": "Quản Lý Chat Page",
        "author": "Mạnh, Minh",
    },
    {
        "id": "module_07_group_spam",
        "title": "Spam Group FB",
        "author": "Anh",
    },
    {
        "id": "module_08_interaction_seeding",
        "title": "Seeding Tương Tác",
        "author": "Hưởng, Trường",
    },
    {
        "id": "module_09_user_profile",
        "title": "Hồ Sơ & Cài Đặt",
        "author": "Trường, Kiệt",
    },
    {
        "id": "module_11_page_scanner",
        "title": "Quét Dữ Liệu Page",
        "author": "Trần Cường",
    },
]

__all__ = ["MODULE_REGISTRY", "load_backend_modules"]


def load_backend_modules():
    """Import từng package module. Module thiếu/lỗi không được làm sập cả Engine."""
    import importlib
    import traceback

    loaded = []
    for item in MODULE_REGISTRY:
        mod_id = item["id"]
        try:
            importlib.import_module(f"modules.{mod_id}")
            loaded.append(mod_id)
        except Exception as exc:
            print(f"[Modules] Skip {mod_id}: {exc}")
            traceback.print_exc()
    return loaded
