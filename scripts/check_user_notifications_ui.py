"""User bell smoke tests against mocked responses; never writes production data."""
import copy
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3097'
ARTIFACTS = Path(__file__).resolve().parents[1] / 'temp'


def main():
    with sync_playwright() as p:
        expect.set_options(timeout=15000)
        browser = p.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        now = datetime.now(timezone.utc)
        user = dict(id=21, username='preview_user', role='user', status='approved', modules_unlocked=True,
                    created_at=now.isoformat(), expired_at=(now + timedelta(days=30)).isoformat(), features=[], permissions=[])
        state = {
            'items': [
                dict(id=3, type='MODULE_RENEWED', message='Admin đã gia hạn module Tạo Fanpage thêm 90 ngày.', is_read=False, created_at='2026-11-17 01:00:00'),
                dict(id=2, type='ACCOUNT_APPROVED', message='Tài khoản của bạn đã được phê duyệt.', is_read=False, created_at='2026-11-17T02:00:00Z'),
                dict(id=1, type='MODULE_EXPIRED', message='Module Quét nhóm đã hết hạn. Vui lòng liên hệ Admin để gia hạn.', is_read=True, created_at='2026-11-16T02:00:00Z'),
            ],
            'fail_get': False, 'missing_api': False, 'fail_write': False, 'hold_get': False, 'pending': [], 'writes': [],
        }
        errors = []

        def fulfill(route, data, status=200):
            route.fulfill(status=status, content_type='application/json', body=json.dumps(data), headers={
                'Access-Control-Allow-Origin': BASE_URL, 'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
            })

        def api(route):
            request = route.request
            path = urlparse(request.url).path
            if request.method == 'OPTIONS':
                fulfill(route, {})
                return
            if '/auth/notifications' in path:
                if request.method == 'GET':
                    if state['missing_api']:
                        fulfill(route, {'detail': 'Not Found'}, 404)
                    elif state['fail_get']:
                        fulfill(route, {'detail': 'Temporary failure'}, 503)
                    elif state['hold_get']:
                        state['pending'].append((route, copy.deepcopy(state['items'])))
                    else:
                        fulfill(route, state['items'])
                elif request.method == 'PUT':
                    state['writes'].append(path)
                    if state['fail_write']:
                        fulfill(route, {'detail': 'Temporary failure'}, 503)
                    else:
                        read_all = path.endswith('/read-all')
                        notif_id = None if read_all else int(path.split('/')[-2])
                        for item in state['items']:
                            if read_all or item['id'] == notif_id:
                                item['is_read'] = True
                        fulfill(route, {'success': True})
                return
            if path.endswith('/auth/me'):
                fulfill(route, user)
            elif 'history' in path:
                fulfill(route, [])
            else:
                fulfill(route, {})

        context.route('**/api/**', api)
        page = context.new_page()
        page.route_web_socket('**/ws/logs', lambda ws: None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install()
        page.goto(BASE_URL)
        bell = page.get_by_role('button', name='Thông báo', exact=True)
        count = page.get_by_test_id('user-notification-count')
        expect(count).to_have_text('2')
        bell.click()
        panel = page.get_by_role('dialog', name='Thông báo của bạn', exact=True)
        expect(panel).to_be_visible()
        expect(panel.locator('li')).to_have_count(3)
        for title in ('Tài khoản được phê duyệt', 'Module được gia hạn', 'Module hết hạn'):
            expect(panel.get_by_text(title, exact=True)).to_be_visible()
        expect(panel.get_by_text('08:00:00 - 17/11/2026', exact=True)).to_be_visible()
        ARTIFACTS.mkdir(exist_ok=True)
        page.screenshot(path=str(ARTIFACTS / 'user-notifications-desktop.png'), full_page=True)
        panel.get_by_role('button', name='Chưa đọc', exact=True).click()
        expect(panel.locator('li')).to_have_count(2)
        panel.get_by_role('button', name='Đánh dấu đã đọc: Admin đã gia hạn module Tạo Fanpage thêm 90 ngày.', exact=True).click()
        expect(count).to_have_text('1')
        expect(panel.locator('li')).to_have_count(1)
        print('PASS: bell opens, unread filter/count work, user timezone is correct and reading one persists', flush=True)

        # A GET that began before the write must not restore stale unread flags.
        state['hold_get'] = True
        panel.get_by_role('button', name='Làm mới thông báo', exact=True).click()
        page.wait_for_timeout(100)
        assert state['pending'], 'Expected a held refresh request'
        panel.get_by_role('button', name='Đánh dấu đã đọc: Tài khoản của bạn đã được phê duyệt.', exact=True).click()
        expect(count).to_have_count(0)
        for route, snapshot in state['pending']:
            fulfill(route, snapshot)
        state['pending'].clear()
        state['hold_get'] = False
        expect(panel.get_by_text('Bạn đã đọc hết thông báo.', exact=True)).to_be_visible()
        expect(count).to_have_count(0)
        print('PASS: an older refresh cannot undo a successful mark-as-read', flush=True)

        panel.get_by_role('button', name='Tất cả', exact=True).click()
        expect(panel.locator('li')).to_have_count(3)
        page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        expect(bell).to_be_focused()
        state['items'].append(dict(id=4, type='SYSTEM_UPDATE', message='Thông báo mới từ hệ thống.', is_read=False, created_at=now.isoformat()))
        page.clock.fast_forward(31000)
        expect(count).to_have_text('1')
        bell.click()
        expect(panel.get_by_text('Thông báo mới từ hệ thống.', exact=True)).to_be_visible()
        state['fail_write'] = True
        panel.get_by_role('button', name='Đánh dấu tất cả đã đọc', exact=True).click()
        expect(panel.get_by_role('alert')).to_contain_text('Không đánh dấu đã đọc được')
        expect(count).to_have_text('1')
        state['fail_write'] = False
        panel.get_by_role('button', name='Đánh dấu tất cả đã đọc', exact=True).click()
        expect(count).to_have_count(0)
        print('PASS: background refresh updates badge; failed writes preserve unread state; read-all succeeds', flush=True)

        page.reload()
        bell.click()
        expect(panel.locator('li')).to_have_count(4)
        expect(count).to_have_count(0)
        state['fail_get'] = True
        panel.get_by_role('button', name='Làm mới thông báo', exact=True).click()
        expect(panel.get_by_role('alert')).to_contain_text('Không tải được thông báo')
        expect(panel.locator('li')).to_have_count(4)
        state['fail_get'] = False
        panel.get_by_role('button', name='Thử lại', exact=True).click()
        expect(panel.get_by_role('alert')).to_have_count(0)
        state['missing_api'] = True
        panel.get_by_role('button', name='Làm mới thông báo', exact=True).click()
        expect(panel.get_by_role('alert')).to_contain_text('khởi động lại engine')
        state['missing_api'] = False
        panel.get_by_role('button', name='Thử lại', exact=True).click()
        expect(panel.get_by_role('alert')).to_have_count(0)
        page.get_by_role('heading', name='Tổng quan FB Automation', exact=True).click()
        expect(panel).to_have_count(0)
        print('PASS: read state survives reload, load failures are visible/retryable and outside click closes panel', flush=True)

        page.set_viewport_size({'width': 390, 'height': 844})
        bell.click()
        expect(panel).to_be_visible()
        box = panel.bounding_box()
        assert box['x'] >= 0 and box['x'] + box['width'] <= 390, box
        page.screenshot(path=str(ARTIFACTS / 'user-notifications-mobile.png'), full_page=True)
        panel.get_by_role('button', name='Đóng thông báo', exact=True).click()
        expect(panel).to_have_count(0)
        state['items'] = []
        bell.click()
        expect(panel.get_by_text('Bạn chưa có thông báo.', exact=True)).to_be_visible()
        print('PASS: mobile layout, explicit close and empty state work', flush=True)
        assert not errors, errors
        assert all('/api/v1/auth/notifications/' in path for path in state['writes']), state['writes']
        print('PASS: no runtime errors or admin notification API calls', flush=True)
        browser.close()


if __name__ == '__main__':
    main()
