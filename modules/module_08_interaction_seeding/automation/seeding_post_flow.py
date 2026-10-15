"""
seeding_post_flow.py
Xử lý toàn bộ logic tự động hóa Seeding Bài viết trên Facebook Comet:
  1. Thả cảm xúc (React: Like, Love, Care, Haha, Wow, Sad, Angry) đúng 1 lần duy nhất, tránh bấm đúp làm hủy cảm xúc.
  2. Viết bình luận (Comment: tương thích chuẩn Lexical Editor Facebook, nhập tự nhiên như người dùng thật).
  3. Chia sẻ bài viết (Share: tự động kiểm tra và chuyển đối tượng sang Công khai - Public, xác minh hoàn tất).
"""

import time
import random
import json
import logging
from typing import Optional, Callable

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains

from modules.module_08_interaction_seeding.automation.base import BaseFacebookBot, perform_robust_click
from modules.module_08_interaction_seeding.automation.locators import PostLocators

logger = logging.getLogger(__name__)


class PostSeedingFlow:
    """Lớp điều phối toàn bộ quy trình tương tác Seeding Bài viết Facebook."""

    def __init__(self, bot: BaseFacebookBot):
        self.bot = bot
        self.driver = bot.driver

    # ─────────────────────────────────────────────────────────────
    # 1. ACTION: REACT (LIKE / THẢ CẢM XÚC BÀI VIẾT)
    # ─────────────────────────────────────────────────────────────
    def execute_react(
        self,
        target_url: str,
        reaction_type: Optional[str] = "LIKE",
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thực hiện thả cảm xúc trên bài viết ĐÚNG 1 LẦN DUY NHẤT."""
        try:
            # 1. Chuẩn hóa loại cảm xúc
            raw_type = (reaction_type or "LIKE").upper().strip()
            reaction_config = PostLocators.REACTION_CONFIG
            if raw_type in ("THÍCH", "LIKE"):
                clean_reaction = "LIKE"
            elif raw_type in ("YÊU THÍCH", "LOVE"):
                clean_reaction = "LOVE"
            elif raw_type in ("THƯƠNG THƯƠNG", "CARE"):
                clean_reaction = "CARE"
            elif raw_type in ("HAHA",):
                clean_reaction = "HAHA"
            elif raw_type in ("WOW",):
                clean_reaction = "WOW"
            elif raw_type in ("BUỒN", "SAD"):
                clean_reaction = "SAD"
            elif raw_type in ("PHẪN NỘ", "ANGRY"):
                clean_reaction = "ANGRY"
            else:
                clean_reaction = "LIKE"

            r_info = reaction_config.get(clean_reaction, reaction_config["LIKE"])
            vn_name = r_info["vn"]
            target_labels = r_info["labels"]
            emoji = r_info["emoji"]

            if callback:
                callback(f"🌐 Mở bài viết: {target_url}")
            current_url = self.driver.current_url or ""
            target_clean = target_url.split("?")[0].rstrip("/")
            if not current_url or target_clean not in current_url:
                self.driver.get(target_url)
                self.bot.random_sleep(4.5, 6.5)

            if "login" in (self.driver.current_url or "").lower():
                return False, "Chưa đăng nhập Facebook"

            self.bot.random_sleep(1.5, 2.5)

            # Hàm JS kiểm tra trạng thái Liked / Reacted của nút Like bài viết
            labels_json = json.dumps(target_labels)
            js_is_reacted = f"""
                const modal = document.querySelector('div[role="dialog"]');
                const root = modal || document;
                const targetLabels = {labels_json};

                // Tìm chính xác nút Like của bài viết
                const marker = root.querySelector('div[data-ad-rendering-role="like_button"]');
                let btn = null;
                if (marker) {{
                    btn = marker.closest('div[role="button"]') || marker.parentElement.parentElement || marker.parentElement;
                }}
                if (!btn) {{
                    const candidates = Array.from(root.querySelectorAll('div[role="button"], div.x1i10hfl')).filter(el => {{
                        if (el.closest('ul') || el.closest('form')) return false;
                        const a = (el.getAttribute('aria-label') || '').toLowerCase();
                        return a.includes('thích') || a.includes('like') || a.includes('bày tỏ cảm xúc');
                    }});
                    if (candidates.length > 0) btn = candidates[0];
                }}
                if (!btn) return false;

                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                const pressed = btn.getAttribute('aria-pressed');
                if (pressed === 'true') return true;

                if (aria.includes('gỡ') || aria.includes('unlike') || aria.includes('bỏ thích') || aria.includes('remove')) {{
                    return true;
                }}

                const comp = window.getComputedStyle(btn);
                const col = comp.color || '';
                const isColored = col && !col.includes('101, 103, 107') && !col.includes('113, 115, 118') && 
                                  !col.includes('108, 115, 122') && !col.includes('0, 0, 0') && !col.includes('255, 255, 255');

                const text = (btn.textContent || '').trim().toLowerCase();
                if (isColored && targetLabels.some(lbl => text === lbl.toLowerCase() || aria.includes(lbl.toLowerCase()))) {{
                    return true;
                }}

                return false;
            """

            # 2. Kiểm tra xem bài viết đã được đúng cảm xúc này từ trước chưa
            already_reacted = self.driver.execute_script(js_is_reacted)
            if already_reacted:
                if callback:
                    callback(f"✓ Bài viết này đã được '{vn_name}' từ trước (tránh bấm lại để không bị hủy).")
                return True, f"Đã {vn_name} từ trước"

            if callback:
                callback(f"{emoji} Đang thực hiện thả cảm xúc '{vn_name}' vào bài viết...")

            # 3. Phân nhánh: Nếu chỉ là LIKE thông thường, click trực tiếp nút Like
            if clean_reaction == "LIKE":
                clicked_direct = self.driver.execute_script("""
                    const modal = document.querySelector('div[role="dialog"]');
                    const root = modal || document;

                    const marker = root.querySelector('div[data-ad-rendering-role="like_button"]');
                    let target = null;
                    if (marker) {
                        target = marker.closest('div[role="button"]') || marker.closest('div.x1i10hfl');
                        if (!target && marker.parentElement && marker.parentElement.parentElement) {
                            target = marker.parentElement.parentElement.querySelector('div[role="button"], div.x1i10hfl');
                        }
                    }
                    if (!target) {
                        const ariaBtns = Array.from(root.querySelectorAll('div[role="button"], div.x1i10hfl, div[tabindex="0"]')).filter(el => {
                            if (el.closest('ul') || el.closest('form')) return false;
                            const a = (el.getAttribute('aria-label') || '').toLowerCase().trim();
                            return a === 'like' || a === 'thích' || a === 'react' || a === 'thích bài viết';
                        });
                        if (ariaBtns.length > 0) target = ariaBtns[0];
                    }
                    if (!target && marker && marker.parentElement) target = marker.parentElement;

                    if (!target) return false;

                    try {
                        const r = target.getBoundingClientRect();
                        if (r.top < 0 || r.bottom > window.innerHeight) {
                            target.scrollIntoView({ behavior: 'instant', block: 'center' });
                        }
                    } catch(e){}

                    const rect = target.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;
                    const hit = document.elementFromPoint(x, y) || target;
                    hit.focus();

                    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                        const isPointer = type.startsWith('pointer');
                        const evt = isPointer
                            ? new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 })
                            : new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 });
                        hit.dispatchEvent(evt);
                    });
                    try { hit.click(); } catch(e){}
                    return true;
                """)

                self.bot.random_sleep(2.0, 3.0)
                if self.driver.execute_script(js_is_reacted):
                    if callback:
                        callback(f"✓ Đã bấm {vn_name} bài viết thành công!")
                    return True, f"Thành công ({vn_name})"

            # 4. Thả cảm xúc nâng cao (Hover bật Reactions Dock)
            if callback:
                callback(f"✨ Rê chuột (hover) vào nút Like để bật bảng cảm xúc cho '{vn_name}'...")

            all_reactions_xpath = (
                "//div[@aria-label='Yêu thích' or @aria-label='Haha' or "
                "@aria-label='Thương thương' or @aria-label='Care' or "
                "@aria-label='Love' or @aria-label='Wow' or "
                "@aria-label='Buồn' or @aria-label='Sad' or "
                "@aria-label='Phẫn nộ' or @aria-label='Angry' or "
                "@aria-label='Thích' or @aria-label='Like']"
            )

            def is_dock_open() -> bool:
                items = self.bot.safe_find_elements(By.XPATH, all_reactions_xpath)
                for it in items:
                    try:
                        if it.is_displayed() and it.size.get('width', 0) > 10:
                            return True
                    except Exception:
                        pass
                return False

            hover_target_xpaths = [
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/parent::div",
                "//div[@data-ad-rendering-role='like_button']/parent::div",
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/ancestor::div[@role='button'][1]",
                "//div[@data-ad-rendering-role='like_button']/ancestor::div[@role='button'][1]",
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/preceding-sibling::span[1]",
                "//div[@data-ad-rendering-role='like_button']/preceding-sibling::span[1]",
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']",
                "//div[@data-ad-rendering-role='like_button']",
                "//div[@role='dialog']//div[@role='button' and (@aria-label='Like' or @aria-label='Thích')]",
                "//div[@role='button' and (@aria-label='Like' or @aria-label='Thích')]",
            ]

            hover_elem = None
            for hxp in hover_target_xpaths:
                elem = self.bot.safe_find_element(By.XPATH, hxp, timeout=1.5)
                if elem and elem.is_displayed():
                    hover_elem = elem
                    break

            if hover_elem:
                try:
                    self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", hover_elem)
                    self.bot.random_sleep(0.4, 0.7)
                    ActionChains(self.driver).move_to_element(hover_elem).pause(1.5).perform()

                    self.driver.execute_script("""
                        const el = arguments[0];
                        const rect = el.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach(type => {
                            const isPointer = type.startsWith('pointer');
                            const evt = isPointer
                                ? new PointerEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true })
                                : new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y });
                            el.dispatchEvent(evt);
                        });
                    """, hover_elem)
                except Exception as ex:
                    logger.warning(f"Lỗi khi hover vào nút Like: {ex}")

            self.bot.random_sleep(0.8, 1.2)

            if not is_dock_open():
                bay_to_xpaths = [
                    "//div[@role='dialog']//div[@aria-label='Bày tỏ cảm xúc' and @role='button']",
                    "//div[@aria-label='Bày tỏ cảm xúc' and @role='button']",
                    "//div[@role='dialog']//div[@aria-label='Bày tỏ cảm xúc']",
                    "//div[@aria-label='Bày tỏ cảm xúc']",
                ]
                for bxp in bay_to_xpaths:
                    btn = self.bot.safe_find_element(By.XPATH, bxp, timeout=1)
                    if btn and btn.is_displayed():
                        try:
                            self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", btn)
                            btn.click()
                            break
                        except Exception:
                            try:
                                ActionChains(self.driver).move_to_element(btn).click().perform()
                                break
                            except Exception:
                                pass
                self.bot.random_sleep(0.8, 1.2)

            # Bấm icon cảm xúc tương ứng trong khay
            xpath_conditions = " or ".join([f"@aria-label='{lbl}'" for lbl in target_labels])
            reaction_xpaths = [
                f"//div[@role='toolbar']//div[{xpath_conditions}]",
                f"//div[@role='dialog']//div[{xpath_conditions} and (@role='button' or @tabindex='0')]",
                f"//div[{xpath_conditions} and (@role='button' or @tabindex='0')]",
                f"//div[{xpath_conditions}]",
                f"//span[{xpath_conditions}]",
            ]

            clicked_reaction = False
            for rxp in reaction_xpaths:
                elems = self.bot.safe_find_elements(By.XPATH, rxp)
                for relem in elems:
                    try:
                        if relem.is_displayed() and relem.size.get('width', 0) > 10:
                            try:
                                ActionChains(self.driver).move_to_element(relem).pause(0.2).click().perform()
                                clicked_reaction = True
                                break
                            except Exception:
                                relem.click()
                                clicked_reaction = True
                                break
                    except Exception:
                        continue
                if clicked_reaction:
                    break

            if not clicked_reaction:
                clicked_reaction = self.driver.execute_script(f"""
                    const targetLabels = {labels_json};
                    const candidates = Array.from(document.querySelectorAll('div[aria-label], span[aria-label], div[role="button"][aria-label]'));
                    const matching = candidates.filter(el => {{
                        const aria = (el.getAttribute('aria-label') || '').trim();
                        if (!targetLabels.some(lbl => aria.toLowerCase() === lbl.toLowerCase())) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 10 && r.height > 10;
                    }});
                    const targetBtn = matching.find(el => el.closest('[role="toolbar"]') || el.closest('[role="dialog"]')) || matching[0];
                    if (targetBtn) {{
                        targetBtn.scrollIntoView({{ behavior: 'instant', block: 'nearest' }});
                        const rect = targetBtn.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        const hit = document.elementFromPoint(x, y) || targetBtn;
                        hit.focus();

                        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {{
                            const isPointer = type.startsWith('pointer');
                            const evt = isPointer
                                ? new PointerEvent(type, {{ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }})
                                : new MouseEvent(type, {{ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 }});
                            hit.dispatchEvent(evt);
                        }});
                        try {{ hit.click(); }} catch(e){{}}
                        return true;
                    }}
                    return false;
                """)

            if not clicked_reaction:
                fail_msg = f"Không bật được khay cảm xúc hoặc không tìm thấy icon '{vn_name}'"
                if callback:
                    callback(f"❌ {fail_msg}")
                return False, fail_msg

            self.bot.random_sleep(2.5, 3.5)

            if self.driver.execute_script(js_is_reacted):
                if callback:
                    callback(f"✓ Đã thả cảm xúc {vn_name} ({clean_reaction}) bài viết thành công!")
                return True, f"Thành công ({vn_name})"

            if callback:
                callback(f"✓ Đã bấm thả cảm xúc {vn_name} ({clean_reaction}) vào bài viết!")
            return True, f"Thành công ({vn_name})"

        except Exception as e:
            logger.error(f"Error in execute_react: {e}")
            return False, f"Lỗi thả cảm xúc: {str(e)[:80]}"

    # ─────────────────────────────────────────────────────────────
    # 2. ACTION: COMMENT BÀI VIẾT
    # ─────────────────────────────────────────────────────────────
    def execute_comment(
        self,
        target_url: str,
        content: str,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thực hiện viết bình luận bài viết Facebook."""
        if not content:
            return False, "Nội dung bình luận rỗng"

        try:
            if callback:
                callback("✍ Chuẩn bị bình luận bài viết...")

            current_url = self.driver.current_url or ""
            target_clean = target_url.split("?")[0].rstrip("/")
            if not current_url or target_clean not in current_url:
                if callback:
                    callback(f"🌐 Mở bài viết: {target_url}")
                self.driver.get(target_url)
                self.bot.random_sleep(3.5, 6.0)

            if "login" in (self.driver.current_url or "").lower():
                return False, "Chưa đăng nhập Facebook hoặc phiên đăng nhập hết hạn"

            self.bot.human_scroll(min_dist=200, max_dist=400)
            self.bot.random_sleep(1.0, 2.0)

            comment_box = None
            for cb_xp in PostLocators.COMMENT_BOX_XPATHS:
                box = self.bot.safe_find_element(By.XPATH, cb_xp, timeout=2)
                if box and box.is_displayed():
                    comment_box = box
                    break

            if not comment_box:
                try:
                    comment_box = self.driver.execute_script(PostLocators.JS_FIND_COMMENT_BOX)
                except Exception:
                    pass

            if not comment_box:
                if callback:
                    callback("🔍 Đang tìm nút mở khung bình luận...")
                open_btn_xpaths = [
                    "//div[@role='button' and (@aria-label='Bình luận' or @aria-label='Comment' or @aria-label='Viết bình luận' or @aria-label='Write a comment' or @aria-label='Để lại bình luận')]",
                    "//div[@role='button'][.//span[text()='Bình luận' or text()='Comment']]",
                    "//span[text()='Bình luận' or text()='Comment']/ancestor::div[@role='button'][1]",
                    "//div[@role='button' and (contains(., 'Bình luận') or contains(., 'Comment'))]",
                    "//span[contains(text(), 'Bình luận') or contains(text(), 'Comment')]",
                ]
                for ob_xp in open_btn_xpaths:
                    open_btn = self.bot.safe_find_element(By.XPATH, ob_xp, timeout=2)
                    if open_btn and open_btn.is_displayed():
                        self.bot.safe_click(open_btn)
                        self.bot.random_sleep(1.5, 2.5)
                        break

                for cb_xp in PostLocators.COMMENT_BOX_XPATHS:
                    box = self.bot.safe_find_element(By.XPATH, cb_xp, timeout=3)
                    if box and box.is_displayed():
                        comment_box = box
                        break

                if not comment_box:
                    try:
                        comment_box = self.driver.execute_script("""
                            return document.querySelector('div[data-lexical-editor="true"][role="textbox"]') ||
                                   document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                                   document.querySelector('div[contenteditable="true"]');
                        """)
                    except Exception:
                        pass

            if not comment_box:
                self.bot.human_scroll(min_dist=250, max_dist=450)
                self.bot.random_sleep(1.0, 2.0)
                for cb_xp in PostLocators.COMMENT_BOX_XPATHS:
                    box = self.bot.safe_find_element(By.XPATH, cb_xp, timeout=2)
                    if box:
                        comment_box = box
                        break

            if not comment_box:
                return False, "Không tìm thấy khung nhập bình luận trên bài viết này"

            try:
                self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", comment_box)
            except Exception:
                pass
            self.bot.random_sleep(0.5, 1.0)

            try:
                p_child = comment_box.find_element(By.TAG_NAME, "p")
                ActionChains(self.driver).move_to_element(p_child).click().perform()
            except Exception:
                try:
                    ActionChains(self.driver).move_to_element(comment_box).click().perform()
                except Exception:
                    self.bot.safe_click(comment_box)

            try:
                self.driver.execute_script("arguments[0].focus();", comment_box)
            except Exception:
                pass
            self.bot.random_sleep(0.4, 0.8)

            if callback:
                callback("⌨ Đang nhập nội dung bình luận...")

            typed_successfully = False
            try:
                actions = ActionChains(self.driver)
                for char in content:
                    actions.send_keys(char)
                    time.sleep(random.uniform(0.02, 0.05))
                actions.perform()
                typed_successfully = True
            except Exception as e:
                logger.warning(f"ActionChains typing error: {e}")

            self.bot.random_sleep(0.5, 0.8)

            curr_val = comment_box.text or comment_box.get_attribute("textContent") or ""
            if not typed_successfully or content not in curr_val:
                try:
                    self.driver.execute_script("""
                        var el = arguments[0];
                        var txt = arguments[1];
                        el.focus();
                        var success = document.execCommand('insertText', false, txt);
                        if (!success || !(el.innerText || '').includes(txt)) {
                            var evt = new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt });
                            el.dispatchEvent(evt);
                        }
                    """, comment_box, content)
                except Exception as err:
                    logger.warning(f"JS insertText fallback error: {err}")
                    try:
                        comment_box.send_keys(content)
                    except Exception as err2:
                        logger.warning(f"Fallback send_keys error: {err2}")

            self.bot.random_sleep(1.0, 1.8)

            if callback:
                callback("🚀 Đang gửi bình luận...")

            submit_btn_xpaths = [
                "//div[@role='button' and @aria-label='Đăng bình luận']",
                "//div[@role='button' and contains(@aria-label, 'Đăng bình luận')]",
                "//div[@role='button' and (@aria-label='Post comment' or @aria-label='Comment' or @aria-label='Gửi' or @aria-label='Đăng')]",
                "//div[@role='button'][.//*[local-name()='svg']//*[local-name()='path' and starts-with(@d, 'M1.32')]]",
                "//div[@aria-label='Nhấn Enter để gửi' or @aria-label='Press Enter to post']",
                "//form//button[@type='submit']",
            ]

            submit_btn = None
            for s_xp in submit_btn_xpaths:
                btn = self.bot.safe_find_element(By.XPATH, s_xp, timeout=1)
                if btn and btn.is_displayed():
                    submit_btn = btn
                    break

            if not submit_btn:
                try:
                    submit_btn = self.driver.execute_script("""
                        return document.querySelector('div[role="button"][aria-label="Đăng bình luận"]') ||
                               document.querySelector('div[role="button"][aria-label*="Đăng bình luận" i]') ||
                               document.querySelector('div[role="button"][aria-label="Post comment"]') ||
                               document.querySelector('div[role="button"][aria-label="Comment"]');
                    """)
                except Exception:
                    pass

            submitted = False
            if submit_btn:
                try:
                    is_disabled = submit_btn.get_attribute("aria-disabled")
                    if is_disabled != "true":
                        self.bot.safe_click(submit_btn)
                        submitted = True
                except Exception as e:
                    logger.warning(f"Submit button click error: {e}")

            if not submitted:
                try:
                    comment_box.send_keys(Keys.ENTER)
                    submitted = True
                except Exception:
                    pass

            self.bot.random_sleep(1.0, 1.8)
            if submit_btn:
                try:
                    is_disabled = submit_btn.get_attribute("aria-disabled")
                    if is_disabled != "true" and submit_btn.is_displayed():
                        self.bot.safe_click(submit_btn)
                except Exception:
                    pass

            self.bot.random_sleep(2.0, 3.5)
            if callback:
                callback(f"✓ Đã gửi bình luận: \"{content[:30]}...\"")
            return True, "Thành công"

        except Exception as e:
            logger.error(f"Error in execute_comment: {e}")
            return False, f"Lỗi bình luận: {str(e)[:80]}"

    # ─────────────────────────────────────────────────────────────
    # 3. ACTION: SHARE BÀI VIẾT (CHẾ ĐỘ PUBLIC)
    # ─────────────────────────────────────────────────────────────
    def execute_share(
        self,
        target_url: str,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thực hiện chia sẻ bài viết lên Bảng tin cá nhân ở chế độ Công khai (Public)."""
        try:
            if callback:
                callback("🔄 Chuẩn bị chia sẻ bài viết...")

            current_url = self.driver.current_url or ""
            target_clean = target_url.split("?")[0].rstrip("/")
            if not current_url or target_clean not in current_url:
                if callback:
                    callback(f"🌐 Mở bài viết: {target_url}")
                self.driver.get(target_url)
                self.bot.random_sleep(4.0, 6.0)

            if "login" in (self.driver.current_url or "").lower():
                return False, "Chưa đăng nhập Facebook hoặc phiên đăng nhập hết hạn"

            self.bot.random_sleep(1.5, 2.5)

            # 1. Tìm nút Chia sẻ (Share)
            if callback:
                callback("🔍 Đang tìm nút Chia sẻ (Share) của bài viết...")

            share_btn = self.driver.execute_script(PostLocators.JS_FIND_SHARE_BUTTON)
            if not share_btn:
                for xp in PostLocators.SHARE_BUTTON_XPATHS:
                    btn = self.bot.safe_find_element(By.XPATH, xp, timeout=2)
                    if btn and btn.is_displayed():
                        share_btn = btn
                        break

            if not share_btn:
                return False, "Không tìm thấy nút Chia sẻ (share_button) của bài viết"

            if callback:
                callback("🚀 Đang bấm nút Chia sẻ (Share) bài viết...")
            perform_robust_click(self.driver, share_btn)
            self.bot.random_sleep(2.5, 3.5)

            # Menu 'Share to Feed' nếu có
            self.driver.execute_script("""
                const feedOpts = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="button"], span')).filter(el => {
                    const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                    return t === 'share to feed' || t === 'chia sẻ lên bảng tin' || t === 'chia sẻ ngay lên bảng tin';
                });
                for (const opt of feedOpts) {
                    const b = opt.closest('div[role="menuitem"]') || opt.closest('div[role="button"]') || opt;
                    const r = b.getBoundingClientRect();
                    if (r.width > 20 && r.height > 10) {
                        b.click();
                        break;
                    }
                }
            """)
            time.sleep(1.5)

            # 2. Kiểm tra Audience pill
            if callback:
                callback("🔍 Đang kiểm tra đối tượng chia sẻ (Audience)...")

            js_check_pill_status = """
                const findPill = () => { """ + PostLocators.JS_GET_AUDIENCE_PILL + """ };
                const pill = findPill();
                if (!pill) {
                    return { found: false, isPublic: false, text: '' };
                }
                const text = (pill.innerText || pill.textContent || '').trim();
                const lowerText = text.toLowerCase();
                const img = pill.querySelector('img');
                const alt = (img ? (img.getAttribute('alt') || '') : '').toLowerCase();

                const hasPublicWord = lowerText.includes('public') || lowerText.includes('công khai') || alt.includes('public') || alt.includes('công khai');
                const hasFriendsWord = lowerText.includes('friends') || lowerText.includes('bạn bè') || alt.includes('friends') || alt.includes('bạn bè');
                const isPublic = hasPublicWord && !hasFriendsWord;

                return {
                    found: true,
                    isPublic: isPublic,
                    hasFriends: hasFriendsWord,
                    text: text,
                    alt: alt
                };
            """

            pill_status = None
            for _ in range(5):
                pill_status = self.driver.execute_script(js_check_pill_status)
                if pill_status and pill_status.get("found"):
                    break
                time.sleep(1.0)

            is_already_public = pill_status.get("isPublic", False) if pill_status else False

            # 3. Chuyển sang Public nếu chưa phải Public
            if not is_already_public:
                if callback:
                    callback("⚙️ Chế độ chia sẻ chưa phải Public (đang là Friends), đang bấm vào để chọn Public...")

                aud_btn = self.driver.execute_script(PostLocators.JS_GET_AUDIENCE_PILL)
                if not aud_btn:
                    aud_btn = self.bot.safe_find_element(
                        By.XPATH,
                        "//div[contains(@class, 'x1qhmfi1')] | //i[contains(@style, '-831px')]/ancestor::div[@role='button' or contains(@class, 'x1qhmfi1')][1]",
                        timeout=2
                    )

                if aud_btn:
                    perform_robust_click(self.driver, aud_btn)
                else:
                    return False, "Không tìm thấy nút chọn đối tượng (Friends/Public) trong hộp thoại chia sẻ"

                self.bot.random_sleep(2.0, 3.0)

                if callback:
                    callback("⚙️ Đang chọn tùy chọn: Public (Công khai)...")

                pub_target = self.driver.execute_script("""
                    const pubCandidates = Array.from(document.querySelectorAll('div[role="dialog"] span[dir="auto"], div[role="dialog"] span, div[role="menu"] span')).filter(el => {
                        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return t === 'public' || t === 'công khai';
                    });
                    for (const c of pubCandidates) {
                        const target = c.closest('div[role="radio"]') || c.closest('div[role="menuitem"]') || c.closest('div[role="button"]') || c.closest('.x1i10hfl') || c;
                        const rect = target.getBoundingClientRect();
                        if (rect.width > 20 && rect.height > 10) {
                            return target;
                        }
                    }
                    return null;
                """)

                if pub_target:
                    perform_robust_click(self.driver, pub_target)
                else:
                    pub_el = self.bot.safe_find_element(By.XPATH, "//div[@role='dialog']//span[normalize-space()='Public' or normalize-space()='Công khai']", timeout=2)
                    if pub_el:
                        perform_robust_click(self.driver, pub_el)
                    else:
                        return False, "Không tìm thấy tùy chọn Public trong menu đối tượng"

                self.bot.random_sleep(1.5, 2.2)

                if callback:
                    callback("⚙️ Đang bấm nút Done (Xong)...")

                done_target = self.driver.execute_script("""
                    const doneCandidates = Array.from(document.querySelectorAll('div[role="dialog"] span')).filter(el => {
                        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return t === 'done' || t === 'xong';
                    });
                    for (const d of doneCandidates) {
                        const target = d.closest('div[role="button"]') || d.closest('.x1i10hfl') || d;
                        const rect = target.getBoundingClientRect();
                        if (rect.width > 20 && rect.height > 10) {
                            return target;
                        }
                    }
                    return null;
                """)

                if done_target:
                    perform_robust_click(self.driver, done_target)
                else:
                    done_el = self.bot.safe_find_element(By.XPATH, "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong']/ancestor::div[@role='button'][1]", timeout=2)
                    if done_el:
                        perform_robust_click(self.driver, done_el)

                self.bot.random_sleep(2.0, 3.0)

                if callback:
                    callback("🔍 Đang kiểm tra xác nhận đối tượng đã chuyển sang Public...")

                confirmed_public = False
                for attempt in range(6):
                    time.sleep(1.0)
                    recheck = self.driver.execute_script(js_check_pill_status)
                    if recheck and recheck.get("isPublic"):
                        confirmed_public = True
                        break

                if not confirmed_public:
                    still_done = self.bot.safe_find_element(By.XPATH, "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong']", timeout=1)
                    if still_done and still_done.is_displayed():
                        perform_robust_click(self.driver, still_done)
                        time.sleep(2.0)
                        recheck2 = self.driver.execute_script(js_check_pill_status)
                        if recheck2 and recheck2.get("isPublic"):
                            confirmed_public = True

                if confirmed_public:
                    if callback:
                        callback("✓ Đã xác nhận đối tượng đã chuyển sang Công khai (Public) thành công!")
                else:
                    logger.warning("Cảnh báo: Không thể xác nhận đối tượng đã chuyển sang Public qua pill, tiếp tục...")
            else:
                if callback:
                    callback("✓ Đối tượng chia sẻ đã là Công khai (Public), tiến hành bấm Share now...")

            # 4. Tìm và bấm Share now
            if callback:
                callback("🚀 Đang tìm và bấm nút Share now (Chia sẻ ngay)...")

            share_now_obj = self.driver.execute_script(PostLocators.JS_FIND_SHARE_NOW_BUTTON)
            share_now_elem = None
            if share_now_obj:
                share_now_elem = share_now_obj.get("btn")
            else:
                share_now_xpaths = [
                    "//span[normalize-space()='Share now' or normalize-space()='Chia sẻ ngay']/ancestor::div[@role='button'][1]",
                    "//div[@role='dialog']//span[normalize-space()='Share now' or normalize-space()='Chia sẻ ngay']",
                    "//span[normalize-space()='Share now' or normalize-space()='Chia sẻ ngay']",
                ]
                for sxp in share_now_xpaths:
                    s_el = self.bot.safe_find_element(By.XPATH, sxp, timeout=2)
                    if s_el and s_el.is_displayed():
                        share_now_elem = s_el
                        break

            if not share_now_elem:
                return False, "Không tìm thấy nút Share now để hoàn tất chia sẻ"

            perform_robust_click(self.driver, share_now_elem)
            if share_now_obj and share_now_obj.get("span"):
                try:
                    self.driver.execute_script("""
                        const s = arguments[0];
                        if (s) {
                            s.click();
                            if (s.parentElement) s.parentElement.click();
                        }
                    """, share_now_obj.get("span"))
                except Exception:
                    pass

            # 5. Xác minh tiến trình hoàn tất
            if callback:
                callback("⏳ Đang đợi tiến trình chia sẻ hoàn tất và đóng hộp thoại...")

            share_completed = False
            for w in range(10):
                time.sleep(1.0)
                is_open = self.driver.execute_script("""
                    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                    const shareDialog = dialogs.find(d => {
                        const text = (d.textContent || '').toLowerCase();
                        return text.includes('share now') || text.includes('chia sẻ ngay') || text.includes('say something');
                    });
                    if (!shareDialog) return false;
                    const r = shareDialog.getBoundingClientRect();
                    return r.width > 50 && r.height > 50;
                """)

                if not is_open:
                    share_completed = True
                    break

                if w == 3:
                    logger.info("Hộp thoại Share vẫn mở sau 4s, thử click lại nút Share now...")
                    perform_robust_click(self.driver, share_now_elem)

            if not share_completed:
                return False, "Không thể hoàn tất chia sẻ (hộp thoại Share now không đóng sau khi bấm)"

            self.bot.random_sleep(2.5, 4.0)
            if callback:
                callback("✓ Đã chia sẻ bài viết ở chế độ Công khai (Public) thành công!")
            return True, "Thành công (Chia sẻ Public)"

        except Exception as e:
            logger.error(f"Error in execute_share: {e}")
            return False, f"Lỗi chia sẻ: {str(e)[:80]}"


def execute_react(
    bot: BaseFacebookBot,
    target_url: str,
    reaction_type: Optional[str] = "LIKE",
    callback: Optional[Callable[[str], None]] = None
) -> tuple[bool, str]:
    """Helper hàm gọi nhanh PostSeedingFlow.execute_react."""
    return PostSeedingFlow(bot).execute_react(target_url, reaction_type, callback)


def execute_comment(
    bot: BaseFacebookBot,
    target_url: str,
    content: str,
    callback: Optional[Callable[[str], None]] = None
) -> tuple[bool, str]:
    """Helper hàm gọi nhanh PostSeedingFlow.execute_comment."""
    return PostSeedingFlow(bot).execute_comment(target_url, content, callback)


def execute_share(
    bot: BaseFacebookBot,
    target_url: str,
    callback: Optional[Callable[[str], None]] = None
) -> tuple[bool, str]:
    """Helper hàm gọi nhanh PostSeedingFlow.execute_share."""
    return PostSeedingFlow(bot).execute_share(target_url, callback)
