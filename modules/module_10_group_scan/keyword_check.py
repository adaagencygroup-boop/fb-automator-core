"""
Kiểm tra từ khóa (nhiều từ khóa / 1 nick):
1) Mở Chrome session Module 2 một lần
2) Với từng từ khóa: search → Groups → quét tới hạn mức
3) Giữa các từ khóa nghỉ delay_min..delay_max giây (cùng account)
4) FE poll /check-status (logs + groups + keyword_stats)
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
import uuid
from typing import Any, Optional
from urllib.parse import quote, urlparse, urlunparse

logger = logging.getLogger(__name__)

DEFAULT_MAX_GROUPS = 30
HARD_MAX_GROUPS = 200
# Job cũ/treo (tắt browser, mất kết nối) tự nhả sau khoảng này.
STALE_PENDING_SEC = 45

_pending: dict[str, dict[str, Any]] = {}
_pending_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()

SEARCH_INPUT_LOCATORS = [
    # English UI trước (nhiều nick đang để EN)
    '//input[@aria-label="Search Facebook"]',
    '//input[@placeholder="Search Facebook"]',
    '//input[@type="search" and @aria-label="Search Facebook"]',
    '//input[@role="combobox" and @aria-label="Search Facebook"]',
    # Vietnamese UI
    '//input[@aria-label="Tìm kiếm trên Facebook"]',
    '//input[@placeholder="Tìm kiếm trên Facebook"]',
    '//input[@type="search" and (@aria-label="Tìm kiếm trên Facebook" or @aria-label="Search Facebook")]',
    '//input[@role="combobox" and (contains(@aria-label,"Tìm kiếm trên Facebook") or contains(@aria-label,"Search Facebook"))]',
    '//input[@type="search" and (contains(@aria-label,"Tìm kiếm") or contains(@aria-label,"Search") or contains(@placeholder,"Tìm kiếm") or contains(@placeholder,"Search Facebook"))]',
]

GROUPS_TAB_LOCATORS = [
    '//*[@role="list"]//span[normalize-space()="Groups" or normalize-space()="Nhóm"]',
    '//*[@role="list"]//*[@role="listitem" or @role="link" or @role="button"][.//span[normalize-space()="Groups" or normalize-space()="Nhóm"]]',
    '//span[normalize-space()="Groups" or normalize-space()="Nhóm"]',
    '//a[contains(@href,"/search/groups")]//span[contains(.,"Groups") or contains(.,"Nhóm")]',
    '//*[@role="link" or @role="button"][normalize-space()="Groups" or normalize-space()="Nhóm"]',
]

RESULTS_ROOT_LOCATORS = [
    '//*[@aria-label="Search results" and @role="main"]',
    '//*[@aria-label="Search results"]',
    '//*[@role="main" and contains(@aria-label,"Search results")]',
    '//*[@role="main" and (contains(@aria-label,"Kết quả tìm kiếm") or contains(@aria-label,"kết quả"))]',
]

CLICK_JOIN_BUTTON_JS = """
return ((targetUrl, targetName) => {
  const cleanUrl = (targetUrl || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  const root =
    document.querySelector('[aria-label="Search results"][role="main"]') ||
    document.querySelector('[aria-label="Search results"]') ||
    document.querySelector('[role="main"]') ||
    document.body;

  const isAlreadyJoined = (text) => {
    return /^(đã tham gia|joined|đang chờ|requested|hủy yêu cầu|hủy lời mời|chờ phê duyệt|đang chờ duyệt)$/i.test((text || '').trim());
  };

  const isJoinText = (text) => {
    return /^(tham gia|tham gia nhóm|join|join group)$/i.test((text || '').trim());
  };

  const clickElement = (el) => {
    if (!el) return false;
    const btn = el.closest('div[role="button"], button') || el;
    try {
      btn.scrollIntoView({ behavior: 'instant', block: 'center' });
    } catch (e) {}
    try {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    } catch (e) {}
    btn.click();
    return true;
  };

  // 1. Thử tìm trên thẻ card tương ứng với targetUrl trong Search results
  if (cleanUrl) {
    const anchors = root.querySelectorAll('a[href*="/groups/"]');
    for (const a of anchors) {
      const href = (a.getAttribute('href') || a.href || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
      let matched = (href === cleanUrl);
      if (!matched && cleanUrl.includes('/groups/')) {
        const slug = cleanUrl.split('/groups/')[1].split('/')[0];
        if (slug && href.includes('/groups/' + slug)) matched = true;
      }
      if (!matched && targetName) {
        const aText = (a.textContent || '').trim().toLowerCase();
        if (aText && aText === targetName.toLowerCase()) matched = true;
      }

      if (matched) {
        let card = a;
        for (let i = 0; i < 10 && card && card !== root; i++) {
          card = card.parentElement;
          if (!card) break;

          // Kiểm tra xem trên card đã ở trạng thái đã tham gia chưa
          const spans = card.querySelectorAll('span');
          for (const sp of spans) {
            const spText = (sp.textContent || '').trim();
            if (isAlreadyJoined(spText)) {
              return { status: 'already_joined', label: spText };
            }
          }

          // Ưu tiên tìm đúng element: <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft">Tham gia</span>
          for (const sp of spans) {
            const spText = (sp.textContent || '').trim();
            if (isJoinText(spText)) {
              clickElement(sp);
              return { status: 'clicked_join', label: spText };
            }
          }

          // Fallback tìm button trên card
          const btns = card.querySelectorAll('div[role="button"], button');
          for (const btn of btns) {
            const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
            if (isAlreadyJoined(text)) {
              return { status: 'already_joined', label: text };
            }
            if (isJoinText(text)) {
              clickElement(btn);
              return { status: 'clicked_join', label: text };
            }
          }
        }
      }
    }
  }

  // 2. Nếu ở trang nhóm trực tiếp (Group page) hoặc fallback trên toàn trang
  // Ưu tiên tìm span có class x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft
  const allSpans = document.querySelectorAll('span.x1lliihq, span');
  for (const sp of allSpans) {
    const spText = (sp.textContent || '').trim();
    if (isAlreadyJoined(spText)) {
      return { status: 'already_joined', label: spText };
    }
    if (isJoinText(spText)) {
      clickElement(sp);
      return { status: 'clicked_join', label: spText };
    }
  }

  return { status: 'not_found' };
})(arguments[0], arguments[1]);
"""

# Tắt filter search (Near me / Public groups / My groups) — không được bật khi join nhóm.
ENSURE_SEARCH_FILTERS_OFF_JS = """
return (() => {
  const switches = document.querySelectorAll(
    'input[role="switch"], [role="switch"], input[type="checkbox"][aria-label]'
  );
  const isSearchFilter = (aria) => {
    return /near me|gần tôi|gan toi|nearby|ở gần|o gan|public groups|nhóm công khai|nhom cong khai|my groups|nhóm của tôi|nhom cua toi/.test(aria || '');
  };
  let turnedOff = 0;
  const labels = [];
  switches.forEach((el) => {
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (!isSearchFilter(aria)) return;
    const on = el.getAttribute('aria-checked') === 'true' || el.checked === true;
    if (!on) return;
    try {
      el.click();
      el.checked = false;
      el.setAttribute('aria-checked', 'false');
      el.dispatchEvent(new Event('change', { bubbles: true }));
      turnedOff += 1;
      labels.push(el.getAttribute('aria-label') || aria);
    } catch (e) {}
  });
  return { turnedOff, labels };
})();
"""

CHECK_GROUP_QUESTIONS_DIALOG_JS = """
return (() => {
  const dialog =
    document.querySelector('div[role="dialog"]') ||
    document.querySelector('[aria-modal="true"]');
  if (!dialog) {
    return {
      hasDialog: false,
      hasFields: false,
      hasSubmit: false,
      textareaCount: 0,
      radioCount: 0,
      checkboxCount: 0,
      title: '',
    };
  }
  const root = dialog;

  const textareas = root.querySelectorAll('textarea');
  const radios = root.querySelectorAll('input[type="radio"], div[role="radio"]');
  const checkboxes = Array.from(
    root.querySelectorAll('input[type="checkbox"], input[name="agree-to-group-rules"], div[role="checkbox"]')
  ).filter((el) => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (role === 'switch') return false;
    if (/near me|gần tôi|gan toi|nearby|public groups|nhóm công khai|my groups|nhóm của tôi/.test(aria)) return false;
    return true;
  });

  let hasSubmit = false;
  const nodes = root.querySelectorAll('span, div[role="button"], button');
  for (const el of nodes) {
    const t = (el.textContent || el.getAttribute('aria-label') || '').trim();
    if (/^(submit|gửi|gửi câu trả lời|submit answers)$/i.test(t)) {
      hasSubmit = true;
      break;
    }
  }

  const bodyText = (root.innerText || '').toLowerCase();
  const looksLikeQuestions = /câu hỏi|câu trả lời|quy tắc|rules|question|membership|yêu cầu tham gia|trả lời|agree to group rules/i.test(bodyText);
  const hasFields = textareas.length > 0 || radios.length > 0 || checkboxes.length > 0;
  const hasDialog = looksLikeQuestions || hasFields || hasSubmit;

  return {
    hasDialog,
    hasFields,
    hasSubmit,
    textareaCount: textareas.length,
    radioCount: radios.length,
    checkboxCount: checkboxes.length,
    title: (root.querySelector('h1, h2, h3, [role="heading"]')?.textContent || '').trim(),
  };
})();
"""

ANSWER_GROUP_QUESTIONS_JS = """
return (() => {
  // CHỈ làm việc trong dialog câu hỏi — không đụng filter trang search (Near me, ...)
  const dialogEl =
    document.querySelector('div[role="dialog"]') ||
    document.querySelector('[aria-modal="true"]');
  if (!dialogEl) {
    return {
      found: false,
      answeredCount: 0,
      radiosSelected: 0,
      checkboxesChecked: 0,
      rulesAgreed: false,
      details: [],
      skipped: 'no_dialog',
    };
  }
  const targetRoot = dialogEl;

  const result = {
    found: true,
    answeredCount: 0,
    radiosSelected: 0,
    checkboxesChecked: 0,
    rulesAgreed: false,
    details: [],
  };

  const isFilterSwitch = (el) => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const name = (el.getAttribute('name') || '').toLowerCase();
    // Mọi role=switch trên trang search/filter đều bỏ qua (không đụng)
    if (role === 'switch') return true;
    if (/near me|gần tôi|gan toi|nearby|ở gần|o gan|public groups|nhóm công khai|nhom cong khai|my groups|nhóm của tôi|nhom cua toi/.test(aria)) return true;
    if (/near.?me|nearby|public.?groups|my.?groups/.test(name)) return true;
    return false;
  };

  const setNativeValue = (element, value) => {
    try {
      element.focus();
      element.click();
      const tag = (element.tagName || '').toLowerCase();
      const proto =
        tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      // React 16/17 tracker
      try {
        const tracker = element._valueTracker;
        if (tracker) tracker.setValue('');
      } catch (e) {}
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } catch (e) {
      try { element.value = value; } catch (err) {}
    }
  };

  const questionNear = (el) => {
    let curr = el.parentElement;
    for (let depth = 0; depth < 8 && curr && curr !== targetRoot; depth++) {
      const txt = (curr.innerText || '').trim();
      if (txt.length > 5 && txt.length < 600) return txt;
      curr = curr.parentElement;
    }
    return '';
  };

  const pickAnswer = (questionText) => {
    const q = (questionText || '').toLowerCase();
    if (/số điện thoại|sđt|phone|mobile|whatsapp|zalo/i.test(q)) return '0988668899';
    if (/email|e-mail|mail/i.test(q)) return 'thanhvien.fb@gmail.com';
    if (/biết qua đâu|nguồn|ai giới thiệu|how did you find|từ đâu|heard about/i.test(q)) return 'Tìm kiếm trên Facebook';
    if (/tuổi|năm sinh|age|năm bao nhiêu/i.test(q)) return '1995';
    if (/ở đâu|thành phố|quê quán|tỉnh|nơi sống|where do you live|city/i.test(q)) return 'Hà Nội';
    if (/tên|name|họ tên/i.test(q)) return 'Thanh Vien';
    return 'Tôi đồng ý và cam kết tuân thủ đầy đủ quy tắc nhóm.';
  };

  // 1) TEXTAREA / text input — nhập text (không bỏ vì offsetParent null trong dialog FB)
  const textInputs = targetRoot.querySelectorAll(
    'textarea, input[type="text"]:not([type="hidden"]), div[role="textbox"], div[contenteditable="true"]'
  );
  textInputs.forEach((el) => {
    if (isFilterSwitch(el)) return;
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    if (/search|tìm kiếm|tim kiem/.test(aria + ' ' + ph)) return;
    const style = window.getComputedStyle(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return;

    try { el.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
    const qText = questionNear(el);
    let ans = pickAnswer(qText);
    const maxLen = parseInt(el.getAttribute('maxlength') || '0', 10);
    if (maxLen > 0 && ans.length > maxLen) ans = ans.slice(0, maxLen);

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      setNativeValue(el, ans);
      // Verify — nếu React nuốt value thì thử lại
      if (!(el.value || '').trim()) {
        try {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ans);
        } catch (e2) {
          setNativeValue(el, ans);
        }
      }
      if ((el.value || '').trim()) {
        result.answeredCount += 1;
        result.details.push('textarea');
      }
    } else {
      el.focus();
      el.textContent = ans;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.answeredCount += 1;
      result.details.push('textbox');
    }
  });

  // 2) RADIO — mỗi nhóm name chọn 1 option
  const radioInputs = Array.from(targetRoot.querySelectorAll('input[type="radio"], div[role="radio"]'))
    .filter((r) => !isFilterSwitch(r));
  const radioGroups = new Map();
  radioInputs.forEach((r, idx) => {
    const groupName =
      r.getAttribute('name') ||
      r.getAttribute('aria-labelledby') ||
      (r.closest('[role="radiogroup"]') && ('rg_' + idx)) ||
      ('solo_' + idx);
    if (!radioGroups.has(groupName)) radioGroups.set(groupName, []);
    radioGroups.get(groupName).push(r);
  });

  radioGroups.forEach((radios) => {
    const already = radios.some((r) => r.checked === true || r.getAttribute('aria-checked') === 'true');
    if (already) return;

    let chosen = null;
    for (const r of radios) {
      const labelId = r.getAttribute('aria-labelledby') || '';
      const labelEl = labelId ? document.getElementById(labelId) : null;
      const text = (
        (labelEl && labelEl.textContent) ||
        r.value ||
        r.getAttribute('aria-label') ||
        r.parentElement?.innerText ||
        ''
      ).toLowerCase();
      if (/đồng ý|có|yes|tuân thủ|chấp nhận|agree|đã đọc|tôi đồng ý|ok/i.test(text)) {
        chosen = r;
        break;
      }
    }
    if (!chosen) chosen = radios[0];
    if (!chosen) return;

    try {
      chosen.scrollIntoView({ behavior: 'instant', block: 'center' });
      if (chosen.tagName && chosen.tagName.toLowerCase() === 'input') {
        chosen.click();
        chosen.checked = true;
        chosen.setAttribute('aria-checked', 'true');
        chosen.dispatchEvent(new Event('input', { bubbles: true }));
        chosen.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        chosen.click();
        chosen.setAttribute('aria-checked', 'true');
        chosen.dispatchEvent(new Event('change', { bubbles: true }));
      }
      result.radiosSelected += 1;
      result.details.push('radio');
    } catch (e) {}
  });

  // 3) CHECKBOX trong dialog — KHÔNG đụng role=switch / Near me
  const checkboxes = targetRoot.querySelectorAll(
    'input[type="checkbox"], input[name="agree-to-group-rules"], div[role="checkbox"]'
  );
  checkboxes.forEach((cb) => {
    if (isFilterSwitch(cb)) return;

    const isChecked = cb.checked === true || cb.getAttribute('aria-checked') === 'true';
    if (isChecked) {
      if ((cb.getAttribute('name') || '').includes('agree') || /quy tắc|rules|agree/i.test(cb.parentElement?.innerText || '')) {
        result.rulesAgreed = true;
      }
      return;
    }
    if (cb.getAttribute('aria-disabled') === 'true' || cb.disabled) return;

    try {
      cb.scrollIntoView({ behavior: 'instant', block: 'center' });
      cb.click();
      if (cb.tagName && cb.tagName.toLowerCase() === 'input') {
        cb.checked = true;
      }
      cb.setAttribute('aria-checked', 'true');
      cb.dispatchEvent(new Event('input', { bubbles: true }));
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      result.checkboxesChecked += 1;
      result.details.push('checkbox');
      const name = (cb.getAttribute('name') || '').toLowerCase();
      const nearby = (cb.parentElement?.innerText || '').toLowerCase();
      if (name.includes('agree') || /quy tắc|rules|điều khoản|đồng ý|agree/i.test(nearby)) {
        result.rulesAgreed = true;
      }
    } catch (e) {}
  });

  return result;
})();
"""

FIND_SUBMIT_BUTTON_JS = """
return (() => {
  const dialog =
    document.querySelector('div[role="dialog"]') ||
    document.querySelector('[aria-modal="true"]');
  if (!dialog) return { found: false, visible: false, enabled: false, text: '' };

  const isSubmitText = (text) => {
    return /^(submit|gửi|gửi câu trả lời|hoàn tất|xong|done|gửi cho quản trị viên|submit answers)$/i.test((text || '').trim());
  };

  const isDisabled = (el) => {
    const btn = el.closest('div[role="button"], button') || el;
    return (
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.disabled === true ||
      /\\bdisabled\\b/i.test((btn.className || '').toString())
    );
  };

  const spans = dialog.querySelectorAll('span.x1lliihq, span.xuxw1ft, span');
  for (const sp of spans) {
    const text = (sp.textContent || '').trim();
    if (!isSubmitText(text)) continue;
    const visible = sp.offsetParent !== null || sp.getClientRects().length > 0;
    return {
      found: true,
      visible,
      enabled: !isDisabled(sp),
      text,
      method: 'span',
    };
  }

  const buttons = dialog.querySelectorAll('div[role="button"], button');
  for (const btn of buttons) {
    const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
    if (!isSubmitText(text)) continue;
    const visible = btn.offsetParent !== null || btn.getClientRects().length > 0;
    return {
      found: true,
      visible,
      enabled: !isDisabled(btn),
      text,
      method: 'button',
    };
  }

  return { found: false, visible: false, enabled: false, text: '' };
})();
"""

SUBMIT_GROUP_QUESTIONS_JS = """
return (() => {
  const dialog =
    document.querySelector('div[role="dialog"]') ||
    document.querySelector('[aria-modal="true"]');
  if (!dialog) return { clicked: false, reason: 'no_dialog' };

  const isSubmitText = (text) => {
    return /^(submit|gửi|gửi câu trả lời|hoàn tất|xong|done|gửi cho quản trị viên|submit answers)$/i.test((text || '').trim());
  };

  const clickSubmit = (el) => {
    const btn = el.closest('div[role="button"], button') || el;
    try {
      btn.removeAttribute('disabled');
      btn.setAttribute('aria-disabled', 'false');
      if (btn.disabled) btn.disabled = false;
    } catch (e) {}
    try { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
    try {
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    } catch (e) {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    }
    btn.click();
    try { el.click(); } catch (e) {}
    return true;
  };

  // 1) <span ...>Submit</span> / Gửi trong dialog
  const spans = dialog.querySelectorAll('span.x1lliihq, span.xuxw1ft, span');
  for (const sp of spans) {
    const text = (sp.textContent || '').trim();
    if (isSubmitText(text)) {
      clickSubmit(sp);
      return { clicked: true, text, method: 'span' };
    }
  }

  // 2) button / role=button
  const allButtons = dialog.querySelectorAll('div[role="button"], button');
  for (const btn of allButtons) {
    const btnText = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
    if (isSubmitText(btnText)) {
      clickSubmit(btn);
      return { clicked: true, text: btnText, method: 'button' };
    }
  }

  // 3) fallback Next / Continue
  for (const btn of allButtons) {
    const btnText = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
    if (/^(tiếp|tiếp tục|next|xác nhận|confirm)$/i.test(btnText)) {
      clickSubmit(btn);
      return { clicked: true, text: btnText, method: 'next' };
    }
  }

  return { clicked: false, reason: 'submit_not_found' };
})();
"""


def _pick_membership_answer(question_text: str) -> str:
    q = (question_text or "").lower()
    if re.search(r"số điện thoại|sđt|phone|mobile|whatsapp|zalo", q):
        return "0988668899"
    if re.search(r"email|e-mail|\bmail\b", q):
        return "thanhvien.fb@gmail.com"
    if re.search(r"biết qua đâu|nguồn|ai giới thiệu|how did you find|từ đâu|heard about", q):
        return "Tìm kiếm trên Facebook"
    if re.search(r"tuổi|năm sinh|\bage\b|năm bao nhiêu", q):
        return "1995"
    if re.search(r"ở đâu|thành phố|quê quán|tỉnh|nơi sống|where do you live|city", q):
        return "Hà Nội"
    if re.search(r"\btên\b|\bname\b|họ tên", q):
        return "Thanh Vien"
    return "Tôi đồng ý và cam kết tuân thủ đầy đủ quy tắc nhóm."


def _fill_membership_fields_selenium(driver, job_id: Optional[str], name: str) -> dict[str, int]:
    """Nhập câu trả lời bằng Selenium send_keys — React FB thường nuốt JS set value."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys

    stats = {"textarea": 0, "radio": 0, "checkbox": 0}
    try:
        dialogs = driver.find_elements(By.CSS_SELECTOR, 'div[role="dialog"], [aria-modal="true"]')
    except Exception:
        dialogs = []
    if not dialogs:
        return stats
    root = dialogs[0]

    # Textarea
    try:
        textareas = root.find_elements(By.CSS_SELECTOR, "textarea")
    except Exception:
        textareas = []
    for ta in textareas:
        try:
            if not ta.is_displayed():
                continue
            aria = (ta.get_attribute("aria-label") or "").lower()
            ph = (ta.get_attribute("placeholder") or "").lower()
            if re.search(r"search|tìm kiếm|tim kiem", aria + " " + ph):
                continue
            q = ""
            try:
                q = (ta.find_element(By.XPATH, "./ancestor::*[self::div][1]").text or "")[:500]
            except Exception:
                q = ""
            ans = _pick_membership_answer(q)
            max_len = ta.get_attribute("maxlength")
            if max_len and str(max_len).isdigit():
                ans = ans[: int(max_len)]
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", ta)
            ta.click()
            try:
                ta.send_keys(Keys.CONTROL, "a")
                ta.send_keys(Keys.BACKSPACE)
            except Exception:
                try:
                    ta.clear()
                except Exception:
                    pass
            ta.send_keys(ans)
            # Fallback JS nếu send_keys vẫn trống
            val = (ta.get_attribute("value") or "").strip()
            if not val:
                driver.execute_script(
                    """
                    const el = arguments[0], value = arguments[1];
                    el.focus();
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    if (setter) setter.call(el, value); else el.value = value;
                    try { if (el._valueTracker) el._valueTracker.setValue(''); } catch (e) {}
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    """,
                    ta,
                    ans,
                )
            val = (ta.get_attribute("value") or "").strip()
            if val:
                stats["textarea"] += 1
                _append_log(job_id, f"⌨️ «{name}»: Đã nhập textarea ({len(val)} ký tự).", "info")
        except Exception as exc:
            _append_log(job_id, f"⚠️ «{name}»: Lỗi nhập textarea: {exc}", "warn")

    # Radio — mỗi name chọn 1
    try:
        radios = root.find_elements(By.CSS_SELECTOR, 'input[type="radio"]')
    except Exception:
        radios = []
    seen_names: set[str] = set()
    for radio in radios:
        try:
            if not radio.is_displayed():
                continue
            rname = radio.get_attribute("name") or id(radio)
            if rname in seen_names:
                continue
            if radio.is_selected():
                seen_names.add(str(rname))
                continue
            # Prefer agree-like in same group
            group = [r for r in radios if (r.get_attribute("name") or id(r)) == rname]
            chosen = None
            for r in group:
                label = (r.get_attribute("aria-label") or r.get_attribute("value") or "").lower()
                if re.search(r"đồng ý|có|yes|agree|tuân thủ|chấp nhận", label):
                    chosen = r
                    break
            chosen = chosen or (group[0] if group else radio)
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", chosen)
            driver.execute_script("arguments[0].click();", chosen)
            seen_names.add(str(rname))
            stats["radio"] += 1
        except Exception:
            continue

    # Checkbox (không phải switch filter)
    try:
        checks = root.find_elements(
            By.CSS_SELECTOR,
            'input[type="checkbox"], input[name="agree-to-group-rules"]',
        )
    except Exception:
        checks = []
    for cb in checks:
        try:
            role = (cb.get_attribute("role") or "").lower()
            aria = (cb.get_attribute("aria-label") or "").lower()
            if role == "switch":
                continue
            if re.search(r"near me|gần tôi|public groups|my groups|nhóm công khai|nhóm của tôi", aria):
                continue
            if not cb.is_displayed():
                continue
            if cb.is_selected() or (cb.get_attribute("aria-checked") or "") == "true":
                continue
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", cb)
            driver.execute_script("arguments[0].click();", cb)
            stats["checkbox"] += 1
        except Exception:
            continue

    return stats


def _wait_membership_dialog_closed(driver, timeout_s: float = 12.0) -> bool:
    """True nếu dialog câu hỏi đã đóng."""
    import time as _time

    from modules.module_02_account_manager.automation import human_sleep

    end = _time.time() + timeout_s
    while _time.time() < end:
        try:
            info = driver.execute_script(CHECK_GROUP_QUESTIONS_DIALOG_JS) or {}
            if not info.get("hasDialog") and not info.get("hasFields"):
                return True
        except Exception:
            return True
        human_sleep(0.4, 0.6)
    return False


def _tick_agree_to_group_rules(driver, job_id: Optional[str], name: str) -> bool:
    """Tích checkbox name=agree-to-group-rules trong popup."""
    from selenium.webdriver.common.by import By

    from modules.module_02_account_manager.automation import human_sleep

    try:
        dialogs = driver.find_elements(By.CSS_SELECTOR, 'div[role="dialog"], [aria-modal="true"]')
    except Exception:
        dialogs = []
    roots = dialogs or [driver]

    for root in roots:
        try:
            boxes = root.find_elements(By.CSS_SELECTOR, 'input[type="checkbox"][name="agree-to-group-rules"]')
        except Exception:
            boxes = []
        if not boxes:
            try:
                boxes = root.find_elements(By.CSS_SELECTOR, 'input[name="agree-to-group-rules"]')
            except Exception:
                boxes = []
        for cb in boxes:
            try:
                role = (cb.get_attribute("role") or "").lower()
                if role == "switch":
                    continue
                checked = cb.is_selected() or (cb.get_attribute("aria-checked") or "") == "true"
                if checked:
                    _append_log(job_id, f"☑️ «{name}»: [agree-to-group-rules] đã tích sẵn.", "info")
                    return True
                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", cb)
                human_sleep(0.2, 0.35)
                try:
                    cb.click()
                except Exception:
                    driver.execute_script(
                        """
                        const el = arguments[0];
                        el.click();
                        el.checked = true;
                        el.setAttribute('aria-checked', 'true');
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        """,
                        cb,
                    )
                checked2 = cb.is_selected() or (cb.get_attribute("aria-checked") or "") == "true"
                if checked2:
                    _append_log(job_id, f"☑️ «{name}»: Đã tích [agree-to-group-rules].", "info")
                    return True
            except Exception as exc:
                _append_log(job_id, f"⚠️ «{name}»: Lỗi tích agree-to-group-rules: {exc}", "warn")
    return False


def _click_submit_span(driver, job_id: Optional[str], name: str) -> dict[str, Any]:
    """Bấm <span ...>Submit</span> / Gửi trong dialog."""
    from selenium.webdriver.common.by import By

    # Ưu tiên JS đã tối ưu trong dialog
    try:
        res = driver.execute_script(SUBMIT_GROUP_QUESTIONS_JS) or {}
        if res.get("clicked"):
            _append_log(job_id, f"✅ «{name}»: Đã bấm [{res.get('text') or 'Submit'}].", "success")
            return res
    except Exception:
        pass

    try:
        dialogs = driver.find_elements(By.CSS_SELECTOR, 'div[role="dialog"], [aria-modal="true"]')
    except Exception:
        dialogs = []
    root = dialogs[0] if dialogs else driver
    try:
        spans = root.find_elements(By.CSS_SELECTOR, "span.x1lliihq, span.xuxw1ft, span")
    except Exception:
        spans = []
    for sp in spans:
        try:
            text = (sp.text or "").strip()
            if not re.match(r"^(Submit|Gửi|Gửi câu trả lời|Submit answers)$", text, re.I):
                continue
            btn = sp
            try:
                btn = sp.find_element(By.XPATH, './ancestor::div[@role="button"][1]')
            except Exception:
                try:
                    btn = sp.find_element(By.XPATH, "./ancestor::button[1]")
                except Exception:
                    btn = sp
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
            driver.execute_script(
                """
                const el = arguments[0];
                el.removeAttribute('disabled');
                el.setAttribute('aria-disabled', 'false');
                el.click();
                """,
                btn,
            )
            _append_log(job_id, f"✅ «{name}»: Đã bấm [{text}].", "success")
            return {"clicked": True, "text": text, "method": "selenium_span"}
        except Exception:
            continue
    return {"clicked": False}


def _auto_join_group(driver, item: dict[str, Any], job_id: Optional[str] = None) -> str:
    """
    Join nhóm private khi có popup:
    1) Bấm Tham gia → đợi popup
    2) Nếu có ô text → nhập
    3) Tích agree-to-group-rules
    4) Bấm Submit → đợi đóng rồi mới sang nhóm khác
    """
    if not driver:
        return item.get("note") or "—"

    name = item.get("name") or "Nhóm"
    url = item.get("href") or item.get("url") or ""
    privacy = (item.get("type") or "").lower()
    is_private = privacy in {"private", "riêng tư", "rieng tu"}

    try:
        from modules.module_02_account_manager.automation import human_sleep

        try:
            filt = driver.execute_script(ENSURE_SEARCH_FILTERS_OFF_JS) or {}
            if int(filt.get("turnedOff") or 0) > 0:
                labels = ", ".join(filt.get("labels") or []) or "search filters"
                _append_log(job_id, f"🔕 Đã tắt filter [{labels}] trước khi join.", "info")
        except Exception:
            pass

        res = driver.execute_script(CLICK_JOIN_BUTTON_JS, url, name) or {}
        st = res.get("status")

        if st == "already_joined":
            label = res.get("label", "Đã tham gia")
            _append_log(job_id, f"ℹ️ «{name}»: Tài khoản đã ở trạng thái [{label}].", "info")
            if "chờ" in label.lower() or "request" in label.lower() or "pending" in label.lower():
                return "pending"
            return "joined"

        if st != "clicked_join":
            _append_log(job_id, f"ℹ️ «{name}»: Không tìm thấy nút [Tham gia] khả dụng.", "info")
            return item.get("note") or "—"

        _append_log(job_id, f"👉 «{name}»: Đã bấm [{res.get('label', 'Tham gia')}] — chờ popup...", "info")
        try:
            driver.execute_script(ENSURE_SEARCH_FILTERS_OFF_JS)
        except Exception:
            pass

        wait_rounds = 14 if is_private else 7
        has_dialog = False
        dialog_info: dict[str, Any] = {}
        for _ in range(wait_rounds):
            human_sleep(0.7, 1.0)
            try:
                dialog_info = driver.execute_script(CHECK_GROUP_QUESTIONS_DIALOG_JS) or {}
                if dialog_info.get("hasDialog") or dialog_info.get("hasFields"):
                    has_dialog = True
                    break
            except Exception:
                pass

        if not has_dialog:
            _append_log(job_id, f"ℹ️ «{name}»: Không có popup — sang nhóm tiếp theo.", "info")
            return "pending" if is_private else "joined"

        _append_log(
            job_id,
            (
                f"📝 «{name}»: Popup hiện "
                f"(text={dialog_info.get('textareaCount', 0)}, "
                f"checkbox={dialog_info.get('checkboxCount', 0)}). "
                f"Nhập text (nếu có) → tích agree-to-group-rules → Submit."
            ),
            "info",
        )
        human_sleep(0.8, 1.2)

        # 1) Có ô text thì nhập
        text_filled = 0
        for _ in range(3):
            sel = _fill_membership_fields_selenium(driver, job_id, name)
            js = driver.execute_script(ANSWER_GROUP_QUESTIONS_JS) or {}
            text_filled = max(int(sel.get("textarea") or 0), int(js.get("answeredCount") or 0))
            if text_filled > 0 or int(dialog_info.get("textareaCount") or 0) == 0:
                break
            human_sleep(0.7, 1.0)
        if text_filled:
            _append_log(job_id, f"⌨️ «{name}»: Đã nhập {text_filled} ô text.", "info")
        elif int(dialog_info.get("textareaCount") or 0) > 0:
            _append_log(job_id, f"⚠️ «{name}»: Có ô text nhưng chưa nhập được — vẫn thử tích rules + Submit.", "warn")

        # 2) Tích agree-to-group-rules (bắt buộc theo popup FB)
        agreed = False
        for _ in range(4):
            agreed = _tick_agree_to_group_rules(driver, job_id, name)
            if agreed:
                break
            # fallback: JS tick mọi checkbox hợp lệ trong dialog
            driver.execute_script(ANSWER_GROUP_QUESTIONS_JS)
            human_sleep(0.45, 0.7)
        if not agreed:
            _append_log(job_id, f"⚠️ «{name}»: Chưa thấy/tick được agree-to-group-rules.", "warn")

        human_sleep(0.5, 0.8)

        # 3) Bấm Submit — lặp đến khi bấm được hoặc dialog đóng
        sub_res: dict[str, Any] = {"clicked": False}
        for attempt in range(16):
            human_sleep(0.35, 0.55)
            try:
                driver.execute_script(ENSURE_SEARCH_FILTERS_OFF_JS)
            except Exception:
                pass
            if attempt in {2, 5, 8, 11}:
                if int(dialog_info.get("textareaCount") or 0) > 0:
                    _fill_membership_fields_selenium(driver, job_id, name)
                _tick_agree_to_group_rules(driver, job_id, name)
            sub_res = _click_submit_span(driver, job_id, name)
            if sub_res.get("clicked"):
                break
            # Submit chưa hiện/enable → tick rules lại
            _tick_agree_to_group_rules(driver, job_id, name)

        if sub_res.get("clicked"):
            _append_log(job_id, f"⏳ «{name}»: Đã Submit — chờ popup đóng rồi mới join nhóm khác.", "info")
        else:
            _append_log(job_id, f"⚠️ «{name}»: Chưa bấm được Submit.", "warn")

        closed = _wait_membership_dialog_closed(driver, timeout_s=14.0 if is_private else 8.0)
        if not closed:
            _tick_agree_to_group_rules(driver, job_id, name)
            _fill_membership_fields_selenium(driver, job_id, name)
            more = _click_submit_span(driver, job_id, name)
            if more.get("clicked"):
                sub_res = more
            closed = _wait_membership_dialog_closed(driver, timeout_s=8.0)

        if closed:
            _append_log(job_id, f"➡️ «{name}»: Popup xong — sang nhóm tiếp theo.", "info")
        else:
            _append_log(job_id, f"⚠️ «{name}»: Popup còn mở — Escape rồi sang nhóm khác.", "warn")
            try:
                from selenium.webdriver.common.keys import Keys

                driver.find_element("tag name", "body").send_keys(Keys.ESCAPE)
                human_sleep(0.5, 0.9)
            except Exception:
                pass

        return "pending"

    except Exception as exc:
        _append_log(job_id, f"⚠️ Xử lý tham gia nhóm «{name}» gặp sự cố: {exc}", "warn")
        return item.get("note") or "—"


def _pending_key(owner: Optional[str], uid: str) -> str:
    return f"{owner or ''}::{uid}"


def _clamp_limit(value: Any, default: int = DEFAULT_MAX_GROUPS) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(1, min(HARD_MAX_GROUPS, n))


def _normalize_keywords(items: list[Any]) -> list[dict[str, Any]]:
    """Chuẩn hoá [{keyword, limit}] — bỏ trùng không phân biệt hoa/thường."""
    from modules.module_10_group_scan.models import normalize_keyword

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items or []:
        if isinstance(item, str):
            word = item.strip()
            limit = DEFAULT_MAX_GROUPS
        elif isinstance(item, dict):
            word = str(item.get("keyword") or item.get("word") or "").strip()
            limit = _clamp_limit(item.get("limit"), DEFAULT_MAX_GROUPS)
        else:
            continue
        key = normalize_keyword(word)
        if not key or key in seen:
            continue
        seen.add(key)
        # Giữ nguyên chữ user gõ để search FB; DB sẽ lưu dạng chuẩn
        out.append({"keyword": re.sub(r"\s+", " ", word).strip(), "limit": limit})
    return out


def _job_snapshot(job_id: str) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        stats = dict(job.get("keyword_stats") or {})
        return {
            "job_id": job_id,
            "uid": job.get("uid"),
            "keyword": job.get("keyword"),
            "keywords": list(job.get("keywords") or []),
            "keyword_stats": stats,
            "status": job.get("status"),
            "error": job.get("error") or "",
            "logs": list(job.get("logs") or []),
            "groups": list(job.get("groups") or []),
            "count": len(job.get("groups") or []),
            "delay_min": job.get("delay_min"),
            "delay_max": job.get("delay_max"),
            "control": job.get("control") or "run",
        }


def get_check_status(job_id: Optional[str] = None, uid: Optional[str] = None) -> Optional[dict[str, Any]]:
    if job_id:
        return _job_snapshot(job_id)
    uid = str(uid or "").strip()
    if not uid:
        return None
    with _jobs_lock:
        matches = [jid for jid, job in _jobs.items() if str(job.get("uid")) == uid]
        if not matches:
            return None
        matches.sort(key=lambda jid: _jobs[jid].get("started_at") or 0, reverse=True)
        return _job_snapshot(matches[0])


def _append_log(job_id: str, text: str, tone: str = "info") -> None:
    line = {
        "time": time.strftime("%H:%M:%S"),
        "thread": "Thread-01",
        "text": text,
        "tone": tone,
    }
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        logs = job.setdefault("logs", [])
        logs.append(line)
        if len(logs) > 200:
            del logs[:-200]
    try:
        from modules.module_02_account_manager.services.events import broadcast

        level = "success" if tone == "success" else "warning" if tone == "warn" else "error" if tone == "error" else "info"
        broadcast(level, text, uid=_jobs.get(job_id, {}).get("uid"))
    except Exception:
        pass



def _set_job(job_id: str, **fields) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(fields)


def _update_keyword_stat(job_id: str, keyword: str, **fields) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        stats = job.setdefault("keyword_stats", {})
        row = dict(stats.get(keyword) or {})
        row.update(fields)
        stats[keyword] = row
        if fields.get("status") == "running":
            job["keyword"] = keyword


def _latest_job_for_uid(uid: str) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        matches = [job for job in _jobs.values() if str(job.get("uid")) == uid]
        if not matches:
            return None
        matches.sort(key=lambda job: job.get("started_at") or 0, reverse=True)
        return matches[0]


def _release_pending(key: str, job_id: Optional[str] = None) -> None:
    with _pending_lock:
        info = _pending.get(key)
        if info is None:
            return
        if job_id is not None and info.get("job_id") and info.get("job_id") != job_id:
            return
        _pending.pop(key, None)


def _get_control(job_id: str) -> str:
    with _jobs_lock:
        job = _jobs.get(job_id) or {}
        return str(job.get("control") or "run")


def set_job_control(job_id: str, action: str) -> dict[str, Any]:
    """
    pause  = tạm dừng sau khi xong từ khóa hiện tại
    resume = tiếp tục (nếu đang paused — chưa support resume mid-job; chỉ clear flag)
    abort  = dừng khẩn cấp ngay
    """
    action = str(action or "").strip().lower()
    if action not in {"pause", "resume", "abort"}:
        raise ValueError("action phải là pause | resume | abort")
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise ValueError("Không tìm thấy job")
        if action == "pause":
            job["control"] = "pause_after"
            msg = "Sẽ tạm dừng sau khi xong từ khóa hiện tại."
        elif action == "abort":
            job["control"] = "abort"
            msg = "Đang dừng khẩn cấp…"
        else:
            job["control"] = "run"
            msg = "Đã bỏ tạm dừng."
        return {"job_id": job_id, "control": job["control"], "status": job.get("status"), "message": msg}


def clear_pending_for_uid(*, owner: Optional[str], uid: str, reason: str = "force") -> bool:
    """Gỡ khóa Kiểm tra bị kẹt (tắt browser / mất kết nối)."""
    uid = str(uid or "").strip()
    if not uid:
        return False
    key = _pending_key(owner, uid)
    released = False
    with _pending_lock:
        if key in _pending:
            _pending.pop(key, None)
            released = True
    job = _latest_job_for_uid(uid)
    if job and job.get("status") == "running":
        job_id = None
        with _jobs_lock:
            for jid, item in _jobs.items():
                if item is job:
                    job_id = jid
                    break
            job["status"] = "error"
            job["error"] = f"Đã hủy job cũ ({reason})"
        if job_id:
            _append_log(job_id, f"⏹️ Đã hủy job Kiểm tra cũ ({reason}). Có thể chạy lại.", "warn")
    return released


def start_keyword_check(
    *,
    owner: Optional[str],
    uid: str,
    keywords: list[Any],
    delay_min: float = 5.0,
    delay_max: float = 10.0,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    force: bool = True,
    auto_join: bool = True,
    uids: Optional[list[str]] = None,
    rotate_after: int = 50,
) -> dict:
    valid_uids = [str(u).strip() for u in (uids or []) if str(u).strip()]
    if not valid_uids and uid:
        valid_uids = [str(uid).strip()]
    elif valid_uids and not uid:
        uid = valid_uids[0]

    uid = str(uid or "").strip()
    items = _normalize_keywords(keywords)
    if not uid:
        raise ValueError("Thiếu UID tài khoản")
    if not items:
        raise ValueError("Thiếu từ khóa")

    try:
        dmin = max(0.0, float(delay_min))
    except (TypeError, ValueError):
        dmin = 5.0
    try:
        dmax = max(dmin, float(delay_max))
    except (TypeError, ValueError):
        dmax = max(dmin, 10.0)

    public_only = bool(public_only)
    private_only = bool(private_only)
    # Cả hai True = nhận Public + Private (tắt lọc loại)
    if public_only and private_only:
        public_only = False
        private_only = False
    if min_members is not None:
        try:
            min_members = max(0, int(min_members))
        except (TypeError, ValueError):
            min_members = None
        if min_members == 0:
            min_members = None

    key = _pending_key(owner, uid)
    with _pending_lock:
        info = _pending.get(key)
        if info is not None:
            age = time.time() - float(info.get("started_at") or 0)
            old_job_id = info.get("job_id")
            old_status = None
            if old_job_id:
                with _jobs_lock:
                    old_status = (_jobs.get(old_job_id) or {}).get("status")

            stale = age >= STALE_PENDING_SEC
            finished = old_status in {"done", "error"}
            if force or stale or finished or old_status is None:
                _pending.pop(key, None)
                if old_job_id and not finished:
                    with _jobs_lock:
                        old = _jobs.get(old_job_id)
                        if old and old.get("status") == "running":
                            old["status"] = "error"
                            old["error"] = "Job bị thay bằng lần Kiểm tra mới (browser cũ có thể đã tắt)"
                    _append_log(
                        old_job_id,
                        "⏹️ Job cũ bị thay — browser đã tắt / mất kết nối / bấm Kiểm tra lại.",
                        "warn",
                    )
            else:
                raise RuntimeError("Nick đang chạy Kiểm tra — chờ xong rồi thử lại (hoặc đợi ~45s)")

        job_id = uuid.uuid4().hex[:12]
        _pending[key] = {"started_at": time.time(), "job_id": job_id, "uid": uid}

    keyword_stats = {
        item["keyword"]: {"count": 0, "status": "idle", "limit": item["limit"]}
        for item in items
    }
    with _jobs_lock:
        _jobs[job_id] = {
            "uid": uid,
            "uids": valid_uids,
            "rotate_after": rotate_after,
            "keyword": items[0]["keyword"],
            "keywords": [item["keyword"] for item in items],
            "keyword_stats": keyword_stats,
            "owner": owner,
            "status": "running",
            "error": "",
            "logs": [],
            "groups": [],
            "delay_min": dmin,
            "delay_max": dmax,
            "public_only": public_only,
            "private_only": private_only,
            "min_members": min_members,
            "auto_join": auto_join,
            "control": "run",
            "started_at": time.time(),
        }

    # Đảm bảo mỗi từ khóa tạo thành 1 DANH MỤC trong bảng scanned_group_categories ngay khi bắt đầu
    # CHỈ tạo danh mục cho TỪ KHÓA thực sự, KHÔNG tạo danh mục khi là link URL (Nhập link / Tải tệp)
    try:
        from modules.module_10_group_scan.models import create_scan_category
        for item in items:
            kw = str(item.get("keyword") or "").strip()
            is_url = kw.startswith("http") or "/groups/" in kw or "facebook.com" in kw or "fb.com" in kw
            if kw and not is_url:
                create_scan_category(owner, kw, f"Danh mục từ khóa: {kw}")
    except Exception as exc:
        logger.debug(f"auto create_scan_category in check error: {exc}")

    try:
        from modules.module_10_group_scan.models import create_scan_session
        import json
        words_str = ", ".join(item["keyword"] for item in items)
        cfg_str = json.dumps({
            "delay": f"{dmin:.0f} - {dmax:.0f}s",
            "privacy": "Công khai" if public_only else "Riêng tư" if private_only else "Tất cả",
            "minMembers": f"{min_members:,} TV" if min_members else "—",
            "maxKeywords": len(items),
        }, ensure_ascii=False)
        create_scan_session(
            owner=owner,
            session_id=job_id,
            scan_type="GROUP_INFO",
            title=f"Quét thông tin nhóm theo từ khóa «{words_str[:80]}»",
            target=words_str,
            target_type="keywords",
            source_uid=uid,
            account_name=f"Nick {uid}",
            target_count=sum(item["limit"] for item in items),
            config=cfg_str,
        )
    except Exception as exc:
        logger.debug(f"create_scan_session error: {exc}")

    thread = threading.Thread(
        target=_run_check,
        args=(owner, uid, items, dmin, dmax, public_only, private_only, min_members, key, job_id, auto_join, valid_uids, rotate_after),
        daemon=True,
        name=f"group-scan-check-{uid}",
    )
    thread.start()
    return {
        "started": True,
        "scan_version": 2,
        "uid": uid,
        "keyword": items[0]["keyword"],
        "keywords": [item["keyword"] for item in items],
        "keyword_limits": {item["keyword"]: item["limit"] for item in items},
        "job_id": job_id,
        "delay_min": dmin,
        "delay_max": dmax,
        "public_only": public_only,
        "private_only": private_only,
        "min_members": min_members,
        "auto_join": auto_join,
        "max_groups": items[0]["limit"],
    }


def _run_check(
    owner: Optional[str],
    uid: str,
    items: list[dict[str, Any]],
    delay_min: float,
    delay_max: float,
    public_only: bool,
    private_only: bool,
    min_members: Optional[int],
    key: str,
    job_id: str,
    auto_join: bool = True,
    uids: Optional[list[str]] = None,
    rotate_after: int = 50,
) -> None:
    from modules.module_02_account_manager.context import owner_scope

    try:
        with owner_scope(owner):
            _check_keywords_on_account(
                uid, items, delay_min, delay_max, job_id,
                owner=owner,
                public_only=public_only,
                private_only=private_only,
                min_members=min_members,
                auto_join=auto_join,
                uids=uids,
                rotate_after=rotate_after,
            )
    except Exception as exc:
        msg = str(exc)
        soft = any(
            token in msg
            for token in (
                "InvalidSessionId",
                "invalid session",
                "chrome not reachable",
                "disconnected",
                "no such window",
                "target window already closed",
            )
        )
        if soft:
            logger.warning("[%s] Browser đã đóng giữa Kiểm tra: %s", uid, exc)
            _append_log(job_id, "⏹️ Browser đã tắt / mất kết nối — dừng job. Bấm Kiểm tra lại được ngay.", "warn")
            _set_job(job_id, status="error", error="Browser đã tắt hoặc mất kết nối")
        else:
            logger.exception("[%s] Lỗi Kiểm tra từ khóa", uid)
            _append_log(job_id, f"❌ Lỗi Kiểm tra: {exc}", "error")
            _set_job(job_id, status="error", error=str(exc))
    finally:
        _release_pending(key, job_id=job_id)
        with _jobs_lock:
            job = _jobs.get(job_id)
            # Không ghi đè paused / aborted / error đã set trong vòng lặp
            if job and job.get("status") == "running":
                job["status"] = "done"
        try:
            from modules.module_10_group_scan.models import update_scan_session
            st = "SUCCESS" if (job and job.get("status") in {"done", "running"}) else "FAILED"
            update_scan_session(job_id, status=st, finished=True)
        except Exception:
            pass


def _normalize_group_url(href: str) -> str:
    raw = (href or "").strip()
    if not raw:
        return ""
    if raw.startswith("/"):
        raw = "https://www.facebook.com" + raw
    try:
        parsed = urlparse(raw)
        path = re.sub(r"/+$", "", parsed.path or "")
        return urlunparse(("https", "www.facebook.com", path, "", "", ""))
    except Exception:
        return raw.split("?")[0].rstrip("/")


def _is_group_profile_url(url: str) -> bool:
    if "/groups/" not in url:
        return False
    bad = (
        "/search/",
        "/groups/search",
        "/permalink/",
        "/posts/",
        "/members/",
        "/files/",
        "/media/",
        "/about/",
        "/events/",
        "/feed/",
        "/discover/",
        "/joins/",
        "/create",
        "/user/",
    )
    if any(part in url for part in bad):
        return False
    slug = url.split("/groups/")[-1].split("/")[0].strip().lower()
    if not slug or slug in {"search", "feed", "discover", "create", "joins", "notifications"}:
        return False
    return True


def _parse_member_count(raw: Any) -> Optional[int]:
    """'463K' / '26K members' / '1.2M' / '1.234 thành viên' → int."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return int(raw)
    text = str(raw).strip()
    if not text or text == "—":
        return None
    m = re.search(
        r"([\d.,]+)\s*([KkMmBb])?\s*(?:members?|thành viên|thanh vien)?",
        text,
        re.I,
    )
    if not m:
        digits = re.sub(r"[^\d]", "", text)
        return int(digits) if digits else None
    num_s = m.group(1).replace(",", "").replace(" ", "")
    # EU style 1.234.567 or 1,2
    if num_s.count(".") > 1:
        num_s = num_s.replace(".", "")
    elif num_s.count(",") > 1:
        num_s = num_s.replace(",", "")
    elif "," in num_s and "." not in num_s:
        # 1,2 → 1.2 (thập phân) hoặc 1,234 → bỏ phẩy nghìn
        parts = num_s.split(",")
        num_s = parts[0] + "." + parts[1] if len(parts) == 2 and len(parts[1]) <= 2 else num_s.replace(",", "")
    try:
        value = float(num_s)
    except ValueError:
        return None
    suffix = (m.group(2) or "").upper()
    mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(suffix, 1)
    return int(value * mult)


def _parse_group_meta(meta: str) -> dict[str, Any]:
    """
    'Public · 463K members · 90+ posts a day'
    'Công khai · 26N thành viên · …'
    → type public|private|unknown, members_label, members_count
    """
    text = re.sub(r"\s+", " ", (meta or "").strip())
    privacy = "unknown"
    low = text.lower()
    if re.search(r"\bpublic\b|công khai|cong khai", low):
        privacy = "public"
    elif re.search(r"\bprivate\b|riêng tư|rieng tu|bí mật|bi mat", low):
        privacy = "private"

    members_label = "—"
    members_count: Optional[int] = None
    m = re.search(
        r"([\d.,]+\s*[KkMmBb]?)\s*(?:members?|thành viên|thanh vien)",
        text,
        re.I,
    )
    if m:
        members_label = m.group(0).strip()
        members_count = _parse_member_count(m.group(1))
    else:
        # Fallback: đoạn giữa dấu ·
        parts = [p.strip() for p in re.split(r"[·•|]", text) if p.strip()]
        for part in parts[1:] if len(parts) > 1 else parts:
            cnt = _parse_member_count(part)
            if cnt is not None:
                members_label = part
                members_count = cnt
                break

    return {
        "type": privacy,
        "members": members_label,
        "members_count": members_count,
        "meta": text,
    }


def _passes_filters(
    meta: dict[str, Any],
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
) -> tuple[bool, str]:
    privacy = meta.get("type") or "unknown"
    if public_only and privacy != "public":
        return False, f"bỏ (không public: {privacy})"
    if private_only and privacy != "private":
        return False, f"bỏ (không private: {privacy})"
    if min_members is not None and min_members > 0:
        count = meta.get("members_count")
        if count is None:
            return False, "bỏ (không đọc được số thành viên)"
        if count < min_members:
            return False, f"bỏ ({count} < {min_members} thành viên)"
    return True, ""


def _clean_group_name(raw: str, url: str = "") -> str:
    name = re.sub(r"\s+", " ", str(raw or "").strip())
    name = name.split("\n")[0].strip()
    name = re.sub(
        r"^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\s*",
        "",
        name,
        flags=re.I,
    ).strip()
    if not name or re.match(r"^(join|tham gia|joined)$", name, re.I):
        slug = ""
        if "/groups/" in (url or ""):
            slug = url.split("/groups/")[-1].split("/")[0].strip()
        name = slug or "—"
    return name


def _format_members_label(meta: dict[str, Any]) -> str:
    """Ưu tiên nhãn '463K', fallback số đầy đủ."""
    label = str(meta.get("members") or "").strip()
    if label and label != "—":
        # Rút gọn "463K members" → "463K"
        m = re.match(r"([\d.,]+\s*[KkMmBb]?)", label)
        if m:
            return m.group(1).replace(" ", "")
        return label
    count = meta.get("members_count")
    if isinstance(count, int) and count >= 0:
        if count >= 1_000_000:
            v = count / 1_000_000
            return f"{v:.1f}".rstrip("0").rstrip(".") + "M"
        if count >= 1_000:
            v = count / 1_000
            return f"{v:.1f}".rstrip("0").rstrip(".") + "K"
        return str(count)
    return "—"


def _click_groups_tab(driver, wait_and_find, human_sleep) -> bool:
    from selenium.webdriver.common.by import By

    human_sleep(1.5, 2.5)
    try:
        el = wait_and_find(driver, GROUPS_TAB_LOCATORS, timeout=18)
    except Exception:
        return False

    targets = [el]
    try:
        parent = el.find_element(By.XPATH, "./ancestor::*[@role='link' or @role='button' or @role='listitem'][1]")
        targets.insert(0, parent)
    except Exception:
        pass

    for target in targets:
        try:
            target.click()
            human_sleep(1.5, 2.5)
            return True
        except Exception:
            try:
                driver.execute_script("arguments[0].click();", target)
                human_sleep(1.5, 2.5)
                return True
            except Exception:
                continue
    return False


def _scrape_group_direct(
    driver,
    target_url: str,
    job_id: str,
    human_sleep,
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    owner: Optional[str] = None,
    source_uid: Optional[str] = None,
    known_group_ids: Optional[set[str]] = None,
    auto_join: bool = True,
) -> Optional[dict[str, Any]]:
    """Quét trực tiếp thông tin nhóm khi người dùng cung cấp link / file link."""
    from modules.module_10_group_scan.models import (
        normalize_group_id,
        upsert_scanned_group,
    )

    clean_url = _normalize_group_url(target_url)
    if not clean_url:
        clean_url = target_url
    gid = normalize_group_id(clean_url)
    if known_group_ids and gid and gid in known_group_ids:
        _append_log(job_id, f"⏭️ Bỏ trùng DB: {clean_url}", "info")
        return None

    try:
        driver.get(clean_url)
        human_sleep(2.5, 4.0)
    except Exception as exc:
        _append_log(job_id, f"⚠️ Không tải được link {clean_url}: {exc}", "warn")
        return None

    js = """
    const res = {
        title: document.title || '',
        h1: document.querySelector('h1')?.innerText || '',
        subTitle: '',
    };
    const h1 = document.querySelector('h1');
    if (h1) {
        let parent = h1.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
            const text = (parent.innerText || '').replace(/\\s+/g, ' ');
            const m = text.match(/(Public group|Private group|Nhóm công khai|Nhóm riêng tư|Bí mật)[^\\n·•]*[·•\\s]*([\\d.,]+[KkMmBb]?\\s*(members|thành viên))/i);
            if (m) {
                res.subTitle = m[0];
                break;
            }
            parent = parent.parentElement;
        }
    }
    if (!res.subTitle) {
        const bodyText = (document.body.innerText || '').replace(/\\s+/g, ' ');
        const m = bodyText.match(/(Public group|Private group|Nhóm công khai|Nhóm riêng tư|Bí mật)[·•\\s]*([\\d.,]+[KkMmBb]?\\s*(members|thành viên))/i);
        if (m) res.subTitle = m[0];
    }
    return res;
    """
    try:
        data = driver.execute_script(js) or {}
    except Exception as exc:
        _append_log(job_id, f"⚠️ Lỗi đọc DOM trang nhóm: {exc}", "warn")
        data = {}

    raw_title = data.get("title") or ""
    cleaned_name = re.sub(r"^\(\d+\)\s*", "", raw_title)
    cleaned_name = re.sub(r"\s*\|\s*Facebook$", "", cleaned_name).strip()
    if not cleaned_name:
        cleaned_name = data.get("h1") or "Nhóm Facebook"
    if cleaned_name.lower() in {"notifications", "facebook", "search"}:
        cleaned_name = clean_url.split("/groups/")[-1].replace("/", "")

    sub_title = data.get("subTitle") or ""
    meta_info = _parse_group_meta(sub_title)
    ok, reason = _passes_filters(
        meta_info,
        public_only=public_only,
        private_only=private_only,
        min_members=min_members,
    )
    if not ok:
        _append_log(job_id, f"⏭️ {cleaned_name}: {reason} ({sub_title})", "info")
        return None

    members_label = _format_members_label(meta_info)
    privacy = meta_info.get("type") or "unknown"
    note = "not_joined" if privacy == "private" else "—"
    item = {
        "id": clean_url,
        "keyword": clean_url,
        "name": cleaned_name,
        "url": clean_url.replace("https://www.", "").replace("https://", ""),
        "href": clean_url,
        "type": privacy,
        "members": members_label,
        "members_count": meta_info.get("members_count"),
        "note": note,
    }

    if auto_join:
        join_note = _auto_join_group(driver, item, job_id=job_id)
        if join_note:
            item["note"] = join_note

    try:
        upsert_scanned_group(owner=owner, keyword="DirectLink", group=item, source_uid=source_uid)
        if gid and known_group_ids is not None:
            known_group_ids.add(gid)
    except Exception as exc:
        _append_log(job_id, f"⚠️ Lỗi lưu nhóm vào DB: {exc}", "warn")

    _append_log(job_id, f"✅ Đã quét: {cleaned_name} ({privacy.upper()} · {members_label})", "success")
    return item


def _scrape_groups_from_results(
    driver,
    keyword: str,
    job_id: str,
    human_sleep,
    max_groups: int,
    already: Optional[list[dict[str, Any]]] = None,
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    owner: Optional[str] = None,
    source_uid: Optional[str] = None,
    known_group_ids: Optional[set[str]] = None,
    auto_join: bool = True,
) -> list[dict[str, Any]]:
    from selenium.webdriver.common.by import By

    from modules.module_10_group_scan.models import (
        normalize_group_id,
        upsert_scanned_group,
    )

    found: list[dict[str, Any]] = []
    seen: set[str] = {str(g.get("href") or g.get("id") or "") for g in (already or [])}
    known = set(known_group_ids or set())
    limit = _clamp_limit(max_groups)
    # Có lọc / bỏ trùng DB → cuộn nhiều hơn
    max_rounds = 16 if (public_only or private_only or (min_members and min_members > 0) or known) else 8
    skipped = 0
    skipped_dup = 0

    def _aborted() -> bool:
        return _get_control(job_id) == "abort"

    # Đọc meta: "Public · 463K members · 90+ posts a day" — gom theo URL, bỏ "Profile photo of"
    js = """
    const root =
      document.querySelector('[aria-label="Search results"][role="main"]') ||
      document.querySelector('[aria-label="Search results"]') ||
      document.querySelector('[role="main"]');
    if (!root) return [];
    const byHref = new Map();
    const metaRe = /(Public|Private|Công khai|Cong khai|Riêng tư|Rieng tu|Bí mật)\\s*[·•|]\\s*[\\d.,]+\\s*[KkMmBb]?\\s*(members?|thành viên|thanh vien)/i;
    const softMetaRe = /[\\d.,]+\\s*[KkMmBb]?\\s*(members?|thành viên|thanh vien)/i;

    const cleanName = (raw) => {
      let n = (raw || '').replace(/\\s+/g, ' ').trim();
      n = n.split('\\n')[0].trim();
      n = n.replace(/^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\\s*/i, '');
      if (!n || /^(join|tham gia|joined|đang chờ)$/i.test(n)) return '';
      return n;
    };

    const findMeta = (el) => {
      let node = el;
      for (let depth = 0; depth < 12 && node && node !== root; depth++) {
        const spans = node.querySelectorAll ? node.querySelectorAll('span') : [];
        for (const sp of spans) {
          const t = (sp.innerText || sp.textContent || '').replace(/\\s+/g, ' ').trim();
          if (t.length < 6 || t.length > 180) continue;
          if (metaRe.test(t) || softMetaRe.test(t)) return t;
        }
        // Cả block text của card
        const block = (node.innerText || '').replace(/\\s+/g, ' ').trim();
        const m = block.match(metaRe) || block.match(/((?:Public|Private|Công khai)[^\\n]{0,100}?(?:members?|thành viên))/i);
        if (m) return m[0].trim();
        node = node.parentElement;
      }
      return '';
    };

    const anchors = root.querySelectorAll('a[href*="/groups/"]');
    for (const a of anchors) {
      let href = a.getAttribute('href') || a.href || '';
      if (!href.includes('/groups/')) continue;
      if (href.includes('notif_id') || href.includes('/search/') || href.includes('ref=notif')) continue;
      try {
        const u = new URL(href, location.origin);
        href = u.origin + u.pathname.replace(/\\/+$/, '');
      } catch (e) {
        href = href.split('?')[0].replace(/\\/+$/, '');
      }
      let name = cleanName(a.getAttribute('aria-label') || '');
      if (!name) name = cleanName(a.innerText || a.textContent || '');
      const meta = findMeta(a);
      const prev = byHref.get(href) || { href, name: '', meta: '' };
      // Ưu tiên tên thật (không rỗng), meta có members
      if (name && (!prev.name || prev.name.length < name.length)) prev.name = name;
      if (meta && (!prev.meta || meta.length > prev.meta.length)) prev.meta = meta;
      byHref.set(href, prev);
    }
    return Array.from(byHref.values());
    """

    for round_idx in range(max_rounds):
        if _aborted():
            _append_log(job_id, f"🛑 Dừng khẩn cấp giữa lúc quét «{keyword}».", "warn")
            break
        if len(found) >= limit:
            break
        try:
            rows = driver.execute_script(js) or []
        except Exception as exc:
            _append_log(job_id, f"⚠️ Lỗi đọc DOM kết quả: {exc}", "warn")
            rows = []

        for row in rows:
            if _aborted():
                break
            url = _normalize_group_url(row.get("href") or "")
            if not _is_group_profile_url(url) or url in seen:
                continue
            seen.add(url)

            gid = normalize_group_id(url)
            if gid and gid in known:
                skipped_dup += 1
                if skipped_dup <= 5 or skipped_dup % 15 == 0:
                    _append_log(
                        job_id,
                        f"⏭️ «{keyword}» bỏ trùng DB: {gid}",
                        "info",
                    )
                continue

            meta_info = _parse_group_meta(row.get("meta") or "")
            ok, reason = _passes_filters(
                meta_info,
                public_only=public_only,
                private_only=private_only,
                min_members=min_members,
            )
            name = _clean_group_name(row.get("name") or "", url)
            if not ok:
                skipped += 1
                if skipped <= 8 or skipped % 10 == 0:
                    _append_log(
                        job_id,
                        f"⏭️ «{keyword}» {name}: {reason}"
                        + (f" — {meta_info.get('meta')}" if meta_info.get("meta") else ""),
                        "info",
                    )
                continue

            members_label = _format_members_label(meta_info)
            privacy = meta_info.get("type") or "unknown"
            # Private chưa join → ghi chú; Public không cần ghi chú đặc biệt
            note = "not_joined" if privacy == "private" else "—"
            item = {
                "id": url,
                "keyword": keyword,
                "name": name,
                "url": url.replace("https://www.", "").replace("https://", ""),
                "href": url,
                "type": privacy,
                "members": members_label,
                "members_count": meta_info.get("members_count"),
                "note": note,
            }

            # Tự động tham gia nhóm và trả lời câu hỏi nếu được kích hoạt
            if auto_join:
                join_note = _auto_join_group(driver, item, job_id=job_id)
                if join_note:
                    item["note"] = join_note

            # Lưu Supabase ngay — tránh mất khi tắt browser
            try:
                is_new = upsert_scanned_group(
                    owner=owner,
                    keyword=keyword,
                    group=item,
                    source_uid=source_uid,
                )
                if gid:
                    known.add(gid)
                if not is_new:
                    skipped_dup += 1
                    _append_log(job_id, f"⏭️ «{keyword}» đã có trong DB: {name}", "info")
                    continue
            except Exception as exc:
                _append_log(job_id, f"⚠️ Lưu DB lỗi ({name}): {exc}", "warn")

            found.append(item)
            mem = members_label or "?"
            _append_log(
                job_id,
                f"➕ [{len(found)}/{limit}] «{keyword}» {name} · {meta_info.get('type')} · {mem} — {url}",
                "success",
            )
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job is not None:
                    job["groups"] = list(already or []) + list(found)
            try:
                from modules.module_10_group_scan.models import update_scan_session
                update_scan_session(job_id, total_found=len(already or []) + len(found))
            except Exception:
                pass
            _update_keyword_stat(job_id, keyword, count=len(found), status="running")
            if len(found) >= limit:
                break

        if len(found) >= limit:
            break

        try:
            roots = []
            for xpath in RESULTS_ROOT_LOCATORS:
                roots.extend(driver.find_elements(By.XPATH, xpath))
            root = next((el for el in roots if el.is_displayed()), None)
            if root is not None:
                driver.execute_script(
                    "arguments[0].scrollTop = arguments[0].scrollHeight; window.scrollBy(0, 900);",
                    root,
                )
            else:
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        except Exception:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        human_sleep(1.2, 2.0)
        _append_log(
            job_id,
            f"… «{keyword}» cuộn thêm (lần {round_idx + 1}), giữ {len(found)}/{limit}"
            + (f", bỏ {skipped}" if skipped else "")
            + ".",
            "info",
        )

    if skipped or skipped_dup:
        _append_log(
            job_id,
            f"ℹ️ «{keyword}» bỏ lọc={skipped}, bỏ trùng DB={skipped_dup}.",
            "info",
        )
    return found[:limit]


def _clear_search_input(driver, search_el) -> None:
    from selenium.webdriver.common.keys import Keys

    try:
        search_el.click()
    except Exception:
        try:
            driver.execute_script("arguments[0].click();", search_el)
        except Exception:
            pass
    try:
        search_el.clear()
    except Exception:
        pass
    try:
        search_el.send_keys(Keys.CONTROL, "a")
        search_el.send_keys(Keys.BACKSPACE)
    except Exception:
        pass
    try:
        driver.execute_script(
            "arguments[0].value='';"
            "arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            search_el,
        )
    except Exception:
        pass


def _search_and_open_groups(
    driver,
    keyword: str,
    job_id: str,
    wait_and_find,
    human_sleep,
    human_type,
    *,
    reset_home: bool = False,
) -> None:
    """Gõ từ khóa vào ô Search Facebook → Enter → tab Groups. reset_home=True khi chuyển từ khóa."""
    from selenium.webdriver.common.keys import Keys

    if reset_home:
        _append_log(job_id, f"🔄 Về trang chủ rồi mở lại ô tìm kiếm cho «{keyword}»…", "info")
        try:
            driver.get("https://www.facebook.com/")
            human_sleep(2.0, 3.0)
        except Exception as exc:
            _append_log(job_id, f"⚠️ Không về được trang chủ: {exc}", "warn")

    typed = False
    try:
        search_el = wait_and_find(driver, SEARCH_INPUT_LOCATORS, timeout=20)
        _clear_search_input(driver, search_el)
        human_sleep(0.25, 0.45)
        # Lấy lại ô search sau khi clear (FB hay re-render)
        try:
            search_el = wait_and_find(driver, SEARCH_INPUT_LOCATORS, timeout=8)
        except Exception:
            pass
        human_type(search_el, keyword)
        human_sleep(0.3, 0.6)
        _append_log(job_id, f"✅ Đã gõ «{keyword}» vào ô Search — Enter…", "success")
        search_el.send_keys(Keys.ENTER)
        human_sleep(2.5, 3.5)
        typed = True
    except Exception as exc:
        _append_log(job_id, f"⚠️ Không gõ được ô Search («{keyword}»): {exc}", "warn")

    if not typed:
        url = f"https://www.facebook.com/search/groups/?q={quote(keyword)}"
        _append_log(job_id, f"↪️ Mở thẳng kết quả Groups: {url}", "info")
        driver.get(url)
        human_sleep(2.5, 3.5)
    else:
        _append_log(job_id, f"🔎 «{keyword}» — click tab Groups / Nhóm…", "info")
        clicked = _click_groups_tab(driver, wait_and_find, human_sleep)
        if not clicked:
            url = f"https://www.facebook.com/search/groups/?q={quote(keyword)}"
            _append_log(job_id, f"⚠️ Không click được Groups — mở trực tiếp {url}", "warn")
            driver.get(url)
            human_sleep(2.5, 3.5)
        else:
            _append_log(job_id, f"✅ «{keyword}» đã vào filter Groups.", "success")
            try:
                cur = driver.current_url or ""
                if "/search/groups" not in cur:
                    driver.get(f"https://www.facebook.com/search/groups/?q={quote(keyword)}")
                    human_sleep(2.0, 3.0)
            except Exception:
                pass

    try:
        wait_and_find(driver, RESULTS_ROOT_LOCATORS, timeout=15)
        _append_log(job_id, f"✅ «{keyword}» — thấy Search results, bắt đầu quét…", "success")
    except Exception:
        _append_log(job_id, f"⚠️ «{keyword}» chưa thấy Search results — vẫn thử quét /groups/…", "warn")


def _check_keywords_on_account(
    uid: str,
    items: list[dict[str, Any]],
    delay_min: float,
    delay_max: float,
    job_id: str,
    *,
    owner: Optional[str] = None,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    auto_join: bool = True,
    uids: Optional[list[str]] = None,
    rotate_after: int = 50,
) -> None:
    if not owner:
        with _jobs_lock:
            owner = (_jobs.get(job_id) or {}).get("owner")
    from modules.module_02_account_manager.automation import (
        create_driver,
        ensure_logged_in,
        get_profile_lock,
        human_sleep,
        human_type,
        wait_and_find,
    )
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.security.encryption import decrypt_data

    pool_uids = [str(u).strip() for u in (uids or []) if str(u).strip()]
    if not pool_uids:
        pool_uids = [uid]
    account_idx = pool_uids.index(uid) if uid in pool_uids else 0
    last_switched_count = 0

    try:
        profile_lock = get_profile_lock(uid)
        if not profile_lock.acquire(timeout=8):
            _append_log(job_id, f"⚠️ [{uid}] Profile đang bận — không mở được Chrome.", "warn")
            _set_job(job_id, status="error", error="Profile đang bận")
            return
    except Exception as exc:
        _append_log(job_id, f"❌ [{uid}] Lỗi khóa profile: {exc}", "error")
        _set_job(job_id, status="error", error=str(exc))
        return

    all_groups: list[dict[str, Any]] = []
    try:
        db = SessionLocal()
        try:
            account = Repo.get_by_uid(db, uid, owner_username=owner)
            if not account:
                from modules.module_02_account_manager.database.models import Account
                account = db.query(Account).filter(Account.uid == uid).first()
            if not account:
                _append_log(job_id, f"❌ [{uid}] Không tìm thấy tài khoản Module 2.", "error")
                _set_job(job_id, status="error", error="Không tìm thấy tài khoản")
                return
            cookie = account.cookie or ""
            proxy = account.proxy
            password = decrypt_data(account.password or "")
            two_fa = decrypt_data(account.two_fa or "")
        finally:
            db.close()

        _append_log(job_id, f"🌐 [{uid}] Đang mở Chrome (session Module 2)…", "info")
        driver = create_driver(
            uid,
            headless=False,
            detach=True,
            proxy=proxy,
            scope="group-scan",
            verify_egress=False,
        )

        login = ensure_logged_in(
            driver,
            uid=uid,
            password=password,
            two_fa=two_fa,
            cookie=cookie,
        )
        if not login.get("success"):
            msg = login.get("error") or "Không đăng nhập được Facebook"
            _append_log(job_id, f"❌ [{uid}] {msg}", "error")
            _set_job(job_id, status="error", error=msg)
            return

        from modules.module_10_group_scan.models import list_known_group_ids

        known_ids = list_known_group_ids(owner)
        _append_log(
            job_id,
            f"🗄️ DB: đã có {len(known_ids)} nhóm của owner — sẽ bỏ trùng khi quét.",
            "info",
        )

        filter_bits = []
        if public_only:
            filter_bits.append("chỉ Public")
        if private_only:
            filter_bits.append("chỉ Private")
        if min_members:
            filter_bits.append(f">={min_members} thành viên")
        filter_txt = f", lọc: {', '.join(filter_bits)}" if filter_bits else " (không lọc Public/Private/members)"
        plan = ", ".join(f"«{it['keyword']}»×{it['limit']}" for it in items)
        _append_log(
            job_id,
            f"✅ [{uid}] Session OK [scan-v2]. {len(items)} từ khóa: {plan} "
            f"(delay {delay_min:.0f}–{delay_max:.0f}s){filter_txt}.",
            "success",
        )

        try:
            current = (driver.current_url or "").lower()
        except Exception:
            current = ""
        if "facebook.com" not in current:
            driver.get("https://www.facebook.com/")
            human_sleep(2.0, 3.0)

        for idx, item in enumerate(items):
            if _get_control(job_id) == "abort":
                _append_log(job_id, "🛑 Dừng khẩn cấp — không chạy từ khóa còn lại.", "warn")
                _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                return

            keyword = item["keyword"]
            limit = _clamp_limit(item.get("limit"))
            _update_keyword_stat(job_id, keyword, status="running", count=0, limit=limit)
            _append_log(
                job_id,
                f"▶️ [{idx + 1}/{len(items)}] Quét «{keyword}» — DỪNG KHI ĐỦ {limit} nhóm MỚI (bỏ trùng DB).",
                "info",
            )

            is_direct_url = (
                keyword.startswith("http")
                or "/groups/" in keyword
                or "fb.com/" in keyword
                or "facebook.com/" in keyword
            )

            try:
                if is_direct_url:
                    group_item = _scrape_group_direct(
                        driver,
                        keyword,
                        job_id,
                        human_sleep,
                        public_only=public_only,
                        private_only=private_only,
                        min_members=min_members,
                        owner=owner,
                        source_uid=uid,
                        known_group_ids=known_ids,
                        auto_join=auto_join,
                    )
                    groups = [group_item] if group_item else []
                else:
                    # Từ khóa 2+ → về home rồi vào lại ô Search (không kẹt trang kết quả cũ)
                    _search_and_open_groups(
                        driver,
                        keyword,
                        job_id,
                        wait_and_find,
                        human_sleep,
                        human_type,
                        reset_home=(idx > 0),
                    )
                    if _get_control(job_id) == "abort":
                        _append_log(job_id, "🛑 Dừng khẩn cấp trước khi scrape.", "warn")
                        _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                        return
                    groups = _scrape_groups_from_results(
                        driver,
                        keyword,
                        job_id,
                        human_sleep,
                        max_groups=limit,
                        already=all_groups,
                        public_only=public_only,
                        private_only=private_only,
                        min_members=min_members,
                        owner=owner,
                        source_uid=uid,
                        known_group_ids=known_ids,
                        auto_join=auto_join,
                    )
                from modules.module_10_group_scan.models import normalize_group_id as _ngid

                for g in groups:
                    gid = _ngid(g.get("href") or "")
                    if gid:
                        known_ids.add(gid)
                # Siết cứng hạn mức (phòng DOM trả thừa)
                groups = groups[:limit]
                all_groups.extend(groups)
                _set_job(job_id, groups=list(all_groups))
                if _get_control(job_id) == "abort":
                    _update_keyword_stat(job_id, keyword, count=len(groups), status="done", limit=limit)
                    _append_log(job_id, f"🛑 Dừng khẩn cấp sau «{keyword}» ({len(groups)} nhóm).", "warn")
                    _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                    return
                _update_keyword_stat(job_id, keyword, count=len(groups), status="done", limit=limit)
                _append_log(
                    job_id,
                    f"🏁 Xong «{keyword}»: {len(groups)}/{limit} nhóm.",
                    "success",
                )
            except Exception as exc:
                logger.exception("[%s] keyword «%s» failed", uid, keyword)
                _update_keyword_stat(job_id, keyword, status="error")
                _append_log(job_id, f"❌ «{keyword}» lỗi: {exc}", "error")
                if _get_control(job_id) == "abort":
                    _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                    return
                if idx >= len(items) - 1:
                    raise

            # Tạm dừng: xong từ khóa hiện tại → dừng, không chạy từ khóa tiếp
            if _get_control(job_id) == "pause_after":
                _append_log(
                    job_id,
                    f"⏸️ Tạm dừng sau «{keyword}». Các từ khóa còn lại chờ Bắt đầu lại.",
                    "warn",
                )
                _set_job(job_id, groups=list(all_groups), status="paused", control="pause_after")
                return

            # Xoay vòng tài khoản nếu đạt ngưỡng rotate_after (BR-GIS-01.3 & BR-GIS-05)
            if len(pool_uids) > 1 and (len(all_groups) - last_switched_count) >= rotate_after and idx < len(items) - 1:
                next_idx = (account_idx + 1) % len(pool_uids)
                next_uid = pool_uids[next_idx]
                if next_uid != uid:
                    _append_log(
                        job_id,
                        f"🔄 Đã bóc tách {len(all_groups) - last_switched_count} nhóm (đạt hạn ngạch {rotate_after}). "
                        f"Tiến hành luân chuyển Bot Pool sang nick: UID {next_uid}...",
                        "info",
                    )
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    try:
                        profile_lock.release()
                    except Exception:
                        pass
                    account_idx = next_idx
                    uid = next_uid
                    _set_job(job_id, uid=uid)
                    profile_lock = get_profile_lock(uid)
                    if not profile_lock.acquire(timeout=8):
                        _append_log(job_id, f"⚠️ [{uid}] Profile tài khoản mới đang bận.", "warn")
                    else:
                        db_acc = SessionLocal()
                        try:
                            acc_obj = Repo.get_by_uid(db_acc, uid, owner_username=owner)
                            if not acc_obj:
                                from modules.module_02_account_manager.database.models import Account
                                acc_obj = db_acc.query(Account).filter(Account.uid == uid).first()
                            if acc_obj:
                                acc_cookie = acc_obj.cookie or ""
                                acc_proxy = acc_obj.proxy
                                acc_password = decrypt_data(acc_obj.password or "")
                                acc_two_fa = decrypt_data(acc_obj.two_fa or "")
                                _append_log(job_id, f"🌐 [{uid}] Mở Chrome cho tài khoản mới trong Bot Pool...", "info")
                                driver = create_driver(uid, headless=False, detach=True, proxy=acc_proxy, scope="group-scan", verify_egress=False)
                                login_res = ensure_logged_in(driver, uid=uid, password=acc_password, two_fa=acc_two_fa, cookie=acc_cookie)
                                if login_res.get("success"):
                                    _append_log(job_id, f"✅ [{uid}] Đăng nhập thành công, tiếp tục thực thi các mục tiêu tiếp theo.", "success")
                                    last_switched_count = len(all_groups)
                        finally:
                            db_acc.close()

            if idx < len(items) - 1:
                next_kw = items[idx + 1]["keyword"]
                wait_sec = random.uniform(delay_min, delay_max) if delay_max > 0 else 0.0
                end_at = time.time() + wait_sec
                _append_log(
                    job_id,
                    f"➡️ Tiếp theo «{next_kw}» (hạn {items[idx + 1]['limit']})"
                    + (f" — nghỉ {wait_sec:.1f}s…" if wait_sec > 0 else " — chuyển ngay…"),
                    "info",
                )
                while time.time() < end_at:
                    if _get_control(job_id) == "abort":
                        _append_log(job_id, "🛑 Dừng khẩn cấp trong lúc nghỉ giữa từ khóa.", "warn")
                        _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                        return
                    if _get_control(job_id) == "pause_after":
                        _append_log(job_id, "⏸️ Tạm dừng (không chạy từ khóa tiếp).", "warn")
                        _set_job(job_id, groups=list(all_groups), status="paused")
                        return
                    time.sleep(min(0.5, max(0.0, end_at - time.time())))

        _set_job(job_id, groups=list(all_groups), status="done")
        _append_log(
            job_id,
            f"🏁 Hoàn tất {len(items)} từ khóa — tổng {len(all_groups)} nhóm.",
            "success",
        )
    except Exception as exc:
        logger.exception("[%s] keyword check failed", uid)
        _append_log(job_id, f"❌ Kiểm tra từ khóa lỗi: {exc}", "error")
        _set_job(job_id, status="error", error=str(exc), groups=list(all_groups))
    finally:
        try:
            profile_lock.release()
        except Exception:
            pass
