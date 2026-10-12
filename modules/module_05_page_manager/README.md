# Module 5 — Quản lý Fanpage

Tài liệu nghiệp vụ cần làm cho backend `modules/module_05_page_manager`. Đối chiếu với SRS hiện tại (danh sách Page, đăng bài AI, đăng Reels, tải TikTok, tải YouTube, lịch sử).

## Chia việc

Hai người, mỗi người một nửa. Bình làm nửa quản lý Page và đăng bài. Kiệt làm nửa video (Reels + nguồn tải) và nhật ký tải.

| Người | Phạm vi | SRS |
| --- | --- | --- |
| Bình | Danh sách Page, Đăng bài AI, lịch sử đăng bài | FR-PG-01 → FR-PG-04, FR-AI-01.1, mục 5.7 phần AI/Reels |
| Kiệt | Đăng Reels, Tải TikTok, Tải YouTube, lịch sử tải video | FR-RL-01.1, FR-TT-01, FR-YT-01, mục 5.7 phần TikTok/YouTube |

Hợp đồng chung, làm trước khi tách nhánh sâu:

- Bình sở hữu bảng `pages` và gọi `init_models()` lúc engine lên. Cột tối thiểu: `account_uid`, `page_id`, `page_name`, `access_token`, `status`. API danh sách/xem/xóa/thêm Page xong thì Kiệt chỉ đọc Page theo `account_uid`, không tự kéo Page.
- Kiệt thêm cột trên cùng bảng: `reels_folder`, `tiktok_keyword`, `youtube_keyword`, `youtube_url`. Không tạo bảng Page thứ hai.
- Mỗi người có job runner riêng (start/stop + trạng thái từng Page). Bình chạy job AI. Kiệt chạy job Reels, TikTok, YouTube. Không nhét chung vào một `AutoPostWorker.run()`.
- Bình ghi và đọc `posting_history`. Kiệt ghi `downloaded_videos` để chống trùng, và ghi nhật ký tải (kể cả lần thất bại) để màn lịch sử của Kiệt đọc. Kiệt khi đăng Reels thành công/thất bại cũng insert `posting_history` (`post_type = REEL`) đúng schema Bình đã chốt.
- File video của Kiệt nằm trên Supabase Storage, bucket `page-videos`. Không lưu bản phát hành trên ổ đĩa máy chạy engine và không dùng SQLite `videos.db`.

Code worker được copy từ tool desktop. Các lớp `AutoPostWorker`, `TikTokBulkDownloader`, `YouTubeBulkDownloader` là `QThread`: chạy trong process, bắn log qua signal, không có route HTTP. Giao diện user hiện chỉ có một màn danh sách, năm mục menu Quản lý Fanpage đều render cùng component đó.

Schema Postgres (`pages`, `posting_history`, `posting_progress`, `downloaded_videos`, `posting_schedules`) nằm trong `models.py`. `init_models()` chưa được gọi lúc engine khởi động. Worker vẫn đọc/ghi `pages_data.json`, `posting_progress.json`, `scheduler_state.json` và SQLite `videos.db`, không ghi các bảng trên.

Thư mục `core/` là bản sao của các file ở gốc module. Package import file ở gốc.

## Tổng quan

