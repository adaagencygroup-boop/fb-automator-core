# Module 02 — Accounts plugin

Backend chuyển từ trang Accounts của project tạo page. Plugin sở hữu API, repository,
migration, mã hóa, browser/login/proxy, profile storage và SSE. Không import core,
module khác, project nguồn hoặc VPS license. Frontend chưa chuyển trong đợt này.

## Tích hợp

Host gọi initialize(database_url=None, profile_root=None) trong lifespan startup,
include router từ api.router, rồi await shutdown() trong finally của lifespan.
engine.py hiện đã nối lifecycle và router này. Import package không mở DB hoặc đọc HWID.
Cài dependency: pip install -r modules/module_02_account_manager/requirements.txt.
Chrome phải được cài trên máy chạy automation.

## Cấu hình và dữ liệu

URL DB ưu tiên: tham số initialize → SUPABASE_DB_URL → DATABASE_URL. Không cần biến FB_ACCOUNT_DATABASE_URL.
Không có URL: bản dev dùng data/fb_automator.db hiện có của host. Nếu đặt
FB_ACCOUNT_DATA_DIR, SQLite nằm trong thư mục đó; bản đóng gói mặc định dùng
LOCALAPPDATA/FBAutomator/module_02_account_manager. Không fallback âm thầm khi DB cloud lỗi.

Profile mới: FB_ACCOUNT_DATA_DIR/browser_profiles/<owner-hash>/<uid>, hoặc thư mục
plugin trong data khi chạy dev; owner local dùng nhánh local. initialize(profile_root=...)
ghi đè root profile. Không tìm kiếm, sao chép hoặc xóa profile từ project tạo page.

Giữ bảng accounts, cột user_id và trạng thái DB chữ hoa để dashboard vẫn đọc được.
Migration version 1 thêm token_hotmail/client_id, nới cột ciphertext PostgreSQL và tạo
unique index cho UID local; version 2 đổi credential sang khóa HWID nguồn.
Migration giữ dữ liệu cũ, dừng nếu UID local bị trùng; không tự chọn bản ghi để xóa.
Chạy migration khi initialize, không chạy trên DB thật trong test.

Mã hóa mới dùng đúng collector HWID nguồn (SHA-256 của UUID::CPU) và khóa
SHA-256(HWID), tương thích định dạng AES-256-CBC nguồn. Khi khởi tạo, migration v2
chuyển credential version 1 của module 2 trong cùng transaction; lỗi giải mã sẽ rollback
và dừng startup, không bỏ qua hoặc ghi đè secret. Bản ghi version 2 không bị chuyển lần nữa.
HWID phải đọc được như lúc mã hóa dữ liệu module 2; dữ liệu không chuyển sang thiết bị khác.

## Owner và quyền truy cập

owner_username trong body/query hoặc X-Owner-Username ánh xạ vào accounts.user_id;
query user_id được giữ như alias. Các giá trị khác nhau trong một request bị từ chối 422.
Mỗi batch thuộc một owner. Không có owner chỉ thấy tài khoản local (user_id NULL).
Tác vụ nền, profile, khóa browser, proxy bridge và SSE giữ cùng phạm vi owner.

Đây là API local của desktop. Owner là bộ lọc dữ liệu, không phải cơ chế xác thực;
host chịu trách nhiệm xác thực/quyền truy cập nếu mở API ngoài localhost. Plugin không
xác minh JWT hoặc gọi VPS license. API danh sách/chi tiết trả credential giải mã để
phục vụ luồng chỉnh sửa của trang nguồn; không ghi credential vào SSE.

## API mới

Prefix chung: /api/accounts. API raw_data và response bọc accounts cũ đã được thay.
OpenAPI của FastAPI mô tả request; các response chính:

| Method/path | Payload | Response |
| --- | --- | --- |
| GET / | owner qua query/header | Array account |
| GET /{uid} | owner qua query/header | Account chi tiết |
| POST /single | uid và các trường account | success, uid |
| POST /import | accounts, check_status=false, owner_username | imported, errors:[{uid,error}], checking |
| POST /check-status | uids | statuses:{uid:live/die}, live, die, inconclusive |
| POST /delete-preview | uids, owner_username | page_counts:{uid:count}, pages_total |
| DELETE /{uid} | owner qua query/header, delete_pages=false qua query | deleted, profiles_deleted:[path], pages_deleted, pages_unlinked |
| POST /bulk-delete | uids, owner_username, delete_pages=false | deleted, deleted_uids, profiles_deleted:count, pages_deleted, pages_unlinked, errors:[{uid,error}] |
| POST /test-proxy | proxy | success, host, port, has_auth, egress_ip, message |
| POST /login | uids, threads=3, owner_username | started, count |
| POST /open-browser | uid, owner_username | started, uid |
| POST /{uid}/sync-cookies | owner qua query/header | success, uid, source hoặc message |
| GET /stream | owner qua query/header | text/event-stream |

### Xóa tài khoản và Fanpage

Nút xóa mở hộp thoại và gọi delete-preview để kiểm tra Fanpage liên quan. Khi có
Fanpage, người dùng chọn chỉ xóa tài khoản hoặc xóa cả tài khoản và Fanpage;
không có Fanpage thì chỉ hiện một nút xóa. Hủy hộp thoại không thay đổi dữ liệu.

Mặc định giữ bản ghi Fanpage và đặt pages.account_uid = NULL. delete_pages=true
xóa các bản ghi Fanpage liên quan trong phần mềm, không xóa Fanpage trên Facebook.
Thay đổi Fanpage và tài khoản dùng cùng transaction; giữ lịch sử, nhật ký và video.
Nếu UID có Fanpage đồng thời thuộc tài khoản của người dùng khác, từ chối xóa
vì bảng pages chưa phân biệt được chủ sở hữu. Không import kết nối DB của host.

Profile đang chạy hoặc không thể dọn sẽ chặn xóa dữ liệu DB. Nếu DB lỗi sau khi
profile đã được dọn, dữ liệu DB rollback nhưng không khôi phục được profile.
Xóa hàng loạt tiếp tục khi một UID thất bại; deleted_uids chỉ gồm các UID xử lý
thành công để giao diện giữ chọn những tài khoản lỗi và báo đúng kết quả.

Account gồm uid, owner_username, password, two_fa, cookie, token, email, pass_mail,
mail_recovery, token_hotmail, client_id, proxy, profile_name, login_status, status,
last_login_at và id. Danh sách dùng twofa_secret; chi tiết dùng two_fa theo nguồn.
Aliases nhập: twofa_secret, passmail, mailkhoiphuc, tokenhotmail, clientId.
Trường không gửi khi chỉnh sửa được giữ lại; gửi rỗng/null để xóa nội dung tương ứng.
Không cho client sửa trạng thái bằng import/single.

UID phải là chữ số ASCII, tối đa 50 ký tự. Import tối đa 100 account/request;
lỗi validation trả 422, lỗi lưu từng account trả errors và tiếp tục các dòng khác.
check_status chỉ xếp các UID import thành công, mỗi batch 20 UID, tối đa 2 check song song.
Login nhận 1–10 luồng, executor chung tối đa 10. Profile đang bận trả 409 khi mở/xóa;
xóa profile lỗi giữ bản ghi DB. Có thể xóa profile mồ côi trong root đúng owner.

