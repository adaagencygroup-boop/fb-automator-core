# MODULE 01 – DASHBOARD

## 1. Tổng quan module

### 1.1. Mục đích

Dashboard là màn hình trung tâm của người dùng, cung cấp cho người dùng cái nhìn tổng quan về:

- Tình trạng các Account.
- Số lượng Page đang quản lý.
- Thời hạn License.

Dashboard chủ yếu có vai trò monitoring và điều hướng, không trực tiếp thay thế chức năng nghiệp vụ của các module M02–M10.

### 1.2. Actor

| Actor | Vai trò |
|---|---|
| Người dùng | Người dùng đăng nhập Desktop App. Mở Dashboard để theo dõi sức khỏe dàn nick, quy mô Fanpage và nắm bắt thời hạn License để chủ động gia hạn phần mềm. |
| Hệ thống | Bao gồm tiến trình tự động hóa chạy ngầm tại máy trạm và dịch vụ xác thực bản quyền VPS Server. Tự động truy vấn, tính toán số liệu real-time về Account, Fanpage, mã HWID và đối soát đếm ngược thời hạn License. |

## 2. Cấu trúc màn hình

### Khu vực 1: Thanh trạng thái License & Xác thực HWID (License Bar)

- **Thông tin Bản quyền (License Status Badge):** Hiển thị trạng thái tài khoản (Đang hoạt động / chờ duyệt / Hết hạn).
- **Đồng hồ đếm ngược Thời hạn:** Hiển thị tổng số ngày sử dụng còn lại (Ví dụ: Còn 162 ngày - đếm ngược thời gian thực từ Hệ thống).
- **Cảnh báo hết hạn (Expiration Alert):**
  - Khi thời hạn còn > 7 ngày: Badge hiển thị màu xanh lá (Hoạt động).
  - Khi thời hạn còn ≤ 7 ngày: Badge đổi sang màu vàng/đỏ nhấp nháy, hiển thị dòng cảnh báo `"License sắp hết hạn"` kèm nút `[Gia hạn ngay]`.

### Khu vực 2: Khối Tình trạng các Account Facebook (Account Status Block)

- **Tổng số Account (Total Accounts Card):** Thống kê toàn bộ số lượng nick Facebook đã nạp vào Hệ thống.
- **Phân loại trạng thái Nick (State Badges):**
  - 🟢 **Live (Sống/Sẵn sàng):** Số lượng nick đã đăng nhập thành công, Cookie/Session còn khả dụng.
  - 🔴 **Die / Failed (Mất Session):** Số nick bị rớt đăng nhập hoặc đổi mật khẩu.
- **Tỷ lệ Khả dụng (% Availability Rate):** Chỉ số phần trăm đo lường độ an toàn dàn nick `((Số Nick Live / Tổng Nick) * 100%)`.
- **Nút điều hướng nhanh:** Bấm vào thẻ để chuyển thẳng tới màn hình Module 02 – Quản lý Account Facebook.

### Khu vực 3: Khối Số lượng Page đang Quản lý (Page Management Block)

- **Tổng số Fanpage (Total Pages Card):** Thống kê tổng số lượng Fanpage vệ tinh đang nằm trong danh sách quản lý của Hệ thống.
- **Phân loại chỉ số Page:**
  - Số Page đã khởi tạo thành công: Lịch sử số Page tạo tự động qua tool.
  - Số Page đã khởi tạo thất bại.
- **Nút điều hướng nhanh:** Bấm vào thẻ để chuyển thẳng tới màn hình Module 05 – Quản lý fanpage (Nuôi page / Post bài viết).

## 3. Danh sách Use Case

| UC ID | Tên Use Case |
|---|---|
| UC-M01-01 | Xem thời hạn bản quyền & Trạng thái mã máy |
| UC-M01-02 | Xem tổng quan tình trạng các tài khoản |
| UC-M01-03 | Xem tổng quan số lượng fanpage đang quản lý |
| UC-M01-04 | Làm mới & Đồng bộ dữ liệu dashboard |

## 4. Đặc tả Use Case

### UC-M01-01 – Xem thời hạn bản quyền và trạng thái mã máy

