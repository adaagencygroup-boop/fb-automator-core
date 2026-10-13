"""
media_downloader.py
Tải và chuẩn hóa kích thước ảnh Avatar (500x500) và Cover (820x312).
Dùng Pillow để resize, crop và kiểm tra tính toàn vẹn file.
"""
import os
import io
import logging
import random
import urllib.parse
import httpx
from pathlib import Path
from PIL import Image

logger = logging.getLogger(__name__)

# Kích thước chuẩn HD theo spec Facebook (Vuông 1:1 & Ngang 2.63:1 Banner)
AVATAR_SIZE = (800, 800)
COVER_SIZE = (1640, 624)
POST_SIZE = (1080, 1080)

ASSETS_DIR = Path(__file__).resolve().parents[3] / "data" / "creator_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


def _resize_cover(img: Image.Image, target: tuple) -> Image.Image:
    """
    Resize ảnh cover bằng cách crop giữa để giữ tỉ lệ khung hình đúng 820x312.
    """
    target_w, target_h = target
    img_ratio = img.width / img.height
    target_ratio = target_w / target_h

    if img_ratio > target_ratio:
        # Ảnh rộng hơn → crop hai bên
        new_h = img.height
        new_w = int(new_h * target_ratio)
    else:
        # Ảnh cao hơn → crop trên dưới
        new_w = img.width
        new_h = int(new_w / target_ratio)

    left = (img.width - new_w) // 2
    top = (img.height - new_h) // 2
    img = img.crop((left, top, left + new_w, top + new_h))
    return img.resize(target, Image.LANCZOS)


def save_avatar_from_bytes(uid: str, image_bytes: bytes) -> str:
    """
    Lưu avatar từ bytes, resize về 500x500.
    Returns: Đường dẫn file đã lưu.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = img.resize(AVATAR_SIZE, Image.LANCZOS)

    path = os.path.join(ASSETS_DIR, f"{uid}_avatar.jpg")
    img.save(path, "JPEG", quality=90, optimize=True)
    logger.info(f"Avatar saved: {path} ({img.size})")
    return path


def save_cover_from_bytes(uid: str, image_bytes: bytes) -> str:
    """
    Lưu cover từ bytes, crop và resize về 820x312.
    Returns: Đường dẫn file đã lưu.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = _resize_cover(img, COVER_SIZE)

    path = os.path.join(ASSETS_DIR, f"{uid}_cover.jpg")
    img.save(path, "JPEG", quality=88, optimize=True)
    logger.info(f"Cover saved: {path} ({img.size})")
    return path


