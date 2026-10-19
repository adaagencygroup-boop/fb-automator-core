Module 5: Quản lý Fanpage
5.1. Phân rã chức năng  
STT
Nhóm chức năng
Ghi chú
1
Danh sách Page
Hệ thống hiển thị danh sách các Fanpage đang được quản lý dưới dạng bảng, gồm các thông tin: STT, Tên Page, Acc quản lý và Hành động.
Màn hình này chỉ phục vụ mục đích tra cứu và theo dõi danh sách Page, không thực hiện điều hướng hoặc liên kết sang các chức năng khác của hệ thống.
Thêm page (bổ sung) 
2
Đăng bài AI
 Cho phép người dùng lựa chọn tài khoản Facebook đang quản lý Page, lấy danh sách Fanpage tương ứng, cấu hình API và mô hình AI, thiết lập lịch đăng, cấu hình Prompt và thực hiện đăng bài tự động lên các Page được lựa chọn. Hệ thống đồng thời cung cấp khu vực theo dõi tiến trình và kết quả thực hiện. 
3
Đăng Video Reels
 Cho phép người dùng lựa chọn tài khoản Facebook và các Fanpage cần đăng Reels, lựa chọn thư mục chứa video, gán nguồn video cho từng Page, thiết lập lịch đăng và khoảng nghỉ giữa các lần thực hiện. Hệ thống thực hiện đăng Reels và cập nhật trạng thái xử lý trong khu vực theo dõi tiến trình. 
4
Tải Video TikTok hàng loạt
 Cho phép người dùng tìm kiếm và tải hàng loạt video TikTok theo từ khóa tương ứng với từng Fanpage. Người dùng có thể thiết lập thư mục lưu, số lượng video cần tải, khoảng nghỉ giữa các yêu cầu và số lượng tác vụ thực hiện đồng thời. Video tải thành công được lưu để sử dụng làm nguồn nội dung cho chức năng đăng Reels. 
5
Tải Video YouTube hàng loạt
 Cho phép người dùng tải hàng loạt video YouTube/YouTube Shorts theo từ khóa hoặc liên kết tương ứng với từng Fanpage. Hệ thống hỗ trợ cấu hình thư mục lưu, Cookie khi cần, số lượng video, khoảng nghỉ và số tác vụ đồng thời. Video tải thành công được lưu để làm nguồn nội dung cho chức năng đăng Reels. 
6
Lịch sử / nhật ký 



5.2. Danh sách page
Mã
Yêu cầu chức năng
Mô tả
FR-PG-01
Hiển thị danh sách Page
Hệ thống hiển thị các Fanpage đang được quản lý với các thông tin: STT, Tên Page, Acc quản lý, Hành động.
FR-PG-02
Tìm kiếm và lọc Page
Cho phép người dùng tìm kiếm Fanpage theo tên và lọc danh sách theo trạng thái Page.
FR-PG-03
Xem Page
Cho phép người dùng xem thông tin của Fanpage được chọn.

5.2.1. FR-PG-01 Hiển thị danh sách Page
Thuộc tính
Nội dung
ID
FR-PG-01
Tên
Hiển thị danh sách Page
Actor
Người dùng
Mô tả
Cho phép người dùng xem danh sách các Fanpage đang được hệ thống quản lý trong chức năng Quản lý Fanpage
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống và đang ở màn hình Dashboard.
Dữ liệu đầu vào
Không yêu cầu dữ liệu đầu vào bắt buộc.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard của hệ thống.
 2. Người dùng chọn chức năng Quản lý Fanpage
 3. Người dùng chọn Danh sách Page.
 4. Hệ thống lấy danh sách Fanpage đang được quản lý.
 5. Hệ thống hiển thị danh sách Page dưới dạng bảng gồm các thông tin: STT, Tên Page, Acc quản lý, Hành động ( Mở, Xóa).
 6. Người dùng xem danh sách và lựa chọn Page cần thao tác (Xem_link đến page, xóa) nếu cần.
Luồng sự kiện phụ
6.1. Người dùng chọn một Page trong danh sách → hệ thống cho phép thực hiện các hành động tương ứng tại cột Hành động.
Luồng ngoại lệ
4.1. Không có Page trong hệ thống → hệ thống hiển thị danh sách trống và thông báo chưa có Fanpage được quản lý.
 4.2. Không thể tải dữ liệu Page → hệ thống hiển thị thông báo lỗi và cho phép người dùng thực hiện lại thao tác.