| Thành phần | Nội dung |
|---|---|
| **Mã Use Case** | UC-M01-01 |
| **Tên Use Case** | Xem thời hạn bản quyền và trạng thái mã máy |
| **Mục đích** | Cung cấp thông tin về tình trạng bản quyền phần mềm, mã định danh của máy trạm và số ngày sử dụng còn lại, giúp người dùng chủ động theo dõi và gia hạn bản quyền. |
| **Đối tượng thực hiện** | Người dùng, Hệ thống |
| **Điều kiện trước** | Người dùng đã đăng nhập thành công vào ứng dụng |
| **Điều kiện sau** | Hệ thống hiển thị chính xác trạng thái bản quyền, mã máy trạm và số ngày sử dụng còn lại. |
| **Luồng xử lý chính** | 1. Người dùng mở màn hình Trang tổng quan.<br>2. Hệ thống lấy thông tin bản quyền trong phiên làm việc và mã máy trạm được lưu trên máy.<br>3. Hệ thống xác định số ngày sử dụng còn lại dựa trên thời hạn bản quyền và ngày hiện tại.<br>4. Hệ thống hiển thị trạng thái bản quyền APPROVED và số ngày sử dụng còn lại trên thanh đầu trang. |
| **Luồng ngoại lệ** | Trường hợp số ngày sử dụng còn lại không quá 7 ngày: Hệ thống hiển thị thông báo “Bản quyền sắp hết hạn” và cung cấp nút [Liên hệ để gia hạn ngay]. |

### UC-M01-02 – Xem tổng quan tình trạng các tài khoản Facebook

| Thành phần | Nội dung |
|---|---|
| **Mã Use Case** | UC-M01-02 |
| **Tên Use Case** | Xem tổng quan tình trạng các tài khoản Facebook |
| **Mục đích** | Cung cấp thông tin tổng quan về số lượng và tình trạng của các tài khoản Facebook, bao gồm tài khoản đang hoạt động, tài khoản không hoạt động, kèm theo tỷ lệ tài khoản có thể sử dụng tại thời điểm hiện tại. |
| **Đối tượng thực hiện** | Người dùng, Hệ thống |
| **Điều kiện trước** | Đã có dữ liệu tài khoản Facebook được thêm vào phần mềm. |
| **Điều kiện sau** | Người dùng nắm được số lượng và tình trạng các tài khoản Facebook, từ đó xác định số tài khoản có thể sử dụng cho các chiến dịch tự động hóa. |
| **Luồng xử lý chính** | 1. Hệ thống thống kê dữ liệu tài khoản Facebook đã được lưu trên hệ thống.<br>2. Hệ thống xác định tổng số tài khoản.<br>3. Hệ thống xác định số tài khoản đang hoạt động.<br>4. Hệ thống xác định số tài khoản không hoạt động.<br>5. Hệ thống tính tỷ lệ tài khoản có thể sử dụng theo công thức: `(Số tài khoản đang hoạt động / Tổng số tài khoản) × 100%`.<br>6. Hệ thống hiển thị các chỉ số trên thẻ thông tin tài khoản, sử dụng màu sắc để phân biệt trạng thái: Xanh – Đang hoạt động; Đỏ – Không hoạt động.<br>7. Người dùng có thể chọn thẻ để chuyển nhanh đến Phân hệ Quản lý tài khoản Facebook. |
| **Luồng ngoại lệ** | Trường hợp chưa có tài khoản Facebook: Hệ thống hiển thị số lượng tài khoản bằng 0 và thông báo “Chưa có tài khoản Facebook” |

### UC-M01-03 – Xem tổng quan số lượng Fanpage đang quản lý

| Thành phần | Nội dung |
|---|---|
| **Mã Use Case** | UC-M01-03 |
| **Tên Use Case** | Xem tổng quan số lượng Fanpage đang quản lý |
| **Mục đích** | Cung cấp thông tin tổng quan về số lượng Fanpage đang được phần mềm quản lý và số lượng Fanpage đã được tạo, đồng thời phân quyền quản trị thành công. |
| **Đối tượng thực hiện** | Người dùng, Hệ thống |
| **Điều kiện trước** | Dữ liệu về quá trình tạo Fanpage đã được ghi nhận trên hệ thống. |
| **Điều kiện sau** | Người dùng nắm được tổng số Fanpage đang được quản lý và số Fanpage đã được phân quyền quản trị thành công. |
| **Luồng xử lý chính** | 1. Hệ thống thống kê dữ liệu Fanpage đã được ghi nhận trên hệ thống.<br>2. Hệ thống xác định tổng số Fanpage đang được quản lý và xác định số Fanpage đã tạo thành công và thất bại.<br>4. Hệ thống hiển thị các thông tin tổng quan trên thẻ thông tin Fanpage.<br>5. Người dùng có thể chọn thẻ để chuyển nhanh đến Phân hệ Quản lý Fanpage. |
| **Luồng ngoại lệ** | Trường hợp chưa có dữ liệu Fanpage: Hệ thống hiển thị số lượng Fanpage bằng 0 và thông báo “Chưa có Fanpage được quản lý”. |