Status API: live/die/null; login_status: logged_in/not_logged_in/failed.
Thời gian đăng nhập trả ISO 8601 UTC. Check Live/Die chạy Graph ảnh đại diện → HTTP
profile công khai → Selenium Chrome headless khi chưa kết luận được. Không dùng cookie,
token, proxy hay profile đăng nhập của tài khoản; browser dùng profile tạm và được đóng sau check.
Ảnh hợp lệ qua Facebook CDN hoặc bằng chứng profile đúng UID xác nhận live; thông báo
profile không khả dụng xác nhận die. Lỗi mạng, trang đăng nhập/checkpoint hoặc Chrome lỗi
không kết luận die: giữ trạng thái và thời điểm check cũ, UID mới vẫn có status=null.
statuses chỉ chứa kết quả xác định; inconclusive đếm UID chưa kết luận được.
Cookie sync giữ fallback nguồn: tìm dấu c_user trong DB profile, không giải mã cookie Chrome.
Proxy giữ hành vi nguồn: lỗi proxy có thể fallback kết nối trực tiếp và phát warning.

SSE gửi connected/heartbeat và log {time,level,message,uid}. Sau commit check trạng thái:
{event: account_statuses_updated, statuses: {...}, live, die, inconclusive}. Hoàn thành login phát
account_login_finished. Mỗi subscriber có queue riêng (1000 event; đầy thì bỏ event cũ nhất).
Client reconnect lấy lại danh sách account; không có replay lịch sử SSE.

## Hướng dẫn tái sử dụng cho các Module khác (Cross-Module Integration)

Module 02 đóng vai trò là **Core Account & Automation Provider** của toàn bộ ứng dụng. Các module nghiệp vụ khác (Module 03 Nuôi nick/Farm, Module 04 Tạo Page, Module 05 Đăng bài, Module 07 Tương tác Group...) nên tái sử dụng lại luồng của Module 02 thay vì tự viết lại cấu hình Selenium/Proxy hay query DB trùng lặp.

### 1. Tái sử dụng qua Python Library (Khuyến nghị cho Worker nội bộ)

Tất cả các hàm nền tảng đã được đóng gói và export sẵn tại:
```python
from modules.module_02_account_manager.automation import (
    create_driver,
    close_driver_for_uid,
    get_profile_lock,
    ensure_logged_in,
    is_checkpoint_url,
    human_sleep,
    human_type,
    wait_and_find,
)
from modules.module_02_account_manager.automation.proxy_bridge import (
    parse_proxy,
    test_proxy_connectivity,
    ProxyBridge,
)
from modules.module_02_account_manager.database.connection import SessionLocal
from modules.module_02_account_manager.database.repository import AccountRepository
```

#### A. Khởi tạo Trình duyệt Chrome & Tự động kết nối Proxy Bridge
Không cần tự cấu hình Selenium Options hay chạy local proxy thủ công:
```python
# Mở trình duyệt với scope tương ứng ('farm', 'creator', 'spam', 'live')
# Tự động:
# - Gán đúng thư mục Chrome Profile của UID (giữ cookie/session).
# - Kiểm tra pre-flight test kết nối proxy.
# - Dựng Local Proxy Bridge trên 127.0.0.1 nếu proxy có User/Password.
# - Tự động Fallback sang IP gốc của máy và bắn cảnh báo nếu proxy lỗi.
driver = create_driver(uid="100012345678", proxy=account.proxy, scope="farm")
try:
    driver.get("https://www.facebook.com")
    # Thực hiện hành động của module tại đây...
finally:
    # Đóng Chrome và tự động giải phóng port Proxy Bridge
    close_driver_for_uid("100012345678")
```

#### B. Kiểm tra Đăng nhập & Bắt Checkpoint (`ensure_logged_in`)
Đảm bảo tài khoản đã ở trạng thái đăng nhập trước khi chạy tương tác:
```python
logged_in = ensure_logged_in(
    driver=driver,
    uid=account.uid,
    password=plain_password,
    two_fa=plain_2fa,
    cookie=account.cookie,
)
if not logged_in:
    if is_checkpoint_url(driver.current_url):
        # Đánh dấu nick bị checkpoint
        pass
```

