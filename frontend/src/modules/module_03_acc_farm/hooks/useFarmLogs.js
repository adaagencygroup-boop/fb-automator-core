"use client";

import { useSyncExternalStore } from "react";
import { WS_BASE } from "@/config/constants";

// Log realtime của Tương tác tài khoản: BE (adapters.emit_log) gửi qua WebSocket /ws/logs với cờ farm=true.
// Giữ ở mức module + sessionStorage để chuyển trang rồi quay lại vẫn còn log của phiên đang chạy.

const STORAGE_KEY = "m03.farm.logs";
const MAX_LOGS = 500;

let logs = null;
let socket = null;
let connected = false;
let retryTimer = null;
let subscribers = 0;
const listeners = new Set();

function load() {
  if (logs) return logs;
  logs = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) logs = saved.slice(-MAX_LOGS);
  } catch {
    /* sessionStorage bị chặn: chỉ giữ trong bộ nhớ */
  }
  return logs;
}

const EMPTY_STATE = { logs: [], connected: false };
let state = EMPTY_STATE;

function emit() {
  state = { logs: logs || [], connected };
  listeners.forEach((fn) => fn());
}

function save(next) {
  logs = next.slice(-MAX_LOGS);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    /* bỏ qua */
  }
  emit();
}

function push(entry) {
  save([...load(), entry]);
}

function timeOf(timestamp) {
  // BE gửi "YYYY-MM-DD HH:MM:SS" giờ VN
  const m = String(timestamp || "").match(/(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

function connect() {
  if (typeof window === "undefined" || !WS_BASE) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(WS_BASE);
  } catch {
    return;
  }
  socket.onopen = () => {
    connected = true;
    emit();
  };
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (!data || data.farm !== true) return;
      push({
        time: timeOf(data.timestamp),
        level: String(data.level || "INFO").toUpperCase(),
        message: data.message || "",
        uid: data.uid || null,
        thread: data.thread ?? null,
      });
    } catch {
      /* gói tin không phải JSON */
    }
  };
  socket.onclose = () => {
    connected = false;
    socket = null;
    emit();
    // Engine khởi động lại: tự kết nối lại khi màn còn mở
    if (subscribers > 0 && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (subscribers > 0) connect();
      }, 3000);
    }
  };
  socket.onerror = () => {};
}

export function clearFarmLogs() {
  save([]);
}

/**
 * Bấm Kích hoạt: xóa log (và danh sách luồng) của phiên trước ngay trước khi gửi lệnh, vì BE ghi log "Bắt đầu..."
 * trong lúc xử lý lệnh. Trả về hàm trả lại log cũ khi Kích hoạt bị từ chối (BE chỉ ghi log sau khi qua hết kiểm tra).
 */
export function startNewFarmLogs() {
  const previous = load();
  clearFarmLogs();
  return () => save([...previous, ...(logs || [])]);
}

function subscribe(listener) {
  listeners.add(listener);
  subscribers += 1;
  if (!logs) {
    load();
    state = { logs, connected };
  }
  connect();
  return () => {
    listeners.delete(listener);
    subscribers = Math.max(0, subscribers - 1);
  };
}

export function useFarmLogs() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY_STATE);
}
