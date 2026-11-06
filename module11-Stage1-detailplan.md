# Plan chi tiết Giai đoạn 1 — Module 10 Page Scanner: Tìm Page (từ khóa / link / import) + đếm + khử trùng
Phiên bản 22/10/2026. Đầu vào đã chốt: project chưa có route cho phần này (phải tạo mới cả API lẫn frontend), user có 2 tài khoản ở Module 02, và hiện tượng thực tế user đã gặp khi tự search thử: càng scroll xuống cuối, kết quả càng bị lặp lại liên tục.

## 0. Mục tiêu và ngoài phạm vi
Mục tiêu GĐ1: từ 1 từ khóa (hoặc danh sách link / file import) tạo ra một danh sách Page DUY NHẤT, đếm đúng tổng số, lưu xuống DB, biết rõ phiên quét dừng vì lý do gì.
Ngoài phạm vi: quét sâu SĐT/email/website (GĐ3), follow (GĐ4), bài viết (GĐ5), lọc tích xanh ở mức chắc chắn (GĐ1 chỉ ghi nhận dấu hiệu tích xanh trên thẻ, xem mục 6).

## 1. Route phải tạo mới (chưa có sẵn)
### 1.1 Backend — file mới `modules/module_10_page_scanner/api/router.py`
`APIRouter(prefix="/api/page-scanner", tags=["Module 10: Page scanner"])`, đăng ký trong `engine.py` bằng `app.include_router(...)` + thêm bước startup `init_models()` — đúng mẫu Module 07 (`/api/groups`).

Endpoint thuộc GĐ1:
- POST `/api/page-scanner/source/search` — chạy phiên tìm Page theo từ khóa. Input: `{keyword, account_uid?, max_results, include_sponsored?}`. Output: `{session_id, count, pages[], stop_reason}`.
- POST `/api/page-scanner/source/parse` — dán nhiều link (mỗi dòng 1 link) → chuẩn hoá/khử trùng/thống kê.
- POST `/api/page-scanner/source/upload` — upload .txt/.csv (CSV nhận cột `page_url`, map thêm `link | url | fanpage`).
- GET `/api/page-scanner/source/template` — tải file mẫu.
- GET `/api/page-scanner/sessions` và GET `/api/page-scanner/sessions/{id}` — lịch sử + chi tiết phiên: tiến độ theo batch, tổng tìm thấy, số trùng đã loại, lý do dừng.
- GET `/api/page-scanner/pages?session_id=...` — danh sách Page của 1 phiên (phân trang).
- POST `/api/page-scanner/sessions/{id}/stop` — dừng phiên đang chạy (worker).

Kiểm tra kèm theo: đọc `modules/module_auth/router.py` để xác nhận prefix mới có cần đăng ký phân quyền module (`assert_request_module_access`) hay không — làm ở bước tích hợp, trước khi coi API là xong.

### 1.2 Frontend — tạo mới hoàn toàn
- `frontend/src/modules/module_10_page_scanner/` (index.jsx, service.js, components) — service gọi API qua `frontend/src/services/api.js` theo quy tắc team.
- Route trang: `frontend/src/app/scanner/search/page.js` và `frontend/src/app/scanner/history/page.js` (theo cách suy path từ navigation id như các module khác).
- Đăng ký: thêm entry trong `frontend/src/modules/index.js` và nhóm menu "Quét Dữ Liệu Page" trong `frontend/src/config/navigation.js`.
Thứ tự làm: API xong và test bằng Swagger trước, frontend làm sau trong cùng giai đoạn (mục 9, bước 5).

## 2. Luồng xử lý một phiên search theo từ khóa
1. Nhận request → kiểm tra từ khóa rỗng/giới hạn độ dài, `max_results` trong [1, 500].
2. Chọn tài khoản quét (mục 5) → kiểm tra tiền đề (preflight): acc tồn tại trong Module 02, status khác DIE, có cookie/profile, không bị profile lock bởi module khác, không trong cooldown của Account Limiter.
3. Tạo bản ghi phiên `page_scan_sessions` với status=RUNNING, ghi account_uid, keyword, cấu hình.
4. Mở trình duyệt qua `core/browser`: tái sử dụng driver đang mở của đúng acc đó nếu có (`get_active_drivers`), nếu chưa thì giữ `get_profile_lock` rồi `open_browser(uid, owner, proxy, scope="page_scanner", allow_direct_fallback=False)`, nạp cookie bằng `load_cookies` — mirror `search_facebook_via_browser()` của Module 07. POC để `headless=False` để quan sát trực tiếp vòng scroll (khác Module 07 đang để headless=True; chuyển thành cấu hình sau khi ổn).
5. Vào `https://www.facebook.com/search/pages/?q=<keyword đã encode>` → chờ danh sách kết quả chính xuất hiện.
6. Vòng thu hoạch chống lặp (mục 3 — phần trọng tâm) → lưu DB tăng dần theo từng batch (mục 7).
7. Kết thúc: cập nhật phiên COMPLETED / PARTIAL / STOPPED / FAILED + `stop_reason`, nhả profile lock, đóng driver nếu driver do phiên tự mở.

## 3. TRỌNG TÂM — Chống lặp kết quả khi scroll
### 3.1 Vì sao bị lặp (3 nguyên nhân, đều phải xử lý)
- **DOM bị ảo hoá/tái chế:** Facebook chỉ giữ một cửa sổ thẻ kết quả trong DOM; scroll tiếp thì node cũ bị gỡ/tái sử dụng. Scroll một mạch xuống đáy rồi mới trích xuất (cách Module 07 đang làm: scroll 2–4 lần kiểu `scrollTo(bottom)` rồi trích 1 lần) sẽ bỏ sót thẻ đã bị gỡ và dễ dính lại thẻ cuối.
- **Vòng lặp gợi ý khi hết kết quả thật:** đến cuối danh sách thật, Facebook không dừng mà chèn tiếp khối gợi ý/trang liên quan và có thể quay vòng lại các Page đã hiện — cuộn bao lâu cũng thấy "kết quả mới" nhưng thực chất là bản sao.
- **Một Page, nhiều bộ mặt:** cùng 1 Page xuất hiện ở mục kết quả chính, mục được tài trợ, mục liên quan; link của nó cũng có nhiều dạng (`/tenpage`, `profile.php?id=...`, `/pages/Tên/123...`, kèm tham số tracking) nên khử trùng theo chuỗi URL thô là không đủ.

