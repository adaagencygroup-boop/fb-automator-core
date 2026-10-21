"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OctagonX, PauseCircle, Play, PlayCircle } from "lucide-react";
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
import ScenarioConfig, { DEFAULT_CONFIG, GROUP_KEYWORD_MAX_LEN, toPayload } from "./ScenarioConfig";
import { NumberInput, PageTitle } from "./parts";
import { useFarmAccounts } from "../hooks/useFarmAccounts";

const CONFIG_KEY = "m03.farm.config";
const THREADS_KEY = "m03.farm.threads";
const POLL_MS = 2000;

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
  if (settings?.farm_daily_limit_enabled != null) out.daily_limit_enabled = settings.farm_daily_limit_enabled === "1";
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
  const wasRunning = useRef(false);

  const running = Boolean(status?.running);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getFarmStatus());
    } catch (err) {
      toast.error({ key: "farm-status", title: "KHÔNG ĐỌC ĐƯỢC TRẠNG THÁI", message: err.message });
    }
  }, []);

  // Lần đầu mở màn: tài khoản, trạng thái phiên (khôi phục nếu đang chạy), cấu hình đã lưu
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = readSaved(CONFIG_KEY);
      const savedThreads = readSaved(THREADS_KEY);
      const [settings] = await Promise.allSettled([getFarmSettings(), loadStatus()]);
      if (cancelled) return;
      setConfig({
        ...DEFAULT_CONFIG,
        ...(saved && typeof saved === "object" ? saved : {}),
        ...(settings.status === "fulfilled" ? settingsToConfig(settings.value) : {}),
      });
      if (savedThreads) setThreads(String(savedThreads));
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

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

  const sessionAccounts = useMemo(() => {
    if (!running) return [];
    return (status?.accounts || []).map((a) => knownAccounts[a.uid] || { uid: a.uid, profile_name: a.name });
  }, [running, status, knownAccounts]);

  const validate = () => {
    const uids = Object.values(knownAccounts).filter((a) => selected.has(a.uid) && isEligible(a)).map((a) => a.uid);
    if (!uids.length) return "Vui lòng chọn ít nhất 1 tài khoản Live + Đã đăng nhập.";
    const enabled = ["enabled_newsfeed", "enabled_watch", "enabled_add_friends", "enabled_join_groups", "enabled_check_notif"];
    if (!enabled.some((k) => config[k])) return "Kịch bản tương tác đang trống. Vui lòng chọn ít nhất 1 hành động.";
    if (config.enabled_join_groups && config.group_keyword.trim().length > GROUP_KEYWORD_MAX_LEN) {
      return `Từ khóa tham gia nhóm không được quá ${GROUP_KEYWORD_MAX_LEN} ký tự.`;
    }
    return { uids };
  };

  const handleStart = async () => {
    const check = validate();
    if (typeof check === "string") {
      toast.warning(check, "CHƯA THỂ KÍCH HOẠT");
      return;
    }
    const payload = toPayload(config);
    const threadCount = Math.min(HARD_MAX_THREADS, Math.max(1, parseInt(threads, 10) || 1));
    setBusy("start");
    try {
      // Giới hạn mỗi ngày là cấu hình theo máy: lưu lại để lần sau / máy khác mở ra thấy đúng
      await Promise.all([
        saveFarmSetting("farm_daily_limit_enabled", payload.daily_limit_enabled ? 1 : 0),
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
    } catch (err) {
      toast.error(err.message, "KÍCH HOẠT THẤT BẠI");
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

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageTitle
        title="Tương tác tài khoản"
        description="Tự động tương tác Newsfeed, xem Watch, kết bạn, tham gia nhóm để giữ trust profile Facebook bền vững."
      />

      <AccountPicker
        accounts={running ? sessionAccounts : accountPages.accounts}
        knownAccounts={knownAccounts}
        total={accountPages.total}
        search={accountPages.search}
        onSearchChange={accountPages.changeSearch}
        loading={accountPages.loading}
        loadingMore={accountPages.loadingMore}
        loadError={accountPages.loadError}
        moreError={accountPages.moreError}
        hasMore={accountPages.hasMore}
        onLoadMore={accountPages.loadMore}
        selected={selected}
        onSelectedChange={setSelected}
        onRefresh={loadAccounts}
        readOnly={running}
      />

      <ScenarioConfig config={config} onChange={updateConfig} disabled={running} />

      <div className="flex items-center gap-4">
        <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Nhập số luồng chạy</span>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-subtle">
          <NumberInput value={threads} onChange={updateThreads} min={1} max={HARD_MAX_THREADS} disabled={running} className="w-16 border-0 shadow-none" />
          <span className="text-sm text-slate-400">Luồng</span>
        </div>
        <span className="text-[11px] text-slate-400">Tối đa {HARD_MAX_THREADS} luồng; không vượt quá số nick đã chọn</span>
      </div>

      {status?.accounts?.length > 0 && <ProgressMonitor status={status} />}

      {running ? (
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
          onClick={handleStart}
          disabled={busy === "start"}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-primary text-sm font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
        >
          <Play className="h-5 w-5" />
          {busy === "start" ? "Đang kích hoạt..." : "Kích hoạt"}
        </button>
      )}

      <LogConsole running={running} />

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
