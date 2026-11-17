"""User notification API isolation, read persistence and authentication."""
import sqlite3
import unittest
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from auth_test_support import load_auth_modules


class NotificationCursor:
    def __init__(self, connection):
        self.cursor = connection.cursor()

    def execute(self, query, params=()):
        self.cursor.execute(query.replace("%s", "?"), params)

    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]


class NotificationDB:
    def __init__(self):
        self.connection = sqlite3.connect(":memory:", check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("""CREATE TABLE system_notifications (
            id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, target TEXT,
            message TEXT, is_read BOOLEAN, created_at TEXT, event_key TEXT UNIQUE)""")
        self.connection.execute("""CREATE TABLE user_feature_licenses (
            user_id INTEGER, feature_key TEXT, is_enabled BOOLEAN, expired_at TEXT)""")
        self.connection.executemany("INSERT INTO system_notifications (id, user_id, type, target, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            (1, 21, 'LICENSE_EXTENDED', 'user', 'Gia hạn thành công', False, '2026-11-17 01:00:00'),
            (2, 21, 'SYSTEM_UPDATE', 'user', 'Đã reset HWID', True, '2026-11-17 02:00:00'),
            (3, 22, 'ACCOUNT_ALERT', 'user', 'Thông báo người khác', False, '2026-11-17 03:00:00'),
            (4, 21, 'NEW_REGISTRATION', 'admin', 'Thông báo cho admin', False, '2026-11-17 04:00:00'),
            (5, None, 'SYSTEM_UPDATE', 'user', 'Không có người nhận', False, '2026-11-17 05:00:00'),
            (6, 21, 'SYSTEM_UPDATE', 'user', 'Thông báo chưa có cờ đọc', None, '2026-11-17 06:00:00'),
        ])
        self.connection.commit()

    @contextmanager
    def session(self):
        with self.connection:
            yield NotificationCursor(self.connection)

    def fetch_all(self, query, params=()):
        with self.connection:
            return [dict(row) for row in self.connection.execute(query, params).fetchall()]

    def fetch_one(self, query, params=()):
        rows = self.fetch_all(query, params)
        return rows[0] if rows else None

    def execute(self, query, params=()):
        with self.connection:
            self.connection.execute(query, params)