### UC-M01-04 – Làm mới và đồng bộ dữ liệu Trang tổng quan

| Thành phần | Nội dung |
|---|---|
| **Mã Use Case** | UC-M01-04 |
| **Tên Use Case** | Làm mới và đồng bộ dữ liệu Trang tổng quan |
| **Mục đích** | Cho phép người dùng chủ động cập nhật lại dữ liệu trên Trang tổng quan, bao gồm thông tin tài khoản, Fanpage và tình trạng bản quyền, nhằm đảm bảo các chỉ số hiển thị là thông tin mới nhất. |
| **Đối tượng thực hiện** | Người dùng, Hệ thống |
| **Điều kiện trước** | Người dùng đang ở màn hình Trang tổng quan. |
| **Điều kiện sau** | Toàn bộ các chỉ số trên các thẻ thông tin được cập nhật theo dữ liệu mới nhất và chính xác. |
| **Luồng xử lý chính** | 1. Người dùng nhấn nút [Làm mới] trên thanh đầu trang.<br>2. Hệ thống lấy lại dữ liệu mới nhất từ cơ sở dữ liệu lưu trữ trên máy và kiểm tra lại tình trạng bản quyền với máy chủ.<br>3. Hệ thống cập nhật và tính toán lại các chỉ số liên quan đến tài khoản Facebook, Fanpage và thời hạn bản quyền.<br>4. Hệ thống cập nhật các thông tin mới lên Trang tổng quan. |
| **Luồng ngoại lệ** | Trường hợp không thể kết nối đến máy chủ: Hệ thống thông báo “Không thể đồng bộ dữ liệu. Vui lòng kiểm tra kết nối mạng và thử lại.” và giữ nguyên dữ liệu hiện tại trên Trang tổng quan. |

## 5. Business Rules

| Mã Rule | Tên quy tắc | Mô tả quy tắc nghiệp vụ |
|---|---|---|
| BR-M01-01 | Xác thực bản quyền License | Khi người dùng mở ứng dụng hoặc truy cập Dashboard, hệ thống tự động kiểm tra thông tin bản quyền, mã thiết bị và thời hạn sử dụng với máy chủ quản lý License. Nếu License đã hết hạn, hệ thống chuyển sang trạng thái Đã hết hạn, hiển thị cảnh báo và khóa các chức năng thực thi Automation. |
| BR-M01-02 | Cảnh báo License sắp hết hạn | Khi License còn trên 7 ngày, hệ thống hiển thị trạng thái bản quyền bình thường. Khi License còn 7 ngày hoặc ít hơn, hệ thống hiển thị cảnh báo “License của bạn sắp hết hạn” và cung cấp nút [Liên hệ để gia hạn ngay]. |
| BR-M01-03 | Tính toán tình trạng Account | Hệ thống tổng hợp dữ liệu Account để hiển thị các chỉ số: Tổng số Account, Account đang hoạt động, Account thất bại. Tỷ lệ khả dụng được tính bằng Số Account đang hoạt động / Tổng số Account × 100%. Nếu không có Account, tỷ lệ khả dụng hiển thị 0,0%. |
| BR-M01-04 | Tính toán tình trạng Fanpage | Hệ thống tổng hợp dữ liệu Fanpage để hiển thị: Tổng số Fanpage, Fanpage tạo thành công và Fanpage tạo thất bại. |
| BR-M01-05 | Đồng bộ và cập nhật dữ liệu Dashboard | Các chỉ số Account và Fanpage trên Dashboard được cập nhật khi dữ liệu thay đổi từ các chức năng khác như Import Nick, Đăng nhập tự động và Tạo Page. Khi người dùng nhấn [Tải lại], hệ thống thực hiện cập nhật lại dữ liệu và kiểm tra lại trạng thái License. |

## 6. Validation Rules

