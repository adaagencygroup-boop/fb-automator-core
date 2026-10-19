"""Token auto-check regressions against a served frontend/out; all APIs are mocked."""
import json
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8788"
CACHE_KEY = "fb_token_verify_cache_v1:owner-a"
ACCOUNTS = [
    {"uid": "123", "profile_name": "Account A", "has_token": True},
    {"uid": "456", "profile_name": "Account B", "has_token": True},
    {"uid": "789", "profile_name": "No token", "has_token": False},
]


def run_case(browser, name, check, cache=None, **options):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.route_web_socket("**/ws/logs", lambda socket: None)
    if cache:
        context.add_init_script("localStorage.setItem(" + json.dumps(CACHE_KEY) + ", JSON.stringify(" + cache + "))")
    state = {"calls": [], "pending": [], "hold": False, "failure": False,
             "accounts_error": False, "accounts": ACCOUNTS, **options}
    errors = []

    def fulfill(route, data, code=200):
        headers = {
            "Access-Control-Allow-Origin": BASE, "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "content-type,x-auth-client,x-auth-user-id",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        }
        if code == 204:
            route.fulfill(status=204, headers=headers)
        else:
            route.fulfill(status=code, content_type="application/json", body=json.dumps(data), headers=headers)

    def api(route):
        path = urlsplit(route.request.url).path
        if route.request.method == "OPTIONS":
            fulfill(route, {}, 204)
        elif path.endswith("/auth/me"):
            fulfill(route, {"id": "owner-a", "username": "test", "role": "user", "status": "active", "modules_unlocked": True})
        elif path.endswith("/pages/accounts"):
            fulfill(route, {"detail": "offline"} if state["accounts_error"] else {"accounts": state["accounts"]},
                    500 if state["accounts_error"] else 200)
        elif path.endswith("/tokens/verify"):
            uids = route.request.post_data_json["account_uids"]
            state["calls"].append(uids)
            if state["hold"]:
                state["pending"].append(route)
            elif state["failure"]:
                route.abort("failed")
            else:
                fulfill(route, {"success": True, "results": {uid: {"status": "LIVE"} for uid in uids}})
        elif path.endswith("/oauth-by-profile"):
            fulfill(route, {"job_id": "renew"}, 202)
        elif path.endswith("/sync-jobs/renew"):
            fulfill(route, {"status": "SUCCEEDED", "result": {"success": True, "count": 0, "message": "Renewed"}})
        elif path.endswith("/web-connection"):
            fulfill(route, {"connected": False, "active_job": None})
        else:
            fulfill(route, {"pages": []})

    context.route("**/api/**", api)
    context.route("https://graph.facebook.com/**", lambda route: route.fulfill(status=404))
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE + "/pages/list/")
    page.get_by_role("button", name="+ Thêm page", exact=True).click()
    check(page, state, fulfill)
    assert not errors, errors
    context.close()
    print("PASS:", name)


def reopen(page):
    page.get_by_role("button", name="Đóng", exact=True).click()
    page.get_by_role("button", name="+ Thêm page", exact=True).click()


def row(page, name):
    return page.get_by_role("row").filter(has_text=name)


def quiet(page):
    expect(page.get_by_text("Check xong:", exact=False)).to_have_count(0)
    expect(page.get_by_text("Lỗi kiểm tra Token Meta:", exact=False)).to_have_count(0)
    expect(page.get_by_text("Không có tài khoản nào có Token để kiểm tra.", exact=True)).to_have_count(0)


def cached(page, state, fulfill):
    expect(page.get_by_role("button", name="LIVE", exact=True)).to_have_count(2)
    reopen(page)
    expect(page.get_by_role("button", name="LIVE", exact=True)).to_have_count(2)
    assert state["calls"] == []
    quiet(page)


def partial(page, state, fulfill):
    expect(page.get_by_role("button", name="LIVE", exact=True)).to_have_count(2)
    assert state["calls"] == [["456"]]
    quiet(page)


