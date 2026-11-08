"""
locators.py
Tập trung toàn bộ Selectors, XPaths, CSS classes, SVG markers và JavaScript DOM Queries
cho Facebook Comet UI trong Module 08: Interaction Seeding.
"""

from typing import Dict, Any, List
from selenium.webdriver.common.by import By


# =====================================================================
# 1. AUTH & SESSION LOCATORS
# =====================================================================
class LoginLocators:
    """Các định danh phục vụ kiểm tra trạng thái phiên và đăng nhập Facebook."""
    LOGIN_FORM_MARKERS = [
        (By.ID, "email"),
        (By.ID, "pass"),
        (By.NAME, "login"),
        (By.XPATH, "//form[contains(@action, 'login')]"),
    ]

    SESSION_ALIVE_INDICATORS = [
        (By.XPATH, "//div[@role='feed']"),
        (By.XPATH, "//a[@aria-label='Your profile' or @aria-label='Trang cá nhân của bạn']"),
        (By.XPATH, "//a[contains(@href, '/me/')]"),
        (By.XPATH, "//a[@aria-label='Notifications' or @aria-label='Thông báo']"),
        (By.XPATH, "//div[@aria-label='Tạo' or @aria-label='Create']"),
        (By.XPATH, "//*[@data-testid='feed']"),
    ]

    TWOFA_CODE_INPUT_XPATH = "//input[@type='text' and (@name='approvals_code' or contains(@placeholder, 'code') or contains(@aria-label, 'code'))]"
    TWOFA_SUBMIT_BUTTON_XPATH = "//button[@type='submit' or contains(., 'Tiếp tục') or contains(., 'Continue') or contains(., 'Submit')]"

    SAVED_ACCOUNT_SWITCH_XPATHS = [
        '//button[contains(., "Dùng trang cá nhân khác") or contains(., "Đăng nhập bằng tài khoản khác") or contains(., "Dùng tài khoản khác") or contains(., "Use another profile") or contains(., "Log into another account")]',
        '//div[@role="button" and (contains(., "Dùng trang cá nhân khác") or contains(., "Đăng nhập bằng tài khoản khác") or contains(., "Dùng tài khoản khác") or contains(., "Use another profile") or contains(., "Log into another account"))]',
        '//div[@tabindex="0" and (contains(., "Dùng trang cá nhân khác") or contains(., "Đăng nhập bằng tài khoản khác") or contains(., "Dùng tài khoản khác") or contains(., "Use another profile") or contains(., "Log into another account"))]',
        '//a[contains(., "Dùng trang cá nhân khác") or contains(., "Đăng nhập bằng tài khoản khác") or contains(., "Dùng tài khoản khác") or contains(., "Use another profile") or contains(., "Log into another account")]',
        '//span[contains(text(), "Dùng trang cá nhân khác") or contains(text(), "Đăng nhập bằng tài khoản khác") or contains(text(), "Log into another account") or contains(text(), "Use another profile")]/ancestor::*[@role="button" or self::button or self::a or @tabindex="0"][1]',
        '//*[contains(text(), "Dùng trang cá nhân khác") or contains(text(), "Đăng nhập bằng tài khoản khác") or contains(text(), "Log into another account") or contains(text(), "Use another profile")]',
        '//span[normalize-space(text())="Dùng trang cá nhân khác" or normalize-space(text())="Use another profile" or normalize-space(text())="Log into another account"]',
    ]

    EMAIL_INPUT_SELECTORS = [
        (By.ID, "email"),
        (By.NAME, "email"),
        (By.XPATH, '//input[@data-testid="royal_email"]'),
        (By.XPATH, '//input[@type="text" and @name="email"]'),
        (By.XPATH, '//input[contains(@aria-label, "Email") or contains(@aria-label, "email") or contains(@aria-label, "Phone") or contains(@aria-label, "Số điện thoại")]'),
        (By.XPATH, '//input[@type="text"]'),
    ]

    PASSWORD_INPUT_SELECTORS = [
        (By.ID, "pass"),
        (By.NAME, "pass"),
        (By.XPATH, '//input[@data-testid="royal_pass"]'),
        (By.XPATH, '//input[@type="password" and @name="pass"]'),
        (By.XPATH, '//input[@type="password"]'),
    ]

    LOGIN_BUTTON_SELECTORS = [
        (By.NAME, "login"),
        (By.XPATH, '//button[@name="login"]'),
        (By.XPATH, '//button[@type="submit"]'),
        (By.XPATH, '//div[@aria-label="Log in" or @aria-label="Log In" or @aria-label="Đăng nhập" or @aria-label="Đăng Nhập" and @role="button"]'),
        (By.XPATH, '//button[contains(@id, "u_0_") or contains(@id, "loginbutton")]'),
        (By.XPATH, '//input[@type="submit" and (@value="Log In" or @value="Đăng nhập")]'),
        (By.XPATH, '//button[contains(text(), "Log In") or contains(text(), "Log in") or contains(text(), "Đăng nhập") or contains(text(), "Đăng Nhập")]'),
    ]