Hậu điều kiện
Danh sách Fanpage được hiển thị trên màn hình Danh sách Page để người dùng tiếp tục tìm kiếm, lọc hoặc thực hiện các thao tác với Page.

5.2.2. FR-PG-02 Tìm kiếm và lọc Page
Thuộc tính
Nội dung
ID
FR-PG-02
Tên
Tìm kiếm và lọc Page
Actor
Người dùng
Mô tả
Cho phép người dùng tìm kiếm Fanpage theo tên và lọc danh sách Page theo trạng thái để nhanh chóng xác định Page cần thao tác.
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống, truy cập Quản lý Fanpage  và đang ở màn hình Danh sách Page.
Dữ liệu đầu vào
Từ khóa tìm kiếm theo tên Page và/hoặc trạng thái Page cần lọc.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard của hệ thống.
 2. Người dùng chọn Quản lý Fanpage.
 3. Người dùng chọn Danh sách Page
4. Người dùng nhập từ khóa tìm kiếm hoặc chọn trạng thái cần lọc. ( Lọc theo account quản lý ) 
 5. Hệ thống tiếp nhận điều kiện tìm kiếm/lọc.
 6. Hệ thống đối chiếu với danh sách Page hiện có.
 7. Hệ thống hiển thị các Page phù hợp với điều kiện đã chọn.
Luồng sự kiện phụ
4.1. Người dùng chỉ nhập từ khóa tìm kiếm → hệ thống lọc theo tên Page.
 4.2. Người dùng chỉ chọn trạng thái → hệ thống lọc theo trạng thái.
 4.3. Người dùng đồng thời nhập từ khóa và chọn trạng thái → hệ thống hiển thị các Page thỏa mãn cả hai điều kiện.
 4.4. Người dùng xóa từ khóa hoặc chọn lại Tất cả trạng thái → hệ thống hiển thị lại toàn bộ danh sách Page.
Luồng ngoại lệ
6.1. Không có Page nào phù hợp với điều kiện tìm kiếm/lọc → hệ thống hiển thị thông báo không tìm thấy kết quả.
 6.2. Không thể tải hoặc xử lý danh sách Page → hệ thống hiển thị thông báo lỗi.
Hậu điều kiện
Danh sách Page được cập nhật theo điều kiện tìm kiếm/lọc của người dùng và sẵn sàng để tiếp tục thực hiện các thao tác khác.

5.2.3. FR-PG-03 Xem Page
Thuộc tính
Nội dung
ID
FR-PG-03
Tên
Xem Page
Actor
Người dùng
Mô tả
Cho phép người dùng xem thông tin chi tiết của một Fanpage được chọn từ danh sách Page.
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống, truy cập Quản lý  FanPage và đang ở màn hình Danh sách Page. Danh sách Fanpage đã được hiển thị.
Dữ liệu đầu vào
Fanpage được người dùng lựa chọn.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard của hệ thống.
 2. Người dùng chọn Quản lý Fanpage.
 3. Hệ thống hiển thị màn hình Danh sách Page và danh sách Fanpage.
 4. Người dùng xác định Page cần xem.
 5. Người dùng chọn hành động Xem tại Page tương ứng. 
 6. Hệ thống hiển thị thông tin của Page cho người dùng.
Luồng sự kiện phụ
6.1. Người dùng đóng màn hình xem chi tiết → hệ thống quay lại danh sách Page.
Luồng ngoại lệ
6.1. Không lấy được thông tin của Page → hệ thống hiển thị thông báo lỗi.
 6.2. Page không còn khả dụng hoặc không thể truy cập → hệ thống hiển thị trạng thái tương ứng và thông báo cho người dùng.
Hậu điều kiện
Thông tin chi tiết của Fanpage được hiển thị để người dùng kiểm tra trước khi thực hiện các thao tác tiếp theo.

5.2.4. FR-PG-04 Xóa Page
5.2.5. FR-PG-04 Thêm Page
Thuộc tính
Nội dung
ID
FR-PG-04
Tên
Thêm Page
Actor
Người dùng
Mô tả
Cho phép người dùng thêm các Fanpage vào danh sách để quản lý
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống và đang ở màn hình Dashboard.
Dữ liệu đầu vào


