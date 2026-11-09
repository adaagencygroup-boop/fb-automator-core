"use client";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Settings, FolderOpen, Search, Trash2, HelpCircle, Play, Square, Terminal, Video, Flag, AlertTriangle, AlertCircle, Edit3, ExternalLink, Maximize2, Lock, CheckCircle2, Loader2 } from "lucide-react";
import { startYouTubeDownloadJob, getJobStatus, stopJob, selectFolder, clearPageVideos, clearAllVideos, updatePageKeywords, getYoutubeConfig, saveYoutubeConfig, checkFolderData, setSharedVideoFolder, getSharedVideoFolder } from "../service";
import Pagination from "@/components/ui/pagination";
import PageVideosModal from "./PageVideosModal";
import EditSourceModal from "./EditSourceModal";
function PageLogo({ avatar, name }) {
  const [hasError, setHasError] = useState(false);
  if (!avatar || hasError) {
    return (
      <div className="w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center justify-center shrink-0">
        <Flag className="w-3 h-3 fill-current" />
      </div>
    );
  }
  return (
    <img src={avatar} alt={name || "Fanpage"} onError={() => setHasError(true)} className="w-6 h-6 rounded-full object-cover shrink-0 border border-border group-hover:ring-1 group-hover:ring-primary" />
  );
}
function toTitleCase(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/(^|[\s(\[{"'“”‘«])(\p{L})/gu, (_, prefix, char) => prefix + char.toUpperCase())
    .replace(/\bTiktok\b/gi, "TikTok")
    .replace(/\bYoutube\b/gi, "YouTube");
}
let globalYouTubeInitDone = false;
export default function YouTubeDownloadTab({ pages = [], loading = false, onPageUpdate }) {
  const saveTimerMapRef = useRef({});
  const [downloadFolder, setDownloadFolder] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = localStorage.getItem("fb_youtube_config");
      const parsed = saved ? JSON.parse(saved).downloadFolder : "";
      if (parsed && parsed.trim() && parsed !== "downloads/youtube") return parsed;
      const shared = localStorage.getItem("fb_shared_video_folder");
      if (shared && shared.trim()) return shared.trim();
      return "";
    } catch {
      return "";
    }
  });
  const [hasDownloadedData, setHasDownloadedData] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("fb_youtube_has_data") === "true";
    } catch {
      return false;
    }
  });
  const [folderError, setFolderError] = useState(false);
  const delaySec = 2;
  const concurrency = 1;
  const [maxVideos, setMaxVideos] = useState(() => {
    if (typeof window === "undefined") return 5;
    try {
      const saved = localStorage.getItem("fb_youtube_config");
      return saved ? JSON.parse(saved).maxVideos ?? 5 : 5;
    } catch {
      return 5;
    }
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const isActionLockedRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVideosPage, setSelectedVideosPage] = useState(null);
  const [videosModalOpen, setVideosModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const pollTimerRef = useRef(null);
  const folderInputRef = useRef(null);
  const loggedStatusesRef = useRef({});
  const isConfigLoadedRef = useRef(false);
  const [items, setItems] = useState([]);
  const getUtc7Time = () => new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
  const [logs, setLogs] = useState([
    `[${new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })}] Sẵn Sàng Bộ Tải YouTube Shorts. Dữ Liệu Nạp Động Từ Tệp Cấu Hình Hệ Thống.`
  ]);
  const addLog = (msg) => {
    setLogs((prev) => {
      const cleanBody = (s) => (s || "").replace(/^\[.*?\]\s*/, "").trim();
      if (prev.length > 0 && cleanBody(prev[0]) === cleanBody(msg)) {
        return prev;
      }
      return [msg, ...prev];
    });
  };
  const [isConfigLoading, setIsConfigLoading] = useState(() => !globalYouTubeInitDone);
  useEffect(() => {
    let active = true;
    const init = async () => {
      if (globalYouTubeInitDone) {
        setIsConfigLoading(false);
        return;
      }
      setIsConfigLoading(true);
      addLog(`[${getUtc7Time()}] Đang Nạp Cấu Hình & Kiểm Tra Thư Mục YouTube Shorts...`);
      try {
        const cfg = await getYoutubeConfig();
        let targetFolder = downloadFolder;
        if (active && cfg) {
          const folder = (cfg.download_folder && cfg.download_folder.trim() && cfg.download_folder !== "downloads/youtube") ? cfg.download_folder.trim() : "";
          if (folder) {
            targetFolder = folder;
            setDownloadFolder(folder);
          }
          if (cfg.max_videos) {
            setMaxVideos(Number(cfg.max_videos));
          }
        }
        const check = await checkFolderData(targetFolder);
        if (active) {
          if (check && check.has_data) {
            setHasDownloadedData(true);
            try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
          } else if (check && check.has_data === false && !(itemsRef.current || []).some((it) => it.status === "SUCCESS")) {
            setHasDownloadedData(false);
            try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
          }
        }
      } catch {}
      finally {
        if (active) {
          isConfigLoadedRef.current = true;
          setIsConfigLoading(false);
          globalYouTubeInitDone = true;
        }
      }
    };
    init();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!isConfigLoadedRef.current) return;
    if (!downloadFolder || !downloadFolder.trim()) return;
    try {
      const numVideos = Math.max(1, parseInt(maxVideos, 10) || 1);
      localStorage.setItem("fb_youtube_config", JSON.stringify({ downloadFolder, delaySec, maxVideos: numVideos, concurrency }));
      saveYoutubeConfig({ download_folder: downloadFolder, max_videos: numVideos });
    } catch {}
  }, [downloadFolder, delaySec, maxVideos, concurrency]);
  const handleSelectFolder = async () => {
    if (isPickingFolder || isActionLockedRef.current) return;
    isActionLockedRef.current = true;
    setIsPickingFolder(true);
    try {
      if (hasDownloadedData) {
        alert("Thư Mục Hiện Tại Đang Chứa Dữ Liệu Video Đã Tải. Không Thể Thay Đổi Đường Dẫn Khi Chưa Xóa Hết Dữ Liệu Cũ!");
        return;
      }
      setHasDownloadedData(false);
      try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
      const res = await selectFolder(downloadFolder);
      if (res && res.error) {
        setHasDownloadedData(true);
        try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
        alert(res.error);
        return;
      }
      if (res && res.folder) {
        const check = await checkFolderData(res.folder);
        const hasData = Boolean(check && check.has_data);
        setHasDownloadedData(hasData);
        if (hasData) {
          try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
        } else {
          try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
        }
        setDownloadFolder(res.folder);
        setSharedVideoFolder(res.folder);
        setFolderError(false);
        saveYoutubeConfig({ download_folder: res.folder, max_videos: Math.max(1, parseInt(maxVideos, 10) || 1) });
        return;
      }
    } catch (err) {
      console.warn("Lỗi chọn thư mục:", err);
    } finally {
      setIsPickingFolder(false);
      isActionLockedRef.current = false;
    }
  };
  const handleFolderFileChange = async (e) => {
    if (downloadFolder && downloadFolder.trim()) {
      const check = await checkFolderData(downloadFolder);
      if (check && check.has_data) {
        setHasDownloadedData(true);
        try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
        alert("Thư Mục Hiện Tại Đang Chứa Dữ Liệu Video Đã Tải. Không Thể Thay Đổi Đường Dẫn Khi Chưa Xóa Hết Dữ Liệu Cũ!");
        return;
      }
    }
    setHasDownloadedData(false);
    try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
    const files = e.target.files;
    if (files && files.length > 0) {
      const first = files[0];
      const relPath = first.webkitRelativePath || "";
      const rootPart = relPath.split("/")[0] || "";
      if (rootPart) {
        const check = await checkFolderData(rootPart);
        const hasData = Boolean(check && check.has_data);
        setHasDownloadedData(hasData);
        if (hasData) {
          try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
        } else {
          try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
        }
        setDownloadFolder(rootPart);
        setFolderError(false);
      }
    }
  };
  useEffect(() => {
    if (isRunning) return;
    if (pages && pages.length > 0) {
      const pageItems = pages.map((p, idx) => {
        const pid = String(p.page_id || p.id || `page-${idx}`);
        return {
          id: pid,
          page_id: String(p.page_id || p.id || `page-${idx}`),
          page_name: p.page_name || `Page ${idx + 1}`,
          avatar: p.avatar || "",
          keyword: (p.youtube_keyword !== undefined && p.youtube_keyword !== null) ? p.youtube_keyword : "",
          link: p.youtube_url || "",
          status: "PENDING",
          message: ""
        };
      });
      setItems((prev) => {
        if (!prev || prev.length === 0) return pageItems;
        const prevMap = {};
        prev.forEach((it) => { prevMap[it.id] = it; });
        return pageItems.map((p) => {
          const old = prevMap[p.id];
          return old ? { ...p, keyword: old.keyword !== undefined ? old.keyword : p.keyword, link: old.link !== undefined ? old.link : p.link, status: old.status || p.status, message: old.message || p.message } : p;
        });
      });
    } else {
      setItems([]);
    }
  }, [pages, isRunning]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      Object.values(saveTimerMapRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);
  const savePageItemData = (pageId, keyword, link) => {
    if (!pageId) return;
    updatePageKeywords(pageId, { youtube_keyword: keyword, youtube_url: link });
    onPageUpdate?.(pageId, { youtube_keyword: keyword, youtube_url: link });
    try {
      const raw = localStorage.getItem("fb_pages_cache");
      if (raw) {
        const list = JSON.parse(raw);
        const updated = list.map((p) => (String(p.page_id || p.id) === String(pageId) ? { ...p, youtube_keyword: keyword, youtube_url: link } : p));
        localStorage.setItem("fb_pages_cache", JSON.stringify(updated));
      }
    } catch {}
  };
  const triggerDebouncedSave = (pageId, keyword, link) => {
    if (saveTimerMapRef.current[pageId]) {
      clearTimeout(saveTimerMapRef.current[pageId]);
    }
    saveTimerMapRef.current[pageId] = setTimeout(() => {
      savePageItemData(pageId, keyword, link);
      delete saveTimerMapRef.current[pageId];
    }, 400);
  };
  const handleKeywordChange = (id, val) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, keyword: val } : it)));
    const targetItem = itemsRef.current.find((it) => it.id === id);
    if (targetItem && targetItem.page_id) {
      triggerDebouncedSave(targetItem.page_id, val, targetItem.link || "");
    }
  };
  const handleLinkChange = (id, val) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, link: val } : it)));
    const targetItem = itemsRef.current.find((it) => it.id === id);
    if (targetItem && targetItem.page_id) {
      triggerDebouncedSave(targetItem.page_id, targetItem.keyword || "", val);
    }
  };
  const handleOpenVideos = (it) => {
    setSelectedVideosPage(it);
    setVideosModalOpen(true);
  };
  const handleOpenEditModal = (it) => {
    setEditingItem(it);
    setEditModalOpen(true);
  };
  const handleSaveEditModal = ({ id, page_id, link, keyword }) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, link, keyword } : item)));
    if (page_id) {
      if (saveTimerMapRef.current[page_id]) {
        clearTimeout(saveTimerMapRef.current[page_id]);
        delete saveTimerMapRef.current[page_id];
      }
      savePageItemData(page_id, keyword, link);
    }
  };
  const handleVideosCleared = async (pageId) => {
    const pidStr = String(pageId || "");
    setItems((prev) => prev.map((item) => ((item.id === pageId || String(item.page_id || item.id) === pidStr) ? { ...item, status: "PENDING", message: "" } : item)));
    if (downloadFolder && downloadFolder.trim()) {
      const check = await checkFolderData(downloadFolder);
      const hasData = Boolean(check && check.has_data);
      setHasDownloadedData(hasData);
      if (!hasData) {
        try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
      } else {
        try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
      }
    }
  };
  const filteredItems = items.filter((it) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (it.page_name || "").toLowerCase().includes(q) || (it.keyword || "").toLowerCase().includes(q) || (it.link || "").toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const isReadyToStart = Boolean(!isConfigLoading && downloadFolder && downloadFolder.trim());
  const handleClearPageVideos = async (it) => {
    const pageName = it.page_name || "Fanpage";
    if (!window.confirm(`Bạn Có Chắc Chắn Muốn Xóa Toàn Bộ Video YouTube Đã Tải Của Fanpage "${pageName}" Khỏi Ổ Đĩa Không?`)) {
      return;
    }
    const targetPid = String(it.page_id || it.id || "");
    const res = await clearPageVideos(targetPid, "YOUTUBE");
    setItems((prev) => prev.map((item) => ((item.id === it.id || String(item.page_id || item.id) === targetPid) ? { ...item, status: "PENDING", message: "" } : item)));
    const deletedMsg = res && res.deleted_count ? ` (Đã Xóa ${res.deleted_count} Video)` : "";
    addLog(`[${getUtc7Time()}] Đã Xóa Sạch Toàn Bộ Video Đã Tải Của Fanpage "${pageName}"${deletedMsg}.`);
    if (downloadFolder && downloadFolder.trim()) {
      const check = await checkFolderData(downloadFolder);
      const hasData = Boolean(check && check.has_data);
      setHasDownloadedData(hasData);
      if (!hasData) {
        try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
      } else {
        try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
      }
    }
  };
  const handleStartItem = async (it) => {
    if (isRunning || isStarting || isActionLockedRef.current) return;
    if (!downloadFolder || !downloadFolder.trim()) {
      setFolderError(true);
      alert("Vui Lòng Chọn Hoặc Nhập Thư Mục Lưu Video Trước Khi Kích Hoạt!");
      return;
    }
    let targetItem = it;
    const cur = (itemsRef.current || []).find((x) => x.id === it.id);
    if (cur) {
      targetItem = cur;
    }
    if (it.page_id) {
      if (saveTimerMapRef.current[it.page_id]) {
        clearTimeout(saveTimerMapRef.current[it.page_id]);
        delete saveTimerMapRef.current[it.page_id];
      }
      savePageItemData(it.page_id, targetItem.keyword || "", targetItem.link || "");
    }
    setFolderError(false);
    isActionLockedRef.current = true;
    setIsStarting(true);
    setIsRunning(true);
    const displayName = targetItem.link && targetItem.keyword ? `${targetItem.link} ["${targetItem.keyword}"]` : (targetItem.link || (targetItem.keyword ? `Từ Khóa: "${targetItem.keyword}"` : (targetItem.page_name || "Fanpage")));
    addLog(`[${getUtc7Time()}] Thư Mục Lưu: ${downloadFolder} | Giới Hạn: ${Number(maxVideos) || 1} Video/Page`);
    addLog(`[${getUtc7Time()}] Bắt Đầu Tải Cho Fanpage "${targetItem.page_name}" (${displayName})...`);
    setItems((prev) => prev.map((item) => (item.id === it.id ? { ...item, status: "RUNNING", message: "Đang Tải Video..." } : item)));
    const res = await startYouTubeDownloadJob({
      download_folder: downloadFolder,
      delay_sec: delaySec,
      max_videos: Number(maxVideos) || 1,
      concurrency: concurrency,
      items: [targetItem]
    });
    if (res && res.job_id) {
      const jobId = res.job_id;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      let isDone = false;
      pollTimerRef.current = setInterval(async () => {
        if (isDone) return;
        const statusData = await getJobStatus(jobId);
        if (statusData && statusData.items && !isDone) {
          const backendItem = statusData.items[0];
          if (backendItem) {
            setItems((prevItems) =>
              prevItems.map((p) => {
                if (p.id === it.id || String(p.page_id) === String(backendItem.page_id)) {
                  return { ...p, status: backendItem.status, message: toTitleCase(backendItem.message) };
                }
                return p;
              })
            );
          }
          if (statusData.job && statusData.job.status === "FINISHED") {
            isDone = true;
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setIsRunning(false);
            if (statusData.items.some((x) => x.status === "SUCCESS")) {
              setHasDownloadedData(true);
              try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
            } else if (downloadFolder && downloadFolder.trim()) {
              checkFolderData(downloadFolder).then((chk) => {
                if (chk && chk.has_data) {
                  setHasDownloadedData(true);
                  try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
                }
              });
            }
            const nowStr = getUtc7Time();
            const failed = statusData.items.some((x) => x.status === "FAILED");
            if (failed) {
              addLog(`[${nowStr}] [${displayName}] Tải Không Thành Công: ${toTitleCase(statusData.items[0]?.message || "Lỗi")}`);
            } else {
              addLog(`[${nowStr}] [${displayName}] Hoàn Tất Tải Video YouTube Thành Công!`);
            }
          }
        }
      }, 2000);
    } else {
      setIsRunning(false);
      setItems((prev) => prev.map((item) => (item.id === it.id ? { ...item, status: "FAILED", message: "Lỗi Khởi Chạy" } : item)));
      addLog(`[${getUtc7Time()}] Lỗi Khởi Chạy Tác Vụ Tải Cho Fanpage "${it.page_name}"!`);
    }
    setIsStarting(false);
    isActionLockedRef.current = false;
  };
  const handleStopItem = async (it) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsRunning(false);
    await stopJob("youtube");
    setItems((prev) => prev.map((item) => (item.id === it.id ? { ...item, status: "PENDING", message: "Đã Dừng" } : item)));
    addLog(`[${getUtc7Time()}] Đã Gửi Lệnh Dừng Tải Cho Fanpage "${it.page_name}".`);
  };
  const handleStart = async () => {
    if (isRunning || isStarting || isActionLockedRef.current) return;
    if (isConfigLoading) {
      alert("Hệ Thống Đang Nạp Cấu Hình. Vui Lòng Đợi Trong Giây Lát!");
      return;
    }
    if (!downloadFolder || !downloadFolder.trim()) {
      setFolderError(true);
      alert("Vui Lòng Chọn Hoặc Nhập Thư Mục Lưu Video Trước Khi Kích Hoạt!");
      return;
    }
    setFolderError(false);
    if (!items || items.length === 0) {
      alert("Không Có Fanpage Nào Để Thực Hiện Tải! Vui Lòng Kết Nối Fanpage Trước.");
      return;
    }
    isActionLockedRef.current = true;
    setIsStarting(true);
    Object.keys(saveTimerMapRef.current).forEach((pid) => {
      clearTimeout(saveTimerMapRef.current[pid]);
      delete saveTimerMapRef.current[pid];
      const cur = itemsRef.current.find((x) => String(x.page_id || x.id) === String(pid));
      if (cur) savePageItemData(pid, cur.keyword || "", cur.link || "");
    });
    setIsRunning(true);
    addLog(`[${getUtc7Time()}] Thư Mục Lưu: ${downloadFolder} | Giới Hạn: ${Number(maxVideos) || 1} Video/Page`);
    addLog(`[${getUtc7Time()}] Bắt Đầu Tác Vụ Tải Hàng Loạt YouTube (${items.length} Fanpage)...`);
    loggedStatusesRef.current = {};
    const res = await startYouTubeDownloadJob({
      download_folder: downloadFolder,
      delay_sec: delaySec,
      max_videos: Number(maxVideos) || 1,
      concurrency: concurrency,
      items: items
    });
    if (res && res.job_id) {
      const jobId = res.job_id;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      let isDone = false;
      pollTimerRef.current = setInterval(async () => {
        if (isDone) return;
        const statusData = await getJobStatus(jobId);
        if (statusData && statusData.items && !isDone) {
          const itemMap = {};
          statusData.items.forEach((it) => {
            itemMap[it.page_id] = it;
          });
          const newLogs = [];
          const nowStr = getUtc7Time();
          setItems((prevItems) =>
            prevItems.map((p) => {
              const pid = String(p.page_id || p.id);
              const backendItem = itemMap[pid];
              if (backendItem) {
                const prevLogged = loggedStatusesRef.current[pid];
                const displayName = p.link && p.keyword ? `${p.link} ["${p.keyword}"]` : (p.link || (p.keyword ? `Từ Khóa: "${p.keyword}"` : (p.page_name || "Nguồn")));
                if (backendItem.status === "RUNNING" && prevLogged !== "RUNNING") {
                  loggedStatusesRef.current[pid] = "RUNNING";
                  newLogs.push(`[${nowStr}] [${displayName}] Đang Xử Lý Tải Video...`);
                } else if (backendItem.status === "SUCCESS" && prevLogged !== "SUCCESS") {
                  loggedStatusesRef.current[pid] = "SUCCESS";
                  newLogs.push(`[${nowStr}] [${displayName}] Thành Công: ${toTitleCase(backendItem.message || "Đã Tải Xong Video")}`);
                } else if (backendItem.status === "FAILED" && prevLogged !== "FAILED") {
                  loggedStatusesRef.current[pid] = "FAILED";
                  newLogs.push(`[${nowStr}] [${displayName}] Thất Bại: ${toTitleCase(backendItem.message || "Lỗi Không Xác Định")}`);
                }
                return { ...p, status: backendItem.status, message: toTitleCase(backendItem.message) };
              }
              return p;
            })
          );
          if (newLogs.length > 0) {
            newLogs.reverse().forEach((logMsg) => addLog(logMsg));
          }
          if (statusData.job && statusData.job.status === "FINISHED") {
            isDone = true;
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setIsRunning(false);
            if (statusData.items.some((x) => x.status === "SUCCESS")) {
              setHasDownloadedData(true);
              try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
            } else if (downloadFolder && downloadFolder.trim()) {
              checkFolderData(downloadFolder).then((chk) => {
                if (chk && chk.has_data) {
                  setHasDownloadedData(true);
                  try { localStorage.setItem("fb_youtube_has_data", "true"); } catch {}
                }
              });
            }
            const hasFailed = statusData.items.some((it) => it.status === "FAILED");
            if (hasFailed) {
              addLog(`[${nowStr}] Tác Vụ Hoàn Tất: Một Số Nguồn Tải Không Thành Công. Xem Chi Tiết Ở Trên!`);
            } else {
              addLog(`[${nowStr}] Hoàn Tất Toàn Bộ Tác Vụ Tải YouTube Thành Công!`);
            }
          }
        }
      }, 2000);
    } else {
      setIsRunning(false);
      addLog(`[${getUtc7Time()}] Lỗi Khởi Chạy Tác Vụ Tải YouTube!`);
    }
    setIsStarting(false);
    isActionLockedRef.current = false;
  };
  const handleStop = async () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsRunning(false);
    await stopJob("youtube");
    addLog(`[${getUtc7Time()}] Đã Gửi Lệnh Dừng Tiến Trình Tải YouTube.`);
  };
  const handleDeleteAllVideos = async () => {
    if (!confirm("Bạn Có Chắc Muốn Xóa Toàn Bộ Video YouTube Đã Tải Khỏi Ổ Đĩa & Dữ Liệu Hệ Thống Không? Hành Động Này Sẽ Làm Trống Thư Mục & Mở Khóa Cấu Hình!")) return;
    setIsDeletingAll(true);
    try {
      const res = await clearAllVideos("YOUTUBE", downloadFolder);
      if (res && (res.success || res.deleted_count !== undefined)) {
        setHasDownloadedData(false);
        try { localStorage.removeItem("fb_youtube_has_data"); } catch {}
        setItems((prev) => prev.map((p) => ({ ...p, status: "PENDING", message: "" })));
        addLog(`[${getUtc7Time()}] Đã Xóa Sạch Toàn Bộ Video YouTube Đã Tải Khỏi Ổ Đĩa (${res.deleted_count || 0} Tệp). Thư Mục Đã Được Mở Khóa.`);
        alert("Đã Xóa Sạch Toàn Bộ Video Đã Tải Thành Công!");
      } else {
        alert("Có Lỗi Xảy Ra Khi Xóa Video!");
      }
    } catch {
      alert("Lỗi Kết Nối Máy Chủ Khi Xóa Video!");
    } finally {
      setIsDeletingAll(false);
    }
  };
  return (
    <div className="space-y-5 font-normal [&_*]:!font-normal [&_*]:normal-case">
      <Card className="border border-border bg-card shadow-sm">
        <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xs font-normal text-foreground flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-600" /> Cấu Hình Tải Video YouTube Shorts
          </CardTitle>
          <div className="flex items-center gap-2">
            {isConfigLoading ? (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-300 dark:border-blue-800 text-[11px] font-normal gap-1 px-2.5 py-0.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span>Đang Tải Cấu Hình...</span>
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-slate-500/10 text-slate-600 border-slate-300 dark:border-zinc-700 dark:text-zinc-400 text-[11px] font-normal gap-1 px-2.5 py-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Đã Nạp Cấu Hình</span>
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {isConfigLoading && (
            <div className="flex items-center justify-between p-2.5 rounded-lg border text-xs font-normal border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-600" />
                <span>Đang Nạp Cấu Hình Tải Video YouTube Shorts Từ Hệ Thống... Vui Lòng Đợi Trong Giây Lát.</span>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex flex-col lg:flex-row items-start gap-3 text-xs">
              <div className="space-y-1 flex-1 w-full min-w-0">
                <div className="flex items-center gap-1 font-normal text-foreground">
                  <span>Thư Mục Lưu Tổng</span>
                  <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" title="Đường Dẫn Thư Mục Lưu Video Tải Về Trên Ổ Đĩa." />
                </div>
                <div className="flex gap-2">
                  <input ref={folderInputRef} type="file" webkitdirectory="" directory="" className="hidden" onChange={handleFolderFileChange} />
                  <Input value={downloadFolder} readOnly={hasDownloadedData} onClick={() => { if (hasDownloadedData) alert("Thư Mục Hiện Tại Đang Chứa Dữ Liệu Video Đã Tải. Không Thể Thay Đổi Đường Dẫn Khi Chưa Xóa Hết Dữ Liệu Cũ!"); }} onChange={(e) => { if (hasDownloadedData) { alert("Thư Mục Hiện Tại Đang Chứa Dữ Liệu Video Đã Tải. Không Thể Thay Đổi Đường Dẫn Khi Chưa Xóa Hết Dữ Liệu Cũ!"); return; } setDownloadFolder(e.target.value); if (e.target.value.trim()) setFolderError(false); }} placeholder="Chưa Chọn Thư Mục Lưu Video (Bắt Buộc)..." className={`h-8 text-xs font-normal font-mono ${hasDownloadedData ? "cursor-not-allowed" : ""} ${folderError || !downloadFolder.trim() ? "border-amber-400 focus-visible:border-amber-500" : ""}`} />
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={isPickingFolder || isRunning || isStarting}
                    onClick={handleSelectFolder}
                    className="h-8 shrink-0 text-xs font-normal gap-1 disabled:opacity-50"
                  >
                    {isPickingFolder ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" /> Đang Mở...
                      </>
                    ) : (
                      <>
                        <FolderOpen className="w-3.5 h-3.5 text-blue-600" /> Chọn Thư Mục
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-1 shrink-0">
                <div className="flex items-center gap-1 font-normal text-foreground">
                  <span>Số Video Cần Tải Mỗi Lần</span>
                  <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" title="Số Lượng Video Mới Cần Tải Cho Mỗi Fanpage Trong Đợt Kích Hoạt Này." />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={maxVideos}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").replace(/^0+/, "");
                      setMaxVideos(val);
                    }}
                    onBlur={() => {
                      if (!maxVideos || Number(maxVideos) < 1) {
                        setMaxVideos("1");
                      }
                    }}
                    className="h-8 text-xs font-normal font-mono w-20 shrink-0"
                    placeholder="1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={handleDeleteAllVideos}
                    disabled={isDeletingAll}
                    className="h-8 px-2.5 text-xs font-normal text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/60 dark:hover:bg-rose-950/40 gap-1 shadow-none shrink-0"
                    title="Xóa Toàn Bộ Video Đã Tải Khỏi Ổ Đĩa & Cơ Sở Dữ Liệu"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" /> Xóa Tất Cả Video
                  </Button>
                </div>
              </div>
            </div>
            {(!downloadFolder || !downloadFolder.trim()) && (
              <p className="text-[11px] font-normal text-amber-600 dark:text-amber-400 flex items-center gap-1 pt-0.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" /> Chưa Chọn Thư Mục Lưu Video (Bắt Buộc). Bấm &quot;Chọn Thư Mục&quot; Hoặc Nhập Đường Dẫn Lưu Video.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 2xl:col-span-9 space-y-3">
          <Card className="border border-border bg-card shadow-sm">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xs font-normal text-foreground flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-blue-600" /> Danh Sách Fanpage & Từ Khóa Tải YouTube Shorts
                  </CardTitle>
                  <p className="text-[11px] font-normal text-muted-foreground mt-0.5">Quản Lý Từ Khóa Tải Video YouTube Shorts Trực Thuộc Từng Fanpage.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} placeholder="Tìm Kiếm Fanpage Theo Tên..." className="h-8 pl-8 text-xs font-normal" />
                </div>
                <div className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
                  <span>Tổng Số:</span>
                  <span className="font-normal text-foreground font-mono">{filteredItems.length}</span>
                  <span>Fanpage</span>
                </div>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-10 text-center text-[11px] font-normal normal-case tracking-normal">STT</TableHead>
                      <TableHead className="text-[11px] font-normal normal-case tracking-normal w-36 max-w-[150px]">Tên Fanpage</TableHead>
                      <TableHead className="text-[11px] font-normal normal-case tracking-normal min-w-[140px]">Từ Khóa</TableHead>
                      <TableHead className="text-[11px] font-normal normal-case tracking-normal min-w-[130px]">Link / Kênh</TableHead>
                      <TableHead className="text-center text-[11px] font-normal normal-case tracking-normal w-24 whitespace-nowrap">Trạng Thái</TableHead>
                      <TableHead className="w-36 text-center text-[11px] font-normal normal-case tracking-normal whitespace-nowrap">Thao Tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-normal">
                          <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                            <span className="font-normal text-foreground text-sm">Đang Tải Danh Sách Fanpage...</span>
                            <span className="text-muted-foreground text-[11px] font-normal leading-relaxed">Đang Đồng Bộ Dữ Liệu Fanpage Từ Hệ Thống, Vui Lòng Chờ Trong Giây Lát.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-normal">
                          <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                            <AlertCircle className="w-8 h-8 text-amber-500" />
                            <span className="font-normal text-foreground text-sm">Chưa Có Fanpage Nào Được Kết Nối</span>
                            <span className="text-muted-foreground text-[11px] font-normal leading-relaxed">Từ Khóa Tải Video Được Cấu Hình Trực Thuộc Từng Fanpage. Vui Lòng Kết Nối Tài Khoản Hoặc Đồng Bộ Fanpage Ở Tab &quot;Danh Sách Fanpage&quot; Trước Khi Thực Hiện Tải.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs font-normal">
                          Không Tìm Thấy Fanpage Nào Phù Hợp Với Từ Khóa Tìm Kiếm.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedItems.map((it, idx) => (
                        <TableRow key={it.id || idx} className="hover:bg-muted/20">
                          <TableCell className="text-center text-xs font-normal font-mono text-muted-foreground w-10 p-2">{(currentPage - 1) * pageSize + idx + 1}</TableCell>
                          <TableCell className="max-w-[150px] p-2">
                            <div className="flex items-center gap-1.5 cursor-pointer group min-w-0" onClick={() => handleOpenVideos(it)} title={it.page_name}>
                              <PageLogo avatar={it.avatar} name={it.page_name} />
                              <span className="text-xs font-normal text-foreground truncate group-hover:text-primary group-hover:underline min-w-0">{it.page_name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="p-2">
                            <div className="flex items-center gap-1 min-w-[140px]">
                              <div className="relative flex-1 min-w-0">
                                <Input
                                  value={it.keyword || ""}
                                  onChange={(e) => handleKeywordChange(it.id, e.target.value)}
                                  onBlur={(e) => {
                                    if (it.page_id) {
                                      if (saveTimerMapRef.current[it.page_id]) {
                                        clearTimeout(saveTimerMapRef.current[it.page_id]);
                                        delete saveTimerMapRef.current[it.page_id];
                                      }
                                      const cur = itemsRef.current.find((x) => x.id === it.id);
                                      savePageItemData(it.page_id, e.target.value, (cur && cur.link) || it.link || "");
                                    }
                                  }}
                                  className="h-7 text-xs font-normal px-2"
                                  placeholder="Từ Khóa..."
                                  title={it.keyword || ""}
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => handleOpenEditModal(it)}
                                className={`h-7 px-1.5 shrink-0 text-xs font-normal shadow-none gap-0.5 ${
                                  (it.keyword || "").split(/[\n,;]+/).filter(Boolean).length > 1
                                    ? "text-blue-600 border-blue-200 bg-blue-50/50 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-400"
                                    : "text-muted-foreground hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-800"
                                }`}
                                title="Mở Cửa Sổ Nhập Từ Khóa & Link"
                              >
                                {(() => {
                                  const count = (it.keyword || "").split(/[\n,;]+/).filter(Boolean).length;
                                  return count > 1 ? <span className="font-mono text-[10px]">{count}</span> : null;
                                })()}
                                <Maximize2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="p-2">
                            <div className="flex items-center gap-1 min-w-[130px]">
                              <div className="relative flex-1 min-w-0">
                                <Input
                                  value={it.link || ""}
                                  onChange={(e) => handleLinkChange(it.id, e.target.value)}
                                  onBlur={(e) => {
                                    if (it.page_id) {
                                      if (saveTimerMapRef.current[it.page_id]) {
                                        clearTimeout(saveTimerMapRef.current[it.page_id]);
                                        delete saveTimerMapRef.current[it.page_id];
                                      }
                                      const cur = itemsRef.current.find((x) => x.id === it.id);
                                      savePageItemData(it.page_id, (cur && cur.keyword) || it.keyword || "", e.target.value);
                                    }
                                  }}
                                  className="h-7 text-xs font-normal font-mono px-2"
                                  placeholder="Link / @Kênh..."
                                  title={it.link || ""}
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => handleOpenEditModal(it)}
                                className={`h-7 px-1.5 shrink-0 text-xs font-normal shadow-none gap-0.5 ${
                                  (it.link || "").split(/[\n,;]+/).filter(Boolean).length > 1
                                    ? "text-blue-600 border-blue-200 bg-blue-50/50 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-400"
                                    : "text-muted-foreground hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-800"
                                }`}
                                title="Mở Cửa Sổ Nhập Link & Từ Khóa"
                              >
                                {(() => {
                                  const count = (it.link || "").split(/[\n,;]+/).filter(Boolean).length;
                                  return count > 1 ? <span className="font-mono text-[10px]">{count}</span> : null;
                                })()}
                                <Maximize2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-center w-24 whitespace-nowrap p-2">
                            <div className="flex flex-col items-center gap-1">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-normal whitespace-nowrap shrink-0 ${it.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400" : it.status === "RUNNING" ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400" : it.status === "FAILED" ? "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400" : "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400"}`} title={toTitleCase(it.message) || ""}>
                                <span className={`w-1.5 h-1.5 rounded-full ${it.status === "SUCCESS" ? "bg-emerald-500" : it.status === "RUNNING" ? "bg-amber-500 animate-pulse" : it.status === "FAILED" ? "bg-rose-500" : "bg-blue-500"}`}></span>
                                {it.status === "SUCCESS" ? "Thành Công" : it.status === "RUNNING" ? "Đang Tải..." : it.status === "FAILED" ? "Lỗi" : "Chờ Lệnh..."}
                              </span>
                              {it.message && (
                                <span className={`text-[10px] font-normal text-center line-clamp-1 max-w-[100px] leading-tight cursor-help ${it.status === "FAILED" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`} title={toTitleCase(it.message)}>
                                  {toTitleCase(it.message)}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center p-2 whitespace-nowrap w-36">
                            <div className="inline-flex items-center gap-1">
                              {it.status === "RUNNING" ? (
                                <Button size="sm" variant="outline" onClick={() => handleStopItem(it)} className="h-7 px-2 text-[11px] font-normal text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-1 shadow-none" title="Dừng Tải Fanpage Này">
                                  <Square className="w-3 h-3 fill-current" /> Dừng
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => handleStartItem(it)} disabled={isRunning || isStarting || !isReadyToStart} className="h-7 px-2 text-[11px] font-normal text-blue-600 border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 gap-1 shadow-none disabled:opacity-40" title={isConfigLoading ? "Đang Nạp Cấu Hình Hệ Thống..." : (!downloadFolder || !downloadFolder.trim()) ? "Vui Lòng Cài Đặt Thư Mục Lưu Video Trước Khi Kích Hoạt!" : "Kích Hoạt Tải Riêng Fanpage Này"}>
                                  <Play className="w-3 h-3 fill-current" /> Kích Hoạt
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-muted" onClick={() => handleOpenVideos(it)} title="Xem Video Đã Tải Của Fanpage Này">
                                <Video className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-rose-600 hover:bg-muted" onClick={() => handleClearPageVideos(it)} title="Xóa Toàn Bộ Video Đã Tải Của Fanpage Này">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {filteredItems.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 px-1">
                  <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    <span>Hiển Thị</span>
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} className="h-7 text-xs font-normal border border-input rounded px-2 bg-background text-foreground focus:outline-none">
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                    <span>/ Trang (Tổng {filteredItems.length} Fanpage)</span>
                  </div>
                  <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                </div>
              )}
              <div className="space-y-2 pt-3 border-t border-border">
                {!isReadyToStart && (
                  <div className="flex items-center gap-1.5 text-[11px] font-normal text-amber-600 dark:text-amber-400">
                    <Lock className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                    <span>
                      {isConfigLoading
                        ? "Nút Kích Hoạt Đang Bị Khóa Vì Hệ Thống Đang Nạp Cấu Hình."
                        : "Nút Kích Hoạt Đang Bị Khóa Vì Chưa Cài Đặt Thư Mục Lưu Video (Bắt Buộc Chọn Thư Mục Lưu)."}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 font-normal text-xs h-9 text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-900/60 dark:text-blue-400 dark:hover:bg-blue-950/40 gap-2 shadow-none disabled:opacity-40"
                    disabled={isRunning || isStarting || items.length === 0 || !isReadyToStart}
                    onClick={handleStart}
                    title={isConfigLoading ? "Đang Nạp Cấu Hình Hệ Thống..." : (!downloadFolder || !downloadFolder.trim()) ? "Vui Lòng Cài Đặt Thư Mục Lưu Video Trước Khi Kích Hoạt!" : items.length === 0 ? "Chưa Có Fanpage Nào Để Kích Hoạt" : "Kích Hoạt Tải Hàng Loạt Cho Tất Cả Fanpage"}
                  >
                    {isStarting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" /> Đang Khởi Động...
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" /> Kích Hoạt Tất Cả
                      </>
                    )}
                  </Button>
                  <Button variant="outline" className="flex-1 font-normal text-xs h-9 text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40 gap-2 shadow-none disabled:opacity-40" disabled={!isRunning} onClick={handleStop}>
                    <Square className="w-3.5 h-3.5 fill-current" /> Dừng Tất Cả
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="xl:col-span-4 2xl:col-span-3 space-y-3 flex flex-col">
          <div className="border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-zinc-950 flex flex-col flex-1 h-full min-h-[560px]">
            <div className="bg-[#f3f4f6] dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 px-3.5 py-2.5 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 mr-2">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block shadow-xs cursor-pointer hover:brightness-95 transition-all" title="Đóng"></span>
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block shadow-xs cursor-pointer hover:brightness-95 transition-all" title="Thu Nhỏ"></span>
                  <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block shadow-xs cursor-pointer hover:brightness-95 transition-all" title="Mở Rộng"></span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-normal text-slate-700 dark:text-zinc-300">
                  <Terminal className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-normal">Nhật Ký Tải Chi Tiết</span>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setLogs([])} className="h-6 px-2 text-[11px] font-normal text-slate-600 border-slate-200 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 gap-1 rounded shadow-none" title="Xóa Nhật Ký">
                <Trash2 className="w-3 h-3" />
                <span className="font-normal">Xóa Nhật Ký</span>
              </Button>
            </div>
            <div className="flex-1 bg-white dark:bg-zinc-950 p-3.5 font-mono text-[11px] font-normal overflow-y-auto min-h-[500px] max-h-[680px] space-y-1.5 select-text">
              {logs.map((log, i) => {
                const isError = log.includes("Lỗi") || log.includes("Thất Bại") || log.includes("Thất bại") || log.includes("Không Thành Công") || log.includes("không thành công") || log.includes("Dừng") || log.includes("dừng");
                const isSuccess = !isError && (log.includes("Thành Công") || log.includes("thành công") || log.includes("Hoàn Tất") || log.includes("Đã Kết Nối") || log.includes("Đã kết nối"));
                const isWarning = !isError && !isSuccess && (log.includes("Đang") || log.includes("Bắt Đầu") || log.includes("Bắt đầu") || log.includes("Chờ") || log.includes("bỏ qua"));
                let timePart = "";
                let bodyPart = log;
                const timeMatch = log.match(/^\[(.*?)\]\s*(.*)$/);
                if (timeMatch) {
                  timePart = timeMatch[1];
                  bodyPart = timeMatch[2];
                }
                return (
                  <div
                    key={i}
                    className={`px-2.5 py-1.5 rounded border text-[11px] font-normal flex items-start gap-2 leading-relaxed transition-colors ${
                      isSuccess
                        ? "bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/40"
                        : isError
                        ? "bg-rose-50/70 dark:bg-rose-950/20 text-rose-900 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/40"
                        : isWarning
                        ? "bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/40"
                        : "bg-slate-50/80 dark:bg-zinc-900/60 text-slate-800 dark:text-zinc-200 border-slate-200/80 dark:border-zinc-800"
                    }`}
                  >
                    <span className={`select-none font-normal shrink-0 ${isSuccess ? "text-[#27c93f]" : isError ? "text-[#ff5f56]" : isWarning ? "text-[#eab308]" : "text-slate-400"}`}>➜</span>
                    {timePart && (
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-normal shrink-0 select-none">
                        [{timePart}]
                      </span>
                    )}
                    <span className={`px-1 py-0.2 rounded text-[9.5px] font-normal shrink-0 uppercase tracking-tight ${
                      isSuccess
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                        : isError
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300"
                        : isWarning
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                        : "bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}>
                      {isSuccess ? "Thành Công" : isError ? "Thất Bại" : isWarning ? "Đang Chạy" : "Thông Tin"}
                    </span>
                    <span className="flex-1 font-normal break-words">{bodyPart}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 pt-2 text-slate-400 dark:text-zinc-600 select-none text-[11px] font-normal">
                <span className="text-[#27c93f] font-normal">➜</span>
                <span className="text-slate-500 dark:text-zinc-400 font-normal">YouTube-Automator</span>
                <span className="w-1.5 h-3.5 bg-slate-500 dark:bg-zinc-400 animate-pulse inline-block"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <PageVideosModal open={videosModalOpen} onOpenChange={setVideosModalOpen} page={selectedVideosPage} defaultSource="YOUTUBE" onCleared={handleVideosCleared} />
      <EditSourceModal open={editModalOpen} onOpenChange={setEditModalOpen} item={editingItem} sourceType="YOUTUBE" onSave={handleSaveEditModal} />
    </div>
  );
}
