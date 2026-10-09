# Database module dashboard

Theo phạm vi hiện tại chỉ triển khai auth và dashboard, dữ liệu từ dashboard
cũ được gom tại module này. Chưa triển khai account_manager/page_creator và
không đặt file database mới vào hai module đó.

## File và bảng

| File | Chức năng |
| --- | --- |
| `migrations/001_schema.sql` | Schema PostgreSQL của fb_accounts và created_pages, index và RLS |
| `migrations/002_inspect.sql` | Kiểm tra cấu trúc/index/RLS và phân bố trạng thái bằng truy vấn chỉ đọc |

Nguồn cả hai bảng: `local-engine/app/database/local_db.py` của repo
`project_auto_create_page_facebook`. Giữ tên/cột/kiểu/độ dài/nullability của
model gốc; ID tự tăng dùng SERIAL thay cho SQLite; timestamp theo quy ước UTC.
Không thêm unique cho fb_accounts.uid. Giữ owner_username như nguồn cũ.
Không chuyển local_settings vì nó không là nguồn số liệu dashboard.

Dashboard cũ không có bảng riêng, dùng dữ liệu tài khoản Facebook và lịch sử
tạo page để đếm. Hai bảng tại đây là dữ liệu nguồn cho thống kê, không đồng
nghĩa đã có chức năng quản lý tài khoản hoặc tạo Fanpage.

## Ánh xạ với giao diện người dùng cung cấp

| Nội dung | Nguồn / quy tắc khi triển khai API |
| --- | --- |
| Bản quyền đang hoạt động, số ngày và ngày hết hạn | Auth: users.status, expired_at; số ngày do backend tính |
| Xác thực HWID | Auth kiểm tra mã máy hiện tại với users.hwid; chỉ có HWID lưu trong DB chưa chứng minh máy đang dùng hợp lệ |
| Tổng số account | COUNT fb_accounts theo owner_username của user đã xác thực |
| Live | Đếm trạng thái live, chuẩn hóa hoa/thường khi đọc |
| Die / Failed | Trạng thái die; nếu bổ sung failed cần quy định riêng, không tự coi NULL/unknown là die |
| Tỷ lệ khả dụng | live / tổng account * 100; tổng bằng 0 thì trả 0 |
| Tổng số Fanpage | Theo luồng cũ: số bản ghi created_pages của user, tức kết quả/lượt tạo page được ghi nhận |
| Đã khởi tạo thành công | created_pages.status = SUCCESS |
| Đã khởi tạo thất bại | created_pages.status = FAILED |
| Liên hệ hỗ trợ / gia hạn | Thông tin hỗ trợ do auth cung cấp từ cấu hình backend |

Nguồn cũ còn có PARTIAL; phải thống kê riêng hoặc quy định cách hiển thị khi
làm API/UI, không tự gộp thành FAILED. Model created_pages không có page_id
riêng và có thể chứa lần tạo thất bại, nên số bản ghi không chứng minh số
Fanpage thực tế duy nhất. Nếu giao diện cần số Fanpage thực tế, cần chốt lại
định nghĩa và nguồn dữ liệu ở bước triển khai. Tỷ lệ dùng mẫu số cùng tập kết
quả đang hiển thị; không hardcode số liệu 120/58 hoặc ngày trong ảnh.

Mọi thống kê phải theo owner của phiên đã xác thực, không nhận một username
bất kỳ làm căn cứ phân quyền. Ví dụ tham số psycopg2 cho backend sau này:

```sql
SELECT COUNT(*) FROM public.fb_accounts WHERE owner_username = %s;
SELECT COUNT(*) FROM public.created_pages
WHERE owner_username = %s AND status = 'SUCCESS';
```

## Thực thi và giới hạn hiện tại

Chạy SQL auth trước, rồi `migrations/001_schema.sql` ở module dashboard, sau
đó các file inspect trong SQL Editor của Supabase dự án mới. Schema dashboard
có transaction riêng, có thể chạy lại trên cấu trúc nó tạo ra; không tự sửa
một bảng cùng tên đã có nhưng khác cột. Chưa nhập bản ghi hoặc chạy lên Supabase.

RLS bật, chưa tạo policy cho trình duyệt; backend cần quyền database phù hợp
và lọc owner. Policy tồn tại không bị thay; kết nối owner/BYPASSRLS cần kiểm
tra quyền trong backend. SQL này chỉ chạy PostgreSQL, không dùng trực tiếp
với SQLite fallback.

Source engine.py và frontend dashboard hiện tại được giữ nguyên: vẫn truy
vấn accounts/pages/posting_history/proxies, chưa đọc bảng schema cũ. init_database()
chưa gọi schema dashboard. Khi tích hợp source sau cần models.py/init_models()
của dashboard và đăng ký ở core, đồng thời ánh xạ API/giao diện theo các chỉ số
trên. Dữ liệu auth/bản quyền được đọc từ module_auth. SQL không tạo endpoint,
worker quản lý tài khoản, worker tạo page hoặc chức năng ghi dữ liệu tự động.

Chưa kiểm thử thực thi PostgreSQL. Dữ liệu Facebook mã hóa theo HWID và
profile_path trên máy cũ cần xử lý riêng nếu chuyển bản ghi thực tế sau này.