Luồng sự kiện chính
1. Người dùng truy cập Dashboard của hệ thống.
 2. Người dùng chọn chức năng Quản lý Fanpage
 3. Người dùng chọn Danh sách Page.
 4. Hệ thống lấy danh sách Fanpage đang được quản lý.
 5. Hệ thống hiển thị danh sách Page dưới dạng bảng gồm các thông tin: STT, Tên Page, Acc quản lý, Hành động ( Mở, Xóa).
 6. Người dùng chọn chức năng thêm page
7. Hệ thống đưa ra thông báo “Để thêm page vui lòng đăng nhập ” và điều hướng đến trang thêm nhiều tài khoản 
8. Người dùng thực hiện thêm tài khoản (SRS 2) (Thực hiện thêm tài khoản, sẽ lưu thông tin tài khoản)
9. Sau khi người dùng đăng nhập thành công, hệ thống điều hướng trở lại trang danh sách page, danh sách page đã được cập nhật thêm các fanpage của tài khoản đã đăng nhập
Luồng sự kiện phụ


Luồng ngoại lệ
4.1. Không có Page trong hệ thống → hệ thống hiển thị danh sách trống và thông báo chưa có Fanpage được quản lý.
 4.2. Không thể tải dữ liệu Page → hệ thống hiển thị thông báo lỗi và cho phép người dùng thực hiện lại thao tác.
9.1. Không thể tải dữ liệu Page → hệ thống hiển thị thông báo lỗi và cho phép người dùng thực hiện lại thao tác.
Hậu điều kiện
Các page được cập nhật thêm trên danh sách Fanpage 

5.3. Đăng bài AI
Thuộc tính
Nội dung
ID
FR-AI-01.1
Tên
Đăng bài AI (tài khoản có sẵn trên hệ thống)
Actor
Người dùng
Mô tả
Cho phép người dùng lựa chọn tài khoản Facebook đang quản lý Page
Lấy danh sách các Fanpage thuộc tài khoản đó
Thiết lập nội dung bằng AI và thực hiện đăng bài lên các Page được chọn.
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống và đang ở chức năng Quản lý Fanpage.
Dữ liệu đầu vào
Tài khoản Facebook được chọn; Page cần đăng; chủ đề/từ khóa nội dung; cấu hình AI; Prompt; lịch đăng; khoảng thời gian thực hiện.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard.
 2. Người dùng chọn Quản lý Fanpage
 3. Người dùng chọn chức năng Đăng bài AI.
 4. Hệ thống hiển thị danh sách các tài khoản Facebook đang quản lý Page.
 5. Người dùng chọn một tài khoản Facebook.
 6. Hệ thống thực hiện đăng nhập và kiểm tra trạng thái tài khoản.
 7. Sau khi đăng nhập thành công, hệ thống lấy và hiển thị toàn bộ Fanpage mà tài khoản đó đang quản lý.
 8. Người dùng chọn một hoặc nhiều Page cần đăng bài.
 9. Người dùng cấu hình hệ thống API phục vụ tạo nội dung, gồm:
