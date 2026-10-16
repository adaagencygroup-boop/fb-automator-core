"use client";

import { seedingApi } from "@/modules/module_08_interaction_seeding/service";
import { normalizeTargetUrl } from "@/modules/module_08_interaction_seeding/validation";
import { useLocalSSE } from "@/modules/module_02_account_manager/hooks/useLocalSSE.js";
import { toast } from "@/components/ui/toast";
import { UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import ProfileAccountConfig from "./_components/ProfileAccountConfig";
import ProfileActionBar from "./_components/ProfileActionBar";
import ProfileProgressTerminal from "./_components/ProfileProgressTerminal";
import ProfileSummaryCards from "./_components/ProfileSummaryCards";
import ProfileTargetSection from "./_components/ProfileTargetSection";

export default function SeedingProfilePage() {
  const [targets, setTargets] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);
  const [accountCount, setAccountCount] = useState(2);
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [isRunning, setIsRunning] = useState(false);
  const [currentCampaignId, setCurrentCampaignId] = useState(null);

  // Real accounts count from backend database
  const [liveAccountsCount, setLiveAccountsCount] = useState(0);
  const [totalAccountsCount, setTotalAccountsCount] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    seedingApi
      .getAccounts()
      .then((accs) => {
        if (Array.isArray(accs)) {
          setTotalAccountsCount(accs.length);
          // Tài khoản khả dụng: BẮT BUỘC có trạng thái live và đã đăng nhập (logged_in)
          const validLiveLoggedIn = accs.filter(
            (a) =>
              a.status?.toLowerCase() === "live" &&
              a.login_status?.toLowerCase() === "logged_in",
          );
          const validCount = validLiveLoggedIn.length;
          setLiveAccountsCount(validCount);
          setAccountCount(validCount > 0 ? Math.min(validCount, 10) : 0);
        }
      })
      .catch(() => {});
  }, []);

  // Realtime logs: local UI notifications + SSE backend stream
  const { logs: sseLogs } = useLocalSSE(true);
  const [localLogs, setLocalLogs] = useState([]);

  const addLog = (text, type = "info") => {
    const time = new Date().toLocaleTimeString("vi-VN");
    setLocalLogs((prev) => [
      ...prev,
      { id: Math.random().toString(), text, time, type },
    ]);
  };

  // Merge SSE logs with local UI logs
  const combinedLogs = [
    ...localLogs,
    ...sseLogs.map((l, idx) => {
      let displayTime = l.timestamp || l.time;
      if (displayTime && displayTime.length > 10) {
        try {
          displayTime = new Date(displayTime).toLocaleTimeString("vi-VN");
        } catch {}
      }
      return {
        id: `sse-${l.timestamp || l.time || idx}-${idx}`,
        text: l.message,
        time: displayTime || "--:--:--",
        type: l.type === "warning" ? "warn" : l.type || "info",
      };
    }),
  ];

  // Poll campaign status while running
  useEffect(() => {
    if (!isRunning || !currentCampaignId) return;

    const interval = setInterval(async () => {
      try {
        const detail =
          await seedingApi.getSeedingCampaignDetail(currentCampaignId);
        if (detail) {
          const status = detail.status || detail.campaign?.status;
          const isBatchActive = detail.is_batch_active;
          if (
            !isBatchActive &&
            (status === "COMPLETED" ||
              status === "FAILED" ||
              status === "STOPPED")
          ) {
            setIsRunning(false);
            addLog(
              `Chiến dịch hoàn tất với trạng thái: ${detail.status_display || status}.`,
              status === "COMPLETED" ? "success" : "warn",
            );
          }
        }
      } catch (err) {
        // Ignore polling error
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isRunning, currentCampaignId]);

  // Load saved targets from database on mount
  useEffect(() => {
    seedingApi
      .getSeedingTargets("PROFILE")
      .then((res) => {
        if (res && res.targets && res.targets.length > 0) {
          setTargets(res.targets);
          setSuccessMessage(
            `Đã tải ${res.targets.length} trang cá nhân từ cơ sở dữ liệu`,
          );
        }
      })
      .catch(() => {});
  }, []);

  const handleAddTargets = async (rawUrls) => {
    try {
      const normalizedUrls = (rawUrls || []).map((u) => normalizeTargetUrl(u, "PROFILE"));
      const res = await seedingApi.validateSeedingTargets("PROFILE", normalizedUrls);
      if (res && res.targets) {
        setTargets(res.targets);
        setSuccessMessage(
          `Đã lưu thành công ${res.targets.length} trang cá nhân vào cơ sở dữ liệu`,
        );
        return res.targets;
      }
    } catch (e) {
      addLog(`Lỗi lưu link trang cá nhân: ${e.message}`, "error");
      throw e;
    }
  };

  const handleRemoveTarget = async (index) => {
    const targetToRemove = targets[index];
    if (targetToRemove) {
      try {
        await seedingApi.deleteSeedingTarget(targetToRemove.url, "PROFILE");
      } catch (err) {
        addLog(`Lỗi xóa target: ${err.message}`, "error");
        throw err;
      }
    }
    setTargets((prev) => {
      const updated = prev
        .filter((_, idx) => idx !== index)
        .map((item, idx) => ({ ...item, stt: idx + 1 }));
      setSuccessMessage(
        updated.length > 0
          ? `Đã cập nhật danh sách (${updated.length} trang cá nhân)`
          : null,
      );
      return updated;
    });
  };

  const handleClearTargets = async () => {
    try {
      await seedingApi.clearSeedingTargets("PROFILE");
    } catch (err) {
      addLog(`Lỗi xóa danh sách: ${err.message}`, "error");
      throw err;
    }
    setTargets([]);
    setSuccessMessage(null);
  };

  const handleStart = async () => {
    if (targets.length === 0) {
      toast.warning("Vui lòng thêm ít nhất 1 trang cá nhân cần seeding!", "THIẾU MỤC TIÊU");
      return;
    }

    if (liveAccountsCount === 0) {
      toast.error(
        "Không có tài khoản Facebook nào khả dụng! Yêu cầu tài khoản phải có trạng thái 'Đã đăng nhập' và còn 'Live'. Vui lòng kiểm tra lại trang Quản lý tài khoản.",
        "KHÔNG CÓ TÀI KHOẢN KHẢ DỤNG"
      );
      return;
    }

    if (accountCount <= 0 || accountCount > liveAccountsCount) {
      toast.warning(
        `Số lượng tài khoản muốn chạy (${accountCount}) không hợp lệ hoặc vượt quá số tài khoản khả dụng (${liveAccountsCount})!`,
        "SỐ LƯỢNG KHÔNG HỢP LỆ"
      );
      return;
    }

    try {
      setIsRunning(true);
      toast.info("Đang khởi tạo chiến dịch Seeding Trang cá nhân...", "BẮT ĐẦU");
      addLog(
        "Khởi tạo chiến dịch Seeding Trang cá nhân trên máy thật...",
        "info",
      );

      const campaign = await seedingApi.createSeedingCampaign({
        name: `Seeding Profile - ${new Date().toLocaleTimeString("vi-VN")}`,
        campaign_type: "PROFILE",
        actions: ["FOLLOW"],
        targets: targets.map((t) => ({
          url: t.url,
          display_name: t.display_name,
        })),
        account_count: accountCount,
        threads: 1,
        min_delay_sec: delayMin,
        max_delay_sec: delayMax,
      });

      setCurrentCampaignId(campaign.id);
      const totalProfiles = campaign.total_targets || targets.length;
      addLog(
        `Đã khởi tạo ${totalProfiles} chiến dịch riêng biệt (${campaign.total_tasks} tác vụ). Bắt đầu thực thi...`,
        "success",
      );
      toast.success(
        `Chiến dịch đã được khởi chạy với ${totalProfiles} Trang cá nhân!`,
        "KHỞI CHẠY THÀNH CÔNG"
      );

      await seedingApi.startSeedingCampaign(campaign.id);
    } catch (e) {
      setIsRunning(false);
      addLog(`Lỗi khởi chạy seeding: ${e.message}`, "error");
      toast.error(e.message || "Không thể khởi chạy chiến dịch seeding!", "LỖI KHỞI CHẠY");
    }
  };

  const handleStop = async () => {
    try {
      addLog(
        "Đang gửi yêu cầu dừng chiến dịch và đóng toàn bộ trình duyệt Chrome...",
        "warn",
      );
      toast.info("Đang dừng chiến dịch seeding...", "DỪNG CHIẾN DỊCH");
      if (currentCampaignId) {
        await seedingApi.stopSeedingCampaign(currentCampaignId);
      } else {
        await seedingApi.stopAllSeeding();
      }
      addLog("Đã dừng hẳn chiến dịch seeding thành công.", "warn");
      toast.warning("Đã dừng chiến dịch seeding.", "ĐÃ DỪNG");
    } catch (e) {
      addLog(`Lỗi khi dừng: ${e.message}`, "error");
      toast.error(e.message || "Lỗi khi gửi yêu cầu dừng chiến dịch!", "LỖI");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="w-full space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 shrink-0">
            <UserCheck className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Seeding Trang cá nhân
            </h1>
            <p className="text-xs text-slate-500 mt-1 font-normal">
              Tăng Follow và Like Trang cá nhân cho nhiều tài khoản cá nhân Facebook.
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Input Targets */}
      <ProfileTargetSection
        targets={targets}
        onAddTargets={handleAddTargets}
        onRemoveTarget={handleRemoveTarget}
        onClearTargets={handleClearTargets}
        successMessage={successMessage}
      />

      {/* Steps 2 & 3: Account Config & Delay */}
      <ProfileAccountConfig
        accountCount={accountCount}
        onAccountCountChange={setAccountCount}
        availableAccounts={liveAccountsCount}
        liveAccounts={liveAccountsCount}
        totalAccounts={totalAccountsCount}
        minDelay={delayMin}
        maxDelay={delayMax}
        onMinDelayChange={setDelayMin}
        onMaxDelayChange={setDelayMax}
      />

      {/* Summary Cards */}
      <ProfileSummaryCards
        targets={targets}
        accountCount={accountCount}
        minDelay={delayMin}
        maxDelay={delayMax}
      />

      {/* Live Terminal */}
      <ProfileProgressTerminal logs={combinedLogs} isRunning={isRunning} />

      {/* Bottom Action Bar */}
      <ProfileActionBar
        isRunning={isRunning}
        onStart={handleStart}
        onStop={handleStop}
        disabled={targets.length === 0}
      />
    </div>
  );
}
