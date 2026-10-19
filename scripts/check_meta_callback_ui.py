"""Callback smoke tests against a built frontend; all API traffic is intercepted."""
import json
import sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8788"


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context()
        page = context.new_page()
        requests, errors = [], []
        state = {"confirmation": False, "denied": False, "session": True}
        page.on("pageerror", lambda error: errors.append(str(error)))

        def intercept(route):
            request = route.request
            headers = {"Access-Control-Allow-Origin": BASE, "Access-Control-Allow-Credentials": "true",
                       "Access-Control-Allow-Headers": "content-type,x-auth-client,x-auth-user-id",
                       "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}
            if request.method == "OPTIONS":
                route.fulfill(status=204, headers=headers)
                return
            if any(request.url.endswith(suffix) for suffix in ("/auth/me", "/sync-by-token", "/confirm", "/sync-jobs/test-job")):
                requests.append((request.method, request.url, request.post_data_json))
            status, payload = 200, {}
            if request.url.endswith("/auth/me"):
                payload = {"id": "a", "username": "test"}
                if not state["session"]:
                    status, payload = 403, {"detail": "Phiên đăng nhập đã hết hạn."}
            elif request.url.endswith("/sync-by-token"):
                status, payload = 202, {"job_id": "test-job"}
                if state["denied"]:
                    status, payload = 400, {"detail": "Người dùng đã hủy hoặc từ chối quyền OAuth."}
            elif request.url.endswith("/confirm"):
                state["confirmation"] = True
                status, payload = 202, {"job_id": "test-job", "status": "QUEUED"}
            elif request.url.endswith("/sync-jobs/test-job"):
                payload = {"status": "AWAITING_CONFIRMATION", "account_uid": "111",
                           "identity": {"id": "app-scoped-id", "name": "Facebook Test"}, "message": "Xác nhận liên kết"}
                if state["confirmation"]:
                    payload = {"status": "SUCCEEDED", "result": {"message": "Đã đồng bộ Page thử nghiệm."}}
            else:
                payload = {}
            route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(payload))

        page.route("**/api/**", intercept)
        fragment = "#state=profile.test&access_token=TEST_DUMMY_TOKEN"
        page.goto(BASE + "/oauth/meta/callback/" + fragment)
        expect(page.get_by_role("status")).to_contain_text("Worker đang xử lý")
        assert page.url.endswith(fragment), "Profile callback changed the fragment"
        assert requests == [], "Profile callback attempted to use the app session or submit a token"

        dialogs = []
        def confirm(dialog):
            dialogs.append(dialog.message)
            dialog.accept()
        page.on("dialog", confirm)
        page.goto(BASE + "/oauth/meta/callback/#state=web.test&access_token=TEST_DUMMY_TOKEN")
        page.wait_for_url("**/pages/list*")
        assert "#" not in page.url
        assert dialogs and "Facebook Test" in dialogs[0] and "111" in dialogs[0]
        assert [url.rsplit("/", 1)[-1] for _, url, _ in requests][:2] == ["me", "sync-by-token"]
        assert requests[1][2]["state"] == "web.test"

        requests.clear()
        state["denied"] = True
        page.goto(BASE + "/oauth/meta/callback/#state=web.denied&error=access_denied")
        expect(page.get_by_role("status")).to_contain_text("từ chối quyền OAuth")
        assert len(requests) == 2 and "#" not in page.url

        requests.clear()
        state["session"] = False
        page.goto(BASE + "/oauth/meta/callback/#state=web.expired&access_token=TEST_DUMMY_TOKEN")
        expect(page.get_by_role("status")).to_contain_text("Phiên đăng nhập đã hết hạn")
        assert len(requests) == 1, "Token was submitted without a valid app session"
        assert errors == [], errors
        browser.close()
    print("PASS: profile fragment, web session, identity confirmation, denial and expired session")


if __name__ == "__main__":
    main()