def in_flight(page, state, fulfill):
    expect(page.get_by_text("Check...", exact=True)).to_have_count(2)
    assert state["calls"] == [["123", "456"]]
    page.get_by_placeholder("Tìm tên hoặc UID nick...").fill("Account A")
    reopen(page)
    expect(page.get_by_text("Check...", exact=True)).to_have_count(1)
    assert len(state["calls"]) == 1
    # OAuth can finish while verification is pending. Its LIVE result must win.
    row(page, "Account A").get_by_role("button", name="Cấp Token", exact=True).click()
    expect(row(page, "Account A").get_by_role("button", name="LIVE", exact=True)).to_be_visible()
    page.get_by_placeholder("Tìm tên hoặc UID nick...").fill("")
    for request in state["pending"]:
        fulfill(request, {"success": True, "results": {"123": {"status": "EXPIRED"}, "456": {"status": "RATE_LIMITED"}}})
    state["pending"].clear()
    expect(row(page, "Account B").get_by_role("button", name="Rate Limit", exact=True)).to_be_visible()
    expect(row(page, "Account A").get_by_role("button", name="LIVE", exact=True)).to_be_visible()
    assert len(state["calls"]) == 1, "Account refresh or token results repeated the automatic pass"
    reopen(page)
    expect(row(page, "Account B").get_by_role("button", name="Rate Limit", exact=True)).to_be_visible()
    assert len(state["calls"]) == 1
    quiet(page)
    # Manual checks still force a request and reopening must not overwrite CHECKING with cache.
    row(page, "Account A").get_by_role("button", name="LIVE", exact=True).click()
    expect(row(page, "Account A").get_by_text("Check...", exact=True)).to_be_visible()
    reopen(page)
    expect(row(page, "Account A").get_by_text("Check...", exact=True)).to_be_visible()
    assert state["calls"] == [["123", "456"], ["123"]]
    fulfill(state["pending"].pop(), {"success": True, "results": {"123": {"status": "EXPIRED"}}})
    expect(row(page, "Account A").get_by_role("button", name="HẾT HẠN", exact=True)).to_be_visible()


def network_error(page, state, fulfill):
    expect(page.get_by_role("button", name="Lỗi kiểm tra", exact=True)).to_have_count(2)
    page.get_by_placeholder("Tìm tên hoặc UID nick...").fill("Account A")
    expect(page.get_by_role("button", name="Lỗi kiểm tra", exact=True)).to_have_count(1)
    quiet(page)
    assert len(state["calls"]) == 1
    state["failure"] = False
    reopen(page)
    expect(page.get_by_role("button", name="LIVE", exact=True)).to_have_count(1)
    assert state["calls"] == [["123", "456"], ["123", "456"]], "Filters must not restrict verification"
    quiet(page)


def account_error(page, state, fulfill):
    expect(page.get_by_role("button", name="Thử lại", exact=True)).to_be_visible()
    assert not state["calls"]
    state["accounts_error"] = False
    page.get_by_role("button", name="Thử lại", exact=True).click()
    expect(page.get_by_role("button", name="LIVE", exact=True)).to_have_count(2)
    assert len(state["calls"]) == 1


def no_token(page, state, fulfill):
    expect(page.get_by_text("No token", exact=True)).to_be_visible()
    reopen(page)
    expect(page.get_by_text("No token", exact=True)).to_be_visible()
    assert not state["calls"]
    quiet(page)


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        run_case(browser, "full fresh cache", cached, cache="{'123': {status:'LIVE',timestamp:Date.now()}, '456': {status:'LIVE',timestamp:Date.now()}}")
        run_case(browser, "partial cache", partial, cache="{'123': {status:'LIVE',timestamp:Date.now()}}")
        run_case(browser, "expired cache", partial, cache="{'123': {status:'LIVE',timestamp:Date.now()}, '456': {status:'LIVE',timestamp:Date.now()-900000}}")
        run_case(browser, "in-flight reopen, OAuth revision, rate limit and manual verification", in_flight, hold=True)
        run_case(browser, "network failure and filtered reopen", network_error, failure=True)
        run_case(browser, "account failure and retry", account_error, accounts_error=True)
        run_case(browser, "no tokens", no_token, accounts=[ACCOUNTS[2]])
        browser.close()


if __name__ == "__main__":
    main()
