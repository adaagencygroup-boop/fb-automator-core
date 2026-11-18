# FB Automator Pro — Landing Page

Landing page SaaS nền sáng, cao cấp. Viết tay bằng **HTML5 + CSS3 + JavaScript
thuần (ES6)** — không framework, không bundler, không build step.

## Chạy thử

Mở thẳng `index.html`, hoặc serve cả thư mục (khuyến nghị, để các thư viện CDN
và đường dẫn tương đối hoạt động đúng như môi trường thật):

```bash
# Python
python -m http.server 5173

# Node
npx serve .
```

Sau đó mở <http://localhost:5173>.

## Cấu trúc

```text
fb-automator-pro/
├── index.html          # Trang bán hàng — toàn bộ các section
├── huong-dan.html      # Trang hướng dẫn sử dụng (10 mục + mục lục)
├── css/
│   ├── style.css       # Design tokens + component, ưu tiên di động
│   └── docs.css        # Riêng trang hướng dẫn: mục lục, bảng, khối lưu ý
├── js/
│   ├── main.js         # Menu, hiệu ứng cuộn, accordion, thị sai
│   └── docs.js         # Mục lục, cuộn mượt, làm nổi mục đang đọc
└── assets/
    ├── icons/          # favicon.svg
    └── images/         # (xem ghi chú trong assets/images/README.md)
```

## Hệ thống thiết kế

Mọi thứ liên quan tới hình ảnh đều là CSS custom property khai báo một lần ở
`:root` trong `css/style.css`:

| Nhóm          | Biến                                                           |
| ------------- | -------------------------------------------------------------- |
| Nền           | `--c-bg` `#FFFFFF`, `--c-bg-alt` `#F7F8FA`, `--c-ink`          |
| Chữ           | `--c-text` `#111318`, `--c-text-2`, `--c-text-3`               |
| Màu nhấn      | `--c-accent` `#2F55FF`, `--c-violet` `#7A4DFF` và biến thể nhạt |
| Đường kẻ      | `--c-border`, `--c-border-strong`, `--c-border-subtle`         |
| Kiểu chữ      | `--fs-display` → `--fs-2xs`, thang letter-spacing và độ đậm    |
| Khoảng cách   | `--s-1` → `--s-24` (gốc 4px), `--section-y`, `--gutter`        |
| Bo góc        | `--r-xs` → `--r-xl`, `--r-pill`                                |
| Đổ bóng       | `--sh-xs` → `--sh-xl`, `--sh-accent`                           |
| Chuyển động   | `--e-out`, `--e-spring`, `--t-fast` / `--t-base` / `--t-slow`  |

Muốn đổi theme toàn trang thì chỉ cần đổi cặp màu nhấn — không có giá trị nào
bị hard-code.

## Các section

Header → Hero (kèm mockup dashboard) → dải số liệu → tổng quan sản phẩm → khu
tính năng (5 hàng xen kẽ) → ưu điểm → bảng giá (5 gói theo thời hạn) → trung tâm
tải về (phiên bản hiện tại + lịch sử phiên bản) → Hỏi đáp → liên hệ (thông tin +
form) → CTA cuối → footer.
Ngoài luồng: nút Zalo nổi ở góc phải dưới (`.zalo-fab`) — chỉ logo, không
chữ, dùng `assets/images/zalo.png`. Có hai vòng sóng lan ra lệch pha
(`@keyframes zalo-ping`) và thân nút nhún nhẹ (`@keyframes zalo-bob`); cả hai
tắt khi người dùng bật `prefers-reduced-motion`.

## Nhịp dọc

Ba biến điều khiển toàn bộ khoảng trống dọc, khai báo ở `:root` rồi tăng theo
bốn mốc màn hình (khối `@media` ngay dưới `:root`):

| Biến               | Dùng cho                              | Mặc định | ≥768px | ≥1024px | ≥1280px |
| ------------------ | -------------------------------------- | -------- | ------ | ------- | ------- |
| `--section-y`      | padding trên/dưới mọi section       | 36px     | 44px   | 56px    | 64px    |
| `--block-gap`      | khoảng giữa các khối lớn trong section | 24px   | 32px   | 40px    | 48px    |
| `--section-head-y` | khoảng dưới tiêu đề section          | 20px     | 24px   | 28px    | 32px    |

