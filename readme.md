# FACEBOOK AUTOMATOR PRO (ENTERPRISE MULTI-MODULE PLATFORM)

Hệ thống quản lý, nuôi và tự động hóa Fanpage Facebook quy mô lớn đa nền tảng, kết hợp giữa **Next.js + Tailwind CSS** hiện đại và **Python Core Engine (FastAPI)**, kết nối trực tiếp **Meta Graph API**, **Google Gemini AI (Auto Key Rotation)**, bộ cào media TikTok/YouTube và cơ sở dữ liệu đám mây **Supabase PostgreSQL**.

Hệ thống được thiết kế theo mô hình **Modular Plugin-Driven Architecture**, phân tách độc lập **9 modules nghiệp vụ** cho các nhóm lập trình viên phát triển song song (cả Frontend lẫn Backend), cam kết không xảy ra xung đột mã nguồn (Git conflicts), đồng thời chia sẻ chung một nền tảng **Shared Core Engine** tối ưu và mạnh mẽ.

---

## 1. SƠ ĐỒ CẤU TRÚC CODEBASE TỔNG THỂ

```text
fb-automator-core/
│── start.py                           # [1-CLICK LAUNCHER] Khởi động đồng thời cả BE & FE
│── start.bat                          # File Batch click đúp chạy ngay trên Windows
│── engine.py                          # Local Engine Backend (FastAPI + WebSocket port 28129)
│── package.json                       # Scripts quản lý Fullstack, Tauri & đóng gói .exe
│── requirements.txt                   # Danh mục dependencies Python
│── .env                               # Cấu hình biến môi trường thực tế (Git ignore)
│── .env.example                       # File mẫu biến môi trường cho nhóm lập trình
│── build_engine.spec                  # PyInstaller spec đóng gói local_engine.exe
│── readme.md                          # Tài liệu kiến trúc và hướng dẫn phát triển
│
├── config/                            # Quản lý Cấu hình & Môi trường toàn cục
│   ├── constants.py                   # Nạp .env qua python-dotenv, hằng số, đường dẫn
│   └── settings.py                    # Quản lý cấu hình JSON thread-safe (data/config.json)
│
├── core/                              # LÕI BACKEND DÙNG CHUNG (Shared Core Engine)
│   ├── base_module.py                 # Lớp trừu tượng BaseWorker
│   ├── database/                      # Quản lý CSDL (Supabase PostgreSQL + SQLite Fallback)
│   │   ├── connection.py              # ThreadedConnectionPool Supabase & SQLite WAL Mode
│   │   └── models.py                  # Hook khởi tạo bảng (dành cho DB Designer)
│   ├── facebook/                      # Meta Graph API Client chính thức
│   │   └── fb_graph_client.py         # Reels 3-phase, Photo/Feed post, Video dài, Token fetch
│   ├── ai/                            # Trí tuệ nhân tạo Google Gemini
│   │   └── gemini_engine.py           # Batching 10 trang/lần, Auto Key Rotation (chống 429 quota)
│   ├── media/                         # Bộ cào & xử lý đa phương tiện
│   │   ├── tiktok_scraper.py          # Cào video TikTok không logo + captions + chống tải trùng
│   │   ├── youtube_scraper.py         # Tải Shorts/Videos yt-dlp + cookie trình duyệt
│   │   └── image_search.py            # Tìm ảnh minh họa 3 tầng (DuckDuckGo + Wikimedia)
│   └── network/                       # Mạng & Proxy
│       └── proxy_manager.py           # Xoay tua, kiểm tra sức khỏe proxy HTTP/SOCKS5
│
├── frontend/                          # GIAO DIỆN WEB HIỆN ĐẠI (Next.js + Tailwind CSS + shadcn/ui)
│   ├── GUIDE_UI.md                    # [TÀI LIỆU CHUẨN] Hướng dẫn Design Tokens & Component UI
│   ├── package.json                   # Dependencies: Next.js, Tailwind, Lucide
│   ├── components.json                # Cấu hình shadcn UI
│   ├── tailwind.config.js             # Theme tokens Facebook Light, font chữ và màu sắc
│   └── src/
│       ├── app/                       # Next.js App Router (layout.jsx, page.jsx)
│       ├── components/ui/             # shadcn UI components (button, card, badge, ...)
│       ├── lib/utils.js               # Tiện ích cn (clsx + tailwind-merge)
│       ├── services/api.js            # Axios Client tập trung (tự gắn baseURL, interceptors)
│       ├── config/constants.js        # Đọc động NEXT_PUBLIC_API_URL, NEXT_PUBLIC_WS_URL
│       └── modules/                   # 9 Modules Giao diện Web Độc lập
│           ├── index.js               # Registry tổng hợp 9 tabs giao diện
│           ├── module_01_dashboard/   # [Đức] Bảng điều khiển metrics & biểu đồ
│           ├── module_02_account_manager/ # [Mạnh Cường] Quản lý & import tài khoản FB
│           ├── module_03_acc_farm/    # [Cường Trần, Bình Kiến] Kịch bản nuôi nick
│           ├── module_04_page_creator/# [Minh] Tạo Fanpage hàng loạt & lấy token
│           ├── module_05_page_manager/# [Bình Ka, Kiệt] Quản lý page & Auto Post Reels/Feed
│           ├── module_06_omnichannel_chat/ # [Mạnh, Minh] Chat đa Fanpage & AI Bot
│           ├── module_07_group_spam/  # [Anh] Spam & tương tác hội nhóm Facebook
│           ├── module_08_interaction_seeding/ # [Hưởng, Trường] Buff Like, Comment mồi, Share
│           └── module_09_user_profile/# [Trường, Kiệt] Cài đặt hệ thống, Keys & Proxies
│
├── modules/                           # 9 MODULES BACKEND (workers / business logic)
│   ├── module_01_dashboard/           # Dashboard (API qua engine)
│   ├── module_02_account_manager/     # Worker Account Manager
│   ├── module_03_acc_farm/            # Worker Farm tài khoản
│   ├── module_04_page_creator/        # Worker Page Creator
│   ├── module_05_page_manager/        # Worker Fanpage & Auto Poster
│   ├── module_06_omnichannel_chat/    # Worker Omnichannel Chat
│   ├── module_07_group_spam/          # Worker Group Spam
│   ├── module_08_interaction_seeding/ # Worker Seeding Tương tác
│   └── module_09_user_profile/        # Hồ sơ & Cài đặt (API qua engine)
│
├── src-tauri/                         # Cấu hình đóng gói Desktop App bằng Tauri
│   ├── tauri.conf.json                # Thiết lập Sidecar binary & cửa sổ ứng dụng
│   ├── Cargo.toml                     # Dependencies Rust
│   └── src/main.rs                    # Vòng đời quản lý tiến trình con & shutdown an toàn
│
└── data/                              # Dữ liệu cục bộ tự động sinh
    ├── config.json                    # Cấu hình hệ thống (Settings Manager)
    ├── fb_automator.db                # SQLite Fallback CSDL (Chế độ WAL)
    ├── keys.txt                       # File text lưu API Keys
    └── proxies.txt                    # File text lưu Proxies
```

