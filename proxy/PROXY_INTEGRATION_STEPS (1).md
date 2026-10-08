# Các bước tích hợp cơ chế gán proxy vào dự án khác

Tài liệu này mô tả cách mang cơ chế proxy của SocialFarmTool sang một dự án
Python/Selenium hoặc công cụ tự động trình duyệt khác.

Mục tiêu:

- Mỗi profile/tài khoản có một proxy riêng.
- Hỗ trợ proxy có hoặc không có username/password.
- Chrome dùng đúng proxy cho HTTP và HTTPS.
- Proxy lỗi phải dừng profile, không âm thầm chuyển sang IP thật.
- Có thể xác nhận IP public ngay trong chính Chrome.

## 1. Chuẩn hóa dữ liệu đầu vào

Mỗi tài khoản hoặc profile cần có trường `proxy` riêng:

```json
{
  "id": "account-001",
  "name": "Profile 001",
  "proxy": "HOST:PORT:USERNAME:PASSWORD"
}
```

Các định dạng nên hỗ trợ:

```text
HOST:PORT:USERNAME:PASSWORD
HOST:PORT
http://USERNAME:PASSWORD@HOST:PORT
```

Với username/password chứa `@`, `:`, `#` hoặc ký tự đặc biệt, phải URL-encode
phần thông tin xác thực khi dùng URL đầy đủ. Không ghi mật khẩu thật vào log.

Nếu dự án chỉ cần HTTP proxy thì từ chối SOCKS ngay ở bước parse hoặc triển
khai thêm một adapter SOCKS riêng. Không nên giả định SOCKS là HTTP.

## 2. Viết hàm parse proxy

Hàm parse nên trả về cấu trúc thống nhất:

```python
{
    "scheme": "http",
    "host": "HOST",
    "port": 12345,
    "username": "USERNAME",
    "password": "PASSWORD",
    "server": "http://HOST:12345",
}
```

Các bước kiểm tra:

1. Xóa khoảng trắng đầu/cuối.
2. Nhận diện URL đầy đủ hoặc dạng `host:port:user:pass`.
3. Kiểm tra host không rỗng.
4. Kiểm tra port là số từ 1 đến 65535.
5. Giải mã URL-encoding của username/password.
6. Nếu sai định dạng, trả lỗi rõ ràng và không mở browser.

## 3. Kiểm tra proxy trước khi mở Chrome

Dùng HTTP client độc lập để kiểm tra cả HTTP và HTTPS qua proxy:

```python
proxy_url = "http://user:password@host:port"
proxy_handler = urllib.request.ProxyHandler({
    "http": proxy_url,
    "https": proxy_url,
})
opener = urllib.request.build_opener(proxy_handler)

opener.open("http://httpbin.org/ip", timeout=15)
opener.open("https://httpbin.org/ip", timeout=15)
```

Chỉ tiếp tục mở Chrome khi cả hai bài test thành công. Nếu thất bại, ghi trạng
thái `Proxy error` cho profile đó.

Không dùng logic kiểu `proxy_test_failed -> mở Chrome không proxy`. Logic đúng
là `proxy_test_failed -> dừng profile và báo lỗi`.

## 4. Xử lý proxy có username/password

Chrome không xử lý ổn định username/password chỉ bằng tham số
`--proxy-server`. Dự án mới nên dùng một bridge proxy nội bộ:

```text
Chrome -> 127.0.0.1:PORT_NỘI_BỘ -> HOST:PORT_PROXY_THẬT
```

Bridge cần thực hiện các việc sau:

### Với request HTTP

1. Nhận request từ Chrome.
2. Kết nối tới proxy thật.
3. Thêm header `Proxy-Authorization: Basic BASE64(USERNAME:PASSWORD)`.
4. Chuyển request qua proxy thật.
5. Chuyển response ngược về Chrome.

### Với request HTTPS

1. Chrome gửi `CONNECT host:443` tới bridge.
2. Bridge kết nối tới proxy thật.
3. Bridge gửi tiếp `CONNECT host:443` kèm `Proxy-Authorization`.
4. Khi proxy thật trả HTTP 200, bridge trả `200 Connection Established` cho
   Chrome.
5. Relay dữ liệu hai chiều giữa Chrome và proxy thật.

Bridge chỉ nên bind vào `127.0.0.1`, dùng port ngẫu nhiên và chạy bằng thread
daemon hoặc service riêng. Không bind bridge ra `0.0.0.0`.

Trong dự án hiện tại, phần này nằm ở:

```text
D:\Downloads\SocialFarmTool\browser\proxy_bridge.py
```

## 5. Khởi chạy Chrome qua proxy

### Proxy có xác thực

1. Parse proxy.
2. Test proxy.
3. Start bridge nội bộ.
4. Lấy địa chỉ `127.0.0.1:port_bridge`.
5. Thêm vào Chrome:

```text
--proxy-server=http://127.0.0.1:port_bridge
```

### Proxy không có xác thực

Có thể truyền trực tiếp:

```text
--proxy-server=http://HOST:PORT
```

Không nên dựa vào extension nạp bằng `--load-extension` cho Chrome bản chính
thức mới. Bridge nội bộ ít phụ thuộc vào phiên bản Chrome hơn.

## 6. Kiểm tra IP trong chính Chrome

Sau khi driver khởi tạo, tạo một tab kiểm tra riêng và truy cập:

```text
https://httpbin.org/ip
```

Hoặc:

```text
https://api.ipify.org
```

Đọc IP từ nội dung trang rồi đóng tab kiểm tra.

Nên lấy thêm IP direct của máy bằng request không dùng proxy. Nếu IP trong
Chrome trùng IP direct thì coi như proxy chưa được áp dụng:

```text
Chrome IP == Direct IP -> dừng profile
Chrome IP != Direct IP  -> proxy đang được áp dụng
```

Không so sánh IP exit với `HOST` trong chuỗi proxy một cách máy móc. Proxy
endpoint và IP exit có thể khác nhau:

```text
Proxy endpoint: HOST:PORT
IP website nhìn thấy: EXIT_IP
```

## 7. Quản lý vòng đời bridge

Bridge phải được đóng trong tất cả trường hợp:

- Người dùng đóng profile.
- Driver khởi tạo thất bại.
- Kiểm tra IP thất bại.
- Login hoặc tác vụ kết thúc.
- Retry khởi tạo lần cuối cũng thất bại.

Nên bọc `driver.quit()` để tự gọi `bridge.close()`:

```python
original_quit = driver.quit

def quit_with_bridge(*args, **kwargs):
    try:
        return original_quit(*args, **kwargs)
    finally:
        bridge.close()

driver.quit = quit_with_bridge
```

`bridge.close()` phải an toàn khi được gọi nhiều lần.

## 8. Gán proxy khi import hàng loạt

Nếu người dùng nhập danh sách tài khoản và danh sách proxy riêng, gán theo chỉ
số dòng:

```python
for index, account in enumerate(accounts):
    account["proxy"] = proxies[index] if index < len(proxies) else ""
```

Quy tắc giao diện cần hiển thị rõ:

- Tài khoản dòng 1 nhận proxy dòng 1.
- Tài khoản dòng 2 nhận proxy dòng 2.
- Proxy dư không được dùng.
- Tài khoản không có proxy phải báo `No proxy`.

Sau khi import, hiển thị proxy đã gán trong bảng để người dùng đối chiếu.

## 9. Trạng thái nên có trong giao diện

Nên tách trạng thái profile và trạng thái proxy:

```text
Proxy: Chưa kiểm tra
Proxy: Đang kiểm tra
Proxy: Kết nối thành công
Proxy: Sai định dạng
Proxy: Không kết nối được
Proxy: Chrome đang dùng IP direct
```

Nếu có thể, lưu thêm `proxy_exit_ip` sau khi Chrome kiểm tra thành công. Không
lưu username/password vào cột trạng thái hoặc log.

## 10. Bộ test bắt buộc

Trước khi đưa vào chạy hàng loạt, kiểm tra tối thiểu:

1. Parse đúng `host:port:user:pass`.
2. Parse đúng `host:port`.
3. Từ chối port không hợp lệ.
4. HTTP request qua bridge thành công.
5. HTTPS CONNECT qua bridge thành công.
6. Chrome thật trả về IP exit của proxy.
7. Proxy sai mật khẩu bị báo lỗi.
8. Proxy timeout không làm Chrome chạy bằng IP direct.
9. `driver.quit()` giải phóng port bridge.
10. Hai profile chạy đồng thời không dùng nhầm bridge của nhau.

## 11. Luồng tổng quát

```text
Import account + proxy
        |
        v
Parse và validate proxy
        |
        v
Test HTTP + HTTPS
        |
   thất bại -----> Báo lỗi, không mở Chrome
        |
        v
Start bridge nếu proxy có auth
        |
        v
Start Chrome với --proxy-server
        |
        v
Kiểm tra IP bằng chính Chrome
        |
   trùng IP direct -> Đóng profile, báo lỗi
        |
        v
Đánh dấu proxy OK và chạy tác vụ
        |
        v
Đóng Chrome + đóng bridge
```

## 12. File tham khảo trong SocialFarmTool

- [browser/chrome_launcher.py](D:/Downloads/SocialFarmTool/browser/chrome_launcher.py)
- [browser/proxy_bridge.py](D:/Downloads/SocialFarmTool/browser/proxy_bridge.py)
- [PROXY_GUIDE.md](D:/Downloads/SocialFarmTool/PROXY_GUIDE.md)