# =====================================================================
# 1.1. CẢNH BÁO / CHẶN CỦA FACEBOOK (dùng chung cho mọi thao tác seeding)
# =====================================================================
class CommonLocators:
    """Nhận diện hộp thoại cảnh báo của Facebook sau khi thao tác (bị chặn tạm thời, giới hạn tần suất...)."""

    # Trả về nội dung cảnh báo (rút gọn) nếu đang có hộp thoại / thông báo cảnh báo của Facebook, không có thì null.
    # Chỉ xét hộp thoại nhỏ (role=dialog / alertdialog / alert), bỏ qua hộp thoại chứa bài viết (khung xem bài,
    # có nút Like / bình luận) để chữ trong bài hay bình luận của người khác không bị tưởng là cảnh báo.
    JS_FIND_FACEBOOK_WARNING = """
        const KEYWORDS = [
            'tạm thời bị chặn', 'bị chặn tạm thời', 'tính năng này tạm thời', 'hành động bị chặn',
            'giới hạn tần suất', 'giới hạn số lần', 'thử lại sau', 'sử dụng nhầm tính năng', 'lạm dụng tính năng',
            'thao tác quá nhanh', 'không thể sử dụng tính năng', 'tài khoản của bạn bị hạn chế', 'đang bị hạn chế',
            'không thể đăng bình luận', 'không thể theo dõi', 'hiện không khả dụng', 'kiểm tra bảo mật',
            'temporarily blocked', 'action blocked', 'try again later', 'we limit how often', 'misusing this feature',
            'going too fast', "can't use this feature", 'cannot use this feature', 'account is restricted',
            "couldn't be posted", 'could not be posted', "can't follow",
            "isn't available right now", 'is not available right now', 'security check is required',
        ];
        const boxes = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"]'));
        for (const b of boxes) {
            const r = b.getBoundingClientRect();
            if (r.width < 50 || r.height < 20) continue;
            if (b.querySelector('[data-ad-rendering-role], [role="article"]')) continue;
            const text = (b.innerText || '').replace(/\\s+/g, ' ').trim();
            const low = text.toLowerCase();
            if (KEYWORDS.some(k => low.includes(k))) return text.slice(0, 160);
        }
        return null;
    """