| Mã Rule | Tên ràng buộc | Điều kiện kiểm tra | Hành xử khi không hợp lệ |
|---|---|---|---|
| VR-M01-01 | Kiểm tra mã thiết bị | Mã thiết bị phải tồn tại và đúng định dạng do hệ thống quy định. | Nếu mã thiết bị bị thiếu hoặc không hợp lệ, hệ thống hiển thị thông báo lỗi và không cho phép khởi chạy ứng dụng. |
| VR-M01-02 | Kiểm tra kết nối máy chủ License | Hệ thống chờ phản hồi từ máy chủ License tối đa 5 giây. | Nếu không nhận được phản hồi trong 5 giây, hệ thống thông báo “Mất kết nối máy chủ” và chuyển sang chế độ ngoại tuyến. |
| VR-M01-03 | Giới hạn thao tác làm mới dữ liệu | Người dùng chỉ được thực hiện thao tác [Tải lại] sau tối thiểu 1 giây kể từ lần làm mới trước. | Trong thời gian chờ, nút [Tải lại /Đồng bộ] được tạm khóa và hiển thị biểu tượng đang xử lý để tránh thao tác liên tục. |
| VR-M01-04 | Kiểm tra định dạng số liệu thống kê | Các chỉ số số lượng phải là số nguyên không âm. Tỷ lệ khả dụng phải nằm trong khoảng 0,0% đến 100,0% và hiển thị 1 chữ số thập phân. | Nếu dữ liệu không có hoặc xảy ra lỗi khi lấy dữ liệu, hệ thống hiển thị giá trị mặc định 0 hoặc 0,0%, không để trống thông tin trên Dashboard. |

## 7. Status / State

### 7.1. Trạng thái bản quyền

| Trạng thái | Tên trạng thái | Điều kiện | Hiển thị |
|---|---|---|---|
| PENDING | Chờ phê duyệt | Tài khoản mới đăng ký và đang chờ quản trị viên phê duyệt. | Chờ xử lý |
| APPROVED | Đang hoạt động | License đã được phê duyệt và vẫn còn thời hạn sử dụng. | Xanh |
| REJECTED | Bị từ chối | Tài khoản mới đăng ký và bị quản trị viên từ chối. | Đỏ |
| EXPIRED | Đã hết hạn | License đã quá thời hạn sử dụng. | Đỏ |
| BANNED | Bị khóa | Tài khoản bị quản trị viên khóa theo chính sách hệ thống. | Đỏ |

### 7.2. Trạng thái tài khoản Facebook

| Trạng thái | Tên trạng thái | Điều kiện | Hiển thị |
|---|---|---|---|
| LIVE | Đang hoạt động | Account đăng nhập thành công và phiên đăng nhập vẫn còn hiệu lực. | Xanh |
| DIE | Thất bại / Mất phiên | Đăng nhập không thành công hoặc phiên đăng nhập không còn khả dụng. | Đỏ |

### 7.3. Trạng thái kết nối hệ thống

| Trạng thái | Tên trạng thái | Điều kiện | Hiển thị |
|---|---|---|---|
| CONNECTED | Đã kết nối | Hệ thống kết nối ổn định với máy chủ và bộ xử lý cục bộ. | Xanh |
| OFFLINE | Ngoại tuyến | Không thể kết nối với máy chủ. | Đỏ |

### 7.4. Luồng hệ thống

| Trạng thái hiện tại | Tác nhân & Sự kiện | Điều kiện kiểm tra | Trạng thái mới | Hành động của hệ thống |
|---|---|---|---|---|
| PENDING – Chờ phê duyệt | Hệ thống kiểm tra thông tin đăng nhập | Tài khoản đã được Admin phê duyệt trên máy chủ | APPROVED – Đang hoạt động | Mở khóa ứng dụng Desktop, lưu thông tin xác thực phiên làm việc và cho phép sử dụng đầy đủ các chức năng. |
| PENDING – Chờ phê duyệt | Hệ thống kiểm tra thông tin đăng nhập | Tài khoản đã bị Admin từ chối trên máy chủ | REJECTED – Bị từ chối | Từ chối đăng ký người dùng vì lý do gì đó |
| APPROVED – Đang hoạt động | Hệ thống thực hiện kiểm tra định kỳ hoặc người dùng làm mới dữ liệu | License đã hết thời hạn sử dụng | EXPIRED – Đã hết hạn | Khóa toàn bộ chức năng Automation; chuyển giao diện sang trạng thái thông báo hết hạn và hiển thị nút [Liên hệ để gia hạn]. |
| EXPIRED – Đã hết hạn | End-User gia hạn License thành công | Thời hạn sử dụng mới đã được Admin cập nhật và License còn hiệu lực | APPROVED – Đang hoạt động | Mở khóa lại các chức năng của ứng dụng và cập nhật thời hạn sử dụng mới trên Dashboard. |
| Bất kỳ trạng thái nào | Admin thực hiện khóa tài khoản | Tài khoản được Admin chuyển sang trạng thái Bị khóa | BANNED – Bị khóa | Đăng xuất người dùng, kết thúc phiên làm việc và hiển thị thông báo “Tài khoản đã bị khóa”. |

