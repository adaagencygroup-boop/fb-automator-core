# OAuth và Page Token — Module 5

Luồng web, token nhập tay và Chrome profile gọi chung `meta_sync.py`. Không đồng bộ sang Module 6.

## Popup OAuth web độc lập

Nút bên phải “Đăng nhập trên trình duyệt này” dùng `meta_web.py`, không yêu cầu chọn hoặc tạo account Module 2. Nút mở popup cùng trình duyệt; phiên Facebook vẫn được chia sẻ với trình duyệt chính. Callback hiển thị tên Facebook và App-scoped ID, người dùng bấm “Chấp nhận đăng nhập” một lần để tự động lưu kết nối và đồng bộ Page. Không cần xác nhận hoặc bấm đồng bộ trên dashboard. Đây là kết nối/token đã lưu, không phải bằng chứng phiên Facebook trên trình duyệt vẫn còn đăng nhập.

Sau khi xác nhận và đồng bộ thành công, popup tự đóng, dashboard giữ nguyên modal/bộ lọc/trang hiện tại, tải lại danh sách Page ở nền. Nút đổi thành “Đã kết nối: [tên] ▾” với menu “Quét lại Page”, “Đổi tài khoản”; token hết hạn theo metadata hiện “Cần kết nối lại”. Quét lại dùng token DB, không mở consent hoặc đổi token thêm lần nữa. Đổi tài khoản giữ kết nối/Page cũ; nếu Meta vẫn trả Facebook cũ, tác vụ báo rõ và không báo đổi thành công. Phần mềm không tự đăng xuất Facebook toàn trình duyệt.

“Đổi tài khoản” mở bước chuẩn bị ngay trong popup: hiển thị kết nối cũ, link mở Facebook để người dùng đổi phiên, rồi nút “Tôi đã đổi Facebook — tiếp tục” mới chuyển sang OAuth. Vì popup chia sẻ phiên Facebook với trình duyệt chính, mở lại OAuth đơn thuần không đổi danh tính. Nếu Meta vẫn trả tài khoản cũ, job trả `error_code: SAME_FACEBOOK_IDENTITY`; callback giữ cửa sổ mở, hướng dẫn đổi Facebook và có nút thử lại tạo state/job mới. Chỉ kết nối thành công mới tự đóng. Các tham số tiếp tục OAuth lưu trong sessionStorage không chứa token; URL chỉ được dùng khi đúng host/đường dẫn Meta và state.

Callback có giao diện riêng cho chuẩn bị đổi tài khoản, xác thực, xác nhận danh tính, đồng bộ, thành công, hủy và lỗi. Thử lại trong popup thông báo owner qua BroadcastChannel (không truyền token/job), dashboard đọc lại job từ backend; khi lấy lại focus cũng đọc lại kết nối. Không phụ thuộc opener.

Các API mới, đều yêu cầu đúng owner:

- `POST /api/pages/web-oauth/start`, body `{"reason":"connect"}` hoặc `{"reason":"switch"}`: trả `202`, `job_id`, `state`, `authorization_url`, `expires_at`; job bắt đầu ở `AWAITING_OAUTH`.
- `POST /api/pages/web-oauth/complete`, body `state`, `access_token`, `error`: kiểm tra phiên và state, tiếp tục đúng job đã tạo; token không đi qua `postMessage` hoặc browser storage.
- `GET /api/pages/web-connection`: danh tính/trạng thái thời hạn kết nối web được lưu thành công gần nhất theo owner/App, kèm `active_job` để phục hồi polling sau reload. Không trả token.
- `POST /api/pages/web-connection/sync`: quét lại kết nối hiện tại từ DB; trả `202 + job_id`.
- `POST /api/pages/web-oauth/{job_id}/cancel`: chỉ hủy khi đang chờ OAuth/xác nhận; không hủy hoặc giả báo đã hủy lúc worker đang chạy/commit.
- Dùng lại `/sync-jobs/{job_id}` và `/sync-jobs/{job_id}/confirm` để polling và xác nhận tại callback. Dashboard chỉ theo dõi tiến độ và kết quả của luồng popup web. Không phụ thuộc `window.opener` vì Meta có thể ngắt quan hệ giữa cửa sổ. Callback lưu job ID/owner trong sessionStorage để phục hồi khi reload; không lưu token. Đóng popup sau khi chấp nhận không dừng job nền; đóng trước khi chấp nhận có thể hủy từ dashboard để kết nối lại.

### UX modal Thêm Page

