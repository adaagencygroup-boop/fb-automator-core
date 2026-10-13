"""
fingerprint.py
Dấu vân tay trình duyệt cố định theo nick, lưu ở bảng browser_fingerprints (dùng chung mọi máy, mọi module).

Nguyên tắc: chỉ đổi những gì có thể nhất quán với phần cứng thật.
  - Cửa sổ, ngôn ngữ: đổi qua cờ Chrome nên viewport / Accept-Language / Intl tự khớp.
  - Canvas / WebGL readPixels / Audio: chỉ thêm nhiễu vào dữ liệu trả ra, không giả chuỗi GPU/CPU/RAM.
  - Không ép User-Agent: UA giả lệch với navigator.userAgentData và header Sec-CH-UA của bản Chrome thật.

Hai chế độ:
  - legacy: profile đã từng được mở trước khi có bảng (đã có thư mục Default) -> không thêm nhiễu,
    giữ nguyên dấu vân tay nick đang có. canvas_seed NULL.
  - native: profile mới -> có seed ngẫu nhiên, thêm nhiễu theo seed.
"""
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

TABLE = "browser_fingerprints"


# ─────────────────────── BẢNG CẤU HÌNH THEO SEED ──────────────────────────
# Mỗi nick chọn 1 bộ cố định theo seed; giá trị đổi thật qua cờ Chrome, không override JS.

WINDOW_SIZES: List[Tuple[int, int]] = [
    (1366, 768), (1440, 900), (1536, 864), (1600, 900), (1920, 1080),
    (1280, 800), (1280, 720), (1360, 768), (1680, 1050),
]

LOCALE_CONFIGS: List[Dict[str, str]] = [
    {"lang_flag": "vi-VN", "languages_js": "['vi-VN', 'vi', 'en-US', 'en']"},
    {"lang_flag": "vi",    "languages_js": "['vi', 'vi-VN', 'en-US', 'en']"},
    {"lang_flag": "vi-VN", "languages_js": "['vi-VN', 'vi', 'en']"},
    {"lang_flag": "vi",    "languages_js": "['vi', 'en-US', 'en']"},
    {"lang_flag": "vi-VN", "languages_js": "['vi-VN', 'en-US', 'vi', 'en']"},
]

TYPING_PROFILES: List[Dict] = [
    {"type_delay": (0.02, 0.06), "sleep_factor": 0.8},
    {"type_delay": (0.03, 0.08), "sleep_factor": 0.9},
    {"type_delay": (0.04, 0.10), "sleep_factor": 1.0},
    {"type_delay": (0.05, 0.11), "sleep_factor": 1.1},
    {"type_delay": (0.06, 0.14), "sleep_factor": 1.2},
]


def _pick_by_seed(seed: int, table: list):
    return table[seed % len(table)]


@dataclass
class BrowserConfig:
    """Cấu hình trình duyệt của 1 nick, resolve 1 lần từ seed."""
    uid: str
    seed: int
    mode: str  # "legacy" | "native"
    window_size: Tuple[int, int] = (1280, 900)
    lang_flag: str = "vi-VN"
    languages_js: str = "['vi-VN', 'vi', 'en-US', 'en']"
    type_delay: Tuple[float, float] = (0.03, 0.09)
    sleep_factor: float = 1.0

    @classmethod
    def from_fingerprint(cls, uid: str, fingerprint: dict) -> "BrowserConfig":
        seed = int(fingerprint.get("canvas_seed") or 1)
        mode = fingerprint.get("mode", "legacy")
        locale = _pick_by_seed(seed, LOCALE_CONFIGS)
        typing = _pick_by_seed(seed, TYPING_PROFILES)
        return cls(
            uid=str(uid), seed=seed, mode=mode,
            window_size=_pick_by_seed(seed, WINDOW_SIZES),
            lang_flag=locale["lang_flag"],
            languages_js=locale["languages_js"],
            type_delay=typing["type_delay"],
            sleep_factor=typing["sleep_factor"],
        )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_or_create_fingerprint(uid: str, profile_used_before: bool) -> Dict:
    """Đọc dấu vân tay của UID; chưa có thì tạo (legacy nếu profile đã từng mở, ngược lại native)."""
    from core.database.connection import db

    uid = str(uid)
    row = db.fetch_one(f"SELECT mode, canvas_seed FROM {TABLE} WHERE uid = ?", (uid,))
    if not row:
        if profile_used_before:
            mode, seed = "legacy", None
        else:
            mode, seed = "native", secrets.randbelow(2**31 - 1) + 1
        db.execute(
            f"""INSERT INTO {TABLE} (uid, mode, canvas_seed, created_at)
               VALUES (?, ?, ?, ?) ON CONFLICT (uid) DO NOTHING""",
            (uid, mode, seed, _utc_now()),
        )
        row = db.fetch_one(f"SELECT mode, canvas_seed FROM {TABLE} WHERE uid = ?", (uid,))
    return {"mode": row["mode"], "canvas_seed": row["canvas_seed"]}


