/**
 * File & Folder Bridge for FB Automator Desktop (Tauri/Electron) and Web Browser.
 * Kết nối Native Windows File & Folder Chooser qua Local Engine backend.
 */
import api from "../services/api";

export async function openFolderPicker() {
  if (typeof window !== "undefined") {
    // 1. Electron bridge nếu có
    if (window.electronAPI?.selectFolder) {
      try {
        const res = await window.electronAPI.selectFolder();
        if (res) return res;
      } catch (e) {
        console.error("Lỗi khi mở Folder Dialog qua Electron:", e);
      }
    }

    // 2. Tauri dialog nếu có
    if (window.__TAURI__?.dialog?.open) {
      try {
        const selected = await window.__TAURI__.dialog.open({
          directory: true,
          multiple: false,
        });
        if (selected) return typeof selected === "string" ? selected : selected[0];
      } catch (e) {
        console.error("Lỗi khi mở Folder Dialog qua Tauri:", e);
      }
    }

    // 3. Backend Local Engine (Bật cửa sổ FolderBrowserDialog của Windows)
    try {
      const res = await api.get("/api/post/dialog/folder");
      const path = res?.path ?? res?.data?.path;
      if (path) return path;
    } catch (e) {
      console.warn("Backend folder dialog không phản hồi:", e);
    }
  }

  return null;
}

export async function openFilePicker(filters) {
  if (typeof window !== "undefined") {
    // 1. Electron bridge
    if (window.electronAPI?.selectFile) {
      try {
        const res = await window.electronAPI.selectFile(filters);
        if (res) return res;
      } catch (e) {
        console.error("Lỗi khi mở File Dialog qua Electron:", e);
      }
    }

    // 2. Tauri dialog
    if (window.__TAURI__?.dialog?.open) {
      try {
        const selected = await window.__TAURI__.dialog.open({
          directory: false,
          multiple: false,
          filters: filters?.map((f) => ({ name: f.name, extensions: f.extensions })),
        });
        if (selected) return typeof selected === "string" ? selected : selected[0];
      } catch (e) {
        console.error("Lỗi khi mở File Dialog qua Tauri:", e);
      }
    }

    // 3. Backend Local Engine (Bật cửa sổ OpenFileDialog của Windows)
    try {
      const ext = filters?.[0]?.extensions?.[0] || "txt";
      const res = await api.get(`/api/post/dialog/file?filter_ext=${encodeURIComponent(ext)}`);
      const path = res?.path ?? res?.data?.path;
      if (path) return path;
    } catch (e) {
      console.warn("Backend file dialog không phản hồi:", e);
    }
  }

  return null;
}

export async function testProxyConnection(proxyStr) {
  if (typeof window !== "undefined" && window.electronAPI?.testProxy) {
    try {
      return await window.electronAPI.testProxy(proxyStr);
    } catch (e) {
      return { live: false, message: e.message || "Lỗi kiểm tra proxy" };
    }
  }

  try {
    const res = await api.post("/api/accounts/test-proxy", { proxy: proxyStr });
    const data = res?.data ?? res;
    return {
      live: data.live ?? data.success ?? false,
      ip: data.ip || data.proxy || "",
      message: data.message || (data.live ? "Proxy hoạt động tốt" : "Không thể kết nối proxy"),
    };
  } catch (e) {
    return { live: false, message: e.message || "Không thể kiểm tra proxy" };
  }
}