- Chọn file chứa danh sách Gemini API Keys.
- Nhập Pixabay API Key để tìm hình ảnh minh họa.
- Chọn phiên bản Facebook API.
- Chọn Model Gemini sử dụng.
10. Người dùng thiết lập hẹn giờ đăng bài AI bằng cách:
- Bật hoặc tắt chức năng Kích hoạt hẹn giờ đăng .
- Nhập các khung giờ đăng bài trong ngày
Người dùng thiết lập giãn cách đăng ngẫu nhiên 
11. Người dùng cấu hình Khung Prompt AI dùng để định hướng cách hệ thống sinh nội dung bài viết.
12. Người dùng nhấn Kích hoạt để bắt đầu quá trình đăng bài AI.
13. Hệ thống kiểm tra các cấu hình cần thiết trước khi thực thi, bao gồm:
- Danh sách Page đã chọn.
- Cấu hình API.
- Prompt AI.
- Lịch đăng nếu có bật hẹn giờ.
14. Hệ thống thực hiện đăng bài lên các Page đã chọn. (VD: chọn 10 page, AI từ từ khóa chủ đề tạo ra 10 bài cho 10 page) 
15. Trong quá trình thực hiện, hệ thống cập nhật thông tin tại khu vực Theo dõi tiến trình.
16. Bảng theo dõi tiến trình hiển thị trạng thái xử lý của từng Page, ví dụ: (chưa biết )
17. Khi hoàn tất, hệ thống hiển thị kết quả cuối cùng để người dùng theo dõi.
Luồng sự kiện phụ
8.1. Người dùng có thể chọn Chọn tất cả để chọn toàn bộ Page hoặc Bỏ chọn tất cả để hủy lựa chọn các Page.
10.1. Người dùng có thể bật hoặc tắt chế độ hẹn giờ đăng bài AI. Nếu không kích hoạt hẹn giờ, tác vụ được thực hiện khi người dùng nhấn Kích hoạt.
11.1. Người dùng có thể chỉnh sửa Khung Prompt AI để thay đổi cách hệ thống tạo nội dung bài viết.
15.1. Trong quá trình thực hiện, người dùng có thể theo dõi trạng thái xử lý của từng Page tại khu vực Theo dõi tiến trình.
15.2. Người dùng có thể chọn Dừng luồng để dừng quá trình thực hiện đang diễn ra.
Luồng ngoại lệ
6.1. Đăng nhập Account thất bại 
- Hệ thống hiển thị thông báo đăng nhập không thành công.
- Người dùng có thể chọn lại Account hoặc thực hiện đăng nhập lại.
7.1. Không lấy được danh sách Page 
- Hệ thống hiển thị thông báo không thể tải danh sách Fanpage từ Account đã chọn.
- Người dùng có thể thử lại hoặc chọn Account khác.
7.2. Account không quản lý Page nào 
- Hệ thống hiển thị thông báo Account hiện không có Fanpage để thực hiện đăng bài.
9.1. Cấu hình API không hợp lệ hoặc thiếu thông tin 
- Hệ thống hiển thị thông báo lỗi tại thông tin cấu hình tương ứng.
- Người dùng phải cập nhật lại trước khi tiếp tục.
10.1. Khung giờ hẹn đăng không hợp lệ 
- Hệ thống hiển thị thông báo định dạng thời gian không hợp lệ.
- Người dùng phải nhập lại khung giờ đúng định dạng.
11.1. Prompt AI để trống hoặc không hợp lệ 
- Hệ thống hiển thị thông báo và yêu cầu người dùng bổ sung hoặc chỉnh sửa Prompt.
13.1. Thiếu cấu hình bắt buộc khi kích hoạt 
- Hệ thống không thực hiện tác vụ.
- Hệ thống chỉ rõ thông tin còn thiếu, ví dụ: chưa chọn Page, chưa cấu hình API hoặc chưa có Prompt.
14.1. Đăng bài thất bại tại một Page 
- Hệ thống ghi nhận trạng thái thất bại tại Page tương ứng.
- Các Page còn lại vẫn tiếp tục được xử lý nếu không bị ảnh hưởng.
14.2. Lỗi kết nối trong quá trình đăng bài 
- Hệ thống ghi nhận lỗi và hiển thị trạng thái tương ứng trong khu vực theo dõi tiến trình.
15.1. Tiến trình bị dừng giữa chừng 
- Hệ thống cập nhật trạng thái của các tác vụ chưa hoàn thành thành Đã dừng hoặc trạng thái tương ứng.
- Các kết quả đã thực hiện trước đó vẫn được giữ lại
Hậu điều kiện
Bài viết được đăng lên các Fanpage thực hiện thành công; kết quả của từng tác vụ được ghi nhận và hiển thị trong khu vực theo dõi tiến trình.