Hero, dải số liệu, CTA cuối và footer đều lấy `--section-y` nên nhịp dọc
đồng đều từ đầu đến cuối trang. Sửa ba biến này là đổi nhịp cả trang.

## Tương tác (`js/main.js`)

- Header dính, hiện đường viền khi cuộn
- Menu di động đúng chuẩn trợ năng (`aria-expanded`, phím Esc để đóng, khóa
  cuộn nền, tự đóng khi sang breakpoint desktop)
- Cuộn mượt theo anchor, bù trừ chiều cao header dính
- Tự làm nổi mục menu tương ứng section đang xem
- Hiệu ứng hiện dần bằng `IntersectionObserver` (`[data-reveal]`,
  `[data-reveal="left|right|scale"]`, độ trễ qua `--reveal-delay`)
- Đếm số tăng dần (`[data-count]` + `[data-suffix]` tùy chọn), định dạng số
  theo locale `vi-VN`
- Thanh tiến độ chạy dần (`[data-bar="0–100"]`)
- Accordion Hỏi đáp, mỗi lúc mở một mục, di chuyển bằng phím mũi tên
- Thị sai theo con trỏ và vị trí cuộn cho các thẻ nổi (`[data-float]`)
- Form liên hệ: kiểm tra tên và số điện thoại ngay tại trình duyệt, khóa nút
  trong lúc gửi, rồi báo thành công hoặc thất bại — xem mục dưới đây

## Mockup sản phẩm

Dashboard ở hero và năm preview tính năng đều là DOM thật — khung cửa sổ ứng
dụng, sidebar, ô chỉ số, biểu đồ vùng bằng SVG nội tuyến, bảng dữ liệu, bong
bóng chat, hàng đợi tác vụ và dòng thời gian hoạt động. Không có ảnh chụp màn
hình nào phải xuất lại khi thương hiệu thay đổi.

## Thư viện (CDN, tùy chọn)

| Thư viện     | Phiên bản | Công dụng                                |
| ------------ | --------- | ---------------------------------------- |
| Lucide       | 0.460.0   | Icon, vẽ từ thuộc tính `[data-lucide]`   |
| AOS          | 2.3.4     | Hiệu ứng cuộn bổ sung (tùy chọn)         |
| Google Fonts | —         | Inter + JetBrains Mono (có subset tiếng Việt) |

Cả ba đều suy giảm êm: trang vẫn đọc và dùng được bình thường nếu thư viện nào
đó không tải được, và `IntersectionObserver` tự viết đã lo đúng phần việc của
AOS.

## Trợ năng & hiệu năng

- Landmark semantic, một thẻ `h1` duy nhất, link bỏ qua, viền focus rõ ràng
- `aria-expanded` / `aria-controls` cho nút menu và các câu hỏi
- Mockup trang trí gắn `aria-hidden`; riêng cửa sổ hero có mô tả thay thế
- Mọi hiệu ứng tự tắt khi người dùng bật `prefers-reduced-motion: reduce`
- Không có ảnh trong critical path, không layout shift, không script chặn
  render (tất cả đều `defer`)

## Hỗ trợ trình duyệt

Chrome, Edge, Firefox và Safari bản hiện hành. Trang dùng
`grid-template-rows: 0fr → 1fr` cho accordion, đơn vị `dvh` và thuộc tính
`translate` — đều đã ổn định trên các trình duyệt evergreen.

## Thay link tải về

Hai nút tải (`.release__cta` và nút trong hàng lịch sử) được đánh dấu bằng
thuộc tính `data-download` trong `index.html`. Hiện cả hai đang trỏ tới một
link tạm trên Supabase Storage.

Khi có bộ cài thật, thay `href` của cả hai thẻ. Vài lưu ý:

- Link **cùng tên miền** với trang: thuộc tính `download="..."` có hiệu lực,
  trình duyệt tải về và đặt đúng tên file.
- Link **khác tên miền**: `download` bị trình duyệt bỏ qua. Muốn ép tải thì máy
  chủ phải trả header `Content-Disposition: attachment`. Với Supabase Storage,
  thêm `?download=<tên-file>` vào cuối URL là được.

## Thêm phiên bản mới

Lịch sử phiên bản hiện mới có một bản (v2.0.12). Khi ra bản mới:

1. Thêm một `<li class="release-row">` lên **đầu** `.history__list`, sao theo hàng
   có sẵn.
2. Chuyển thẻ `<span class="badge badge--accent">Mới nhất</span>` sang hàng mới.
3. Cập nhật `.release__version` và `href` của `.release__cta` ở thẻ bên trái.
4. Xóa khối `.history__empty` — nó chỉ là phần lấp chỗ trống khi danh sách
   còn ngắn.

## Trang hướng dẫn sử dụng

`huong-dan.html` dùng chung toàn bộ design token của `css/style.css`, chỉ thêm
`css/docs.css` cho bố cục hai cột và phần văn bản dài.

Tài liệu có 11 mục, mỗi mục một neo để dẫn trực tiếp từ nơi khác:

| Neo | Mục |
| --- | --- |
| `#gioi-thieu` | 1. Giới thiệu |
| `#cai-dat` | 2. Cài đặt và khởi động |
| `#dang-ky` | 3. Đăng ký, chờ duyệt, đăng nhập |
| `#giao-dien` | 4. Giao diện chính |
| `#tong-quan` | 5. Tổng quan |
| `#fanpage` | 6. Quản lý Fanpage |
| `#chat` | 7. Quản lý Chat Page |
| `#ho-so` | 8. Hồ sơ cá nhân |
| `#su-co` | 9. Xử lý sự cố |
| `#lien-he` | 10. Liên hệ hỗ trợ |
| `#admin` | 11. Trang quản trị (Web Admin) |

Trang bán hàng dẫn vào tài liệu ở ba chỗ: dải `.guide-cta` dưới bốn bước
trong khu tải về, cột Tài nguyên ở footer, và dòng `.faq__more` cuối bốn câu
hỏi liên quan.

**Khi đặt lên tên miền thật:** nếu tách tài liệu sang tên miền phụ (kiểu
`huongdan.ten-mien.vn`), sửa các `href="huong-dan.html..."` trong `index.html`
thành địa chỉ đầy đủ. Các neo giữ nguyên tên.

## Nối form liên hệ với Google Sheet

Mọi yêu cầu từ form đều ghi vào **một** Google Sheet duy nhất. Form không cần
máy chủ riêng — Google Apps Script đóng vai trò nơi nhận.

### 1. Tạo Sheet và dán script

Tạo một Google Sheet mới, đặt hàng tiêu đề ở dòng 1:

| A | B | C | D | E |
| --- | --- | --- | --- | --- |
| Thời gian | Họ tên | SĐT / Zalo | Nội dung | Trang gửi |

Vào **Tiện ích mở rộng → Apps Script**, xóa code mẫu và dán đoạn này:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const p = e.parameter;

  sheet.appendRow([
    new Date(),
    p.name || "",
    p.phone || "",
    p.message || "",
    p.page || ""
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### 2. Triển khai

Bấm **Triển khai → Triển khai mới → Ứng dụng web**, đặt:

- **Thực thi với tư cách:** Tôi
- **Người có quyền truy cập:** Bất kỳ ai

Google trả về một địa chỉ kết thúc bằng `/exec`. Chép địa chỉ đó.

### 3. Dán vào trang

Mở `js/main.js`, tìm dòng đầu mục 12 và dán vào giữa hai dấu nháy:

```javascript
const SHEET_ENDPOINT = "https://script.google.com/macros/s/..../exec";
```

### Lưu ý

- **Để trống `SHEET_ENDPOINT`** thì form vẫn kiểm tra dữ liệu và báo đã nhận,
  nhưng không gửi đi đâu. Tiện để xem giao diện trước khi đấu nối thật.
- Apps Script không trả header CORS, nên trang gửi bằng `mode: "no-cors"`:
  dữ liệu vẫn vào Sheet nhưng trình duyệt **không đọc được phản hồi**. Vì
  vậy trang chỉ báo lỗi khi mạng đứt hẳn. Sau khi đấu nối, **gửi thử một
  yêu cầu và kiểm tra Sheet** để chắc chắn đã chạy.
- Mỗi lần sửa script phải **Triển khai lại** thì thay đổi mới có hiệu lực.
- Form gửi 5 trường: `name`, `phone`, `message`, `page` (địa chỉ trang đã gửi)
  và `sentAt`.
