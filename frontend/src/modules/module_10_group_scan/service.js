import api from "@/services/api";
import { getAccounts as getModule2Accounts } from "@/modules/module_02_account_manager/service";

/** Tài khoản Module 2 — nguồn chính để chọn nick quét nhóm. */
export async function getScanAccounts() {
  return getModule2Accounts();
}

/** Endpoint khung Module 10 (health / thống kê sẵn sàng). */
export async function getGroupScanHealth() {
  return api.get("/api/group-scan/health");
}

export async function getReadyAccountsSummary() {
  return api.get("/api/group-scan/accounts");
}

/**
 * Bắt đầu thực thi: mở Chrome, quét lần lượt nhiều từ khóa.
 * Gửi cả `keyword` (từ khóa đầu) để tương thích Engine cũ còn validate field required.
 * @param {{
 *   uid: string,
 *   keywords: Array<{ keyword: string, limit: number }>,
 *   delay_min?: number,
 *   delay_max?: number,
 *   public_only?: boolean,
 *   private_only?: boolean,
 *   min_members?: number|null,
 *   force?: boolean,
 * }} payload
 */
export async function startGroupScan(payload) {
  const keywords = Array.isArray(payload?.keywords) ? payload.keywords : [];
  const first = keywords[0]?.keyword || payload?.keyword || "";
  return api.post("/api/group-scan/check-keyword", {
    force: true,
    ...payload,
    keyword: first,
    keywords,
  });
}

/** @deprecated alias — dùng startGroupScan */
export async function checkKeyword(payload) {
  return startGroupScan(payload);
}

export async function clearKeywordCheck(uid) {
  return api.post("/api/group-scan/check-clear", { uid });
}

/** pause | resume | abort */
export async function controlScanJob({ jobId, action }) {
  return api.post("/api/group-scan/job-control", { job_id: jobId, action });
}

/** Kiểm tra: đọc số nhóm / danh sách đã lưu theo từ khóa từ DB (không mở Chrome). */
export async function lookupKeywords(keywords, { includeGroups = true } = {}) {
  return api.post("/api/group-scan/lookup-keywords", {
    keywords,
    include_groups: includeGroups,
  });
}

/** Poll log + danh sách nhóm đã quét được. */
export async function getCheckStatus({ jobId, uid } = {}) {
  const params = {};
  if (jobId) params.job_id = jobId;
  if (uid) params.uid = uid;
  return api.get("/api/group-scan/check-status", { params });
}
