import { openLiveBrowser } from "@/modules/module_02_account_manager/service";
import { toast } from "@/lib/toast";

/**
 * Mở link bài / profile trong Chrome profile đã login của nick (Module 02),
 * không dùng window.open / trình duyệt mặc định.
 */
export async function openPostInAccountBrowser(uid, url, {
  title = "Xem bài viết",
} = {}) {
  const accountUid = String(uid || "").trim();
  const targetUrl = String(url || "").trim();
  if (!accountUid) {
    toast.warning("Thiếu UID tài khoản để mở Chrome profile.", title);
    return false;
  }
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    toast.warning("Không có liên kết hợp lệ để mở.", title);
    return false;
  }
  try {
    toast.info(`Đang mở Chrome profile nick ${accountUid}...`, title);
    await openLiveBrowser(accountUid, targetUrl);
    return true;
  } catch (error) {
    toast.warning(error?.message || "Không thể mở trình duyệt cho tài khoản này.", title);
    return false;
  }
}
