// Nhãn / màu dùng chung cho màn Tương tác và Lịch sử (khớp giá trị của modules/module_03_acc_farm phía BE)

export const ACTION_LABELS = {
  CHECK_NOTIF: "Thông báo",
  NEWSFEED: "Newsfeed",
  WATCH: "Watch",
  STORY: "Story",
  ADD_FRIEND: "Kết bạn",
  JOIN_GROUP: "Nhóm",
  LEAVE_GROUP: "Rời nhóm",
};

export const ACTION_FULL_LABELS = {
  CHECK_NOTIF: "Check thông báo",
  NEWSFEED: "Lướt Newsfeed",
  WATCH: "Xem video Watch",
  STORY: "Xem Story",
  ADD_FRIEND: "Kết bạn",
  JOIN_GROUP: "Tham gia nhóm",
  LEAVE_GROUP: "Rời nhóm",
};

// Tiêu chí Rời nhóm (leave_criteria); ngưỡng ngày random trong code BE, không có ô trên UI
export const LEAVE_CRITERIA_LABELS = {
  not_visited: "Nhóm không tương tác lâu ngày",
  inactive: "Nhóm lâu chưa hoạt động",
  recent: "Nhóm tham gia gần đây",
};

// Trạng thái 1 nick trong lượt chạy (farm_runs / farm_run_history.final_status)
export const RUN_STATUS = {
  RUNNING: {
    label: "Đang chạy",
    dot: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
  },
  PAUSED: {
    label: "Tạm dừng",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  PENDING: {
    label: "Chờ thực thi",
    dot: "bg-slate-500",
    badge: "bg-slate-100 text-slate-600 border-slate-200",
  },
  COMPLETED: {
    label: "Hoàn thành",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  BLOCKED: {
    label: "Bị chặn tính năng",
    dot: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
  },
  FAILED: {
    label: "Lỗi hệ thống",
    dot: "bg-rose-400",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
  },
  DIE: {
    label: "Acc chết",
    dot: "bg-red-600",
    badge: "bg-red-50 text-red-700 border-red-200",
  },
  STOPPED: {
    label: "Đã dừng",
    dot: "bg-slate-700",
    badge: "bg-slate-100 text-slate-700 border-slate-300",
  },
};

// Thứ tự thẻ đếm ở Giám sát tiến trình
export const MONITOR_STATUSES = [
  "RUNNING",
  "PAUSED",
  "PENDING",
  "COMPLETED",
  "FAILED",
  "DIE",
  "STOPPED",
];

// BLOCKED không còn là trạng thái cuối mới; RUN_STATUS vẫn giữ nhãn để hiện các dòng lịch sử cũ
export const FINAL_STATUSES = ["COMPLETED", "STOPPED", "FAILED", "DIE"];

// Kết quả từng hành động (farm_interaction_logs.status / actions trong status)
export const ACTION_STATUS = {
  PENDING: {
    label: "Chờ",
    badge: "bg-slate-50 text-slate-500 border-slate-200",
  },
  RUNNING: {
    label: "Đang chạy",
    badge: "bg-blue-50 text-blue-700 border-blue-300",
  },
  SUCCESS: {
    label: "Thành công",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  BLOCKED: {
    label: "Bị chặn",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
  },
  SKIPPED: {
    label: "Bỏ qua",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  FAILED: { label: "Lỗi", badge: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const PROXY_MODE_LABELS = {
  full: "Proxy",
  facebook_only: "Proxy chỉ Facebook",
  none: "IP máy",
};

// Chỉ hiện ở chi tiết lịch sử khi nick là legacy; nick native (mặc định) không hiện dòng Fingerprint
export const FINGERPRINT_LABELS = {
  legacy: "Chrome thật (không giả lập)",
};

export const FINGERPRINT_HINTS = {
  legacy:
    "Profile có từ trước nên giữ nguyên dấu vân tay thật của Chrome, không thêm nhiễu",
};

export const FRIEND_SOURCE_LABELS = {
  suggestions: "gợi ý",
  group_members: "thành viên nhóm",
  list: "danh sách link",
};

// farm_run_history.groups_source; dòng lịch sử cũ không có (NULL) thì suy theo từ khóa
export const GROUP_SOURCE_LABELS = {
  keyword: "từ khóa",
  suggested: "nhóm đề xuất",
  list: "danh sách link",
};

// Kết quả từng link của chế độ danh sách (farm_interaction_logs.targets[].result) khi bị bỏ qua
export const LINK_SKIP_LABELS = {
  skipped_done: "Đã làm trước đó",
  skipped_unavailable: "Không mở được",
  skipped_form: "Form phức tạp",
  skipped_last_admin: "Admin cuối",
  skipped_owned: "Thuộc nick khác",
  skipped_own_nick: "Nick trong dàn",
};

export const HARD_MAX_THREADS = 10;
export const MAX_TIME_VALUE = 3600;
// Thả cảm xúc (REACTION_TYPES phía BE): giống nhau ở Newsfeed, Watch, Story; tỉ lệ thả chỉ đặt ở BE (REACT_RATE)
export const REACTION_TYPES = ["Like", "Love", "Care", "Haha", "Wow", "Sad"];
// Emoji Unicode minh họa cho từng loại (không dùng ảnh của Facebook)
export const REACTION_EMOJI = {
  Like: "👍",
  Love: "❤️",
  Care: "🥰",
  Haha: "😆",
  Wow: "😮",
  Sad: "😢",
};
// Giới hạn số nhóm / lời mời mỗi nick mỗi phiên ở chế độ danh sách link (LIST_LIMIT_RANGE phía BE)
export const LIST_LIMIT_MIN = 1;
export const LIST_LIMIT_MAX = 100;