| Nhóm | Người | SRS | Đã có trong backend | Còn thiếu để khớp nghiệp vụ |
| --- | --- | --- | --- | --- |
| Danh sách Page | Bình | FR-PG-01 → FR-PG-04 | `GET /api/pages`, `POST /api/pages/fetch-tokens` | Cột Acc quản lý, tìm/lọc, xem, xóa, thêm Page qua tài khoản Module 2 |
| Đăng bài AI | Bình | FR-AI-01.1 | `AutoPostWorker` + Gemini + Pixabay + Graph | API kích hoạt/dừng, chọn account, tiến trình theo Page, ghi lịch sử |
| Đăng Reels | Kiệt | FR-RL-01.1 | `upload_reel_to_facebook`, lịch giờ, giãn cách, bucket `page-videos` đã nối | API, lấy video từ bucket theo Page, tiến trình |
| Tải TikTok | Kiệt | FR-TT-01 | Tải hàng loạt, delay, số video, số luồng, dừng, chống trùng local | Từ khóa riêng, upload object lên `page-videos`, kho ID trên Postgres |
| Tải YouTube | Kiệt | FR-YT-01 | Từ khóa / link kênh / link video, cookie, delay, số video, số luồng, dừng | Lọc từ khóa trong kênh, trần độ dài, upload object lên `page-videos` |
| Lịch sử đăng | Bình | Mục 5.7 | Bảng `posting_history` (chưa được worker ghi) | Tổng hợp + chi tiết AI/Reels theo ngày/tuần, theo Page |
| Lịch sử tải | Kiệt | Mục 5.7 | Bảng `downloaded_videos` (chưa được downloader ghi) | Danh sách video đã tải: thời gian, tên, thư mục, hành động |

## 5.2 Danh sách Page — Bình

Bảng gồm STT, Tên Page, Acc quản lý, Hành động (Mở/Xem, Xóa). Màn này chỉ tra cứu, không điều hướng sang Đăng bài AI hay Reels.

### Đã có

- `GET /api/pages` trả mọi dòng bảng `pages`.
- UI hiện cột Page ID, tên, cờ AI, thư mục Reels, trạng thái. Có trạng thái trống: “Chưa có Fanpage nào được nạp”.
- `POST /api/pages/fetch-tokens` nhận user access token, gọi `me/accounts`, ghi `page_id`, `page_name`, `access_token`, `category`, bật AI/Reels, `status = ACTIVE`.

### Cần làm

- **FR-PG-01.** API danh sách cho user đang đăng nhập. Cột Acc quản lý lấy từ tài khoản Facebook (Module 2) đã dùng để kéo Page, không chỉ Page ID. STT do client đánh. Lỗi tải dữ liệu trả message để UI thử lại.
- **FR-PG-02.** Query theo tên (không phân biệt hoa thường) và theo `status`. Không khớp thì danh sách rỗng kèm thông báo không tìm thấy. Bỏ lọc thì trả lại toàn bộ.
- **FR-PG-03.** `GET` một Page: tên, acc quản lý, category, trạng thái, token không trả full ra client. Page không còn / token chết thì trả trạng thái tương ứng.
- **FR-PG-04 Xóa.** Xóa Page khỏi danh sách quản lý của user. Không xóa bài đã đăng trên Facebook.
- **FR-PG-04 Thêm.** SRS gán trùng mã cho hai việc. Luồng thêm đúng nghiệp vụ: user bấm Thêm Page → báo “Cần phải đăng nhập tài khoản quản lý các trang để thêm trang quản lý” → sang màn thêm tài khoản (SRS Module 2) → đăng nhập xong quay lại danh sách → Page của tài khoản đó được kéo vào. Không dùng ô dán user token như UI hiện tại. Cột `pages` cần `account_uid` (hoặc khóa tương đương) trỏ tài khoản Module 2.

## 5.3 Đăng bài AI (FR-AI-01.1) — Bình

User chọn tài khoản Facebook đã có trên hệ thống, hệ thống đăng nhập và lấy Page của tài khoản đó. User chọn Page, file Gemini API keys, Pixabay key, phiên bản Graph, model Gemini, lịch giờ trong ngày, giãn cách ngẫu nhiên, prompt. Bấm Kích hoạt thì mỗi Page được một bài từ chủ đề/từ khóa của Page đó. Có khu vực tiến trình và nút Dừng luồng. Một Page lỗi thì Page khác vẫn chạy.

### Đã có

- `AIGenerator`: nhiều Gemini key, xoay key khi 429/503/timeout, prompt khung, sinh theo lô tối đa 10 Page, mỗi Page một khối `PAGE_NAME` / `KEYWORD` / `CONTENT`. Có `ai_keyword` trên từng Page, không có thì dùng tên Page.
- `get_image_from_internet`: Pixabay, rồi DuckDuckGo, rồi Wikimedia.
- `post_to_facebook_page`: đăng feed kèm ảnh, có retry.
- `AutoPostWorker`: bật/tắt hẹn giờ (`ai_sched_times` dạng chuỗi giờ), giãn cách `sleep_min`–`sleep_max`, `stop()`, log từng Page, Page lỗi thì `continue`.
- File `keys.txt` là dạng danh sách key mà worker đọc được nếu có lớp gọi truyền vào.