# =====================================================================
# 2. PAGE SEEDING LOCATORS (FANPAGE)
# =====================================================================
class PageLocators:
    """Các định danh phục vụ Fanpage (Follow, Like, Menu 3 chấm, kiểm tra trạng thái)."""
    
    # Đoạn mã JS kiểm tra xem tài khoản đã Thích / Theo dõi Fanpage từ trước hay chưa
    JS_CHECK_ALREADY_FOLLOWED_OR_LIKED = """
        function isNavOrTab(el) {
            if (!el) return true;
            if (el.closest('[role="tab"]') || el.closest('[role="tablist"]')) return true;
            if (el.closest('nav') || el.closest('[role="navigation"]')) return true;
            if (el.closest('[role="banner"]')) return true;
            const href = el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : '') || '';
            if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos')) return true;
            return false;
        }
        const spans = Array.from(document.querySelectorAll('span, div[role="button"], a[role="button"], div.x1i10hfl'));
        for (const el of spans) {
            if (isNavOrTab(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.top < 60 || rect.top >= 850 || rect.width <= 15) continue;
            
            const text = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            
            if (text === 'following' || text === 'đang theo dõi' || aria === 'following' || aria === 'đang theo dõi') {
                return { already: true, reason: 'đang theo dõi' };
            }
            if (text === 'liked' || text === 'đã thích' || aria === 'liked' || aria === 'đã thích') {
                return { already: true, reason: 'đã thích' };
            }
        }
        return { already: false };
    """

    # Đoạn mã JS quét các nút Follow, Like và 3 chấm trên Header Fanpage
    JS_SCAN_PAGE_BUTTONS = """
        function isNavOrTab(el) {
            if (!el) return true;
            if (el.closest('[role="tab"]') || el.closest('[role="tablist"]')) return true;
            if (el.closest('nav') || el.closest('[role="navigation"]')) return true;
            if (el.closest('[role="banner"]')) return true;
            const href = el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : '') || '';
            if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos')) return true;
            return false;
        }

        let followBtn = null;
        let likeBtn = null;
        let moreBtn = null;

        const spans = Array.from(document.querySelectorAll('span'));
        for (const sp of spans) {
            const t = (sp.textContent || '').trim().toLowerCase();
            if (!['follow', 'theo dõi', 'like', 'thích'].includes(t)) continue;

            const btn = sp.closest('div[role="button"]') ||
                        sp.closest('a[role="button"]') ||
                        sp.closest('[role="button"]') ||
                        sp.closest('.x1i10hfl');
            if (!btn || isNavOrTab(btn)) continue;

            const rect = btn.getBoundingClientRect();
            if (rect.top < 60 || rect.top >= 850 || rect.width <= 20 || rect.height <= 15) continue;

            if (t === 'follow' || t === 'theo dõi') {
                if (!followBtn) followBtn = btn;
            } else if (t === 'like' || t === 'thích') {
                if (!likeBtn) likeBtn = btn;
            }
        }

        // Quét icon đặc thù nút Follow của Facebook (nSurzCxCD4K)
        if (!followBtn) {
            const followImgs = Array.from(document.querySelectorAll('img')).filter(img => (img.src || '').includes('nSurzCxCD4K'));
            for (const img of followImgs) {
                const btn = img.closest('div[role="button"]') || img.closest('[role="button"]') || img.closest('.x1i10hfl');
                if (btn && !isNavOrTab(btn)) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.top >= 60 && rect.top < 850 && rect.width > 20) {
                        followBtn = btn;
                        break;
                    }
                }
            }
        }

        // Quét nút 3 chấm (...) trong Header Fanpage
        const allSvgs = Array.from(document.querySelectorAll('svg'));
        for (const svg of allSvgs) {
            const circles = Array.from(svg.querySelectorAll('circle'));
            if (circles.length === 3) {
                const clickable = svg.closest('div[role="button"]') ||
                                  svg.closest('a[role="button"]') ||
                                  svg.closest('[role="button"]') ||
                                  svg.closest('.x1i10hfl') ||
                                  svg.parentElement;
                if (clickable && !isNavOrTab(clickable)) {
                    const rect = clickable.getBoundingClientRect();
                    if (rect.top >= 60 && rect.top < 850 && rect.width >= 10 && rect.height >= 10) {
                        if (!clickable.closest('[role="article"]') && !clickable.closest('[role="feed"]')) {
                            moreBtn = clickable;
                            break;
                        }
                    }
                }
            }
        }

        return {
            followBtn: followBtn,
            likeBtn: likeBtn,
            moreBtn: moreBtn
        };
    """

    # Quét menu popup 3 chấm của Fanpage
    JS_SCAN_PAGE_MORE_MENU = """
        const allItems = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="menu"] div[role="button"], div[role="dialog"] div[role="button"], div.x1i10hfl, span'));
        let followItem = null;
        let likeItem = null;
        let alreadyFollowOrLiked = false;

        for (const el of allItems) {
            const t = (el.textContent || '').trim().toLowerCase();
            if (t === 'unfollow' || t === 'bỏ theo dõi' || t === 'following' || t === 'đang theo dõi' || t === 'liked' || t === 'đã thích') {
                alreadyFollowOrLiked = true;
                break;
            }
            if (t === 'follow' || t === 'theo dõi') {
                const clickable = el.closest('div[role="menuitem"]') || el.closest('div[role="button"]') || el.closest('.x1i10hfl') || el;
                followItem = clickable;
            } else if (t === 'like' || t === 'thích') {
                const clickable = el.closest('div[role="menuitem"]') || el.closest('div[role="button"]') || el.closest('.x1i10hfl') || el;
                likeItem = clickable;
            }
        }

        return {
            followItem: followItem,
            likeItem: likeItem,
            alreadyFollowOrLiked: alreadyFollowOrLiked
        };
    """

    # Xác minh thay đổi sau khi click trên Fanpage
    JS_VERIFY_PAGE_STATE_CHANGED = """
        const spans = Array.from(document.querySelectorAll('span, div[role="button"], a[role="button"], div.x1i10hfl'));
        const isFollowingOrLiked = spans.some(s => {
            const t = (s.textContent || '').trim().toLowerCase();
            const aria = (s.getAttribute('aria-label') || '').trim().toLowerCase();
            if (t === 'following' || t === 'đang theo dõi' || aria === 'following' || aria === 'đang theo dõi' ||
                t === 'liked' || t === 'đã thích' || aria === 'liked' || aria === 'đã thích') {
                const rect = s.getBoundingClientRect();
                return rect.top >= 60 && rect.top < 850 && rect.width > 0;
            }
            return false;
        });
        if (isFollowingOrLiked) return true;

        const stillHasAction = spans.some(s => {
            const t = (s.textContent || '').trim().toLowerCase();
            if (t === 'follow' || t === 'theo dõi' || t === 'like' || t === 'thích') {
                const btn = s.closest('div[role="button"]') || s.closest('.x1i10hfl');
                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    return rect.top >= 60 && rect.top < 850 && rect.width > 20;
                }
            }
            return false;
        });
        return !stillHasAction;
    """


