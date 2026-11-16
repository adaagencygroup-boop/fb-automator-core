"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OctagonX, PauseCircle, Play, PlayCircle, RotateCcw } from "lucide-react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { HARD_MAX_THREADS } from "../constants";
import {
  getFarmSettings,
  getFarmStatus,
  pauseFarm,
  resumeFarm,
  saveFarmSetting,
  startFarm,
  stopFarm,
} from "../service";
import AccountPicker, { isEligible } from "./AccountPicker";
import LogConsole from "./LogConsole";
import ProgressMonitor from "./ProgressMonitor";
import ScenarioConfig, { DEFAULT_CONFIG, GROUP_KEYWORD_MAX_LEN, linkListError, rangeError, toPayload } from "./ScenarioConfig";
import { NumberInput, PageTitle } from "./parts";
import { useFarmAccounts } from "../hooks/useFarmAccounts";
import { startNewFarmLogs } from "../hooks/useFarmLogs";

const CONFIG_KEY = "m03.farm.config";
const THREADS_KEY = "m03.farm.threads";
// Lượt đã thay ô link / từ khóa (started_at của lượt): mỗi lượt chỉ thay 1 lần, kể cả khi mở lại màn
const LEFTOVER_KEY = "m03.farm.leftover_applied";
const LEFTOVER_FIELDS = ["group_links", "group_keyword", "friend_links"];
const POLL_MS = 2000;
// Quá thời gian chờ Kích hoạt nhưng máy chủ vẫn đang chuẩn bị (CSDL ở xa chậm): hỏi trạng thái thêm ~1 phút
const START_CONFIRM_TRIES = 30;
// Phiên được tính là của lần bấm này khi bắt đầu sau lúc bấm (trừ hao lệch giờ nhỏ)
const START_CLOCK_SLACK_S = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeSaved(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* bỏ qua: chỉ là ghi nhớ cấu hình cho lần sau */
  }
}

// farm_settings (theo máy) -> các ô giới hạn mỗi ngày
function settingsToConfig(settings) {
  const out = {};
  // Bản cũ chỉ có 1 công tắc chung (farm_daily_limit_enabled): máy chưa lưu công tắc riêng thì lấy theo công tắc chung
  const shared = settings?.farm_daily_limit_enabled;
  for (const [field, key] of [["daily_friend_limit_enabled", "farm_daily_friend_limit_enabled"], ["daily_group_limit_enabled", "farm_daily_group_limit_enabled"]]) {
    const value = settings?.[key] ?? shared;
    if (value != null) out[field] = value === "1";
  }
  if (settings?.farm_daily_friend_limit) out.daily_friend_limit = String(settings.farm_daily_friend_limit);
  if (settings?.farm_daily_group_limit) out.daily_group_limit = String(settings.farm_daily_group_limit);
  return out;
}

