"""
content_service.py
Module 03 - Tab 2: Xử lý nội dung AI & Quét đa phương tiện Video/Ảnh.
Bao gồm:
  1. Gemini AI Service: Sinh nội dung bài viết theo chủ đề & prompt
  2. Pixabay Image Service: Tìm kiếm và tải ảnh minh họa chất lượng cao
  3. Video/Media Scanner: Quét thư mục, tính mã băm MD5, phân bổ clip theo nick, chống trùng lặp.
"""
import os
import hashlib
import logging
import random
import urllib.request
import urllib.parse
import json
from config.constants import UPLOADS_DIR
from typing import List, Dict, Any, Optional, Tuple, Set

logger = logging.getLogger(__name__)

# ==============================================================================
# 1. GEMINI AI GENERATOR
# ==============================================================================

def load_gemini_keys(key_source: Optional[str] = None) -> List[str]:
    """Đọc danh sách API key từ file text, đường dẫn file, hoặc chuỗi phân tách bởi dấu phẩy/xuống dòng."""
    keys = []

    # 1. Thử đọc nếu key_source là đường dẫn file
    if key_source:
        clean_source = key_source.strip()
        candidate_files = [
            clean_source,
            os.path.join(os.getcwd(), clean_source),
            r"D:\ADA\fb-automator-core\keys.txt",
            r"D:\ADA\post_page_facebook_tool_api\keys.txt",
            r"D:\ADA\keys.txt",
        ]

        file_found = False
        for path in candidate_files:
            try:
                if path and os.path.isfile(path):
                    with open(path, 'r', encoding='utf-8') as f:
                        for line in f:
                            k = line.strip()
                            if k and not k.startswith('#') and len(k) >= 15:
                                keys.append(k)
                    if keys:
                        file_found = True
                        logger.info(f"Đã nạp {len(keys)} Gemini keys từ {path}")
                        break
            except Exception:
                pass

        # 2. Nếu không phải file, kiểm tra xem key_source có phải là chuỗi chứa các keys trực tiếp không
        if not file_found:
            for k in clean_source.replace('\r\n', '\n').split('\n'):
                k_clean = k.strip()
                if k_clean and not k_clean.startswith('#') and len(k_clean) >= 15 and not k_clean.endswith('.txt'):
                    keys.append(k_clean)

    # 3. Fallback: Nếu vẫn chưa có key, quét các file keys.txt mặc định trong toàn bộ project
    if not keys:
        fallback_paths = [
            r"D:\ADA\fb-automator-core\keys.txt",
            r"D:\ADA\post_page_facebook_tool_api\keys.txt",
            r"D:\ADA\keys.txt",
        ]
        for fp in fallback_paths:
            if os.path.isfile(fp):
                try:
                    with open(fp, 'r', encoding='utf-8') as f:
                        for line in f:
                            k = line.strip()
                            if k and not k.startswith('#') and len(k) >= 15 and k not in keys:
                                keys.append(k)
                except Exception:
                    pass
                if keys:
                    break

    # 4. Kiểm tra biến môi trường
    env_key = os.environ.get("GEMINI_API_KEY")
    if env_key:
        for k in env_key.split(','):
            clean_k = k.strip()
            if clean_k and clean_k not in keys:
                keys.append(clean_k)

    return keys