# =====================================================================
# 3. PROFILE SEEDING LOCATORS (TRANG CÁ NHÂN)
# =====================================================================
class ProfileLocators:
    """Các định danh phục vụ Trang cá nhân (Follow, Menu 3 chấm, kiểm tra kết nối/bạn bè)."""

    # Đoạn mã JS kiểm tra xem tài khoản đã Theo dõi hoặc Kết bạn với Profile từ trước chưa
    JS_CHECK_ALREADY_CONNECTED = """
        function isNavOrTab(el) {
            if (!el) return true;
            if (el.closest('[role="tab"]') || el.closest('[role="tablist"]')) return true;
            if (el.closest('nav') || el.closest('[role="navigation"]')) return true;
            if (el.closest('[role="banner"]')) return true;
            const href = el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : '') || '';
            if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos')) return true;
            return false;
        }
        const spans = Array.from(document.querySelectorAll('span, div[role="button"], a[role="button"], div.x1i10hfl'));
        for (const el of spans) {
            if (isNavOrTab(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.top < 60 || rect.top >= 850 || rect.width <= 15) continue;
            
            const text = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            
            if (text === 'following' || text === 'đang theo dõi' || aria === 'following' || aria === 'đang theo dõi') {
                return { already: true, reason: 'đang theo dõi' };
            }
            if (text === 'friends' || text === 'bạn bè' || text.includes('hủy lời mời') || text.includes('cancel request') || text.includes('request sent') || text.includes('đã gửi lời mời')) {
                return { already: true, reason: 'bạn bè / đã gửi lời mời' };
            }
        }
        return { already: false };
    """

    # Đoạn mã JS quét nút Follow và 3 chấm trên Header Profile
    JS_SCAN_PROFILE_BUTTONS = """
        function isNavTabLink(elem) {
            if (!elem) return true;
            if (elem.closest('[role="tab"]') || elem.closest('[role="tablist"]')) return true;
            if (elem.closest('nav') || elem.closest('[role="navigation"]')) return true;
            if (elem.closest('[role="banner"]')) return true;
            const href = elem.getAttribute('href') || (elem.querySelector('a') ? elem.querySelector('a').getAttribute('href') : '') || '';
            if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos') || href.includes('/reels')) return true;
            return false;
        }

        let followBtn = null;
        let moreBtn = null;

        // 1. Tìm nút 'Theo dõi' hoặc 'Follow' ngoài Header Profile
        const spans = Array.from(document.querySelectorAll('span'));
        for (const sp of spans) {
            const t = (sp.textContent || '').trim().toLowerCase();
            if (t !== 'follow' && t !== 'theo dõi') continue;

            const btn = sp.closest('div[role="button"]') ||
                        sp.closest('a[role="button"]') ||
                        sp.closest('[role="button"]') ||
                        sp.closest('.x1i10hfl');
            if (!btn || isNavTabLink(btn)) continue;
            if (btn.closest('[role="tab"]') && btn.getAttribute('href')) continue;

            const rect = btn.getBoundingClientRect();
            if (rect.top >= 60 && rect.top < 850 && rect.width > 20 && rect.height > 15) {
                followBtn = btn;
                break;
            }
        }

        if (!followBtn) {
            const afs = Array.from(document.querySelectorAll('[aria-label="Theo dõi" i], [aria-label="Follow" i]'));
            for (const af of afs) {
                if (isNavTabLink(af)) continue;
                const rect = af.getBoundingClientRect();
                if (rect.top >= 60 && rect.top < 850 && rect.width > 20) {
                    followBtn = af;
                    break;
                }
            }
        }

        // 2. Tìm nút 3 chấm (...) trong khu vực Header Profile
        const allSvgs = Array.from(document.querySelectorAll('svg'));
        for (const svg of allSvgs) {
            const circles = Array.from(svg.querySelectorAll('circle'));
            if (circles.length === 3) {
                const cxs = circles.map(c => (c.getAttribute('cx') || '').trim());
                if (cxs.includes('12') && (cxs.includes('19.5') || cxs.includes('4.5'))) {
                    const clickable = svg.closest('div[role="button"]') ||
                                      svg.closest('a[role="button"]') ||
                                      svg.closest('[role="button"]') ||
                                      svg.closest('.x1i10hfl') ||
                                      svg.closest('div[tabindex="0"]') ||
                                      svg.closest('.html-div') ||
                                      svg.parentElement;
                    if (clickable) {
                        const rect = clickable.getBoundingClientRect();
                        if (rect.top >= 60 && rect.top < 850 && rect.width >= 10 && rect.height >= 10) {
                            if (!clickable.closest('[role="article"]') && !clickable.closest('[role="feed"]')) {
                                moreBtn = clickable;
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (!moreBtn) {
            const allBtns = Array.from(document.querySelectorAll('div[role="button"], a[role="button"], div.x1i10hfl'));
            for (const b of allBtns) {
                const a = (b.getAttribute('aria-label') || '').toLowerCase();
                const hasSvg = b.querySelector('svg') !== null;
                const rect = b.getBoundingClientRect();
                if (rect.top >= 60 && rect.top < 850 && rect.width >= 15 && rect.height >= 15) {
                    if (!b.closest('[role="article"]') && !b.closest('[role="feed"]')) {
                        if (a.includes('xem thêm') || a.includes('see options') || a.includes('tùy chọn') || a.includes('options') || a.includes('more') || (hasSvg && a.length === 0 && rect.width < 50)) {
                            moreBtn = b;
                            break;
                        }
                    }
                }
            }
        }

        return {
            followBtn: followBtn,
            moreBtn: moreBtn
        };
    """

    # Quét menu popup 3 chấm của Profile
    JS_SCAN_PROFILE_MORE_MENU = """
        const allItems = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="menu"] div[role="button"], div[role="dialog"] div[role="button"], div.x1i10hfl, span'));
        let followItem = null;
        let alreadyFollowing = false;

        for (const el of allItems) {
            const t = (el.textContent || '').trim().toLowerCase();
            if (t === 'unfollow' || t === 'bỏ theo dõi' || t === 'following' || t === 'đang theo dõi') {
                alreadyFollowing = true;
                break;
            }
            if (t === 'follow' || t === 'theo dõi') {
                const clickable = el.closest('div[role="menuitem"]') ||
                                  el.closest('div[role="button"]') ||
                                  el.closest('a[role="button"]') ||
                                  el.closest('.x1i10hfl') ||
                                  el.closest('li') ||
                                  el;
                const rect = clickable.getBoundingClientRect();
                if (rect.width > 15 && rect.height > 10) {
                    followItem = clickable;
                    break;
                }
            }
        }

        return {
            followItem: followItem,
            alreadyFollowing: alreadyFollowing
        };
    """

    # Xác minh trạng thái sau khi bấm Follow trên Profile
    JS_VERIFY_PROFILE_FOLLOWED = """
        const spans = Array.from(document.querySelectorAll('span, div[role="button"], a[role="button"], div.x1i10hfl'));
        const isFollowing = spans.some(s => {
            const t = (s.textContent || '').trim().toLowerCase();
            const aria = (s.getAttribute('aria-label') || '').trim().toLowerCase();
            if (t === 'following' || t === 'đang theo dõi' || aria === 'following' || aria === 'đang theo dõi') {
                const rect = s.getBoundingClientRect();
                return rect.top >= 60 && rect.top < 850 && rect.width > 0;
            }
            return false;
        });
        if (isFollowing) return true;
        
        const stillHasFollow = spans.some(s => {
            const t = (s.textContent || '').trim().toLowerCase();
            if (t === 'follow' || t === 'theo dõi') {
                const btn = s.closest('div[role="button"]') || s.closest('.x1i10hfl');
                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    return rect.top >= 60 && rect.top < 850 && rect.width > 20;
                }
            }
            return false;
        });
        return !stillHasFollow;
    """