#### C. Chống xung đột Profile (`Profile Lock`)
Tránh lỗi hỏng Profile Chrome khi 2 module cùng lúc mở đè lên 1 UID:
```python
profile_lock = get_profile_lock(uid)
if not profile_lock.acquire(blocking=False):
    # Tài khoản đang được chạy bởi module khác (hoặc đang mở live browser)
    return
try:
    # Thao tác với trình duyệt...
finally:
    profile_lock.release()
```

#### D. Truy vấn và Cập nhật Tài khoản (`AccountRepository`)
Lấy thông tin tài khoản và cập nhật trạng thái đồng bộ:
```python
with SessionLocal() as db:
    # Lấy tài khoản theo UID
    acc = AccountRepository.get_by_uid(db, uid="100012345678")
    
    # Lấy danh sách tài khoản theo bộ lọc
    live_accounts = AccountRepository.list_accounts(db, status="LIVE", limit=50)
    
    # Cập nhật trạng thái sau khi chạy tương tác xong
    AccountRepository.update_status(db, uid="100012345678", status="LIVE")
```

---

### 2. Tái sử dụng qua RESTful API / Local Engine (Tách biệt hoàn toàn)

Nếu các worker chạy độc lập hoặc gọi từ Desktop UI/Frontend Tauri:

* **Lấy danh sách nick**: `GET /api/accounts` trả toàn bộ tài khoản của người dùng theo ID giảm dần. Màn hình Module 2 tìm kiếm/lọc trên frontend và cuộn danh sách trong khung bảng hiện tại, không tải thêm từ backend. `GET /api/accounts/page` vẫn phục vụ bộ chọn tài khoản của các module khác.
* **Mở trình duyệt trực quan cho người dùng xem**: `POST /api/accounts/open-browser` (body: `{"uid": "..."}`).
* **Đồng bộ Cookie mới nhất sau phiên chạy**: `POST /api/accounts/{uid}/sync-cookies`.
* **Kiểm tra Proxy**: `POST /api/accounts/test-proxy` (body: `{"proxy": "ip:port:user:pass"}`).
* **Đăng ký nhận Log thời gian thực**: `GET /api/accounts/stream` (SSE log stream).

## Kiểm thử

### Ảnh đại diện account

Sau đăng nhập thành công (phiên có sẵn, cookie hoặc mật khẩu), Module 02 lấy tên
và ảnh cùng một lượt từ khối account trên trang chủ. Tên lấy từ text của link
profile đúng UID; ảnh đọc từ
`xlink:href`/`href` của SVG avatar trong link profile đúng UID trên trang chủ,
dự phòng nút tài khoản, bằng chính browser đang đăng nhập. Không bấm/mở link
profile để lấy ảnh. Chỉ khi thiếu tên mới dùng fallback lấy tên qua `/me`.
Cookie `c_user` phải khớp UID; URL HTTPS Facebook CDN
được lưu vào `avatar_url` và trả trong API danh sách/phân trang/chi tiết.
Không lấy được ảnh thì giữ URL cũ, không làm đăng nhập thất bại. Đổi UID xóa
URL cũ. Giao diện dùng chữ cái khi chưa có ảnh hoặc ảnh tải lỗi. URL có thể hết
hạn; lần đăng nhập thành công tiếp theo sẽ cập nhật lại. Migration v4 bổ sung
cột khi khởi tạo module, không cần lấy ảnh cho toàn bộ account lúc khởi động.

Áp dụng cho cả đăng nhập hàng loạt, Mở Chrome và watcher phát hiện đăng nhập
thủ công. Quá trình lấy và lưu ảnh không phát log riêng.

Chạy: python -m unittest discover -s modules/module_02_account_manager/tests -t . -v

Test dùng DB/profile tạm, mock Chrome/Facebook/HWID; proxy bridge test dùng loopback.
Để chạy test PostgreSQL, đặt ACCOUNT_TEST_POSTGRES_URL trỏ vào DB test riêng có quyền
CREATE SCHEMA. Suite tạo schema ngẫu nhiên và xóa đúng schema đó khi kết thúc, không dùng
DATABASE_URL của ứng dụng. Nếu chưa cấu hình, ba test PostgreSQL được skip rõ ràng.