### Cần làm

- API start/stop job, không khởi động QThread từ request rồi giữ request mở.
- Job nhận: `account_uid`, danh sách `page_id`, đường dẫn file key hoặc danh sách key đã lưu, Pixabay key, `fb_version`, `model_name`, prompt, bật lịch + các khung `HH:MM`, khoảng giãn cách.
- Validate trước khi chạy: chưa chọn Page, thiếu key, prompt trống, giờ sai định dạng. Đăng nhập account thất bại hoặc account không có Page thì trả lỗi riêng, không bắt đầu job.
- Nguồn Page là bảng `pages` theo account, không đọc `pages_data.json`.
- Trạng thái từng Page cho UI: đang chạy, thành công, thất bại, đã dừng. Dừng giữa chừng giữ kết quả đã xong.
- Ghi `posting_history` (`post_type = AI`) thay cho chỉ ghi Google Sheet. Sheet logger giữ nếu còn cần, không thay nhật ký sản phẩm.
- Chủ đề/từ khóa lưu theo Page để lần sau không gõ lại.

## Kho video Supabase Storage — Kiệt

Bucket dùng cho mọi file video của Module 5 (TikTok, YouTube, nguồn đăng Reels). Đã tạo và đã gọi Storage API thành công ngày 12/10/2026.

| Mục | Giá trị |
| --- | --- |
| Biến môi trường | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` trong `.env` |
| Project Storage | `https://hvcymdjqwnzwwpiqjcnk.supabase.co` |
| Bucket | `page-videos` |
| Public | tắt |
| Policy | 0. Engine dùng `service_role`, key này bỏ qua policy. Không đưa key lên git, không dùng key anon |
| File trong bucket lúc test | 0 |
| Giới hạn dung lượng | chưa đặt riêng trên bucket, đang theo mức project khoảng 50 MB/file. Video lớn hơn sẽ bị từ chối cho đến khi nâng limit |
| MIME | chưa khóa. Khi upload chỉ gửi `video/mp4`, `video/quicktime`, `video/webm` |

Cách gọi: `POST/GET {SUPABASE_URL}/storage/v1/...` với header `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` và `apikey` cùng giá trị đó. List bucket trả 200 và có `page-videos`. List object của bucket trả 200.

Đường dẫn object, Kiệt giữ đúng dạng này:

```text
{page_id}/tiktok/{video_id}.mp4
{page_id}/tiktok/{video_id}.txt
{page_id}/youtube/{video_id}.mp4
{page_id}/youtube/{video_id}.txt
```

`downloaded_videos.link` lưu đường dẫn object (ví dụ `123456/tiktok/7123.mp4`), không lưu URL public. Reels lấy file bằng service role rồi đưa bytes sang Graph API. Postgres của app (`DATABASE_URL`) là project khác với project Storage này. Bảng nghiệp vụ vẫn ghi qua `DATABASE_URL`. File thì ghi qua ba biến Storage.

Downloader hiện chưa upload. Phần Kiệt cần thêm là client Storage trong job TikTok, YouTube và Reels.

## 5.4 Đăng Video Reels (FR-RL-01.1) — Kiệt

SRS viết hai biến thể cùng mã. Biến thể dùng cho sản phẩm này là tài khoản đã có trên hệ thống: chọn account → đăng nhập → lấy Page → chọn Page → chọn thư mục gốc → gán thư mục từng Page hoặc tự gán theo tên (gán xong vẫn sửa được) → lịch giờ → khoảng nghỉ → Kích hoạt → theo dõi từng Page → dừng được.

Biến thể “nút đăng nhập Facebook ngay trên màn Reels” không làm, vì thêm Page đã đi qua Module 2.