- Prefetch tài khoản khi vào trang, độc lập với Page và kết nối web. Cache chỉ trong bộ nhớ của component theo owner, TTL 30 giây; mở lại dùng dữ liệu có sẵn, làm mới nền không xóa bảng. Lỗi tải có nút thử lại, giữ dữ liệu trước đó.
- Không tự gọi Meta kiểm tra token khi tải/mở modal. Badge khôi phục cache theo owner còn hạn 15 phút; nút Quét hiện cho account có token, backend xác thực trước khi lưu. Kiểm tra thủ công gộp yêu cầu theo UID, lỗi không giữ trạng thái CHECKING.
- Giữ bộ lọc khi đóng/mở; xóa token dán tay khi đóng. OAuth/quét khóa thao tác theo account, không chặn nút OAuth trình duyệt. Job thành công yêu cầu refresh mới kể cả khi GET cũ đang chạy.

Mỗi owner chỉ có một tác vụ web đang chờ/chạy, vẫn dùng chung hai worker với profile/account. Job ở RAM; restart engine phải khởi tạo OAuth mới. State đã sử dụng, sai owner/App hoặc job mất sau restart không được tự khôi phục consent. Popup bị chặn sẽ không tạo job; thất bại được giữ lại để đọc. Nếu không thể tự đóng, popup có nút đóng thủ công. Callback web cũ hoặc mở như trang thường quay về đường dẫn cùng origin đã ghi nhớ (mặc định `/pages/list`) sau thành công. Callback profile vẫn giữ nguyên fragment và do worker đóng.

Migration bổ sung `meta_web_v2` chạy sau `meta_owner_v1`: tạo `meta_web_connections`, cho phép state web độc lập không có `account_uid`, gắn `job_id` với state và thêm `pages.web_connection_id` cùng FK kiểm tra owner. Luồng web lưu kết nối/Page trong một transaction, Page có `account_uid=NULL`; khi đồng bộ account Module 2 thành công thì xóa nguồn web trên Page tương ứng. Các kết nối và Page cũ không bị xóa. Danh sách Page/Reels hiển thị tên Facebook nguồn web, không dùng App-scoped ID làm UID Module 2.

## Cấu hình

Đặt `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_GRAPH_API_VERSION` và `FACEBOOK_OAUTH_CALLBACK_URL` trong `.env`. Callback phải là URL frontend thực tế kết thúc bằng `/oauth/meta/callback` hoặc `/oauth/meta/callback/`, được đăng ký chính xác trong Meta App. Không dùng trang danh sách Page làm callback. Callback nằm ngoài AuthGate; luồng web xác thực phiên phần mềm trước khi gửi token tới API.