## V2: Account categories (backend and database)

Categories are a flat, owner-scoped collection. An account belongs to at most one
category. `category_id: null` means uncategorized; there is no synthetic category row.
Owner resolution uses the existing authenticated user, headers and explicit owner
fields. PATCH bodies receive the same owner-conflict checks as POST bodies.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/accounts/categories` | Existing owner headers/query | Array of categories ordered by ascending ID, each with `account_count` |
| `POST /api/accounts/categories` | `{"name":"Main","color":"#2563EB"}` | 201, category with `account_count: 0` |
| `PATCH /api/accounts/categories/{id}` | Optional `name`, `color`; `color: null` clears the color | 200, updated category and current account count |
| `DELETE /api/accounts/categories/{id}` | Existing owner headers/query | `{"deleted":true,"unassigned_count":3}` |
| `POST /api/accounts/bulk-set-category` | `{"uids":["123","456"],"category_id":1}` | `{"updated_count":2}` |

Category response example:

```json
{
  "id": 1,
  "user_id": "42",
  "name": "Main",
  "color": "#2563EB",
  "created_at": "2026-10-22T03:00:00+00:00",
  "updated_at": "2026-10-22T03:00:00+00:00",
  "account_count": 2
}
```

Names are trimmed, required, at most 100 characters, and unique without regard to
case within an owner. Colors are optional six-digit HEX strings (`#RRGGBB`).
PATCH cannot set `name` to null or change category ownership. Deleting a category
unassigns its accounts without deleting accounts, credentials, profiles or pages.
Category timestamps use UTC. Account counts include only the current owner's accounts.

Bulk assignment accepts 1?100 UID entries, deduplicates UIDs, and commits atomically.
Use `category_id: null` to remove assignments. The target category and every account
must belong to the current owner. An unknown account/category or one belonging to
another owner returns 404 without partial changes. Invalid input returns 422;
duplicate category names return 409. `updated_count` counts distinct matched accounts,
including accounts already assigned to the target.

`POST /api/accounts/single` and each account in `POST /api/accounts/import` accept
optional `category_id`. Omission preserves an existing assignment; explicit null
clears it. Newly created accounts default to uncategorized. Import retains its
existing per-account success/error behavior, including `skip_existing`.
Account list, page and detail responses include `category_id`.

`GET /api/accounts`, `/api/accounts/page`, `/api/accounts/stats`, and the legacy
`GET /accounts` accept `category_id=<positive integer>` or `uncategorized=true`.
Using both returns 422. A category outside the current owner returns 404. Page filters
compose with the existing search/status/login/active filters; pagination totals and
stats reflect the category selection. Omitting the new parameters preserves existing
behavior and response shapes except for the additional account field.

Schema migration 5 creates `account_categories` (`id`, `user_id`, `name`, `color`,
`created_at`, `updated_at`) and nullable `accounts.category_id` with an indexed
`(user_id, category_id)` lookup and `ON DELETE SET NULL` foreign key. Two unique
indexes enforce case-insensitive names for named owners and the legacy null owner.
Migration is additive and repeatable; existing accounts remain uncategorized.
The normal plugin startup applies migrations. This change does not require a manual
production migration or frontend update.

Tests: `tests/test_categories.py` covers category CRUD, owner isolation, validation,
atomic assignment, import/edit compatibility, query filters, counts and migrations.
Run the isolated backend suite with:

```powershell
.venv/Scripts/python.exe -m modules.module_02_account_manager.tests.run_suite
```

PostgreSQL migration/FK tests require `ACCOUNT_TEST_POSTGRES_URL` and create a temporary
schema. They never fall back to the application's production database URLs.
