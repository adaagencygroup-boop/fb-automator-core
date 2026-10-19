# Checklist Module 2

Mỗi dòng là nhóm ca có dữ liệu, bước và kết quả mong đợi. Tên từng test và trạng thái chi tiết nằm trong log verbose. `Đạt unit` không xác nhận hành vi DOM.

| ID | Loại / dữ liệu | Bước chạy | Mong đợi | Kết quả / bằng chứng |
|---|---|---|---|---|
| BE01 | API; 0/1/9/10/11/37, limit 3/100 | Duyệt cursor đến hết | Tối đa 10; đủ UID, không trùng; total không đổi | Đạt; test_pagination + test_module2_matrix |
| BE02 | API; cursor bad/0/-1/1.5/1/999999/owner khác | GET page từng cursor | 422 invalid; numeric boundary không lộ owner khác | Đạt; matrix |
| BE03 | API; UID/tên/email mixed case, khoảng trắng, %, _, backslash | Search từng giá trị; lọc status/login kết hợp | Literal matching; trạng thái chưa kiểm tra không tính LIVE/DIE | Đạt; pagination + matrix |
| BE04 | API; batch rỗng/trùng/UID không tồn tại/601 UID | POST existing-uids; đổi owner | Đúng tập UID của owner, không trùng qua chunk | Đạt; matrix + pagination |
| BE05 | API; UID cũ ngoài trang đầu; trùng trong import; lỗi ghi từng dòng | Import skip/overwrite/create_only/API cũ | 409 create_only; counts chính xác; lỗi không rollback dòng hợp lệ | Đạt; pagination, matrix, test_api |
| BE06 | API; alice 11, bob 1 | Import, sửa UID/email, xoá; đọc stats | total toàn owner cập nhật; bob không đổi | Đạt; matrix |
| BE07 | Unit/API; credential/cookie/profile/proxy | Chạy encryption, uid_edit, proxy_validation/proxy, API | Mã hoá đúng, rollback sửa UID/profile, validation | Đạt; suite BE |
| BE08 | Unit/API; mock login/browser/status/cookie | Chạy login_status, open_browser_status, facebook_profile_status, status_batches, service, API | Thành công/lỗi/inconclusive; owner đúng; giới hạn concurrency; chống queue trùng | Đạt; suite BE |
| BE09 | Async unit; hai owner và subscriber | Fanout event, executor; đóng streams | SSE event không chéo owner; cleanup subscriber | Đạt; test_service |
| BE10 | API/DB; account + Fanpage + profile và lỗi DB/filesystem | Preview, delete/bulk delete; rollback lỗi | Đúng counts; chỉ xoá được tài khoản thành công; bảo toàn liên kết khi lỗi | Đạt; account_deletion |
| BE11 | DB; schema PostgreSQL tạm | Đặt URL test riêng, chạy migration suite | Migration/uniqueness/rollback tương đương SQLite | Bị chặn; thiếu ACCOUNT_TEST_POSTGRES_URL, 5 ca |
| FE01 | Hook unit; promises điều khiển | Append nhanh, resolve/reject, retry, hết dữ liệu | Một append đồng thời; không trùng; giữ dòng lỗi; retry đúng cursor | Đạt; useAccountPages |
| FE02 | Hook unit; hai query, request đang chờ | Resolve sai thứ tự; đổi query; callback mutation cũ | Chỉ query mới cập nhật; xoá selection; reset | Đạt unit; useAccountPages |
| FE03 | Hook unit; 20 dòng và anchor | Refresh nhiều trang; inject lỗi refresh | Giữ danh sách; khôi phục anchor; retry từ đầu | Đạt unit; useAccountPages |
| FE04 | Pointer unit; visible/hidden UID | Kéo hai chiều, Ctrl/Cmd, append trong drag, dispose | Chỉ range hiển thị; thêm selection đúng; dọn listeners | Đạt unit; drag-selection |
| FE05 | Mapping unit; clipboard/proxy/UUID | Map import và validate proxy | Không gán UUID vào credential; giữ mapping field | Đạt; import-mapping |
| FE06 | Hook unit; stats reject | Load page rồi append | List vẫn hiển thị, lock được giải phóng | Đạt; test mới |
| FE07 | Hook unit; pending page | Unmount trước resolve | Không ghi rows sau unmount | Đạt; test mới |
| FE08 | Hook unit; initial list reject | Retry first page | Cursor trống; xoá lỗi; rows đúng | Đạt; test mới |
| E01 | Browser; mail1 → mail2 cách 100ms | Đếm request trước 300ms và sau debounce | Chỉ 1 request mail2; rows từ BE thật | Bị chặn; đã có browser_e2e test |
| E02 | Browser; page 503 một lần | Search, click Thử lại | Hiện lỗi; retry đúng query; rows xuất hiện | Bị chặn; đã có browser_e2e test |
| E03 | Browser; 2 owner, search % | Mở /accounts, tìm literal | Không thấy bob; % không match tất cả | Bị chặn; đã có browser_e2e test |
| E04 | Browser; filter status/login, đang cuộn/đã chọn | Đổi filter và query | Filter ngay; reset scroll/selection; trang đầu | Bị chặn môi trường; chưa có test DOM tự động |
| E05 | Browser; 37 dòng, cuộn nhanh và overlap UID | Cuộn hết, lỗi append, retry | Một request; dừng hết; giữ dòng; không trùng | Bị chặn môi trường; unit FE01 đạt, DOM chưa kiểm chứng |
| E06 | Browser; delays, 503 stats/existing-uids | Resolve sai thứ tự, rời trang, đổi query | Không stale rows; lỗi API phù hợp; retry đúng | Bị chặn môi trường; DOM chưa kiểm chứng |
| E07 | Browser; checkbox, drag hai chiều/Ctrl/Cmd, append khi kéo | Chọn và kiểm tra bộ đếm | Chỉ loaded rows; số chọn đúng | Bị chặn môi trường; unit FE04 đạt, DOM chưa kiểm chứng |
| E08 | Browser; anchor, insert trước anchor, xoá/filter anchor | Refresh | Giữ dòng trên cùng; fallback hợp lý nếu mất anchor | Bị chặn môi trường; unit chỉ xác nhận gọi restore, chưa chứng minh DOM |
| E09 | Browser; modal thật, UID ngoài trang đầu và lỗi từng phần | Add/import/edit/delete, validation, confirm | Không duplicate; counts/stats đúng; skip/overwrite đúng | Bị chặn môi trường; chưa có automation modal |
| E10 | Browser; mock Chrome và batch login, burst 100 sự kiện | Cập nhật dòng, giữ selection, kiểm tra số GET và bảng không bị che | Phản hồi tức thì, không refresh theo từng sự kiện | Có test realtime UI; chưa chạy được vì môi trường chặn khởi chạy trình duyệt. Các ca cookie/proxy/đổi owner trên DOM chưa được bổ sung |

E04–E09 và các nhánh E10 còn thiếu cần bổ sung browser automation khi chạy được app/Playwright. Các ca trình duyệt chưa chạy không được tính là đã đạt. Kết nối Facebook/Chrome/proxy thật không thuộc checklist này.
