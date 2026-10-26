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
- KHÔNG tự gộp biến thể có dấu/không dấu (`#thờitrang` và `#thoitrang` là 2 hashtag khác nhau trên Facebook): user nhập biến thể nào chạy biến thể đó, điểm của Page được cộng dồn xuyên các biến thể trong cùng phiên.
- Từ khóa ngữ cảnh tuỳ chọn (`context_keywords`): khi hashtag quá chung (ví dụ `#review`, `#sale`), khuyến nghị bắt buộc có thêm từ khóa ngành để chấm điểm — Page phải khớp ngữ cảnh mới đạt chuẩn (xem 10.5).

### 10.3 Quét bài viết theo hashtag
- Mở `facebook.com/hashtag/<tag>`; nếu trang hashtag không khả dụng thì dùng tab Bài viết: `facebook.com/search/posts/?q=%23<tag>`.
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