"""Locator tạo page và cấp admin."""

PAGE_CREATION = {
    # 1. Tên trang (Bắt theo ID gốc HTML + Text song ngữ VI/EN)
    "page_name_input": [
        '//input[@id="_r_5a_"]',
        '//input[contains(@aria-label, "Tên trang") or contains(@aria-label, "Tên Trang") or contains(@aria-label, "Page name") or contains(@aria-label, "Page Name") or contains(@aria-label, "page name")]',
        '//span[contains(text(),"Tên trang") or contains(text(),"Tên Trang") or contains(text(),"Page name") or contains(text(),"Page Name")]/ancestor::label//input',
        '//span[contains(text(),"Tên trang") or contains(text(),"Tên Trang") or contains(text(),"Page name") or contains(text(),"Page Name")]/following::input[1]',
        '(//div[@role="main"]//input[@type="text" or not(@type)])[1]',
        '(//input[@type="text" or not(@type)])[1]',
    ],
    # 2. Hạng mục (Bắt theo ID gốc HTML + Text song ngữ VI/EN)
    "category_input": [
        '//input[@id="_r_5h_"]',
        '//input[contains(@aria-label, "Hạng mục") or contains(@aria-label, "Category") or contains(@aria-label, "category")]',
        '//span[contains(text(),"Hạng mục") or contains(text(),"Category") or contains(text(),"category")]/ancestor::label//input',
        '//input[contains(@placeholder, "Hạng mục") or contains(@placeholder, "Category") or contains(@placeholder, "category")]',
        '//input[@role="combobox" and @type="search"]',
        '(//div[@role="main"]//input[@type="search" or @role="combobox"])[1]',
    ],
    "category_first_suggestion": [
        '//div[@role="listbox"]//div[@role="option"][1]',
        '//ul[@role="listbox"]//li[1]',
        '//div[contains(@id,"typeahead")]//div[@role="option"][1]',
        '//div[@role="option"][1]',
    ],
    # 3. Tiểu sử (Bắt theo ID gốc HTML + Text song ngữ VI/EN)
    "bio_textarea": [
        '//textarea[@id="_r_5l_"]',
        '//textarea[contains(@aria-label, "Tiểu sử") or contains(@aria-label, "Bio") or contains(@aria-label, "bio")]',
        '//span[contains(text(),"Tiểu sử") or contains(text(),"Bio") or contains(text(),"bio")]/ancestor::label//textarea',
        '//textarea[contains(@placeholder, "Tiểu sử") or contains(@placeholder, "Bio") or contains(@placeholder, "bio")]',
        '//textarea',
    ],
    # 4. Nút Tạo Trang (Song ngữ VI/EN)
    "create_page_button": [
        '//div[@aria-label="Tạo Trang" or @aria-label="Tạo trang" or @aria-label="Create Page" or @aria-label="Create page" and @role="button"]',
        '//span[text()="Tạo Trang" or text()="Tạo trang" or text()="Create Page" or text()="Create page"]/ancestor::div[@role="button"]',
        '//div[@role="button" and (contains(.,"Tạo Trang") or contains(.,"Tạo trang") or contains(.,"Create Page") or contains(.,"Create page"))]',
    ],
    # 5. Mã quốc gia (Song ngữ VI/EN)
    "country_code_selector": [
        # FB EN: aria-label="Country code, US +1" — phải match trước khi mặc định Mỹ làm kẹt Next
        '//div[@role="button" and (starts-with(@aria-label, "Country code") or starts-with(@aria-label, "Mã quốc gia"))]',
        '//div[contains(@aria-label, "Mã quốc gia") or contains(@aria-label, "Country code") or contains(@aria-label, "Country Code")]',
        '//div[@role="combobox" and (contains(@aria-label, "quốc gia") or contains(@aria-label, "country") or contains(@aria-label, "Country"))]',
    ],
    "country_vietnam_option": [
        '//div[@role="option" or @role="menuitem" or @role="menuitemradio"][contains(., "Việt Nam") or contains(., "Vietnam")][contains(., "+84") or contains(., "84")]',
        '//div[@role="option" or @role="button" or @role="menuitem"][contains(., "Việt Nam") or contains(., "Vietnam") or contains(., "+84")]',
        '//span[contains(text(), "Việt Nam") or contains(text(), "Vietnam")][contains(., "+84") or contains(../., "+84")]',
    ],
    # 6. SĐT (Song ngữ VI/EN)
    "phone_input": [
        '//input[@id="_r_6a_"]',
        '//input[@type="tel"]',
        '//input[contains(@aria-label, "Số điện thoại") or contains(@aria-label, "Phone number") or contains(@aria-label, "Phone Number") or contains(@aria-label, "Phone") or contains(@aria-label, "phone")]',
        '//span[contains(text(),"Số điện thoại") or contains(text(),"Phone") or contains(text(),"phone")]/following::input[1]',
    ],
    # 7. Email (Song ngữ VI/EN)
    "email_input": [
        '//input[@id="_r_5l_" and @type="text"]',
        '//input[@type="email"]',
        '//input[contains(@aria-label, "Email") or contains(@aria-label, "email") or contains(@aria-label, "Email address") or contains(@aria-label, "Địa chỉ email")]',
        '//span[contains(text(),"Email") or contains(text(),"email")]/following::input[1]',
    ],
    # 8. Địa chỉ (Song ngữ VI/EN)
    "street_input": [
        '//input[@id="_r_5p_"]',
        '//input[contains(@aria-label, "Đường") or contains(@aria-label, "Street") or contains(@aria-label, "Địa chỉ") or contains(@aria-label, "Address")]',
    ],
    "city_input": [
        '//input[contains(@aria-label, "Thành phố") or contains(@aria-label, "City") or contains(@aria-label, "Tỉnh")]',
    ],
    "zip_input": [
        '//input[contains(@aria-label, "Mã bưu chính") or contains(@aria-label, "ZIP") or contains(@aria-label, "Zip")]',
    ],
    # 9. Giờ làm việc "Luôn mở cửa" (Song ngữ VI/EN)
    "always_open_radio": [
        '//input[@type="radio" and (contains(@value, "always_open") or contains(@aria-label, "Luôn mở cửa") or contains(@aria-label, "Always open"))]',
        '//span[contains(text(), "Luôn mở cửa") or contains(text(), "Always open")]/ancestor::label//input[@type="radio"]',
        '//span[contains(text(), "Luôn mở cửa") or contains(text(), "Always open")]',
    ],
    # 10. Nút Tiếp (Song ngữ VI/EN)
    "next_button": [
        '//span[text()="Tiếp" or text()="tiếp" or text()="Next" or text()="next"]/ancestor::div[@role="button"]',
        '//div[@aria-label="Tiếp" or @aria-label="tiếp" or @aria-label="Next" or @aria-label="next"]',
    ],
    # 11-12. Upload Avatar & Cover
    "avatar_file_input": [
        '(//input[@type="file" and contains(@accept, "image")])[1]',
        '(//input[@type="file"])[1]',
    ],
    "cover_file_input": [
        '(//input[@type="file" and contains(@accept, "image")])[2]',
        '(//input[@type="file"])[2]',
    ],
    # 13. Nút Bỏ qua (Song ngữ VI/EN)
    "skip_whatsapp_button": [
        '//span[text()="Bỏ qua" or text()="bỏ qua" or text()="Skip" or text()="skip"]/ancestor::div[@role="button"]',
        '//div[@aria-label="Bỏ qua" or @aria-label="bỏ qua" or @aria-label="Skip" or @aria-label="skip"]',
    ],
    # 14. Nút Xong (Song ngữ VI/EN)
    "done_button": [
        '//span[text()="Xong" or text()="xong" or text()="Done" or text()="done" or text()="Hoàn tất" or text()="Hoàn Tất"]/ancestor::div[@role="button"]',
        '//div[@aria-label="Xong" or @aria-label="xong" or @aria-label="Done" or @aria-label="done" or @aria-label="Hoàn tất"]',
    ],
    # Đăng bài viết (Bilingual VI/EN - Tùy chỉnh chuẩn HTML Facebook)
    "post_box": [
        '//div[@role="button" and .//span[contains(text(), "Bạn đang nghĩ gì") or contains(text(), "What\'s on your mind")]]',
        '//div[@role="button" and (contains(@aria-label, "Bạn đang nghĩ gì") or contains(@aria-label, "What\'s on your mind") or contains(@aria-label, "Tạo bài viết") or contains(@aria-label, "Create post"))]',
        '//span[contains(text(), "Bạn đang nghĩ gì") or contains(text(), "What\'s on your mind")]/ancestor::div[@role="button"]',
        '//div[@role="button" and (contains(., "Bạn đang nghĩ gì") or contains(., "What\'s on your mind") or contains(., "Tạo bài viết") or contains(., "Create post"))]',
    ],
    "post_text_area": [
        '//div[@role="dialog"]//div[@role="textbox" and @contenteditable="true"]',
        '//div[@role="textbox" and @contenteditable="true" and (contains(@aria-placeholder, "Bạn đang nghĩ gì") or contains(@aria-placeholder, "What\'s on your mind") or @data-lexical-editor="true")]',
        '//div[@role="textbox" and @contenteditable="true"]',
    ],
    "post_image_button": [
        '//div[@role="dialog"]//div[@role="button" and (contains(@aria-label, "Ảnh/video") or contains(@aria-label, "Photo/video") or contains(@aria-label, "Photo/Video") or contains(., "Ảnh/video") or contains(., "Photo/video"))]',
        '//div[@role="dialog"]//span[contains(text(), "Ảnh/video") or contains(text(), "Photo/video")]/ancestor::div[@role="button"]',
        '//div[@role="button" and (contains(@aria-label, "Ảnh/video") or contains(@aria-label, "Photo/video") or contains(., "Ảnh/video") or contains(., "Photo/video"))]',
        '//span[contains(text(), "Ảnh/video") or contains(text(), "Photo/video")]/ancestor::div[@role="button"]',
    ],
    "post_file_input": [
        '//div[@role="dialog"]//input[@type="file" and contains(@accept, "image")]',
        '//div[@role="dialog"]//input[@type="file"]',
        '(//input[@type="file" and contains(@accept, "image")])[1]',
    ],
    "post_next_button": [
        '//div[@role="dialog"]//div[@role="button" and (@aria-label="Tiếp" or @aria-label="Next" or contains(., "Tiếp") or contains(., "Next"))]',
        '//div[@role="dialog"]//span[text()="Tiếp" or text()="Next"]/ancestor::div[@role="button"]',
        '//div[@role="button" and (@aria-label="Tiếp" or @aria-label="Next")]',
    ],
    "post_submit_button": [
        # Modal Post settings (UI page mới sau Next)
        '//div[@role="dialog"][.//span[contains(., "Post settings") or contains(., "Cài đặt bài viết")]]'
        '//div[@role="button"][.//span[normalize-space()="Post" or normalize-space()="Đăng"]]',
        '//div[@role="dialog"][.//span[contains(., "Post settings") or contains(., "Cài đặt bài viết")]]'
        '//*[@role="button" and (@aria-label="Post" or @aria-label="Đăng")]',
        '//div[@role="dialog"]//span[normalize-space()="Post" or normalize-space()="Đăng"]'
        '/ancestor::*[@role="button"][1]',
        '//div[contains(@class, "x1i10hfl") and @role="button" and @tabindex="0" and (@aria-label="Post" or @aria-label="Đăng")]',
        '//div[@role="button" and @tabindex="0" and (@aria-label="Post" or @aria-label="Đăng")]',
        '//div[@role="button" and (@aria-label="Post" or @aria-label="Đăng")]',
        '//div[@role="dialog"]//div[@role="button" and (@aria-label="Post" or @aria-label="Đăng")]',
        '//div[contains(@class, "x1ja2u2z")]//span[text()="Post" or text()="Đăng"]/ancestor::div[@role="button" and @tabindex="0"][1]',
        '//span[text()="Post" or text()="Đăng"]/ancestor::div[@role="button" and @tabindex="0"][1]',
        '//span[normalize-space()="Post" or normalize-space()="Đăng"]/ancestor::*[@role="button"][1]',
    ],
}

