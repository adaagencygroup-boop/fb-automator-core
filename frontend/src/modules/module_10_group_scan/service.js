import api from "@/services/api";
import { getAccounts as getModule2Accounts } from "@/modules/module_02_account_manager/service";

/** Tài khoản Module 2 — nguồn chính để chọn nick quét nhóm.
 *  fresh: bỏ qua cache FE, lấy trạng thái Live / đăng nhập mới nhất (nút "Làm mới"). */
export async function getScanAccounts({ fresh = false } = {}) {
  if (!fresh) return getModule2Accounts();
  const data = await api.get("/api/accounts", { fresh: true });
  return Array.isArray(data) ? data : data?.accounts || [];
}

/** Nút Kiểm tra: mở Chrome, cuộn hết kết quả tìm nhóm của từng từ khóa và đếm số nhóm quét được tối đa. */
export async function startKeywordCapacity({ uids, keywords, publicOnly = true, minMembers = null, force = false }) {
  return api.post("/api/group-scan/keyword-capacity/start", {
    uids,
    keywords,
    public_only: publicOnly,
    min_members: minMembers,
    force,
  });
}

export async function getKeywordCapacityStatus(jobId) {
  return api.get("/api/group-scan/keyword-capacity/status", { params: { job_id: jobId } });
}

export async function stopKeywordCapacity(jobId) {
  return api.post("/api/group-scan/keyword-capacity/stop", { job_id: jobId });
}

/** Phiên Kiểm tra từ khóa đang chạy (để gắn lại sau khi tải lại trang). */
export async function getActiveKeywordCapacity() {
  return api.get("/api/group-scan/keyword-capacity/active");
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

export async function clearKeywordCheck(uid) {
  return api.post("/api/group-scan/check-clear", { uid });
}

/** pause | resume | abort */
export async function controlScanJob({ jobId, action }) {
  return api.post("/api/group-scan/job-control", { job_id: jobId, action });
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

/** Xóa danh mục nhóm khỏi Database. deleteGroups = true → xóa luôn các nhóm trong danh mục. */
export async function deleteScanCategory(id, { deleteGroups = false } = {}) {
  try {
    return await api.delete(`/api/group-scan/categories/${id}${deleteGroups ? "?delete_groups=true" : ""}`);
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





// =========================================================================
// PHÂN HỆ 10.2: API QUÉT THÀNH VIÊN NHÓM
// =========================================================================

/** Khởi chạy phiên quét thành viên nhóm */
export async function startMemberScan(payload) {
  return api.post("/api/group-scan/members/start", payload);
}

/** Poll trạng thái, logs và kết quả thành viên thời gian thực */
export async function getMemberScanStatus({ jobId }) {
  return api.get("/api/group-scan/members/status", { params: { job_id: jobId } });
}

/** Điều khiển phiên quét: pause | resume | abort */
export async function controlMemberScan({ jobId, action }) {
  return api.post("/api/group-scan/members/control", { job_id: jobId, action });
}

/** Phiên quét thành viên đang chạy của người dùng (để gắn lại sau khi tải lại trang). */
export async function getActiveMemberScan() {
  return api.get("/api/group-scan/members/active");
}

/** Lấy danh sách thành viên nhóm đã quét từ Database */
// fresh: bỏ cache FE (dùng khi xuất file ngay sau khi quét để không xuất danh sách cũ).
export async function getScannedMembers(params = {}, { fresh = false } = {}) {
  try {
    return await api.get("/api/group-scan/members", { params, fresh });
  } catch {
    return { ok: false, members: [], total: 0 };
  }
}

/** Lấy thống kê tổng quan (KPI) cho kho thành viên */
export async function getMembersSummary() {
  try {
    return await api.get("/api/group-scan/members/summary");
  } catch {
    return { total_members: 0, total_groups: 0, total_admins: 0 };
  }
}

/** Xóa 1 thành viên khỏi Database */
export async function deleteScannedMember(id) {
  try {
    return await api.delete(`/api/group-scan/members/${id}`);
  } catch {
    return null;
  }
}

/** Xóa nhiều thành viên khỏi Database */
export async function deleteScannedMembersBulk(ids = []) {
  try {
    return await api.post("/api/group-scan/members/delete-bulk", { ids });
  } catch {
    return null;
  }
}

/** Phiên Bắt đầu thực thi (Quét thông tin nhóm) đang chạy — để trang Quét gắn lại khi mở lại. */
export async function getActiveGroupScan() {
  return api.get("/api/group-scan/check-active");
}

/** Phiên gần nhất cùng loại (GROUP_INFO | GROUP_MEMBERS) bị gián đoạn và còn phần chưa quét. */
export async function getResumableSession(scanType) {
  const res = await api.get("/api/group-scan/sessions/resumable", { params: { scan_type: scanType } });
  return res?.session || null;
}

/** Chạy tiếp phiên bị gián đoạn: chỉ quét phần còn thiếu, cùng cấu hình & nick của phiên cũ. */
export async function resumeScanSession(sessionId) {
  return api.post(`/api/group-scan/sessions/${encodeURIComponent(sessionId)}/resume`, {});
}

/** Kiểm tra & Lọc trùng lặp: link nào đã có trong Danh sách nhóm quét → { [link]: {group_name, privacy, last_seen_at} }. */
export async function lookupScannedGroups(links) {
  if (!links?.length) return {};
  const res = await api.post("/api/group-scan/groups/lookup", { links });
  return res?.known || {};
}
