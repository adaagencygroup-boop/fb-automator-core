# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/reels_service.py
Xử lý logic quét thư mục, tự động khớp Fanpage và tìm video Reels tiếp theo.
"""
import os
import re
from typing import List, Dict, Any, Optional

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}

def normalize_text(text: str) -> str:
    """Chuẩn hóa chuỗi text để so khớp (bỏ ký tự đặc biệt, chuyển chữ thường)."""
    if not text:
        return ""
    text = text.lower().strip()
    return re.sub(r'[\s\-_.,;:]+', '', text)


def scan_root_directory(root_dir: str) -> Dict[str, Any]:
    """
    Quét thư mục gốc và trả về danh sách các thư mục con (mỗi thư mục đại diện cho 1 Fanpage).
    Đếm số video có trong từng thư mục.
    """
    if not root_dir or not os.path.exists(root_dir):
        return {"success": False, "error": f"Thư mục không tồn tại: {root_dir}", "folders": []}

    try:
        subdirs = [d for d in os.listdir(root_dir) if os.path.isdir(os.path.join(root_dir, d))]
    except Exception as e:
        return {"success": False, "error": str(e), "folders": []}

    folders_data = []
    for d in sorted(subdirs):
        folder_path = os.path.join(root_dir, d)
        video_count = count_videos_in_folder(folder_path)
        folders_data.append({
            "folder_name": d,
            "folder_path": folder_path,
            "video_count": video_count
        })

    return {
        "success": True,
        "root_dir": root_dir,
        "total_folders": len(folders_data),
        "folders": folders_data
    }


def count_videos_in_folder(folder_path: str) -> int:
    """Đếm số video có thể đăng trong thư mục của 1 Fanpage (cả 2 định dạng)."""
    if not os.path.exists(folder_path):
        return 0

    count = 0
    try:
        items = os.listdir(folder_path)
    except Exception:
        return 0

    # Kiểm tra Định dạng A: các thư mục con đánh số (1, 2, 3...)
    numbered_subdirs = [i for i in items if i.isdigit() and os.path.isdir(os.path.join(folder_path, i))]
    if numbered_subdirs:
        for nd in numbered_subdirs:
            sub_path = os.path.join(folder_path, nd)
            try:
                files = os.listdir(sub_path)
                if any(os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS for f in files):
                    count += 1
            except Exception:
                pass
        return count

    # Kiểm tra Định dạng B: file video trực tiếp trong folder
    for i in items:
        file_path = os.path.join(folder_path, i)
        if os.path.isfile(file_path) and os.path.splitext(i)[1].lower() in VIDEO_EXTENSIONS:
            count += 1

    return count


def auto_match_folders(pages: List[Dict[str, Any]], folders: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Tự động đối chiếu tên thư mục con với tên Fanpage.
    Trả về dict: page_id -> { folder_name, folder_path, matched: True/False }
    """
    matches = {}
    normalized_folders = [
        {
            "name": f["folder_name"],
            "path": f["folder_path"],
            "norm": normalize_text(f["folder_name"]),
            "video_count": f.get("video_count", 0)
        }
        for f in folders
    ]

    for p in pages:
        p_id = str(p.get("page_id") or p.get("id"))
        p_name = p.get("page_name") or p.get("name") or ""
        p_norm = normalize_text(p_name)

        matched_folder = None
        for f in normalized_folders:
            # 1. Khớp chính xác hoàn toàn
            if f["norm"] == p_norm and p_norm:
                matched_folder = f
                break
            # 2. Tên chứa lẫn nhau
            if (f["norm"] in p_norm and len(f["norm"]) >= 4) or (p_norm in f["norm"] and len(p_norm) >= 4):
                matched_folder = f
                break

        if matched_folder:
            matches[p_id] = {
                "folder_name": matched_folder["name"],
                "folder_path": matched_folder["path"],
                "video_count": matched_folder["video_count"],
                "auto_matched": True
            }
        else:
            matches[p_id] = {
                "folder_name": "",
                "folder_path": "",
                "video_count": 0,
                "auto_matched": False
            }

    return matches


def get_next_reel_video(page_id: str, page_folder_path: str, last_index: int = 0) -> Optional[Dict[str, Any]]:
    """
    Tìm video Reels tiếp theo chưa được đăng.
    Ưu tiên Định dạng A (thư mục số 1, 2, 3...) > Định dạng B (file video trực tiếp).
    """
    if not page_folder_path or not os.path.exists(page_folder_path):
        return None

    try:
        items = os.listdir(page_folder_path)
    except Exception:
        return None

    # 1. Định dạng A: Thư mục con đánh số
    numbered_dirs = []
    for item in items:
        if item.isdigit() and os.path.isdir(os.path.join(page_folder_path, item)):
            numbered_dirs.append(int(item))
    numbered_dirs.sort()

    if numbered_dirs:
        for num in numbered_dirs:
            if num > last_index:
                sub_dir_path = os.path.join(page_folder_path, str(num))
                video_file = None
                caption = ""
                try:
                    for f in os.listdir(sub_dir_path):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in VIDEO_EXTENSIONS and not video_file:
                            video_file = os.path.join(sub_dir_path, f)
                        elif ext == ".txt":
                            txt_path = os.path.join(sub_dir_path, f)
                            try:
                                with open(txt_path, "r", encoding="utf-8") as tf:
                                    caption = tf.read().strip()
                            except Exception:
                                pass
                except Exception:
                    continue

                if video_file:
                    return {
                        "video_path": video_file,
                        "caption": caption,
                        "folder_number": num,
                        "video_id": f"folder_{num}_{os.path.basename(video_file)}"
                    }
        return None

    # 2. Định dạng B: File video trực tiếp trong thư mục
    video_files = []
    for item in sorted(items):
        full_path = os.path.join(page_folder_path, item)
        if os.path.isfile(full_path) and os.path.splitext(item)[1].lower() in VIDEO_EXTENSIONS:
            video_files.append(item)

    if video_files:
        for idx, vf in enumerate(video_files, start=1):
            if idx > last_index:
                v_path = os.path.join(page_folder_path, vf)
                # Đọc caption nếu có file .txt cùng tên
                txt_candidate = os.path.splitext(v_path)[0] + ".txt"
                caption = ""
                if os.path.exists(txt_candidate):
                    try:
                        with open(txt_candidate, "r", encoding="utf-8") as tf:
                            caption = tf.read().strip()
                    except Exception:
                        pass

                return {
                    "video_path": v_path,
                    "caption": caption,
                    "folder_number": idx,
                    "video_id": vf
                }

    return None
