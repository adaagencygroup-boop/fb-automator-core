# Đăng nhập và đăng ký người dùng

Giao diện auth dùng tông sáng theo ảnh tham chiếu: nền trắng, hero `#eef3ff`,
ô nhập `#eff3ff`, nút chính `#245ff4`. `AuthLayout` bố trí hero bên trái và
form bên phải trên desktop, chuyển thành một cột trên mobile. Các class
`auth-entry-*`/`auth-form-*` trong globals.css định nghĩa bố cục và kiểu chữ.
`AuthFeedback` dùng nền trắng, viền và dải màu theo loại thông báo; lỗi đăng
nhập, HWID và hết hạn bản quyền hiển thị màu đỏ như ảnh mẫu. Modal hỗ trợ,
trang chờ duyệt, bị khóa và từ chối cũng sử dụng bề mặt sáng.

`LoginScreen.jsx` tái sử dụng bố cục và thành phần của màn hình đăng nhập
`desktop-client-app/src-ui/src/app/(auth)/login` trong dự án cũ, chuyển sang
JSX, Tailwind 3 và font hiện có của Facebook Automator. `AuthGate` chịu trách
nhiệm kiểm tra phiên, vào workspace và đăng xuất. Module này không phải tab
nghiệp vụ nên không đưa vào registry 9 module.

Luồng đăng nhập gọi `POST /api/v1/auth/login` bằng JSON qua Axios dùng chung.
FastAPI lấy HWID trên máy chạy engine, kiểm tra tài khoản, mật khẩu, trạng
thái và bản quyền, sau đó cấp access/refresh cookie HttpOnly. Không lưu JWT
hoặc mật khẩu vào localStorage. Đăng nhập mới thu hồi phiên user trước đó.

Ghi nhớ đăng nhập lưu username và refresh cookie tối đa 30 ngày; khi không
chọn, cả hai cookie là cookie phiên trình duyệt. Refresh giữ nguyên lựa chọn
này. Access token hết hạn sau 15 phút trong cả hai trường hợp.

Các lỗi tài khoản không tồn tại/sai mật khẩu hiển thị cạnh ô nhập và thông
báo. Pending/rejected/banned/locked/HWID mismatch chuyển sang màn hình trạng
thái. Tài khoản hết hạn vẫn vào workspace, các module tiếp tục bị khóa bởi
backend. Popup quên mật khẩu giữ luồng liên hệ admin của dự án cũ, không
thêm OTP hoặc API reset tự động. Các link hỗ trợ hiện giữ địa chỉ mẫu của
dự án cũ.

`RegisterScreen.jsx` và `components/RegisterForm.jsx` chuyển giao diện đăng
ký cũ sang JSX, dùng chung header/hero và thông báo với đăng nhập. Form có
xác nhận mật khẩu, hiện/ẩn cả hai mật khẩu, số điện thoại, sao chép HWID,
đồng ý điều khoản và kiểm tra lỗi ngay khi nhập.

Đăng ký gọi `POST /api/v1/auth/register`. Username gồm chữ/số, bắt đầu bằng
chữ và dài 3–25 ký tự. Mật khẩu từ 8–12 ký tự, có chữ hoa, chữ thường, số
và ký tự đặc biệt, theo đúng quy tắc đăng ký của dự án cũ. Số điện thoại gồm
10 chữ số và bắt đầu bằng 0. Xác nhận mật khẩu và đồng ý điều khoản được
kiểm tra trên form như dự án cũ; không gửi các trường này vào API.

Engine dùng HWID của máy chạy backend. Tài khoản mới luôn là `user/pending`,
mật khẩu được hash bằng bcrypt. Tạo user và thông báo `NEW_REGISTRATION`
cho admin trong cùng transaction PostgreSQL; tên trùng trả HTTP 409, kể cả
khi hai yêu cầu đăng ký cùng lúc. Đăng ký không cấp phiên đăng nhập. Sau
thông báo thành công, lưu `pending_username` và chuyển sang màn hình chờ duyệt.

