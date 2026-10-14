# Kiểm thử Module 2

Từ thư mục `fb-automator-core`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File modules/module_02_account_manager/tests/run-module2.ps1
```

Runner chạy BE → Node FE → ESLint toàn frontend → build → E2E. Log và JSON nằm trong `test-results/module2/<timestamp>`. Exit 1 nếu có lỗi hoặc E2E bị chặn/chưa chạy. `be-summary.json` ghi từng ca PostgreSQL bị chặn; exit 0 của unittest không có nghĩa PostgreSQL đã đạt. `-SkipBrowser` ghi Chưa kiểm chứng.

Chạy nhanh riêng từng bộ:

```powershell
.venv/Scripts/python.exe -m modules.module_02_account_manager.tests.run_suite
cd frontend
node --test --test-isolation=none src/modules/module_02_account_manager/hooks/useAccountPages.test.mjs src/modules/module_02_account_manager/utils/drag-selection.test.mjs src/modules/module_02_account_manager/utils/import-mapping.test.mjs
```

Python, FastAPI, SQLAlchemy, uvicorn và Playwright dùng `.venv` hiện có; Node dùng `frontend/node_modules`. Chromium phải được cài cho Python Playwright. Không tải/cài trình duyệt hoặc thay font tự động. Không đổi API hay logic sản phẩm.

BE dùng SQLite cô lập, profile tạm và dịch vụ mock. `run_suite.py` thay pool host trước discovery: bất kỳ truy vấn host nào đều thất bại, không mở kết nối production. Thông báo “Connected successfully to Supabase” là chuỗi in từ host import sau khi pool đã được thay; không phải bằng chứng kết nối thật. PostgreSQL chỉ dùng `ACCOUNT_TEST_POSTGRES_URL`; bộ migration tạo schema UUID và xoá schema trong cleanup. Không gán DATABASE_URL/SUPABASE_DB_URL làm fallback.

E2E dùng production build tại `127.0.0.1:3012`, fixture router thật tại `127.0.0.1:28132`. Auth/health mô phỏng, hai owner có cùng 37 UID, SQLite/profile tạm. Các ca hiện có chỉ gọi CRUD/query; fixture không cung cấp dịch vụ Chrome/Facebook thật và không được dùng để thử thao tác automation trực tiếp. Runner từ chối cổng bị chiếm và chỉ dừng PID do chính nó tạo. SQLite/profile tự dọn khi API shutdown; runner còn dọn thư mục isolated-data sau khi dừng server, với kiểm tra đường dẫn nằm dưới results. Ảnh chụp mỗi ca vào thư mục log. Chưa xác minh cleanup server trên môi trường hiện tại.

Xem [CHECKLIST.md](CHECKLIST.md) cho dữ liệu/bước/kỳ vọng, [REPORT.md](REPORT.md) cho kết quả thực tế. Kết nối Facebook, Chrome profile và proxy thật nằm ngoài phạm vi. Các mục trình duyệt chưa chạy không được suy ra là đạt từ hook/unit tests.