# ─────────────── UC-06: SHARE ADMIN FLOW ───────────────

SHARE_ADMIN = {
    # Nút Thêm mới (Song ngữ VI/EN)
    "add_new_button": [
        '//span[text()="Thêm mới" or text()="Thêm Mới" or text()="Add new" or text()="Add New" or text()="add new"]/ancestor::div[@role="button"]',
        '//div[contains(@aria-label, "Thêm mới") or contains(@aria-label, "Thêm Mới") or contains(@aria-label, "Add new") or contains(@aria-label, "Add New") or contains(@aria-label, "add new")]',
        '//span[contains(text(),"Thêm mới") or contains(text(),"Thêm Mới") or contains(text(),"Add new") or contains(text(),"Add New")]/ancestor::div[contains(@role, "button")]',
        '//div[@role="button" and (contains(., "Thêm mới") or contains(., "Add new"))]',
    ],
    # Nút Tiếp (Song ngữ VI/EN)
    "intro_next_button": [
        '//div[@role="dialog"]//span[text()="Tiếp" or text()="tiếp" or text()="Next" or text()="next"]/ancestor::div[@role="button"]',
        '//div[@role="dialog"]//div[@aria-label="Tiếp" or @aria-label="tiếp" or @aria-label="Next" or @aria-label="next"]',
        '//span[text()="Tiếp" or text()="tiếp" or text()="Next" or text()="next"]/ancestor::div[@role="button"]',
        '//div[@aria-label="Tiếp" or @aria-label="tiếp" or @aria-label="Next" or @aria-label="next"]',
    ],
    # Ô tìm kiếm trong popup Cấp Quyền Admin (Bọc trong //div[@role="dialog"] để tránh dán nhầm vào ô tìm kiếm chính của FB)
    "search_admin_input": [
        '//div[@role="dialog"]//input[@type="search" or @type="text"]',
        '//div[@role="dialog"]//input[contains(@aria-label, "Tìm kiếm") or contains(@aria-label, "Search") or contains(@placeholder, "Search") or contains(@placeholder, "Tìm kiếm")]',
        '//div[@role="dialog"]//input',
    ],
    # Kết quả tìm kiếm
    "first_search_result": [
        '//div[@role="listbox"]//div[@role="option"][1]',
        '//div[@role="dialog"]//div[@role="listbox"]//div[contains(@class, "x9f619")][1]',
        '//div[@role="listbox"]//span[1]',
        '//div[@role="dialog"]//ul[@role="listbox"]//li[1]',
        '//div[@role="dialog"]//div[contains(@class, "x1ja2u2z") and .//span][1]',
    ],
    # Công tắc Toàn quyền (Song ngữ VI/EN)
    "full_control_switch": [
        '//div[@role="dialog"]//div[contains(@class, "xod5an3")]//input[@role="switch"]',
        '//div[contains(@class, "xod5an3")]//input[@role="switch"]',
        '//div[@role="dialog"]//input[@role="switch"]',
        '//div[contains(@class, "xod5an3")]//input[@type="checkbox"]',
        '//div[@role="dialog"]//input[contains(@class, "x1i10hfl") and @role="switch"]',
        '//div[@role="dialog"]//input[contains(@aria-label, "Đã bật") or contains(@aria-label, "Đã tắt") or contains(@aria-label, "Toàn quyền") or contains(@aria-label, "Full control") or contains(@aria-label, "Allow")]',
        '//div[@role="dialog"]//span[contains(text(),"Toàn quyền") or contains(text(),"Full control") or contains(text(),"Cho phép")]/ancestor::div[contains(@class, "xod5an3") or contains(@class, "x1n2onr6")]//input',
    ],
    # Container / Nhãn của công tắc để click thay thế
    "full_control_switch_container": [
        '//div[@role="dialog"]//div[contains(@class, "xod5an3")]',
        '//div[contains(@class, "xod5an3")]',
        '//div[@role="dialog"]//input[@role="switch"]/ancestor::div[contains(@class, "xod5an3")][1]',
        '//div[@role="dialog"]//input[@role="switch"]/parent::div',
        '//div[@role="dialog"]//input[@role="switch"]/ancestor::div[contains(@class, "x1ja2u2z") or contains(@class, "xod5an3") or contains(@class, "x1a2a7pz")][1]',
        '//div[@role="dialog"]//span[contains(text(),"Toàn quyền") or contains(text(),"Full control") or contains(text(),"Cho phép")]/ancestor::div[contains(@class, "xod5an3") or contains(@class, "x1n2onr6")][1]',
    ],
    # Nút Cấp quyền truy cập (Song ngữ VI/EN)
    "grant_access_button": [
        '//div[@role="dialog"]//span[text()="Cấp quyền truy cập" or text()="Cấp Quyền Truy Cập" or text()="Give access" or text()="Give Access" or text()="give access"]/ancestor::div[@role="button"]',
        '//div[@role="dialog"]//div[contains(@aria-label, "Cấp quyền truy cập") or contains(@aria-label, "Give access") or contains(@aria-label, "Give Access")]',
        '//span[text()="Cấp quyền truy cập" or text()="Cấp Quyền Truy Cập" or text()="Give access" or text()="Give Access"]/ancestor::div[@role="button"]',
        '//div[contains(@aria-label, "Cấp quyền truy cập") or contains(@aria-label, "Give access")]',
    ],
    # Mật khẩu xác nhận
    "password_confirm_input": [
        '//div[@role="dialog"]//input[@type="password"]',
        '//input[@type="password"]',
    ],
    # Nút Xác nhận mật khẩu (Song ngữ VI/EN)
    "confirm_password_button": [
        '//div[@role="dialog"]//div[@role="button" and (contains(@aria-label, "Xác nhận") or contains(@aria-label, "Confirm") or contains(., "Xác nhận") or contains(., "Confirm"))]',
        '//div[@role="dialog"]//span[text()="Xác nhận" or text()="Xác Nhận" or text()="Confirm" or text()="confirm"]/ancestor::div[@role="button"]',
        '//span[text()="Xác nhận" or text()="Xác Nhận" or text()="Confirm" or text()="confirm"]/ancestor::div[@role="button"]',
        '//div[@aria-label="Xác nhận" or @aria-label="Confirm" or @aria-label="xác nhận" or @aria-label="confirm"]',
    ],
}

