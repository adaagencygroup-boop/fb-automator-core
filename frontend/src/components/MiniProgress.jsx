"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { api } from "@/services/api";

const POST_TYPE_LABELS = { status: "Status", reels: "Reels", story: "Story" };
const isPath = (pathname, path) => pathname === path || pathname === `${path}/`;
const percentOf = (done, total) => Math.min(100, Math.round((done / Math.max(1, total)) * 100));

// Module 11: mỗi loại job có trang giám sát riêng
const PAGE_SCANNER_JOBS = [
  { jobType: "DISCOVERY", label: "Quét thông tin page", path: "/scanner/search" },
  { jobType: "DETAIL", label: "Quét chi tiết page", path: "/scanner/search" },
  { jobType: "FOLLOW", label: "Quét followers", path: "/scanner/followers" },
  { jobType: "POST_SCAN", label: "Quét bài viết", path: "/scanner/posts" },
];

/**
 * Mỗi nguồn: hỏi phiên đang chạy → { key, title, paused, done, total, percent, activity, path, hidden(pathname, searchParams), onOpen? }
 * interval: nhịp hỏi (ms). Trả null khi không có phiên.
 */
const SOURCES = [
  {
    id: "post",
    interval: 2000,
    async fetch() {
      const res = await api.get("/api/post/status");
      const d = res?.data ?? res;
      if (!(d && d.session_id && (d.is_running || d.is_paused) && !d.session_finished && !d.is_stopped)) return [];
      const m = d.metrics || {};
      const total = (d.session_accounts && d.session_accounts.length) ||
        (m.running + m.waiting + m.completed + m.systemError + m.deadAccount) || 1;
      const done = (m.completed || 0) + (m.systemError || 0) + (m.deadAccount || 0);
      const postType = d.post_type || "status";
      return [{
        key: `post:${d.session_id}`,
        title: `${d.is_paused ? "Tạm dừng" : "Đang đăng"} ${POST_TYPE_LABELS[postType] || postType}`,
        paused: Boolean(d.is_paused),
        done,
        total,
        percent: percentOf(done, total),
        activity: d.threads?.[0]?.currentActivity || "Đang xử lý đăng bài...",
        path: `/interact/post?tab=${postType}`,
        // Đang đứng ở chính màn hình giám sát của phiên này
        hidden(pathname, searchParams) {
          if (!isPath(pathname, "/interact/post")) return false;
          const currentId = searchParams?.get("id") || searchParams?.get("session_id");
          if (currentId) return currentId === d.session_id;
          const savedTab = typeof window !== "undefined" ? localStorage.getItem("module_03_post_mode") : null;
          return (searchParams?.get("tab") || savedTab || "status") === postType;
        },
        onOpen() {
          if (typeof window !== "undefined") localStorage.setItem("module_03_post_mode", postType);
        },
      }];
    },
  },
  {
    id: "page-scanner",
    interval: 4000,
    async fetch() {
      const results = await Promise.all(
        PAGE_SCANNER_JOBS.map((job) =>
          api.get("/api/page-scanner/campaigns/active", { params: { job_type: job.jobType } }).then((data) => ({ job, data }))
        )
      );
      return results
        .filter(({ data }) => data?.active)
        .map(({ job, data }) => {
          const sessions = data.sessions || [];
          const total = sessions.reduce((n, s) => n + (Number(s.max_results) || 0), 0);
          const done = Math.min(total, sessions.reduce((n, s) => n + (Number(s.total_unique) || 0), 0));
          const paused = data.status === "PAUSED";
          const running = sessions.filter((s) => s.status === "RUNNING" || s.status === "PAUSED").length;
          return {
            key: `page-scanner:${job.jobType}:${data.primary_session_id}`,
            title: `${paused ? "Tạm dừng" : "Đang"} ${job.label.charAt(0).toLowerCase()}${job.label.slice(1)}`,
            paused,
            done,
            total,
            percent: percentOf(done, total),
            activity: sessions.length > 1 ? `${running}/${sessions.length} phiên đang chạy` : "Đang quét...",
            path: job.path,
            hidden: (pathname) => isPath(pathname, job.path),
          };
        });
    },
  },
  {
    id: "profile-scan",
    interval: 4000,
    async fetch() {
      const res = await api.get("/api/profile-scan/sessions/latest");
      const s = res?.session;
      if (!s || (s.status !== "RUNNING" && s.status !== "PAUSED")) return [];
      const done = (s.done || 0) + (s.skipped || 0) + (s.failed || 0);
      const paused = s.status === "PAUSED";
      return [{
        key: `profile-scan:${s.id}`,
        title: `${paused ? "Tạm dừng" : "Đang"} quét profile`,
        paused,
        done,
        total: s.total || 0,
        percent: percentOf(done, s.total || 0),
        activity: `Đã quét ${s.done || 0} · lỗi ${s.failed || 0} · còn ${s.pending || 0}`,
        path: "/profile-scan/info",
        hidden: (pathname) => isPath(pathname, "/profile-scan/info"),
      }];
    },
  },
];

