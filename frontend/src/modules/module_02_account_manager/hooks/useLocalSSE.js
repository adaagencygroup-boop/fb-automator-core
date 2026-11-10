"use client";

import { useEffect, useState } from "react";
import { formatVietnamTime } from "@/lib/date-utils";
import { API_BASE, WS_BASE } from "@/config/constants";
import { api } from "@/services/api";
import { getAccessToken } from "@/services/authTokens.mjs";
import { getSessionUserId } from "@/services/sessionIdentity.mjs";
import { connectSSE } from "@/services/sse.mjs";

const STORAGE_KEY = "fb_account_terminal_logs";
const MAX_LOGS = 600;

const DEFAULT_INITIAL_LOGS = [];

let globalLogs = [];
let hasLoadedFromStorage = false;

export function translateLogMessage(rawMsg) {
  if (!rawMsg || typeof rawMsg !== "string") return rawMsg;

  if (rawMsg.includes("TimeoutException") || /wait timed out/i.test(rawMsg)) {
    return "⚠️ Quá thời gian chờ tải trang hoặc phần tử Facebook. Đang thử lại...";
  }
  if (rawMsg.includes("NoSuchElementException")) {
    return "⚠️ Không tìm thấy nút hoặc thành phần giao diện Facebook cần tương tác.";
  }
  if (
    rawMsg.includes("ERR_PROXY_CONNECTION_FAILED") ||
    rawMsg.includes("ProxyError") ||
    /proxy connection failed/i.test(rawMsg)
  ) {
    return "❌ Lỗi kết nối Proxy: Không thể truy cập qua Proxy được cấu hình cho tài khoản này!";
  }
  if (rawMsg.includes("ERR_INTERNET_DISCONNECTED") || /internet disconnected/i.test(rawMsg)) {
    return "❌ Mất kết nối mạng Internet. Vui lòng kiểm tra lại kết nối mạng!";
  }
  if (/only supports Chrome version/i.test(rawMsg) || /version of ChromeDriver/i.test(rawMsg)) {
    return "❌ ChromeDriver không khớp phiên bản Chrome đang cài. Cập nhật Chrome rồi mở lại nick.";
  }
  if (rawMsg.includes("SessionNotCreatedException") || /session not created/i.test(rawMsg) || /chrome instance exited/i.test(rawMsg)) {
    return "❌ Chrome của nick này vẫn đang chạy hoặc profile bị khóa. Đóng cửa sổ Chrome của nick rồi đăng nhập lại.";
  }
  if (
    /ResourceExhausted/i.test(rawMsg) ||
    /quota exceeded/i.test(rawMsg) ||
    /exceeded your current quota/i.test(rawMsg)
  ) {
    return "⚠️ Model Gemini AI đã chạm giới hạn hạn mức truy vấn miễn phí (Quota Limit). Đang chuyển chế độ chờ.";
  }
  if (/rate limit/i.test(rawMsg) || /spam block/i.test(rawMsg)) {
    return "⚠️ Facebook hạn chế thao tác tạm thời do tần suất nhanh. Vui lòng tăng độ trễ!";
  }

  return rawMsg;
}

function isHeartbeat(m) {
  if (!m) return false;
  if (m.heartbeat) return true;
  if (m.type === "heartbeat" || m.level === "heartbeat") return true;
  if (typeof m.message === "string" && m.message.includes('"type":"heartbeat"')) return true;
  return false;
}

function loadFromStorage() {
  if (hasLoadedFromStorage) return globalLogs;
  if (typeof window !== "undefined") {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          globalLogs = parsed.filter((item) => !isHeartbeat(item) && !isHeartbeat(item?.extra));
          hasLoadedFromStorage = true;
          return globalLogs;
        }
      }
    } catch (e) {
      console.error("Failed to read sessionStorage logs", e);
    }
  }

  // Connection messages are added only after the stream actually connects.
  globalLogs = [...DEFAULT_INITIAL_LOGS];
  hasLoadedFromStorage = true;
  return globalLogs;
}

function persistLogs(logs) {
  globalLogs = logs.filter((item) => !isHeartbeat(item) && !isHeartbeat(item?.extra)).slice(-MAX_LOGS);
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(globalLogs));
    } catch (e) {}
  }
}

export function clearAllLogs() {
  globalLogs = [];
  hasLoadedFromStorage = true;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    } catch (e) {}
  }
  listeners.forEach((l) => l([]));
}

const listeners = new Set();
let activeEventSource = null;
let activeWebSocket = null;
let activeSubscribersCount = 0;
let isConnectedGlobal = false;
/** Chỉ ghi 1 lần “Đã kết nối…” / phiên — tránh SSE reconnect spam làm terminal nháy. */
let hasAnnouncedConnection = false;
let offlineNotifyTimer = null;
const connectionListeners = new Set();

function setConnectedStatus(next) {
  if (next) {
    if (offlineNotifyTimer) {
      clearTimeout(offlineNotifyTimer);
      offlineNotifyTimer = null;
    }
    if (isConnectedGlobal) return;
    isConnectedGlobal = true;
    connectionListeners.forEach((l) => l(true));
    return;
  }
  // Debounce offline: SSE hay drop/reconnect sau job — đừng nháy Online/Offline liên tục
  if (!isConnectedGlobal) return;
  if (offlineNotifyTimer) return;
  offlineNotifyTimer = setTimeout(() => {
    offlineNotifyTimer = null;
    const wsAlive =
      activeWebSocket &&
      (activeWebSocket.readyState === WebSocket.OPEN ||
        activeWebSocket.readyState === WebSocket.CONNECTING);
    if (wsAlive) return;
    if (!isConnectedGlobal) return;
    isConnectedGlobal = false;
    connectionListeners.forEach((l) => l(false));
  }, 4000);
}

