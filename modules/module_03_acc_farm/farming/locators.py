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
    # Trang mở từ link dán vào không tồn tại / không xem được (link sai, nhóm / nick đã xóa hoặc chặn).
    # Câu tiếng Anh theo giao diện Facebook hiện có; câu tiếng Việt chưa kiểm chứng trên nick thật.
    "unavailable_page": [
        '//*[normalize-space()="This content isn\'t available right now" or normalize-space()="This content isn’t available right now" '
        'or normalize-space()="This page isn\'t available" or normalize-space()="This page isn’t available" '
        'or normalize-space()="Nội dung này hiện không hiển thị" or normalize-space()="Bạn hiện không xem được nội dung này" '
        'or normalize-space()="Trang này không hiển thị"]',
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

# Thả cảm xúc: thanh cảm xúc hiện sau khi rê chuột lên nút Like ~0,7s (đã đo 2026-10-22 trên feed và reel)
# (Story: các nút cảm xúc hiện sẵn, không cần rê chuột). {kind} chỉ nhận giá trị trong REACTION_TYPES, {vi} là tên nút
# đó ở giao diện tiếng Việt (REACTION_NAMES_VI). Thứ tự trên thanh giống nhau ở 2 ngôn ngữ (đã đo 2026-10-30).
REACTION_BUTTON = '//*[@aria-label="{kind}" or @aria-label="{vi}"]'
REACTION_NAMES_VI = {"Like": "Thích", "Love": "Yêu thích", "Care": "Thương thương", "Haha": "Haha", "Wow": "Wow",
                     "Sad": "Buồn", "Angry": "Phẫn nộ"}

FARM_STORY = {
    # Khay story trên Trang chủ: bỏ thẻ "Create story" (/stories/create/), lấy thẻ "<Tên>'s story"
    "tray_cards": [
        '//div[@aria-label="stories tray" or @aria-label="Stories"]//a[contains(@href, "/stories/") '
        'and not(contains(@href, "/stories/create"))]',
    ],
    # Nút sang khung kế khi phím mũi tên phải không sang được (focus ở ô trả lời / ngoài trình xem sau khi thả cảm
    # xúc). Khung kế của cùng người ("Next card") trước, hết khung thì sang người kế ("Next Bucket")
    "next": [
        '//div[@role="button" and (@aria-label="Next card" or @aria-label="Next Card" or @aria-label="Thẻ tiếp theo")]',
        '//div[@role="button" and (@aria-label="Next Bucket" or @aria-label="Next bucket")]',
    ],
}

FARM_FRIEND = {
    "add_friend_buttons": [
        '//div[@role="button" and (@aria-label="Thêm bạn bè" or @aria-label="Add friend" or @aria-label="Add Friend")]',
        '//span[normalize-space()="Thêm bạn bè" or normalize-space()="Add friend" or normalize-space()="Add Friend"]/ancestor::div[@role="button"][1]',
        # Danh sách thành viên nhóm: nhãn có kèm tên người, vd "Add Friend Holly Lane"
        '//div[@role="button" and (starts-with(@aria-label, "Thêm bạn bè ") or starts-with(@aria-label, "Add Friend ") or starts-with(@aria-label, "Add friend "))]',
    ],
    # Trang cá nhân đã tải xong: có nút "Search <Tên>'s profile" hoặc nút kết bạn / bạn bè của chủ trang
    "profile_loaded": [
        '//*[starts-with(@aria-label, "Search ") and (contains(@aria-label, "\'s profile") or contains(@aria-label, "’s profile"))]',
        '//div[@role="button" and (starts-with(@aria-label, "Add Friend ") or starts-with(@aria-label, "Add friend ") '
        'or starts-with(@aria-label, "Cancel Request ") or starts-with(@aria-label, "Cancel request ") '
        'or @aria-label="Friends" or @aria-label="Bạn bè")]',
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
    # Trang nhóm chưa vào (mở từ link dán): nút "Join group" đúng nguyên nhãn (đầu trang + thanh dính, đã kiểm 2026-10-22).
    # Không nhận nhãn có tên nhóm phía sau: đó là nút của khối nhóm gợi ý khác trên cùng trang.
    "page_join_button": [
        '//div[@role="button" and (@aria-label="Join group" or @aria-label="Join Group" or @aria-label="Tham gia nhóm")]',
        '//span[normalize-space()="Join group" or normalize-space()="Join Group" or normalize-space()="Tham gia nhóm"]'
        '/ancestor::div[@role="button"][1][not(@aria-label) or @aria-label="Join group" or @aria-label="Join Group" '
        'or @aria-label="Tham gia nhóm"]',
    ],
    # Trang nhóm đã tải xong (có nút của thành viên / người chưa vào), dùng để chờ trước khi đọc trạng thái
    "page_loaded": [
        '//div[@role="button" and (@aria-label="Join group" or @aria-label="Join Group" or @aria-label="Tham gia nhóm" '
        'or @aria-label="Joined" or @aria-label="Đã tham gia" or @aria-label="Share group")]',
        '//span[normalize-space()="Joined" or normalize-space()="Đã tham gia" or normalize-space()="Cancel request" '
        'or normalize-space()="Cancel Request" or normalize-space()="Hủy yêu cầu"]/ancestor::div[@role="button"][1]',
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

# Rời nhóm trên trang groups/joins (đã kiểm 2026-10-22, giao diện tiếng Anh; chữ tiếng Việt chưa kiểm chứng)
FARM_LEAVE = {
    # Nút ... (More) trên thẻ nhóm giữa trang
    "more_buttons": ['//div[@role="main"]//div[@role="button" and @aria-label="More"]'],
    # "See all" ở cột trái: hiện đủ nhóm đã tham gia kèm "Last active"
    "see_all": [
        '//*[@role="navigation"]//*[(@role="button" or @role="link") and (normalize-space()="See all" or normalize-space()="See All")]',
        '//*[@role="navigation"]//span[normalize-space()="See all" or normalize-space()="See All"]',
    ],
    # Mục "Leave group" trong menu More
    "menu_leave": [
        '//div[@role="menuitem"][.//span[normalize-space()="Leave group" or normalize-space()="Rời nhóm"]]',
        '//div[@role="menuitem" and (normalize-space()="Leave group" or normalize-space()="Rời nhóm")]',
    ],
    # Hộp xác nhận: thường "Leave group?"; admin cuối "Delete group by leaving?" (luôn bấm Cancel)
    "dialog": [
        '//div[@role="dialog"][.//*[normalize-space()="Leave group?" or normalize-space()="Delete group by leaving?" '
        'or normalize-space()="Rời nhóm?"]]',
    ],
    "dialog_confirm": './/div[@role="button"][.//span[normalize-space()="Leave group" or normalize-space()="Rời nhóm"]]'
                      ' | .//div[@role="button" and (@aria-label="Leave group" or @aria-label="Rời nhóm")]',
    "dialog_cancel": './/div[@role="button"][.//span[normalize-space()="Cancel" or normalize-space()="Hủy"]]'
                     ' | .//div[@role="button" and (@aria-label="Cancel" or @aria-label="Hủy")]',
}

FARM_NOTIF = {
    "bell_button": [
        '//div[@role="navigation" or @role="banner"]//*[(@role="button" or @role="link" or self::a) and (starts-with(@aria-label, "Thông báo") or starts-with(@aria-label, "Notifications"))]',
        '//*[(@role="button" or @role="link" or self::a) and (starts-with(@aria-label, "Thông báo") or starts-with(@aria-label, "Notifications"))]',
    ],
    # Bảng thông báo đang mở: dialog có tab Tất cả / Chưa đọc (đã kiểm chứng 2026-10-14, dạng thả xuống trên trang chủ)
    "panel": [
        '//div[@role="dialog"][.//*[normalize-space()="Unread" or normalize-space()="Chưa đọc"]]',
    ],
    # Thông báo chưa đọc: hàng có nhãn trợ năng "Chưa đọc"/"Unread" (đã khớp trên tài khoản thật 2026-10-14)
    "unread_items": [
        '//div[@role="dialog"]//div[@role="row"][.//*[normalize-space()="Chưa đọc" or normalize-space()="Unread"]]//a[@role="link"]',
        '//div[@role="dialog"]//a[@role="link"][.//*[normalize-space()="Chưa đọc" or normalize-space()="Unread"]]',
    ],
}

