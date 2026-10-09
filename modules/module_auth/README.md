# Database module auth

Phạm vi hiện tại: chuyển schema auth của `project_auto_create_page_facebook`
sang Supabase PostgreSQL, tổ chức riêng trong `modules/module_auth` theo yêu
cầu. Chưa viết API, giao diện, initializer Python hoặc sửa source hiện có.

## File và bảng

| File | Chức năng |
| --- | --- |
| `migrations/001_schema.sql` | Tạo/bổ sung schema 4 bảng auth và bật RLS |
| `migrations/002_inspect.sql` | Kiểm tra chỉ đọc cấu trúc/index/FK/RLS và phân bố role/status |

| Bảng | Nghiệp vụ |
| --- | --- |
| `users` | Username, hash bcrypt, thông tin liên hệ, HWID, vai trò, trạng thái duyệt, hạn dùng |
| `user_sessions` | Thiết bị, IP, fingerprint token, phiên hoạt động/đăng xuất |
| `system_notifications` | Thông báo đăng ký, duyệt, gia hạn và các sự kiện tài khoản |
| `admin_activity_logs` | Nhật ký thao tác quản lý tài khoản, bản quyền và reset mật khẩu/HWID |

Nguồn: các file `user.py`, `user_session.py`, `notification.py`,
`admin_activity_log.py` trong `vps-license-server/app/models/` của repo cũ.
Các bảng này trước đây đã dùng PostgreSQL; không chuyển thành Supabase Auth.

Luồng cần giữ khi triển khai API: đăng ký `user/pending` -> admin duyệt/cấp hạn
-> đăng nhập kiểm tra mật khẩu, trạng thái, hạn dùng và HWID -> tạo phiên/JWT.
User hết hạn có thể xem dashboard/hỗ trợ nhưng không thực thi tính năng cần
bản quyền. Quên mật khẩu là liên hệ admin, cập nhật password_hash, thu hồi
phiên và ghi nhật ký; không có bảng OTP/reset token trong nguồn cũ.

## Chạy SQL và tương thích bảng users

Chạy `001_schema.sql`, sau đó `002_inspect.sql` trong SQL Editor của Supabase
dự án mới. Script schema chạy trong transaction; có thể chạy lại trên schema
do nó tạo ra. Không có import/update/delete bản ghi. Các bảng khác nếu đã tồn
tại với cấu trúc khác cần được đối chiếu trước, không tự nâng cột bằng
`CREATE TABLE IF NOT EXISTS`.

Nếu `users` của dự án mới đã tồn tại, giữ các cột mở rộng và độ dài username
hiện có; bổ sung `contact_info`, `hwid`, `expired_at`, `last_login_at`,
`last_login_ip`, `last_hwid_reset_at`. Default cho bản ghi mới là `user/pending`,
không thay giá trị role/status hoặc last_login của bản ghi đang có.
Ngày giờ giữ kiểu TIMESTAMP không timezone và quy ước UTC của repo cũ.

Khi sửa source cần thống nhất `ADMIN/MEMBER` với `admin/user`,
`ACTIVE/BLOCKED` với `approved/banned`, giữ `superadmin`, `pending`, `rejected`,
`expired`, và xử lý `last_login`/`last_login_at`. Không tự cấp hạn cho user
ACTIVE cũ. Chưa thêm CHECK role/status để không chặn dữ liệu cần ánh xạ.

RLS được bật, chưa có policy truy cập từ trình duyệt; các policy đã có không
bị thay. Backend tin cậy phải có quyền phù hợp, kiểm tra phiên và quyền user.
Table owner/BYPASSRLS không tự được lọc theo người dùng bằng RLS.

## Quan hệ với dashboard và core

Dashboard đọc thông tin bản quyền/HWID từ auth, không tạo bản sao users.
Các bảng phục vụ số liệu Facebook/Fanpage đặt tại
`modules/module_01_dashboard/migrations/` trong phạm vi hai module hiện tại.

`core/database/connection.py` tiếp tục là kết nối chung. Source
`core/database/models.py` vẫn khai báo users cũ và chỉ đăng ký core/Module 5;
SQL này chưa được init_database() gọi. Khi được phép tích hợp, module auth
cần models.py/init_models() riêng và được core điều phối, đồng thời giải quyết
DDL users trùng ở core. Chưa có runner migration hay fallback SQLite cho SQL này.

Chưa chạy SQL lên Supabase, chưa nhập dữ liệu và chưa kiểm thử PostgreSQL.
Nếu nhập dữ liệu sau: đối chiếu user/ID trùng, giữ FK session/notification,
đồng bộ sequence khi nhập ID tường minh; hash bcrypt có thể giữ với cùng verifier.