/** Hỏi định kỳ 1 nguồn; tài khoản chưa có quyền module (401/403) thì thôi không hỏi nữa. */
function useSourceSessions(source) {
  const [items, setItems] = useState([]);
  const blocked = useRef(false);

  useEffect(() => {
    let ignore = false;
    let timer;
    const tick = async () => {
      try {
        const next = await source.fetch();
        if (!ignore) setItems(next);
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) {
          blocked.current = true;
          if (!ignore) setItems([]);
        }
        // Lỗi khác (mạng chập chờn): giữ trạng thái cũ, lần sau hỏi lại
      }
      if (!ignore && !blocked.current) timer = setTimeout(tick, source.interval);
    };
    tick();
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [source]);

  return items;
}

function ProgressCard({ session, onOpen }) {
  return (
    <div
      onClick={onOpen}
      className="w-72 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-3.5 shadow-xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] active:scale-[0.99] cursor-pointer group animate-in fade-in slide-in-from-bottom-4"
    >
      {/* Header dòng 1: Icon + Tên + % */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                session.paused ? "bg-amber-400" : "bg-blue-500"
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                session.paused ? "bg-amber-500" : "bg-blue-600"
              }`}
            />
          </span>
          <span className="text-xs font-bold text-slate-800 truncate">{session.title}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-mono font-bold text-blue-600">
            {session.done}/{session.total}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">({session.percent}%)</span>
        </div>
      </div>

      {/* Progress Bar shadcn */}
      <div className="mb-2">
        <Progress value={session.percent} className="h-1.5" />
      </div>

      {/* Footer dòng 3: Tóm tắt hoạt động & nút xem chi tiết */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
        <span className="truncate pr-2 font-medium group-hover:text-slate-700 transition-colors">
          {session.activity}
        </span>
        <span className="flex items-center font-bold text-blue-600 group-hover:underline shrink-0">
          Xem chi tiết
          <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  );
}

function MiniProgressContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const post = useSourceSessions(SOURCES[0]);
  const pageScanner = useSourceSessions(SOURCES[1]);
  const profileScan = useSourceSessions(SOURCES[2]);

  // Ẩn thẻ của phiên mà người dùng đang đứng ở chính màn hình giám sát
  const visible = [...post, ...pageScanner, ...profileScan].filter((s) => !s.hidden?.(pathname, searchParams));
  if (!visible.length) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {visible.map((session) => (
        <ProgressCard
          key={session.key}
          session={session}
          onOpen={() => {
            session.onOpen?.();
            router.push(session.path);
          }}
        />
      ))}
    </div>
  );
}

export function MiniProgress() {
  return (
    <Suspense fallback={null}>
      <MiniProgressContent />
    </Suspense>
  );
}
