// Nhãn / màu dùng chung cho màn Tương tác và Lịch sử (khớp giá trị của modules/module_03_acc_farm phía BE)

export const ACTION_LABELS = {
  CHECK_NOTIF: "Thông báo",
  NEWSFEED: "Newsfeed",
  WATCH: "Watch",
  ADD_FRIEND: "Kết bạn",
  JOIN_GROUP: "Nhóm",
};

export const ACTION_FULL_LABELS = {
  CHECK_NOTIF: "Check thông báo",
  NEWSFEED: "Lướt Newsfeed",
  WATCH: "Xem video Watch",
  ADD_FRIEND: "Kết bạn gợi ý",
  JOIN_GROUP: "Tham gia nhóm",
};

// Trạng thái 1 nick trong lượt chạy (farm_runs / farm_run_history.final_status)
export const RUN_STATUS = {
  RUNNING: { label: "Đang chạy", dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  PAUSED: { label: "Tạm dừng", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  PENDING: { label: "Chờ thực thi", dot: "bg-slate-500", badge: "bg-slate-100 text-slate-600 border-slate-200" },
  COMPLETED: { label: "Hoàn thành", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  BLOCKED: { label: "Bị chặn tính năng", dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 border-orange-200" },
  FAILED: { label: "Lỗi hệ thống", dot: "bg-rose-400", badge: "bg-rose-50 text-rose-700 border-rose-200" },
  DIE: { label: "Acc chết", dot: "bg-red-600", badge: "bg-red-50 text-red-700 border-red-200" },
  STOPPED: { label: "Đã dừng", dot: "bg-slate-700", badge: "bg-slate-100 text-slate-700 border-slate-300" },
};

// Thứ tự thẻ đếm ở Giám sát tiến trình
export const MONITOR_STATUSES = ["RUNNING", "PAUSED", "PENDING", "COMPLETED", "BLOCKED", "FAILED", "DIE", "STOPPED"];

export const FINAL_STATUSES = ["COMPLETED", "BLOCKED", "STOPPED", "FAILED", "DIE"];

// Kết quả từng hành động (farm_interaction_logs.status / actions trong status)
export const ACTION_STATUS = {
  PENDING: { label: "Chờ", badge: "bg-slate-50 text-slate-500 border-slate-200" },
  RUNNING: { label: "Đang chạy", badge: "bg-blue-50 text-blue-700 border-blue-300" },
  SUCCESS: { label: "Thành công", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  BLOCKED: { label: "Bị chặn", badge: "bg-orange-50 text-orange-700 border-orange-200" },
  SKIPPED: { label: "Bỏ qua", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  FAILED: { label: "Lỗi", badge: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const PROXY_MODE_LABELS = {
  full: "Proxy",
  facebook_only: "Proxy chỉ Facebook",
  none: "IP máy",
};

export const FINGERPRINT_LABELS = {
  native: "Fingerprint riêng",
  legacy: "Fingerprint gốc",
};

export const FRIEND_SOURCE_LABELS = {
  suggestions: "gợi ý",
  group_members: "thành viên nhóm",
};

export const HARD_MAX_THREADS = 10;
export const MAX_TIME_VALUE = 3600;