5.4. Đăng Video Reels
Thuộc tính
Nội dung
ID
FR-RL-01.1
Tên
Đăng Video Reels ( Tài khoản có sẵn trên hệ thống)
Actor
Người dùng
Mô tả
Cho phép người dùng chọn tài khoản Facebook đang quản lý Page, đăng nhập tài khoản, lấy danh sách Fanpage tương ứng, gán nguồn video cho từng Page và thực hiện đăng Reels.
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống
Dữ liệu đầu vào
Tài khoản Facebook; danh sách Page; thư mục gốc chứa video; thư mục nội dung của từng Page; lịch đăng; khoảng nghỉ giữa các lần đăng.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard.
 2. Người dùng Quản lý FanPage.
 3. Người dùng chọn chức năng Đăng Video Reels.
 4. Hệ thống hiển thị danh sách các tài khoản Facebook đang quản lý Page.
 5. Người dùng chọn một tài khoản Facebook.
 6. Hệ thống thực hiện đăng nhập và kiểm tra trạng thái tài khoản.
 7. Sau khi đăng nhập thành công, hệ thống lấy và hiển thị toàn bộ Fanpage mà tài khoản đó đang quản lý.
 8. Người dùng chọn một hoặc nhiều Page cần đăng Reels.
 9. Người dùng chọn thư mục gốc chứa video.
 10. Người dùng gán thư mục nội dung cho từng Page hoặc sử dụng chức năng Tự động gán theo tên. (Tự động gán / có thể sửa)
 11. Người dùng thiết lập hẹn giờ đăng Reels bằng cách bật/tắt chức năng hẹn giờ và nhập các khung giờ đăng trong ngày.
 12. Người dùng thiết lập khoảng nghỉ giữa các lần đăng.
 13. Người dùng nhấn Kích hoạt.
 14. Hệ thống kiểm tra tài khoản đã đăng nhập, Page được chọn, thư mục video và các cấu hình cần thiết.
 15. Hệ thống thực hiện đăng Reels lên các Page đã chọn.
 16. Trong quá trình thực hiện, hệ thống cập nhật trạng thái tại khu vực Theo dõi tiến trình.
 17. Khi hoàn tất, hệ thống hiển thị kết quả thực hiện của từng Page.


Thuộc tính
Nội dung
ID
FR-RL-01.1
Tên
Đăng Video Reels ( Tài khoản có sẵn trên hệ thống)
Actor
Người dùng
Mô tả
Cho phép người dđăng nhập tài khoản Facebook đang quản lý Page, đăng nhập tài khoản, lấy danh sách Fanpage tương ứng, gán nguồn video cho từng Page và thực hiện đăng Reels.
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống
Dữ liệu đầu vào
Tài khoản Facebook; danh sách Page; thư mục gốc chứa video; thư mục nội dung của từng Page; lịch đăng; khoảng nghỉ giữa các lần đăng.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard.
 2. Người dùng Quản lý FanPage.
 3. Người dùng chọn chức năng Đăng Video Reels.
 4. Hệ thống hiển thị danh sách các tài khoản Facebook đang quản lý Page và nút đăng nhập bằng Tài khoản Facebook 
 5. Người dùng chọn đăng nhập bằng tài khoản Facebook.
 6. Hệ thống thực hiện đăng nhập và kiểm tra trạng thái tài khoản.
 7. Sau khi đăng nhập thành công, hệ thống lấy và hiển thị toàn bộ Fanpage mà tài khoản đó đang quản lý.
 8. Người dùng chọn một hoặc nhiều Page cần đăng Reels.
 9. Người dùng chọn thư mục gốc chứa video.
 10. Người dùng gán thư mục nội dung cho từng Page hoặc sử dụng chức năng Tự động gán theo tên. (Tự động gán / có thể sửa)
 11. Người dùng thiết lập hẹn giờ đăng Reels bằng cách bật/tắt chức năng hẹn giờ và nhập các khung giờ đăng trong ngày.
 12. Người dùng thiết lập khoảng nghỉ giữa các lần đăng.
 13. Người dùng nhấn Kích hoạt.
 14. Hệ thống kiểm tra tài khoản đã đăng nhập, Page được chọn, thư mục video và các cấu hình cần thiết.
 15. Hệ thống thực hiện đăng Reels lên các Page đã chọn.
 16. Trong quá trình thực hiện, hệ thống cập nhật trạng thái tại khu vực Theo dõi tiến trình.
 17. Khi hoàn tất, hệ thống hiển thị kết quả thực hiện của từng Page.

