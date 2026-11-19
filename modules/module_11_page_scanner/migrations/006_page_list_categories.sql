-- Danh mục page do người dùng lưu ("Lưu vào danh sách page chung" ở Quét thông tin page / Danh sách page).
-- Item chỉ giữ page_key; thông tin page (SĐT, email, ...) luôn đọc mới nhất từ scanned_pages.
CREATE TABLE IF NOT EXISTS page_list_categories (
  id SERIAL PRIMARY KEY,
  owner_key VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS page_list_category_pages (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES page_list_categories(id) ON DELETE CASCADE,
  owner_key VARCHAR(100),
  page_key VARCHAR(255) NOT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_page_list_category_pages UNIQUE (category_id, page_key)
);

-- Tên danh mục không trùng trong cùng owner (không phân biệt hoa thường)
CREATE UNIQUE INDEX IF NOT EXISTS uq_page_list_categories_owner_name
  ON page_list_categories (owner_key, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_page_list_category_pages_page
  ON page_list_category_pages (owner_key, page_key);
