import api from "@/services/api";
import { getCreatedPageHistory } from "@/modules/module_04_page_creator/service";

export async function getDashboardStats() {
  // Reuse the owner-scoped sources used by account management and page creation.
  const results = await Promise.allSettled([
    api.get("/api/accounts/stats", { timeout: 15000 }),
    getCreatedPageHistory(),
  ]);
  const errors = {};
  const labels = ["tài khoản Facebook", "Fanpage"];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const error = result.reason;
      const detail = error.status >= 500 ? "Máy chủ không truy vấn được dữ liệu. Kiểm tra kết nối cơ sở dữ liệu của Engine."
        : error.status === 404 ? "Engine đang chạy chưa có API này. Cần khởi động lại Engine sau khi cập nhật."
        : error.status === 401 || error.status === 403 ? "Phiên đăng nhập hoặc bản quyền không còn hợp lệ."
        : "Không kết nối được Engine hoặc yêu cầu đã quá thời gian chờ.";
      errors[index === 0 ? "accounts" : "pages"] = `Không thể tải ${labels[index]}. ${detail}`;
    }
  });
  const accounts = results[0].status === "fulfilled" ? results[0].value : null;
  const history = results[1].status === "fulfilled" ? results[1].value : null;
  if (history !== null && !Array.isArray(history)) {
    errors.pages = "Dữ liệu Fanpage trả về không đúng định dạng. Vui lòng cập nhật Engine.";
  }
  if (!Array.isArray(history)) return { accounts, pages: null, errors };
  const count = (status) => history.filter((page) => String(page?.status || "").trim().toUpperCase() === status).length;
  const success = count("SUCCESS");
  const failed = count("FAILED");
  return { accounts, errors, pages: { total: history.length, success, failed, other: history.length - success - failed } };
}