export default function FarmEngage() {
  const accountPages = useFarmAccounts();
  const { knownAccounts, reload: loadAccounts } = accountPages;
  const [selected, setSelected] = useState(() => new Set());
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [threads, setThreads] = useState("5");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  // Giống Tab 2: "config" chưa hiện tiến trình, "running" hiện giám sát + log và khóa cấu hình tới khi bấm quay về
  const [viewState, setViewState] = useState("config");
  const wasRunning = useRef(false);

  const running = Boolean(status?.running);

  // Lượt đã xong: BE tính sẵn phần link / từ khóa còn lại (null = giữ nguyên ô đó), thay vào ô nhập và lưu lại.
  // Chỉ thay khi về màn cấu hình (bấm "Quay về cấu hình ban đầu" hoặc mở lại trang sau khi lượt đã xong) để lúc còn
  // xem tiến trình vẫn đối chiếu được với link đã dán.
  const applyLeftover = useCallback((next) => {
    const leftover = next?.leftover;
    if (next?.running || !leftover || !next.started_at || readSaved(LEFTOVER_KEY) === next.started_at) return;
    writeSaved(LEFTOVER_KEY, next.started_at);
    const base = { ...DEFAULT_CONFIG, ...(readSaved(CONFIG_KEY) || {}) };
    const changed = LEFTOVER_FIELDS.filter((key) => leftover[key] != null && leftover[key] !== base[key]);
    if (!changed.length) return;
    const updated = { ...base, ...Object.fromEntries(changed.map((key) => [key, leftover[key]])) };
    writeSaved(CONFIG_KEY, updated);
    setConfig((current) => ({ ...current, ...Object.fromEntries(changed.map((key) => [key, leftover[key]])) }));
    toast.info("Đã bỏ link / từ khóa đã chạy xong khỏi ô nhập, phần chưa xong được giữ lại để chạy lại.", "CẬP NHẬT CẤU HÌNH");
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const next = await getFarmStatus();
      setStatus(next);
      if (next?.running) setViewState("running");
      return next;
    } catch (err) {
      toast.error({ key: "farm-status", title: "KHÔNG ĐỌC ĐƯỢC TRẠNG THÁI", message: err.message });
      return null;
    }
  }, []);

  // Lần đầu mở màn: tài khoản, trạng thái phiên (khôi phục nếu đang chạy), cấu hình đã lưu
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedThreads = readSaved(THREADS_KEY);
      const [settings, current] = await Promise.allSettled([getFarmSettings(), loadStatus()]);
      if (cancelled) return;
      const saved = readSaved(CONFIG_KEY);
      setConfig({
        ...DEFAULT_CONFIG,
        ...(saved && typeof saved === "object" ? saved : {}),
        ...(settings.status === "fulfilled" ? settingsToConfig(settings.value) : {}),
      });
      if (savedThreads) setThreads(String(savedThreads));
      // Lượt đã xong khi mở trang: màn vào thẳng cấu hình nên thay ô link / từ khóa luôn
      if (current.status === "fulfilled") applyLeftover(current.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatus, applyLeftover]);

  // Đang chạy thì hỏi trạng thái định kỳ; vừa chạy xong thì tải lại tài khoản (trạng thái nick có thể đã đổi)
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      const timer = setInterval(loadStatus, POLL_MS);
      return () => clearInterval(timer);
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      loadAccounts();
    }
    return undefined;
  }, [running, loadStatus, loadAccounts]);

  const updateConfig = (next) => {
    setConfig(next);
    writeSaved(CONFIG_KEY, next);
  };

  const updateThreads = (value) => {
    setThreads(value);
    writeSaved(THREADS_KEY, value);
  };

  const countEligible = useCallback(
    (uids) => Object.values(knownAccounts).filter((a) => uids.has(a.uid) && isEligible(a)).length,
    [knownAccounts]
  );
  const selectedCount = useMemo(() => countEligible(selected), [countEligible, selected]);
  // Số luồng không vượt quá số nick đã chọn (chưa chọn nick nào thì theo trần chung)
  const maxThreads = selectedCount ? Math.min(HARD_MAX_THREADS, selectedCount) : HARD_MAX_THREADS;

  const changeSelected = (next) => {
    setSelected(next);
    const limit = countEligible(next);
    if (limit && (parseInt(threads, 10) || 1) > limit) updateThreads(String(Math.min(HARD_MAX_THREADS, limit)));
  };

  const sessionAccounts = useMemo(() => {
    if (viewState !== "running") return [];
    return (status?.accounts || []).map((a) => knownAccounts[a.uid] || { uid: a.uid, profile_name: a.name });
  }, [viewState, status, knownAccounts]);

  const validate = () => {
    const uids = Object.values(knownAccounts).filter((a) => selected.has(a.uid) && isEligible(a)).map((a) => a.uid);
    if (!uids.length) return "Vui lòng chọn ít nhất 1 tài khoản Live + Đã đăng nhập.";
    const enabled = ["enabled_newsfeed", "enabled_watch", "enabled_story", "enabled_add_friends", "enabled_join_groups", "enabled_leave_groups", "enabled_check_notif"];
    if (!enabled.some((k) => config[k])) return "Kịch bản tương tác đang trống. Vui lòng chọn ít nhất 1 hành động.";
    const zeroRange = rangeError(config);
    if (zeroRange) return zeroRange;
    const groupList = config.group_source === "list";
    const byKeyword = config.group_source === "keyword";
    if (config.enabled_join_groups && byKeyword && config.group_keyword.trim().length > GROUP_KEYWORD_MAX_LEN) {
      return `Từ khóa tham gia nhóm không được quá ${GROUP_KEYWORD_MAX_LEN} ký tự.`;
    }
    if (config.enabled_join_groups && byKeyword && !config.group_keyword.split(",").some((w) => w.trim())) {
      return "Vui lòng nhập từ khóa tham gia nhóm, hoặc chọn Theo đề xuất để tham gia nhóm Facebook đề xuất.";
    }
    const listError = (config.enabled_join_groups && groupList && linkListError(config.group_links, "group"))
      || (config.enabled_add_friends && config.friend_source === "list" && linkListError(config.friend_links, "friend"));
    if (listError) return listError;
    return { uids };
  };

  // Hết thời gian chờ Kích hoạt: máy chủ không biết giao diện đã thôi chờ nên vẫn chạy tiếp, hỏi trạng thái tới khi
  // thấy phiên bắt đầu sau lúc bấm (không hiện lỗi đọc trạng thái ở từng lần hỏi)
  const confirmStarted = async (clickedAt) => {
    for (let i = 0; i < START_CONFIRM_TRIES; i += 1) {
      const next = await getFarmStatus().catch(() => null);
      if (next?.started_at && next.started_at >= clickedAt - START_CLOCK_SLACK_S) {
        setStatus(next);
        return true;
      }
      await sleep(POLL_MS);
    }
    return false;
  };

  const handleStart = async () => {
    const check = validate();
    if (typeof check === "string") {
      toast.warning(check, "CHƯA THỂ KÍCH HOẠT");
      return;
    }
    const payload = toPayload(config);
    const threadCount = Math.min(HARD_MAX_THREADS, check.uids.length, Math.max(1, parseInt(threads, 10) || 1));
    setBusy("start");
    const clickedAt = Date.now() / 1000;
    // Phiên mới: khung log và bộ lọc luồng chỉ còn của phiên này
    const restoreLogs = startNewFarmLogs();
    try {
      // Giới hạn mỗi ngày là cấu hình theo máy: lưu lại để lần sau / máy khác mở ra thấy đúng
      await Promise.all([
        saveFarmSetting("farm_daily_friend_limit_enabled", payload.daily_friend_limit_enabled ? 1 : 0),
        saveFarmSetting("farm_daily_group_limit_enabled", payload.daily_group_limit_enabled ? 1 : 0),
        saveFarmSetting("farm_daily_friend_limit", Math.min(100, Math.max(1, payload.daily_friend_limit))),
        saveFarmSetting("farm_daily_group_limit", Math.min(100, Math.max(1, payload.daily_group_limit))),
      ]).catch((err) => toast.warning(`Không lưu được giới hạn mỗi ngày: ${err.message}`));
      const res = await startFarm(check.uids, threadCount, payload);
      toast.success(
        `Đang chạy ${res.accepted?.length || 0} nick với ${res.threads} luồng` +
          (res.rejected?.length ? `, bỏ qua ${res.rejected.length} nick không đủ điều kiện` : ""),
        "ĐÃ KÍCH HOẠT"
      );
      await loadStatus();
      setViewState("running");
    } catch (err) {
      if (err.code !== "ECONNABORTED") {
        restoreLogs();
        toast.error(err.message, "KÍCH HOẠT THẤT BẠI");
      } else if (await confirmStarted(clickedAt)) {
        toast.success("Máy chủ phản hồi chậm nhưng phiên đã được kích hoạt.", "ĐÃ KÍCH HOẠT");
        setViewState("running");
      } else {
        toast.warning(
          "Máy chủ phản hồi quá chậm, chưa xác nhận được phiên chạy. Đợi ít phút rồi mở lại màn này để xem phiên đã chạy chưa trước khi bấm Kích hoạt lại.",
          "CHƯA XÁC NHẬN ĐƯỢC"
        );
      }
    } finally {
      setBusy("");
    }
  };

  const handlePauseResume = async () => {
    setBusy("pause");
    try {
      if (status?.paused) await resumeFarm();
      else await pauseFarm();
      await loadStatus();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  const handleStop = async () => {
    setBusy("stop");
    try {
      await stopFarm();
      toast.info("Các nick đang chạy sẽ lưu cookie rồi đóng trình duyệt, nick đang chờ bị hủy.", "ĐANG DỪNG");
      await loadStatus();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
      setConfirmStop(false);
    }
  };

  const handleBackToConfig = () => {
    setSelected(new Set());
    setViewState("config");
    applyLeftover(status);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageTitle
        title="Tương tác tài khoản"
        description="Tự động tương tác Newsfeed, xem Watch, kết bạn, tham gia nhóm để giữ trust profile Facebook bền vững."
      />

      <AccountPicker
        accounts={viewState === "running" ? sessionAccounts : accountPages.accounts}
        knownAccounts={knownAccounts}
        total={accountPages.total}
        search={accountPages.search}
        onSearchChange={accountPages.changeSearch}
        category={accountPages.category}
        onCategoryChange={accountPages.changeCategory}
        loading={accountPages.loading}
        loadingMore={accountPages.loadingMore}
        loadError={accountPages.loadError}
        moreError={accountPages.moreError}
        hasMore={accountPages.hasMore}
        onLoadMore={accountPages.loadMore}
        selected={selected}
        onSelectedChange={changeSelected}
        onRefresh={loadAccounts}
        readOnly={viewState === "running"}
      />

      <ScenarioConfig config={config} onChange={updateConfig} disabled={viewState === "running"} />

      <div className="flex items-center gap-4">
        <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Nhập số luồng chạy</span>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-subtle">
          <NumberInput value={threads} onChange={updateThreads} min={1} max={maxThreads} disabled={viewState === "running"} className="w-16 border-0 shadow-none" />
          <span className="text-sm text-slate-400">Luồng</span>
        </div>
        <span className="text-[11px] text-slate-400">
          {selectedCount
            ? `Tối đa ${maxThreads} luồng (đã chọn ${selectedCount} nick)`
            : `Tối đa ${HARD_MAX_THREADS} luồng; không vượt quá số nick đã chọn`}
        </span>
      </div>

      {viewState === "config" ? (
        <button
          type="button"
          onClick={handleStart}
          disabled={busy === "start"}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-primary text-sm font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
        >
          <Play className="h-5 w-5" />
          {busy === "start" ? "Đang kích hoạt..." : "Kích hoạt"}
        </button>
      ) : running ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handlePauseResume}
            disabled={Boolean(busy) || status?.stopping}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red-300 bg-white text-sm font-bold uppercase text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {status?.paused ? <PlayCircle className="h-5 w-5" /> : <PauseCircle className="h-5 w-5" />}
            {status?.paused ? "Tiếp tục" : "Tạm dừng"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmStop(true)}
            disabled={Boolean(busy) || status?.stopping}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-red-100 px-8 text-sm font-bold uppercase text-red-700 transition hover:bg-red-200 disabled:opacity-50"
          >
            <OctagonX className="h-5 w-5" />
            {status?.stopping ? "Đang dừng..." : "Dừng khẩn cấp"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleBackToConfig}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-primary text-sm font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary-hover"
        >
          <RotateCcw className="h-5 w-5" />
          Quay về cấu hình ban đầu
        </button>
      )}

      {viewState === "running" && status?.accounts?.length > 0 && <ProgressMonitor status={status} />}

      {/* Chỉ ẩn, không gỡ: hook log kết nối WebSocket khi có người nghe, gỡ ra sẽ mất log đầu lượt */}
      <div className={viewState === "running" ? undefined : "hidden"}>
        <LogConsole running={running} />
      </div>

      <ConfirmDialog
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={handleStop}
        loading={busy === "stop"}
        title="Dừng khẩn cấp phiên Tương tác?"
        description="Các nick đang chạy sẽ dừng ở bước hiện tại, lưu cookie rồi đóng trình duyệt. Nick đang chờ sẽ bị hủy. Không thể tiếp tục phiên này sau khi dừng."
        confirmText="Dừng ngay"
      />
    </div>
  );
}
