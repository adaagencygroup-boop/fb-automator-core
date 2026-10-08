// ===================================================================
// JAVASCRIPT LOGIC - FACEBOOK AUTOMATOR PRO WEB CLIENT
// ===================================================================

const API_BASE = "http://127.0.0.1:28129";
const WS_BASE = "ws://127.0.0.1:28129/ws/logs";

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initWebSocket();
  loadDashboard();
  loadAccounts();
  loadPages();
});

// Navigation Tab Switching
function initNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const headerTitle = document.getElementById("current-tab-title");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(n => n.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      item.classList.add("active");
      const targetId = item.getAttribute("data-tab");
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add("active");
      }
      headerTitle.textContent = item.textContent;
    });
  });
}

// Real-time Console Log via WebSocket
function initWebSocket() {
  const terminal = document.getElementById("log-terminal");
  const wsStatus = document.getElementById("ws-status");

  function connect() {
    const ws = new WebSocket(WS_BASE);

    ws.onopen = () => {
      wsStatus.textContent = "🟢 WebSocket Connected";
      wsStatus.style.color = "#10b981";
      appendLog("System", "SUCCESS", "Đã kết nối luồng nhật ký thời gian thực với Local Engine (Port 28129)!");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        appendLog(data.module, data.level, data.message);
      } catch (e) {
        console.error(e);
      }
    };

    ws.onclose = () => {
      wsStatus.textContent = "🔴 WebSocket Disconnected (Retrying...)";
      wsStatus.style.color = "#ef4444";
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  connect();
}

function appendLog(module, level, message) {
  const terminal = document.getElementById("log-terminal");
  const now = new Date().toLocaleTimeString();

  const colorMap = {
    INFO: "#38bdf8",
    SUCCESS: "#10b981",
    WARNING: "#f59e0b",
    ERROR: "#ef4444"
  };
  const color = colorMap[level] || "#94a3b8";

  const row = document.createElement("div");
  row.style.marginBottom = "3px";
  row.innerHTML = `<span style="color:#64748b;">[${now}]</span> 
<span style="color:${color}; font-weight:bold;">[${level}]</span> 
<span style="color:#a855f7;">[${module}]</span> 
<span style="color:#f1f5f9;">${message}</span>`;

  terminal.appendChild(row);
  terminal.scrollTop = terminal.scrollHeight;
}

// Fetch Dashboard Stats
async function loadDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/stats`);
    const data = await res.json();

    document.getElementById("stat-acc-total").textContent = data.accounts.total;
    document.getElementById("stat-pages-total").textContent = data.pages_total;
    document.getElementById("stat-posts-today").textContent = data.posts_today;
    document.getElementById("stat-proxies-active").textContent = data.proxies_active;

    const tbody = document.getElementById("tbl-recent-posts");
    tbody.innerHTML = "";

    if (!data.recent_activity || data.recent_activity.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #64748b;">Chưa có bài đăng nào hôm nay.</td></tr>`;
      return;
    }

    data.recent_activity.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.posted_at || ""}</td>
        <td>${r.target_name || r.target_id || ""}</td>
        <td><span style="color:#38bdf8; font-weight:600;">${r.post_type}</span></td>
        <td><span style="color:${r.status === 'SUCCESS' ? '#10b981' : '#ef4444'}; font-weight:bold;">${r.status}</span></td>
        <td>${r.fb_post_id || "-"}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    appendLog("WebUI", "ERROR", `Lỗi nạp Dashboard: ${e.message}`);
  }
}

// Accounts
async function loadAccounts() {
  try {
    const res = await fetch(`${API_BASE}/api/accounts`);
    const data = await res.json();
    const tbody = document.getElementById("tbl-accounts");
    tbody.innerHTML = "";

    data.accounts.forEach(acc => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${acc.uid}</b></td>
        <td>${acc.notes || acc.tags || "-"}</td>
        <td style="color:${acc.status === 'LIVE' ? '#10b981' : (acc.status === 'DIE' ? '#ef4444' : '#f59e0b')}">${acc.status}</td>
        <td>${acc.proxy || "Mặc định"}</td>
        <td>${acc.fa2 ? "Có" : "Không"}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

async function importAccounts() {
  const raw = document.getElementById("txt-import-accounts").value.trim();
  if (!raw) return alert("Vui lòng nhập danh sách tài khoản!");

  try {
    const res = await fetch(`${API_BASE}/api/accounts/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_data: raw })
    });
    const result = await res.json();
    if (result.success) {
      alert(`Đã nhập thành công ${result.imported_count} tài khoản!`);
      document.getElementById("txt-import-accounts").value = "";
      loadAccounts();
      loadDashboard();
    }
  } catch (e) {
    alert("Lỗi nhập tài khoản: " + e.message);
  }
}

// Pages
async function loadPages() {
  try {
    const res = await fetch(`${API_BASE}/api/pages`);
    const data = await res.json();
    const tbody = document.getElementById("tbl-pages");
    tbody.innerHTML = "";

    data.pages.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.page_id}</td>
        <td><b>${p.page_name}</b></td>
        <td>${p.auto_ai_enabled ? "Bật" : "Tắt"}</td>
        <td>${p.reels_folder || "Chưa gán"}</td>
        <td><span style="color:#10b981;">${p.status}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

async function fetchPageTokens() {
  const token = document.getElementById("txt-user-token").value.trim();
  if (!token) return alert("Vui lòng nhập User Token!");

  try {
    const res = await fetch(`${API_BASE}/api/pages/fetch-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_token: token })
    });
    const result = await res.json();
    if (result.success) {
      alert(`Đã nạp thành công ${result.count} Fanpage!`);
      document.getElementById("txt-user-token").value = "";
      loadPages();
      loadDashboard();
    }
  } catch (e) {
    alert("Lỗi nạp token: " + e.message);
  }
}