def list_available_gemini_models(api_key: Optional[str] = None, key_source: Optional[str] = None) -> List[Dict[str, str]]:
    """
    Truy vấn trực tiếp Google Gemini API để lấy danh sách model thực tế hỗ trợ generateContent.
    """
    keys = []
    if api_key:
        keys.append(api_key.strip())
    if key_source:
        keys.extend(load_gemini_keys(key_source))
    if not keys:
        keys = load_gemini_keys()

    if not keys:
        return []

    excluded = (
        "embedding", "imagen", "veo", "lyria", "tts", "live", "robotics",
        "computer-use", "image", "transcribe", "customtools", "banana"
    )

    import requests
    for key in keys:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                body = resp.json()
                models = []
                for item in body.get("models", []):
                    methods = item.get("supportedGenerationMethods") or []
                    raw_name = str(item.get("name") or "")
                    model_id = raw_name.replace("models/", "")
                    lowered = model_id.lower()
                    if (
                        model_id.startswith("gemini-")
                        and "generateContent" in methods
                        and not any(x in lowered for x in excluded)
                    ):
                        display_name = str(item.get("displayName") or model_id)
                        models.append({
                            "id": model_id,
                            "name": display_name
                        })
                if models:
                    def sort_key(m):
                        mid = m["id"].lower()
                        score = 0
                        if "3.8" in mid: score += 100
                        elif "3.7" in mid: score += 90
                        elif "3.6" in mid: score += 80
                        elif "3.5" in mid: score += 70
                        elif "4" in mid: score += 65
                        elif "3.1" in mid: score += 60
                        elif "3" in mid: score += 55
                        elif "2.5" in mid: score += 50
                        elif "latest" in mid: score += 40
                        if "flash" in mid: score += 10
                        if "pro" in mid: score += 5
                        return -score

                    models.sort(key=sort_key)
                    return models
        except Exception as e:
            logger.warning(f"Lỗi khi truy vấn danh sách model từ Google với key: {e}")
            continue

    return []