5.5. Tải Video TikTok hàng loạt
Thuộc tính
Nội dung
ID
FR-TT-01
Tên
Tải Video TikTok hàng loạt
Actor
Người dùng
Mô tả
Cho phép người dùng tải hàng loạt Video TikTok theo từ khóa tương ứng với từng Fanpage và lưu video vào thư mục đã chỉ định để sử dụng làm nguồn nội dung cho chức năng đăng Video Reels. (Video đã tải sẽ được lưu ID vĩnh viễn, sử dụng check trùng lặp cho lần tải tiếp theo )
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống và truy cập chức năng Quản lý Fanpage. Hệ thống đã có danh sách Fanpage phục vụ việc xác định từ khóa và phân loại nguồn video.
Dữ liệu đầu vào
Thư mục lưu video; từ khóa tìm kiếm của từng Page; thời gian nghỉ giữa các yêu cầu; số video tối đa cho mỗi Page; số lượng tác vụ tải đồng thời.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard.
 2. Người dùng chọn Danh sách FanPage.
 3. Người dùng chọn chức năng Tải Video TikTok hàng loạt.
 4. Hệ thống hiển thị danh sách Fanpage cùng từ khóa tìm kiếm tương ứng.
 5. Người dùng chọn thư mục lưu tổng cho các video tải xuống.
 6. Người dùng kiểm tra hoặc chỉnh sửa từ khóa tìm kiếm tương ứng với từng Fanpage.
 7. Người dùng thiết lập Delay giữa request.
 8. Người dùng thiết lập Số video tối đa mỗi Page.
 9. Người dùng thiết lập Số lượng tác vụ tải đồng thời.
 10. Người dùng nhấn Kích hoạt.
 11. Hệ thống kiểm tra thư mục lưu và các tham số đã thiết lập.
 12. Hệ thống tìm kiếm và tải video dựa trên từ khóa của từng Fanpage.
 13. Video tải xuống
 14. Hệ thống cập nhật trạng thái của từng Fanpage trong danh sách ( Chưa biết chi tiết từng trạng thái)
 15. Hệ thống đồng thời cập nhật thông tin chi tiết tại khu vực Nhật ký tải.
 16. Khi quá trình tải hoàn tất, hệ thống hiển thị kết quả để người dùng theo dõi.
Luồng sự kiện phụ
6.1. Người dùng có thể thay đổi từ khóa tìm kiếm riêng cho từng Fanpage trước khi tải.
 10.1. Trong quá trình tải, người dùng có thể chọn Dừng tải để ngừng quá trình đang thực hiện.
 15.1. Người dùng có thể theo dõi thông tin chi tiết của quá trình tải tại khu vực Nhật ký tải.
Luồng ngoại lệ
5.1. Thư mục lưu không tồn tại hoặc không thể truy cập → hệ thống hiển thị thông báo và yêu cầu người dùng chọn lại.
 6.1. Từ khóa của Fanpage bị để trống → hệ thống thông báo hoặc bỏ qua Fanpage tương ứng.
 7.1. Tham số Delay không hợp lệ → hệ thống yêu cầu người dùng nhập lại.
 8.1. Số lượng video tối đa không hợp lệ → hệ thống thông báo và không bắt đầu tác vụ.
 9.1. Số lượng tác vụ đồng thời không hợp lệ → hệ thống yêu cầu điều chỉnh lại.
 12.1. Không tìm thấy video phù hợp với từ khóa → hệ thống ghi nhận trạng thái tương ứng cho Fanpage.
 12.2. Không thể tải video → hệ thống ghi nhận lỗi tại tác vụ và tiếp tục với các tác vụ còn lại nếu có.
 13.1. Không thể lưu video vào thư mục đích → hệ thống ghi nhận lỗi và hiển thị trong nhật ký tải.
Hậu điều kiện
Các video tải thành công được lưu vào thư mục tương ứng với từng Fanpage và có thể được sử dụng làm nguồn nội dung cho chức năng Đăng Video Reels. Kết quả quá trình tải được hiển thị tại danh sách trạng thái và khu vực nhật ký.