---

## 2. PHÂN CÔNG VÀ TRÁCH NHIỆM 9 MODULES

| Module | Tên Module | Thành viên phụ trách | Nhiệm vụ chính |
| :--- | :--- | :--- | :--- |
| **Module 1** | **Dashboard** | **Đức** | Thống kê số lượng Acc (Live/Die), Tổng Page, Bài đăng hôm nay, Sức khỏe Proxy, Nhật ký gần đây. |
| **Module 2** | **Quản lý Account FB** | **Mạnh Cường** | Quản lý danh sách tài khoản, Import hàng loạt định dạng chuẩn `UID\|PASS\|2FA\|COOKIE\|TOKEN\|MAIL...`, Export, Check Live/Die. |
| **Module 3** | **Nuôi Acc (Farm)** | **Cường Trần, Bình Kiến** | Kịch bản mô phỏng hành vi: lướt Newsfeed (5-15s), Like dạo, Xem Reels, kiểm tra thông báo, giãn cách ngẫu nhiên an toàn. |
| **Module 4** | **Tạo Page Hàng Loạt** | **Minh** | Tạo Fanpage theo danh sách tên/danh mục, gán tài khoản tạo, tự động lấy Page Token vĩnh viễn và đồng bộ ngay sang Module 5. |
| **Module 5** | **Quản Lý Fanpage (LÕI)**| **Bình Ka, Kiệt** | Kế thừa lõi tool gốc: Đăng bài AI (Batching 10 trang, Gemini), Đăng Reels 3-phase theo thư mục `1, 2, 3...`, Đăng Video dài, cào video TikTok/YouTube đưa thẳng vào pipeline. |
| **Module 6** | **Quản Lý Chat Page** | **Mạnh, Minh** | Hộp thư tập trung đa page, trả lời thủ công hoặc bật bot tự động phản hồi khách hàng thông minh bằng Google Gemini AI. |
| **Module 7** | **Spam Group FB** | **Anh** | Quét nhóm, tham gia nhóm, đăng bài lên nhóm theo danh sách ID, tự động bình luận dạo bài hot theo spin syntax. |
| **Module 8** | **Seeding Tương Tác** | **Hưởng, Trường** | Dùng dàn nick từ Module 2 & 3 để buff Like/Love/Care, buff Comment mồi theo kịch bản, buff Share cho bài viết hoặc video chỉ định. |
| **Module 9** | **Hồ Sơ & Cài Đặt** | **Trường, Kiệt** | Quản lý tài nguyên dùng chung: Nạp Proxy & đo độ trễ, Nạp Gemini API Keys xoay tua, Thiết lập khoảng giãn cách an toàn chống checkpoint. |

