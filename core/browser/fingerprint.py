import hashlib
import logging
import os
import random
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Tuple
logger = logging.getLogger(__name__)
TABLE = "browser_fingerprints"
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
@dataclass(frozen=True)
class MouseProfile:
  speed: float = 1.0
  bend: float = 0.2
  overshoot: float = 0.15
  submove: float = 0.35
  jitter: float = 0.8
  peak: float = 1.0
  hover: Tuple[float, float] = (0.15, 0.6)
  hold: Tuple[float, float] = (0.05, 0.12)
  aim: Tuple[float, float] = (0.5, 0.5)
  spread: Tuple[float, float] = (0.12, 0.12)
  @classmethod
  def from_seed(cls, seed: int) -> "MouseProfile":
    rng = random.Random(f"mouse::{seed}")
    hover_lo, hold_lo = rng.uniform(0.1, 0.3), rng.uniform(0.04, 0.09)
    return cls(
      speed=round(rng.uniform(0.8, 1.3), 3),
      bend=round(rng.uniform(0.1, 0.3), 3),
      overshoot=round(rng.uniform(0.05, 0.25), 3),
      submove=round(rng.uniform(0.2, 0.6), 3),
      jitter=round(rng.uniform(0.4, 1.6), 2),
      peak=round(rng.uniform(0.85, 1.15), 3),
      hover=(round(hover_lo, 3), round(hover_lo + rng.uniform(0.25, 0.5), 3)),
      hold=(round(hold_lo, 3), round(hold_lo + rng.uniform(0.03, 0.06), 3)),
      aim=(round(rng.uniform(0.38, 0.62), 3), round(rng.uniform(0.42, 0.58), 3)),
      spread=(round(rng.uniform(0.08, 0.16), 3), round(rng.uniform(0.08, 0.14), 3)),
    )
def _mouse_seed(uid: str, fingerprint: dict) -> int:
  if fingerprint.get("canvas_seed"):
    return int(fingerprint["canvas_seed"])
  return int(hashlib.sha256(f"mouse-uid::{uid}".encode("utf-8")).hexdigest()[:8], 16)
@dataclass
class BrowserConfig:
  uid: str
  seed: int
  mode: str
  window_size: Tuple[int, int] = (1280, 900)
  lang_flag: str = "vi-VN"
  languages_js: str = "['vi-VN', 'vi', 'en-US', 'en']"
  type_delay: Tuple[float, float] = (0.03, 0.09)
  sleep_factor: float = 1.0
  mouse: MouseProfile = MouseProfile()
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
      mouse=MouseProfile.from_seed(_mouse_seed(str(uid), fingerprint)),
    )
def _utc_now() -> datetime:
  return datetime.now(timezone.utc).replace(tzinfo=None)
def get_or_create_fingerprint(uid: str, profile_used_before: bool) -> Dict:
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
  profile_used_before = os.path.isdir(os.path.join(profile_path, "Default"))
  try:
    return get_or_create_fingerprint(uid, profile_used_before)
  except Exception as e:
    logger.warning(f"[{uid}] Không đọc được fingerprint, không mở trình duyệt: {e}")
    raise RuntimeError("Không đọc được dấu vân tay trình duyệt từ CSDL, bỏ qua để tránh đổi thiết bị") from e
def resolve_browser_config(uid: str, profile_path: str) -> BrowserConfig:
  return BrowserConfig.from_fingerprint(uid, resolve_fingerprint(uid, profile_path))
def build_init_script(config: BrowserConfig) -> str:
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