function getOrCreateEventSource() {
  if (typeof window === "undefined") return;
  if (activeEventSource) {
    return;
  }

  try {
    const sseUrl = `${API_BASE}/api/accounts/stream`;
    const es = {};

    es.onopen = () => {
      setConnectedStatus(true);
      markEngineConnected("SSE Stream & WebSocket Realtime");
    };

    es.onmessage = (event) => {
      try {
        appendEngineLog(JSON.parse(event.data));
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    es.onerror = () => {
      // Transient SSE close/retry — không flip offline ngay nếu WS còn sống
      setConnectedStatus(false);
    };
    activeEventSource = connectSSE(sseUrl, {
      getHeaders: () => {
        const token = getAccessToken();
        const userId = getSessionUserId();
        return {
          "X-Auth-Client": "user",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(userId ? { "X-Auth-User-Id": userId } : {}),
        };
      },
      // Reuse API session validation and its token refresh interceptor.
      onUnauthorized: () => api.get("/api/v1/auth/me"),
      onOpen: es.onopen,
      onMessage: es.onmessage,
      onError: es.onerror,
    });
  } catch (err) {
    console.error("Failed to initialize SSE connection:", err);
  }
}

function markEngineConnected(label) {
  if (hasAnnouncedConnection) return;
  hasAnnouncedConnection = true;
  const logs = loadFromStorage();
  if (logs.some((item) => String(item?.message || "").includes("Đã kết nối với Local Python Engine"))) {
    return;
  }
  const connMsg = {
    timestamp: formatVietnamTime(),
    type: "info",
    message: `Đã kết nối với Local Python Engine (${label})`,
  };
  const next = [...logs, connMsg];
  persistLogs(next);
  listeners.forEach((l) => l(next));
}

function appendEngineLog(data) {
  if (isHeartbeat(data)) return;
  window.dispatchEvent(new CustomEvent("local_engine_event", { detail: data }));
  if (data.event === "account_operation_updated") return;
  if (data.type === "connected" && !data.level && !data.message?.includes?.("🚀") && !data.uid) {
    // SSE hello — không nhân đôi với markEngineConnected
    if (String(data.message || "").toLowerCase().includes("sse stream connected")) return;
  }

  const msgText = String(data.message ?? "").trim();
  const typeLower = String(data.type || "").toLowerCase();
  if (typeLower === "ping" || typeLower === "pong" || msgText === "ping" || msgText === "pong") return;
  // Không đẩy gói tin rỗng / object vô nghĩa lên terminal
  if (!msgText) return;

  const currentLogs = loadFromStorage();
  const stamp = data.time || data.timestamp;
  let displayTime = formatVietnamTime();
  if (typeof stamp === "string" && stamp) {
    displayTime = stamp.includes("T") ? formatVietnamTime(stamp) : stamp;
  }
  const newMsg = {
    timestamp: displayTime,
    type: String(data.level || data.type || "info").toLowerCase(),
    message: translateLogMessage(msgText),
    uid: data.uid,
    extra: data,
  };
  // Tránh spam trùng 1 dòng (SSE + WS mirror cùng message)
  const last = currentLogs[currentLogs.length - 1];
  if (
    last
    && last.message === newMsg.message
    && last.uid === newMsg.uid
    && String(last.type) === String(newMsg.type)
  ) {
    return;
  }
  const next = [...currentLogs, newMsg].slice(-MAX_LOGS);
  persistLogs(next);
  listeners.forEach((l) => l(next));
}

function getOrCreateWebSocket() {
  if (typeof window === "undefined" || !WS_BASE) return;
  if (
    activeWebSocket &&
    (activeWebSocket.readyState === WebSocket.OPEN ||
      activeWebSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    const ws = new WebSocket(WS_BASE);
    activeWebSocket = ws;

    // Module 02/04 broadcast mirror qua /ws/logs — quan trọng cho bản .exe
    ws.onopen = () => {
      setConnectedStatus(true);
      markEngineConnected("WebSocket Realtime");
      try {
        ws.send("ping");
      } catch (e) {}
    };

    ws.onmessage = (event) => {
      try {
        const raw = event.data;
        if (raw === "ping" || raw === "pong") return;
        appendEngineLog(JSON.parse(raw));
      } catch (e) {}
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      activeWebSocket = null;
      setConnectedStatus(false);
    };
  } catch (err) {}
}

export function useLocalSSE(enabled = true) {
  const [logs, setLogs] = useState(() => loadFromStorage());
  const [connected, setConnected] = useState(() => isConnectedGlobal);

  useEffect(() => {
    if (!enabled) return;

    activeSubscribersCount++;
    getOrCreateEventSource();
    getOrCreateWebSocket();

    const logListener = (updatedLogs) => {
      setLogs([...updatedLogs]);
    };

    const connListener = (status) => {
      setConnected(status);
    };

    listeners.add(logListener);
    connectionListeners.add(connListener);

    return () => {
      listeners.delete(logListener);
      connectionListeners.delete(connListener);
      activeSubscribersCount = Math.max(0, activeSubscribersCount - 1);
      if (activeSubscribersCount === 0) {
        activeEventSource?.close();
        activeEventSource = null;
        if (activeWebSocket) {
          activeWebSocket.onclose = null;
          activeWebSocket.close();
          activeWebSocket = null;
        }
        if (offlineNotifyTimer) {
          clearTimeout(offlineNotifyTimer);
          offlineNotifyTimer = null;
        }
        isConnectedGlobal = false;
        hasAnnouncedConnection = false;
      }
    };
  }, [enabled]);

  const clearLogs = () => {
    clearAllLogs();
  };

  return { logs, connected, clearLogs };
}
