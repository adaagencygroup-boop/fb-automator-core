# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_oauth_callback.py
FastAPI router phục vụ trang callback OAuth cho Meta Facebook.
Lắng nghe tại GET /oauth/meta/callback và POST /api/pages/web-oauth/callback-submit.
Tương thích cả môi trường Desktop App (.exe) lẫn Web Dev.
"""
import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import requests

from . import meta_web
from .meta_config import GRAPH_API_VERSION, credentials, callback_url

router = APIRouter(tags=["OAuth Meta Callback"])


class CallbackSubmitBody(BaseModel):
    state: str
    access_token: str = ""
    error: str = ""


CALLBACK_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Xác thực Facebook - Facebook Automator Pro</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1.25rem;
      padding: 2.5rem 2rem;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
    }
    .icon-wrapper {
      width: 72px;
      height: 72px;
      margin: 0 auto 1.5rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      transition: all 0.3s ease;
    }
    .icon-loading {
      background: rgba(59, 130, 246, 0.15);
      border: 3px solid rgba(59, 130, 246, 0.3);
      border-top-color: #3b82f6;
      animation: spin 1s linear infinite;
    }
    .icon-success {
      background: rgba(34, 197, 94, 0.2);
      border: 3px solid #22c55e;
      color: #22c55e;
    }
    .icon-error {
      background: rgba(239, 68, 68, 0.2);
      border: 3px solid #ef4444;
      color: #ef4444;
    }
    h2 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #ffffff;
    }
    p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .badge {
      display: inline-block;
      padding: 0.35rem 0.85rem;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 9999px;
      font-size: 0.8rem;
      color: #cbd5e1;
      margin-bottom: 1rem;
    }
    .btn-close {
      display: inline-block;
      background: #3b82f6;
      color: #ffffff;
      padding: 0.65rem 1.5rem;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: background 0.2s;
    }
    .btn-close:hover { background: #2563eb; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Facebook Automator Pro</div>
    <div id="icon" class="icon-wrapper icon-loading"></div>
    <h2 id="title">Đang xác thực tài khoản…</h2>
    <p id="msg">Vui lòng chờ trong giây lát, hệ thống đang đồng bộ kết nối với phần mềm.</p>
    <div id="action" style="display: none;">
      <button class="btn-close" onclick="window.close()">Đóng cửa sổ này</button>
    </div>
  </div>

  <script>
    (async function() {
      const hash = window.location.hash.slice(1);
      const search = window.location.search.slice(1);
      const params = new URLSearchParams(hash || search);
      
      const state = params.get("state") || "";
      const token = params.get("access_token") || "";
      const error = params.get("error") || params.get("error_description") || "";
      
      const icon = document.getElementById("icon");
      const title = document.getElementById("title");
      const msg = document.getElementById("msg");
      const action = document.getElementById("action");

      if (error || (!token && !state)) {
        icon.className = "icon-wrapper icon-error";
        icon.innerHTML = "&#10006;";
        title.innerText = "Kết nối chưa hoàn tất";
        msg.innerText = error ? ("Lý do: " + error) : "Không tìm thấy token ủy quyền từ Facebook.";
        action.style.display = "block";
        return;
      }

      try {
        const response = await fetch("/api/pages/web-oauth/callback-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, access_token: token, error })
        });
        const data = await response.json();
        if (response.ok && data.success) {
          icon.className = "icon-wrapper icon-success";
          icon.innerHTML = "&#10004;";
          title.innerText = "Kết nối thành công!";
          msg.innerText = "Đã xác thực và đồng bộ với phần mềm. Cửa sổ này sẽ tự đóng sau 2 giây…";
          setTimeout(function() {
            window.close();
            // Nếu trình duyệt chặn window.close:
            action.style.display = "block";
          }, 2000);
        } else {
          throw new Error(data.detail || data.message || "Xác thực không thành công.");
        }
      } catch (err) {
        icon.className = "icon-wrapper icon-error";
        icon.innerHTML = "&#10006;";
        title.innerText = "Lỗi kết nối";
        msg.innerText = err.message || "Không thể gửi dữ liệu về phần mềm.";
        action.style.display = "block";
      }
    })();
  </script>
</body>
</html>
"""


@router.get("/oauth/meta/callback", response_class=HTMLResponse)
def oauth_meta_callback_page(request: Request):
    """
    Điểm tiếp nhận chuyển hướng từ Facebook.
    Phục vụ trang HTML xử lý token từ fragment và gửi về backend.
    Hỗ trợ xử lý trực tiếp nếu Facebook trả code qua query parameter.
    """
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error") or request.query_params.get("error_description")

    # Nếu Facebook trả code trực tiếp trên query string (Authorization Code Grant):
    if code and state:
        try:
            app_id, secret = credentials()
            redirect = callback_url()
            token_resp = requests.get(
                f"https://graph.facebook.com/{GRAPH_API_VERSION}/oauth/access_token",
                params={
                    "client_id": app_id,
                    "redirect_uri": redirect,
                    "client_secret": secret,
                    "code": code,
                },
                timeout=15,
            )
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                raise ValueError(token_data.get("error", {}).get("message") or "Không lấy được access_token từ code.")
            meta_web.complete_by_state(state, access_token, auto_confirm=True)
            # Render trang thành công trực tiếp
            return HTMLResponse(content=CALLBACK_HTML_TEMPLATE.replace(
                "Đang xác thực tài khoản…", "Kết nối thành công!"
            ).replace(
                "icon-loading", "icon-success"
            ).replace(
                "Vui lòng chờ trong giây lát, hệ thống đang đồng bộ kết nối với phần mềm.",
                "Đã xác thực và đồng bộ với phần mềm. Bạn có thể đóng tab này lại."
            ))
        except Exception as exc:
            return HTMLResponse(content=CALLBACK_HTML_TEMPLATE.replace(
                "Đang xác thực tài khoản…", "Lỗi kết nối"
            ).replace(
                "icon-loading", "icon-error"
            ).replace(
                "Vui lòng chờ trong giây lát, hệ thống đang đồng bộ kết nối với phần mềm.",
                f"Lỗi: {exc}"
            ))

    return HTMLResponse(content=CALLBACK_HTML_TEMPLATE)


@router.post("/api/pages/web-oauth/callback-submit")
def oauth_meta_callback_submit(body: CallbackSubmitBody):
    """
    Endpoint nội bộ nhận state và access_token từ trang callback HTML để hoàn tất OAuth.
    Công khai, không yêu cầu Authorization header vì state đã chứa chữ ký ngẫu nhiên an toàn.
    """
    try:
        result = meta_web.complete_by_state(
            state=body.state,
            token=body.access_token,
            error=body.error,
            auto_confirm=True,
        )
        return {
            "success": True,
            "job_id": result["job_id"],
            "status": result["status"],
            "message": "Đã ghi nhận kết nối Facebook.",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
