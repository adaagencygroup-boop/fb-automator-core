# Database module 03 - Tab 1 (Tương tác tài khoản)

CSDL của Tab 1 (nuôi nick: lướt newsfeed, xem watch, kết bạn gợi ý, tham gia nhóm,
check thông báo). Phụ trách: Bình Kiến. Tab 2 (đăng bài) chưa có bảng ở đây; khi có
thì thêm file migration với số tiếp theo (vd. `003_tab2_post_schema.sql`) thay vì sửa file của Tab 1.

## File và bảng

| File | Chức năng |
| --- | --- |
| `models.py` | `DDL_STATEMENTS` + `init_models()`: engine tự tạo bảng khi khởi động (đăng ký trong `core/database/models.py`, giống module 05); có chuyển kiểu cho SQLite dự phòng |
| `migrations/001_tab1_farm_schema.sql` | Cùng schema để chạy tay trên Supabase, trong 1 transaction, bật RLS |
| `migrations/002_inspect.sql` | Kiểm tra chỉ đọc: cột, index, khóa, RLS, đếm theo trạng thái |
| `tests/test_migration_sync.py` | Báo lỗi nếu bảng / cột / index ở `models.py` và file SQL lệch nhau |

| Bảng | Nghiệp vụ |
| --- | --- |
| `farm_runs` | Lượt chạy của 1 nick trong 1 lần Kích hoạt: trạng thái, hoạt động hiện tại, lỗi |
| `farm_run_history` | 1 dòng / lượt đã kết thúc (ghi xong không sửa): proxy, kết quả, số liệu từng kịch bản, cấu hình đã dùng. `groups_keyword`: các từ khóa đã mở trang tìm nhóm, nối bằng dấu phẩy theo thứ tự dùng; NULL = vào nhóm đề xuất hoặc không tham gia nhóm |
| `farm_interaction_logs` | Từng hành động trong lượt; tổng `quantity` trong ngày (giờ VN) dùng tính giới hạn kết bạn / nhóm |
| `farm_browser_fingerprints` | Chế độ dấu vân tay + seed canvas cố định theo nick, dùng chung mọi máy |
| `farm_settings` | Cấu hình theo máy (`machine_id`): bật/tắt giới hạn ngày, số kết bạn / nhóm tối đa |

Tài khoản Facebook không nằm ở đây: Tab 1 đang đọc SQLite local tạm
(`_temp/local_db.py`, bảng `fb_accounts`) qua `adapters.py`. Khi module 02 hoàn thiện
thì đổi nguồn trong `adapters.py`, không đụng các bảng `farm_*`.

Cột `error` của `farm_runs` / `farm_run_history` có thể chứa URL checkpoint; cột
`proxy_host` chỉ lưu `host:port`, không lưu user/pass proxy.

## Chạy trên Supabase

1. Chạy `migrations/001_tab1_farm_schema.sql` trong SQL Editor của Supabase.
2. Chạy `migrations/002_inspect.sql` để đối chiếu: 5 bảng, 9 index tự đặt tên, `rowsecurity = true`.

Thứ tự với engine không quan trọng: cả hai dùng `CREATE TABLE / INDEX IF NOT EXISTS`.
Engine tạo bảng trước thì file SQL chỉ còn bật RLS; chạy SQL trước thì engine bỏ qua.
Script có thể chạy lại. `IF NOT EXISTS` không sửa bảng cùng tên đã có nhưng khác cột:
nếu Supabase đã có bảng `farm_*` từ trước thì đối chiếu bằng `002_inspect.sql` trước.

RLS bật, không tạo policy: chỉ backend (engine, kết nối bằng owner hoặc role BYPASSRLS)
đọc/ghi được, trình duyệt không truy cập trực tiếp. Nếu engine dùng role khác owner
thì cần kiểm tra quyền trước khi chạy thật.

## Sửa schema

Sửa đồng thời `models.py` và file SQL (hoặc thêm file migration mới cho thay đổi
sau khi đã chạy trên Supabase), rồi chạy:

```bash
.venv/Scripts/python.exe -m unittest modules.module_03_acc_farm.tests.test_migration_sync
```

`CREATE TABLE IF NOT EXISTS` không thêm cột vào bảng đã có. Thêm cột mới thì:

1. Thêm cột vào `CREATE TABLE` trong `models.py` và file SQL.
2. Thêm `(bảng, cột, kiểu)` vào `ADDED_COLUMNS` trong `models.py`: engine tự thêm cột cho DB đã có bảng
   (Postgres dùng `ADD COLUMN IF NOT EXISTS`, SQLite kiểm `PRAGMA table_info` trước).
3. Thêm câu `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` tương ứng vào file SQL. File đã chạy trên
   Supabase thì không sửa nữa: đặt câu này trong file migration mới.

Test đồng bộ kiểm cả 3 chỗ.