---

## 3. CƠ CHẾ HOẠT ĐỘNG & BẢO MẬT MÔI TRƯỜNG (.ENV)

Hệ thống hỗ trợ nạp cấu hình tự động thông qua file môi trường `.env`, không fix cứng mật khẩu vào mã nguồn.

### Thiết lập file `.env`
Khi mới clone dự án về, sao chép file mẫu:
```bash
# Trên Windows cmd/PowerShell:
copy .env.example .env

# Trên Linux/macOS:
cp .env.example .env
```

Nội dung cấu hình tiêu chuẩn trong `.env`:
```env
# 1. Cơ sở dữ liệu Supabase PostgreSQL
DATABASE_URL=postgresql://postgres.jnjvyvgvutdjozcljhiv:fb-automator-core@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require

# 2. Local Engine Server (FastAPI Sidecar)
ENGINE_HOST=127.0.0.1
ENGINE_PORT=28129

# 3. Frontend Next.js Public URLs
NEXT_PUBLIC_API_URL=http://127.0.0.1:28129
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:28129/ws/logs

# 4. Google Gemini API Keys (phân cách bằng dấu phẩy)
GEMINI_API_KEYS=your_gemini_api_key_1,your_gemini_api_key_2

# 5. Cấu hình Meta Graph API
FACEBOOK_GRAPH_API_VERSION=v19.0
```

> **Cơ chế CSDL linh hoạt:** Nếu `DATABASE_URL` để trống, hệ thống sẽ tự động fallback về SQLite cục bộ tại `data/fb_automator.db` với chế độ Write-Ahead Logging (WAL) đa luồng.

---

## 4. HƯỚNG DẪN CÀI ĐẶT & KHỞI CHẠY HỆ THỐNG

### Bước 1: Cài đặt Dependencies

**1. Cài đặt Python Dependencies:**
```bash
pip install -r requirements.txt
```

**2. Cài đặt Node.js Dependencies (cho Frontend):**
```bash
npm run setup
# Hoặc: cd frontend && npm install
```

---

### Bước 2: Khởi chạy Dự án (1 Lệnh Duy Nhất)

Để khởi động toàn bộ dự án gồm cả **Backend (FastAPI)** và **Frontend (Next.js)**, bạn chỉ cần chạy:

```bash
# Cách 1: Chạy lệnh Python
python start.py

# Cách 2: Click đúp trực tiếp chuột vào file trên Windows
start.bat

# Cách 3: Chạy qua npm
npm start
```