5.6. Tải Video Youtube hàng loạt
Thuộc tính
Nội dung
ID
FR-YT-01
Tên
Tải Video YouTube hàng loạt
Actor
Người dùng
Mô tả
Cho phép người dùng tải hàng loạt video YouTube/YouTube Shorts theo từ khóa hoặc liên kết tương ứng với từng Fanpage và lưu video vào thư mục đã chỉ định để sử dụng làm nguồn nội dung cho chức năng đăng Video Reels. (Video đã tải sẽ được lưu ID vĩnh viễn, sử dụng check trùng lặp cho lần tải tiếp theo, video có giới hạn độ dài )
Tiền điều kiện
Người dùng đã đăng nhập vào hệ thống và truy cập chức năng Quản lý Fanpage. Hệ thống đã có danh sách Fanpage phục vụ việc tìm kiếm và phân loại nguồn video.
Dữ liệu đầu vào
Thư mục lưu video; từ khóa hoặc liên kết tương ứng với từng Page; cấu hình Cookie nếu cần; thời gian nghỉ giữa các request; số video tối đa mỗi Page; số lượng tác vụ tải đồng thời.
Luồng sự kiện chính
1. Người dùng truy cập Dashboard.
 2. Người dùng chọn Quản lý  FanPage.
 3. Người dùng chọn chức năng Tải Video YouTube Shorts.
 4. Hệ thống hiển thị danh sách Fanpage cùng từ khóa hoặc liên kết tương ứng.
 5. Người dùng chọn thư mục lưu tổng cho video tải xuống.
 6. Người dùng kiểm tra hoặc chỉnh sửa từ khóa/liên kết của từng Fanpage. ( Trong trường hợp  người dùng nhập liên kết, yêu cầu nhập thêm từ khóa đi kèm, khi đó hệ thống thực hiện tìm kiếm dựa trên từ khóa trên phạm vi link trang đã nhập )
 7. Người dùng thiết lập Delay giữa request.
 8. Người dùng thiết lập Số video tối đa mỗi Page.
 9. Người dùng thiết lập Số lượng tác vụ tải đồng thời.
 10. Người dùng nhấn Kích hoạt
 11. Hệ thống kiểm tra các cấu hình và dữ liệu đầu vào.
 12. Hệ thống tìm kiếm hoặc truy cập nguồn video tương ứng với từng Fanpage và thực hiện tải video.
 13. Video tải thành công được lưu và phân loại theo Fanpage tương ứng.
 14. Hệ thống cập nhật trạng thái của từng Fanpage trong danh sách.
 15. Hệ thống cập nhật thông tin chi tiết tại khu vực Nhật ký tải YouTube Shorts.
 16. Khi quá trình hoàn tất, hệ thống hiển thị kết quả tải để người dùng theo dõi.
Luồng sự kiện phụ
6.1. Người dùng có thể thay đổi từ khóa hoặc liên kết riêng cho từng Fanpage.
 11.1. Trong quá trình thực hiện, người dùng có thể chọn Dừng tải.
 16.1. Người dùng có thể theo dõi chi tiết quá trình tải tại khu vực nhật ký.
Luồng ngoại lệ
5.1. Thư mục lưu không tồn tại hoặc không thể truy cập → hệ thống yêu cầu chọn lại.
 6.1. Từ khóa hoặc liên kết không hợp lệ → hệ thống thông báo hoặc bỏ qua Page tương ứng.
 7.1. Giá trị Delay không hợp lệ → hệ thống yêu cầu nhập lại.
 8.1. Số video tối đa không hợp lệ → hệ thống không cho phép bắt đầu tác vụ.
 9.1. Số lượng tác vụ đồng thời không hợp lệ → hệ thống yêu cầu điều chỉnh.
 12.1. Không tìm thấy video phù hợp → hệ thống cập nhật trạng thái tương ứng.
 12.2. Không thể tải video → hệ thống ghi nhận lỗi và tiếp tục xử lý các tác vụ còn lại.
 13.1. Không thể lưu video → hệ thống ghi nhận lỗi tại nhật ký tải.
Hậu điều kiện
Các video tải thành công được lưu vào thư mục

 
5.7. Lịch sử/Nhật ký 
Lịch sử/ Nhật ký log ra các thông tin: 
Đăng bài AI, Đăng video reels, Tải Tiktok, tải Youtube: tổng, thành công, thất bại 
Lịch sử chi tiết ( theo ngày/ tuần ) 
+ Đăng bài AI và reels hiển thị theo page, xem chi tiết sẽ xem được chi tiết bài nào thành công, và thất bại 
+ Tải video Tiktok, Youtube: xem tổng toàn bộ video đã tải ( STT, thời gian, tên video, thư mục, hành động) 