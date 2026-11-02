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

/** Lấy danh sách lịch sử phiên quét Module 10 */
export async function getScanHistory(params = {}) {
  try {
    return await api.get("/api/group-scan/history", { params });
  } catch {
    return null;
  }
}

/** Xóa bản ghi lịch sử phiên quét */
export async function deleteScanHistory(id) {
  try {
    return await api.delete(`/api/group-scan/history/${id}`);
  } catch {
    return null;
  }
}

/** Xóa nhiều bản ghi lịch sử phiên quét */
export async function deleteScanHistoryBulk(ids = []) {
  try {
    return await api.post("/api/group-scan/history/delete-bulk", { ids });
  } catch {
    return null;
  }
}

/** Lấy danh sách các nhóm đã quét từ Database */
export async function getScannedGroups(params = {}) {
  try {
    return await api.get("/api/group-scan/groups", { params });
  } catch {
    return { groups: [], total: 0, keywords: [] };
  }
}

/** Xóa 1 nhóm đã quét khỏi Database */
export async function deleteScannedGroup(id) {
  try {
    return await api.delete(`/api/group-scan/groups/${id}`);
  } catch {
    return null;
  }
}

/** Xóa nhiều nhóm đã quét khỏi Database */
export async function deleteScannedGroupsBulk(ids = []) {
  try {
    return await api.post("/api/group-scan/groups/delete-bulk", { ids });
  } catch {
    return null;
  }
}

/** Lấy danh sách danh mục nhóm có sẵn từ Database */
export async function getScanCategories() {
  try {
    const res = await api.get("/api/group-scan/categories");
    return res?.categories || [];
  } catch {
    return [];
  }
}

/** Tạo danh mục nhóm mới */
export async function createScanCategory(name, description = "") {
  try {
    return await api.post("/api/group-scan/categories", { name, description });
  } catch {
    return null;
  }
}

/** Cập nhật tên danh mục nhóm */
export async function updateScanCategory(id, name) {
  try {
    return await api.put(`/api/group-scan/categories/${id}`, { name });
  } catch (err) {
    throw err;
  }
}

/** Xóa danh mục nhóm khỏi Database */
export async function deleteScanCategory(id) {
  try {
    return await api.delete(`/api/group-scan/categories/${id}`);
  } catch (err) {
    throw err;
  }
}

/** Chuyển nhóm sang danh mục khác */
export async function moveGroupsToCategory({ categoryName, groupIds = [] }) {
  try {
    return await api.post("/api/group-scan/categories/move-groups", {
      category_name: categoryName,
      group_ids: groupIds,
    });
  } catch (err) {
    throw err;
  }
}

/** Lưu danh sách nhóm vào danh mục chung */
export async function saveGroupsToCategory({ categoryName, groups, deduplicate = true }) {
  try {
    return await api.post("/api/group-scan/save-to-category", {
      category_name: categoryName,
      groups,
      deduplicate,
    });
  } catch (err) {
    throw err;
  }
}



