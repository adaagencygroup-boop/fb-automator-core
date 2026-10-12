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
| POST /check-status | uids | statuses:{uid:live/die}, live, die |
| DELETE /{uid} | owner qua query/header | deleted, profiles_deleted:[path] |
| POST /bulk-delete | uids, owner_username | deleted, profiles_deleted:count, errors:[{uid,error}] |
| POST /test-proxy | proxy | success, host, port, has_auth, egress_ip, message |
| POST /login | uids, threads=3, owner_username | started, count |
| POST /open-browser | uid, owner_username | started, uid |
| POST /{uid}/sync-cookies | owner qua query/header | success, uid, source hoặc message |
| GET /stream | owner qua query/header | text/event-stream |

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
Thời gian đăng nhập trả ISO 8601 UTC. Check Live/Die giữ heuristic nguồn, bao gồm
trả die khi Chrome không chạy được; đây không phải xác nhận tài khoản đã bị khóa.
Cookie sync giữ fallback nguồn: tìm dấu c_user trong DB profile, không giải mã cookie Chrome.
Proxy giữ hành vi nguồn: lỗi proxy có thể fallback kết nối trực tiếp và phát warning.

SSE gửi connected/heartbeat và log {time,level,message,uid}. Sau commit check trạng thái:
{event: account_statuses_updated, statuses: {...}}. Hoàn thành login phát
account_login_finished. Mỗi subscriber có queue riêng (1000 event; đầy thì bỏ event cũ nhất).
Client reconnect lấy lại danh sách account; không có replay lịch sử SSE.

## Kiểm thử

Chạy: python -m unittest discover -s modules/module_02_account_manager/tests -t . -v

Test dùng DB/profile tạm, mock Chrome/Facebook/HWID; proxy bridge test dùng loopback.
Để chạy test PostgreSQL, đặt ACCOUNT_TEST_POSTGRES_URL trỏ vào DB test riêng có quyền
CREATE SCHEMA. Suite tạo schema ngẫu nhiên và xóa đúng schema đó khi kết thúc, không dùng
DATABASE_URL của ứng dụng. Nếu chưa cấu hình, ba test PostgreSQL được skip rõ ràng.
