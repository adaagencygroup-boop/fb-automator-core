"use client";

import { seedingApi } from "@/modules/module_08_interaction_seeding/service";
import { normalizeTargetUrl } from "@/modules/module_08_interaction_seeding/validation";
import { useLocalSSE } from "@/modules/module_02_account_manager/hooks/useLocalSSE.js";
import { toast } from "@/components/ui/toast";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import PostAccountConfig from "./_components/PostAccountConfig";
import PostActionBar from "./_components/PostActionBar";
import PostCommentsManager from "./_components/PostCommentsManager";
import PostProgressTerminal from "./_components/PostProgressTerminal";
import PostReactionSelector from "./_components/PostReactionSelector";
import PostSummaryCards from "./_components/PostSummaryCards";
import PostTargetSection from "./_components/PostTargetSection";

export default function SeedingPostPage() {
  const [targets, setTargets] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);

  // Interaction options - Mặc định ban đầu không tích chọn mục nào (người dùng tự chọn)
  const [doLike, setDoLike] = useState(false);
  const [doComment, setDoComment] = useState(false);
  const [doShare, setDoShare] = useState(false);
  const [selectedReactions, setSelectedReactions] = useState([]);

  // Comments pool
  const [comments, setComments] = useState([]);

  // Account config
  const [accountCount, setAccountCount] = useState(2);
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);

  const [isRunning, setIsRunning] = useState(false);
  const [currentCampaignId, setCurrentCampaignId] = useState(null);

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
            // Tải lại danh sách bài viết chưa chạy để loại bỏ các link đã hoàn tất
            seedingApi
              .getSeedingTargets("POST")
              .then((res) => {
                setTargets(res?.targets || []);
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        // Ignore polling error
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isRunning, currentCampaignId]);

  // Load saved targets and comments from database on mount
  useEffect(() => {
    seedingApi
      .getSeedingTargets("POST")
      .then((res) => {
        setTargets(res?.targets || []);
        if (res && res.targets && res.targets.length > 0) {
          setSuccessMessage(
            `Đã tải ${res.targets.length} bài viết từ cơ sở dữ liệu`,
          );
        }
      })
      .catch(() => {});

    seedingApi
      .getSeedingComments()
      .then((res) => {
        if (res && res.comments && res.comments.length > 0) {
          setComments(res.comments);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleReaction = (rId) => {
    setSelectedReactions((prev) =>
      prev.includes(rId) ? prev.filter((id) => id !== rId) : [...prev, rId],
    );
  };

  const handleDoLikeChange = (val) => {
    setDoLike(val);
  };

  const handleAddTargets = async (rawUrls) => {
    try {
      const normalizedUrls = (rawUrls || []).map((u) => normalizeTargetUrl(u, "POST"));
      const res = await seedingApi.validateSeedingTargets("POST", normalizedUrls);
      if (res && res.targets) {
        setTargets(res.targets);
        setSuccessMessage(
          `Đã lưu thành công ${res.targets.length} bài viết vào cơ sở dữ liệu`,
        );
        return res.targets;
      }
    } catch (e) {
      addLog(`Lỗi lưu link bài viết: ${e.message}`, "error");
      throw e;
    }
  };

  const handleRemoveTarget = async (index) => {
    const targetToRemove = targets[index];
    if (targetToRemove) {
      try {
        await seedingApi.deleteSeedingTarget(targetToRemove.url, "POST");
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
          ? `Đã cập nhật danh sách (${updated.length} bài viết)`
          : null,
      );
      return updated;
    });
  };

  const handleClearTargets = async () => {
    try {
      await seedingApi.clearSeedingTargets("POST");
    } catch (err) {
      addLog(`Lỗi xóa danh sách bài viết: ${err.message}`, "error");
      throw err;
    }
    setTargets([]);
    setSuccessMessage(null);
  };

  const handleAddComment = async (cmt) => {
    const trimmed = cmt.trim();
    if (!trimmed) return;
    try {
      const res = await seedingApi.addSeedingComments([trimmed]);
      if (res && res.comments) {
        setComments(res.comments);
        return res.comments;
      }
    } catch (e) {
      throw e;
    }
    setComments((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const handleAddBulkComments = async (newCmts) => {
    const cleaned = newCmts.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cleaned.length === 0) return;
    try {
      const res = await seedingApi.addSeedingComments(cleaned);
      if (res && res.comments) {
        setComments(res.comments);
        return res.comments;
      }
    } catch (e) {
      throw e;
    }
    setComments((prev) => Array.from(new Set([...prev, ...cleaned])));
  };

  const handleRemoveComment = async (index) => {
    const cmtToRemove = comments[index];
    if (cmtToRemove) {
      try {
        await seedingApi.deleteSeedingComment(cmtToRemove);
      } catch (e) {
        throw e;
      }
    }
    setComments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleClearAllComments = async () => {
    try {
      await seedingApi.clearSeedingComments();
    } catch (e) {
      throw e;
    }
    setComments([]);
  };

  const handleStart = async () => {
    if (targets.length === 0) {
      toast.warning("Vui lòng thêm ít nhất 1 bài viết cần seeding!", "THIẾU MỤC TIÊU");
      return;
    }

    if (!doLike && !doComment && !doShare) {
      toast.warning(
        "Vui lòng chọn ít nhất 1 loại tương tác (Like, Bình luận hoặc Chia sẻ)!",
        "CHƯA CHỌN TƯƠNG TÁC"
      );
      return;
    }

    if (doLike && selectedReactions.length === 0) {
      toast.warning("Vui lòng chọn ít nhất 1 cảm xúc Facebook!", "CHƯA CHỌN CẢM XÚC");
      return;
    }

    if (doComment && comments.length === 0) {
      toast.warning("Vui lòng nhập ít nhất 1 câu bình luận mẫu!", "THIẾU BÌNH LUẬN");
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
      toast.info("Đang khởi tạo chiến dịch Seeding Bài viết...", "BẮT ĐẦU");
      addLog("Khởi tạo chiến dịch Seeding Bài viết trên máy thật...", "info");

      const actions = [];
      if (doLike) actions.push("REACT");
      if (doComment) actions.push("COMMENT");
      if (doShare) actions.push("SHARE");

      const campaign = await seedingApi.createSeedingCampaign({
        name: `Seeding Post - ${new Date().toLocaleTimeString("vi-VN")}`,
        campaign_type: "POST",
        actions,
        reactions: doLike ? selectedReactions : [],
        comments: doComment ? comments : [],
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
      const totalPosts = campaign.total_targets || targets.length;
      addLog(
        `Đã khởi tạo ${totalPosts} chiến dịch riêng biệt (${campaign.total_tasks} tác vụ). Bắt đầu thực thi...`,
        "success",
      );
      toast.success(
        `Chiến dịch đã được khởi chạy với ${totalPosts} bài viết!`,
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
            <FileText className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Seeding Bài viết
            </h1>
            <p className="text-xs text-slate-500 mt-1 font-normal">
              Tăng Like, cảm xúc, bình luận và chia sẻ cho nhiều bài viết trên
              Facebook tự động.
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Input Targets */}
      <PostTargetSection
        targets={targets}
        onAddTargets={handleAddTargets}
        onRemoveTarget={handleRemoveTarget}
        onClearTargets={handleClearTargets}
        successMessage={successMessage}
      />

      {/* Step 2: Reactions & Interactions */}
      <PostReactionSelector
        doLike={doLike}
        onDoLikeChange={handleDoLikeChange}
        doComment={doComment}
        onDoCommentChange={setDoComment}
        doShare={doShare}
        onDoShareChange={setDoShare}
        selectedReactions={selectedReactions}
        onToggleReaction={handleToggleReaction}
      />

      {/* Step 3: Comments Pool */}
      {doComment && (
        <PostCommentsManager
          comments={comments}
          onAddComment={handleAddComment}
          onAddBulkComments={handleAddBulkComments}
          onRemoveComment={handleRemoveComment}
          onClearAllComments={handleClearAllComments}
        />
      )}

      {/* Step 4 & 5: Accounts Count & Delay */}
      <PostAccountConfig
        accountCount={accountCount}
        onAccountCountChange={setAccountCount}
        availableAccounts={liveAccountsCount}
        liveAccounts={liveAccountsCount}
        totalAccounts={totalAccountsCount}
        minDelay={delayMin}
        maxDelay={delayMax}
        onMinDelayChange={setDelayMin}
        onMaxDelayChange={setDelayMax}
        selectedReactionsCount={selectedReactions.length}
        doLike={doLike}
        doComment={doComment}
        doShare={doShare}
      />

      {/* Summary Cards */}
      <PostSummaryCards
        targets={targets}
        accountCount={accountCount}
        doLike={doLike}
        doComment={doComment}
        doShare={doShare}
        selectedReactions={selectedReactions}
        minDelay={delayMin}
        maxDelay={delayMax}
      />

      {/* Progress Terminal */}
      <PostProgressTerminal logs={combinedLogs} isRunning={isRunning} />

      {/* Bottom Action Bar */}
      <PostActionBar
        isRunning={isRunning}
        onStart={handleStart}
        onStop={handleStop}
        disabled={targets.length === 0}
      />
    </div>
  );
}