`PendingScreen.jsx` dùng đầy đủ tiêu đề, hai thẻ Zalo/Telegram và thanh hành
động dưới cùng của trang chờ duyệt cũ. Thông tin hotline, Telegram và SVG
QR minh họa giữ theo nguồn cũ. Hai nút sao chép và link liên hệ hoạt động;
footer hỗ trợ quay lại đăng nhập và làm mới trạng thái.

Sau đăng ký hoặc đăng nhập đúng mật khẩu với tài khoản pending, API cấp
cookie HttpOnly `fb_registration` có hiệu lực một ngày, chỉ để kiểm tra
trạng thái tài khoản trên máy hiện tại. `GET /api/v1/auth/registration-status`
không cho truy vấn tài khoản chỉ bằng username và chỉ trả username/status.
Token đăng ký không được sử dụng để xác thực workspace hay refresh access.

Trang tự kiểm tra trạng thái mỗi 5 giây và hỗ trợ kiểm tra thủ công. Khi
admin duyệt, thông báo rồi quay lại đăng nhập; khi từ chối/khóa, chuyển sang
màn hình tương ứng. Reload trình duyệt khôi phục trang pending khi cookie
còn hợp lệ và `pending_username` vẫn được lưu. Nút quay lại đăng nhập xóa
dấu khôi phục này. Không tự cấp quyền workspace khi đang chờ duyệt.

`LockScreen.jsx` dùng bố cục trang khóa tài khoản cũ: biểu tượng khóa, badge
đỏ, hai thẻ hỗ trợ và `LockFooter` với trạng thái màu đỏ. Thẻ hỗ trợ của
trang khóa và chờ duyệt trong nguồn cũ giống nhau, nên dùng chung component.
Trang này xử lý cả banned/locked và HWID mismatch, hỗ trợ sao chép liên hệ,
làm mới, tự kiểm tra mỗi 5 giây và khôi phục sau reload.

Đăng nhập đúng mật khẩu nhưng bị khóa hoặc không khớp HWID cũng cấp cookie
chỉ để đọc trạng thái. Khi người dùng bị khóa giữa phiên, endpoint trạng
thái có thể dùng refresh cookie còn chữ ký/thời hạn hợp lệ để đọc đúng tài
khoản, dù phiên workspace đã bị thu hồi; không cấp access hay mở module.
Nếu HWID chưa được đặt lại, trạng thái approved vẫn giữ màn hình khóa.
Khi admin mở khóa, thông báo rồi quay lại đăng nhập; khi chuyển về pending,
chuyển sang trang chờ duyệt.

SSE `/api/v1/admin/notifications/stream` gửi sự kiện đăng ký sau khi commit,
cho admin đã xác thực. Web-admin gửi cookie với request/API/EventSource và
cập nhật danh sách user khi nhận sự kiện. Event bus nằm trong một tiến trình
engine; thông báo đã lưu vẫn có thể đọc lại qua API khi kết nối bị gián đoạn.

Kiểm tra từ thư mục gốc:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_auth_*.py' -v
Push-Location frontend
npm.cmd exec -- eslint src/modules/module_auth src/components/AuthGate.jsx src/services/api.js
Pop-Location
```

Kiểm tra trình duyệt dùng Playwright với Microsoft Edge có sẵn, không gọi
database thật: chạy frontend tại cổng 3020, rồi chạy
`.\.venv\Scripts\python.exe scripts/check_login_ui.py` và
`.\.venv\Scripts\python.exe scripts/check_register_ui.py`.
Kiểm tra màn hình chờ duyệt bằng
`.\.venv\Scripts\python.exe scripts/check_pending_ui.py`; có thể truyền URL
frontend đang chạy làm đối số, ví dụ `http://127.0.0.1:3000`.
Kiểm tra trang khóa bằng
`.\.venv\Scripts\python.exe scripts/check_locked_ui.py http://127.0.0.1:3000`.
