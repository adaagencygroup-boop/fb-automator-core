"""Browser regression for standalone OAuth popups; intercepts every API/Meta request.

Serve frontend/out first. No real Facebook login or production backend is used.
"""
import json
import sys
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8788"


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.route_web_socket("**/ws/logs", lambda socket: None)
        state = {"current": None, "active": None, "jobs": {}, "starts": 0, "completes": 0, "fail_switch": False,
                 "delay_accounts": True, "account_requests": [], "verify_calls": 0}
        errors = []

        def current():
            result = state["current"] or {"connected": False, "identity": None, "token_state": "unknown"}
            return {**result, "active_job": state["active"]}

        def api(route):
            request = route.request
            path = urlsplit(request.url).path
            headers = {"Access-Control-Allow-Origin": BASE, "Access-Control-Allow-Credentials": "true",
                       "Access-Control-Allow-Headers": "content-type,x-auth-client,x-auth-user-id",
                       "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}
            if request.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            code, data = 200, {}
            if path.endswith("/auth/me"):
                data = {"id": "owner-a", "username": "test", "role": "user", "status": "active", "modules_unlocked": True}
            elif path.endswith("/web-connection"):
                data = current()
            elif path.endswith("/web-oauth/start"):
                state["starts"] += 1
                job_id = f"test-{state['starts']}"
                job = {"job_id": job_id, "kind": "web", "status": "AWAITING_OAUTH", "message": "Chờ cấp quyền Facebook"}
                state["jobs"][job_id] = job
                state["active"] = job
                code, data = 202, {**job, "state": "web-popup." + job_id,
                                  "previous_identity": state["current"]["identity"] if state["current"] else None,
                                  "authorization_url": "https://www.facebook.com/dialog/oauth?state=web-popup." + job_id}
            elif path.endswith("/web-oauth/complete"):
                state["completes"] += 1
                job_id = request.post_data_json["state"].split(".", 1)[1]
                job = state["jobs"][job_id]
                if state["fail_switch"]:
                    job.update(status="FAILED", error_code="SAME_FACEBOOK_IDENTITY", error="Meta vẫn trả về tài khoản Facebook Test. Hãy chọn Facebook khác.")
                    state["active"] = None
                else:
                    job.update(status="AWAITING_CONFIRMATION", identity={"id": "asid-a", "name": "Facebook Test"})
                code, data = 202, {"job_id": job_id}
            elif path.endswith("/confirm"):
                job_id = path.split("/")[-2]
                if not request.post_data_json["accept"]:
                    state["jobs"][job_id].update(status="CANCELLED", message="Đã hủy kết nối.")
                    state["active"] = None
                    route.fulfill(status=202, headers=headers, content_type="application/json", body=json.dumps({"job_id": job_id, "status": "CANCELLED"}))
                    return
                identity = {"id": "asid-a", "name": "Facebook Test"}
                state["current"] = {"connected": True, "identity": identity, "token_state": "valid_at_last_check"}
                state["jobs"][job_id].update(status="SUCCEEDED", result={"identity": identity, "message": "Đã đồng bộ Page thử nghiệm.", "count": 1})
                state["active"] = None
                code, data = 202, {"job_id": job_id, "status": "QUEUED"}
            elif path.endswith("/cancel"):
                job_id = path.split("/")[-2]
                state["jobs"][job_id].update(status="CANCELLED", message="Đã hủy kết nối.")
                state["active"] = None
                data = {"job_id": job_id, "status": "CANCELLED"}
            elif "/sync-jobs/" in path:
                data = state["jobs"][path.rsplit("/", 1)[-1]]
            elif path.endswith("/web-connection/sync"):
                job_id = "resync"
                state["jobs"][job_id] = {"job_id": job_id, "status": "SUCCEEDED", "result": {"identity": state["current"]["identity"], "message": "Đã quét lại Page."}}
                code, data = 202, {"job_id": job_id, "status": "QUEUED"}
            elif path.endswith("/pages/accounts"):
                if state["delay_accounts"]:
                    state["account_requests"].append((route, headers))
                    return
                data = {"accounts": [{"uid": "123", "profile_name": "Account UX", "has_token": True}]}
            elif path.endswith("/tokens/verify"):
                state["verify_calls"] += 1
                data = {"success": True, "results": {"123": {"status": "LIVE"}}}
            elif path.endswith("/pages/managed"):
                data = {"pages": [{"id": 1, "page_id": "42", "page_name": "Popup Test Page", "manager_kind": "web",
                                    "manager_name": "Facebook Test", "status": "SUCCESS"}] if state["current"] else []}
            route.fulfill(status=code, headers=headers, content_type="application/json", body=json.dumps(data))

        def meta(route):
            nonce = parse_qs(urlsplit(route.request.url).query)["state"][0]
            destination = BASE + "/oauth/meta/callback/#state=" + nonce + "&access_token=TEST_DUMMY_TOKEN"
            # Model Meta severing opener; coordination must use the backend job instead.
            html = "<script>window.opener=null;location.replace(" + json.dumps(destination) + ")</script>"
            route.fulfill(content_type="text/html", body=html, headers={"Cross-Origin-Opener-Policy": "same-origin"})

        context.route("**/api/**", api)
        context.route("https://www.facebook.com/**", meta)
        context.route("https://graph.facebook.com/**", lambda route: route.fulfill(status=404))
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/pages/list/?keep=1")
        page.get_by_role("button", name="+ Thêm page", exact=True).click()
        original_url = page.url
        with context.expect_page() as opened:
            page.get_by_role("button", name="Kết nối Facebook", exact=True).click()
        popup = opened.value
        popup.on("pageerror", lambda error: errors.append(str(error)))
        confirmation = popup.get_by_role("region", name="Xác nhận tài khoản Facebook")
        expect(confirmation).to_be_visible()
        expect(confirmation).to_contain_text("Facebook Test")
        expect(page.get_by_role("dialog", name="Xác nhận tài khoản Facebook")).to_have_count(0)
        assert state["account_requests"], "Account prefetch did not start"
        assert page.url == original_url
        assert not popup.is_closed(), "Popup closed before identity confirmation"
        popup.reload()
        expect(confirmation).to_be_visible()
        assert state["completes"] == 1, "Callback reload must resume the job, not consume state twice"
        with popup.expect_event("close"):
            popup.get_by_role("button", name="Chấp nhận đăng nhập").click()
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()
        expect(page.get_by_text("Thêm & Nạp Fanpage vào hệ thống", exact=True)).to_be_visible()
        assert state["verify_calls"] == 0, "Verification must wait for accounts without blocking OAuth"
        state["delay_accounts"] = False
        for pending_route, pending_headers in state["account_requests"]:
            pending_route.fulfill(headers=pending_headers, content_type="application/json", body=json.dumps({"accounts": [{"uid": "123", "profile_name": "Account UX", "has_token": True}]}))
        expect(page.get_by_text("Account UX", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Quét", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="LIVE", exact=True)).to_be_visible()
        assert state["verify_calls"] == 1, "Opening modal should verify uncached account tokens once"
        search = page.get_by_placeholder("Tìm tên hoặc UID nick...")
        search.fill("Account UX")
        page.get_by_role("button", name="Đóng", exact=True).click()
        page.get_by_role("button", name="+ Thêm page", exact=True).click()
        expect(search).to_have_value("Account UX")
        expect(page.get_by_role("button", name="LIVE", exact=True)).to_be_visible()
        assert state["verify_calls"] == 1, "Reopening must reuse the fresh token cache"
        expect(page.get_by_text("Account UX", exact=True)).to_be_visible()

        page.get_by_text("Đã kết nối: Facebook Test", exact=True).click()
        page.get_by_role("button", name="Quét lại Page", exact=True).click()
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()
        assert state["starts"] == 1, "Resync opened OAuth instead of using the stored connection"

        state["fail_switch"] = True
        page.get_by_text("Đã kết nối: Facebook Test", exact=True).click()
        with context.expect_page() as failed_popup:
            page.get_by_role("button", name="Đổi tài khoản", exact=True).click()
        failed = failed_popup.value
        expect(failed.get_by_role("heading", name="Kết nối một Facebook khác")).to_be_visible()
        failed.get_by_role("button", name="Tôi đã đổi Facebook — tiếp tục").click()
        expect(failed.get_by_role("status")).to_contain_text("Meta vẫn trả về")
        expect(failed.get_by_role("heading", name="Facebook vẫn là tài khoản cũ")).to_be_visible()
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()
        assert not failed.is_closed(), "Failure should stay visible in the popup"
        starts_before_retry = state["starts"]
        state["fail_switch"] = False
        failed.get_by_role("button", name="Tôi đã đổi Facebook — thử lại").click()
        expect(failed.get_by_role("button", name="Chấp nhận đăng nhập", exact=True)).to_be_visible()
        assert state["starts"] == starts_before_retry + 1, "Retry must create a fresh OAuth state/job"
        expect(page.get_by_role("button", name="Hủy kết nối", exact=True)).to_be_visible()
        failed.get_by_role("button", name="Hủy", exact=True).click()
        expect(failed.get_by_role("status")).to_contain_text("Đã hủy")
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()
        failed.close()

        state["fail_switch"] = False
        page.get_by_text("Đã kết nối: Facebook Test", exact=True).click()
        with context.expect_page() as cancelled_popup:
            page.get_by_role("button", name="Đổi tài khoản", exact=True).click()
        cancelled = cancelled_popup.value
        cancelled.get_by_role("button", name="Tôi đã đổi Facebook — tiếp tục").click()
        cancelled.get_by_role("button", name="Hủy", exact=True).click()
        expect(cancelled.get_by_role("status")).to_contain_text("Đã hủy")
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()
        cancelled.close()

        page.get_by_text("Đã kết nối: Facebook Test", exact=True).click()
        with context.expect_page() as abandoned_popup:
            page.get_by_role("button", name="Đổi tài khoản", exact=True).click()
        abandoned = abandoned_popup.value
        abandoned.get_by_role("button", name="Tôi đã đổi Facebook — tiếp tục").click()
        expect(abandoned.get_by_role("button", name="Chấp nhận đăng nhập", exact=True)).to_be_visible()
        abandoned.close()
        page.get_by_role("button", name="Hủy kết nối", exact=True).click()
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()

        page.evaluate("window.__originalOpen=window.open;window.open=()=>null")
        page.get_by_text("Đã kết nối: Facebook Test", exact=True).click()
        starts = state["starts"]
        page.get_by_role("button", name="Đổi tài khoản", exact=True).click()
        expect(page.get_by_role("alert").filter(has_text="chặn popup")).to_be_visible()
        assert state["starts"] == starts
        page.evaluate("window.open=window.__originalOpen")

        # Reopening the dashboard resumes the owner-bound pending attempt.
        pending = {"job_id": "reload-job", "kind": "web", "status": "AWAITING_OAUTH", "message": "Chờ cấp quyền Facebook"}
        state["jobs"]["reload-job"] = pending
        state["active"] = pending
        page.reload()
        page.get_by_role("button", name="+ Thêm page", exact=True).click()
        expect(page.get_by_role("button", name="Hủy kết nối", exact=True)).to_be_visible()
        page.get_by_role("button", name="Hủy kết nối", exact=True).click()
        expect(page.get_by_text("Đã kết nối: Facebook Test", exact=True)).to_be_visible()
        assert not errors, errors
        context.close()
        browser.close()
    print("PASS: slow accounts, automatic token checks after accounts load, cached reopen, callback confirmation/reload/cancel, popup close, lost opener, retained filters, resync, switch failure, blocked popup and reload/cancel")


if __name__ == "__main__":
    main()