def generate_status_content(
    prompt: str,
    api_key: Optional[str] = None,
    model: str = "gemini-3.8-flash",
    fallback_keys: Optional[List[str]] = None,
    key_source: Optional[str] = None
) -> Tuple[str, Optional[str]]:
    """
    Gọi Gemini REST API trực tiếp không phụ thuộc thư viện nặng.
    Tự động xoay vòng fallback key nếu key chính dính lỗi 429 Rate Limit.
    Khắc phục triệt để hiện tượng bài viết bị ngắt cụt giữa chừng do Gemini 2.5 tiêu hao token vào Thinking.
    """
    all_keys = []
    if api_key:
        all_keys.append(api_key.strip())
    if fallback_keys:
        all_keys.extend([k.strip() for k in fallback_keys if k and k.strip()])
    if not all_keys:
        all_keys = load_gemini_keys(key_source)

    if not all_keys:
        raise ValueError("Không có Gemini API Key hợp lệ.")

    system_instruction = (
        "Bạn là một người dùng thật trên Facebook đang đăng status chia sẻ lên trang cá nhân. "
        "Hãy viết bằng tiếng Việt tự nhiên, đời thường, cuốn hút, chèn icon cảm xúc phù hợp và kèm 3-5 hashtag ở cuối.\n"
        "ĐẶC BIỆT LƯU Ý (CỰC KỲ QUAN TRỌNG):\n"
        "- BÀI VIẾT PHẢI HOÀN CHỈNH TỪ ĐẦU ĐẾN CUỐI, TUYỆT ĐỐI KHÔNG ĐƯỢC CẮT NGANG HAY BỎ DỞ CÂU GIỮA CHỪNG.\n"
        "- Kết thúc bài viết bằng dấu câu trọn vẹn, icon và hashtag đầy đủ.\n"
        "- Tuyệt đối KHÔNG tự bịa tên mã nick/profile ảo (như Profile FB, bot, UID), không xưng danh tên máy móc.\n\n"
        "QUY TẮC VỀ HÌNH ẢNH MINH HỌA (RẤT QUAN TRỌNG):\n"
        "- Hãy phân tích prompt của người dùng xem có yêu cầu hoặc ngụ ý cần hình ảnh minh họa hay không (ví dụ: prompt có chứa 'kèm ảnh', 'có hình', 'tìm ảnh', 'cào ảnh', 'ảnh minh họa', hoặc chủ đề yêu cầu ảnh).\n"
        "- Nếu prompt KHÔNG yêu cầu ảnh hoặc không cần ảnh: Hãy ghi [IMAGE_KEYWORD: NONE] ở dòng cuối cùng.\n"
        "- Nếu prompt CÓ yêu cầu hoặc cần ảnh: Hãy ghi [IMAGE_KEYWORD: <2-4 từ khóa tiếng Anh miêu tả hình ảnh phù hợp>] ở dòng cuối cùng (ví dụ: [IMAGE_KEYWORD: coffee shop chill], [IMAGE_KEYWORD: dalat travel], [IMAGE_KEYWORD: vietnam economy]).\n\n"
        "Chỉ trả về trực tiếp nội dung bài viết và dòng [IMAGE_KEYWORD: ...] ở cuối, không kèm lời chào mở đầu hay ghi chú nào khác của AI."
    )

    clean_model = (model or "gemini-3.8-flash").strip().lower().replace(" ", "-")
    if clean_model.startswith("models/"):
        clean_model = clean_model.replace("models/", "")

    candidate_models = [clean_model]
    if "pro" in clean_model:
        fallbacks = ["gemini-2.5-pro", "gemini-pro-latest", "gemini-3.8-flash", "gemini-2.5-flash"]
    elif "lite" in clean_model:
        fallbacks = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"]
    else:
        fallbacks = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-latest"]

    for fb in fallbacks:
        if fb not in candidate_models:
            candidate_models.append(fb)

    import re
    last_error = None

    for key in all_keys:
        for endpoint_model in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{endpoint_model}:generateContent?key={key}"

            # Thử gọi với thinkingBudget: 0 trước để tránh Gemini 2.5 nuốt trọn token vào thinking
            configs_to_try = [
                {"temperature": 0.85, "maxOutputTokens": 2500, "thinkingConfig": {"thinkingBudget": 0}},
                {"temperature": 0.85, "maxOutputTokens": 3000}
            ]

            for gen_config in configs_to_try:
                payload = {
                    "contents": [
                        {
                            "parts": [
                                {"text": f"{system_instruction}\n\nYêu cầu cụ thể:\n{prompt}"}
                            ]
                        }
                    ],
                    "generationConfig": gen_config
                }

                try:
                    req = urllib.request.Request(
                        url,
                        data=json.dumps(payload).encode('utf-8'),
                        headers={'Content-Type': 'application/json'}
                    )
                    with urllib.request.urlopen(req, timeout=45) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        candidates = data.get('candidates', [])
                        if candidates:
                            cand = candidates[0]
                            finish_reason = cand.get('finishReason', '')
                            parts = cand.get('content', {}).get('parts', [])
                            if parts and 'text' in parts[0]:
                                raw_text = parts[0]['text'].strip()

                                # Tách IMAGE_KEYWORD nếu có
                                image_kw = None
                                match = re.search(r'\[IMAGE_KEYWORD:\s*([^\]]+)\]', raw_text, re.IGNORECASE)
                                if match:
                                    val = match.group(1).strip()
                                    if val.upper() != "NONE" and len(val) >= 2:
                                        image_kw = val
                                    raw_text = re.sub(r'\[IMAGE_KEYWORD:\s*[^\]]+\]', '', raw_text, flags=re.IGNORECASE).strip()
                                else:
                                    # Dọn dẹp trường hợp keyword bị cắt dở ở cuối
                                    raw_text = re.sub(r'\[IMAGE_KEYWORD:.*$', '', raw_text, flags=re.IGNORECASE).strip()

                                # Nếu chẳng may dính MAX_TOKENS và câu bị ngắt lửng mà còn key/model khác, thử lại
                                if finish_reason == 'MAX_TOKENS' and len(raw_text) < 150:
                                    logger.warning(f"Model {endpoint_model} bị MAX_TOKENS và độ dài chỉ {len(raw_text)} ký tự, thử cấu hình tiếp theo...")
                                    continue

                                return (raw_text, image_kw)
                except urllib.error.HTTPError as e:
                    last_error = f"HTTP {e.code}: {e.reason}"
                    # Nếu lỗi do model không hỗ trợ thinkingConfig (HTTP 400), thử cấu hình tiếp theo
                    if e.code == 400 and "thinkingConfig" in gen_config:
                        continue
                    logger.warning(f"Model {endpoint_model} với key ...{key[-4:]} lỗi {last_error}")
                    break
                except Exception as e:
                    last_error = str(e)
                    logger.warning(f"Lỗi gọi Gemini API ({endpoint_model}): {e}")
                    break

    raise RuntimeError(f"Không thể sinh nội dung từ Gemini: {last_error}")


# ==============================================================================
# 2. IMAGE SCRAPER & FETCHER SERVICE
# ==============================================================================