### Đã có

- `upload_reel_to_facebook`: start → upload binary → finish trên `/{page_id}/video_reels`.
- `execute_reels_phase`: lấy video kế tiếp trong thư mục con đánh số (`1`, `2`, …), caption từ file text cùng thư mục, cập nhật `posting_progress.json`, giãn cách ngẫu nhiên, lịch `reels_sched_times`, `stop()`.
- Cột `pages.reels_folder` có trong schema.

### Cần làm

- API start/stop riêng job Reels (worker hiện gộp AI + Reels + video dài trong một `run()` và một file JSON).
- Nguồn video là object trong `page-videos` theo `page_id`, không đọc thư mục ổ đĩa. Video kế tiếp là object chưa có trong `posting_progress`.
- Kiểm tra trước khi chạy: account đăng nhập được, có Page được chọn, Page đó còn object chưa đăng.
- Trạng thái từng Page trên job, ghi `posting_history` (`post_type = REEL`). `media_path` là đường dẫn object.
- Tiến trình đã đăng đến video nào ghi `posting_progress`, không ghi `posting_progress.json`.

## 5.5 Tải Video TikTok (FR-TT-01) — Kiệt

Mỗi Page một từ khóa. User chọn thư mục lưu tổng, sửa từ khóa, delay giữa request, số video tối đa mỗi Page, số tác vụ đồng thời. Video lưu theo Page để Reels dùng. ID video đã tải giữ vĩnh viễn để lần sau bỏ qua. Có nhật ký và nút Dừng tải. Từ khóa trống thì báo hoặc bỏ qua Page đó. Không thấy video, tải lỗi, hoặc không ghi được file thì ghi nhật ký và làm Page khác.

### Đã có

- `TikTokBulkDownloader(pages_list, download_folder, delay_seconds, max_videos_per_page, max_workers)` và `stop()`.
- Tìm qua TikWM, fallback Urlebird / Tiklydown / ssstik. Tải không watermark khi parser lấy được link.
- Lưu `{thư_mục_tổng}/{tên Page}/{số}/` kèm file `.txt` caption. Hashtag TikTok được đổi sang hashtag Facebook.
- Chống trùng: SQLite `videos.db`, mỗi Page một bảng `tbl_{page_id}`.

### Cần làm

- Từ khóa lấy từ field riêng (`tiktok_keyword`), user sửa trước khi chạy. Code hiện search bằng **tên Page**, không đọc từ khóa.
- API start/stop + trạng thái từng Page + dòng nhật ký.
- File tải xong upload lên `page-videos` tại `{page_id}/tiktok/{video_id}.mp4` và caption `.txt`. Xóa file tạm local sau khi upload thành công.
- Chống trùng ghi `downloaded_videos` (`source = TIKTOK`, unique `page_id + video_id`) trên Postgres. `link` là đường dẫn object. Không tạo thêm bảng SQLite theo Page.
- Validate: thiếu cấu hình Storage, upload bị từ chối (quá 50 MB hoặc lỗi mạng), delay &lt; 0, max video &lt; 1, số luồng &lt; 1.
- Nhật ký mục 5.7: thời gian, tên video, đường dẫn object, Page, thành công/thất bại.

## 5.6 Tải Video YouTube (FR-YT-01) — Kiệt

Giống TikTok, thêm: nguồn là từ khóa hoặc link; nếu nhập link thì bắt buộc kèm từ khóa và chỉ tìm từ khóa đó trong phạm vi trang/kênh đã nhập; cookie khi YouTube chặn; video có trần độ dài; ID đã tải giữ vĩnh viễn.

### Đã có

- `YouTubeBulkDownloader`: `youtube_search` trên từng Page, không có thì dùng tên Page.
- Nhánh link video (`watch`, `youtu.be`, `shorts`) tải đúng video đó.
- Nhánh link kênh lấy danh sách video kênh (ưu tiên tab shorts/videos).
- Nhánh chữ: DuckDuckGo rồi `ytsearch` với hậu tố `shorts`.
- Cookie file hoặc cookie trình duyệt, delay, max video, max workers, `stop()`.
- Chống trùng cùng `videos.db` (bảng `tbl_youtube_{page_id}`), trừ link video đơn.
- `duration` được parse từ yt-dlp nhưng không dùng để loại video.

