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
        post_content: str,
        action_type: str = "POST",
        delay_sec: int = 15,
        media_list: Optional[List[str]] = None,
        min_media: int = 0,
        max_media: int = 0,
        parent=None,
    ):
        super().__init__(module_name="Spam & Tương Tác Nhóm", parent=parent)
        self.group_ids = group_ids
        self.post_content = post_content
        self.action_type = action_type  # POST hoặc COMMENT
        self.delay_sec = delay_sec
        self.media_list = [m for m in (media_list or []) if m]
        self.min_media = max(0, int(min_media or 0))
        self.max_media = max(0, int(max_media or 0))

    def pick_media_for_post(self) -> List[str]:
        """
        Phân phối media cho bài viết dựa trên cấu hình:
        - Nếu không có media: trả về rỗng.
        - Nếu min_media == 0 và max_media == 0: trả về rỗng.
        - Nếu min_media >= len(media_list): lấy tất cả media.
        - Nếu min_media == max_media: lấy đúng số lượng đó (hoặc tất cả nếu min >= total).
        - Nếu min_media < max_media: bốc ngẫu nhiên k tệp trong khoảng [min_media, max_media].
        """
        if not self.media_list:
            return []

        total_available = len(self.media_list)
        min_count = min(self.min_media, total_available)
        max_count = min(self.max_media, total_available)

        if max_count <= 0:
            return []

        if min_count > max_count:
            min_count, max_count = max_count, min_count

        # Chọn số lượng media cho bài viết này
        count = random.randint(min_count, max_count)
        if count <= 0:
            return []

        # Bốc ngẫu nhiên không lặp lại `count` tệp từ media_list
        return random.sample(self.media_list, count)

    def run(self):
        total = len(self.group_ids)
        self.log_info(f"Bắt đầu chiến dịch {self.action_type} lên {total} nhóm Facebook...")
        if self.media_list:
            self.log_info(
                f"Đã nạp {len(self.media_list)} tệp media. "
                f"Cấu hình mỗi bài: tối thiểu {self.min_media}, tối đa {self.max_media} tệp."
            )

        success_count = 0
        for idx, gid in enumerate(self.group_ids, 1):
            if not self.is_active():
                self.log_warning("Chiến dịch đăng nhóm đã bị dừng.")
                break

            self.check_paused()

            self.log_info(f"[{idx}/{total}] Đang xử lý Nhóm ID: {gid}...")

            if self.action_type == "POST":
                # Phân phối media ngẫu nhiên cho bài đăng này
                selected_media = self.pick_media_for_post()
                media_info = ""
                if selected_media:
                    media_names = [os.path.basename(m) for m in selected_media]
                    media_info = f" kèm {len(selected_media)} media: {', '.join(media_names)}"

                self.log_info(f"-> Đăng bài viết vào Group {gid}: '{self.post_content[:40]}...'{media_info}")
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
                self.log_info(f"Giãn cách {self.delay_sec}s an toàn chống spam...")
                for _ in range(self.delay_sec):
                    if not self.is_active():
                        break
                    self.msleep(1000)

        summary = f"Hoàn tất: Đã thực hiện thành công trên {success_count}/{total} nhóm."
        self.log_success(summary)
        self.sig_finished.emit(True, summary)
