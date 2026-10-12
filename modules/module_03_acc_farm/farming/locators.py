"""
locators.py
XPath cho các kịch bản Tương tác nuôi tài khoản (Module 03 - Tab 1).
"""

# ─────────────── UC-M03: TƯƠNG TÁC NUÔI TÀI KHOẢN ───────────────
# Điều kiện or luôn được bọc ngoặc trước khi and với @role để XPath không hiểu sai thứ tự ưu tiên.

FARM_COMMON = {
    # Dialog báo bị chặn / hạn chế tính năng (chỉ tìm trong dialog để tránh nhận nhầm chữ trong bài viết)
    "blocked_dialog": [
        '//div[@role="dialog" or @role="alertdialog"][.//*[contains(., "tạm thời bị chặn") or contains(., "bị chặn sử dụng") '
        'or contains(., "Bạn không thể sử dụng tính năng này") or contains(., "không thể tham gia nhóm lúc này") '
        'or contains(., "temporarily blocked") or contains(., "can\'t use this feature") or contains(., "can’t use this feature") '
        'or contains(., "can\'t join groups right now") or contains(., "can’t join groups right now")]]',
    ],
    # Popup thông báo trạng thái tài khoản ("What happened" / "We added a restriction to your account"),
    # không chặn thao tác nên chỉ cần đóng. Nhận diện qua chữ để không đóng nhầm dialog flow đang dùng.
    "notice_dialog": [
        # Không khớp riêng tiêu đề "What happened" vì bài viết mở dạng dialog có thể chứa đúng cụm này.
        # Loại bảng Thông báo (có tab Unread / Chưa đọc): một dòng thông báo có thể chứa cụm hạn chế.
        '//div[@role="dialog" or @role="alertdialog"][.//*[contains(., "added a restriction") '
        'or contains(., "can\'t create multiple sessions") or contains(., "can’t create multiple sessions") '
        'or contains(., "đã thêm hạn chế") or contains(., "không thể tạo nhiều phiên")]]'
        '[not(.//*[normalize-space()="Unread" or normalize-space()="Chưa đọc"])]',
    ],
    # Nút X trong popup thông báo, tìm tương đối trong dialog để không bấm nhầm nút X của bài viết
    "notice_close": [
        './/div[@role="button" and (@aria-label="Close" or @aria-label="Đóng")]',
    ],
    # Nút đóng / hủy trong dialog đang mở
    "dialog_close": [
        '//div[@role="dialog"]//div[@role="button" and (@aria-label="Đóng" or @aria-label="Close")]',
        '//div[@role="dialog"]//span[normalize-space()="Hủy" or normalize-space()="Cancel" or normalize-space()="Đóng" or normalize-space()="Close" or normalize-space()="OK"]/ancestor::div[@role="button"][1]',
    ],
}

FARM_WATCH = {
    "unmute_button": [
        '//div[@role="button" and (@aria-label="Bật tiếng" or @aria-label="Unmute")]',
    ],
    # Nút sang Reel kế trong trình xem /reel/ (dự phòng khi phím ArrowDown không chuyển; nhãn chưa kiểm chứng trên nick thật)
    "next_reel": [
        '//div[@role="button" and (@aria-label="Next card" or @aria-label="Next Card" or @aria-label="Thẻ tiếp theo")]',
    ],
}

FARM_FRIEND = {
    "add_friend_buttons": [
        '//div[@role="button" and (@aria-label="Thêm bạn bè" or @aria-label="Add friend" or @aria-label="Add Friend")]',
        '//span[normalize-space()="Thêm bạn bè" or normalize-space()="Add friend" or normalize-space()="Add Friend"]/ancestor::div[@role="button"][1]',
        # Danh sách thành viên nhóm: nhãn có kèm tên người, vd "Add Friend Holly Lane"
        '//div[@role="button" and (starts-with(@aria-label, "Thêm bạn bè ") or starts-with(@aria-label, "Add Friend ") or starts-with(@aria-label, "Add friend "))]',
    ],
    # Popup "Bạn có biết người này không?" Facebook hiện khi nghi ngờ kết bạn người lạ
    "know_person_dialog": [
        '//div[@role="dialog"][.//*[contains(., "có biết") or contains(., "Do you know")]]',
    ],
}

FARM_GROUP = {
    "join_buttons": [
        '//div[@role="button" and (@aria-label="Tham gia nhóm" or @aria-label="Join group" or @aria-label="Join Group")]',
        '//span[normalize-space()="Tham gia nhóm" or normalize-space()="Join group" or normalize-space()="Join Group"]/ancestor::div[@role="button"][1]',
        # Trang nhóm đề xuất: nhãn có kèm tên nhóm, vd "Join group, Germany Lovers"
        '//div[@role="button" and (starts-with(@aria-label, "Tham gia nhóm") or starts-with(@aria-label, "Join group") or starts-with(@aria-label, "Join Group"))]',
    ],
    # Chỉ dialog có nút Gửi hoặc ô trả lời mới là form tham gia nhóm; dialog khác không làm hỏng lượt tham gia
    "open_dialog": [
        '//div[@role="dialog"][.//span[normalize-space()="Gửi" or normalize-space()="Submit"] '
        'or .//textarea or .//input[@type="text" or @type="checkbox" or @type="radio"] '
        'or .//div[@role="checkbox" or @role="radio" or @contenteditable="true"]]',
    ],
    # Các phần tử tương đối bên trong dialog câu hỏi tham gia nhóm
    "dialog_text_inputs": './/textarea | .//input[@type="text"] | .//div[@contenteditable="true"] | .//div[@role="radio"] | .//input[@type="radio"]',
    "dialog_checkboxes": './/input[@type="checkbox"] | .//div[@role="checkbox"]',
    "dialog_submit": './/span[normalize-space()="Gửi" or normalize-space()="Submit"]/ancestor::div[@role="button"][1]',
}

FARM_NOTIF = {
    "bell_button": [
        '//div[@role="navigation" or @role="banner"]//*[(@role="button" or @role="link" or self::a) and (starts-with(@aria-label, "Thông báo") or starts-with(@aria-label, "Notifications"))]',
        '//*[(@role="button" or @role="link" or self::a) and (starts-with(@aria-label, "Thông báo") or starts-with(@aria-label, "Notifications"))]',
    ],
    # Thông báo chưa đọc: hàng có nhãn trợ năng "Chưa đọc"/"Unread" (cần kiểm chứng trên tài khoản thật)
    "unread_items": [
        '//div[@role="dialog"]//div[@role="row"][.//*[normalize-space()="Chưa đọc" or normalize-space()="Unread"]]//a[@role="link"]',
        '//div[@role="dialog"]//a[@role="link"][.//*[normalize-space()="Chưa đọc" or normalize-space()="Unread"]]',
    ],
}

