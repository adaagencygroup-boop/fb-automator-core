import os
import time
import requests
from typing import List, Dict, Any, Optional
from pathlib import Path
from config.constants import KEYS_PATH, DATA_DIR, BASE_DIR
from core.database.connection import db
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
class GeminiEngine:
  def __init__(self, model_name: str = "gemini-3.8-flash", timeout: int = 120):
    self.model_name = model_name
    self.timeout = timeout
    self.keys: List[str] = []
    self.current_key_index: int = 0
    self.load_keys()
  def load_keys(self, custom_path: Optional[str] = None, extra_keys: Optional[List[str]] = None) -> List[str]:
    loaded = []
    if extra_keys:
      for k in extra_keys:
        k_str = str(k).strip()
        if k_str and k_str not in loaded:
          loaded.append(k_str)
    candidate_paths = []
    if custom_path:
      candidate_paths.extend([Path(custom_path), DATA_DIR / custom_path, BASE_DIR / custom_path])
    candidate_paths.append(KEYS_PATH)
    candidate_paths.append(BASE_DIR / "keys.txt")
    candidate_paths.append(BASE_DIR / "Keys.txt")
    candidate_paths.append(DATA_DIR / "Keys.txt")
    for cp in candidate_paths:
      if cp.exists() and cp.is_file():
        try:
          with open(cp, "r", encoding="utf-8") as f:
            for line in f:
              k_clean = line.strip()
              if k_clean and not k_clean.startswith("#") and k_clean not in loaded:
                loaded.append(k_clean)
        except Exception:
          pass
    try:
      db_keys = db.fetch_all("SELECT api_key FROM api_keys WHERE service = 'gemini' AND status = 'ACTIVE'")
      for r in db_keys:
        k = str(r.get("api_key") or "").strip()
        if k and k not in loaded:
          loaded.append(k)
    except Exception:
      pass
    env_keys = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GEMINI_API_KEYS", "")
    if env_keys:
      for k_item in env_keys.replace(";", ",").split(","):
        k_str = k_item.strip()
        if k_str and k_str not in loaded:
          loaded.append(k_str)
    if loaded:
      self.keys = loaded
    return self.keys
  def set_keys(self, keys: List[str]):
    cleaned = [k.strip() for k in keys if str(k).strip()]
    if cleaned:
      self.keys = cleaned
      self.current_key_index = 0
  def add_key(self, api_key: str):
    api_key = api_key.strip()
    if api_key and api_key not in self.keys:
      self.keys.append(api_key)
      try:
        db.execute(
          "INSERT INTO api_keys (service, api_key, status) VALUES (%s, %s, 'ACTIVE') ON CONFLICT DO NOTHING",
          ("gemini", api_key)
        )
      except Exception:
        pass
  def get_current_key(self) -> Optional[str]:
    if not self.keys:
      self.load_keys()
    if not self.keys:
      return None
    return self.keys[self.current_key_index % len(self.keys)]
  def rotate_key(self) -> Optional[str]:
    if not self.keys:
      return None
    self.current_key_index = (self.current_key_index + 1) % len(self.keys)
    return self.get_current_key()
  def generate_content(self, prompt: str, model_name: Optional[str] = None, keys: Optional[List[str]] = None, max_retries: Optional[int] = None) -> str:
    if keys:
      self.set_keys(keys)
    if not self.keys:
      self.load_keys()
    if not self.keys:
      raise ValueError("Chưa cấu hình Google Gemini API Key nào trong hệ thống!")
    active_model = model_name or self.model_name or "gemini-3.8-flash"
    attempts_limit = max_retries or (len(self.keys) * 2)
    for attempt in range(max(1, attempts_limit)):
      current_key = self.get_current_key()
      if not current_key:
        raise ValueError("Không tìm thấy API Key khả dụng.")
      url = f"{GEMINI_API_BASE}/{active_model}:generateContent?key={current_key}"
      payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
          "temperature": 0.7,
          "maxOutputTokens": 2048
        }
      }
      try:
        res = requests.post(url, json=payload, timeout=self.timeout)
        if res.status_code == 200:
          data = res.json()
          candidates = data.get("candidates", [])
          if candidates and "content" in candidates[0]:
            parts = candidates[0]["content"].get("parts", [])
            if parts:
              return parts[0].get("text", "")
          return ""
        if res.status_code in [429, 503, 401, 403]:
          self.rotate_key()
          time.sleep(1)
          continue
        else:
          err_body = res.text
          if "RESOURCE_EXHAUSTED" in err_body or "quota" in err_body.lower():
            self.rotate_key()
            time.sleep(1)
            continue
          raise RuntimeError(f"Gemini API Error [{res.status_code}]: {err_body}")
      except (requests.Timeout, requests.ConnectionError):
        self.rotate_key()
        time.sleep(1)
        continue
    raise RuntimeError(f"Đã thử qua {attempts_limit} lượt API Keys nhưng tất cả đều lỗi hoặc cạn quota.")
  def generate_batch_pages(self, pages_info: List[Dict[str, str]], model_name: Optional[str] = None) -> Dict[str, str]:
    if not pages_info:
      return {}
    prompt_builder = [
      "Bạn là chuyên gia sáng tạo nội dung mạng xã hội cho Facebook Fanpage.",
      "Hãy viết bài viết thu hút, tự nhiên kèm 3-5 hashtag cho từng Fanpage trong danh sách sau:",
      "QUY TẮC BẮT BUỘC ĐỊNH DẠNG ĐẦU RA:",
      "Với mỗi Fanpage, in theo định dạng chuẩn sau:",
      "===PAGE_START===",
      "PAGE_ID: <id>",
      "CONTENT:",
      "<Nội dung bài viết kèm hashtag>",
      "===PAGE_END===\n",
      "DANH SÁCH FANPAGE CẦN VIẾT BÀI:"
    ]
    for p in pages_info:
      prompt_builder.append(f"- ID: {p.get('page_id')} | Tên Page: {p.get('page_name')} | Chủ đề/Từ khóa: {p.get('topic', 'Tổng hợp')}")
    full_prompt = "\n".join(prompt_builder)
    raw_text = self.generate_content(full_prompt, model_name=model_name)
    results = {}
    blocks = raw_text.split("===PAGE_START===")
    for b in blocks:
      if "===PAGE_END===" not in b:
        continue
      chunk = b.split("===PAGE_END===")[0]
      lines = chunk.strip().split("\n")
      p_id = None
      content_lines = []
      is_reading_content = False
      for line in lines:
        if line.startswith("PAGE_ID:"):
          p_id = line.replace("PAGE_ID:", "").strip()
        elif line.startswith("CONTENT:"):
          is_reading_content = True
        elif is_reading_content:
          content_lines.append(line)
      if p_id:
        results[p_id] = "\n".join(content_lines).strip()
    return results
ai_engine = GeminiEngine()