# =====================================================================
# 4. POST SEEDING LOCATORS (BÀI VIẾT: REACT, COMMENT, SHARE)
# =====================================================================
class PostLocators:
    """Các định danh phục vụ seeding bài viết (Cảm xúc, Bình luận, Chia sẻ Public)."""

    REACTION_CONFIG: Dict[str, Dict[str, Any]] = {
        "LIKE": {"vn": "Thích", "labels": ["Thích", "Like"], "emoji": "👍"},
        "LOVE": {"vn": "Yêu thích", "labels": ["Yêu thích", "Love"], "emoji": "❤️"},
        "CARE": {"vn": "Thương thương", "labels": ["Thương thương", "Care"], "emoji": "🥰"},
        "HAHA": {"vn": "Haha", "labels": ["Haha"], "emoji": "😆"},
        "WOW": {"vn": "Wow", "labels": ["Wow"], "emoji": "😮"},
        "SAD": {"vn": "Buồn", "labels": ["Buồn", "Sad"], "emoji": "😢"},
        "ANGRY": {"vn": "Phẫn nộ", "labels": ["Phẫn nộ", "Angry"], "emoji": "😡"},
    }

    # 4.1. Nút Like & Reactions Dock
    POST_LIKE_BUTTON_XPATHS = [
        "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
        "//div[@data-ad-rendering-role='like_button']/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
        "//div[@role='dialog']//div[@aria-label='Thích' or @aria-label='Like']",
        "//div[@aria-label='Thích' or @aria-label='Like']",
    ]

    # Nút Like chính của bài viết. Bố cục mới: khung nút chỉ có icon (sprite -441px khi chưa thích)
    # + div[data-ad-rendering-role="like_button"] RỖNG, không có chữ "Thích".
    JS_FIND_LIKE_BUTTON = """
        // Ưu tiên hộp thoại (mở sau cùng) có chứa nút Like của bài viết, không có thì tìm trên cả trang
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).reverse();
        let root = null, marker = null;
        for (const d of dialogs) {
            const m = d.querySelector('div[data-ad-rendering-role="like_button"]');
            if (m) { root = d; marker = m; break; }
        }
        if (!marker) {
            marker = document.querySelector('div[data-ad-rendering-role="like_button"]');
            root = marker ? document : (dialogs[0] || document);
        }
        let target = null;
        if (marker) {
            target = marker.closest('div[role="button"]') || marker.closest('div.x1i10hfl');
            if (!target && marker.parentElement && marker.parentElement.parentElement) {
                target = marker.parentElement.parentElement.querySelector('div[role="button"], div.x1i10hfl');
            }
        }
        if (!target) {
            target = Array.from(root.querySelectorAll('div[role="button"], div.x1i10hfl, div[tabindex="0"]')).find(el => {
                if (el.closest('ul') || el.closest('form')) return false;
                const a = (el.getAttribute('aria-label') || '').toLowerCase().trim();
                return a === 'like' || a === 'thích' || a === 'react' || a === 'thích bài viết';
            }) || null;
        }
        if (!target && marker && marker.parentElement) target = marker.parentElement;
        return target;
    """

    # Nút Like đã ở trạng thái "đã thích" chưa — chỉ tin dấu hiệu chắc chắn: aria-pressed, nhãn "Remove/Gỡ...",
    # hoặc CHỮ "Thích/Like" có màu (chữ xám r≈g≈b = chưa thích). Không dùng màu khung nút (khung thừa hưởng
    # màu chữ đen của trang nên luôn bị tưởng là "có màu" -> nhận nhầm là đã thích rồi bỏ qua, không bấm).
    JS_IS_LIKE_BUTTON_LIKED = """
        const btn = (() => {""" + JS_FIND_LIKE_BUTTON + """})();
        if (!btn) return false;
        if (btn.getAttribute('aria-pressed') === 'true') return true;
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('gỡ') || aria.includes('unlike') || aria.includes('bỏ thích') || aria.includes('remove')) return true;
        const textEl = Array.from(btn.querySelectorAll('span')).reverse().find(s => {
            const t = (s.textContent || '').trim().toLowerCase();
            return t === 'thích' || t === 'like';
        });
        if (textEl) {
            const nums = (window.getComputedStyle(textEl).color || '').match(/[\\d.]+/g) || [];
            const [r, g, b] = nums.slice(0, 3).map(Number);
            if (nums.length >= 3 && Math.max(r, g, b) - Math.min(r, g, b) > 40) return true;
        }
        return false;
    """

    # "Dấu vân tay" của nút cảm xúc để biết sau một lúc nút có bị đổi lại không (Facebook hoàn tác cảm xúc vừa thả):
    # nhãn aria + icon (class, vị trí sprite, ảnh). Không lấy chữ / số lượt thích để người khác thả cảm xúc
    # trong lúc đợi không bị tưởng là hoàn tác. null nếu không tìm thấy nút.
    JS_LIKE_BUTTON_SIGNATURE = """
        const btn = (() => {""" + JS_FIND_LIKE_BUTTON + """})();
        if (!btn) return null;
        const icons = Array.from(btn.querySelectorAll('i, img, svg')).map(el =>
            (el.getAttribute('class') || '') + '#' + (el.style ? el.style.backgroundPosition || '' : '') + '#' + (el.getAttribute('src') || '')
        );
        return [btn.getAttribute('aria-label') || '', btn.getAttribute('aria-pressed') || '', ...icons].join('|');
    """

    # Bấm Like đã có tác dụng chưa: nút báo "đã thích", hoặc nút đã đổi so với lúc trước khi bấm
    # (window.__seedLikeSigBefore). Facebook tô màu icon khi đã thích bằng cách đổi class của thẻ <i>.
    JS_LIKE_CLICK_TOOK_EFFECT = """
        if ((() => {""" + JS_IS_LIKE_BUTTON_LIKED + """})()) return true;
        const sig = (() => {""" + JS_LIKE_BUTTON_SIGNATURE + """})();
        return sig !== null && window.__seedLikeSigBefore !== undefined && sig !== window.__seedLikeSigBefore;
    """

    # 4.2. Khung Comment (Facebook Lexical Editor)
    COMMENT_BOX_XPATHS = [
        "//div[@data-lexical-editor='true' and @role='textbox']",
        "//div[@role='textbox' and (contains(@aria-label, 'Bình luận dưới tên') or contains(@aria-placeholder, 'Bình luận dưới tên'))]",
        "//div[@role='textbox' and (contains(@aria-label, 'Bình luận') or contains(@aria-placeholder, 'Bình luận'))]",
        "//div[@role='textbox' and (contains(@aria-label, 'Comment as') or contains(@aria-placeholder, 'Comment as') or contains(@aria-label, 'Write a comment'))]",
        "//div[contains(@class, 'notranslate') and @role='textbox' and @contenteditable='true']",
        "//div[@role='textbox' and @contenteditable='true']",
        "//div[@contenteditable='true' and @data-lexical-editor='true']",
        "//form[contains(@action, 'comment')]//div[@contenteditable='true']",
        "//form[contains(@action, 'comment')]//textarea",
        "//textarea[contains(@placeholder, 'Bình luận') or contains(@placeholder, 'comment')]",
        "//div[@contenteditable='true']",
    ]

    JS_FIND_COMMENT_BOX = """
        return document.querySelector('div[data-lexical-editor="true"][role="textbox"]') ||
               document.querySelector('div[role="textbox"][aria-label*="Bình luận dưới tên" i]') ||
               document.querySelector('div[role="textbox"][aria-placeholder*="Bình luận dưới tên" i]') ||
               document.querySelector('div[role="textbox"][aria-label*="bình luận" i]') ||
               document.querySelector('div[role="textbox"][contenteditable="true"]') ||
               document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
               document.querySelector('div[contenteditable="true"]');
    """

    # 4.3. Nút Chia sẻ (Share) & Hộp thoại Audience
    SHARE_BUTTON_XPATHS = [
        "//div[@role='dialog']//div[@data-ad-rendering-role='share_button']/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
        "//div[@role='dialog']//i[contains(@style, '-567px')]/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
        "//div[@role='dialog']//div[@role='button' and (@aria-label='Chia sẻ' or @aria-label='Share')]",
        "//div[@data-ad-rendering-role='share_button']/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
        "//i[contains(@style, '-567px')]/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
        "//div[@role='button' and (@aria-label='Chia sẻ' or @aria-label='Share')]",
    ]

    JS_FIND_SHARE_BUTTON = """
        const modal = document.querySelector('div[role="dialog"]');
        const root = modal || document;

        // 1. Quét theo data-ad-rendering-role='share_button'
        const marker = root.querySelector('div[data-ad-rendering-role="share_button"]');
        if (marker) {
            return marker.closest('div[role="button"]') || marker.closest('.x1i10hfl') || marker.closest('div.x9f619') || marker.parentElement;
        }

        // 2. Quét theo CSS sprite icon Share (background-position: 0px -567px)
        const shareIcons = Array.from(root.querySelectorAll('i[data-visualcompletion="css-img"]')).filter(i => {
            return (i.getAttribute('style') || '').includes('-567px');
        });
        if (shareIcons.length > 0) {
            return shareIcons[0].closest('div[role="button"]') || shareIcons[0].closest('.x1i10hfl') || shareIcons[0].parentElement;
        }

        // 3. Quét theo aria-label='Chia sẻ' hoặc 'Share'
        const ariaBtns = Array.from(root.querySelectorAll('div[role="button"], span[role="button"]')).filter(b => {
            const a = (b.getAttribute('aria-label') || '').toLowerCase();
            return a === 'chia sẻ' || a === 'share' || a.includes('share') || a.includes('chia sẻ');
        });
        if (ariaBtns.length > 0) {
            return ariaBtns[0];
        }

        return null;
    """

    JS_GET_AUDIENCE_PILL = """
        // 0. Ưu tiên: nút "Edit privacy. Sharing with ..." nằm trong hộp thoại chia sẻ (dialog mở sau cùng).
        //    aria-label vừa xác định đúng nút, vừa ghi rõ đối tượng đang chọn (Public / Friends).
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).reverse();
        for (const d of dialogs) {
            const btn = Array.from(d.querySelectorAll('div[role="button"][aria-label]')).find(b => {
                const a = (b.getAttribute('aria-label') || '').toLowerCase();
                return a.includes('privacy') || a.includes('quyền riêng tư');
            });
            if (btn) return btn;
        }

        // 1. Quét tìm theo icon chevron (-831px) đặc trưng duy nhất của nút chọn đối tượng
        const chevrons = Array.from(document.querySelectorAll('i[data-visualcompletion="css-img"]')).filter(i => {
            return (i.getAttribute('style') || '').includes('-831px');
        });
        for (const c of chevrons) {
            const pill = c.closest('.x1qhmfi1') || c.closest('div[role="button"]') || c.closest('.x6s0dn4') || c.parentElement;
            if (pill) {
                const rect = pill.getBoundingClientRect();
                if (rect.width > 15 && rect.height > 10) return pill;
            }
        }

        // 2. Quét tìm theo class .x1qhmfi1
        const qhList = Array.from(document.querySelectorAll('.x1qhmfi1')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 15 && rect.height > 10;
        });
        if (qhList.length > 0) {
            return qhList[0];
        }

        // 3. Quét theo thẻ img 12x12 alt Friends / Public trong dialog
        const smallImgs = Array.from(document.querySelectorAll('img')).filter(img => {
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            const w = img.getAttribute('width');
            return (w === '12' || w === '16') && (alt === 'friends' || alt === 'public' || alt === 'bạn bè' || alt === 'công khai');
        });
        for (const img of smallImgs) {
            const pill = img.closest('.x1qhmfi1') || img.closest('div[role="button"]') || img.closest('.x6s0dn4') || img.parentElement;
            if (pill) {
                const rect = pill.getBoundingClientRect();
                if (rect.width > 15 && rect.height > 10) return pill;
            }
        }

        return null;
    """

    # Phần tử bấm để mở menu "Post audience": khối .x1qhmfi1 trong hộp thoại Share, nằm cạnh nút "Feed"
    # (icon 12px alt Public/Friends + chữ đối tượng + mũi tên -831px). Nút "Feed" không có icon/mũi tên nên không bị bắt nhầm.
    JS_GET_AUDIENCE_CLICK_TARGET = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).reverse();
        for (const d of dialogs) {
            const block = Array.from(d.querySelectorAll('div.x1qhmfi1')).find(el => {
                const r = el.getBoundingClientRect();
                return r.width > 15 && r.height > 10
                    && el.querySelector('img[alt]')
                    && el.querySelector('i[data-visualcompletion="css-img"]');
            });
            if (block) return block;
        }
        // Dự phòng: tìm nút đối tượng như JS_GET_AUDIENCE_PILL
        return (() => {""" + JS_GET_AUDIENCE_PILL + """})();
    """

    # Menu "Post audience" đã mở chưa: dialog có chữ "Who can see your post" / "Post audience" (hoặc bản tiếng Việt),
    # hoặc có ít nhất 2 lựa chọn dạng radio đang hiện.
    JS_IS_AUDIENCE_MENU_OPEN = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        return dialogs.some(d => {
            const r = d.getBoundingClientRect();
            if (r.width < 50 || r.height < 50) return false;
            const t = (d.innerText || '').toLowerCase();
            if (t.includes('who can see your post') || t.includes('post audience')
                || t.includes('ai có thể xem') || t.includes('đối tượng của bài viết')) return true;
            const radios = Array.from(d.querySelectorAll('[role="radio"], input[type="radio"]')).filter(x => {
                const rr = x.getBoundingClientRect();
                return rr.width > 0 && rr.height > 0;
            });
            return radios.length >= 2;
        });
    """

    JS_IS_AUDIENCE_MENU_CLOSED = "return !(() => {" + JS_IS_AUDIENCE_MENU_OPEN + "})();"

    # Ô tick "Set as default audience" / "Đặt làm đối tượng mặc định" trong menu "Post audience":
    #   input[type=checkbox][value="default_privacy_checkbox"] (aria-labelledby trỏ tới chữ "Set as default audience.")
    # Dự phòng: checkbox có nhãn chứa "default audience" / "đối tượng mặc định".
    JS_GET_DEFAULT_AUDIENCE_CHECKBOX = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).reverse();
        for (const d of dialogs) {
            let box = d.querySelector('input[type="checkbox"][value="default_privacy_checkbox"]');
            if (!box) {
                box = Array.from(d.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).find(b => {
                    const id = b.getAttribute('aria-labelledby');
                    const label = id ? document.getElementById(id) : null;
                    const t = ((label ? label.textContent : '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
                    return t.includes('default audience') || t.includes('đối tượng mặc định');
                });
            }
            if (box) return box;
        }
        return null;
    """

    # Trạng thái ô tick: {checked, disabled} theo aria-checked / aria-disabled (Facebook dùng 2 thuộc tính này), null nếu không có ô.
    JS_DEFAULT_AUDIENCE_CHECKBOX_STATE = """
        const box = (() => {""" + JS_GET_DEFAULT_AUDIENCE_CHECKBOX + """})();
        if (!box) return null;
        const ac = box.getAttribute('aria-checked');
        const ad = box.getAttribute('aria-disabled');
        return {
            checked: ac !== null ? ac === 'true' : box.checked === true,
            disabled: ad !== null ? ad === 'true' : box.disabled === true
        };
    """

    JS_IS_DEFAULT_AUDIENCE_CHECKED = "const s = (() => {" + JS_DEFAULT_AUDIENCE_CHECKBOX_STATE + "})(); return !!(s && s.checked);"

    # Nút "Done" / "Xong" của menu "Post audience". Cấu trúc thật:
    #   [role=button?] > div[role=none] (có lớp phủ hover data-visualcompletion="ignore") > ... > span > span "Done"
    # Phần tử bấm: nút role="button" bao ngoài nếu có, nếu không thì khối div[role=none] ngoài cùng chứa lớp phủ hover.
    JS_GET_AUDIENCE_DONE_BUTTON = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).reverse();
        for (const d of dialogs) {
            const spans = Array.from(d.querySelectorAll('span')).filter(s => {
                const t = (s.innerText || s.textContent || '').trim().toLowerCase();
                return (t === 'done' || t === 'xong') && !s.querySelector('span');
            });
            for (const s of spans) {
                let target = s.closest('[role="button"]');
                if (!target) {
                    let el = s.closest('div[role="none"]');
                    while (el) {
                        if (el.querySelector(':scope > [data-visualcompletion="ignore"]')) { target = el; break; }
                        el = el.parentElement ? el.parentElement.closest('div[role="none"]') : null;
                    }
                }
                target = target || s;
                const r = target.getBoundingClientRect();
                if (r.width > 20 && r.height > 10) return target;
            }
        }
        return null;
    """

    JS_FIND_SHARE_NOW_BUTTON = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        const shareDialog = dialogs.find(d => {
            const text = (d.textContent || '').toLowerCase();
            return text.includes('share now') || text.includes('chia sẻ ngay') || text.includes('say something');
        }) || dialogs[dialogs.length - 1] || document;

        const spans = Array.from(shareDialog.querySelectorAll('span')).filter(s => {
            const t = (s.innerText || s.textContent || '').trim().toLowerCase();
            return t === 'share now' || t === 'chia sẻ ngay';
        });

        for (const s of spans) {
            const btn = s.closest('div[role="button"]') || s.closest('.x1i10hfl') || s.closest('div.x9f619') || s.parentElement;
            const rect = btn.getBoundingClientRect();
            if (rect.width > 20 && rect.height > 10) {
                return { btn: btn, span: s };
            }
        }

        const ariaBtns = Array.from(shareDialog.querySelectorAll('div[role="button"]')).filter(b => {
            const a = (b.getAttribute('aria-label') || '').trim().toLowerCase();
            return a === 'share now' || a === 'chia sẻ ngay';
        });
        if (ariaBtns.length > 0) {
            return { btn: ariaBtns[0], span: null };
        }

        return null;
    """
