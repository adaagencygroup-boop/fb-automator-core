# -*- coding: utf-8 -*-
"""
File: config/settings.py
"""
import os
import json

CONFIG_FILE = "gui_config.json"
PAGES_DEFAULT_FILE = "pages_data.json"
KEYS_DEFAULT_FILE = "keys.txt"

def load_gui_configs():
    reels_root_dir = ""
    video_root_dir = ""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
            reels_root_dir = config.get("reels_root_dir", "")
            video_root_dir = config.get("video_root_dir", "")
        except Exception:
            pass
    return reels_root_dir, video_root_dir

def save_gui_configs(reels_root_dir, video_root_dir):
    config = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except Exception:
            pass
    config["reels_root_dir"] = reels_root_dir
    config["video_root_dir"] = video_root_dir
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=4)
        return True
    except Exception:
        return False

def load_api_keys(key_file_path):
    if not os.path.exists(key_file_path):
        return []
    try:
        with open(key_file_path, "r", encoding="utf-8") as f:
            api_keys = [line.strip() for line in f if line.strip()]
        # Khử trùng lặp và làm sạch
        return list(set([k for k in api_keys if k]))
    except Exception:
        return []

def load_pages_list(pages_file_path):
    if not os.path.exists(pages_file_path):
        return []
    try:
        with open(pages_file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def save_pages_list(pages_file_path, pages_list):
    try:
        with open(pages_file_path, 'w', encoding='utf-8') as f:
            json.dump(pages_list, f, ensure_ascii=False, indent=4)
        return True
    except Exception:
        return False
