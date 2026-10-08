import requests
import json

def get_all_page_tokens(long_lived_user_token):
    # Endpoint lấy danh sách các page mà user quản lý
    # Thêm tham số limit=200 để lấy một phát hết 120 page luôn, không cần phân trang
    url = f"https://graph.facebook.com/v19.0/me/accounts"
    
    params = {
        'access_token': 'EAAMnTZCkFSkYBRynuclWm43sw6QJHWvXUxzEi6Cy5K8VxXuZCwrWB2Yx2rnVZB4ZCZBRBJCvKvwM9vPqCHxlYjujlBraB69Ee3PckzymWdcGOK55wlU03Vx4m8NEJDRe1iA8ZBgUSB5xyJVHZCnsgcbCFQ4Sskclp5fFgNd07qLVEHfBpLOZA6dQCIknRZAwx4SjS',
        'limit': 200,
        'fields': 'id,name,access_token'
    }
    
    print("[INFO] Đang kết nối với Graph API để tải danh sách Page...")
    response = requests.get(url, params=params)
    data = response.json()
    
    if 'error' in data:
        print(f"[ERROR] Lỗi API: {data['error']['message']}")
        return

    pages = data.get('data', [])
    print(f"[SUCCESS] Đã tìm thấy {len(pages)} pages.")
    
    # Lưu toàn bộ dữ liệu vào file JSON để tool tự động đăng bài đọc sau này
    with open('pages_data.json', 'w', encoding='utf-8') as f:
        json.dump(pages, f, ensure_ascii=False, indent=4)
        
    print("[INFO] Đã lưu toàn bộ Page ID và Token vĩnh viễn vào file 'pages_data.json'")
    
    # In thử 2 page đầu tiên ra màn hình để kiểm tra
    for i, page in enumerate(pages[:2]):
        print(f"\nPage {i+1}: {page['name']}")
        print(f"ID: {page['id']}")
        print(f"Token: {page['access_token'][:20]}...")

if __name__ == "__main__":
    # DÁN LONG-LIVED USER TOKEN CỦA BẠN VÀO ĐÂY
    USER_TOKEN = "EAAbMstZAYnEEBR87exhaR1GGZAZBSeyef1Hs9gzAlUw2gL6kxPb1r6Bd9NoL6t4AhDleTETYn0iTBC6y6hOKfL52TZADCeQH9vUe7T8SUH75kR1tLYu1jlCHY55elCLOukaCuwsH6pFlmb7LnMflELaNhjXy9kR0cFYRo9vxRVaZB1mq0pzHoPI4AvNNM7GQWFVJcorZBqFXKl"
    
    get_all_page_tokens(USER_TOKEN)