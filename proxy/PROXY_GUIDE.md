# Hướng dẫn gán proxy cho tài khoản

Tài liệu này áp dụng cho chức năng import và mở Chrome profile trong
SocialFarmTool.

## 1. Định dạng proxy được hỗ trợ

Định dạng khuyến nghị là một proxy trên một dòng:

```text
HOST:PORT:USERNAME:PASSWORD
```

Ví dụ giả lập:

```text
103.82.193.117:23429:proxy_user:proxy_password
```

Proxy không có tài khoản/mật khẩu có thể nhập:

```text
103.82.193.117:23429
```

Cũng có thể dùng URL đầy đủ:

```text
http://proxy_user:proxy_password@103.82.193.117:23429
```

Không nhập thêm khoảng trắng ở đầu/cuối dòng. Launcher hiện tại không nhận
proxy SOCKS; hãy dùng HTTP/HTTPS proxy.

Nếu username hoặc password có ký tự `@`, `:`, `#` hoặc ký tự đặc biệt, nên dùng
URL đầy đủ và URL-encode phần username/password. Ví dụ ký tự `@` viết thành
`%40`.

## 2. Gán proxy hàng loạt khi import

1. Mở tool và chọn **Import List**.
2. Dán danh sách tài khoản vào ô **Danh sách Facebook**.
3. Dán danh sách proxy vào ô **Danh sách Proxy**.
4. Kiểm tra hai danh sách có cùng thứ tự.
5. Bấm **OK** để import.

Tool gán theo vị trí dòng:

| Tài khoản | Proxy được gán |
|---|---|
| Dòng 1 | Proxy dòng 1 |
| Dòng 2 | Proxy dòng 2 |
| Dòng 3 | Proxy dòng 3 |

Ví dụ:

```text
Danh sách tài khoản:
61570000000001|Nick 01|||||||FacebookPass01
61570000000002|Nick 02|||||||FacebookPass02
61570000000003|Nick 03|||||||FacebookPass03
```

```text
Danh sách proxy:
103.82.193.117:23429:user01:pass01
103.82.193.117:23430:user02:pass02
103.82.193.117:23431:user03:pass03
```

Proxy thứ nhất sẽ gán cho tài khoản thứ nhất, proxy thứ hai cho tài khoản thứ
hai, v.v. Nếu số proxy ít hơn số tài khoản, các tài khoản còn lại sẽ không
được gán proxy mới. Proxy dư sẽ không được sử dụng.

## 3. Gán hoặc sửa proxy cho một tài khoản

Nếu tài khoản đã có trong bảng:

1. Chọn dòng tài khoản.
2. Bấm **Sửa**.
3. Nhập proxy vào ô **Proxy**.
4. Bấm **OK** và lưu dữ liệu.

Có thể kiểm tra cột **Proxy** trong bảng để chắc chắn proxy đã nằm đúng dòng.

## 4. Tool xử lý proxy như thế nào

Khi mở profile có proxy, tool thực hiện theo thứ tự:

1. Phân tích chuỗi proxy.
2. Kiểm tra kết nối HTTP và HTTPS.
3. Với proxy có username/password, khởi tạo bridge proxy nội bộ trên
   `127.0.0.1` để chuyển tiếp xác thực lên proxy thật.
4. Khởi chạy Chrome qua bridge hoặc trực tiếp qua proxy không xác thực.
5. Mở một tab kiểm tra IP bằng chính Chrome đó.
6. Nếu Chrome đang dùng IP trực tiếp của máy, profile sẽ dừng và báo lỗi.

Proxy lỗi sẽ không bị âm thầm chuyển sang IP máy.

## 5. Cách xác nhận proxy hoạt động

Mở đúng Chrome profile cần kiểm tra và truy cập:

```text
https://api.ipify.org
```

Hoặc:

```text
https://httpbin.org/ip
```

IP hiển thị ở đây là IP public/exit mà website như Facebook nhìn thấy.

Không dùng các địa chỉ trong `ipconfig` để đối chiếu. Các địa chỉ như
`192.168.x.x`, `172.16.x.x` hoặc `169.254.x.x` là địa chỉ nội bộ trên máy.

### Phân biệt proxy endpoint và IP exit

Ví dụ:

```text
Proxy endpoint: 103.82.193.117:23429
IP exit trên api.ipify.org: 160.22.175.231
```

Trường hợp này vẫn có thể là proxy hoạt động bình thường. `103.82.193.117`
là máy chủ proxy mà tool kết nối tới; `160.22.175.231` là IP đầu ra mà
Facebook nhìn thấy.

## 6. Dấu hiệu thành công trong log

Log đúng thường có các dòng tương tự:

```text
Testing proxy connectivity: http://HOST:PORT
HTTP test successful!
HTTPS test successful!
All tests passed! Proxy supports both HTTP and HTTPS
Chrome egress IP: x.x.x.x
```

Các thông báo sau là lỗi:

```text
Invalid or unsupported proxy format
Proxy connectivity test failed
Chrome is using the direct machine IP
```

Khi gặp lỗi, kiểm tra lại host, port, username, password và quyền truy cập
HTTPS của proxy.

## 7. Các lỗi thường gặp

### Cột Proxy bị trống

Nguyên nhân thường là số dòng proxy ít hơn số dòng tài khoản hoặc proxy được
dán sai ô. Import lại với hai danh sách đúng thứ tự.

### Chrome mở nhưng không vào được website

Proxy có thể đã hết hạn, sai mật khẩu, bị giới hạn IP nguồn hoặc không hỗ trợ
HTTPS. Kiểm tra bằng cả `api.ipify.org` và `httpbin.org/ip`.

### IP hiển thị không giống host proxy

Không nhất thiết là lỗi. Hãy so sánh với IP exit do nhà cung cấp proxy công bố,
không chỉ so sánh với host trong chuỗi `HOST:PORT`.

### Profile đang mở từ trước

Đóng hoàn toàn Chrome profile đó rồi mở lại từ tool. Một tiến trình Chrome cũ
có thể giữ cấu hình mạng của lần khởi chạy trước.

## 8. Lưu ý bảo mật

Proxy thường chứa username/password. Không chia sẻ ảnh chụp bảng tài khoản,
file dữ liệu hoặc log có thông tin đăng nhập. Khi gửi lỗi, hãy che phần
username/password và chỉ giữ lại dạng:

```text
HOST:PORT:******:******
```
