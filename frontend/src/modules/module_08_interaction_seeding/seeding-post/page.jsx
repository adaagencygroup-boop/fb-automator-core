"use client";

import { seedingApi, SEEDING_TYPE_LABELS } from "@/modules/module_08_interaction_seeding/service";
import { normalizeTargetUrl } from "@/modules/module_08_interaction_seeding/validation";
import { useLocalSSE } from "@/modules/module_02_account_manager/hooks/useLocalSSE.js";
import { toast } from "@/components/ui/toast";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import PostAccountConfig from "./_components/PostAccountConfig";
import PostCommentsManager from "./_components/PostCommentsManager";
import PostPlanPreviewModal from "./_components/PostPlanPreviewModal";
import PostProgressTerminal from "./_components/PostProgressTerminal";
import PostReactionSelector from "./_components/PostReactionSelector";
import PostRunProgress from "./_components/PostRunProgress";
import PostRunSidebar from "./_components/PostRunSidebar";
import PostTargetSection from "./_components/PostTargetSection";
import { planTotals } from "./runPlan.mjs";
import { totalVariants } from "./spintax.mjs";
import AccountSelectModal from "../_components/AccountSelectModal";
import { loadSavedUids, resolveInitialUids, saveSelectedUids } from "../accountSelection.mjs";

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
  const [selectedUids, setSelectedUids] = useState([]);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);

  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [currentCampaignId, setCurrentCampaignId] = useState(null);

  const [liveAccountsCount, setLiveAccountsCount] = useState(0);
  const [totalAccountsCount, setTotalAccountsCount] = useState(0);
  const [liveAccountList, setLiveAccountList] = useState([]); // nick Live + đã đăng nhập (chọn nick lấy bài)
  const [fetchRunning, setFetchRunning] = useState(false); // đang lấy bài từ page (dùng chung Chrome của nick)
  const handleFetchRunningChange = useCallback((running) => setFetchRunning(!!running), []);

  // Tốc độ & thời điểm chạy
  const [threads, setThreads] = useState(2);
  const [startMode, setStartMode] = useState("now");
  const [startAt, setStartAt] = useState("");
  const [spreadEnabled, setSpreadEnabled] = useState(false);
  const [spreadHours, setSpreadHours] = useState(3);

  // Lô đang chạy: id đầu lô (tiến độ / tạm dừng / thử lại), tạm dừng, hẹn giờ
  const [batchId, setBatchId] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(null);
  const [progress, setProgress] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [preview, setPreview] = useState({ open: false, loading: false, plan: null, error: null });

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
            setBatchId(res.batch_id || res.campaign_id);
            setPaused(!!res.paused);
            setScheduledAt(res.scheduled_at || null);
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
    const timer = setInterval(checkActive, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
    }, 4000);

    return () => clearInterval(interval);
  }, [isRunning, currentCampaignId]);

  // Tiến độ cả lô (từng bài × từng loại): hỏi mỗi 3 giây khi đang chạy; chạy xong thì lấy 1 lần cuối để xem / thử lại lỗi
  useEffect(() => {
    if (!batchId) return undefined;
    let cancelled = false;
    const load = () =>
      seedingApi
        .getBatchProgress(batchId)
        .then((res) => {
          if (cancelled || !res) return;
          setProgress(res);
          setPaused(!!res.paused);
          setScheduledAt(res.scheduled_at || null);
        })
        .catch(() => {});
    load();
    if (!isRunning) return () => {
      cancelled = true;
    };
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [batchId, isRunning]);

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

  // Tải lại danh sách bài sẽ seeding (sau khi thêm bài lấy từ page)
  const reloadTargets = useCallback(async () => {
    const res = await seedingApi.getSeedingTargets("POST");
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
    if (isRunning) {
      toast.warning("Không thể xóa bài viết khi đang chạy seeding!");
      return;
    }
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
    if (isRunning) {
      toast.warning("Không thể xóa danh sách bài viết khi đang chạy seeding!");
      return;
    }
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

  // Số lượt mỗi bài (cùng cách chia với backend) + số câu bình luận khác nhau (spintax)
  const totals = useMemo(
    () => planTotals({ accountCount, targetCount: targets.length, doLike, doComment, doShare }),
    [accountCount, targets.length, doLike, doComment, doShare],
  );
  const commentVariants = useMemo(() => totalVariants(comments), [comments]);

  /** Payload chung cho Bắt đầu và Xem trước kế hoạch. */
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
      chrome_threads: threads,
      delay_seconds_min: delayMin,
      delay_seconds_max: delayMax,
      spread_hours: spreadEnabled ? spreadHours : null,
    };
  };

  const handlePreview = async () => {
    setPreview({ open: true, loading: true, plan: null, error: null });
    try {
      const plan = await seedingApi.previewSeedingPlan(buildCampaignPayload());
      setPreview({ open: true, loading: false, plan, error: null });
    } catch (e) {
      setPreview({ open: true, loading: false, plan: null, error: e?.message || "Không tính được kế hoạch." });
    }
  };

  const handlePause = async () => {
    if (!batchId) return;
    setPauseBusy(true);
    try {
      await seedingApi.pauseSeedingCampaign(batchId);
      setPaused(true);
      addLog("Đã tạm dừng — các nick làm xong tác vụ đang dở rồi chờ.", "warn");
    } catch (e) {
      toast.error(e?.message || "Không tạm dừng được.", "LỖI");
    } finally {
      setPauseBusy(false);
    }
  };

  const handleResume = async () => {
    if (!batchId) return;
    setPauseBusy(true);
    try {
      await seedingApi.resumeSeedingCampaign(batchId);
      setPaused(false);
      addLog("Tiếp tục seeding.", "info");
    } catch (e) {
      toast.error(e?.message || "Không tiếp tục được.", "LỖI");
    } finally {
      setPauseBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!batchId || retrying) return;
    setRetrying(true);
    try {
      const res = await seedingApi.retryFailedTasks(batchId);
      addLog(res?.message || "Đã tạo lô thử lại lượt lỗi.", "info");
      setCurrentCampaignId(res.id);
      setBatchId(res.id);
      setProgress(null);
      setPaused(false);
      setIsRunning(true);
      await seedingApi.startSeedingCampaign(res.id);
      toast.success(res?.message || "Đang thử lại các lượt lỗi.", "THỬ LẠI");
    } catch (e) {
      setIsRunning(false);
      toast.error(e?.message || "Không thử lại được.", "LỖI");
    } finally {
      setRetrying(false);
    }
  };

  // Mẫu cấu hình: lưu / áp dụng (không gồm bài viết, tài khoản, câu bình luận)
  const getTemplateConfig = () => ({
    doLike, doComment, doShare, selectedReactions,
    delayMin, delayMax, threads, spreadEnabled, spreadHours,
  });
  const applyTemplate = (cfg = {}) => {
    if (typeof cfg.doLike === "boolean") setDoLike(cfg.doLike);
    if (typeof cfg.doComment === "boolean") setDoComment(cfg.doComment);
    if (typeof cfg.doShare === "boolean") setDoShare(cfg.doShare);
    if (Array.isArray(cfg.selectedReactions)) setSelectedReactions(cfg.selectedReactions);
    if (cfg.delayMin) setDelayMin(cfg.delayMin);
    if (cfg.delayMax) setDelayMax(cfg.delayMax);
    if (cfg.threads) setThreads(cfg.threads);
    if (typeof cfg.spreadEnabled === "boolean") setSpreadEnabled(cfg.spreadEnabled);
    if (cfg.spreadHours) setSpreadHours(cfg.spreadHours);
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

    const scheduled = startMode === "schedule";
    if (scheduled && (!startAt || new Date(startAt).getTime() <= Date.now())) {
      toast.warning("Chọn giờ hẹn chạy ở tương lai.", "CHƯA CHỌN GIỜ HẸN");
      return;
    }

    try {
      setIsRunning(true);
      setProgress(null);
      setPaused(false);
      toast.info("Đang khởi tạo chiến dịch Seeding Bài viết...", "BẮT ĐẦU");
      addLog("Khởi tạo chiến dịch Seeding Bài viết trên máy thật...", "info");

      const campaign = await seedingApi.createSeedingCampaign(buildCampaignPayload());

      setCurrentCampaignId(campaign.id);
      setBatchId(campaign.id);
      const totalPosts = campaign.total_targets || targets.length;
      addLog(
        `Đã khởi tạo ${totalPosts} chiến dịch riêng biệt (${campaign.total_tasks} tác vụ, ${campaign.chrome_threads || threads} luồng Chrome` +
          (spreadEnabled ? `, nghỉ ${campaign.delay_seconds_min}–${campaign.delay_seconds_max}s để rải đều ${spreadHours} giờ` : "") +
          ").",
        "success",
      );

      const res = await seedingApi.startSeedingCampaign(campaign.id, scheduled ? startAt : undefined);
      setScheduledAt(res?.scheduled_at || null);
      toast.success(
        res?.scheduled_at
          ? `${res.message} — ${totalPosts} bài viết.`
          : `Chiến dịch đã được khởi chạy với ${totalPosts} bài viết!`,
        res?.scheduled_at ? "ĐÃ HẸN GIỜ" : "KHỞI CHẠY THÀNH CÔNG",
      );
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
      setPaused(false);
      setScheduledAt(null);
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

      <div className="flex flex-wrap items-start gap-6">
      {/* Cột trái: các bước cấu hình */}
      <div className="flex-[999_1_560px] min-w-0 space-y-6">
      {/* Step 1: Input Targets */}
      <PostTargetSection
        targets={targets}
        onAddTargets={handleAddTargets}
        onRemoveTarget={handleRemoveTarget}
        onClearTargets={handleClearTargets}
        successMessage={successMessage}
        isRunning={isRunning}
        accounts={liveAccountList}
        defaultAccountUid={selectedUids[0] || ""}
        onTargetsReload={reloadTargets}
        onFetchRunningChange={handleFetchRunningChange}
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
        disabled={isRunning}
      />

      {/* Step 3: Comments Pool */}
      {doComment && (
        <PostCommentsManager
          comments={comments}
          onAddComment={handleAddComment}
          onAddBulkComments={handleAddBulkComments}
          onRemoveComment={handleRemoveComment}
          onClearAllComments={handleClearAllComments}
          isRunning={isRunning}
          commentPerPost={totals.comment}
        />
      )}

      {/* Step 4 & 5: Accounts Count & Delay */}
      <PostAccountConfig
        accountCount={accountCount}
        onAccountCountChange={(val) => {
          setAccountCount(val);
        }}
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
        onOpenAccountModal={() => {
          if (isRunning || isStopping) return;
          setIsAccountModalOpen(true);
        }}
        selectedUids={selectedUids}
        isRunning={isRunning || isStopping}
        threads={threads}
        onThreadsChange={setThreads}
        startMode={startMode}
        onStartModeChange={setStartMode}
        startAt={startAt}
        onStartAtChange={setStartAt}
        spreadEnabled={spreadEnabled}
        onSpreadEnabledChange={setSpreadEnabled}
        spreadHours={spreadHours}
        onSpreadHoursChange={setSpreadHours}
      />

      {/* Tiến độ lô: từng bài × từng loại, thử lại lượt lỗi khi chạy xong */}
      {progress && (
        <PostRunProgress progress={progress} isRunning={isRunning} onRetry={handleRetry} retrying={retrying} />
      )}

      {/* Log: chỉ hiện khi đang chạy hoặc đã có log */}
      {(isRunning || combinedLogs.length > 0) && (
        <PostProgressTerminal logs={combinedLogs} isRunning={isRunning} />
      )}
      </div>

      {/* Cột phải: tóm tắt + kiểm tra + Bắt đầu / Dừng (dính khi cuộn) */}
      <aside
        aria-label="Tóm tắt và chạy seeding"
        className="flex-[1_1_320px] min-w-0 lg:sticky lg:top-2 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1"
      >
        <PostRunSidebar
          targets={targets}
          accountCount={accountCount}
          liveAccounts={liveAccountsCount}
          doLike={doLike}
          doComment={doComment}
          doShare={doShare}
          selectedReactions={selectedReactions}
          commentCount={comments.length}
          commentVariants={commentVariants}
          threads={threads}
          spreadEnabled={spreadEnabled}
          spreadHours={spreadHours}
          startMode={startMode}
          startAt={startAt}
          delayMin={delayMin}
          delayMax={delayMax}
          isRunning={isRunning}
          isStopping={isStopping}
          paused={paused}
          scheduledAt={scheduledAt}
          onStart={handleStart}
          onStop={handleStop}
          onPause={handlePause}
          onResume={handleResume}
          pauseBusy={pauseBusy}
          onPreview={handlePreview}
          otherRunning={otherRunning}
          onStopOther={handleStopOther}
          fetchRunning={fetchRunning}
          getTemplateConfig={getTemplateConfig}
          onApplyTemplate={applyTemplate}
        />
      </aside>
      </div>

      <PostPlanPreviewModal
        open={preview.open}
        loading={preview.loading}
        plan={preview.plan}
        error={preview.error}
        onClose={() => setPreview((p) => ({ ...p, open: false }))}
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
        isRunning={isRunning || isStopping}
      />
    </div>
  );
}
