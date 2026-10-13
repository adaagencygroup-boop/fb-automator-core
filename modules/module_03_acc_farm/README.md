# Database module 03 - Tab 1 (Tương tác tài khoản) & Tab 2 (Đăng bài viết)

CSDL của Module 03 gồm:
- Tab 1: Nuôi nick (lướt newsfeed, xem watch, kết bạn gợi ý, tham gia nhóm, check thông báo).
- Tab 2: Đăng bài tự động & tích hợp AI Gemini (Đăng status, Reels, Story, ánh xạ thư mục, lịch sử).

## File và bảng

| File | Chức năng |
| --- | --- |
| `models.py` | `DDL_STATEMENTS` + `TAB2_DDL_STATEMENTS_*` + `init_models()`: engine tự tạo bảng khi khởi động (cả Postgres và SQLite dự phòng) |
| `migrations/001_tab1_farm_schema.sql` | Schema Tab 1 để chạy tay trên Supabase, trong 1 transaction, bật RLS |
| `migrations/002_inspect.sql` | Kiểm tra chỉ đọc Tab 1: cột, index, khóa, RLS, đếm theo trạng thái |
| `migrations/003_tab2_post_schema.sql` | Schema Tab 2 để chạy tay trên Supabase (PostgreSQL 13+), trigger tự cập nhật, dọn dẹp, bật RLS |
| `migrations/004_inspect_tab2.sql` | Kiểm tra chỉ đọc Tab 2: cột, index, ràng buộc khóa, RLS, đếm theo trạng thái |
| `migrations/005_browser_fingerprints.sql` | Bảng dùng chung `browser_fingerprints` của `core/browser` (chạy tay trên Supabase sau 001) |
| `tests/test_migration_sync.py` | Báo lỗi nếu bảng / cột / index ở `models.py` và file SQL Tab 1 (001) / bảng dùng chung (005) lệch nhau |

### Bảng Tab 1 (Nuôi nick)
| Bảng | Nghiệp vụ |
| --- | --- |
| `farm_runs` | Lượt chạy của 1 nick trong 1 lần Kích hoạt: trạng thái, hoạt động hiện tại, lỗi |
| `farm_run_history` | 1 dòng / lượt đã kết thúc (ghi xong không sửa): proxy, kết quả, số liệu từng kịch bản, cấu hình đã dùng |
| `farm_interaction_logs` | Từng hành động trong lượt; tổng `quantity` trong ngày (giờ VN) dùng tính giới hạn kết bạn / nhóm |
| `farm_browser_fingerprints` | Bảng cũ: dấu vân tay theo nick. Không còn ghi, dữ liệu đã chuyển sang `browser_fingerprints` |
| `farm_settings` | Cấu hình theo máy (`machine_id`): bật/tắt giới hạn ngày, số kết bạn / nhóm tối đa |

### Bảng Tab 2 (Đăng bài & Lịch sử)
*(Lưu ý: Bảng tài khoản `accounts` được quản lý độc lập bởi Module 02, Tab 2 neo theo `account_uid`)*

| Bảng | Nghiệp vụ |
| --- | --- |
| `post_settings` | Cấu hình theo tab (status: key, model, prompt, pixabay; reels/story: folder, check_duplicate, delay, schedule) |
| `account_folder_mappings` | Ánh xạ thư mục nguồn cho Reels/Story theo `account_uid`, số lượng file, trạng thái MAPPED/SOURCE_ERROR |
| `post_sessions` | Phiên chạy đăng bài hoặc tương tác (status: RUNNING, DONE, STOPPED, CRASHED) |
| `posts` | Quản lý bản nháp, hàng đợi và lịch sử xuất bản (vòng đời Status: DRAFT->READY->PENDING->RUNNING; Reels/Story: PENDING->RUNNING) |
| `post_interaction_logs` | Nhật ký chạy tương tác nhanh riêng của Tab 2 (duration_minutes, delay_seconds, random_actions_count, status) |

Tài khoản Facebook không nằm ở đây: Tab 1 đọc bảng `accounts` của Module 02 qua `adapters.py`
(chỉ nick local, `user_id` NULL, vì Tab 1 chưa nhận owner). Trạng thái chữ hoa của Module 02 được đổi
về chữ thường trong `adapters.py`; nick bị checkpoint ghi `login_status = ERROR`, `status = CHECKPOINT`.
Đăng nhập / mở trình duyệt thủ công làm ở trang Quản lý tài khoản (Module 02).

Chrome mở qua `core/browser` (xem `core/browser/README.md`): profile chung với Module 02
(`data/module_02_account_manager/browser_profiles/<owner>/<uid>`), dấu vân tay theo nick.

### Bảng dùng chung (tạm đặt ở Module 03)
| Bảng | Nghiệp vụ |
| --- | --- |
| `browser_fingerprints` | Dấu vân tay trình duyệt theo nick của `core/browser`, dùng chung mọi module. DDL ở `SHARED_DDL_STATEMENTS` (`models.py`) và `migrations/005_browser_fingerprints.sql`; khởi động engine tự chép dữ liệu từ `farm_browser_fingerprints` (bảng cũ, không còn ghi) |

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
