/** Dữ liệu mẫu theo Figma — CHỈ dùng khi mở trang với ?demo=1 để xem giao diện kết quả. */
const people = [
  ["1000847291048", "Lê Thu Thảo", "thao.lethu", 4890, "Kinh doanh thời trang nữ & mỹ phẩm sỉ lẻ", "15/08/1995", "Nam Định", "Hà Nội", "ĐH Kinh Tế Quốc Dân (NEU)", "CEO", "Thảo Lê Boutique"],
  ["1000629471924", "Trần Minh Hoàng", "hoang.tranm", 3240, "Chuyên gia digital marketing & tư vấn FB", "22/11/1992", "Nghệ An", "TP. Hồ Chí Minh", "ĐH Bách Khoa TP.HCM", "Marketing Lead", "Nova Group"],
  ["1000998234191", "Vũ Hải Yến", "yen.vu.hai", 5000, "Yêu thích du lịch, nhiếp ảnh & decor", "05/03/1998", "Hải Phòng", "Đà Nẵng", "ĐH Thương Mại", "Chuyên viên nội dung", "VTV"],
  ["1000348719280", "Đặng Quốc Bảo", "bao.dangquoc", 2150, "Founder @ TechStore VN - Trao giá trị", "19/07/1990", "Thái Bình", "Hà Nội", "Học viện Ngân Hàng", "Quản lý vận hành", "Sapo"],
];

const rowsFor = (source) =>
  people.map(([uid, name, user, friends, bio, birthday, hometown, location, education, job_title, job_place]) => ({
    uid,
    name,
    url: `https://www.facebook.com/${user}`,
    friends,
    followers: 4890,
    bio,
    birthday,
    hometown,
    location,
    education,
    job_title,
    job_place,
    sourceKey: source,
  }));

const source = (type, id, name, url, scale) => ({
  type,
  id,
  name,
  url,
  scale,
  profiles: Object.fromEntries(people.map(([uid, n, user]) => [uid, { uid, name: n, url: `https://www.facebook.com/${user}` }])),
});

export const DEMO_SOURCES = {
  "group:buonban1001": source("group", "buonban1001", "Buôn Bán Online Miền Bắc", "https://www.facebook.com/groups/buonban1001", 258724),
  "post:1081": { ...source("post", "1081", "Hướng dẫn setup phòng livestream 500 đơn/ngày", "https://www.facebook.com/groups/choviet/posts/1081", 1420), likes: 870, comments: 280, shares: 45 },
  "page:eva": source("page", "eva", "Làm đẹp & Thẩm mỹ Eva", "https://www.facebook.com/lamdepvatrangdiemeva", 150000),
};

export const DEMO_RESULTS = Object.keys(DEMO_SOURCES).flatMap(rowsFor);

export const DEMO_LOGS = [
  { id: 1, timestamp: "10:35:02", message: "[MẪU] Mạng kết nối tài khoản đại diện sẵn sàng.", type: "info" },
  { id: 2, timestamp: "10:35:12", message: "[MẪU] Đã trích xuất 4 profile.", type: "success" },
];