### Cần làm

- Khi nguồn là link: bắt buộc có từ khóa đi kèm, search từ khóa **trong** kênh/trang đó. Hiện link kênh lấy mọi video kênh, không lọc theo từ khóa.
- Trần độ dài (cấu hình được, đơn vị giây). Video dài hơn thì bỏ qua, ghi nhật ký, lấy video khác cho đủ số lượng.
- API start/stop, trạng thái, nhật ký.
- File tải xong upload lên `page-videos` tại `{page_id}/youtube/{video_id}.mp4` và caption `.txt`.
- Chống trùng trên `downloaded_videos` (`source = YOUTUBE`). `link` là đường dẫn object.
- Cùng bộ validate Storage / delay / số video / số luồng như TikTok.

## 5.7 Lịch sử / nhật ký

Bốn loại: Đăng bài AI, Đăng Reels, Tải TikTok, Tải YouTube. Mỗi loại có tổng, thành công, thất bại. Lọc theo ngày và theo tuần.

- **Bình — lịch sử đăng.** Đăng bài AI và Reels: nhóm theo Page. Mở một Page thì thấy từng bài thành công hoặc thất bại. Kiệt insert dòng Reels; Bình làm API đọc cả hai `post_type`.
- **Kiệt — lịch sử tải.** Tải TikTok và YouTube: một danh sách toàn bộ video đã tải — STT, thời gian, tên video, đường dẫn object trên `page-videos`, hành động.

### Đã có

- Bảng `posting_history` đủ field gần với chi tiết bài đăng (`page_id`, `post_type`, `title`, `caption`, `post_url`, `media_path`, `status`, `posted_at`). Dashboard đếm bảng này, nhưng worker không insert.
- Bảng `downloaded_videos` có `video_id`, `title`, `link`, `downloaded_at`. Thiếu đường dẫn thư mục đã lưu và trạng thái thất bại (bảng hiện chỉ hợp cho ID đã tải thành công).

### Cần làm

- **Bình.** Job AI (và dòng Reels do Kiệt ghi) insert `posting_history` khi xong từng bài, kể cả thất bại. `GET` tổng hợp AI + Reels, filter `from`/`to`. `GET` chi tiết theo `page_id` + `post_type`.
- **Kiệt.** Mỗi video tải xong, hoặc thất bại, ghi một dòng nhật ký. `downloaded_videos` chỉ giữ ID đã tải thành công để chống trùng. Nhật ký thất bại nằm ở bảng riêng hoặc cột `status`, `file_path`, `error`. `GET` danh sách theo nguồn TikTok hoặc YouTube.

## Việc kỹ thuật — ai làm

1. **Bình.** Gọi `init_models()` khi engine lên, trên Postgres production. Bỏ nhánh sửa DDL sang SQLite trong `models.py`. Thêm `account_uid` vào `pages`.
2. **Kiệt.** Thêm `tiktok_keyword`, `youtube_keyword`, `youtube_url` vào `pages`. Downloader và job Reels đọc/ghi bucket `page-videos` bằng ba biến Storage trong `.env`. Ghi `downloaded_videos` trên Postgres. Ngừng ghi `videos.db` và ngừng giữ video trên ổ đĩa.
3. **Mỗi người.** Job của mình nhận list Page từ DB, start/stop qua API, trạng thái đọc lại được. Không giữ request HTTP mở suốt vòng đời QThread.
4. **Mỗi người.** Màn menu thuộc phần mình phải tách khỏi màn danh sách chung. Hiện `pages.list`, `pages.ai_post`, `pages.reels`, `pages.tiktok`, `pages.youtube` cùng `moduleId: "pages"`. Menu chưa có Lịch sử: Bình thêm lịch sử đăng, Kiệt thêm lịch sử tải.