### 3.2 Nguyên tắc xử lý
- **Thu hoạch theo batch:** scroll 1 nấc → chờ ổn định → trích xuất toàn bộ thẻ đang có → gộp vào kho kết quả → mới scroll tiếp. Không bao giờ scroll liên tục rồi trích 1 lần cuối.
- **Scroll từng nấc nhỏ:** mỗi nấc cuộn khoảng 80–90% chiều cao viewport (không nhảy thẳng xuống đáy trang), nghỉ ngẫu nhiên bằng `human_sleep(min, max, config=driver.browser_config)` (nhịp riêng của nick từ core/browser), chờ đến khi số thẻ hoặc chiều cao trang ổn định hoặc hết timeout ngắn.
- **Khóa định danh chuẩn `page_key`** (mục 3.3): mọi khử trùng, đếm và lưu DB đều theo page_key, không theo URL thô.
- **Đếm "mới thật" sau mỗi batch** và dùng nó làm tín hiệu dừng (mục 3.4), không dựa vào scrollHeight đơn thuần.

### 3.3 Chuẩn hoá page_key — `page_source.clean_page_url()` + `extract_page_identifier()`
Mirror `clean_group_url()/extract_group_identifier()` của Module 07, áp quy tắc:
- Bỏ toàn bộ query (`?mibextid`, `?ref`, ...) và dấu `/` cuối; host `m.facebook.com` / `fb.com` → `www.facebook.com`.
- `profile.php?id=123456` → key `id:123456`.
- `facebook.com/pages/<tên>/<id số>` → key `id:<id số>` (bỏ phần tên).
- `facebook.com/<username>` (1 đoạn path) → key `user:<username viết thường>`.
- Link con (`/<username>/about`, `/photos`, ...) → cắt về link gốc của Page trước khi lấy key.
- Loại slug hệ thống như Module 07 đã làm: search, watch, marketplace, gaming, events, help, login...
- Nếu 1 thẻ không lấy được cả id lẫn username: giữ tạm bằng key dự phòng từ URL đã chuẩn hoá và đánh dấu `identifier_quality=weak` — không tự gộp theo tên (tránh gộp nhầm 2 Page trùng tên).

### 3.4 Thuật toán vòng scroll (giả mã)
```
kho = {}                      # page_key -> page record
seen_batch_signatures = set() # chữ ký của từng batch
no_new_streak = 0
batch_no = 0
while True:
    batch_no += 1
    cards = extract_cards(driver)          # chỉ trong vùng kết quả chính, xem mục 6
    keys_batch = [page_key(c) for c in cards if valid]
    new_keys = [k for k in keys_batch if k not in kho]
    merge(new_keys vào kho); lưu DB tăng dần cho batch này
    ghi log batch: {batch_no, dom_cards, new_unique, duplicates, cumulative_unique, scroll_height}

    if len(kho) >= max_results: stop("TARGET_REACHED")
    signature = frozenset(keys_batch)
    if signature in seen_batch_signatures: stop("CYCLE_DETECTED")
    seen_batch_signatures.add(signature)
    if len(new_keys) == 0:
        no_new_streak += 1
        if no_new_streak >= NO_NEW_LIMIT (mặc định 3): stop("NO_NEW_RESULTS")
    else:
        no_new_streak = 0
    if thấy dòng hết kết quả của Facebook: stop("END_MARKER")
    if batch_no >= MAX_SCROLL_BATCHES: stop("MAX_SCROLLS")
    if elapsed > MAX_DURATION: stop("TIMEOUT")
    if checkpoint/captcha/mất đăng nhập: stop("CHECKPOINT")  # phiên PARTIAL, giữ kết quả đã lưu
    scroll_one_step(); human_sleep(...)
```

### 3.5 Thông số mặc định (để trong settings của module, chỉnh được)
- `max_results`: mặc định 100, tối đa 500.
- `no_new_streak_limit`: 3 batch liên tiếp không có Page mới.
- `max_scroll_batches`: 100 batch/phiên.
- `max_duration_sec`: 480 giây/từ khóa.
- `scroll_step_ratio`: 0.85 viewport; `scroll_pause`: human_sleep 1.5–3.5 giây.
- `include_sponsored`: False (thẻ "Được tài trợ/Sponsored" bị loại khỏi đếm, có ghi nhận số lượng bị loại).

### 3.6 Kiểm chứng chống lặp (test bắt buộc, không cần Facebook thật)
Unit test bằng dãy batch giả lập:
- Chu kỳ A→B→A→B: phải dừng ở CYCLE_DETECTED, tổng unique đúng.
- Các batch chồng lấp 50% (mô phỏng DOM ảo hoá): hợp nhất phải đủ, không mất Page ở giữa.
- Cùng 1 Page với 3 dạng link khác nhau: chỉ còn 1 bản ghi.
- Chuỗi batch toàn Page cũ: dừng ở NO_NEW_RESULTS sau đúng 3 batch.

## 4. Parser thẻ Page (dữ liệu nông của GĐ1)
Chỉ trích trong vùng kết quả tìm kiếm chính (container kết quả), bỏ qua cột phải/khối gợi ý ngoài danh sách.
Mỗi thẻ lấy: page_name, page_url (đã chuẩn hoá), page_key, avatar_url, category (dòng mô tả kiểu "Trang · Dịch vụ..."), follower_count (parse từ chữ kiểu "1,2 nghìn người theo dõi", "12K followers", "3,4 triệu..." — theo cách parse số thành viên của Module 07), is_verified_sơ_bộ, is_sponsored, vị trí thứ tự xuất hiện đầu tiên.
Tích xanh ở GĐ1: tìm biểu tượng xác minh trong container thẻ (svg/title/aria-label kiểu "Verified/Đã xác minh"). Không chắc chắn thì ghi `null` (chưa rõ) chứ không ghi `false` — kết luận tích xanh chính thức để GĐ3 xác minh khi vào sâu. Thống kê cuối phiên phải báo rõ bao nhiêu Page đọc được tích xanh ở mức sơ bộ.

