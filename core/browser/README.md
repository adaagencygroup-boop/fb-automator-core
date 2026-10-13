# core/browser — mở Chrome dùng chung

Mọi module cần mở Chrome cho một nick Facebook nên mở qua đây. Mục tiêu: **1 nick = 1 thiết bị**,
dù nick được dùng ở Quản lý tài khoản, Tương tác, Seeding hay Đăng nhóm.

Nếu mỗi module tự mở Chrome theo cách riêng thì cùng một nick sẽ có nhiều profile, nhiều User-Agent,
nhiều kiểu fingerprint. Với Facebook đó là nhiều thiết bị dùng chung một cookie đăng nhập.

Core chỉ lo **mở / đóng Chrome**: profile, khóa profile, dấu vân tay, proxy. Không đăng nhập Facebook,
không đọc bảng tài khoản: module gọi tự truyền `uid`, `owner`, `proxy` và tự xử lý đăng nhập.

## Dùng nhanh

```python
from core.browser import open_browser, get_profile_lock, human_sleep, human_type, extract_cookies_as_string

lock = get_profile_lock(uid, owner)
if not lock.acquire(timeout=5):
    return  # nick đang được module / luồng khác dùng
try:
    driver = open_browser(uid, owner=owner, proxy=account_proxy, scope="seeding",
                          allow_direct_fallback=False)
    try:
        driver.get("https://www.facebook.com")
        human_sleep(2, 4, config=driver.browser_config)   # nhịp riêng của nick
        ...
    finally:
        driver.quit()
finally:
    lock.release()
```

## API

| Hàm | Việc |
| --- | --- |
| `open_browser(uid, owner=None, proxy=None, scope="default", headless=False, detach=False, verify_egress=True, allow_direct_fallback=True, extra_arguments=None, extra_init_scripts=None, on_log=None, on_before_close=None)` | Mở Chrome cho nick. Driver có thêm `browser_config`, `fingerprint_mode`, `proxy_mode`, `proxy_egress_ip`, `profile_path` |
| `get_profile_lock(uid, owner=None)` | Lock theo profile. Module tự giữ lock trong lúc dùng Chrome; `open_browser` không tự lấy |
| `get_profile_path(uid, owner=None)` | Thư mục profile của nick |
| `close_driver_for_uid(uid, owner=None)` | Đóng Chrome đang mở của nick (gọi `on_before_close` trước) |
| `close_scoped_active_drivers(scope, force=False)` | Đóng mọi Chrome của một scope (dừng khẩn cấp) |
| `close_all_active_drivers()` | Đóng tất cả (khi tắt engine) |
| `get_active_drivers(uid=None, owner=None, scope=None)` | Danh sách Chrome đang mở |
| `safe_close_driver`, `force_kill_driver`, `unregister_active_driver` | Đóng / gỡ driver |
| `extract_cookies_as_string(driver)`, `load_cookies(driver, cookie)` | Lấy / nạp cookie facebook.com |
| `wait_and_find(driver, xpaths, timeout)` | Chờ phần tử hiển thị theo danh sách XPath |
| `human_type(el, text, config=...)`, `human_sleep(a, b, config=...)` | Gõ / nghỉ theo nhịp của nick |
| `parse_proxy`, `ProxyError`, `ProxyConnectionError`... | Proxy |

## Profile

```
<gốc>/browser_profiles/<"local" | sha256(owner)>/<uid>
```

Giống hệt Module 02 (`module_02_account_manager/utils/paths.py`), gốc là `FB_ACCOUNT_DATA_DIR`
hoặc `data/module_02_account_manager` khi chạy dev, `LOCALAPPDATA/FBAutomator/module_02_account_manager`
khi đóng gói. Đổi quy tắc ở một bên thì phải đổi bên kia.

`owner` giống owner của Module 02 (`accounts.user_id`); `None` là nick local.

## Dấu vân tay

Lưu ở bảng `browser_fingerprints (uid, mode, canvas_seed, created_at)`, dùng chung mọi máy.

- **native**: profile chưa từng mở khi lần đầu gặp nick. Có seed riêng, thêm nhiễu canvas / WebGL readPixels /
  AudioContext theo seed. Kích thước cửa sổ, `--lang` + `navigator.languages`, nhịp gõ / nghỉ chọn theo seed.
- **legacy**: profile đã có thư mục `Default` (đã từng được mở trước khi có bảng). Không thêm nhiễu để
  không đổi dấu vân tay nick đang dùng.

Nguyên tắc: chỉ đổi những gì nhất quán với máy thật. **Không** ép User-Agent (UA giả lệch với
`navigator.userAgentData` / `Sec-CH-UA` của bản Chrome thật), **không** giả `navigator.plugins`,
GPU, CPU, RAM, màn hình.

Không đọc được bảng thì `open_browser` báo lỗi và không mở Chrome, để nick native không bị mở mất nhiễu.

Bảng hiện do Module 03 tạo (`modules/module_03_acc_farm/models.py` `SHARED_DDL_STATEMENTS`,
`migrations/005_browser_fingerprints.sql`). Khi nhiều module dùng core thì nên chuyển DDL sang core.

## Proxy

- Proxy có user/pass đi qua bridge `127.0.0.1` (Chrome không nhận user/pass trong `--proxy-server`).
- Proxy chỉ cho đi Facebook vẫn dùng được (`proxy_mode = "facebook_only"`).
- Chỉ hỗ trợ HTTP/HTTPS, chưa hỗ trợ SOCKS.
- **Proxy chết**: mặc định `allow_direct_fallback=True` chạy bằng IP thật của máy (giữ hành vi cũ).
  Chạy IP thật làm lộ máy và gom nhiều nick về chung 1 IP. Tác vụ trên nick nên truyền `False`
  để nhận `ProxyConnectionError` và bỏ qua nick.

## Riêng của module

- Cờ Chrome riêng: `extra_arguments=[...]` (vd Module 03 farm không cho Chrome hãm timer khi cửa sổ bị che).
- JS riêng chạy trước mọi trang: `extra_init_scripts=[...]`.
- Đưa thông báo proxy lên giao diện: `on_log=lambda level, msg: ...`.
- Lưu cookie khi Chrome bị đóng để mở lại: `on_before_close=lambda driver: ...`.

## Giới hạn hiện tại

- Lock và danh sách Chrome chỉ có hiệu lực trong **1 tiến trình** (engine). App chạy tiến trình riêng
  (vd `FaceBook_Post_Group.py`) không bị chặn.
- Module chưa chuyển sang core vẫn mở Chrome theo cách riêng, lock riêng. Ví dụ Module 02 mở nick native
  không có nhiễu thì dấu vân tay lệch với lúc mở qua core. Chỉ hết khi module đó dùng core.

## Test

```bash
.venv/Scripts/python.exe -m unittest modules.module_03_acc_farm.tests.test_core_browser
```