class UserNotificationsTests(unittest.TestCase):
    def setUp(self):
        self.s, self.r, _, _, _ = load_auth_modules()
        self.db = NotificationDB()
        self.addCleanup(self.db.connection.close)
        db_patch = patch.object(self.s, 'db', self.db)
        db_patch.start()
        self.addCleanup(db_patch.stop)
        self.user = {'id': 21, 'username': 'member', 'role': 'user', 'status': 'approved'}
        auth_patch = patch.object(self.r, 'bearer_user', side_effect=lambda *args, **kwargs: self.user)
        self.auth = auth_patch.start()
        self.addCleanup(auth_patch.stop)
        app = FastAPI()
        app.include_router(self.r.auth_router)
        self.client = TestClient(app)

    def test_only_current_users_messages_are_listed_newest_first(self):
        response = self.client.get('/api/v1/auth/notifications?user_id=22&target=admin')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['id'] for item in response.json()], [6, 2, 1])
        self.assertFalse(response.json()[0]['is_read'])
        self.assertTrue(response.json()[1]['is_read'])

    def test_unread_filter_excludes_read_items_and_includes_null_flags(self):
        response = self.client.get('/api/v1/auth/notifications?unread_only=true')
        self.assertEqual([item['id'] for item in response.json()], [6, 1])

    def test_read_one_persists_and_is_idempotent(self):
        for _ in range(2):
            response = self.client.put('/api/v1/auth/notifications/1/read')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['success'])
        response = self.client.get('/api/v1/auth/notifications?unread_only=true')
        self.assertEqual([item['id'] for item in response.json()], [6])

    def test_other_users_admin_and_nonexistent_notifications_cannot_be_marked(self):
        for notif_id in (3, 4, 5, 999):
            with self.subTest(notif_id=notif_id):
                self.assertEqual(self.client.put(f'/api/v1/auth/notifications/{notif_id}/read').status_code, 404)
        self.assertEqual([row['id'] for row in self.db.fetch_all('SELECT id FROM system_notifications WHERE is_read = TRUE')], [2])

    def test_read_all_affects_only_this_users_notifications(self):
        response = self.client.put('/api/v1/auth/notifications/read-all?user_id=22&target=admin')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/v1/auth/notifications?unread_only=true').json(), [])
        for notif_id in (3, 4, 5):
            self.assertFalse(self.db.fetch_one('SELECT is_read FROM system_notifications WHERE id = ?', (notif_id,))['is_read'])

    def test_expired_licenses_can_still_read_and_mark_their_messages(self):
        self.user['status'] = 'expired'
        self.assertEqual(self.client.get('/api/v1/auth/notifications').status_code, 200)
        self.assertEqual(self.client.put('/api/v1/auth/notifications/1/read').status_code, 200)

    def test_valid_session_is_required_for_every_operation(self):
        self.auth.side_effect = HTTPException(401, 'SESSION_REVOKED')
        for method, path in [('GET', '/api/v1/auth/notifications'), ('PUT', '/api/v1/auth/notifications/read-all'), ('PUT', '/api/v1/auth/notifications/1/read')]:
            with self.subTest(method=method, path=path):
                response = self.client.request(method, path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()['detail'], 'SESSION_REVOKED')

    def test_current_session_identity_controls_the_recipient(self):
        self.user = {'id': 22, 'username': 'othermember', 'role': 'user', 'status': 'approved'}
        self.assertEqual([item['id'] for item in self.client.get('/api/v1/auth/notifications').json()], [3])
        self.assertEqual(self.client.put('/api/v1/auth/notifications/1/read').status_code, 404)

    def test_empty_notification_list_is_valid(self):
        self.user['id'] = 999
        self.assertEqual(self.client.get('/api/v1/auth/notifications').json(), [])
        self.assertEqual(self.client.put('/api/v1/auth/notifications/read-all').status_code, 200)

    def test_each_expired_module_gets_one_persistent_notification_per_term(self):
        self.db.execute("INSERT INTO user_feature_licenses VALUES (21, 'create_fanpage', TRUE, '2026-11-16 01:30:00')")
        for _ in range(3):
            with patch.object(self.s, 'utcnow', return_value=datetime(2026, 11, 17, 1)):
                response = self.client.get('/api/v1/auth/notifications')
            expired = [item for item in response.json() if item['type'] == 'MODULE_EXPIRED']
            self.assertEqual(len(expired), 1)
            self.assertIn('Tạo Fanpage hàng loạt', expired[0]['message'])
            self.assertIn('08:30 ngày 16/11/2026', expired[0]['message'])
        self.assertEqual(self.client.put(f'/api/v1/auth/notifications/{expired[0]["id"]}/read').status_code, 200)
        self.assertEqual(len([item for item in self.client.get('/api/v1/auth/notifications?unread_only=true').json() if item['type'] == 'MODULE_EXPIRED']), 0)
        self.db.execute("UPDATE user_feature_licenses SET expired_at = '2026-11-17 01:30:00'")
        with patch.object(self.s, 'utcnow', return_value=datetime(2026, 11, 18)):
            response = self.client.get('/api/v1/auth/notifications')
        self.assertEqual(len([item for item in response.json() if item['type'] == 'MODULE_EXPIRED']), 2)

    def test_active_disabled_and_other_users_modules_do_not_create_expiry_events(self):
        for row in [(21, 'create_fanpage', True, '2099-01-01'), (21, 'spam_group', False, '2026-01-01'), (22, 'scan_group', True, '2026-01-01')]:
            self.db.execute('INSERT INTO user_feature_licenses VALUES (?, ?, ?, ?)', row)
        response = self.client.get('/api/v1/auth/notifications')
        self.assertFalse(any(item['type'] == 'MODULE_EXPIRED' for item in response.json()))