Ứng dụng xin `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `pages_messaging`, `pages_manage_metadata`. Thiếu cấu hình, thiếu quyền, sai App ID hoặc lỗi đổi token đều khiến đồng bộ thất bại.

## API và vòng đời

- `POST /api/pages/oauth-start` nhận `account_uid`, trả URL OAuth và state được backend tạo. State được băm trong DB, ràng buộc owner/account/app/flow, dùng một lần trong 10 phút.
- `POST /api/pages/oauth-by-profile`, `/sync-by-account`, `/sync-by-token`, `/fetch-tokens` trả `202` với `job_id`. Token nhập tay cần `account_uid`; callback web gửi `state` thay cho UID tự khai báo. `/fetch-tokens` giữ tên trường `user_token` để tương thích.
- `GET /api/pages/sync-jobs/{job_id}` trả trạng thái/progress/result/error cho đúng owner. Trạng thái: `QUEUED`, `RUNNING`, `AWAITING_CONFIRMATION`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Luồng web cũ/token nhập tay chưa liên kết cần xác nhận danh tính Facebook (tên và App-scoped ID) với UID đã chọn qua `POST /sync-jobs/{job_id}/confirm`, body `{"accept": true}` hoặc `false`. Kết nối account Module 2 đã tồn tại không được thay sang danh tính khác.
- Chrome profile kiểm tra `c_user` trước/sau OAuth. Callback profile giữ nguyên fragment, không gọi API đồng bộ. Worker giữ khóa owner/profile đến khi xác thực, quét và lưu xong; người dùng cấp quyền trong cửa sổ Chrome. Không tự chạy lại consent.
- Hai worker xử lý tối đa hai tác vụ OAuth/đồng bộ đồng thời; hàng đợi và xác nhận đang chờ được giới hạn. Job/result ở bộ nhớ process; restart engine làm mất job đang chờ, không tự chạy lại OAuth. Kết quả hoàn tất và xác nhận liên kết được giữ tối đa 10 phút. Không chạy nhiều engine process cùng phục vụ một giao diện polling.

Không API Module 5 nào trả User/Page Token. `/accounts` chỉ trả `has_token`. User Token chỉ được đổi một lần mỗi tác vụ; `/me/accounts` không đổi token. Phân trang được kiểm tra, Page trùng được loại, Page thiếu dữ liệu/token làm hỏng cả lần quét. Metadata từ `debug_token` được lưu riêng cho User/Page Token. Chỉ `is_valid=true` cùng `expires_at=0` mới hiển thị không có ngày hết hạn cố định; token vẫn có thể bị thu hồi.

## Dữ liệu và migration

`init_models()` gọi migration `meta_owner_v1` trong transaction có advisory lock. Giữ nguyên ID, đổi khóa Page thành `(user_id, page_id)`; tiến độ, dữ liệu tải, job item cũng có khóa chứa owner. Lịch và lịch sử có `user_id`. Backfill chỉ khi Page/account xác định được một owner; dữ liệu không rõ owner giữ `NULL`, không đưa vào danh sách/job. Không xóa dữ liệu cũ để xử lý trùng.

Token account, liên kết App-scoped ID và toàn bộ Page được lưu trong một transaction sau khi xác thực/quét hoàn tất. Lỗi DB rollback cả lần đồng bộ. Không sửa `status`/`login_status` Module 2. Trong cùng owner, Page dùng account của lần lưu thành công gần nhất.

Reels lấy lại Page/token từ DB theo owner; API bỏ qua token, tên và account do frontend gửi. Runner/log/progress/history được tách theo owner. Worker Qt cũ lấy Page từ DB và cần owner; downloader ghi `downloaded_videos`/`download_logs`, dùng thư mục riêng theo owner. Các import từ thư mục `core/` cũ trỏ về cùng implementation, không dùng `videos.db`/`posting_progress.json` chung nữa. File cũ không bị xóa và không được tự nạp vào job; importer JSON một lần khi DB trống vẫn giữ dữ liệu không rõ owner ở vùng không hiển thị.

## Kiểm thử

Từ thư mục `fb-automator-core`:

```powershell
.venv/Scripts/python.exe scripts/test_module5_offline.py
.venv/Scripts/python.exe -m modules.module_02_account_manager.tests.run_suite
node --test --test-isolation=none frontend/tests/tokenExpiry.test.mjs frontend/tests/webOAuth.test.mjs
.venv/Scripts/python.exe scripts/build_frontend_threads.py
```

Runner offline không mở pool production; các test SQL dùng DB tạm riêng. Build helper dùng worker thread rồi phục hồi nguyên nội dung `next.config.mjs`. Build hiện còn cảnh báo có sẵn về `@tauri-apps/api/dialog`.

Kiểm thử PostgreSQL thực cần `MODULE5_TEST_DATABASE_URL` trỏ tới DB thử nghiệm, sau đó chạy `scripts/check_module5_postgres.py`. Script tạo/xóa duy nhất schema ngẫu nhiên `module5_test_*`, kiểm tra migration lặp, giữ ID, tách owner, rollback và state một lần; không lấy `DATABASE_URL` production làm mặc định.

Kiểm thử callback trên frontend đã build: phục vụ `frontend/out` ở `http://127.0.0.1:8788`, rồi chạy `scripts/check_meta_callback_ui.py`. Script chặn toàn bộ API bằng dữ liệu giả và kiểm tra fragment profile, phiên web, xác nhận danh tính, hủy quyền và phiên hết hạn.

Kiểm thử popup mới: `scripts/check_meta_popup_ui.py` trên cùng frontend đã build. Script chặn cả Meta và API, mô phỏng API tài khoản đang chờ, mất opener, xác nhận tại callback, callback reload không dùng lại state, tự đóng popup, giữ modal/bộ lọc, quét token chưa kiểm tra, quét lại, đổi thất bại, popup bị chặn và phục hồi/hủy sau reload. Không đăng nhập Facebook thật. Unit test tải/cache: `node --test --test-isolation=none frontend/tests/accountResource.test.mjs`.

Đợt nâng cấp popup: bộ offline Module 5/liên quan đạt 94 test; toàn bộ Module 2 đạt 139 test, bỏ qua 5 test; 7 test frontend về popup/thời hạn token đạt; lint các file frontend mới và callback đạt; frontend build/export đạt. Chưa chạy PostgreSQL integration vì thiếu `MODULE5_TEST_DATABASE_URL`. Chưa nghiệm thu popup/OAuth thật vì công cụ UI không có browser khả dụng trong môi trường này. Chưa áp dụng migration mới lên production trong phiên này; backend sẽ gọi migration khi khởi động lại.