## 8. Permission

### 8.1. Ma trận phân quyền chức năng

| Chức năng / Hành động | License đang hoạt động | License đã hết hạn | Hệ thống |
|---|---|---|---|
| Xem trạng thái License và thời hạn sử dụng | 🟢 Cho phép | 🟢 Cho phép | 🟢 Cập nhật và cung cấp thông tin |
| Xem và sao chép mã thiết bị | 🟢 Cho phép | 🟢 Cho phép | 🟢 Cung cấp thông tin |
| Xem thống kê Account | 🟢 Cho phép | 🟢 Chỉ xem | 🟢 Tổng hợp và cập nhật số liệu |
| Xem thống kê Fanpage | 🟢 Cho phép | 🟢 Chỉ xem | 🟢 Tổng hợp và cập nhật số liệu |
| Làm mới dữ liệu | 🟢 Cho phép | 🟢 Cho phép | 🟢 Thực hiện cập nhật dữ liệu |
| Điều hướng đến các module khác | 🟢 Cho phép | 🔴 Không cho phép | — |
| Thực hiện gia hạn License | 🟢 Cho phép | 🟢 Cho phép | 🟢 Tiếp nhận và cập nhật thông tin |

> **Lưu ý:** Dashboard chỉ cho phép người dùng xem thông tin. Người dùng không được thay đổi trực tiếp các số liệu thống kê trên Dashboard.

### 8.2. Quy tắc giới hạn quyền truy cập

#### a. Khi License hết hạn hoặc tài khoản bị khóa

Người dùng vẫn được truy cập Dashboard để xem:

- Trạng thái License.
- Thời hạn sử dụng hoặc thời gian đã hết hạn.
- Mã thiết bị.
- Các số liệu đã được hệ thống ghi nhận.

Các chức năng thực hiện nghiệp vụ sẽ bị khóa.

Các mục điều hướng đến những module cần License hợp lệ sẽ được khóa hoặc làm mờ.

Người dùng vẫn có thể sử dụng chức năng Gia hạn License.

#### b. Quy tắc đối với dữ liệu trên Dashboard

Dashboard chỉ có chức năng hiển thị thông tin và thống kê.

Người dùng không được chỉnh sửa trực tiếp.

Dữ liệu trên Dashboard được cập nhật thông qua:

- Các thao tác phát sinh từ những module nghiệp vụ khác.
- Hệ thống tự động cập nhật dữ liệu.

### 8.3. Quy tắc theo trạng thái License

| Trạng thái License | Xem Dashboard | Xem dữ liệu | Làm mới dữ liệu | Sử dụng module nghiệp vụ | Gia hạn |
|---|---:|---:|---:|---:|---:|
| Đang hoạt động | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| Chờ phê duyệt | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Đã hết hạn | 🟢 | 🟢 | 🔴 | 🔴 | 🟢 |
| Bị khóa | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |

## 9. Acceptance Criteria

