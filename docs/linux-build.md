# Bản cài Linux

Dự án hỗ trợ đóng gói Tauri + Python engine thành `.deb` và `.AppImage`.
Build trực tiếp trên Linux cùng kiến trúc với máy sẽ chạy ứng dụng; file `.exe`
Windows không chuyển đổi trực tiếp sang bộ cài Linux.

## Build bằng GitHub Actions

Workflow **Build Desktop Installer (Tauri + Python Sidecar)** có hai job Windows
và Linux. Chạy thủ công bằng `workflow_dispatch`, hoặc đẩy tag `v*`.
Sau khi job Linux thành công, tải artifact **FB-Automator-Linux-Installer**.
Artifact chứa cả `.deb` và `.AppImage` cho Linux x86_64.

Linux được build trên Ubuntu 22.04 để tránh phụ thuộc glibc của Ubuntu mới hơn.
Tham khảo [giới hạn tương thích AppImage của Tauri](https://v2.tauri.app/distribute/appimage/#limitations).

## Build trên Ubuntu / Debian

Cần Python 3.11+, Node.js 20+ và Rust stable. Cài Rust theo
[hướng dẫn Tauri](https://v2.tauri.app/start/prerequisites/#rust).
Cài thư viện hệ thống theo [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux):

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl wget file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf python3-venv python3-tk
```

Trong thư mục gốc dự án:

```bash}
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-build.txt
npm ci
npm --prefix frontend ci
APPIMAGE_EXTRACT_AND_RUN=1 npm run build:linux
```

Kết quả:

- `.deb`: `src-tauri/target/release/bundle/deb/`
- `.AppImage`: `src-tauri/target/release/bundle/appimage/`

Kiểm tra `python3 --version` trước khi build. Ubuntu 22.04 mặc định dùng Python
3.10; cần chọn Python 3.11+ để tạo môi trường `.venv`, hoặc dùng job CI đã có
Python 3.11. Ubuntu 24.04 mặc định có Python 3.12.

Lệnh build tự tạo Python engine với tên đúng theo `rustc -vV`, giữ quyền chạy
trên Linux và dừng khi PyInstaller lỗi. Không cần Python hoặc Node.js trên máy
người dùng sau khi đã cài ứng dụng.

## Cấu hình trước lần chạy đầu

Bản Linux lưu cấu hình, log, file tải lên và browser profile tại
`${XDG_DATA_HOME:-$HOME/.local/share}/FBAutomator/`.
Cấu hình `.env` tại thư mục này, dùng các biến của `.env.example`; cần
`DATABASE_URL` PostgreSQL hợp lệ để engine khởi động. Có thể truyền biến môi
trường khi chạy ứng dụng thay cho `.env`.

Thư mục mặc định:

```bash
mkdir -p ~/.local/share/FBAutomator
# Tạo ~/.local/share/FBAutomator/.env theo cấu hình môi trường của bạn.
```

Bản Linux không đóng gói `.env`, dữ liệu hoặc profile từ máy build.
Các module tự động hóa trình duyệt cần cài Google Chrome trên máy sử dụng.
Các chức năng media cần FFmpeg; bộ cài `.deb` khai báo dependency FFmpeg và Zenity.
Khi dùng AppImage, cài riêng các tiện ích này nếu module sử dụng đến.

## Cài và chạy

Với Ubuntu/Debian, thay đường dẫn bên dưới bằng file vừa build:

```bash
sudo apt install ./FB_Page_Automator_2.0.0_amd64.deb
```

Với AppImage:

```bash
chmod +x ./FB_Page_Automator_2.0.0_amd64.AppImage
./FB_Page_Automator_2.0.0_amd64.AppImage
```

Nếu máy thiếu FUSE, chạy AppImage với `APPIMAGE_EXTRACT_AND_RUN=1`.
Mở app từ menu ứng dụng sau khi cài `.deb`. Cần kiểm thử các module trên bản
đóng gói với tài khoản thử nghiệm trước khi phân phối cho người dùng.

## Kết quả kiểm tra ngày 28/10/2026

- Build thành công `.deb` (126,44 MiB) và `.AppImage` (200,89 MiB) trên Ubuntu
  22.04 x86_64, Python 3.11.18, Node.js 20.20.2 và Rust 1.99.1.
- 11 test đóng gói/storage đạt trên Python 3.11 và 3.12; 77 test liên quan đạt.
- Engine đã đóng gói khởi động với PostgreSQL thử nghiệm, nạp đủ 10 module và
  trả HTTP 200 ở `/api/health`.
- Engine lấy từ `.deb` cũng khởi động thành công bằng UID 65534, với dữ liệu
  ghi vào thư mục XDG riêng. Engine trong `.deb` khớp checksum bản vừa build.
- Archive có SQL migrations và Python runtime; không chứa `.env` hoặc thư mục
  dữ liệu từ máy build. File cài và `SHA256SUMS` nằm trong `dist/linux/`.

Chưa kiểm thử trực tiếp cửa sổ desktop và các thao tác Facebook thực tế.
Frontend build có cảnh báo hiện có về import `@tauri-apps/api/dialog` tại
`frontend/src/modules/module_05_page_manager/ReelsPoster.jsx`; luồng chọn thư mục
ở module này cần được kiểm tra riêng.