## 5. Dùng 2 tài khoản ở Module 02
- Request có `account_uid` tuỳ chọn; giao diện có dropdown chọn acc lấy từ danh sách tài khoản Module 02 (hiện tên hiển thị, UID, trạng thái, proxy). Không truyền thì hệ thống tự chọn theo vòng quay: acc đủ điều kiện preflight, ít dùng nhất trong ngày (không mặc định lấy acc đầu tiên như hàm mẫu của Module 07).
- **1 phiên = 1 acc, từ đầu đến cuối.** Không đổi acc giữa chừng trong một vòng scroll (đổi acc là đổi phiên xếp hạng/kết quả, làm tình trạng lặp và sai lệch khó kiểm soát).
- Acc chết/checkpoint giữa phiên: phiên đóng PARTIAL với dữ liệu đã lưu; muốn quét tiếp từ khóa đó bằng acc còn lại thì mở PHIÊN MỚI, kết quả gộp theo page_key và mỗi Page ghi nhận `first_found_by_account_uid` + danh sách acc đã từng thấy (bảng liên kết phiên–Page ở mục 7).
- Nhiều từ khóa: phân bổ theo vòng quay cho 2 acc (mỗi từ khóa 1 acc), chạy TUẦN TỰ ở POC (1 trình duyệt tại 1 thời điểm cho ổn định và tránh liên kết hành vi trên cùng IP; song song để sau nếu cần).
- Giới hạn ngày cho riêng hành động search (Account Limiter áp một phần ngay ở GĐ1): mặc định POC theo hạng B — tối đa 10 phiên search/acc/ngày, và vẫn bị chặn bởi max_scroll_batches/max_duration ở trên. Hạng acc chính thức của 2 acc sẽ phân loại sau, số này chỉnh trong settings.

## 6. Lưu trữ + thống kê cuối phiên
- Tạo phiên trước khi scroll, **lưu tăng dần theo batch** (upsert theo `owner_key + page_key` vào `scanned_pages`), máy tắt/engine crash giữa chừng không mất phần đã quét.
- Bảng liên kết `page_scan_session_pages (session_id, page_key, batch_index, is_new_globally)` để trả lời chính xác "phiên này tìm được những Page nào, Page nào là mới hoàn toàn, Page nào đã có từ phiên trước".
- Thống kê bắt buộc của 1 phiên: tổng thẻ DOM đã thấy, tổng Page unique, số thẻ trùng bị loại, số sponsored bị loại, số batch đã scroll, stop_reason, acc đã dùng, thời lượng. Đây là căn cứ để kiểm chứng vấn đề lặp của user bằng số, không bằng cảm giác.
- Nguồn link/import (parse/upload) dùng chung kho `scanned_pages` và cùng bộ chuẩn hoá page_key với nguồn search, nên 3 nguồn gộp nhau không bị trùng.

## 7. Những thứ KHÔNG copy từ Module 07 (rút kinh nghiệm)
- Không copy cơ chế fallback dữ liệu mẫu: Module 07 khi cào thất bại sẽ trả về danh mục nhóm dựng sẵn, thậm chí tạo nhóm giả. Module 10: cào thất bại thì trả rỗng + phiên FAILED/PARTIAL kèm lý do — tuyệt đối không có dữ liệu giả trong kết quả khảo sát.
- Không scroll nhảy xuống đáy + trích 1 lần (nguyên nhân sót/lặp, xem 3.1).
- Không dùng `time.sleep` cố định: dùng `human_sleep` của core/browser.
- Không để mặc định headless trong POC (cần nhìn thấy vòng scroll để kiểm chứng chống lặp).

## 8. Thứ tự triển khai GĐ1 (từng bước có tiêu chí đạt)
- Bước 0 — Route khung: tạo package module_10 + router rỗng prefix `/api/page-scanner` + đăng ký engine/registry + kiểm tra phân quyền module_auth. Đạt khi: engine khởi động không lỗi, Swagger thấy tag Module 10.
- Bước 1 — Hàm thuần `page_source` (clean/extract/parse file) + unit tests (gồm bộ test chống gộp nhầm ở 3.6 phần URL). Đạt khi: tests xanh, chưa cần trình duyệt.
- Bước 2 — Vòng search + thu hoạch chống lặp (mục 3) chạy với 1 acc, 1 từ khóa. Đạt khi: từ khóa ngách ít kết quả (khoảng 10–20 Page) tự dừng bằng NO_NEW_RESULTS hoặc CYCLE_DETECTED trong thời gian hữu hạn — không chạy vô hạn; đối chiếu số unique với đếm tay trên màn hình không lệch.
- Bước 3 — Lưu DB tăng dần + API sessions/pages. Đạt khi: tắt engine giữa phiên, mở lại vẫn còn Page đã quét và phiên mang trạng thái đúng.
- Bước 4 — Nguồn link/import (parse + upload txt/csv + template). Đạt khi: file test 500 dòng có trùng + lỗi cho ra đúng 4 con số thống kê (hợp lệ / trùng / lỗi / tổng dòng).
- Bước 5 — Route frontend + UI tối thiểu: chọn acc (dropdown 2 acc Module 02), nhập từ khóa, max_results, bảng kết quả, hiển thị stop_reason và thống kê trùng. Đạt khi: chạy trọn luồng trên UI không cần Swagger.
- Bước 6 — Phân bổ 2 acc + failover phiên mới + đếm limiter cho search. Đạt khi: chạy 2 từ khóa, hệ thống tự chia mỗi acc 1 từ khóa; ép 1 acc lỗi, phiên PARTIAL được giữ và quét lại bằng acc còn lại không tạo Page trùng.

## 9. Tiêu chí nghiệm thu toàn GĐ1
1. Từ khóa lớn: đạt đúng max_results, dừng TARGET_REACHED.
2. Từ khóa nhỏ: tự dừng sớm, stop_reason thuộc {NO_NEW_RESULTS, CYCLE_DETECTED, END_MARKER} — không bao giờ treo vô hạn.
3. Cùng 1 Page 3 dạng link = 1 bản ghi trong mọi nguồn (search/link/import).
4. Mọi phiên đều truy vết được: acc nào, bao nhiêu batch, bao nhiêu trùng đã loại, dừng vì sao.
5. Không có bất kỳ dữ liệu mẫu/giả nào trong kết quả khi trình duyệt lỗi.

