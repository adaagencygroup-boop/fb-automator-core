# -*- coding: utf-8 -*-
"""
File: core/sheet_logger.py
"""
import os
from datetime import datetime
try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    gspread = None
    Credentials = None

def save_posted_to_google_sheet(page_name, post_id, creds_file, sheet_id, log_func):
    post_url = f"https://www.facebook.com/{post_id}"
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    if not gspread or not Credentials or not creds_file or not sheet_id:
        log_func("[WARNING] Thiếu cấu hình Google Sheet hoặc thư viện gspread! Tự động sao lưu cục bộ vào file 'posted_links_backup.txt'")
        with open("posted_links_backup.txt", "a", encoding="utf-8") as f:
            f.write(f"[{current_time}] PAGE: {page_name} | LINK: {post_url}\n")
        return

    try:
        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
        client = gspread.authorize(creds)
        sheet = client.open_by_key(sheet_id).sheet1
        
        if not sheet.get_all_values():
            sheet.append_row(["Thời Gian Đăng", "Tên Fanpage", "Link Bài Viết (Facebook URL)"])
        
        sheet.append_row([current_time, page_name, post_url])
        log_func(f"[SUCCESS] Đã lưu thông tin bài đăng lên Google Sheet! ✅")
    except Exception as e:
        err_msg = str(e)
        log_func(f"[ERROR] Lỗi đồng bộ Google Sheet: {err_msg}")
        if "invalid_grant" in err_msg or "JWT" in err_msg:
            log_func("[!] MẸO CHẨN ĐOÁN: Lỗi này thường do đồng bộ thời gian (giờ hệ thống Windows của bạn bị lệch quá 2 phút so với giờ thế giới) hoặc do file credentials.json bị sai khóa bí mật. Bạn hãy đồng bộ lại giờ hệ thống Windows (Sync Now) và kiểm tra lại file JSON.")
        log_func("[!] Tự động sao lưu dự phòng cục bộ vào file 'posted_links_backup.txt'...")
        with open("posted_links_backup.txt", "a", encoding="utf-8") as f:
            f.write(f"[{current_time}] PAGE: {page_name} | LINK: {post_url}\n")
