"""
locators.py
Từ điển tập trung tất cả XPath selectors cho automation Facebook.
Hỗ trợ song ngữ hoàn hảo (Việt - Anh) kết hợp ID tĩnh Facebook HTML.
"""

# ─────────────── UC-03: LOGIN FLOW ───────────────

LOGIN = {
    "email_input": [
        '//input[@id="email"]',
        '//input[@name="email"]',
        '//input[@data-testid="royal_email"]',
        '//input[@type="text" and @name="email"]',
        '//input[contains(@aria-label, "Email") or contains(@aria-label, "email") or contains(@aria-label, "phôn") or contains(@aria-label, "Phone") or contains(@aria-label, "phone") or contains(@aria-label, "Số điện thoại")]',
        '//input[@type="text"]',
    ],
    "password_input": [
        '//input[@id="pass"]',
        '//input[@name="pass"]',
        '//input[@data-testid="royal_pass"]',
        '//input[@type="password" and @name="pass"]',
        '//input[@type="password"]',
    ],
    "login_button": [
        '//div[@aria-label="Log in" or @aria-label="Log In" or @aria-label="Đăng nhập" or @aria-label="Đăng Nhập" or @aria-label="log in" or @aria-label="đăng nhập" and @role="button"]',
        '//button[@name="login"]',
        '//button[@type="submit"]',
        '//button[contains(@id, "u_0_")]',
        '//button[contains(@id, "loginbutton")]',
        '//div[@role="button"]//span[text()="Log in" or text()="Log In" or text()="Đăng nhập" or text()="Đăng Nhập" or text()="log in" or text()="đăng nhập"]',
        '//input[@value="Log in" or @value="Log In" or @value="Đăng nhập" or @value="Đăng Nhập"]',
        '//button[contains(text(), "Log In") or contains(text(), "Log in") or contains(text(), "Đăng nhập") or contains(text(), "Đăng Nhập")]',
    ],
    "two_fa_input": [
        '//input[@type="text" and (../label[normalize-space(text())="Code" or normalize-space(text())="Mã"] or following-sibling::label[normalize-space(text())="Code" or normalize-space(text())="Mã"])]',
        '//label[normalize-space(text())="Code" or normalize-space(text())="Mã" or text()="Mã xác thực" or text()="Authentication code" or text()="Login code"]/parent::div//input[@type="text"]',
        '//label[text()="Code" or text()="Mã" or text()="Mã xác thực" or text()="Authentication code" or text()="Login code"]/ancestor::div[contains(@class,"x78zum5")]//input[@type="text"]',
        '//label[contains(text(),"Code") or contains(text(),"Mã") or contains(text(),"code") or contains(text(),"mã")]/..//input[@type="text"]',
        '//form//input[@type="text" and not(@aria-hidden="true")]',
        '//input[@id="approvals_code"]',
        '//input[@name="approvals_code"]',
        '//input[@autocomplete="one-time-code"]',
        '//input[@type="text" and (contains(@placeholder, "code") or contains(@placeholder, "mã") or contains(@placeholder, "Code") or contains(@placeholder, "Mã"))]',
    ],
    "two_fa_submit": [
        '//div[contains(@class, "xod5an3")]//div[@role="button"][.//span[normalize-space(text())="Continue" or normalize-space(text())="Tiếp tục" or normalize-space(text())="continue" or normalize-space(text())="tiếp tục"]]',
        '//div[@role="button"][.//span[normalize-space(text())="Continue" or normalize-space(text())="Tiếp tục" or normalize-space(text())="continue" or normalize-space(text())="tiếp tục"]]',
        '//span[normalize-space(text())="Continue" or normalize-space(text())="Tiếp tục" or normalize-space(text())="continue" or normalize-space(text())="tiếp tục"]/ancestor::div[@role="button"][1]',
        '//form/following-sibling::div//div[@role="button"][.//span[normalize-space(text())="Continue" or normalize-space(text())="Tiếp tục"]]',
        '//button[@id="checkpointSubmitButton"]',
        '//button[normalize-space(text())="Continue" or normalize-space(text())="Tiếp tục" or normalize-space(text())="continue" or normalize-space(text())="tiếp tục"]',
        '//div[@role="button" and (@aria-label="Continue" or @aria-label="Tiếp tục" or @aria-label="continue" or @aria-label="tiếp tục")]',
    ],
    "try_another_way_button": [
        '//span[text()="Try another way" or text()="Thử phương thức khác" or text()="Thử cách khác"]/ancestor::div[contains(@class, "x1ja2u2z") or @role="none" or @role="button"][1]',
        '//span[contains(text(), "Try another way") or contains(text(), "Thử phương thức khác") or contains(text(), "Thử cách khác")]',
        '//div[contains(text(), "Try another way") or contains(text(), "Thử phương thức khác")]',
    ],
    "auth_app_option": [
        '//div[contains(text(), "Authentication app") or contains(text(), "Ứng dụng xác thực")]/ancestor::div[contains(@class, "html-div") or contains(@class, "x9f619")][1]',
        '//span[contains(text(), "Authentication app") or contains(text(), "Ứng dụng xác thực")]',
        '//div[contains(text(), "Authentication app") or contains(text(), "Ứng dụng xác thực")]',
        '//input[@type="radio" and @value="1"]',
    ],
    "continue_button": [
        '//span[text()="Continue" or text()="Tiếp tục" or text()="continue" or text()="tiếp tục"]/ancestor::div[contains(@class, "x1ja2u2z") or @role="none" or @role="button"][1]',
        '//span[contains(text(), "Continue") or contains(text(), "Tiếp tục")]',
        '//div[@aria-label="Continue" or @aria-label="Tiếp tục" and @role="button"]',
    ],
    "dismiss_button": [
        '//div[contains(@class, "x1ja2u2z") and contains(@class, "x78zum5")]//span[text()="Dismiss" or text()="Bỏ qua" or text()="Lúc khác" or text()="Not Now" or text()="Not now"]',
        '//span[contains(@class, "x1lliihq") and contains(@class, "x6ikm8r") and (text()="Dismiss" or text()="Bỏ qua" or text()="dismiss" or text()="bỏ qua")]/ancestor::div[contains(@class, "x1ja2u2z")][1]',
        '//span[text()="Dismiss" or text()="Bỏ qua" or text()="dismiss" or text()="bỏ qua" or text()="Lúc khác" or text()="Not Now" or text()="Not now"]/ancestor::div[contains(@class, "x1ja2u2z") or @role="none" or @role="button"][1]',
        '//span[contains(@class, "x1lliihq") and (text()="Dismiss" or text()="Bỏ qua" or text()="dismiss" or text()="bỏ qua")]',
        '//div[contains(@class, "x1ja2u2z")]//span[text()="Dismiss" or text()="Bỏ qua" or text()="dismiss" or text()="bỏ qua"]',
        '//span[text()="Dismiss" or text()="Bỏ qua" or text()="dismiss" or text()="bỏ qua"]',
        '//div[@aria-label="Dismiss" or @aria-label="Bỏ qua" or @aria-label="Close" or @aria-label="Đóng"]',
    ],
    "trust_device_button": [
        '//span[text()="Trust this device" or text()="Tin cậy thiết bị này" or text()="Lưu trình duyệt"]/ancestor::div[@role="button"][1]',
        '//div[@role="button"]//span[text()="Trust this device" or text()="Tin cậy thiết bị này" or text()="Lưu trình duyệt"]',
        '//div[@role="button" and (contains(., "Trust this device") or contains(., "Tin cậy thiết bị") or contains(., "Lưu trình duyệt"))]',
        '//span[contains(text(), "Trust this device") or contains(text(), "Tin cậy thiết bị")]/ancestor::div[@role="button"][1]',
        '//span[contains(text(), "Trust this device") or contains(text(), "Tin cậy thiết bị")]',
    ],
    "profile_name_span": [
        '//span[contains(@class, "x1lliihq") and contains(@class, "x6ikm8r") and contains(@class, "x10wlt62") and contains(@class, "x1n2onr6") and contains(@style, "line-clamp")]',
        '//span[contains(@class, "x1lliihq") and contains(@class, "x6ikm8r") and contains(@class, "x10wlt62") and contains(@class, "x1n2onr6")]',
        '//span[contains(@class, "x1lliihq") and contains(@class, "x10wlt62") and contains(@style, "-webkit-line-clamp")]',
        '//span[@style="-webkit-box-orient:vertical;-webkit-line-clamp:2;display:-webkit-box"]',
        '//span[contains(@style, "line-clamp:2") or contains(@style, "line-clamp: 2")]',
        '//div[@role="navigation"]//span[contains(@class, "x1lliihq") and contains(@class, "x10wlt62") and contains(@class, "x1n2onr6")]',
        '//div[@aria-label="Your profile" or @aria-label="Trang cá nhân của bạn" or @aria-label="Account" or @aria-label="Tài khoản"]//span[contains(@class, "x1lliihq")]',
        '//h1[contains(@class, "x1heor9g")]',
        '//h1',
        '//*[@role="main"]//h1',
    ],
    "profile_name_h1": [
        '//h1[contains(@class, "x1heor9g")]',
        '//h1',
        '//*[@role="main"]//h1',
        '//span[contains(@class, "x1lliihq")]',
        '//span[contains(@class, "x6ikm8r")]',
        '//span[contains(@class, "x10wlt62")]',
        '//span[contains(@class, "x1n2onr6")]',
    ],
}

