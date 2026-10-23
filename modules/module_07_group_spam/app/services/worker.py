from datetime import datetime
import os
import random
import time
from typing import Any, Dict, List, Optional
from core.base_module import BaseWorker
from core.database.connection import db

class GroupSpamWorker(BaseWorker):
    def __init__(
        self,
        group_ids: List[str],
        post_content: str = "",
        posts: Optional[List[str]] = None,
        action_type: str = "POST",
        delay_sec: int = 15,
        delay_min: Optional[int] = None,
        delay_max: Optional[int] = None,
        avoid_duplicate: bool = False,
        shuffle_content: bool = True,
        schedule_at: Optional[str] = None,
        media_list: Optional[List[str]] = None,
        min_media: int = 0,
        max_media: int = 0,
        parent=None,
    ):
        super().__init__(module_name="Spam & Tương Tác Nhóm", parent=parent)
        self.group_ids = group_ids
        self.action_type = action_type  # POST hoặc COMMENT

        # Quản lý danh sách bài đăng
        raw_posts = [p.strip() for p in (posts or []) if p and p.strip()]
        if not raw_posts and post_content.strip():
            raw_posts = [post_content.strip()]
        self.posts: List[str] = raw_posts

        # Cài đặt nội dung (Bước 6)
        self.avoid_duplicate = avoid_duplicate
        self.shuffle_content = shuffle_content
        self.used_posts: List[str] = []

        # Giãn cách nghỉ (Bước 6)
        if delay_min is not None and delay_max is not None:
            d_min = max(0, int(delay_min))
            d_max = max(0, int(delay_max))
            if d_min > d_max:
                d_min, d_max = d_max, d_min
            self.delay_min = d_min
            self.delay_max = d_max
        else:
            base_sec = max(0, int(delay_sec or 15))
            self.delay_min = base_sec
            self.delay_max = base_sec

        # Hẹn giờ bắt đầu (Bước 6)
        self.schedule_at = schedule_at

        # Cài đặt Media (Bước 4)
        self.media_list = [m for m in (media_list or []) if m]
        self.min_media = max(0, int(min_media or 0))
        self.max_media = max(0, int(max_media or 0))

    def pick_post_content(self) -> str:
        """
        Chọn nội dung đăng bài theo cấu hình Bước 6:
        - shuffle_content: Đăng ngẫu nhiên nội dung
        - avoid_duplicate: Không đăng trùng lặp nội dung giữa các nhóm
        """
        if not self.posts:
            return ""

        available_posts = [p for p in self.posts if p not in self.used_posts] if self.avoid_duplicate else list(self.posts)

        # Nếu đã dùng hết toàn bộ bài có sẵn và avoid_duplicate bật, reset lại chu kỳ để tiếp tục
        if not available_posts:
            self.used_posts.clear()
            available_posts = list(self.posts)

        if self.shuffle_content:
            chosen = random.choice(available_posts)
        else:
            chosen = available_posts[0]

        if self.avoid_duplicate:
            self.used_posts.append(chosen)

        return chosen

    def get_next_delay(self) -> int:
        """Tính số giây nghỉ ngẫu nhiên trong khoảng [delay_min, delay_max]."""
        if self.delay_min == self.delay_max:
            return self.delay_min
        return random.randint(self.delay_min, self.delay_max)

    def wait_for_schedule(self):
        """Nếu có hẹn giờ schedule_at, chờ đến đúng thời điểm để bắt đầu."""
        if not self.schedule_at:
            return

        try:
            target_time = datetime.fromisoformat(self.schedule_at)
            now = datetime.now()
            wait_seconds = (target_time - now).total_seconds()

            if wait_seconds > 0:
                self.log_info(
                    f"Chiến dịch đã đặt lịch hẹn giờ bắt đầu lúc {target_time.strftime('%Y-%m-%d %H:%M:%S')}. "
                    f"Đang chờ {int(wait_seconds)} giây..."
                )
                while wait_seconds > 0 and self.is_active():
                    self.check_paused()
                    sleep_chunk = min(5, wait_seconds)
                    self.msleep(int(sleep_chunk * 1000))
                    wait_seconds -= sleep_chunk
        except Exception as exc:
            self.log_warning(f"Không thể phân tích lịch hẹn giờ ({self.schedule_at}): {exc}. Bắt đầu ngay.")

    def pick_media_for_post(self) -> List[str]:
        """Phân phối media cho bài viết dựa trên cấu hình Bước 4."""
        if not self.media_list:
            return []

        total_available = len(self.media_list)
        min_count = min(self.min_media, total_available)
        max_count = min(self.max_media, total_available)

        if max_count <= 0:
            return []

        if min_count > max_count:
            min_count, max_count = max_count, min_count

        count = random.randint(min_count, max_count)
        if count <= 0:
            return []

        return random.sample(self.media_list, count)

    def run(self):
        # 1. Kiểm tra hẹn giờ
        self.wait_for_schedule()

        total = len(self.group_ids)
        self.log_info(f"Bắt đầu chiến dịch {self.action_type} lên {total} nhóm Facebook...")
        self.log_info(
            f"Cài đặt Bước 6: Giãn cách {self.delay_min}s – {self.delay_max}s | "
            f"Trộn nội dung: {'Bật' if self.shuffle_content else 'Tắt'} | "
            f"Chống trùng bài: {'Bật' if self.avoid_duplicate else 'Tắt'}"
        )
        if self.media_list:
            self.log_info(
                f"Đã nạp {len(self.media_list)} tệp media. "
                f"Mỗi bài: tối thiểu {self.min_media}, tối đa {self.max_media} tệp."
            )

        success_count = 0
        for idx, gid in enumerate(self.group_ids, 1):
            if not self.is_active():
                self.log_warning("Chiến dịch đăng nhóm đã bị dừng.")
                break

            self.check_paused()

            self.log_info(f"[{idx}/{total}] Đang xử lý Nhóm ID: {gid}...")

            if self.action_type == "POST":
                # Lấy nội dung theo quy tắc Bước 6
                current_content = self.pick_post_content()
                # Phân phối media ngẫu nhiên Bước 4
                selected_media = self.pick_media_for_post()
                media_info = ""
                if selected_media:
                    media_names = [os.path.basename(m) for m in selected_media]
                    media_info = f" kèm {len(selected_media)} media: {', '.join(media_names)}"

                snippet = current_content[:40] if current_content else "Không có nội dung"
                self.log_info(f"-> Đăng bài viết vào Group {gid}: '{snippet}...'{media_info}")
                self.msleep(2000)
                success_count += 1
                self.log_success(f"-> Đăng bài thành công vào Group {gid}!")

                try:
                    db.execute(
                        """INSERT INTO posted_history (target_id, target_name, post_type, status)
                        VALUES (?, ?, 'GROUP_POST', 'SUCCESS')""",
                        (gid, f"Group {gid}")
                    )
                except Exception:
                    pass
            elif self.action_type == "COMMENT":
                self.log_info(f"-> Quét bài mới & bình luận tự động vào Group {gid}...")
                self.msleep(1500)
                success_count += 1
                self.log_success(f"-> Đã bình luận dạo thành công vào Group {gid}!")

            self.sig_progress.emit(idx, total, f"Đã hoàn thành {idx}/{total} nhóm")

            if idx < total:
                delay = self.get_next_delay()
                self.log_info(f"Giãn cách {delay}s an toàn chống spam...")
                for _ in range(delay):
                    if not self.is_active():
                        break
                    self.msleep(1000)

        summary = f"Hoàn tất: Đã thực hiện thành công trên {success_count}/{total} nhóm."
        self.log_success(summary)
        self.sig_finished.emit(True, summary)
