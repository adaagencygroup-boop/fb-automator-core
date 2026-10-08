# -*- coding: utf-8 -*-
"""
File: core/worker.py
"""
import os
import json
import random
import time
import re
import datetime
from PyQt5.QtCore import QThread, pyqtSignal

try:
    from modules.module_05_page_manager.facebook_client import post_to_facebook_page, upload_reel_to_facebook, upload_video_to_facebook
    from modules.module_05_page_manager.ai_generator import AIGenerator
    from modules.module_05_page_manager.image_downloader import get_image_from_internet
    from modules.module_05_page_manager.sheet_logger import save_posted_to_google_sheet
except ImportError:
    from core.facebook_client import post_to_facebook_page, upload_reel_to_facebook, upload_video_to_facebook
    from core.ai_generator import AIGenerator
    from core.image_downloader import get_image_from_internet
    from core.sheet_logger import save_posted_to_google_sheet

class AutoPostWorker(QThread):
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal()

    def __init__(self, api_keys, fb_version, sleep_min, sleep_max, pages_file, prompt_template, model_name, creds_file, sheet_id, pixabay_key,
                 ai_sched_enabled=False, ai_sched_times="",
                 reels_sched_enabled=False, reels_sched_times="",
                 video_sched_enabled=False, video_sched_times=""):
        super().__init__()
        self.api_keys = [k.strip() for k in api_keys if k.strip()]
        self.fb_version = fb_version
        self.sleep_min = sleep_min
        self.sleep_max = sleep_max
        self.pages_file = pages_file
        self.prompt_template = prompt_template
        self.model_name = model_name
        self.creds_file = creds_file
        self.sheet_id = sheet_id
        self.pixabay_key = pixabay_key
        
        self.ai_sched_enabled = ai_sched_enabled
        self.ai_sched_times = ai_sched_times
        self.reels_sched_enabled = reels_sched_enabled
        self.reels_sched_times = reels_sched_times
        self.video_sched_enabled = video_sched_enabled
        self.video_sched_times = video_sched_times
        
        self.is_running = True

        # Initialize AI Generator helper
        self.ai_gen = AIGenerator(
            api_keys=self.api_keys,
            model_name=self.model_name,
            prompt_template=self.prompt_template,
            log_func=self.log
        )

    def log(self, message):
        self.log_signal.emit(message)

    def check_running(self):
        return self.is_running

    def save_posted(self, p_name, p_id):
        save_posted_to_google_sheet(
            page_name=p_name,
            post_id=p_id,
            creds_file=self.creds_file,
            sheet_id=self.sheet_id,
            log_func=self.log
        )

    def get_next_local_video_post(self, video_folder, page_id):
        if not os.path.exists(video_folder) or not os.path.isdir(video_folder):
            self.log(f"[ERROR] Thư mục video không tồn tại: {video_folder}")
            return None

        # Đọc tiến trình đã đăng từ posting_progress.json
        progress_file = "posting_progress.json"
        last_posted = 0
        progress_data = {}
        if os.path.exists(progress_file):
            try:
                with open(progress_file, 'r', encoding='utf-8') as f:
                    progress_data = json.load(f)
                
                page_progress = progress_data.get(page_id)
                if page_progress is not None:
                    last_posted = page_progress.get("last_posted_folder", 0)
                else:
                    # Tương thích ngược: Đọc từ ID gốc nếu chưa có tiến trình hậu tố
                    base_id = page_id.split('_')[0]
                    last_posted = progress_data.get(base_id, {}).get("last_posted_folder", 0)
            except Exception as e:
                self.log(f"[WARNING] Không đọc được file tiến trình: {str(e)}")

        # Tìm các thư mục con có dạng số
        subfolders = []
        for name in os.listdir(video_folder):
            full_path = os.path.join(video_folder, name)
            if os.path.isdir(full_path) and name.isdigit():
                subfolders.append((int(name), name, full_path))

        # Sắp xếp theo số thứ tự tăng dần
        subfolders.sort(key=lambda x: x[0])

        # Tìm thư mục kế tiếp chưa đăng
        for num, original_name, full_path in subfolders:
            if num > last_posted:
                # Quét file video và file text trong thư mục này
                video_file = None
                text_file = None
                
                for file_name in os.listdir(full_path):
                    lower_name = file_name.lower()
                    if lower_name.endswith(('.mp4', '.mov', '.mkv', '.avi', '.3gp')):
                        video_file = os.path.join(full_path, file_name)
                    elif lower_name.endswith('.txt'):
                        text_file = os.path.join(full_path, file_name)

                if video_file and text_file:
                    try:
                        with open(text_file, 'r', encoding='utf-8') as tf:
                            caption = tf.read().strip()
                        return {
                            "folder_number": num,
                            "video_path": video_file,
                            "caption": caption,
                            "progress_data": progress_data
                        }
                    except Exception as e:
                        self.log(f"[ERROR] Không đọc được file nội dung {text_file}: {str(e)}")
                else:
                    self.log(f"[WARNING] Thư mục {original_name} thiếu file video hoặc file text. Bỏ qua.")

        return None

    def execute_ai_phase(self, ai_pages):
        if not ai_pages or not self.check_running():
            return
        if not self.api_keys:
            self.log("[WARNING] Danh sách API keys trống, bỏ qua các trang AI.")
            return

        self.log("\n>>> BẮT ĐẦU TIẾN TRÌNH ĐĂNG BÀI BẰNG AI BATCHING <<<")
        total_ai_pages = len(ai_pages)
        for i in range(0, total_ai_pages, 10):
            if not self.check_running(): break
            batch_pages = ai_pages[i:i+10]
            
            raw_batch_text = self.ai_gen.generate_batch_content(batch_pages, self.check_running)
            if not raw_batch_text:
                self.log("[ERROR] Không lấy được nội dung cho nhóm này từ AI. Bỏ qua cụm.")
                continue
            
            posts_blocks = raw_batch_text.split("===")
            for block in posts_blocks:
                if not self.check_running(): break
                if "PAGE_NAME:" not in block: continue
                
                try:
                    page_name_search = re.search(r"PAGE_NAME:\s*(.*)", block)
                    keyword_search = re.search(r"KEYWORD:\s*(.*)", block)
                    content_search = re.search(r"CONTENT:\s*(.*)", block, re.DOTALL)
                    
                    if not page_name_search or not content_search: continue
                    
                    extracted_page_name = page_name_search.group(1).strip()
                    extracted_keyword = keyword_search.group(1).strip() if keyword_search else extracted_page_name
                    extracted_content = content_search.group(1).strip()
                    
                    target_page = next((p for p in batch_pages if p['name'].lower().strip() == extracted_page_name.lower().strip()), None)
                    if not target_page:
                        target_page = next((p for p in batch_pages if extracted_page_name.lower().strip() in p['name'].lower() or p['name'].lower() in extracted_page_name.lower()), None)

                    if not target_page:
                        self.log(f"[WARNING] Không tìm thấy Token cho Fanpage có tên AI vừa trả về: '{extracted_page_name}'")
                        continue
                        
                    self.log(f"\n---------------------------------------------------------")
                    self.log(f"[*] TIẾN TRÌNH XỬ LÝ BÀI ĐĂNG AI: {target_page['name']}")
                    
                    image_url = get_image_from_internet(extracted_keyword, self.pixabay_key, self.log)
                    if not image_url:
                        self.log(f"[*] Tìm ảnh dự phòng cho {target_page['name']} bằng chính tên page...")
                        image_url = get_image_from_internet(target_page['name'], self.pixabay_key, self.log)

                    self.log("\n🔍 [PREVIEW] XEM TRƯỚC BÀI ĐĂNG CHUẨN BỊ ĐẨY LÊN FACEBOOK:")
                    self.log(f"🖼️ Ảnh: {image_url if image_url else 'Không có ảnh (Text Only)'}")
                    self.log(extracted_content)
                    self.log("="*30)

                    for _ in range(3):
                        if not self.check_running(): break
                        time.sleep(1)
                        
                    if not self.check_running(): break
                    
                    post_to_facebook_page(
                        page_name=target_page['name'],
                        page_id=target_page['id'],
                        page_token=target_page['access_token'],
                        message=extracted_content,
                        image_url=image_url,
                        fb_version=self.fb_version,
                        log_func=self.log,
                        save_posted_func=self.save_posted
                    )
                    
                    sleep_time = random.randint(self.sleep_min, self.sleep_max)
                    self.log(f"[*] Giãn cách an toàn. Chờ {sleep_time} giây trước khi xử lý bài tiếp theo...")
                    for _ in range(sleep_time):
                        if not self.check_running(): break
                        time.sleep(1)
                        
                except Exception as parse_error:
                    self.log(f"[ERROR] Lỗi bóc tách khối nội dung: {str(parse_error)}")
                    continue

    def execute_reels_phase(self, reels_pages):
        if not reels_pages or not self.check_running():
            return
        self.log("\n>>> BẮT ĐẦU TIẾN TRÌNH ĐĂNG VIDEO REELS CỤC BỘ <<<")
        for page in reels_pages:
            if not self.check_running(): break
            
            self.log(f"\n---------------------------------------------------------")
            self.log(f"[*] TIẾN TRÌNH XỬ LÝ REELS CHO PAGE: {page['name']}")
            
            suffixed_id = f"{page['id']}_reel"
            post_data = self.get_next_local_video_post(page['reels_folder'], suffixed_id)
            if not post_data:
                self.log(f"[WARNING] Không tìm thấy Reels mới hoặc cấu hình sai cho page: {page['name']}")
                continue
            
            folder_number = post_data["folder_number"]
            video_path = post_data["video_path"]
            caption = post_data["caption"]
            progress_data = post_data["progress_data"]

            self.log(f"[*] Khớp thư mục Reels số: {folder_number}")
            self.log(f"[*] Video Reels: {os.path.basename(video_path)}")
            self.log(f"[*] Xem trước nội dung bài đăng Reels:\n{caption[:200]}...")

            success = upload_reel_to_facebook(
                page_name=page['name'],
                page_id=page['id'],
                page_token=page['access_token'],
                video_path=video_path,
                message=caption,
                fb_version=self.fb_version,
                log_func=self.log,
                save_posted_func=self.save_posted
            )

            if success:
                if suffixed_id not in progress_data:
                    progress_data[suffixed_id] = {}
                progress_data[suffixed_id]["last_posted_folder"] = folder_number
                try:
                    with open("posting_progress.json", 'w', encoding='utf-8') as f:
                        json.dump(progress_data, f, ensure_ascii=False, indent=4)
                    self.log(f"[INFO] Lưu tiến trình đăng Reels thành công cho {page['name']} (Thư mục: {folder_number}).")
                except Exception as e:
                    self.log(f"[ERROR] Lỗi lưu tiến trình đăng Reels: {str(e)}")

                sleep_time = random.randint(self.sleep_min, self.sleep_max)
                self.log(f"[*] Giãn cách an toàn. Chờ {sleep_time} giây trước khi xử lý bài tiếp theo...")
                for _ in range(sleep_time):
                    if not self.check_running(): break
                    time.sleep(1)

    def execute_video_phase(self, video_pages):
        if not video_pages or not self.check_running():
            return
        self.log("\n>>> BẮT ĐẦU TIẾN TRÌNH ĐĂNG VIDEO DÀI CỤC BỘ <<<")
        for page in video_pages:
            if not self.check_running(): break
            
            self.log(f"\n---------------------------------------------------------")
            self.log(f"[*] TIẾN TRÌNH XỬ LÝ VIDEO DÀI CHO PAGE: {page['name']}")
            
            suffixed_id = f"{page['id']}_video"
            post_data = self.get_next_local_video_post(page['video_folder'], suffixed_id)
            if not post_data:
                self.log(f"[WARNING] Không tìm thấy Video dài mới hoặc cấu hình sai cho page: {page['name']}")
                continue
            
            folder_number = post_data["folder_number"]
            video_path = post_data["video_path"]
            caption = post_data["caption"]
            progress_data = post_data["progress_data"]

            self.log(f"[*] Khớp thư mục Video số: {folder_number}")
            self.log(f"[*] Video Dài: {os.path.basename(video_path)}")
            self.log(f"[*] Xem trước nội dung bài đăng Video:\n{caption[:200]}...")

            success = upload_video_to_facebook(
                page_name=page['name'],
                page_id=page['id'],
                page_token=page['access_token'],
                video_path=video_path,
                message=caption,
                fb_version=self.fb_version,
                log_func=self.log,
                save_posted_func=self.save_posted
            )

            if success:
                if suffixed_id not in progress_data:
                    progress_data[suffixed_id] = {}
                progress_data[suffixed_id]["last_posted_folder"] = folder_number
                try:
                    with open("posting_progress.json", 'w', encoding='utf-8') as f:
                        json.dump(progress_data, f, ensure_ascii=False, indent=4)
                    self.log(f"[INFO] Lưu tiến trình đăng Video dài thành công cho {page['name']} (Thư mục: {folder_number}).")
                except Exception as e:
                    self.log(f"[ERROR] Lỗi lưu tiến trình đăng Video: {str(e)}")

                sleep_time = random.randint(self.sleep_min, self.sleep_max)
                self.log(f"[*] Giãn cách an toàn. Chờ {sleep_time} giây trước khi xử lý bài tiếp theo...")
                for _ in range(sleep_time):
                    if not self.check_running(): break
                    time.sleep(1)

    def run(self):
        self.log("=========================================================")
        self.log(" HỆ THỐNG AUTO POST HOẠT ĐỘNG CHẾ ĐỘ VIDEO & AI BATCHING ")
        self.log("=========================================================")

        try:
            with open(self.pages_file, 'r', encoding='utf-8') as f:
                pages_list = json.load(f)
        except Exception as e:
            self.log(f"[CRITICAL] Không đọc được file token page: {str(e)}")
            self.finished_signal.emit()
            return

        pages_list = [p for p in pages_list if p.get('id') and p.get('access_token')]
        total_pages = len(pages_list)
        self.log(f"[*] Nhận diện thành công: {total_pages} Fanpages hợp lệ.")

        # Xáo trộn danh sách Fanpage
        self.log("[*] Đang xáo trộn danh sách Fanpage...")
        random.shuffle(pages_list)

        # Phân loại trang độc lập
        ai_pages = []
        reels_pages = []
        video_pages = []

        for p in pages_list:
            # AI Page classification
            ai_enabled = p.get("ai_enabled")
            if ai_enabled is None:
                ai_enabled = (p.get("post_type") == "ai")
            if ai_enabled:
                ai_pages.append(p)

            # Reels Page classification
            reels_enabled = p.get("reels_enabled")
            if reels_enabled is None:
                reels_enabled = (p.get("post_type") == "reel")
            
            reels_folder = p.get("reels_folder")
            if reels_folder is None:
                if p.get("post_type") == "reel":
                    reels_folder = p.get("video_folder", "")
                else:
                    reels_folder = ""

            if reels_enabled and reels_folder:
                p_copy = p.copy()
                p_copy["reels_folder"] = reels_folder
                reels_pages.append(p_copy)

            # Video Page classification
            video_enabled = p.get("video_enabled")
            if video_enabled is None:
                video_enabled = (p.get("post_type") == "video")
            
            video_folder = p.get("video_folder", "")
            if p.get("post_type") == "reel" and "reels_folder" not in p:
                video_folder = ""

            if video_enabled and video_folder:
                p_copy = p.copy()
                p_copy["video_folder"] = video_folder
                video_pages.append(p_copy)

        self.log(f"[*] Tìm thấy {len(ai_pages)} trang chạy chế độ AI Content.")
        self.log(f"[*] Tìm thấy {len(reels_pages)} trang chạy chế độ Video Reels.")
        self.log(f"[*] Tìm thấy {len(video_pages)} trang chạy chế độ Video Dài.")

        # Load scheduler state if scheduling is enabled
        any_sched = self.ai_sched_enabled or self.reels_sched_enabled or self.video_sched_enabled
        scheduler_state = {}
        state_file = "scheduler_state.json"
        if any_sched:
            if os.path.exists(state_file):
                try:
                    with open(state_file, 'r', encoding='utf-8') as sf:
                        scheduler_state = json.load(sf)
                except Exception:
                    pass

        # Immediate executions for unscheduled formats
        if not self.ai_sched_enabled:
            self.execute_ai_phase(ai_pages)
        if not self.reels_sched_enabled:
            self.execute_reels_phase(reels_pages)
        if not self.video_sched_enabled:
            self.execute_video_phase(video_pages)

        # Loop if scheduling is enabled
        if any_sched and self.check_running():
            self.log("\n=========================================================")
            self.log(" KÍCH HOẠT CHẾ ĐỘ HẸN GIỜ ĐĂNG DAILY SCHEDULER ")
            if self.ai_sched_enabled:
                self.log(f" - Hẹn giờ đăng AI: {self.ai_sched_times}")
            if self.reels_sched_enabled:
                self.log(f" - Hẹn giờ đăng Reels: {self.reels_sched_times}")
            if self.video_sched_enabled:
                self.log(f" - Hẹn giờ đăng Video Dài: {self.video_sched_times}")
            self.log("=========================================================\n")

            while self.check_running():
                now = datetime.datetime.now()
                date_str = now.strftime("%Y-%m-%d")
                time_str = now.strftime("%H:%M")

                if date_str not in scheduler_state:
                    # Clean up old dates to save memory and state size
                    scheduler_state = {date_str: []}

                # AI schedule check
                if self.ai_sched_enabled and ai_pages:
                    ai_times = [t.strip() for t in self.ai_sched_times.split(",") if t.strip()]
                    if time_str in ai_times and f"ai_{time_str}" not in scheduler_state[date_str]:
                        self.log(f"\n[SCHEDULER] Đến khung giờ đăng bài viết AI: {time_str}")
                        self.execute_ai_phase(ai_pages)
                        scheduler_state[date_str].append(f"ai_{time_str}")
                        try:
                            with open(state_file, 'w', encoding='utf-8') as sf:
                                json.dump(scheduler_state, sf, ensure_ascii=False, indent=4)
                        except Exception:
                            pass

                # Reels schedule check
                if self.reels_sched_enabled and reels_pages:
                    reels_times = [t.strip() for t in self.reels_sched_times.split(",") if t.strip()]
                    if time_str in reels_times and f"reels_{time_str}" not in scheduler_state[date_str]:
                        self.log(f"\n[SCHEDULER] Đến khung giờ đăng Reels: {time_str}")
                        self.execute_reels_phase(reels_pages)
                        scheduler_state[date_str].append(f"reels_{time_str}")
                        try:
                            with open(state_file, 'w', encoding='utf-8') as sf:
                                json.dump(scheduler_state, sf, ensure_ascii=False, indent=4)
                        except Exception:
                            pass

                # Video schedule check
                if self.video_sched_enabled and video_pages:
                    video_times = [t.strip() for t in self.video_sched_times.split(",") if t.strip()]
                    if time_str in video_times and f"video_{time_str}" not in scheduler_state[date_str]:
                        self.log(f"\n[SCHEDULER] Đến khung giờ đăng Video Dài: {time_str}")
                        self.execute_video_phase(video_pages)
                        scheduler_state[date_str].append(f"video_{time_str}")
                        try:
                            with open(state_file, 'w', encoding='utf-8') as sf:
                                json.dump(scheduler_state, sf, ensure_ascii=False, indent=4)
                        except Exception:
                            pass

                # Sleep 15s, checking every second to react to stop signal
                for _ in range(15):
                    if not self.check_running():
                        break
                    time.sleep(1)

        self.log(f"\n[FINISHED] Đã kết thúc toàn bộ chu kỳ đăng bài.")
        self.finished_signal.emit()

    def stop(self):
        self.is_running = False