def save_optimized_image(content: bytes, save_dir: str) -> Optional[str]:
    """
    Xác thực dữ liệu tải về thực sự là ảnh hợp lệ bằng Pillow.
    Chuẩn hóa sang RGB (loại bỏ alpha/palette), nén về kích thước hợp lý (tối đa 1920px),
    và lưu thành file JPEG chất lượng cao để hiển thị nhanh trên Web và upload Facebook mượt mà.
    Tuyệt đối chặn các file không phải ảnh (PDF, HTML, tài liệu, file hỏng...).
    """
    if not content or len(content) < 1024:
        return None
    try:
        import io
        import uuid
        from PIL import Image

        img_buffer = io.BytesIO(content)
        with Image.open(img_buffer) as test_img:
            img_format = test_img.format
            if not img_format or img_format.upper() in ["PDF", "MPO", "SVG", "TIFF"]:
                return None
            width, height = test_img.size
            if width < 100 or height < 100:
                return None

            img = test_img
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                bg.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")

            # Giới hạn kích thước tối đa 1920px để tránh file dung lượng quá lớn
            max_size = 1920
            if max(width, height) > max_size:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            os.makedirs(save_dir, exist_ok=True)
            filename = f"post_img_{uuid.uuid4().hex[:10]}.jpg"
            target_path = os.path.join(save_dir, filename)
            img.save(target_path, format="JPEG", quality=88, optimize=True)
            return os.path.abspath(target_path)
    except Exception as e:
        logger.warning(f"Dữ liệu tải về không phải ảnh hợp lệ hoặc lỗi xử lý: {e}")
        return None


