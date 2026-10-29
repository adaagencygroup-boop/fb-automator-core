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


def _callback_response(content):
    return HTMLResponse(content=content, headers={
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    })


class CallbackSubmitBody(BaseModel):
    state: str
    access_token: str = ""
    error: str = ""


CALLBACK_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kết nối Facebook - Facebook Automator</title>
  <style>
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: radial-gradient(ellipse at 50% 0%, #e8f2ff 0%, #f6f9ff 42%, #f8fafc 100%);
      color: #172033;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      position: relative;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.97);
      border: 1px solid #e3eaf4;
      border-radius: 24px;
      padding: 42px 40px 30px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 28px 80px rgba(30, 64, 112, .12), 0 3px 12px rgba(15, 23, 42, .04);
    }
    .card::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg, #0866ff, #59a7ff); }
    .brand { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 30px; color: #475569; font-size: 13px; font-weight: 650; }
    .brand-mark { width: 26px; height: 26px; display: grid; place-items: end center; overflow: hidden; border-radius: 50%; background: linear-gradient(145deg, #2894ff, #0866ff); color: #fff; font: 800 24px/24px Arial, sans-serif; }
    .icon-wrapper {
      width: 66px;
      height: 66px;
      display: grid;
      place-items: center;
      margin: 0 auto 18px;
      border-radius: 20px;
      font-size: 29px;
      font-weight: 700;
    }
    .icon-loading {
      background: #eff6ff;
      border: 0;
    }
    .icon-loading::after { content: ""; width: 30px; height: 30px; border: 3px solid #bfdbfe; border-top-color: #1877f2; border-radius: 50%; animation: spin .8s linear infinite; }
    .icon-success {
      background: #ecfdf5;
      color: #059669;
    }
    .icon-error {
      background: #fef2f2;
      color: #dc2626;
    }
    h2 { margin: 0 0 12px; color: #172033; font-size: clamp(21px, 4vw, 25px); line-height: 1.3; font-weight: 750; letter-spacing: -.025em; }
    p { max-width: 390px; margin: 0 auto 18px; color: #526176; font-size: 15px; line-height: 1.7; }
    .badge {
      display: none;
    }
    .btn-close {
      min-height: 44px;
      padding: 0 22px;
      border-radius: 11px;
      background: #1877f2;
      color: #fff;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      border: 0;
      box-shadow: 0 5px 12px rgba(24, 119, 242, .2);
      transition: background .15s, transform .15s;
    }
    .btn-close:hover { background: #0866d8; transform: translateY(-1px); }
    .btn-close:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 22px; }
    .btn-open, .btn-close-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid #dbe4f0;
      border-radius: 11px;
      color: #334155;
      background: #fff;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }
    .btn-open { border-color: #1877f2; background: #1877f2; color: #fff; box-shadow: 0 5px 12px rgba(24,119,242,.2); }
    .btn-open:hover { background: #0866d8; }
    .btn-close-secondary:hover { background: #f8fafc; }
    .fallback-note { margin: 12px auto 0; color: #748196; font-size: 12px; }
    .security { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 27px; color: #94a3b8; font-size: 11px; }
    .security span { color: #22c55e; font-size: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 520px) { body { padding: 16px; } .card { padding: 34px 22px 24px; border-radius: 20px; } .brand { margin-bottom: 25px; } }
    @media (prefers-reduced-motion: reduce) { .icon-loading::after { animation-duration: 2s; } .btn-close { transition: none; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand"><span class="brand-mark" aria-hidden="true">f</span><span>Facebook Automator</span></div>
    <div id="icon" class="icon-wrapper icon-loading"></div>
    <h2 id="title">Đang xác thực tài khoản…</h2>
    <p id="msg">Vui lòng chờ trong giây lát, hệ thống đang đồng bộ kết nối với phần mềm.</p>
    <div id="success-actions" class="actions" style="display: none;">
      <a class="btn-open" href="fbautomator://open/module-5">Mở ứng dụng</a>
      <button class="btn-close-secondary" onclick="window.close()">Đóng cửa sổ</button>
    </div>
    <p id="fallback-note" class="fallback-note" style="display: none;">Nếu ứng dụng chưa mở, hãy mở ứng dụng từ màn hình desktop.</p>
    <div id="close-action" class="actions" style="display: none;">
      <button class="btn-close" onclick="window.close()">Đóng cửa sổ</button>
    </div>
    <div class="security"><span aria-hidden="true">●</span> Kết quả xác thực được chuyển an toàn về ứng dụng</div>
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
      const successActions = document.getElementById("success-actions");
      const closeAction = document.getElementById("close-action");
      const fallbackNote = document.getElementById("fallback-note");

      if (!state) {
        icon.className = "icon-wrapper icon-error";
        icon.innerHTML = "&#10006;";
        title.innerText = "Kết nối chưa hoàn tất";
        msg.innerText = error ? "Bạn đã hủy hoặc từ chối cấp quyền Facebook. Hãy quay lại ứng dụng, mở mục Quản lý Page và bấm Kết nối Facebook để thử lại." : "Phiên kết nối đã hết hoặc không còn hợp lệ. Hãy quay lại ứng dụng, mở mục Quản lý Page và bấm Kết nối Facebook để bắt đầu lại.";
        closeAction.style.display = "flex";
        return;
      }

      try {
        const response = await fetch("/api/pages/web-oauth/callback-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, access_token: token, error })
        });
        const data = await response.json();
        if (response.ok && data.success && data.status === "QUEUED") {
          icon.className = "icon-wrapper icon-success";
          icon.innerHTML = "&#10004;";
          title.innerText = "Đã nhận kết quả Facebook";
          msg.innerText = "Ứng dụng đang đồng bộ Page. Bạn có thể mở ứng dụng để theo dõi hoặc đóng cửa sổ này.";
          successActions.style.display = "flex";
          fallbackNote.style.display = "block";
        } else if (response.ok && data.status === "FAILED") {
          throw new Error("Facebook authorization was declined or sync failed. The existing connection was kept.");
        } else if (response.ok && data.success && data.status === "SUCCEEDED") {
          icon.className = "icon-wrapper icon-success";
          icon.innerHTML = "&#10004;";
          title.innerText = "Đồng bộ Page thành công";
          msg.innerText = "Bạn có thể mở ứng dụng để tiếp tục hoặc đóng cửa sổ này.";
          successActions.style.display = "flex";
          fallbackNote.style.display = "block";
        } else {
          throw new Error(data.detail || data.message || "Xác thực không thành công.");
        }
      } catch (err) {
        icon.className = "icon-wrapper icon-error";
        icon.innerHTML = "&#10006;";
        title.innerText = "Lỗi kết nối";
        msg.innerText = "Không thể hoàn tất kết nối Facebook. Hãy quay lại ứng dụng, mở mục Quản lý Page và bấm Kết nối Facebook để thử lại.";
        closeAction.style.display = "flex";
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
            return _callback_response(CALLBACK_HTML_TEMPLATE.replace(
                "Đang xác thực tài khoản…", "Kết nối thành công!"
            ).replace(
                "icon-loading", "icon-success"
            ).replace(
                "Vui lòng chờ trong giây lát, hệ thống đang đồng bộ kết nối với phần mềm.",
                "Đã xác thực và đồng bộ với phần mềm. Bạn có thể đóng tab này lại."
            ))
        except Exception as exc:
            return _callback_response(CALLBACK_HTML_TEMPLATE.replace(
                "Đang xác thực tài khoản…", "Lỗi kết nối"
            ).replace(
                "icon-loading", "icon-error"
            ).replace(
                "Vui lòng chờ trong giây lát, hệ thống đang đồng bộ kết nối với phần mềm.",
                "Không thể hoàn tất kết nối Facebook. Hãy quay lại ứng dụng, mở mục Quản lý Page và bấm Kết nối Facebook để thử lại."
            ))

    return _callback_response(CALLBACK_HTML_TEMPLATE)


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
