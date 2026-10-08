# -*- coding: utf-8 -*-
"""
File: core/youtube_downloader.py
"""
import os
import time
import sqlite3
import datetime
import threading
import re
from concurrent.futures import ThreadPoolExecutor
from PyQt5.QtCore import QThread, pyqtSignal
import yt_dlp
import shutil
import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, module="duckduckgo_search")
warnings.filterwarnings("ignore", message=".*renamed to.*")

DB_FILE = "videos.db"
db_lock = threading.Lock()

def get_ffmpeg_path():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return None

REALISTIC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

def build_ydl_base_opts(cookie_file="", cookie_browser="", is_download=False, outtmpl=None, ffmpeg_exe=None):
    """Tạo cấu hình ydl tối ưu chống bị YouTube quét bot và rate-limit"""
    opts = {
        'quiet': True,
        'no_warnings': False,
        'js_runtimes': {'node': {}},
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android', 'mweb', 'web'],
                'player_skip': ['js'],
            }
        },
        'http_headers': {
            'User-Agent': REALISTIC_USER_AGENT,
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Sec-Fetch-Mode': 'navigate',
        },
        'socket_timeout': 30,
        'retries': 15,
        'fragment_retries': 15,
        'retry_sleep': 'fragment:exp=1:20',
        'sleep_interval_requests': 1,  # Giãn cách nhẹ giữa các request con để tránh bị nghi là bot
    }

    if not is_download:
        opts['skip_download'] = True

    if outtmpl:
        opts['outtmpl'] = outtmpl
        opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
        opts['merge_output_format'] = 'mp4'

    if ffmpeg_exe:
        opts['ffmpeg_location'] = ffmpeg_exe

    if cookie_file and os.path.exists(cookie_file):
        opts['cookiefile'] = cookie_file
    elif cookie_browser and "không dùng" not in cookie_browser.lower():
        opts['cookiesfrombrowser'] = (cookie_browser,)

    return opts

def init_db():
    with db_lock:
        conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        return conn

def video_exists(conn, table, vid):
    with db_lock:
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT 1 FROM {table} WHERE id = ?", (vid,))
            return cur.fetchone() is not None
        except sqlite3.OperationalError:
            return False

def insert_video(conn, table, vid, caption, link):
    with db_lock:
        cur = conn.cursor()
        cur.execute(f"INSERT OR IGNORE INTO {table} (id, caption, link, downloaded_at) VALUES (?,?,?,?)",
                    (vid, caption, link, datetime.datetime.now().isoformat()))
        conn.commit()

def get_next_folder_number(page_dir):
    if not os.path.exists(page_dir):
        return 1
    existing_numbers = []
    try:
        for name in os.listdir(page_dir):
            if os.path.isdir(os.path.join(page_dir, name)) and name.isdigit():
                existing_numbers.append(int(name))
    except Exception:
        pass
    return max(existing_numbers) + 1 if existing_numbers else 1

def convert_youtube_hashtags_to_facebook(text):
    if not text:
        return ""
    # Convert common YT hashtags if needed
    replacements = {
        r'#shorts\b': '#reels',
        r'#shortsvideo\b': '#reels',
        r'#youtube\b': '#facebook',
        r'#ytshorts\b': '#reels'
    }
    for pattern, repl in replacements.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    return text