async def download_image(url: str) -> bytes:
    """Tải ảnh từ URL bất đồng bộ."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        return resp.content


def validate_image(path: str) -> bool:
    """
    Kiểm tra tính toàn vẹn của file ảnh bằng Pillow.
    Returns: True nếu ảnh hợp lệ, False nếu bị hỏng.
    """
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except Exception as e:
        logger.error(f"Image validation failed for {path}: {e}")
        return False


def create_placeholder_image(uid: str, kind: str, page_name: str = "") -> str:
    """
    Tạo ảnh thiết kế đồ họa sang trọng (rich graphic banner) khi AI bị gián đoạn mạng.
    Hiển thị gradient đa màu sắc, khung viền badge, chữ 3D typography và thanh contact footer bar.
    """
    from PIL import ImageDraw, ImageFont

    kind = kind.lower().strip()
    size = AVATAR_SIZE if kind == "avatar" else (COVER_SIZE if kind == "cover" else POST_SIZE)
    w, h = size

    # 1. Tạo Gradient Đa Màu Rực Rỡ (Deep Slate -> Vibrant Purple -> Rose Pink)
    img = Image.new("RGB", (w, h), color=(15, 23, 42))
    draw = ImageDraw.Draw(img)

    for y in range(h):
        r = int(15 + (194 - 15) * (y / h))
        g = int(23 + (24 - 23) * (y / h))
        b = int(42 + (91 - 42) * (y / h))
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # 2. Vẽ họa tiết hình học mờ trang trí
    draw.ellipse([int(w * 0.6), int(-h * 0.2), int(w * 1.2), int(h * 0.9)], outline=(255, 255, 255, 40))
    draw.ellipse([int(-w * 0.2), int(h * 0.3), int(w * 0.4), int(h * 1.1)], outline=(255, 255, 255, 30))

    # Load font
    try:
        font_title = ImageFont.truetype("arial.ttf", int(h * 0.08))
        font_sub = ImageFont.truetype("arial.ttf", int(h * 0.04))
    except Exception:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    display_title = page_name if page_name else "OFFICIAL PAGE"

    if kind == "avatar":
        # Khung viền Emblem Tròn/Vuông
        center_x, center_y = w // 2, h // 2
        radius = int(w * 0.38)
        draw.ellipse([center_x - radius, center_y - radius, center_x + radius, center_y + radius], outline=(255, 215, 0), width=6)
        draw.ellipse([center_x - radius + 10, center_y - radius + 10, center_x + radius - 10, center_y + radius - 10], outline=(255, 255, 255), width=2)
        
        # Tiêu đề ở giữa
        draw.text((center_x + 3, center_y + 3), display_title, fill=(0, 0, 0), font=font_title, anchor="mm")
        draw.text((center_x, center_y), display_title, fill=(255, 255, 255), font=font_title, anchor="mm")
        
        # Badge Pill bên dưới
        pill_w, pill_h = int(w * 0.5), int(h * 0.08)
        pill_x1, pill_y1 = center_x - pill_w // 2, center_y + int(h * 0.22)
        draw.rounded_rectangle([pill_x1, pill_y1, pill_x1 + pill_w, pill_y1 + pill_h], radius=15, fill=(225, 29, 72))
        draw.text((center_x, pill_y1 + pill_h // 2), "★ OFFICIAL BRAND ★", fill=(255, 255, 255), font=font_sub, anchor="mm")

    elif kind == "cover":
        # Cover Banner: Tiêu đề lớn + Badge pill + Contact footer bar
        draw.text((w // 2 + 4, int(h * 0.38) + 4), display_title, fill=(0, 0, 0), font=font_title, anchor="mm")
        draw.text((w // 2, int(h * 0.38)), display_title, fill=(255, 255, 255), font=font_title, anchor="mm")
        
        # Category Badge
        pill_w, pill_h = int(w * 0.35), int(h * 0.12)
        pill_x1, pill_y1 = (w - pill_w) // 2, int(h * 0.52)
        draw.rounded_rectangle([pill_x1, pill_y1, pill_x1 + pill_w, pill_y1 + pill_h], radius=20, fill=(225, 29, 72))
        draw.text((w // 2, pill_y1 + pill_h // 2), "WELCOME TO OUR PAGE", fill=(255, 255, 255), font=font_sub, anchor="mm")

        # Contact Footer Bar ở dưới cùng
        footer_h = int(h * 0.18)
        draw.rectangle([0, h - footer_h, w, h], fill=(15, 23, 42))
        draw.line([(0, h - footer_h), (w, h - footer_h)], fill=(255, 215, 0), width=3)
        draw.text((w // 2, h - footer_h // 2), f"📍 Location  •  📞 Contact Us  •  🌐 www.{display_title.lower().replace(' ', '')}.com", fill=(226, 232, 240), font=font_sub, anchor="mm")

    else:
        # Post Image Poster: Khung thẻ bài viết + Badge Nổi Bật + Call To Action
        draw.rectangle([int(w * 0.08), int(h * 0.08), int(w * 0.92), int(h * 0.92)], outline=(255, 255, 255), width=4)
        draw.text((w // 2 + 3, int(h * 0.35) + 3), display_title, fill=(0, 0, 0), font=font_title, anchor="mm")
        draw.text((w // 2, int(h * 0.35)), display_title, fill=(255, 215, 0), font=font_title, anchor="mm")
        
        # Subtitle Post Poster
        draw.text((w // 2, int(h * 0.55)), "WELCOME & ANNOUNCEMENT", fill=(255, 255, 255), font=font_sub, anchor="mm")

        # Call to action badge
        pill_w, pill_h = int(w * 0.4), int(h * 0.08)
        pill_x1, pill_y1 = (w - pill_w) // 2, int(h * 0.72)
        draw.rounded_rectangle([pill_x1, pill_y1, pill_x1 + pill_w, pill_y1 + pill_h], radius=18, fill=(225, 29, 72))
        draw.text((w // 2, pill_y1 + pill_h // 2), "LIKE & FOLLOW US", fill=(255, 255, 255), font=font_sub, anchor="mm")

    path = os.path.join(ASSETS_DIR, f"{uid}_{kind}.jpg")
    img.save(path, "JPEG", quality=90)
    logger.info(f"Graphical fallback {kind} created: {path}")
    return path


def generate_ai_page_media(uid: str, kind: str, page_name: str, prompt: str = "") -> str:
    """
    Sinh ảnh AI nghệ thuật chất lượng cao (Avatar, Cover, Post) chuẩn tỉ lệ & kích thước Facebook.
    - Avatar: 800x800 (1:1 Vuông, dạng Emblem Badge Logo)
    - Cover: 1640x624 (2.63:1 Ngang Banner HD)
    - Post: 1080x1080 (1:1 Vuông Bài Đăng Chào Mừng, khớp 100% nội dung bài viết)
    """
    kind = kind.lower().strip()
    if kind not in ("avatar", "cover", "post"):
        kind = "avatar"

    size = AVATAR_SIZE if kind == "avatar" else (COVER_SIZE if kind == "cover" else POST_SIZE)
    width, height = size

    clean_prompt = prompt.strip() if prompt else ""

    # Xây dựng prompt tiếng Anh sống động phù hợp với loại ảnh và Gemini prompt
    if kind == "avatar":
        if clean_prompt:
            style_prompt = (
                f"masterpiece, ultra high quality circular emblem logo badge design for Facebook page '{page_name}', "
                f"{clean_prompt}, 3D typography text '{page_name}', vibrant colors, professional emblem badge art, 1:1 square ratio"
            )
        else:
            style_prompt = (
                f"masterpiece, ultra high quality circular emblem logo badge design for Facebook page '{page_name}', "
                f"centered 3D typography text '{page_name}', vibrant red, pink and gold color scheme, clean vector badge art, 1:1 square ratio"
            )
    elif kind == "cover":
        if clean_prompt:
            style_prompt = (
                f"masterpiece, ultra high quality commercial Facebook cover photo banner for page '{page_name}', "
                f"{clean_prompt}, 1640x624 wide banner format, stylish 3D typography text '{page_name}', "
                f"vibrant eye-catching color scheme, dark blue contact info footer bar at bottom with icons, 1640x624 resolution"
            )
        else:
            style_prompt = (
                f"masterpiece, ultra high quality Facebook cover photo banner for page '{page_name}', "
                f"1640x624 wide banner format, prominent 3D typography text '{page_name}', vibrant red pink and white graphic design, "
                f"dark blue contact info footer bar at bottom with location, phone and website icons, 1640x624 resolution"
            )
    else: # post
        if clean_prompt:
            style_prompt = (
                f"masterpiece, ultra high quality social media marketing post poster banner photo for Facebook page '{page_name}', "
                f"{clean_prompt}, vibrant colorful composition, bold typography text '{page_name}', "
                f"professional graphic poster art matching the post concept, 1080x1080 resolution, 1:1 square format"
            )
        else:
            style_prompt = (
                f"masterpiece, high quality welcome announcement banner poster for Facebook page '{page_name}', "
                f"bold typography, vibrant graphic design, clean layout, 1:1 square format"
            )

    encoded_prompt = urllib.parse.quote(style_prompt)
    seed = random.randint(1000, 999999)

    # Các AI Engine candidate để thử (Pollinations Flux -> Pollinations Turbo)
    engine_urls = [
        f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&seed={seed}&model=flux&nologo=true",
        f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&seed={seed}&model=turbo&nologo=true",
    ]

    logger.info(f"[{uid}] Generating AI image for kind='{kind}' ({width}x{height}) via AI engine...")

    for url in engine_urls:
        try:
            with httpx.Client(timeout=35.0, follow_redirects=True) as client:
                resp = client.get(url)
                if resp.status_code == 200 and len(resp.content) > 10000:
                    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                    if kind == "cover":
                        img = _resize_cover(img, COVER_SIZE)
                    else:
                        img = img.resize(size, Image.LANCZOS)
                    
                    path = os.path.join(ASSETS_DIR, f"{uid}_{kind}.jpg")
                    img.save(path, "JPEG", quality=92, optimize=True)
                    logger.info(f"[{uid}] AI {kind} generated successfully: {path} ({img.size})")
                    return path
        except Exception as e:
            logger.warning(f"[{uid}] AI engine attempt note for {kind}: {e}. Retrying next engine...")

    logger.warning(f"[{uid}] All AI image engines failed/timed out for {kind}. Generating rich graphic fallback...")
    return create_placeholder_image(uid, kind, page_name)
