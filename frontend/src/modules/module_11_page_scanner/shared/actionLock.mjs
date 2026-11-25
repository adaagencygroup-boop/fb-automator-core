/**
 * Khoá nút trong lúc xử lý (Module 11): bấm liên tục chỉ chạy 1 lần.
 * - Khoá ngay khi bấm (biến thường, không chờ React render) → double-click trong cùng 1 nhịp cũng bị chặn.
 * - Mở khoá khi xử lý xong VÀ đã qua tối thiểu `minMs` (tránh bắn lại thông báo ngay sau đó).
 * - Tách trạng thái `running` (đang thực sự chạy tác vụ bất đồng bộ) khỏi `locked` (đang chạy hoặc đang chờ
 *   hết thời gian giữ khoá `minMs`), để nút chỉ hiện spinner khi thật sự đang gọi API thay vì nháy khi lỗi kiểm tra.
 * Hàm thuần (không React) để test bằng `node --test`; hook React ở useActionLock.js.
 */
export const ACTION_LOCK_MS = 1500;

export function createActionLock({
  minMs = ACTION_LOCK_MS,
  onBusyChange = () => {},
  onRunningChange = () => {},
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
} = {}) {
  let locked = false;
  let running = false;
  let timer = null;

  const release = () => {
    timer = null;
    locked = false;
    onBusyChange(false);
  };

  return {
    isLocked: () => locked,
    isRunning: () => running,

    /** Chạy fn nếu đang không khoá; đang khoá thì bỏ qua (trả undefined). Lỗi của fn được ném lại như cũ. */
    async run(fn, ...args) {
      if (locked) return undefined;
      locked = true;
      onBusyChange(true);
      const started = now();
      try {
        const result = fn(...args);
        if (result && typeof result.then === "function") {
          running = true;
          onRunningChange(true);
          return await result;
        }
        return result;
      } finally {
        if (running) {
          running = false;
          onRunningChange(false);
        }
        const wait = Math.max(0, minMs - (now() - started));
        if (timer) cancel(timer);
        if (wait > 0) timer = schedule(release, wait);
        else release();
      }
    },

    /** Gỡ hẹn giờ mở khoá (khi component bị huỷ). */
    dispose() {
      if (timer) cancel(timer);
      timer = null;
      locked = false;
      running = false;
    },
  };
}
