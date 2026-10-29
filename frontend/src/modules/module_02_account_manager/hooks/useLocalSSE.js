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
const connectionListeners = new Set();

function getOrCreateEventSource() {
  if (typeof window === "undefined") return;
  if (activeEventSource) {
    return;
  }

  try {
    const sseUrl = `${API_BASE}/api/accounts/stream`;
    const es = {};

    es.onopen = () => {
      isConnectedGlobal = true;
      connectionListeners.forEach((l) => l(true));

      const logs = loadFromStorage();
      const lastMsg = logs.length > 0 ? logs[logs.length - 1].message : "";
      if (!lastMsg.includes("Đã kết nối với Local Python Engine")) {
        const connMsg = {
          timestamp: formatVietnamTime(),
          type: "info",
          message: "Đã kết nối với Local Python Engine (SSE Stream)",
        };
        const next = [...logs, connMsg];
        persistLogs(next);
        listeners.forEach((l) => l(next));
      }
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (isHeartbeat(data)) return;

        window.dispatchEvent(new CustomEvent("local_engine_event", { detail: data }));

        if (data.event === "account_operation_updated") return;

        const currentLogs = loadFromStorage();
        const newMsg = {
          timestamp: data.time || formatVietnamTime(),
          type: data.level || data.type || "info",
          message: translateLogMessage(data.message || JSON.stringify(data)),
          uid: data.uid,
          extra: data,
        };

        const next = [...currentLogs, newMsg].slice(-MAX_LOGS);
        persistLogs(next);
        listeners.forEach((l) => l(next));
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    es.onerror = () => {
      isConnectedGlobal = false;
      connectionListeners.forEach((l) => l(false));
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

    // This socket carries other modules' logs; account connectivity comes from SSE.
    ws.onopen = () => {};

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (isHeartbeat(data)) return;

        window.dispatchEvent(new CustomEvent("local_engine_event", { detail: data }));

        if (data.event === "account_operation_updated") return;

        const currentLogs = loadFromStorage();
        const newMsg = {
          timestamp: data.timestamp || data.time || formatVietnamTime(),
          type: (data.level || data.type || "info").toLowerCase(),
          message: translateLogMessage(data.message || JSON.stringify(data)),
          uid: data.uid,
          extra: data,
        };

        const next = [...currentLogs, newMsg].slice(-MAX_LOGS);
        persistLogs(next);
        listeners.forEach((l) => l(next));
      } catch (e) {}
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      activeWebSocket = null;
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
        isConnectedGlobal = false;
      }
    };
  }, [enabled]);

  const clearLogs = () => {
    clearAllLogs();
  };

  return { logs, connected, clearLogs };
}
