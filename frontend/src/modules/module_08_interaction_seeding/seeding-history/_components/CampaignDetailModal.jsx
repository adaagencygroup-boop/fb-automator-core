"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Globe,
  User,
  Layers,
  Loader2,
  ThumbsUp,
  MessageCircle,
  Share2,
} from "lucide-react";
import { seedingApi } from "@/modules/module_08_interaction_seeding/service";

const emptySubscribe = () => () => {};
const useIsMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

export default function CampaignDetailModal({
  isOpen,
  onClose,
  campaign,
}) {
  const [detailData, setDetailData] = useState(null);
  const [copied, setCopied] = useState(false);
  const mounted = useIsMounted();

  // Lock body scroll and handle ESC key
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e) => {
        if (e.key === "Escape" && onClose) {
          onClose();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleKeyDown);
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !campaign?.id) return;

    let isCancelled = false;
    seedingApi
      .getSeedingCampaignDetail(campaign.id)
      .then((res) => {
        if (!isCancelled && res) {
          setDetailData(res);
        }
      })
      .catch((err) => {
        console.error("Lỗi khi tải chi tiết chiến dịch:", err);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, campaign?.id]);

  if (!isOpen || !campaign) return null;

  const data = (detailData && detailData.id === campaign.id) ? detailData : campaign;
  const isProfile = (data.campaign_type || "").toUpperCase() === "PROFILE";
  const isPage = (data.campaign_type || "").toUpperCase() === "PAGE";
  const isPost = (data.campaign_type || "").toUpperCase() === "POST";
  const targetTypeLabel = isProfile
    ? "Trang cá nhân"
    : isPage
    ? "Page"
    : isPost
    ? "Bài viết"
    : "Mục tiêu";

  const pageUrl =
    data.primary_target_url ||
    (data.targets && data.targets.length > 0 ? data.targets[0].url : "") ||
    (data.tasks && data.tasks.length > 0 ? data.tasks[0].target_url : "") ||
    "";
  const pageName =
    data.primary_target_name ||
    (data.targets && data.targets.length > 0
      ? data.targets[0].display_name
      : "") ||
    (data.tasks && data.tasks.length > 0
      ? data.tasks[0].display_name
      : "") ||
    data.target_summary ||
    data.name;

  const handleCopy = () => {
    if (!pageUrl) return;
    navigator.clipboard.writeText(pageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tasks = data.tasks || [];
  const failedTasks = tasks.filter((t) => t.status === "FAILED");

  // Thống kê 3 mục tương tác bài viết (Like, Bình luận, Chia sẻ)
  const breakdown = data.interactions_breakdown;
  const actionsList = Array.isArray(data.actions)
    ? data.actions.map((a) => String(a).toUpperCase().trim())
    : typeof data.actions === "string"
    ? data.actions.split(",").map((a) => a.toUpperCase().trim())
    : [];

  const reactTasks = tasks.filter((t) => t.action?.toUpperCase() === "REACT");
  const commentTasks = tasks.filter((t) => t.action?.toUpperCase() === "COMMENT");
  const shareTasks = tasks.filter((t) => t.action?.toUpperCase() === "SHARE");

  // Kiểm tra Like / Cảm xúc
  const hasLike =
    actionsList.includes("REACT") ||
    actionsList.includes("LIKE") ||
    reactTasks.length > 0 ||
    Boolean(breakdown?.react?.enabled) ||
    Boolean(
      breakdown &&
        typeof breakdown === "object" &&
        Object.keys(breakdown).some((k) =>
          ["LIKE", "LOVE", "CARE", "HAHA", "WOW", "SAD", "ANGRY"].includes(
            k.toUpperCase()
          )
        )
    );

  // Kiểm tra Bình luận
  const hasComment =
    actionsList.includes("COMMENT") ||
    commentTasks.length > 0 ||
    Boolean(breakdown?.comment?.enabled) ||
    Boolean(breakdown && (breakdown["COMMENT"] > 0 || breakdown?.comment));

  // Kiểm tra Chia sẻ
  const hasShare =
    actionsList.includes("SHARE") ||
    shareTasks.length > 0 ||
    Boolean(breakdown?.share?.enabled) ||
    Boolean(breakdown && (breakdown["SHARE"] > 0 || breakdown?.share));

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-sm overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden text-gray-800 my-auto relative animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-[11px] font-bold uppercase tracking-wider">
                {data.campaign_type_display || (isProfile ? "Trang cá nhân" : isPage ? "Page" : data.campaign_type)}
              </span>
              <h2 className="text-base font-bold truncate max-w-md">{pageName}</h2>
            </div>
            <p className="text-xs text-blue-100 mt-1">
              Mã chiến dịch: #{data.id} • Khởi tạo: {data.created_at_display || data.created_at}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {false ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span>Đang tải thông tin chi tiết từ hệ thống...</span>
            </div>
          ) : (
            <>
              {/* Quick Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div
                  className={`p-3.5 rounded-xl border space-y-1 ${
                    data.status === "COMPLETED"
                      ? "bg-emerald-50/60 border-emerald-100 text-emerald-900"
                      : data.status === "FAILED" ||
                        data.status === "STOPPED" ||
                        (data.status_display || "").toLowerCase().includes("không hoàn thành")
                      ? "bg-rose-50/60 border-rose-100 text-rose-900"
                      : data.status === "RUNNING"
                      ? "bg-blue-50/60 border-blue-100 text-blue-900"
                      : "bg-gray-50 border-gray-100 text-gray-800"
                  }`}
                >
                  <span
                    className={`font-medium ${
                      data.status === "COMPLETED"
                        ? "text-emerald-600"
                        : data.status === "FAILED" ||
                          data.status === "STOPPED" ||
                          (data.status_display || "").toLowerCase().includes("không hoàn thành")
                        ? "text-rose-600"
                        : data.status === "RUNNING"
                        ? "text-blue-600"
                        : "text-gray-400"
                    }`}
                  >
                    Trạng thái
                  </span>
                  <p className="text-sm font-bold">
                    {data.status_display || data.status}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-100 space-y-1">
                  <span className="text-blue-600 font-medium">Số tài khoản chạy</span>
                  <p className="text-sm font-bold text-blue-900">{data.account_count} tài khoản</p>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100 space-y-1">
                  <span className="text-emerald-600 font-medium">Thành công</span>
                  <p className="text-sm font-bold text-emerald-800">{data.total_success} lượt</p>
                </div>

                <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-100 space-y-1">
                  <span className="text-rose-600 font-medium">Thất bại</span>
                  <p className="text-sm font-bold text-rose-800">{data.total_failed} lượt</p>
                </div>
              </div>

              {/* SECTION: ĐƯỜNG DẪN LINK MỤC TIÊU (HIỂN THỊ NỔI BẬT) */}
              <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
                    <Globe className="w-4 h-4 text-blue-600" />
                    Đường dẫn Link {targetTypeLabel} seeding:
                  </span>
                  {pageUrl && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-600 text-[11px] font-semibold transition-all shadow-sm"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? "Đã chép" : "Sao chép link"}
                      </button>

                      <a
                        href={pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold transition-all shadow-sm shadow-blue-500/20"
                      >
                        <span>Mở trên Facebook</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>

                {pageUrl ? (
                  <div className="p-2.5 bg-white border border-blue-200/60 rounded-lg break-all font-mono text-gray-700 text-xs flex items-center justify-between">
                    <span>{pageUrl}</span>
                  </div>
                ) : (
                  <p className="text-gray-400 italic">Chưa xác định link mục tiêu</p>
                )}
              </div>

              {/* SECTION: 3 LOẠI TƯƠNG TÁC BÀI VIẾT (LIKE BÀI VIẾT, BÌNH LUẬN, CHIA SẺ) */}
              {isPost && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-600" />
                      <span>Loại tương tác & Cảm xúc bài viết</span>
                    </h3>
                    <span className="text-[11px] text-gray-500">
                      Chi tiết 3 loại tương tác theo cấu hình chiến dịch
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                    {/* Mục 1: Like bài viết */}
                    <div
                      className={`relative flex items-center gap-3.5 p-4 rounded-xl border transition-all ${
                        hasLike
                          ? "border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10"
                          : "border-gray-200 bg-gray-50/40 opacity-70"
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 ${
                          hasLike ? "bg-blue-600 shadow-sm" : "bg-gray-400"
                        }`}
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-900">Like bài viết</h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              hasLike ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
                            }`}
                          >
                            {hasLike ? "Đã chọn" : "Không chọn"}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">Tương tác bài viết này</p>
                      </div>
                    </div>

                    {/* Mục 2: Bình luận */}
                    <div
                      className={`relative flex items-center gap-3.5 p-4 rounded-xl border transition-all ${
                        hasComment
                          ? "border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10"
                          : "border-gray-200 bg-gray-50/40 opacity-70"
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 ${
                          hasComment ? "bg-blue-600 shadow-sm" : "bg-gray-400"
                        }`}
                      >
                        <MessageCircle className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-900">Bình luận</h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              hasComment ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
                            }`}
                          >
                            {hasComment ? "Đã chọn" : "Không chọn"}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">Tự động bình luận bài viết</p>
                      </div>
                    </div>

                    {/* Mục 3: Chia sẻ */}
                    <div
                      className={`relative flex items-center gap-3.5 p-4 rounded-xl border transition-all ${
                        hasShare
                          ? "border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10"
                          : "border-gray-200 bg-gray-50/40 opacity-70"
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 ${
                          hasShare ? "bg-blue-600 shadow-sm" : "bg-gray-400"
                        }`}
                      >
                        <Share2 className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-900">Chia sẻ</h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              hasShare ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
                            }`}
                          >
                            {hasShare ? "Đã chọn" : "Không chọn"}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">Chia sẻ về trang cá nhân</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION: DANH SÁCH LƯU Ý & THÔNG BÁO LỖI (NẾU CÓ) */}
              {failedTasks.length > 0 && (
                <div className="p-4 rounded-xl border border-rose-200/80 bg-rose-50/50 space-y-2.5">
                  <div className="flex items-center gap-2 text-rose-900 font-bold text-xs">
                    <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      Danh sách lỗi & không thành công ({failedTasks.length} tài khoản):
                    </span>
                  </div>

                  <div className="space-y-1.5 pl-1 text-xs">
                    {failedTasks.map((t, idx) => (
                      <div
                        key={`failed-${t.id || t.task_id || t.account_uid || idx}`}
                        className="flex items-start gap-2 px-3 py-1.5 rounded-lg border border-rose-200/70 bg-white/90 text-rose-900"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>{t.account_name || t.account_uid}:</strong>{" "}
                          <span>{t.error_message || "Không thể hoàn thành tác vụ"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION: CHI TIẾT TỪNG TÀI KHOẢN & LỖI / GHI CHÚ */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-600" />
                    <span>Chi tiết từng tài khoản Facebook thực thi ({tasks.length})</span>
                  </h3>
                  <span className="text-[11px] text-gray-500">
                    Theo dõi trạng thái và thông báo riêng của từng nick
                  </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold uppercase text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">STT</th>
                        <th className="py-2.5 px-3">Tài khoản Facebook</th>
                        <th className="py-2.5 px-3 text-center w-28">Hành động</th>
                        <th className="py-2.5 px-3 text-center w-28">Trạng thái</th>
                        <th className="py-2.5 px-3">Kết quả / Thông báo lỗi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tasks.length > 0 ? (
                        tasks.map((t, idx) => {
                          const isSuccess = t.status === "SUCCESS";
                          const isFailed = t.status === "FAILED";

                          return (
                            <tr key={t.id || t.task_id || idx} className="hover:bg-gray-50/80 transition-colors">
                              <td className="py-2.5 px-3 text-center text-gray-400 font-medium">
                                {idx + 1}
                              </td>

                              <td className="py-2.5 px-3">
                                <div className="font-bold text-gray-800">
                                  {t.account_name || t.account_uid}
                                </div>
                                <div className="text-[10px] text-gray-400 font-mono">
                                  UID: {t.account_uid}
                                </div>
                              </td>

                              <td className="py-2.5 px-3 text-center">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold text-[11px] border border-blue-200/60">
                                  {t.action_display || t.action}
                                </span>
                              </td>

                              <td className="py-2.5 px-3 text-center">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                    isSuccess
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                      : isFailed
                                      ? "bg-rose-50 text-rose-700 border border-rose-200/60"
                                      : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {t.status_display || t.status}
                                </span>
                              </td>

                              <td className="py-2.5 px-3">
                                {t.error_message ? (
                                  isFailed ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200/70 font-medium text-[11px]">
                                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                      {t.error_message}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/70 font-medium text-[11px]">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                      {t.error_message}
                                    </span>
                                  )
                                ) : isSuccess ? (
                                  <span className="text-emerald-700 font-medium">✓ Đã hoàn thành</span>
                                ) : (
                                  <span className="text-gray-400 italic">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-gray-400 italic">
                            Chưa có dữ liệu tác vụ chi tiết
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl font-semibold transition-colors text-xs"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
