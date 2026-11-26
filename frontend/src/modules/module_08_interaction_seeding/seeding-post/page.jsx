"use client";

import { seedingApi, SEEDING_TYPE_LABELS } from "@/modules/module_08_interaction_seeding/service";
import { normalizeTargetUrl } from "@/modules/module_08_interaction_seeding/validation";
import { useLocalSSE } from "@/modules/module_02_account_manager/hooks/useLocalSSE.js";
import { toast } from "@/components/ui/toast";
import { Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PostAccountConfig from "./_components/PostAccountConfig";
import PostActionBar from "./_components/PostActionBar";
import PostCommentsManager from "./_components/PostCommentsManager";
import PostProgressTerminal from "./_components/PostProgressTerminal";
import PostReactionSelector from "./_components/PostReactionSelector";
import PostSummaryCards from "./_components/PostSummaryCards";
import PostTargetSection from "./_components/PostTargetSection";
import { DISTRIBUTION_ALL, planTotals } from "./runPlan.mjs";
import AccountSelectModal from "../_components/AccountSelectModal";
import { loadSavedUids, resolveInitialUids, saveSelectedUids } from "../accountSelection.mjs";

export default function SeedingPostPage() {
  const [targets, setTargets] = useState([]);
  const targetMutationVersion = useRef(0);
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
  const [selectedUids, setSelectedUids] = useState([]);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  // Dùng lại cách phân bổ cũ: các tài khoản được chọn cùng tham gia trên từng bài.
  const distributionMode = DISTRIBUTION_ALL;

  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [currentCampaignId, setCurrentCampaignId] = useState(null);

  const [liveAccountsCount, setLiveAccountsCount] = useState(0);
  const [liveAccountList, setLiveAccountList] = useState([]); // nick Live + đã đăng nhập (chọn nick lấy bài)
  const [fetchRunning, setFetchRunning] = useState(false); // đang lấy bài từ page (dùng chung Chrome của nick)
  const handleFetchRunningChange = useCallback((running) => setFetchRunning(!!running), []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    seedingApi
      .getAccounts()
      .then((accs) => {
        if (Array.isArray(accs)) {
          // Tài khoản khả dụng: BẮT BUỘC có trạng thái live và đã đăng nhập (logged_in)
          const validLiveLoggedIn = accs.filter(
            (a) =>
              a.status?.toLowerCase() === "live" &&
              a.login_status?.toLowerCase() === "logged_in",
          );
          const validCount = validLiveLoggedIn.length;
          setLiveAccountsCount(validCount);
          setLiveAccountList(validLiveLoggedIn);
          // Giữ đúng tài khoản đã chọn lần trước (bỏ tài khoản không còn khả dụng)
          const { uids: initialUids, restored, dropped } = resolveInitialUids(
            validLiveLoggedIn.map((a) => a.uid),
            loadSavedUids("POST"),
          );
          setSelectedUids(initialUids);
          setAccountCount(initialUids.length);
          if (restored && dropped > 0) {
            if (initialUids.length === 0) {
              toast.warning(
                "Các tài khoản đã chọn lần trước không còn khả dụng (Die / đăng xuất / đã xóa). Vui lòng chọn lại tài khoản.",
                "CHƯA CHỌN TÀI KHOẢN",
              );
            } else {
              addLog(`${dropped} tài khoản đã chọn lần trước không còn khả dụng — đã bỏ chọn.`, "warn");
            }
          }
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

  // Lô seeding đang chạy trên máy (mọi loại trang), kiểm tra khi mở trang và mỗi 3 giây. Mỗi lúc chỉ chạy 1 lô:
  // - Lô của trang này: khôi phục trạng thái đang chạy (ẩn nút Bắt đầu, hiện nút Dừng) khi chuyển trang rồi quay lại.
  // - Lô của trang khác (otherRunning): khoá nút Bắt đầu, nút Dừng dừng lô đó.
  const [otherRunning, setOtherRunning] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const checkActive = () =>
      seedingApi
        .getActiveSeedingCampaign()
        .then((res) => {
          if (cancelled) return;
          if (res?.campaign_id && res.campaign_type === "POST") {
            setOtherRunning(null);
            setCurrentCampaignId(res.campaign_id);
            setIsRunning(true);
          } else if (res?.campaign_id) {
            const typeLabel = SEEDING_TYPE_LABELS[res.campaign_type] || res.campaign_type;
            setOtherRunning({ id: res.campaign_id, label: `${typeLabel} #${res.campaign_id}` });
          } else {
            setOtherRunning(null);
          }
        })
        .catch(() => {});
    checkActive();
    const timer = setInterval(checkActive, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Poll campaign status while running
  useEffect(() => {
    if (!isRunning || !currentCampaignId) return;
    let cancelled = false;
    let inFlight = false;
    let lastSuccessCount = -1;
    const pollStatus = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const progress = await seedingApi.getBatchProgress(currentCampaignId);
        if (!cancelled && progress) {
          const status = progress.posts?.find((post) => post.campaign_id === currentCampaignId)?.status || progress.posts?.[0]?.status;
          const isBatchActive = progress.running;
          const successCount = Number(progress.totals?.success || 0);
          const successChanged = successCount !== lastSuccessCount;
          if (successChanged) {
            lastSuccessCount = successCount;
            const requestVersion = targetMutationVersion.current;
            const targets = await seedingApi.getSeedingTargets("POST");
            if (!cancelled && requestVersion === targetMutationVersion.current) {
              setTargets(targets?.targets || []);
            }
          }
          if (
            !isBatchActive &&
            (status === "COMPLETED" ||
              status === "FAILED" ||
              status === "STOPPED")
          ) {
            setIsRunning(false);
            addLog(
              `Chiến dịch hoàn tất với trạng thái: ${status}.`,
              status === "COMPLETED" ? "success" : "warn",
            );
            if (!successChanged) {
              const requestVersion = targetMutationVersion.current;
              seedingApi
                .getSeedingTargets("POST")
                .then((res) => {
                  if (requestVersion === targetMutationVersion.current) {
                    setTargets(res?.targets || []);
                  }
                })
                .catch(() => {});
            }
          }
        }
      } catch (err) {
        // Ignore polling error
      } finally {
        inFlight = false;
      }
    };
    pollStatus();
    const interval = setInterval(pollStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isRunning, currentCampaignId]);

  // Load saved targets and comments from database on mount
  useEffect(() => {
    const requestVersion = targetMutationVersion.current;
    seedingApi
      .getSeedingTargets("POST")
      .then((res) => {
        if (requestVersion !== targetMutationVersion.current) return;
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

  // Tải lại danh sách bài sẽ seeding (sau khi thêm bài lấy từ page)
  const reloadTargets = useCallback(async () => {
    const requestVersion = ++targetMutationVersion.current;
    const res = await seedingApi.getSeedingTargets("POST");
    if (requestVersion !== targetMutationVersion.current) return;
    setTargets(res?.targets || []);
    setSuccessMessage(res?.targets?.length ? `Danh sách có ${res.targets.length} bài viết` : null);
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
        targetMutationVersion.current += 1;
        const saved = await seedingApi.getSeedingTargets("POST", false, true).catch(() => null);
        const currentTargets = saved?.targets || res.targets;
        setTargets(currentTargets);
        setSuccessMessage(
          `Đã lưu thành công ${currentTargets.length} bài viết vào cơ sở dữ liệu`,
        );
        return currentTargets;
      }
    } catch (e) {
      addLog(`Lỗi lưu link bài viết: ${e.message}`, "error");
      throw e;
    }
  };

  const handleRemoveTarget = async (index) => {
    if (isRunning) {
      toast.warning("Không thể xóa bài viết khi đang chạy seeding!");
      return;
    }
    const targetToRemove = targets[index];
    if (targetToRemove) {
      try {
        await seedingApi.deleteSeedingTarget(targetToRemove.url, "POST");
        targetMutationVersion.current += 1;
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
    if (isRunning) {
      toast.warning("Không thể xóa danh sách bài viết khi đang chạy seeding!");
      return;
    }
    try {
      const res = await seedingApi.clearSeedingTargets("POST");
      if (!res?.success) throw new Error("Máy chủ chưa xác nhận xóa danh sách bài viết.");
    } catch (err) {
      addLog(`Lỗi xóa danh sách bài viết: ${err.message}`, "error");
      throw err;
    }
    targetMutationVersion.current += 1;
    setTargets([]);
    setSuccessMessage(null);
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
    if (isRunning) {
      toast.warning("Không thể xóa bình luận khi đang chạy seeding!");
      return;
    }
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
    if (isRunning) {
      toast.warning("Không thể xóa danh sách bình luận khi đang chạy seeding!");
      return;
    }
    try {
      await seedingApi.clearSeedingComments();
    } catch (e) {
      throw e;
    }
    setComments([]);
  };

  // Số lượt mỗi bài (cùng cách chia với backend) — dùng cho kho bình luận
  const totals = useMemo(
    () => planTotals({ accountCount, targetCount: targets.length, doLike, doComment, doShare, mode: distributionMode }),
    [accountCount, targets.length, doLike, doComment, doShare, distributionMode],
  );

  /** Payload tạo chiến dịch Seeding Bài viết. */
  const buildCampaignPayload = () => {
    const actions = [];
    if (doLike) actions.push("REACT");
    if (doComment) actions.push("COMMENT");
    if (doShare) actions.push("SHARE");
    return {
      name: `Seeding Post - ${new Date().toLocaleTimeString("vi-VN")}`,
      campaign_type: "POST",
      actions,
      reactions: doLike ? selectedReactions : [],
      comments: doComment ? comments : [],
      // Backend tự lấy các bài đang chờ trong danh sách (có thể hàng nghìn bài lấy từ page) — không gửi cả danh sách
      use_saved_targets: true,
      uids: selectedUids.length > 0 ? selectedUids : undefined,
      account_count: selectedUids.length > 0 ? selectedUids.length : accountCount,
      threads: 1,
      delay_seconds_min: delayMin,
      delay_seconds_max: delayMax,
      distribution_mode: distributionMode,
    };
  };

  const handleStart = async () => {
    if (otherRunning) {
      toast.warning(
        `Đang chạy seeding ${otherRunning.label}. Hãy dừng lô đó trước khi bắt đầu seeding mới.`,
        "ĐANG CÓ SEEDING CHẠY",
      );
      return;
    }

    if (fetchRunning) {
      toast.warning(
        "Đang lấy bài viết từ page. Dừng lấy bài trước khi chạy seeding (dùng chung Chrome của nick).",
        "ĐANG LẤY BÀI",
      );
      return;
    }

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

    if (selectedUids.length === 0 && accountCount <= 0) {
      toast.warning(
        "Vui lòng chọn ít nhất 1 tài khoản để chạy seeding!",
        "CHƯA CHỌN TÀI KHOẢN"
      );
      return;
    }

    if (!delayMin || !delayMax || Number(delayMax) <= Number(delayMin)) {
      toast.warning(
        `Thời gian tối đa (${delayMax || 0}s) phải lớn hơn thời gian tối thiểu (${delayMin || 0}s)!`,
        "CẤU HÌNH THỜI GIAN KHÔNG HỢP LỆ"
      );
      return;
    }

    if (Number(delayMax) > 3600) {
      toast.warning(
        "Thời gian tối đa chỉ được nhập tối đa đến 3600 giây!",
        "CẤU HÌNH THỜI GIAN KHÔNG HỢP LỆ"
      );
      return;
    }

    try {
      setIsRunning(true);
      toast.info("Đang khởi tạo chiến dịch Seeding Bài viết...", "BẮT ĐẦU");
      addLog("Khởi tạo chiến dịch Seeding Bài viết trên máy thật...", "info");

      const campaign = await seedingApi.createSeedingCampaign(buildCampaignPayload());

      setCurrentCampaignId(campaign.id);
      const totalPosts = campaign.total_targets || targets.length;
      addLog(campaign.message || `Đã khởi tạo ${totalPosts} chiến dịch riêng biệt (${campaign.total_tasks} tác vụ).`, "info");

      await seedingApi.startSeedingCampaign(campaign.id);
      toast.info(`Chiến dịch đang chạy với ${totalPosts} bài viết.`, "ĐANG CHẠY");
    } catch (e) {
      setIsRunning(false);
      addLog(`Lỗi khởi chạy seeding: ${e.message}`, "error");
      toast.error(e.message || "Không thể khởi chạy chiến dịch seeding!", "LỖI KHỞI CHẠY");
    }
  };

  const handleStopOther = async (other) => {
    try {
      await seedingApi.stopSeedingCampaign(other.id);
      setOtherRunning(null);
      addLog(`Đã dừng seeding ${other.label} (đang chạy ở trang khác).`, "warn");
      toast.warning(`Đã dừng seeding ${other.label}.`, "ĐÃ DỪNG");
    } catch (e) {
      toast.error(e.message || "Lỗi khi gửi yêu cầu dừng chiến dịch!", "LỖI");
    }
  };

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
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
      setIsStopping(false);
      setIsRunning(false);
    }
  };

  const accountStep = doComment ? 4 : 3;
  const locked = isRunning || isStopping;

  return (
    <div className="w-full space-y-6 animate-fadeIn">
      {/* Tiêu đề trang */}
      <div className="flex items-center gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
          <Send className="size-6 stroke-[2.2]" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Seeding Bài viết</h1>
          <p className="mt-1 text-xs text-gray-500">Tăng Like, cảm xúc, bình luận và chia sẻ cho nhiều bài viết trên Facebook.</p>
        </div>
      </div>

      {/* Bước 1: Thêm bài viết */}
      <PostTargetSection
        targets={targets}
        onAddTargets={handleAddTargets}
        onRemoveTarget={handleRemoveTarget}
        onClearTargets={handleClearTargets}
        successMessage={successMessage}
        isRunning={isRunning}
        accounts={liveAccountList}
        selectedUids={selectedUids}
        onTargetsReload={reloadTargets}
        onFetchRunningChange={handleFetchRunningChange}
      />

      {/* Bước 2: Loại tương tác & cảm xúc */}
      <PostReactionSelector
        doLike={doLike}
        onDoLikeChange={handleDoLikeChange}
        doComment={doComment}
        onDoCommentChange={setDoComment}
        doShare={doShare}
        onDoShareChange={setDoShare}
        selectedReactions={selectedReactions}
        onToggleReaction={handleToggleReaction}
        disabled={isRunning}
      />

      {/* Bước 3: Kho bình luận (chỉ khi có Bình luận) */}
      {doComment && (
        <PostCommentsManager
          step={3}
          comments={comments}
          onAddBulkComments={handleAddBulkComments}
          onRemoveComment={handleRemoveComment}
          onClearAllComments={handleClearAllComments}
          isRunning={isRunning}
          commentPerPost={totals.comment}
        />
      )}

      {/* Tài khoản & Thời gian */}
      <PostAccountConfig
        accountStep={accountStep}
        timeStep={accountStep + 1}
        accountCount={accountCount}
        availableAccounts={liveAccountsCount}
        selectedUids={selectedUids}
        selectedReactionsCount={selectedReactions.length}
        doLike={doLike}
        doComment={doComment}
        doShare={doShare}
        minDelay={delayMin}
        maxDelay={delayMax}
        onMinDelayChange={setDelayMin}
        onMaxDelayChange={setDelayMax}
        onOpenAccountModal={() => {
          if (locked) return;
          setIsAccountModalOpen(true);
        }}
        isRunning={locked}
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

      {/* Live Terminal */}
      <PostProgressTerminal logs={combinedLogs} isRunning={isRunning} />

      {/* Bottom Action Bar */}
      <PostActionBar
        isRunning={isRunning}
        isStopping={isStopping}
        onStart={handleStart}
        onStop={handleStop}
        disabled={
          targets.length === 0 ||
          !delayMin ||
          !delayMax ||
          Number(delayMax) <= Number(delayMin) ||
          Number(delayMax) > 3600
        }
        otherRunning={otherRunning}
        onStopOther={handleStopOther}
      />

      {/* Popup chọn tài khoản */}
      <AccountSelectModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        selectedUids={selectedUids}
        onConfirm={(uids) => {
          setSelectedUids(uids);
          setAccountCount(uids.length);
          saveSelectedUids("POST", uids);
        }}
        isRunning={locked}
      />
    </div>
  );
}