| Mã AC | Kịch bản | GIVEN – Cho trước | WHEN – Khi | THEN – Thì |
|---|---|---|---|---|
| AC-M01-01.1 | Hiển thị thông tin License hợp lệ | Người dùng mở ứng dụng và truy cập Dashboard. VD License còn 150 ngày sử dụng. | Hệ thống hoàn tất việc kiểm tra thông tin bản quyền và mã thiết bị. | - Trạng thái License hiển thị “Đang hoạt động” với màu xanh.<br>- Hiển thị “Còn 150 ngày”.<br>- Mã thiết bị được hiển thị trên Dashboard. |
| AC-M01-01.2 | Sao chép mã thiết bị | Người dùng đang ở Dashboard và mã thiết bị đang được hiển thị. | Người dùng nhấn biểu tượng [Sao chép] bên cạnh mã thiết bị. | - Toàn bộ mã thiết bị được sao chép vào bộ nhớ tạm của máy tính.<br>- Hiển thị thông báo “Đã sao chép mã thiết bị”. |
| AC-M01-02.1 | Cảnh báo License sắp hết hạn | Người dùng đang ở Dashboard. License còn 5 ngày sử dụng. | Hệ thống kiểm tra thời hạn License. | - Hiển thị “License của bạn sắp hết hạn (Còn 5 ngày)”.<br>- Hiển thị nút [Liên hệ để gia hạn ngay]. |
| AC-M01-02.2 | Khóa chức năng khi License hết hạn | License của tài khoản đã hết thời hạn sử dụng. | Người dùng mở ứng dụng hoặc truy cập Dashboard. | - Trạng thái License hiển thị “Đã hết hạn” với màu đỏ.<br>- Các chức năng điều hướng đến module yêu cầu License hợp lệ bị khóa.<br>- Hiển thị “License của bạn đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.”<br>- Nút [Liên hệ để gia hạn ngay] vẫn được phép sử dụng. |
| AC-M01-03.1 | Hiển thị chính xác số lượng và tỷ lệ Account | Dữ liệu hiện có: 100 Account, trong đó 70 đang hoạt động, 20 thất bại. | Người dùng mở Dashboard. | - Tổng số Account: 100.<br>- Đang hoạt động: 70.<br>- Thất bại: 20.<br>- Tỷ lệ khả dụng: 70,0%. |
| AC-M01-03.2 | Điều hướng từ thống kê Account | Người dùng đang xem Dashboard và thẻ Tổng số Account được hiển thị. | Người dùng nhấn vào thẻ Tổng số Account. | Hệ thống chuyển người dùng đến Module 02 – Quản lý Account Facebook. |
| AC-M01-04.1 | Hiển thị tổng số Fanpage | Hệ thống đang có 50 Fanpage đã được tạo. | Dashboard hoàn tất cập nhật dữ liệu. | - Thẻ Tổng số Fanpage hiển thị 50.<br>- Khi nhấn vào thẻ, hệ thống chuyển đến Module …– Quản lý fanpage |
| AC-M01-05.1 | Làm mới dữ liệu thành công | Người dùng vừa thêm Account mới tại Module 02 và quay lại Dashboard. | Người dùng nhấn [Làm mới]. | - Nút Refresh mờ đi.<br>- Hệ thống cập nhật lại dữ liệu.<br>- Các chỉ số trên Dashboard được cập nhật theo dữ liệu mới |
| AC-M01-05.2 | Ngăn thao tác Refresh liên tục | Người dùng vừa thực hiện [Làm mới]. | Người dùng tiếp tục nhấn [Làm mới] trong vòng 1 giây. | - Nút [Làm mới] tạm thời không thể nhấn.<br>- Hệ thống không thực hiện thêm lần cập nhật nào trong thời gian này.<br>- Sau 1 giây, nút [Làm mới] hoạt động trở lại. |
| AC-M01-06.1 | Nhận thông báo cảnh báo từ hệ thống | Người dùng đang mở ứng dụng. | Hệ thống nhận được thông báo “Cảnh báo bão Facebook - Hạn chế chạy tác vụ” từ máy chủ. | - Thông báo xuất hiện tại Trung tâm cảnh báo trên Dashboard.<br>- Thông báo được hiển thị với màu cảnh báo phù hợp.<br>- Hệ thống hiển thị hiệu ứng thông báo để người dùng nhận biết. |
| AC-M01-06.2 | Xử lý khi mất kết nối máy chủ | Máy tính của người dùng mất kết nối Internet. | Hệ thống thực hiện kiểm tra kết nối đến máy chủ. | - Trạng thái kết nối hiển thị “Ngoại tuyến”.<br>- Hiển thị “Mất kết nối với máy chủ xác thực. Ứng dụng đang ở chế độ ngoại tuyến.”<br>- Các chức năng yêu cầu kết nối máy chủ không được thực hiện cho đến khi kết nối được khôi phục. |

---

## Ghi chú nguồn

Tài liệu Markdown này được chuyển đổi từ file văn bản gốc. Bản gốc có một phần MODULE 01 bị lặp lại lần thứ hai và có các comment nội bộ `[LTCL1]`, `[NP2]`, `[LTCL3]`; phần lặp đã được loại bỏ để tránh Codex đọc cùng một đặc tả hai lần.
