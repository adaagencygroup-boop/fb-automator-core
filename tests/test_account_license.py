"""License policy and service transactions against an isolated in-memory database."""
import sqlite3
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import HTTPException
from auth_test_support import load_auth_modules
from modules.module_auth.license_policy import account_license_expiry


class Cursor:
    def __init__(self, connection):
        self.cursor = connection.cursor()

    def execute(self, query, params=()):
        self.cursor.execute(query.replace("%s", "?").replace(" FOR UPDATE", ""), params)

    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row is not None else None

    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]


class TestDB:
    def __init__(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT,
                contact_info TEXT, hwid TEXT, role TEXT, status TEXT, created_at TIMESTAMP, expired_at TIMESTAMP);
            CREATE TABLE system_features (feature_key TEXT PRIMARY KEY, feature_name TEXT, order_index INT, is_active BOOLEAN);
            CREATE TABLE user_feature_licenses (user_id INTEGER REFERENCES users(id),
                feature_key TEXT REFERENCES system_features(feature_key), is_enabled BOOLEAN,
                days_granted INTEGER, expired_at TIMESTAMP, updated_at TIMESTAMP,
                UNIQUE(user_id, feature_key));
            CREATE TABLE system_notifications (id INTEGER PRIMARY KEY, user_id INTEGER,
                type TEXT, target TEXT, message TEXT, is_read BOOLEAN, created_at TIMESTAMP, event_key TEXT UNIQUE);
        """)
        for order, key in enumerate(['fb_account', 'create_fanpage', 'spam_group', 'scan_group']):
            self.connection.execute("INSERT INTO system_features VALUES (?, ?, ?, TRUE)", (key, key, order))
        self.connection.commit()

    @contextmanager
    def session(self):
        with self.connection:
            yield Cursor(self.connection)

    def execute(self, query, params=()):
        with self.session() as cursor:
            cursor.execute(query, params)

    def fetch_one(self, query, params=()):
        with self.session() as cursor:
            cursor.execute(query, params)
            return cursor.fetchone()

    def fetch_all(self, query, params=()):
        with self.session() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall()


class AccountLicenseTests(unittest.TestCase):
    def setUp(self):
        self.s, self.r, _, _, _ = load_auth_modules()
        self.db = TestDB()
        self.now = datetime(2026, 11, 17, 5, 0, 0)
        self.db_patch = patch.object(self.s, "db", self.db)
        self.clock_patch = patch.object(self.s, "utcnow", side_effect=lambda: self.now)
        self.db_patch.start()
        self.clock_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.clock_patch.stop)
        self.addCleanup(self.db.connection.close)
        with patch.object(self.s, "publish"):
            self.result = self.s.register_user("trialuser", "Secure1!", "0987654321", "test-hwid")
        self.uid = self.result['user_id']

    def term(self, key='fb_account'):
        row = self.db.fetch_one("SELECT * FROM user_feature_licenses WHERE user_id = ? AND feature_key = ?", (self.uid, key))
        return self.s._as_dt(row['expired_at'])

    def user(self):
        return self.db.fetch_one("SELECT * FROM users WHERE id = ?", (self.uid,))

    def grant(self, key, days):
        return self.s.sync_user_feature_licenses(self.uid, [{'key': key, 'days': days, 'enabled': True}])

    def test_registration_is_immediately_approved_for_only_the_free_module(self):
        self.assertEqual(self.result['status'], 'approved')
        self.assertEqual(self.term(), self.now + timedelta(days=30))
        self.assertEqual(self.s.public_user(self.user())['permissions'], ['fb_account'])
        self.assertTrue(self.s.licensed_for_modules(self.user(), 'fb_account'))
        self.assertFalse(self.s.licensed_for_modules(self.user(), 'spam_group'))

    def test_sixty_then_ninety_days_gives_one_hundred_twenty_days(self):
        signup = self.now
        self.grant('create_fanpage', 60)
        self.assertEqual(self.term(), signup + timedelta(days=90))
        self.grant('spam_group', 90)
        self.assertEqual(self.term(), signup + timedelta(days=120))
        self.now = signup + timedelta(days=90)
        profile = self.s.public_user(self.user())
        self.assertEqual(profile['permissions'], ['fb_account'])
        self.assertEqual(profile['days_remaining'], 30)
        self.assertEqual(next(f for f in profile['features'] if f['key'] == 'fb_account')['days_remaining'], 30)
        self.now = signup + timedelta(days=120)
        self.assertFalse(self.s.licensed_for_modules(self.user(), 'fb_account'))

    def test_trial_registration_creates_an_approval_message_for_the_user(self):
        notes = self.db.fetch_all("SELECT * FROM system_notifications WHERE target = 'user'")
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]['type'], 'ACCOUNT_APPROVED')
        self.assertIn('30 ngày', notes[0]['message'])

    def test_module_messages_use_its_own_name_and_expiry_not_the_account_grace_term(self):
        self.grant('create_fanpage', 60)
        self.now += timedelta(days=1)
        self.grant('create_fanpage', 90)
        notes = self.db.fetch_all("SELECT * FROM system_notifications WHERE type = 'MODULE_RENEWED'")
        paid = [item for item in notes if 'Tạo Fanpage hàng loạt' in item['message']]
        self.assertEqual(len(paid), 1)
        expected = (self.now + timedelta(days=90, hours=7)).strftime('%H:%M ngày %d/%m/%Y')
        self.assertIn(expected, paid[0]['message'])
        count = len(self.db.fetch_all('SELECT * FROM system_notifications'))
        self.s.sync_user_feature_licenses(self.uid, [])
        self.s.sync_user_feature_licenses(self.uid, [{'key': 'create_fanpage', 'days': 90, 'enabled': True}])
        self.assertEqual(len(self.db.fetch_all('SELECT * FROM system_notifications')), count)

    def test_renewing_after_expiry_preserves_one_notice_of_the_previous_expiration(self):
        self.grant('spam_group', 60)
        self.now += timedelta(days=61)
        self.grant('spam_group', 90)
        self.s.sync_user_feature_licenses(self.uid, [])
        notes = self.db.fetch_all("SELECT * FROM system_notifications WHERE type = 'MODULE_EXPIRED'")
        expired_group = [item for item in notes if 'Spam Group Hội Nhóm' in item['message']]
        self.assertEqual(len(expired_group), 1)
        self.assertTrue(any('Spam Group Hội Nhóm' in item['message'] for item in self.db.fetch_all("SELECT * FROM system_notifications WHERE type = 'MODULE_RENEWED'")))

    def test_shortening_a_module_is_an_update_instead_of_a_renewal(self):
        self.grant('spam_group', 90)
        self.grant('spam_group', 20)
        notes = self.db.fetch_all("SELECT * FROM system_notifications WHERE type = 'MODULE_UPDATED'")
        self.assertEqual(len(notes), 1)
        self.assertIn('Spam Group Hội Nhóm', notes[0]['message'])

    def test_short_module_adds_grace_and_edit_scales_both_up_and_down(self):
        signup = self.now
        self.grant('create_fanpage', 10)
        self.assertEqual(self.term(), signup + timedelta(days=40))
        self.grant('create_fanpage', 90)
        self.grant('spam_group', 60)
        self.grant('create_fanpage', 20)
        self.assertEqual(self.term(), signup + timedelta(days=90))

    def test_later_purchase_is_anchored_to_its_actual_purchase_date(self):
        signup = self.now
        self.now += timedelta(days=20)
        self.grant('spam_group', 90)
        self.assertEqual(self.term(), signup + timedelta(days=140))

    def test_no_purchase_expires_after_thirty_days_without_rolling_forward(self):
        expiry = self.term()
        self.now += timedelta(days=31)
        self.s.sync_user_feature_licenses(self.uid, [])
        self.assertEqual(self.term(), expiry)
        self.assertEqual(self.user()['status'], 'expired')

    def test_forged_account_days_and_disabled_flag_are_ignored(self):
        self.grant('spam_group', 90)
        expiry = self.term()
        self.s.sync_user_feature_licenses(self.uid, [{'key': 'fb_account', 'days': 9999, 'enabled': False}])
        self.assertEqual(self.term(), expiry)
        self.assertTrue(self.s.licensed_for_modules(self.user(), 'fb_account'))

    def test_unchanged_modules_and_profile_edits_do_not_renew_terms(self):
        signup = self.now
        self.grant('spam_group', 90)
        self.now += timedelta(days=10, hours=1)
        self.s.sync_user_feature_licenses(self.uid, [{'key': 'spam_group', 'days': 80, 'enabled': True}])
        self.assertEqual(self.term('spam_group'), signup + timedelta(days=90))
        with patch.object(self.s, '_actor', return_value=({'username': 'admin'}, None, '')), patch.object(self.s, 'log_activity'):
            self.s.edit_user_admin(self.uid, {'contact_info': '0900000000', 'features': [], 'days': 9999}, None)
        self.assertEqual(self.term(), signup + timedelta(days=120))

    def test_renewal_after_expiration_reactivates_the_free_module(self):
        self.now += timedelta(days=150)
        with patch.object(self.s, '_actor', return_value=({'username': 'admin'}, None, '')), patch.object(self.s, 'log_activity'):
            self.s.extend_user(self.uid, 90, None, features=[{'key': 'spam_group', 'days': 90, 'enabled': True}])
        self.assertEqual(self.term(), self.now + timedelta(days=120))
        self.assertEqual(self.user()['status'], 'approved')

    def test_cancelling_the_last_paid_module_starts_a_fixed_thirty_day_grace(self):
        self.grant('spam_group', 90)
        self.now += timedelta(days=45)
        self.s.sync_user_feature_licenses(self.uid, [{'key': 'spam_group', 'enabled': False, 'days': 0}])
        expiry = self.now + timedelta(days=30)
        self.assertEqual(self.term(), expiry)
        self.now += timedelta(days=10)
        self.s.sync_user_feature_licenses(self.uid, [{'key': 'spam_group', 'enabled': False, 'days': 0}])
        self.assertEqual(self.term(), expiry)

    def test_approving_and_admin_creating_users_obey_the_automatic_term(self):
        with patch.object(self.s, '_actor', return_value=({'username': 'admin'}, None, '')), patch.object(self.s, 'log_activity'):
            result = self.s.create_user_admin('anotheruser', 'Secure1!', '0987654321', 90, 'approved', 'user', None,
                features=[{'key': 'spam_group', 'days': 90, 'enabled': True}, {'key': 'fb_account', 'days': 999, 'enabled': False}])
            self.assertEqual(result['days_remaining'], 120)
            self.db.execute("UPDATE users SET status = 'pending' WHERE id = ?", (self.uid,))
            self.s.approve_user(self.uid, 60, None, features=[{'key': 'spam_group', 'days': 60, 'enabled': True}])
            self.assertEqual(self.term(), self.now + timedelta(days=90))
            self.assertEqual(self.user()['status'], 'approved')

    def test_feature_and_account_updates_rollback_together(self):
        before = self.term()
        note_count = len(self.db.fetch_all('SELECT * FROM system_notifications'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.sync_user_feature_licenses(self.uid, [
                {'key': 'spam_group', 'days': 90, 'enabled': True},
                {'key': 'unknown_feature', 'days': 900, 'enabled': True}])
        self.assertEqual(self.term(), before)
        self.assertIsNone(self.db.fetch_one("SELECT * FROM user_feature_licenses WHERE feature_key = 'spam_group'"))
        self.assertEqual(len(self.db.fetch_all('SELECT * FROM system_notifications')), note_count)

    def test_expired_module_cannot_be_used_during_the_account_grace_period(self):
        self.grant('spam_group', 60)
        self.now += timedelta(days=61)
        with patch.object(self.r, 'bearer_user', side_effect=lambda _: self.user()):
            self.assertEqual(self.r.assert_request_module_access('token', '/api/accounts', 'GET')['id'], self.uid)
            for path in ['/api/groups/post', '/api/creator/tasks/start', '/api/post/start', '/api/page-scanner/search']:
                with self.subTest(path=path), self.assertRaises(HTTPException) as error:
                    self.r.assert_request_module_access('token', path, 'POST')
                self.assertEqual(error.exception.detail, 'LICENSE_REQUIRED')

    def test_policy_ignores_managed_and_disabled_rows_and_understands_utc(self):
        self.assertEqual(account_license_expiry('2026-11-17T12:00:00+07:00', [
            {'key': 'fb_account', 'is_enabled': True, 'expired_at': '2099-01-01'},
            {'key': 'spam_group', 'is_enabled': False, 'expired_at': '2099-01-01'},
        ]), datetime(2026, 12, 17, 5))
