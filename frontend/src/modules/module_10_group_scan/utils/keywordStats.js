// Ô "Số nhóm quét được" + "Trạng thái" của bảng từ khóa (Quét thông tin nhóm).
// - count / detail: kết quả nút Kiểm tra (số nhóm quét được tối đa) — KHÔNG bị luồng quét ghi đè.
// - scanned / scanLimit: tiến độ Bắt đầu thực thi ("Đã quét 12/30 nhóm").
// - status: trạng thái hiện tại (Kiểm tra hoặc quét); checkStatus: trạng thái Kiểm tra trước khi bấm Bắt đầu.

/** Chuẩn hoá từ khóa để so khớp — giống normalize_keyword của Engine (bỏ hoa/thường, gộp khoảng trắng). */
export function keywordKey(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi");
}

function targetsFor(word, labels) {
  const k = keywordKey(word);
  const hit = [...new Set(labels.filter((label) => keywordKey(label) === k))];
  return hit.length ? hit : [word];
}

/**
 * Gán kết quả Engine (khóa đã chuẩn hoá: "phenikaa") cho đúng từ khóa người dùng gõ ("Phenikaa").
 * entries: [[wordFromEngine, cell]]; words: các từ khóa đang có trên màn hình.
 */
export function mergeCapacityStats(current, entries, words = []) {
  const next = { ...current };
  entries.forEach(([word, cell]) => {
    targetsFor(word, words).forEach((label) => {
      next[label] = cell;
    });
  });
  return next;
}

/** Bấm Bắt đầu thực thi: giữ số nhóm đã Kiểm tra, chỉ đánh dấu bắt đầu quét. */
export function markScanStarted(current, words, quotas = {}) {
  const next = { ...current };
  words.forEach((word) => {
    const prev = current[word] || { count: "—", status: "idle" };
    next[word] = {
      ...prev,
      checkStatus: prev.checkStatus || prev.status,
      status: "idle",
      scanned: 0,
      scanLimit: Number(quotas[word]) || 30,
    };
  });
  return next;
}

/** Không bắt đầu được phiên quét: trả từng dòng về đúng như trước khi bấm. */
export function restoreAfterStartFailed(current, words) {
  const next = { ...current };
  words.forEach((word) => {
    const prev = current[word] || { count: "—" };
    const { scanned: _s, scanLimit: _l, checkStatus, ...rest } = prev;
    next[word] = { ...rest, status: checkStatus || "idle" };
  });
  return next;
}

/** Tiến độ quét từ Engine (keyword_stats của phiên quét) → cập nhật trạng thái + số đã quét, giữ số Kiểm tra. */
export function applyScanProgress(current, remoteStats, jobStatus) {
  const next = { ...current };
  Object.entries(remoteStats || {}).forEach(([word, row]) => {
    let st = "idle";
    if (row?.status === "running") st = "running";
    else if (row?.status === "done") st = "done";
    else if (row?.status === "stopped" || row?.status === "error") st = row.status;
    else if (jobStatus === "paused" && row?.status === "idle") st = "paused";
    targetsFor(word, Object.keys(next)).forEach((label) => {
      next[label] = {
        ...(next[label] || { count: "—" }),
        status: st,
        scanned: Number(row?.count) || 0,
        scanLimit: Number(row?.limit) || null,
      };
    });
  });
  return next;
}

export const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");

/** Ô "Số nhóm quét được" của 1 từ khóa từ kết quả Kiểm tra (đang cuộn hoặc đã lưu DB). */
export function capacityCell(row) {
  const started = row?.count !== null && row?.count !== undefined;
  if (!started) return { count: "…", detail: "", status: row?.status || "idle" };
  const total = Number(row.total) || 0;
  const ok = Number(row.count) || 0;
  const fresh = Number(row.fresh) || 0;
  const filtered = Math.max(0, total - ok); // riêng tư / ít thành viên / không rõ số thành viên
  const inDb = Math.max(0, ok - fresh); // qua bộ lọc nhưng đã quét trước đó
  return {
    count: `${fmtNum(ok)} nhóm`,
    detail: [
      `Facebook tìm thấy ${fmtNum(total)} nhóm`,
      filtered ? `loại ${fmtNum(filtered)} nhóm riêng tư hoặc ít thành viên` : null,
      inDb
        ? `${fmtNum(inDb)} nhóm đã có trong Danh sách nhóm quét, còn ${fmtNum(fresh)} nhóm chưa quét`
        : "tất cả đều là nhóm chưa quét",
      row.reason || null,
      row.checked_at ? `kiểm tra lúc ${row.checked_at}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    status: row.status || "done",
    cached: Boolean(row.cached),
  };
}