class YouTubeBulkDownloader(QThread):
    log_signal = pyqtSignal(str)
    page_status_signal = pyqtSignal(int, str)  # index, status text
    finished_signal = pyqtSignal()

    def __init__(self, pages_list, download_folder, cookie_browser="", cookie_file="", delay_seconds=2, max_videos_per_page=5, max_workers=5, parent=None):
        super().__init__(parent)
        self.pages_list = pages_list
        self.download_folder = download_folder
        self.cookie_browser = cookie_browser.strip()
        self.cookie_file = cookie_file.strip()
        self.delay_seconds = float(delay_seconds)
        self.max_videos_per_page = int(max_videos_per_page)
        self.max_workers = int(max_workers)
        self.is_running = True

    def stop(self):
        self.is_running = False

    def run(self):
        conn = init_db()
        self.log_signal.emit("=========================================================")
        self.log_signal.emit(f" BẮT ĐẦU TẢI YOUTUBE SHORTS SONG SONG ({self.max_workers} LUỒNG) ")
        self.log_signal.emit("=========================================================")
        
        # Log cookie settings to alert the user
        if self.cookie_file and os.path.exists(self.cookie_file):
            self.log_signal.emit(f"[*] Cấu hình Cookies: Sử dụng file '{self.cookie_file}'")
        elif self.cookie_browser and "không dùng" not in self.cookie_browser.lower():
            self.log_signal.emit(f"[*] Cấu hình Cookies: Trích xuất từ trình duyệt '{self.cookie_browser}'")
        else:
            self.log_signal.emit("[!] Cảnh báo: CHƯA CẤU HÌNH COOKIES. YouTube rất dễ chặn bot tải video!")
            self.log_signal.emit("    -> Hãy đăng nhập YouTube trên Chrome/Edge rồi chọn trình duyệt đó ở ô 'Cookies từ trình duyệt'.")

        # Log ffmpeg status
        ffmpeg_exe = get_ffmpeg_path()
        if ffmpeg_exe:
            self.log_signal.emit(f"[*] FFmpeg: Đã tìm thấy tại '{ffmpeg_exe}'")
        else:
            self.log_signal.emit("[!] CẢNH BÁO: Chưa tìm thấy FFmpeg trong hệ thống hoặc venv!")
            self.log_signal.emit("    -> Hãy chạy lệnh: 'pip install imageio-ffmpeg' trong Terminal để tải được mọi video HD.")

        main_folder = os.path.abspath(self.download_folder.strip())
        try:
            os.makedirs(main_folder, exist_ok=True)
        except Exception as e:
            self.log_signal.emit(f"[ERROR] Không thể tạo thư mục lưu video '{main_folder}': {str(e)}")
            self.finished_signal.emit()
            return

        def download_page_videos(args):
            idx, page = args
            if not self.is_running:
                self.page_status_signal.emit(idx, "Bị dừng")
                return

            page_name = page.get("name", "Unknown Page")
            page_id = page.get("id")
            
            if not page_id:
                self.log_signal.emit(f"[WARNING] Bỏ qua trang '{page_name}' do thiếu ID.")
                self.page_status_signal.emit(idx, "Lỗi ID")
                return

            table = f"tbl_youtube_{page_id}"
            
            # Tạo bảng an toàn đồng bộ
            with db_lock:
                cur = conn.cursor()
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {table} (
                        id TEXT PRIMARY KEY,
                        caption TEXT,
                        link TEXT,
                        downloaded_at TEXT
                    )
                """)
                conn.commit()

            # Phát hiện xem người dùng nhập link video đơn, link kênh hay là từ khóa
            youtube_search = page.get("youtube_search") or page_name
            youtube_search = youtube_search.strip()
            target_lower = youtube_search.lower()

            is_single_video = ("youtube.com/watch" in target_lower or "youtu.be/" in target_lower or "youtube.com/shorts" in target_lower)
            is_channel_url = youtube_search.startswith("http") and ("youtube.com" in youtube_search or "youtu.be" in youtube_search) and not is_single_video
            results = []

            if is_single_video:
                self.log_signal.emit(f"[*] [{page_name}] Phát hiện liên kết video đơn YouTube: {youtube_search}. Sẽ tải trực tiếp...")
                self.page_status_signal.emit(idx, "Tải video đơn...")
                results.append({
                    "content": youtube_search,
                    "title": "",
                    "duration": ""
                })
            elif is_channel_url:
                self.log_signal.emit(f"[*] [{page_name}] Phát hiện liên kết kênh YouTube: {youtube_search}. Đang trích xuất danh sách video...")
                self.page_status_signal.emit(idx, "Đang trích xuất kênh...")

                # Định dạng URL đích để nhắm thẳng vào tab Shorts
                if "/shorts" not in youtube_search and "/videos" not in youtube_search:
                    clean_url = youtube_search.rstrip('/')
                    target_url = f"{clean_url}/shorts"
                else:
                    target_url = youtube_search

                ydl_search_opts = build_ydl_base_opts(cookie_file=self.cookie_file, cookie_browser=self.cookie_browser, is_download=False)
                ydl_search_opts['extract_flat'] = 'in_playlist'
                ydl_search_opts['playlistend'] = 15

                try:
                    with yt_dlp.YoutubeDL(ydl_search_opts) as ydl:
                        result = ydl.extract_info(target_url, download=False)
                        if result:
                            if 'entries' in result:
                                for entry in result['entries']:
                                    video_id = entry.get('id')
                                    if video_id:
                                        results.append({
                                            "content": f"https://www.youtube.com/watch?v={video_id}",
                                            "title": entry.get('title') or "no_title",
                                            "duration": ""
                                        })
                            else:
                                video_id = result.get('id')
                                if video_id:
                                    results.append({
                                        "content": f"https://www.youtube.com/watch?v={video_id}",
                                        "title": result.get('title') or "no_title",
                                        "duration": ""
                                    })
                except Exception as e:
                    err_msg = str(e)
                    self.log_signal.emit(f"[ERROR] [{page_name}] Lỗi khi trích xuất kênh/video qua yt-dlp: {err_msg}")
                    if "confirm you're not a bot" in err_msg or "Sign in to confirm" in err_msg:
                        self.log_signal.emit(f"[HELP] [{page_name}] HƯỚNG DẪN KHẮC PHỤC LỖI CHẶN BOT:")
                        self.log_signal.emit("   -> Bước 1: Hãy đăng nhập tài khoản YouTube của bạn trên trình duyệt (Chrome/Edge/Firefox...).")
                        self.log_signal.emit("   -> Bước 2: Tại giao diện phần mềm, chọn đúng trình duyệt đó ở ô 'Cookies từ trình duyệt' phía trên.")
                        self.log_signal.emit("   -> Bước 3: Hoặc dùng tiện ích 'Get cookies.txt LOCALLY' trên trình duyệt để xuất file Netscape cookies.txt và nạp vào ô 'file cookies.txt'.")
                    elif "locked" in err_msg.lower() or "database is locked" in err_msg.lower() or "permission denied" in err_msg.lower():
                        self.log_signal.emit(f"[HELP] [{page_name}] LỖI TRUY CẬP COOKIES TRÌNH DUYỆT:")
                        self.log_signal.emit("   -> Bạn đã chọn Cookies từ trình duyệt nhưng trình duyệt đó đang chạy và khóa file cookies.")
                        self.log_signal.emit("   -> Hãy ĐÓNG HOÀN TOÀN trình duyệt đó (Chrome/Edge...) rồi nhấn Bắt đầu lại.")
                        self.log_signal.emit("   -> Hoặc dùng file cookies.txt.")
                    self.page_status_signal.emit(idx, "Lỗi trích xuất")
                    return
            else:
                # Bước 1: Thử tìm kiếm qua DuckDuckGo Search API
                ddg_success = False
                try:
                    try:
                        # pyrefly: ignore [missing-import]
                        from ddgs import DDGS
                    except ImportError:
                        # pyrefly: ignore [missing-import]
                        from duckduckgo_search import DDGS
                    with DDGS() as ddgs:
                        ddg_results = ddgs.videos(f"{youtube_search} shorts", max_results=15)
                        if ddg_results:
                            results = list(ddg_results)
                            ddg_success = True
                except Exception as ddg_err:
                    self.log_signal.emit(f"[WARNING] [{page_name}] DuckDuckGo bị lỗi/giới hạn ({str(ddg_err)}). Chuyển sang tìm kiếm dự phòng bằng yt-dlp...")

                # Bước 2: Dự phòng bằng yt-dlp (ytsearch) kết hợp Cookies nếu DuckDuckGo thất bại hoặc không ra kết quả
                if not ddg_success or not results:
                    self.log_signal.emit(f"[*] [{page_name}] Đang tìm kiếm trực tiếp trên YouTube qua yt-dlp: 'ytsearch15:{youtube_search} shorts'...")
                    ydl_search_opts = build_ydl_base_opts(cookie_file=self.cookie_file, cookie_browser=self.cookie_browser, is_download=False)
                    ydl_search_opts['extract_flat'] = 'in_playlist'
                    ydl_search_opts['playlistend'] = 15

                    try:
                        with yt_dlp.YoutubeDL(ydl_search_opts) as ydl_search:
                            search_res = ydl_search.extract_info(f"ytsearch15:{youtube_search} shorts", download=False)
                            if search_res and 'entries' in search_res:
                                for entry in search_res['entries']:
                                    if entry and entry.get('id'):
                                        video_id = entry.get('id')
                                        results.append({
                                            "content": f"https://www.youtube.com/watch?v={video_id}",
                                            "title": entry.get('title') or "no_title",
                                            "duration": ""
                                        })
                    except Exception as ydl_err:
                        err_msg = str(ydl_err)
                        self.log_signal.emit(f"[ERROR] [{page_name}] Lỗi khi tìm kiếm qua yt-dlp: {err_msg}")
                        if "confirm you're not a bot" in err_msg or "Sign in to confirm" in err_msg:
                            self.log_signal.emit(f"[HELP] [{page_name}] Cần nạp Cookies (từ trình duyệt hoặc file cookies.txt) để tìm kiếm và tải video.")
                        self.page_status_signal.emit(idx, "Lỗi tìm kiếm")
                        return

            if not results:
                self.log_signal.emit(f"[*] [{page_name}] Không tìm thấy video nào phù hợp.")
                self.page_status_signal.emit(idx, "Trống")
                return

            downloaded_this_page = 0
            has_error = False
            error_reason = ""

            for item in results:
                if downloaded_this_page >= self.max_videos_per_page or not self.is_running:
                    break

                link = item.get("content") or item.get("embed_url") or item.get("publisher") or ""
                if not link or "youtube.com" not in link:
                    continue

                # Bóc tách video ID từ link YouTube
                match = re.search(r'(?:v=|\/)([0-9A-Za-z_-]{11})', link)
                if not match:
                    continue
                vid = match.group(1)

                # Kiểm tra xem video đã từng được tải chưa (chỉ áp dụng khi không phải link video đơn)
                if not is_single_video and video_exists(conn, table, vid):
                    continue

                title = item.get("title") or "no_title"
                dur_str = item.get("duration") or ""
                duration = 0
                if dur_str:
                    try:
                        parts = list(map(int, dur_str.split(':')))
                        if len(parts) == 2:
                            duration = parts[0] * 60 + parts[1]
                        elif len(parts) == 3:
                            duration = parts[0] * 3600 + parts[1] * 60 + parts[2]
                    except Exception:
                        pass

                self.log_signal.emit(f"[*] [{page_name}] Đang bóc tách chi tiết cho video {vid}...")

                # Trích xuất thông tin chi tiết (đặc biệt là description và duration nếu chưa có) qua yt-dlp
                ydl_info_opts = build_ydl_base_opts(cookie_file=self.cookie_file, cookie_browser=self.cookie_browser, is_download=False)

                description = ""
                duration_detail = 0
                try:
                    with yt_dlp.YoutubeDL(ydl_info_opts) as ydl_info:
                        info = ydl_info.extract_info(link, download=False)
                        description = info.get("description") or ""
                        title = info.get("title") or title
                        duration_detail = info.get("duration") or 0
                except Exception as e:
                    # Nếu bị chặn bot lấy info, dùng luôn tiêu đề làm mô tả, không ngắt tiến trình
                    self.log_signal.emit(f"[WARNING] [{page_name}] Không lấy được mô tả đầy đủ do YouTube chặn bot. Sẽ dùng tiêu đề làm mô tả.")
                    description = title

                if not title or title == "no_title":
                    title = f"video_{vid}"

                self.log_signal.emit(f"[*] [{page_name}] Đang tải video {downloaded_this_page + 1}/{self.max_videos_per_page} (ID: {vid})...")
                self.page_status_signal.emit(idx, f"Tải {downloaded_this_page + 1}/{self.max_videos_per_page}...")

                facebook_caption = convert_youtube_hashtags_to_facebook(description if description else title)

                safe_name = "".join(c for c in title if c.isalnum() or c in " ._-").strip()
                safe_name = safe_name[:100] if safe_name else vid

                page_dir = os.path.join(main_folder, page_name)

                # Lấy số thư mục con tiếp theo
                with db_lock:
                    num = get_next_folder_number(page_dir)
                    video_folder = os.path.join(page_dir, str(num))
                    os.makedirs(video_folder, exist_ok=True)

                video_path = os.path.join(video_folder, f"{safe_name}.mp4")
                caption_path = os.path.join(video_folder, f"{safe_name}.txt")

                ffmpeg_exe = get_ffmpeg_path()
                download_opts = build_ydl_base_opts(
                    cookie_file=self.cookie_file,
                    cookie_browser=self.cookie_browser,
                    is_download=True,
                    outtmpl=os.path.join(video_folder, f"{safe_name}.%(ext)s"),
                    ffmpeg_exe=ffmpeg_exe
                )

                try:
                    with yt_dlp.YoutubeDL(download_opts) as ydl_down:
                        ydl_down.download([link])

                    if not self.is_running:
                        self.page_status_signal.emit(idx, "Bị dừng")
                        # Dọn dẹp nếu bị hủy ngang
                        if os.path.exists(video_path):
                            try: os.remove(video_path)
                            except Exception: pass
                        return

                    # Đổi tên nếu tải ra đuôi khác .mp4
                    downloaded_file = None
                    for ext in ['mp4', 'webm', 'mkv', '3gp', 'flv']:
                        test_path = os.path.join(video_folder, f"{safe_name}.{ext}")
                        if os.path.exists(test_path):
                            downloaded_file = test_path
                            break
                    if downloaded_file and downloaded_file != video_path:
                        try:
                            if os.path.exists(video_path):
                                os.remove(video_path)
                            os.rename(downloaded_file, video_path)
                        except Exception as rename_err:
                            self.log_signal.emit(f"[WARNING] Không thể đổi đuôi file sang .mp4: {str(rename_err)}")

                    # Ghi caption
                    with open(caption_path, "w", encoding="utf-8") as f:
                        f.write(facebook_caption.strip())

                    # Ghi nhận lịch sử tải
                    insert_video(conn, table, vid, title, link)
                    downloaded_this_page += 1
                    self.log_signal.emit(f"[SUCCESS] [{page_name}] Đã tải xong video YouTube Shorts số {downloaded_this_page}: {vid}")
                    self.page_status_signal.emit(idx, f"Đã tải {downloaded_this_page}/{self.max_videos_per_page}")

                except Exception as e:
                    if os.path.exists(video_path):
                        try: os.remove(video_path)
                        except Exception: pass
                    err_msg = str(e)
                    self.log_signal.emit(f"[ERROR] [{page_name}] Lỗi tải file: {err_msg}")
                    has_error = True
                    if "confirm you're not a bot" in err_msg or "Sign in to confirm" in err_msg:
                        error_reason = "Bị chặn bot"
                        self.log_signal.emit(f"[HELP] [{page_name}] HƯỚNG DẪN KHẮC PHỤC LỖI CHẶN BOT:")
                        self.log_signal.emit("   -> Bước 1: Hãy đăng nhập tài khoản YouTube của bạn trên trình duyệt (Chrome/Edge/Firefox...).")
                        self.log_signal.emit("   -> Bước 2: Tại giao diện phần mềm, chọn đúng trình duyệt đó ở ô 'Cookies từ trình duyệt' phía trên.")
                    elif "ffmpeg is not installed" in err_msg.lower() or "requested format is not available" in err_msg.lower():
                        error_reason = "Thiếu FFmpeg"
                        self.log_signal.emit(f"[HELP] [{page_name}] LỖI THIẾU FFMPEG ĐỂ GHÉP VIDEO:")
                        self.log_signal.emit("   -> Hãy mở Terminal và chạy lệnh: pip install imageio-ffmpeg")
                        self.log_signal.emit("   -> Sau đó khởi động lại ứng dụng để tải video bình thường.")
                    elif "locked" in err_msg.lower() or "database is locked" in err_msg.lower() or "permission denied" in err_msg.lower():
                        error_reason = "Lỗi Cookies"
                        self.log_signal.emit(f"[HELP] [{page_name}] LỖI TRUY CẬP COOKIES TRÌNH DUYỆT:")
                        self.log_signal.emit("   -> Bạn đã chọn Cookies từ trình duyệt nhưng trình duyệt đó đang chạy và khóa file cookies.")
                        self.log_signal.emit("   -> Hãy ĐÓNG HOÀN TOÀN trình duyệt đó (Chrome/Edge...) rồi nhấn Bắt đầu lại.")
                        self.log_signal.emit("   -> Hoặc dùng file cookies.txt.")
                    else:
                        if not error_reason:
                            error_reason = "Lỗi tải"

                # Tránh gọi dồn dập
                if self.delay_seconds > 0:
                    time.sleep(self.delay_seconds)

            if not self.is_running:
                self.page_status_signal.emit(idx, "Bị dừng")
            elif downloaded_this_page > 0:
                self.page_status_signal.emit(idx, f"Đã tải {downloaded_this_page}/{self.max_videos_per_page}")
            elif has_error:
                self.page_status_signal.emit(idx, error_reason if error_reason else "Lỗi tải")
            else:
                self.page_status_signal.emit(idx, "Không có Shorts mới")

        # Chạy ThreadPool song song
        tasks = list(enumerate(self.pages_list))
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            list(executor.map(download_page_videos, tasks))

        conn.close()
        self.log_signal.emit("\n[FINISHED] Tiến trình tải video YouTube Shorts hàng loạt kết thúc.")
        self.finished_signal.emit()


class YouTubeSingleDownloader(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(bool, str)  # success, message

    def __init__(self, video_url, save_folder, cookie_browser="", cookie_file="", parent=None):
        super().__init__(parent)
        self.video_url = video_url.strip()
        self.save_folder = save_folder.strip()
        self.cookie_browser = cookie_browser.strip()
        self.cookie_file = cookie_file.strip()
        self.is_running = True

    def stop(self):
        self.is_running = False

    def run(self):
        self.log_signal.emit("=========================================================")
        self.log_signal.emit(f"[*] BẮT ĐẦU TẢI NHANH VIDEO: {self.video_url}")
        self.log_signal.emit("=========================================================")

        # Log cookie settings to alert the user
        if self.cookie_file and os.path.exists(self.cookie_file):
            self.log_signal.emit(f"[*] Cấu hình Cookies: Sử dụng file '{self.cookie_file}'")
        elif self.cookie_browser and "không dùng" not in self.cookie_browser.lower():
            self.log_signal.emit(f"[*] Cấu hình Cookies: Trích xuất từ trình duyệt '{self.cookie_browser}'")
        else:
            self.log_signal.emit("[!] Cảnh báo: CHƯA CẤU HÌNH COOKIES. YouTube rất dễ chặn bot tải video!")
            self.log_signal.emit("    -> Hãy đăng nhập YouTube trên Chrome/Edge rồi chọn trình duyệt đó ở ô 'Cookies từ trình duyệt'.")

        if not self.video_url:
            self.log_signal.emit("[ERROR] Đường dẫn video rỗng.")
            self.finished_signal.emit(False, "Đường dẫn video rỗng.")
            return

        if not os.path.exists(self.save_folder):
            try:
                os.makedirs(self.save_folder, exist_ok=True)
            except Exception as e:
                self.log_signal.emit(f"[ERROR] Không thể tạo thư mục lưu: {str(e)}")
                self.finished_signal.emit(False, f"Lỗi tạo thư mục: {str(e)}")
                return

        # Trích xuất thông tin
        ydl_info_opts = build_ydl_base_opts(cookie_file=self.cookie_file, cookie_browser=self.cookie_browser, is_download=False)

        title = "youtube_video"
        description = ""
        try:
            with yt_dlp.YoutubeDL(ydl_info_opts) as ydl_info:
                info = ydl_info.extract_info(self.video_url, download=False)
                title = info.get("title") or "youtube_video"
                description = info.get("description") or ""
        except Exception as e:
            self.log_signal.emit(f"[WARNING] Không lấy được thông tin chi tiết qua API: {str(e)}")
            description = title

        # Làm sạch tên file
        safe_name = "".join(c for c in title if c.isalnum() or c in " ._-").strip()
        safe_name = safe_name[:100] if safe_name else "video"

        video_path = os.path.join(self.save_folder, f"{safe_name}.mp4")
        caption_path = os.path.join(self.save_folder, f"{safe_name}.txt")

        base_name = safe_name
        counter = 1
        while os.path.exists(video_path):
            safe_name = f"{base_name}_{counter}"
            video_path = os.path.join(self.save_folder, f"{safe_name}.mp4")
            caption_path = os.path.join(self.save_folder, f"{safe_name}.txt")
            counter += 1

        self.log_signal.emit(f"[*] Đang tải video về: {video_path}")

        ffmpeg_exe = get_ffmpeg_path()
        download_opts = build_ydl_base_opts(
            cookie_file=self.cookie_file,
            cookie_browser=self.cookie_browser,
            is_download=True,
            outtmpl=os.path.join(self.save_folder, f"{safe_name}.%(ext)s"),
            ffmpeg_exe=ffmpeg_exe
        )

        try:
            with yt_dlp.YoutubeDL(download_opts) as ydl_down:
                ydl_down.download([self.video_url])

            if not self.is_running:
                self.log_signal.emit("[INFO] Đã hủy tải giữa chừng.")
                if os.path.exists(video_path):
                    try: os.remove(video_path)
                    except Exception: pass
                self.finished_signal.emit(False, "Bị hủy ngang.")
                return

            # Đổi tên nếu tải ra đuôi khác .mp4
            downloaded_file = None
            for ext in ['mp4', 'webm', 'mkv', '3gp', 'flv']:
                test_path = os.path.join(self.save_folder, f"{safe_name}.{ext}")
                if os.path.exists(test_path):
                    downloaded_file = test_path
                    break
            if downloaded_file and downloaded_file != video_path:
                try:
                    if os.path.exists(video_path):
                        os.remove(video_path)
                    os.rename(downloaded_file, video_path)
                except Exception as rename_err:
                    self.log_signal.emit(f"[WARNING] Không thể đổi đuôi file sang .mp4: {str(rename_err)}")

            # Ghi mô tả thành file txt
            facebook_caption = convert_youtube_hashtags_to_facebook(description if description else title)
            with open(caption_path, "w", encoding="utf-8") as f:
                f.write(facebook_caption.strip())

            self.log_signal.emit(f"[SUCCESS] Đã tải xong video: {title}")
            self.finished_signal.emit(True, f"Đã tải xong: {title}")
        except Exception as e:
            if os.path.exists(video_path):
                try: os.remove(video_path)
                except Exception: pass
            err_msg = str(e)
            self.log_signal.emit(f"[ERROR] Lỗi khi tải video: {err_msg}")
            if "confirm you're not a bot" in err_msg or "Sign in to confirm" in err_msg:
                self.log_signal.emit("[HELP] Bạn bị YouTube chặn bot! Vui lòng chọn cookies từ trình duyệt (Chrome/Edge...) hoặc nạp file cookies.txt phía trên để vượt qua.")
            elif "ffmpeg is not installed" in err_msg.lower() or "requested format is not available" in err_msg.lower():
                self.log_signal.emit("[HELP] LỖI THIẾU FFMPEG: Hãy mở Terminal và chạy lệnh 'pip install imageio-ffmpeg' rồi khởi động lại app.")
            elif "locked" in err_msg.lower() or "database is locked" in err_msg.lower() or "permission denied" in err_msg.lower():
                self.log_signal.emit("[HELP] LỖI TRUY CẬP COOKIES TRÌNH DUYỆT: Trình duyệt đang chạy và khóa file cookies. Hãy ĐÓNG HOÀN TOÀN trình duyệt hoặc dùng file cookies.txt.")
            self.finished_signal.emit(False, f"Lỗi: {err_msg}")