def resolve_fingerprint(uid: str, profile_path: str) -> Dict:
    """
    Lấy (hoặc tạo lần đầu) dấu vân tay của UID. Phải gọi trước khi Chrome tạo thư mục Default cho profile mới.
    Lỗi DB thì ném lỗi, không mở Chrome: tự về legacy sẽ làm nick native mất nhiễu giữa chừng (đổi thiết bị).
    """
    profile_used_before = os.path.isdir(os.path.join(profile_path, "Default"))
    try:
        return get_or_create_fingerprint(uid, profile_used_before)
    except Exception as e:
        logger.warning(f"[{uid}] Không đọc được fingerprint, không mở trình duyệt: {e}")
        raise RuntimeError("Không đọc được dấu vân tay trình duyệt từ CSDL, bỏ qua để tránh đổi thiết bị") from e


def resolve_browser_config(uid: str, profile_path: str) -> BrowserConfig:
    return BrowserConfig.from_fingerprint(uid, resolve_fingerprint(uid, profile_path))


def build_init_script(config: BrowserConfig) -> str:
    """JS chạy trước mọi trang: ẩn webdriver, ngôn ngữ theo seed, nhiễu nếu là nick native."""
    script = f"""
        Object.defineProperty(navigator, 'webdriver', {{
            get: () => undefined
        }});
        Object.defineProperty(navigator, 'languages', {{
            get: () => {config.languages_js}
        }});
    """
    if config.mode != "legacy":
        script += FINGERPRINT_NOISE_JS.replace("__SEED__", str(config.seed))
    return script


# Nhiễu canvas/WebGL/Audio cố định theo seed: cùng nick luôn ra cùng một dấu vân tay, khác nick thì khác.
# Không sửa nội dung canvas gốc, chỉ sửa dữ liệu trả ra khi trang đọc pixel / mẫu âm thanh.
FINGERPRINT_NOISE_JS = r"""
(() => {
  const SEED = __SEED__ >>> 0;
  const nativeToString = Function.prototype.toString;
  const patched = new WeakMap();
  const hide = (fn, original) => { patched.set(fn, nativeToString.call(original)); return fn; };
  Function.prototype.toString = hide(function toString() {
    return patched.has(this) ? patched.get(this) : nativeToString.call(this);
  }, nativeToString);

  const delta = (i) => {
    let x = (SEED ^ Math.imul(i + 1, 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x % 3) - 1;
  };
  const noise = (data) => {
    for (let i = 0; i < data.length; i += 4) {
      if (((i >> 2) + SEED) % 7 !== 0) continue;
      data[i] = Math.min(255, Math.max(0, data[i] + delta(i)));
    }
  };

  const ctx2d = CanvasRenderingContext2D.prototype;
  const origGetImageData = ctx2d.getImageData;
  ctx2d.getImageData = hide(function getImageData(...args) {
    const img = origGetImageData.apply(this, args);
    try { noise(img.data); } catch (e) {}
    return img;
  }, origGetImageData);

  const noisyCopy = (canvas) => {
    if (!canvas.width || !canvas.height) return null;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const c = copy.getContext('2d');
    c.drawImage(canvas, 0, 0);
    const img = origGetImageData.call(c, 0, 0, copy.width, copy.height);
    noise(img.data);
    c.putImageData(img, 0, 0);
    return copy;
  };
  const canvasProto = HTMLCanvasElement.prototype;
  const origToDataURL = canvasProto.toDataURL;
  canvasProto.toDataURL = hide(function toDataURL(...args) {
    try { const copy = noisyCopy(this); if (copy) return origToDataURL.apply(copy, args); } catch (e) {}
    return origToDataURL.apply(this, args);
  }, origToDataURL);
  const origToBlob = canvasProto.toBlob;
  canvasProto.toBlob = hide(function toBlob(...args) {
    try { const copy = noisyCopy(this); if (copy) return origToBlob.apply(copy, args); } catch (e) {}
    return origToBlob.apply(this, args);
  }, origToBlob);

  for (const proto of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean).map(c => c.prototype)) {
    const origReadPixels = proto.readPixels;
    proto.readPixels = hide(function readPixels(...args) {
      const result = origReadPixels.apply(this, args);
      try { const px = args[6]; if (px && px.length) noise(px); } catch (e) {}
      return result;
    }, origReadPixels);
  }

  // Nhiễu dữ liệu đọc ra từ AudioContext theo seed, không ảnh hưởng âm thanh phát ra.
  const audioNoise = (arr) => {
    if (!arr || !arr.length) return;
    for (let i = 0; i < arr.length; i++) {
      if (((i + SEED) % 13) !== 0) continue;
      let x = (SEED ^ Math.imul(i + 1, 2246822507)) >>> 0;
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      arr[i] += ((x % 200) - 100) * 1e-7;
    }
  };
  if (window.AnalyserNode) {
    const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = hide(function getFloatFrequencyData(arr) {
      origGetFloat.call(this, arr);
      try { audioNoise(arr); } catch (e) {}
    }, origGetFloat);
  }
  if (window.AudioBuffer) {
    const origGetChannel = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = hide(function getChannelData(ch) {
      const data = origGetChannel.call(this, ch);
      try { audioNoise(data); } catch (e) {}
      return data;
    }, origGetChannel);
  }
})();
"""
