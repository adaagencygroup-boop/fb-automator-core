# Deploy VPS

VPS chạy PostgreSQL, pgAdmin, trang admin và API `local_engine`. API này không mở Chrome.

File `.exe` trên máy người dùng vẫn gồm giao diện user và một `local_engine` riêng để mở Chrome. Engine đó chỉ đổi `DATABASE_URL` để ghi vào Postgres của VPS.

## DNS

Trỏ 3 bản ghi A về IP VPS:

- `admin.example.com`
- `api.example.com`
- `pgadmin.example.com`

## Chạy

```bash
cd deploy
cp .env.example .env
# sửa mật khẩu và tên miền trong .env
docker compose up -d --build
```

Lần đầu engine có thể mất vài phút để tạo bảng. Xem log:

```bash
docker compose logs -f engine
```

Khi log có `Auth ready` hoặc `Backend ready`, mở:

- Trang admin: `http://admin.example.com`
- API: `http://api.example.com/api/health`
- pgAdmin: `http://pgadmin.example.com`

Trong pgAdmin, host database là `postgres`, port `5432`, đúng user và database trong `.env`. Không điền IP VPS, vì pgAdmin đang ở trong cùng mạng Docker.

## File .exe

Trong `.env` đóng gói cùng bản `.exe`, đặt:

```text
DATABASE_URL=postgresql://fbautomator:MAT_KHAU@IP_VPS:5432/fb_automator
```

Giữ `NEXT_PUBLIC_API_URL=http://127.0.0.1:28129`. Giao diện user nói chuyện với engine trên chính máy đó. Chỉ database là ở VPS.

Mở cổng `5432` cho máy được phép dùng app. Không để `5432` mở toàn bộ internet nếu không cần.

## Khóa user

Admin đăng nhập trang trên VPS và khóa tài khoản. Engine VPS ghi trạng thái vào Postgres và hủy phiên. Lần gọi API sau, engine trong file `.exe` đọc cùng bảng và từ chối đăng nhập.

## Đổi tên miền hoặc sang HTTPS

`PUBLIC_API_URL` được gắn lúc build trang admin. Sau khi sửa URL trong `.env`:

```bash
docker compose up -d --build admin
```

HTTPS làm trên Nginx sau, khi đã có certificate. Cấu hình hiện tại lắng nghe cổng 80.