## 10. Bổ sung nguồn thứ 4 — Tìm Page theo hashtag (22/10/2026)

### 10.1 Bản chất (khác hẳn tìm theo từ khóa)
Trang hashtag của Facebook (`facebook.com/hashtag/<tag>`) và tab Bài viết của search KHÔNG trả về danh sách Page — chúng trả về danh sách BÀI VIẾT chứa hashtag đó. Vì vậy không thể lấy Page trực tiếp từ hashtag, mà phải đi vòng 2 bước:
**Hashtag → quét bài viết chứa hashtag → rút tác giả của từng bài → chỉ giữ tác giả là Page → chấm điểm liên quan → Page liên quan thật.**
Nếu bỏ bước chấm điểm, kết quả sẽ lẫn rất nhiều Page đăng 1 bài vu vơ gắn hashtag, profile cá nhân, và bài trong Group.

### 10.2 Chuẩn hoá hashtag đầu vào
- Nhận 1 hoặc nhiều hashtag; bỏ dấu `#`, bỏ khoảng trắng (hashtag không chứa khoảng trắng — nếu user nhập cả cụm có dấu cách thì gợi ý chuyển sang tìm theo từ khóa hoặc nối từ), viết thường để làm khóa gộp.
- **Mỗi URL `/hashtag/` chỉ chứa ĐÚNG 1 hashtag.** Danh sách nhiều hashtag phải TÁCH theo dấu phẩy / dấu cách / xuống dòng thành nhiều hashtag riêng, mỗi hashtag chạy 1 lượt quét riêng rồi mới gộp điểm. TUYỆT ĐỐI không nối danh sách vào 1 URL — ví dụ lỗi đã gặp thực tế (22/10/2026): `facebook.com/hashtag/thoitrang%2C%23mypham` (giải mã là 1 hashtag tên `thoitrang,#mypham`, chứa dấu phẩy và dấu # ở giữa — ký tự không hợp lệ trong tên hashtag) khiến Facebook trả trang "This content isn't available right now". URL đúng phải là `/hashtag/thoitrang` và `/hashtag/mypham` riêng biệt. Muốn tìm bài chứa ĐỒNG THỜI 2 hashtag thì dùng search bài viết với query `#thoitrang #mypham` (dấu # lúc này nằm trong tham số `q=` và được encode thành %23 — hợp lệ), không dùng đường dẫn `/hashtag/`.
- Tên 1 hashtag hợp lệ chỉ gồm chữ, số, dấu gạch dưới (và chữ có dấu); gặp ký tự `, # / ? &` ở giữa tên là lỗi đầu vào, hệ thống phải báo rõ thay vì chạy quét.
- KHÔNG tự gộp biến thể có dấu/không dấu (`#thờitrang` và `#thoitrang` là 2 hashtag khác nhau trên Facebook): user nhập biến thể nào chạy biến thể đó, điểm của Page được cộng dồn xuyên các biến thể trong cùng phiên.
- Từ khóa ngữ cảnh tuỳ chọn (`context_keywords`): khi hashtag quá chung (ví dụ `#review`, `#sale`), khuyến nghị bắt buộc có thêm từ khóa ngành để chấm điểm — Page phải khớp ngữ cảnh mới đạt chuẩn (xem 10.5).

### 10.3 Quét bài viết theo hashtag
- Mở `facebook.com/hashtag/<tag>`; nếu trang hashtag không khả dụng thì dùng tab Bài viết: `facebook.com/search/posts/?q=%23<tag>`.
- **Nhận diện trang lỗi:** nếu trang trả về thông điệp "This content isn't available right now" (hoặc bản tiếng Việt tương đương) thì phiên phải ghi `stop_reason=HASHTAG_UNAVAILABLE` và thử ngay đường search bài viết ở trên, KHÔNG được ghi nhận là "0 kết quả" — 0 kết quả thật và hashtag không mở được là 2 chuyện khác nhau, ghi sai là user tưởng hashtag không có Page nào liên quan.
- Dùng NGUYÊN vòng thu hoạch chống lặp của mục 3, nhưng khóa khử trùng đổi thành post_id/post_url (feed hashtag còn lặp nặng hơn feed search Page): scroll từng nấc, thu theo batch, dừng theo TARGET (đủ `max_posts_per_hashtag`) / NO_NEW (3 batch không có bài mới) / CYCLE / trần batch / trần thời gian / checkpoint.
- Mỗi bài trích: post_id, post_url, thời gian đăng, nội dung (rút gọn), toàn bộ hashtag trong bài, lượt tương tác, tác giả (tên + link).
- **Kiểm tra hashtag khớp chính xác:** chỉ tính bài mà nội dung/hashtag của bài chứa đúng hashtag đang quét. Bài Facebook gợi ý thêm nhưng không chứa hashtag (mục liên quan) bị đánh dấu `exact_match=false` và KHÔNG tính điểm — đây là nguồn gây "tìm không đúng Page" lớn nhất nếu bỏ qua.

### 10.4 Phân loại tác giả: Page / Profile / Group
Mỗi bài rút ra 1 tác giả; chỉ tác giả là Page mới đi tiếp. Phân loại 2 tầng:
- Tầng nhanh (ngay trên thẻ bài): dấu hiệu Page — dòng phụ dưới tên tác giả có hạng mục/người theo dõi, nút Thích/Theo dõi kiểu Page; dấu hiệu loại trừ — bài thuộc Group (có tên Group trong ngữ cảnh bài → tác giả là thành viên đăng trong Group, loại), tác giả là profile cá nhân.
- Tầng xác minh (chỉ chạy cho tác giả ứng viên đã gom được, số lượng ít): mở link tác giả, kiểm tra marker của Page (hạng mục "Trang • ...", số người theo dõi, bố cục nút của Page) → gán `author_type=PAGE` và độ tin cậy. Ứng viên không qua được tầng này thì không vào kết quả, dù tầng nhanh nghi là Page.
Kết quả phân loại lưu kèm lý do để truy vết khi user thắc mắc 1 Page nào đó lọt/không lọt.

### 10.5 Gom theo Page + chấm điểm liên quan (relevance score)
Gom mọi bài theo `page_key` của tác giả (cùng bộ chuẩn hoá ở mục 3.3), tính:
- `hashtag_post_count`: số bài KHỚP CHÍNH XÁC hashtag của Page đó trong mẫu đã quét.
- `matched_hashtags`: số hashtag khác nhau (trong danh sách user nhập) mà Page có bài khớp.
- `latest_post_at`: bài khớp hashtag gần nhất.
- `evidence_posts`: tối đa 3 link bài làm bằng chứng cho mỗi Page (bắt buộc lưu — user mở ra kiểm chứng được ngay vì sao Page này được coi là liên quan).
Điểm mặc định (thang 100, chỉnh được trong settings):
- Tần suất: +10/bài khớp, tối đa +40.
- Có bài ở ≥2 hashtag khác nhau của phiên: +15.
- Tên Page chứa hashtag hoặc từ khóa ngữ cảnh: +20.
- Nội dung giới thiệu/hạng mục Page chứa từ khóa ngữ cảnh (nếu đã có dữ liệu): +15.
- Bài khớp gần nhất trong 30 ngày: +10.
Ngưỡng xếp loại:
- Điều kiện cứng trước khi tính điểm: `hashtag_post_count >= min_posts` (mặc định 2). Page chỉ có đúng 1 bài gắn hashtag thì không đạt, trừ khi tên Page chứa hashtag/từ khóa ngữ cảnh.
- Score ≥ 40: **Liên quan** — vào danh sách kết quả chính.
- Score 20–39: **Cần xem lại** — vào danh sách riêng để user tự duyệt (kèm evidence_posts).
- Score < 20 hoặc không qua điều kiện cứng: loại, vẫn ghi thống kê số lượng bị loại kèm lý do.

### 10.6 Gộp vào kho chung + API + dữ liệu
- Page từ hashtag đổ vào `scanned_pages` như mọi nguồn, thêm: `source_type='hashtag'`, `relevance_score`, `matched_hashtags`, `hashtag_post_count`, `evidence_posts` (ở bảng liên kết phiên–Page). Khử trùng xuyên nguồn theo page_key như cũ (Page vừa có từ từ khóa vừa có từ hashtag thì gộp 1 bản ghi, cộng nguồn).
- Endpoint mới: POST `/api/page-scanner/source/hashtag-search` — input `{hashtags[], account_uid?, max_posts_per_hashtag=100, min_posts=2, context_keywords[]}`; output gồm 2 danh sách (Liên quan / Cần xem lại) + thống kê đã loại và lý do.
- Thống kê phiên hashtag bắt buộc: tổng bài đã quét, số bài khớp chính xác, số tác giả rút ra, số tác giả là Page, số Page đạt / cần xem lại / bị loại.

### 10.7 Giới hạn phải nói thẳng
- Feed hashtag được cá nhân hoá theo acc và trộn bài mới/bài nổi bật, nên kết quả giữa 2 acc và giữa 2 thời điểm sẽ khác nhau — đây là mẫu khảo sát theo thời điểm, không phải danh sách tuyệt đối.
- Độ đúng phụ thuộc cỡ mẫu: `max_posts_per_hashtag` càng lớn thì tần suất (và điểm) càng đáng tin nhưng càng tốn thời gian và rủi ro acc; mặc định 100, tối đa 300/hashtag ở POC.
- Hashtag bị spam nặng (các Page bán hàng gắn hashtag câu view) chỉ giảm được bằng điều kiện cứng min_posts + từ khóa ngữ cảnh + evidence, không loại tuyệt đối được; vì vậy danh sách "Cần xem lại" luôn tồn tại thay vì tự quyết hết.

### 10.8 Test bắt buộc cho nguồn hashtag
- Bài chứa hashtag gần giống nhưng không khớp chính xác → không tính điểm.
- Page có 1 bài gắn hashtag duy nhất, tên không liên quan → bị loại bởi điều kiện cứng.
- Page có 5 bài khớp, 2 hashtag → đạt "Liên quan", evidence_posts có đủ link kiểm chứng.
- Tác giả là profile cá nhân / bài trong Group → bị loại ở tầng phân loại, không vào gom điểm.
- Feed hashtag lặp chu kỳ → dừng CYCLE_DETECTED như test ở mục 3.6.

## 11. Tìm kiếm LINH HOẠT kết hợp từ khóa + hashtag (bổ sung 23/10/2026)
Vấn đề thực tế user nêu: tìm theo từ khóa (tab Trang) thì Page nhiều follower nằm rải rác theo thứ hạng khó hiểu của Facebook, scroll gặp hay không là "hên xui"; tìm theo hashtag thì các Page lớn thường không dùng hashtag trong bài nên bị sót. Kết luận thiết kế: KHÔNG chọn 1 trong 2 — cả hai chỉ là *kênh phát hiện*, phải tách khâu TÌM THẤY khỏi khâu XẾP HẠNG.

### 11.1 Nguyên tắc cốt lõi: gom pool rộng, tự xếp hạng trong DB của mình
- Facebook quyết định thứ tự hiển thị, mình không can thiệp được — nên đừng kỳ vọng scroll 1 truy vấn là gặp Page lớn theo thứ tự. Thay vào đó: thu thập một pool lớn từ NHIỀU kênh/biến thể (11.2), mọi thẻ đều đã có `follower_count` (đã parse ở mục 4), sau đó TỰ sắp xếp giảm dần theo follower và lọc ngưỡng tối thiểu (ví dụ ≥10K) ngay trong DB/UI của mình. Page lớn chỉ cần xuất hiện ĐÚNG 1 LẦN ở bất kỳ kênh/biến thể nào là sẽ nổi lên đầu khi xếp hạng — yếu tố hên xui bị triệt tiêu ở khâu xếp hạng, không còn phụ thuộc thứ tự scroll.
- Hệ quả cho điều kiện dừng: mỗi truy vấn chỉ cần quét tới trần riêng của nó (mục 3.5), không cần scroll 1 truy vấn đến kiệt sức. Ngân sách scroll được chia cho nhiều truy vấn — mỗi truy vấn mới là một lần Facebook xáo lại thứ hạng, cho ra một mẫu kết quả khác.

### 11.2 Các kênh phát hiện trong 1 đợt chạy kết hợp (campaign)
1. **Từ khóa → tab Trang** (kênh chính bắt Page lớn/đã thành danh, kể cả Page không bao giờ gắn hashtag).
2. **Biến thể từ khóa** — từ 1 từ khóa gốc tự sinh các biến thể, mỗi biến thể là 1 phiên riêng: bỏ dấu (`thoi trang`), thêm từ ngành (`shop thời trang`, `cửa hàng thời trang`), thêm địa điểm (`thời trang Hà Nội`), thêm đối tượng (`thời trang nữ`), bản tiếng Anh nếu có (`fashion vietnam`). Đây là đòn chính trị "hên xui": 5 biến thể = 5 mẫu xếp hạng khác nhau gộp lại.
3. **Từ khóa → tab Bài viết** → rút tác giả như luồng hashtag: bắt Page đang hoạt động về chủ đề dù tên Page không chứa từ khóa.
4. **Hashtag → bài viết → tác giả** (mục 10): bắt Page ngách đang hoạt động thật; kèm chấm điểm liên quan như cũ.
5. **Chạy cùng từ khóa trên cả 2 acc Module 02:** thứ hạng tìm kiếm được cá nhân hoá theo acc, nên 2 acc cho 2 mẫu kết quả khác nhau. Cùng 1 từ khóa chạy ở acc thứ hai là 1 phiên riêng, gộp theo page_key (bổ sung cho nguyên tắc "1 phiên 1 acc" ở mục 5 — không đổi acc giữa phiên, nhưng được nhân đôi phiên theo acc để tăng độ phủ).
Tất cả các kênh đổ vào chung `scanned_pages` + `page_scan_session_pages` như hiện tại; mỗi Page ghi nhận đến từ kênh nào. Page xuất hiện ở ≥2 kênh (ví dụ vừa có ở tab Trang vừa có bài khớp hashtag) là tín hiệu tin cậy mạnh nhất — hiển thị huy hiệu nguồn trên UI (Từ khóa / Hashtag / Cả hai).

### 11.3 Vòng phản hồi: tự khai thác hashtag THẬT từ Page hạt giống
Điểm mù của hashtag là "Page lớn không dùng hashtag này" — nhưng họ vẫn dùng MỘT SỐ hashtag khác trong bài của mình. Sau khi kênh từ khóa tìm được các Page hạt giống (follower cao, đúng ngành), đến GĐ5 khi quét bài viết của chính các Page đó, hệ thống trích toàn bộ hashtag họ thực dùng, đếm tần suất theo ngành → sinh "từ điển hashtag thật" của ngách. Đợt chạy sau dùng từ điển này cho kênh hashtag thay vì hashtag đoán mò. Hai kênh nuôi nhau: từ khóa tìm Page lớn → Page lớn cho hashtag thật → hashtag tìm thêm Page ngách đang hoạt động.

### 11.4 Điểm kết hợp (hybrid score) và 3 chế độ cho user chọn
Khi gộp nhiều kênh, xếp hạng mặc định theo điểm kết hợp (thang 100, chỉnh được):
- Follower: ≥1M +30; 500K–1M +25; 100K–500K +20; 50K–100K +15; 10K–50K +10; 1K–10K +5.
- Tên Page chứa từ khóa/hashtag: +20.
- Điểm liên quan hashtag (mục 10.5) quy đổi: ×0,3 (tối đa +30).
- Có tích xanh: +10. Xuất hiện ở ≥2 kênh: +10.
**Lọc follower do người dùng tự chọn số lượng (áp ở tầng kết quả, đổi lúc nào cũng được mà không phải quét lại):**
- `min_followers`: ngưỡng follower tối thiểu — nhập số tự do hoặc chọn nhanh 1K / 10K / 50K / 100K / 500K / 1M. Tuỳ chọn thêm `max_followers` để lấy khoảng giữa (ví dụ chỉ lấy Page 10K–100K, bỏ Page quá lớn).
- `result_limit` (Top N): sau khi sắp xếp follower giảm dần (hoặc theo điểm kết hợp), chỉ lấy N Page đầu — ví dụ "lấy 30 Page follow cao nhất". Đây là số khác hẳn `max_results` của phiên quét: `max_results` là trần của pool thu thập lúc scroll, còn Top N là số giữ lại sau lọc. UI phải hiển thị cả 3 con số để user biết chất lượng pool: pool có X Page → đạt ngưỡng follower: Y Page → đang hiển thị Top Z.
- Vì `scanned_pages.follower_count` đã là cột số có index, bộ lọc này chạy thẳng bằng SQL trên dữ liệu đã quét, đặt trước khi chạy (tự áp khi phiên xong) hay đổi sau khi chạy đều được.

UI cho 3 chế độ cấu hình sẵn:
- **Page lớn:** kênh 1+2+5, pool lớn, lọc follower ≥ ngưỡng user đặt, sắp xếp theo follower giảm dần. (Hashtag tắt.)
- **Page ngách đang hoạt động:** kênh 3+4 là chính, sắp xếp theo điểm liên quan, giữ ngưỡng min_posts.
- **Kết hợp (mặc định khuyến nghị):** chạy mọi kênh, sắp xếp theo điểm kết hợp, user lọc thêm theo follower/nguồn/điểm tối thiểu tuỳ ý.
Việc triển khai cần thêm duy nhất 1 thay đổi dữ liệu nhỏ: cột `campaign_id` trong `page_scan_sessions` để gom các phiên của cùng 1 đợt chạy kết hợp (đưa vào migration đợt sau cùng các bổ sung ở báo cáo phân tích DB).

## 12. Đặc tả giao diện màn "Quét thông tin page" (theo ảnh user chốt 23/10/2026)
Ảnh giao diện do user cung cấp là chuẩn để triển khai màn này. Số liệu trong ảnh (5 tài khoản, 1.450 page, tên Page, SĐT...) là dữ liệu mẫu (mock) — một số chỗ mock chưa khớp nhau (chip từ khóa khác danh sách cấu hình, kết quả toàn từ khóa "Mĩ phẩm") nên không lấy số liệu làm yêu cầu, chỉ lấy CẤU TRÚC và INPUT.

### 12.1 Phân tích toàn bộ input trong ảnh
**Card 1 — Chọn tài khoản & Thiết lập phiên quét:**
| Input | Kiểu | Giá trị trong ảnh | Ý nghĩa / map dữ liệu |
|---|---|---|---|
| Chọn tài khoản | Nút mở hộp chọn nhiều acc | "Đã chọn: 5 tài khoản" | Danh sách `account_uids` dự định dùng cho đợt chạy; phiên backend vẫn 1 acc/phiên (xem 12.5-Q2 về cơ chế luân phiên) |
| Phương thức quét | Tab 3 lựa chọn | Theo từ khóa / Nhập Link / Tải tệp (.txt/.csv) | `source_type`: SEARCH / PARSE / UPLOAD. 2 tab còn lại có input riêng (12.2) |
| Từ khóa mục tiêu | Ô nhập dạng chip, thêm/xoá từng từ khóa | 3 chip: "Bán hàng online", "marketing", "thời trang nam" + đếm "Đã chọn: 3 từ khóa" | Mỗi từ khóa = 1 phiên quét riêng; lưu vào `settings.keywords[]` của đợt chạy |
| Kiểm tra | Nút | — | Chức năng CHƯA RÕ — xem Q5 ở 12.6 |
| Bảng số lượng theo từ khóa | Bảng chỉ đọc | Từ khóa / Số page quét được / Trạng thái (Hoàn thành, Đang quét) | Tiến độ tổng hợp theo từng từ khóa của đợt chạy; cập nhật realtime khi đang chạy |

**Card 2 — Thiết lập cấu hình quét mục tiêu:**
| Input | Kiểu | Giá trị trong ảnh | Ý nghĩa / map dữ liệu |
|---|---|---|---|
| Đổi tài khoản mới khi quét được | Ô số có nút +/- | 50 ".../tài khoản" | Ngưỡng luân phiên acc: quét đủ N Page thì chuyển acc tiếp theo trong danh sách đã chọn — `settings.rotate_every` |
| Khoảng cách giữa các lần quét | 2 ô số (từ–đến) | 5 đến 10 giây | Giãn cách ngẫu nhiên giữa 2 lượt quét Page, truyền cho `human_sleep(min, max)` — `settings.delay_min_seconds / delay_max_seconds` |
| Áp dụng tất cả + Áp dụng | Ô số + nút | 30 | Gán nhanh cùng 1 số mục tiêu cho mọi từ khóa bên dưới |
| Số mục tiêu theo từng từ khóa | Ô số +/- từng dòng | 30 / 20 / 50 | Trần Page cần quét cho riêng từng từ khóa = `max_results` của phiên từ khóa đó |
| Chỉ quét page có followers lớn hơn | Checkbox + ô số | Bật, 1.000 | Ngưỡng `min_followers` áp NGAY KHI QUÉT (ở tầng thẻ kết quả) — khác lọc hiển thị sau quét ở mục 11.4, xem Q3 ở 12.6 |

Lưu ý nhãn chữ: Card 2 đang dùng chữ "nhóm" ở 3 chỗ ("50 nhóm/tài khoản", "số nhóm mục tiêu theo từng từ khóa", "30 nhóm") — xem Q1 ở 12.6.

**Vùng điều khiển chạy:** nút **BẮT ĐẦU THỰC THI** (luôn có ở trạng thái cấu hình); hàng **TẠM DỪNG** + **DỪNG KHẨN CẤP** chỉ thuộc trạng thái đang chạy (12.3).

**Vùng kết quả (trạng thái đang chạy/đã chạy):**
- Ô tìm kiếm trong kết quả: lọc theo Tên, Link, SĐT, Email, Tỉnh thành... (lọc phía server trên dữ liệu đã lưu).
- Dropdown lọc theo từ khóa: "Tất cả từ khóa" hoặc 1 từ khóa cụ thể.
- Nút **Xuất toàn bộ file** (xuất toàn bộ kết quả đạt lọc) và **Lưu danh sách** (lưu thành danh sách Page để dùng lại — tương ứng mục "Danh sách nhóm page" ở menu trái; phạm vi lưu xem Q6).
- Bảng kết quả: checkbox chọn từng dòng + checkbox chọn tất cả ở header; cột STT / Từ khóa / Tên Page (kèm avatar và dấu tích xanh nếu có) / Link Page / Số điện thoại / Email / Website (cột bị cắt ở mép phải ảnh, còn tiếp) — **chưa có cột Followers dù subtitle của màn có nhắc Follower**, xem Q7.
- Phân trang cuối bảng: "Hiển thị 1–5 của 1.420 Page", chọn trang 1/2/3/.../142.

**Live Automation Log Console (cuối màn):** tiêu đề phiên đang chạy dạng `[Thread-01 - Quét Page]`, huy hiệu trạng thái RUNNING, từng dòng log có timestamp: khởi chạy Chrome Profile + UID acc + proxy; từ khóa mục tiêu + giới hạn Page; quét thành công Page (tên, UID, FL = follower); trích xuất liên hệ (SĐT/Email/Web) của từng Page; dòng nghỉ giãn cách. Việc log có dòng "trích xuất thông tin liên hệ" ngay trong phiên cho thấy luồng của màn này là tìm thấy Page nào thì vào lấy SĐT/Email/Website của Page đó LUÔN trong cùng phiên — xem Q4.

### 12.2 Input của 2 tab không hiện trong ảnh (theo các nguồn đã chốt ở mục 6)
- Tab **Nhập Link**: ô dán nhiều dòng, mỗi dòng 1 link Page (link rút gọn/tên miền phụ được chuẩn hoá về page_key như mục 3.2); số mục tiêu và cấu hình Card 2 áp dụng tương tự.
- Tab **Tải tệp**: chọn file .txt/.csv + nút tải file mẫu; nội dung file được đọc thành danh sách link/từ khóa rồi chạy cùng luồng.
- Nguồn **Hashtag** (mục 10) chưa có tab riêng trong ảnh — khi làm tới thì thêm lựa chọn thứ 4 vào hàng Phương thức quét, input là ô nhập hashtag dạng chip + ô từ khóa ngữ cảnh + min_posts.

### 12.3 Hai trạng thái của màn hình (yêu cầu của user)
- **Trạng thái 1 — Cấu hình (chưa chạy):** chỉ hiện Card 1 + Card 2 + nút BẮT ĐẦU THỰC THI. Toàn bộ phần DƯỚI nút Bắt đầu (hàng Tạm dừng/Dừng khẩn cấp, bảng kết quả, log console) CHƯA hiện.
- **Trạng thái 2 — Đang chạy:** người dùng nhấn BẮT ĐẦU THỰC THI thì phần dưới mới hiện ra: hàng nút TẠM DỪNG + DỪNG KHẨN CẤP, bảng kết quả nạp dần theo từng Page quét được, log console chạy realtime, bảng số lượng theo từ khóa chuyển trạng thái "Đang quét".
- **Khi chạy XONG** (hoàn thành, bị dừng, hoặc lỗi): **bỏ hẳn hàng nút TẠM DỪNG và DỪNG KHẨN CẤP**; bảng kết quả và log vẫn giữ nguyên để xem/xuất file/lưu danh sách. Nút BẮT ĐẦU THỰC THI quay lại để chạy đợt mới.
- Hành vi 2 nút khi đang chạy (giả định theo chuẩn các module khác, user xác nhận ở Q8 nếu khác): TẠM DỪNG = treo phiên tại chỗ an toàn, nút đổi thành TIẾP TỤC để chạy tiếp đúng phiên đó; DỪNG KHẨN CẤP = ngắt ngay phiên, đóng trình duyệt, acc đang dùng đi vào cooldown theo Account Limiter (mục Limiter ở plan tổng v2.1).

### 12.4 Mini progress khi rời màn hình (ĐÃ CÓ SẴN — ghi để agent/dev hiểu)
User đã tự làm sẵn mini progress: khi phiên đang chạy mà người dùng chuyển sang màn hình/trang khác trong app, một thanh tiến độ thu nhỏ vẫn hiển thị (tiến độ đợt chạy + trạng thái) để người dùng biết phiên còn đang chạy. Khi triển khai các phần liên quan chỉ cần biết: mini progress và màn Quét page dùng CHUNG một nguồn trạng thái phiên ở backend (12.5), không tạo cơ chế trạng thái riêng cho từng nơi.

### 12.5 Yêu cầu giữ state khi tải lại trang (reload không mất phiên đang chạy)
- Nguồn sự thật duy nhất là PHIÊN Ở BACKEND (bảng `page_scan_sessions` + worker đang chạy trong engine), không phải state trong trình duyệt. Frontend không được giữ trạng thái chạy duy nhất ở bộ nhớ trang/localStorage.
- Khi màn Quét page được mở hoặc tải lại, frontend phải gọi API lấy phiên đang hoạt động của user (trạng thái RUNNING/PAUSED) — có thì tự khôi phục thẳng vào Trạng thái 2: nạp lại cấu hình từ `settings` của phiên (acc, từ khóa, số mục tiêu, giãn cách, ngưỡng follower), hiện lại hàng TẠM DỪNG/DỪNG KHẨN CẤP, bảng kết quả nạp từ DB theo phân trang như bình thường, bảng tiến độ theo từ khóa lấy từ các phiên con của đợt.
- Log console sau reload: các dòng log PHẢI được lưu kèm phiên (gợi ý: lưu nối tiếp vào 1 trường/ bảng log theo phiên, giữ tối đa ~500 dòng gần nhất) để mở lại còn thấy lịch sử; nếu chỉ nối stream trực tiếp thì sau reload console trống dù phiên vẫn chạy — không đạt yêu cầu.
- Vì đợt chạy gồm nhiều phiên con (mỗi từ khóa 1 phiên, có thể nhiều acc), cần định danh đợt chạy chung (chính là `campaign_id` đã nêu ở mục 11.4) để reload khôi phục đúng cả đợt chứ không chỉ 1 phiên lẻ.
- Worker chạy trong engine, độc lập với việc người dùng mở trang nào hay tắt tab — reload/chuyển trang KHÔNG được gửi lệnh dừng phiên.

### 12.6 Các điểm ĐÃ CHỐT (user xác nhận 23/10/2026)
- **Q1 — Chữ "nhóm" ở Card 2:** ĐỔI hết thành **"page"**.
- **Q2 — Đổi acc sau N Page:** **B** — quét hết từ khóa mới đổi acc cho từ khóa kế (1 phiên = 1 acc; không cắt giữa từ khóa).
- **Q3 — Lọc follower:** **B** — lưu hết + lọc khi hiển thị; kèm tuỳ chọn **"không lưu page dưới ngưỡng"**.
- **Q4 — SĐT/Email/Website:** **Gộp** — lấy liên hệ ngay trong phiên, nhưng **chỉ vào lấy chi tiết với page đạt ngưỡng follower**; page dưới ngưỡng để dành quét chi tiết sau.
- **Q5 — Nút "Kiểm tra":** check trước khi chạy (từ khóa/hashtag hợp lệ + acc còn sống), **không** quét thử ước tính; bảng theo từ khóa = **tiến độ thật khi đang chạy**.
- **Q6 — "Lưu danh sách":** lưu page **đã tick**; chưa tick dòng nào → lưu **toàn bộ kết quả đang lọc**.
- **Q7 — Cột Followers:** **có** — thêm cột + sắp xếp giảm dần.
- **Q8 — TẠM DỪNG:** đổi thành **TIẾP TỤC** — chạy tiếp đúng đợt/phiên đang tạm dừng.
- **Mức UI:** **3 (đã làm 23/10/2026)** — gộp vào tab **Từ khóa**: chip hỗn hợp (từ khóa + `#hashtag`), 3 chế độ Page lớn / Page ngách / **Kết hợp** (mặc định). Kết hợp tự chạy biến thể + hashtag suy ra từ từ khóa + hashtag nhập tay → pool chung, xếp điểm kết hợp. `campaign_id` backend vẫn để đợt sau (FE điều phối tuần tự + gộp theo `page_key`).