**Quá trình tự động diễn ra:**
1. Khởi động Backend Local Engine tại `http://127.0.0.1:28129` (kết nối Supabase).
2. Khởi động Frontend Web App tại `http://localhost:3000`.
3. Kiểm tra tự động các cổng mạng và tự động mở trình duyệt web.
4. Tài liệu Swagger API Backend tự động sẵn sàng tại: `http://127.0.0.1:28129/docs`.
5. **Dọn dẹp triệt để khi thoát:** Khi nhấn `Ctrl + C`, toàn bộ cây tiến trình con được tắt sạch sẽ bằng `taskkill /F /T /PID`, giải phóng ngay lập tức cổng `28129` và `3000`.

---

### Bước 3: Tự kiểm thử hệ thống (Self-Test)

Để kiểm tra nhanh xem môi trường, CSDL, Backend và Frontend có đang phản hồi 200 OK hay không:
```bash
python start.py --test --no-browser
```
Lệnh sẽ tự động khởi động các dịch vụ, ping kiểm tra `/api/health`, `/api/dashboard/stats`, `http://localhost:3000`, in kết quả kiểm thử và tự giải phóng cổng.

---

### Bước 4: Chạy từng phần riêng biệt (Dành cho Dev độc lập)

Nếu bạn là Backend Dev hoặc Frontend Dev và chỉ muốn chạy riêng phần việc của mình:

* **Chỉ chạy Backend Local Engine:**
  ```bash
  npm run engine:dev
  # Hoặc: python engine.py --port 28129
  ```

* **Chỉ chạy Frontend Next.js:**
  ```bash
  npm run frontend:dev
  # Hoặc: cd frontend && npm run dev
  ```

---

## 5. HƯỚNG DẪN ĐÓNG GÓI RA FILE THỰC THI (.EXE)

Dự án áp dụng kiến trúc **Tauri + PyInstaller Sidecar**, cho ra file `.exe` siêu nhẹ (~15 - 20 MB), khởi động tức thì và chạy mượt mà trên Windows 10/11 nhờ Microsoft WebView2:

```text
[Tauri Shell: FB_Page_Automator.exe (~15-20MB)]
       │ (Tự kích hoạt và giám sát tiến trình)
       ▼
[Sidecar: local_engine.exe (FastAPI ngầm tại port 28129)]
       ▲
       │ (WebSocket & REST API calls)
[Frontend: Next.js tĩnh (export ra frontend/out)]
```

### Lệnh đóng gói toàn bộ dự án:
```bash
npm run build:all
```
Lệnh trên sẽ tự động:
1. Build giao diện Next.js ra thư mục tĩnh `frontend/out`.
2. PyInstaller biên dịch `engine.py` thành `src-tauri/binaries/local_engine-x86_64-pc-windows-msvc.exe`.
3. Tauri đóng gói toàn bộ thành file cài đặt duy nhất `FB_Page_Automator.exe`.

> **Lưu ý:** Chỉ máy của Tech Lead / người phụ trách đóng gói cần cài Rust (`cargo`) và `pyinstaller`. Các thành viên khác phát triển chức năng bình thường thông qua `python start.py` mà không cần cài đặt môi trường Rust.

---

## 6. QUY TẮC PHÁT TRIỂN & CHỐNG XUNG ĐỘT GIT

1. **Frontend Modules (`frontend/src/modules/`):**
   * Mỗi thành viên chỉ code giao diện trong thư mục module được phân công (ví dụ: `module_02_account_manager`).
   * Sử dụng thư viện gọi API tập trung [`src/services/api.js`](file:///f:/app/tool%20py/fb-automator-core/frontend/src/services/api.js) (Axios), không dùng `fetch` tùy tiện.
   * Sử dụng các UI components dùng chung tại [`src/components/ui/`](file:///f:/app/tool%20py/fb-automator-core/frontend/src/components/ui).

2. **Backend Engine (`engine.py` & `core/`):**
   * Không sửa đổi trực tiếp các file Core Engine dùng chung (`core/database/`, `core/facebook/`) nếu chưa có sự thống nhất với Team Lead.
   * CSDL dùng chung Supabase PostgreSQL được quản lý tập trung tại [`core/database/models.py`](file:///f:/app/tool%20py/fb-automator-core/core/database/models.py) bởi người phụ trách thiết kế Database.
   * Mọi endpoint mới cần định nghĩa schema rõ ràng qua Pydantic `BaseModel`.