def search_wikimedia_images_direct(keyword: str) -> list[str]:
    """Tìm danh sách URL ảnh thực tế trên Wikimedia Commons (loại trừ tài liệu PDF, audio, video)."""
    try:
        import requests
        import urllib.parse
        url = "https://commons.wikimedia.org/w/api.php"
        headers = {"User-Agent": "FBAutoPostApp/1.0 (dev@fbautomation.local)"}
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": keyword,
            "srnamespace": 6,
            "srlimit": 10
        }
        res = requests.get(url, params=params, headers=headers, timeout=12)
        if res.status_code != 200:
            return []

        search_items = res.json().get("query", {}).get("search", [])
        if not search_items:
            return []

        valid_urls = []
        for item in search_items:
            title = (item.get("title") or "").strip()
            title_lower = title.lower()
            if any(title_lower.endswith(ext) for ext in [".pdf", ".djvu", ".tif", ".tiff", ".svg", ".webm", ".ogv", ".ogg", ".mp3", ".mid"]):
                continue

            info_params = {
                "action": "query",
                "format": "json",
                "prop": "imageinfo",
                "titles": title,
                "iiprop": "url|mime|mediatype|size"
            }
            res_info = requests.get(url, params=info_params, headers=headers, timeout=10)
            if res_info.status_code == 200:
                pages = res_info.json().get("query", {}).get("pages", {})
                for _, pdata in pages.items():
                    imageinfo = pdata.get("imageinfo", [])
                    if imageinfo:
                        info = imageinfo[0]
                        mediatype = (info.get("mediatype") or "").upper()
                        mime = (info.get("mime") or "").lower()
                        img_url = info.get("url") or ""

                        if mediatype == "BITMAP" and mime in ("image/jpeg", "image/png", "image/webp"):
                            parsed_path = urllib.parse.urlparse(img_url).path.lower()
                            if any(parsed_path.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp"]):
                                valid_urls.append(img_url)

        if valid_urls:
            random.shuffle(valid_urls)
        return valid_urls
    except Exception as e:
        logger.warning(f"Lỗi tìm ảnh Wikimedia: {e}")
        return []


def search_and_download_pixabay_image(query: str, pixabay_key: str, save_dir: str) -> Optional[str]:
    """Tìm ảnh trên Pixabay theo từ khóa và tải về thư mục máy."""
    if not pixabay_key or pixabay_key == "ĐIỀN_KEY_PIXABAY_VÀO_ĐÂY":
        return None
    try:
        os.makedirs(save_dir, exist_ok=True)
        import requests
        import urllib.parse
        encoded_q = urllib.parse.quote_plus(query)
        url = f"https://pixabay.com/api/?key={pixabay_key}&q={encoded_q}&image_type=photo&per_page=5&safesearch=true"
        resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            hits = data.get('hits', [])
            if hits:
                random.shuffle(hits)
                for chosen in hits:
                    image_url = chosen.get('largeImageURL') or chosen.get('webformatURL')
                    if image_url:
                        img_resp = requests.get(image_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
                        if img_resp.status_code == 200:
                            saved = save_optimized_image(img_resp.content, save_dir)
                            if saved:
                                return saved
        return None
    except Exception as e:
        logger.error(f"Lỗi tải ảnh Pixabay: {e}")
        return None


def crawl_or_fetch_image(
    query: str,
    pixabay_key: Optional[str] = None,
    save_dir: Optional[str] = None
) -> Optional[str]:
    """
    Cào hoặc tải ảnh từ Internet theo từ khóa (Pixabay -> Wikimedia -> DuckDuckGo).
    Lưu về save_dir (mặc định uploads/posts) và trả về đường dẫn tuyệt đối.
    Đảm bảo 100% file tải về là ảnh hợp lệ (không phải PDF hay file hỏng).
    """
    clean_query = (query or "").replace("[", "").replace("]", "").replace('"', '').replace("'", "").strip()
    if not clean_query:
        return None

    import requests

    if not save_dir:
        save_dir = str(UPLOADS_DIR / "posts")
    os.makedirs(save_dir, exist_ok=True)

    # 1. Thử Pixabay nếu có key
    if pixabay_key:
        img_path = search_and_download_pixabay_image(clean_query, pixabay_key, save_dir)
        if img_path and os.path.isfile(img_path):
            return img_path

    # 2. Thử Wikimedia Commons (kho ảnh mở phong phú, không rate limit)
    wikimedia_urls = search_wikimedia_images_direct(clean_query)
    for w_url in wikimedia_urls:
        try:
            headers = {"User-Agent": "FBAutoPostApp/1.0 (dev@fbautomation.local)"}
            r = requests.get(w_url, headers=headers, timeout=15)
            if r.status_code == 200:
                img_path = save_optimized_image(r.content, save_dir)
                if img_path:
                    return img_path
        except Exception as e:
            logger.warning(f"Lỗi lưu ảnh từ Wikimedia: {e}")

    # 3. Thử DuckDuckGo nếu có
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.images(keywords=clean_query, max_results=8))
            if results:
                for res in results:
                    img_url = res.get('image') or res.get('url')
                    if img_url and img_url.startswith('http') and not img_url.endswith('.webp'):
                        try:
                            r = requests.get(img_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
                            if r.status_code == 200:
                                img_path = save_optimized_image(r.content, save_dir)
                                if img_path:
                                    return img_path
                        except Exception:
                            continue
    except Exception:
        pass

    return None


# ==============================================================================
# 3. VIDEO SCANNER & HASH DEDUPLICATION
# ==============================================================================

REELS_EXTENSIONS = {'.mp4', '.mov'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
# Tab Story: Hỗ trợ cả video (.mp4, .mov) và hình ảnh (.jpg, .jpeg, .png, .webp)
# Sử dụng cơ chế Explicit Wait thông minh để đợi Facebook transcoding video xong mới bấm chia sẻ.
STORY_EXTENSIONS = REELS_EXTENSIONS | IMAGE_EXTENSIONS

def calculate_file_hash(file_path: str, chunk_size: int = 65536) -> str:
    """Tính mã MD5 nhanh của video để kiểm tra trùng lặp."""
    hasher = hashlib.md5()
    try:
        with open(file_path, 'rb') as f:
            # Băm 2MB đầu, 2MB giữa và 2MB cuối nếu file lớn để tốc độ cực nhanh
            file_size = os.path.getsize(file_path)
            if file_size > 10 * 1024 * 1024:
                # Đọc 2MB đầu
                hasher.update(f.read(2 * 1024 * 1024))
                # Nhảy tới giữa
                f.seek(file_size // 2)
                hasher.update(f.read(2 * 1024 * 1024))
                # Nhảy tới cuối
                f.seek(max(0, file_size - 2 * 1024 * 1024))
                hasher.update(f.read(2 * 1024 * 1024))
            else:
                for chunk in iter(lambda: f.read(chunk_size), b""):
                    hasher.update(chunk)
        return hasher.hexdigest()
    except Exception as e:
        logger.error(f"Lỗi tính hash {file_path}: {e}")
        return ""


def scan_folder_media(folder_path: str, post_type: str = 'reels') -> List[Dict[str, Any]]:
    """
    Quét thư mục lấy danh sách media khả dụng kèm mã băm và kích thước:
    - Tab Reels: chỉ đếm video (.mp4, .mov) theo quy tắc VR-M03-MAP-01
    - Tab Story: chỉ đếm hình ảnh (.jpg, .jpeg, .png, .webp), loại trừ video để chống treo web
    - Tự động bỏ qua hoàn toàn các file rác (.txt, .ini, .db...)
    """
    if not os.path.isdir(folder_path):
        return []

    valid_extensions = STORY_EXTENSIONS if post_type.lower() == 'story' else REELS_EXTENSIONS

    results = []
    for root, _, files in os.walk(folder_path):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in valid_extensions:
                full_path = os.path.join(root, f)
                try:
                    file_size = os.path.getsize(full_path)
                    # File ảnh tối thiểu 5KB, video tối thiểu 100KB, tối đa 500MB
                    min_size = 5120 if ext in IMAGE_EXTENSIONS else 102400
                    if min_size < file_size < 524288000:
                        file_hash = calculate_file_hash(full_path)
                        results.append({
                            'filename': f,
                            'path': full_path,
                            'size': file_size,
                            'hash': file_hash,
                            'type': 'image' if ext in IMAGE_EXTENSIONS else 'video',
                        })
                except Exception:
                    pass
    return results


def normalize_string_key(s: str) -> str:
    """Loại bỏ toàn bộ khoảng trắng thừa và ký tự đặc biệt, đưa về chữ thường để so khớp thông minh."""
    if not s:
        return ""
    return "".join(s.lower().replace("-", "").replace("_", "").split())


def auto_map_accounts_to_subfolders(
    master_folder: str,
    accounts: List[Dict[str, Any]],
    post_type: str = 'reels',
    check_duplicate: bool = True,
    posted_hashes_map: Optional[Dict[str, Set[str]]] = None
) -> List[Dict[str, Any]]:
    """
    Cơ chế ánh xạ thông minh (Smart Name Matching - BR-M03-PUB-01):
    1. So khớp [Tên tài khoản FB] với [Tên thư mục con]:
       - Không phân biệt chữ hoa/chữ thường (Case-insensitive)
       - Bỏ qua khoảng trắng thừa (Ví dụ: "Nguyen Van A" -> "nguyen van a" hoặc "NguyenVanA")
    2. Hoặc so khớp chính xác UID tài khoản với tên thư mục con.
    3. Nếu không tìm thấy thư mục con nào trùng tên, hệ thống BẮT BUỘC bỏ qua tài khoản đó,
       để trống ô đường dẫn và giữ nguyên trạng thái chưa gán ('--').
       TUYỆT ĐỐI KHÔNG gán nhầm hoặc gán xoay vòng round-robin.
    4. Kiểm tra mã hash để tính đúng số media CHƯA ĐĂNG (khả dụng thực tế) nếu bật check_duplicate.
    """
    if not os.path.isdir(master_folder):
        return []

    subdirs = [
        os.path.join(master_folder, d)
        for d in os.listdir(master_folder)
        if os.path.isdir(os.path.join(master_folder, d))
    ]

    posted_map = posted_hashes_map or {}
    mappings = []
    for acc in accounts:
        uid = str(acc.get('uid', '')).strip()
        name = str(acc.get('name', '')).strip()
        norm_name = normalize_string_key(name)
        norm_uid = normalize_string_key(uid)

        matched_dir = None
        # BR-M03-PUB-01: Tìm thư mục con khớp tên hoặc UID
        for d in subdirs:
            base = os.path.basename(d)
            norm_base = normalize_string_key(base)

            # Khớp chính xác tên (bỏ khoảng trắng và case)
            if norm_name and norm_name == norm_base:
                matched_dir = d
                break
            # Khớp UID
            if norm_uid and (norm_uid == norm_base or norm_uid in norm_base):
                matched_dir = d
                break

        if matched_dir:
            media_files = scan_folder_media(matched_dir, post_type=post_type)
            total_count = len(media_files)

            # Lọc theo anti-duplicate
            nick_hashes = posted_map.get(uid, set())
            unposted = [
                f for f in media_files
                if not (check_duplicate and f.get('hash') and f['hash'] in nick_hashes)
            ]
            available_count = len(unposted)
            all_posted = bool(total_count > 0 and available_count == 0 and check_duplicate)

            mappings.append({
                'account_uid': uid,
                'account_name': name,
                'post_type': post_type,
                'subfolder_path': matched_dir,
                'available_media_count': available_count,
                'total_media_count': total_count,
                'already_posted_count': total_count - available_count,
                'all_posted': all_posted,
                'mapping_status': 'MAPPED' if total_count > 0 else 'SOURCE_ERROR'
            })
        else:
            # BR-M03-PUB-01: Không tìm thấy thư mục trùng tên -> Để trống, không gán
            mappings.append({
                'account_uid': uid,
                'account_name': name,
                'post_type': post_type,
                'subfolder_path': '',
                'available_media_count': 0,
                'total_media_count': 0,
                'already_posted_count': 0,
                'all_posted': False,
                'mapping_status': '--'
            })

    return mappings


def generate_caption_from_filename(file_path: str, post_type: str = 'reels') -> str:
    """
    Tự động trích xuất và định dạng caption từ tên file media hoặc file text đi kèm:
    1. Ưu tiên đọc file .txt trùng tên trong cùng thư mục (ví dụ: clip_01.txt cùng clip_01.mp4).
    2. Nếu không có file .txt, lấy tên file gốc:
       - Loại bỏ phần mở rộng (.mp4, .mov, .jpg, .png...)
       - Thay thế dấu gạch dưới '_' và gạch nối '-' thành khoảng trắng
       - Dọn dẹp khoảng trắng thừa, viết hoa chữ cái đầu
       - Với Reels: Thêm icon sinh động và bộ hashtag xu hướng (#reels, #viral, #trending, #fyp, #xuhuong...)
       - Với Story: Trả về rỗng (hoặc nội dung file .txt nếu có) để tránh chèn text rác che video/ảnh 24h.
    """
    if not file_path:
        return ""

    # 1. Kiểm tra file .txt đi kèm cùng tên
    base_no_ext = os.path.splitext(file_path)[0]
    txt_companion = f"{base_no_ext}.txt"
    if os.path.isfile(txt_companion):
        try:
            with open(txt_companion, "r", encoding="utf-8") as tf:
                content = tf.read().strip()
                if content:
                    return content
        except Exception:
            pass

    # Story trên Web: nếu không có file text chỉ định riêng thì để rỗng để giữ trọn khung hình media
    if post_type.lower() == 'story':
        return ""

    # 2. Xử lý tên file cho Reels
    filename = os.path.basename(file_path)
    raw_name = os.path.splitext(filename)[0]

    # Thay thế gạch dưới và gạch nối thành khoảng trắng
    clean_name = raw_name.replace("_", " ").replace("-", " ")
    clean_name = " ".join(clean_name.split())

    if not clean_name:
        return ""

    # Viết hoa chữ cái đầu
    capitalized_name = clean_name[0].upper() + clean_name[1:]

    # Bộ hashtag xu hướng (thêm dấu cách cuối để không bị kẹt menu gợi ý hashtag)
    hashtag_sets = [
        "#reels #viral #trending ",
        "#reelsfb #xuhuong #fyp ",
        "#trendingreels #viralvideo #reels ",
        "#xuhuongfb #fyp #trending ",
        "#reelsvideo #viralpost #trending "
    ]
    chosen_tags = random.choice(hashtag_sets)

    return f"{capitalized_name}\n\n{chosen_tags}"
