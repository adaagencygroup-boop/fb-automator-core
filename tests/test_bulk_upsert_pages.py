import json
import unittest
from unittest.mock import MagicMock, patch
from tests.test_module05_meta import IsolatedDB, META, ENV
from modules.module_05_page_manager import meta_sync as sync
from modules.module_05_page_manager import meta_web as web

class BulkUpsertTest(unittest.TestCase):
    def setUp(self):
        self.db = IsolatedDB()
        self.addCleanup(self.db.conn.close)
        self.patches = [
            patch.object(sync, 'db', self.db),
            patch.object(web, 'db', self.db),
            patch.object(sync, 'start_background_page_verification'),
            patch.dict('os.environ', ENV),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def test_sync_save_bulk_and_empty(self):
        # 1. Empty pages
        prep_empty = {
            'metadata': META,
            'identity': {'id': META['user_id'], 'name': 'Tester'},
            'token': 'tok_test',
            'pages': []
        }
        res = sync.save('a', '111', prep_empty)
        self.assertTrue(res['success'])
        self.assertEqual(res['count'], 0)
        self.assertEqual(len(self.db.fetch_all("SELECT * FROM pages WHERE user_id = 'a'")), 0)

        # 2. Multi-page bulk insert
        pages = [
            {'id': 'p2', 'name': 'Page 2', 'access_token': 'tok_p2', 'category': 'Cat2', 'token_metadata': {'is_valid': True}},
            {'id': 'p1', 'name': 'Page 1', 'access_token': 'tok_p1', 'category': 'Cat1', 'token_metadata': {'is_valid': True}},
            {'id': 'p3', 'name': 'Page 3', 'access_token': 'tok_p3', 'category': None, 'token_metadata': {}},
        ]
        prep_multi = {
            'metadata': META,
            'identity': {'id': META['user_id'], 'name': 'Tester'},
            'token': 'tok_test',
            'pages': pages
        }
        res = sync.save('a', '111', prep_multi)
        self.assertTrue(res['success'])
        self.assertEqual(res['count'], 3)
        
        rows = self.db.fetch_all("SELECT * FROM pages WHERE user_id = 'a' ORDER BY page_id ASC")
        self.assertEqual(len(rows), 3)
        self.assertEqual([r['page_id'] for r in rows], ['p1', 'p2', 'p3'])
        self.assertEqual(rows[0]['account_uid'], '111')
        self.assertIsNone(rows[0]['web_connection_id'])
        self.assertEqual(rows[0]['status'], 'ACTIVE')
        self.assertEqual(rows[0]['category'], 'Cat1')
        self.assertIn('"is_valid": true', rows[0]['token_metadata'].lower())

        # 3. Upsert update (ON CONFLICT DO UPDATE)
        pages_update = [
            {'id': 'p1', 'name': 'Page 1 Updated', 'access_token': 'tok_p1_new', 'category': 'Cat1_New', 'token_metadata': {'updated': True}}
        ]
        prep_update = {
            'metadata': META,
            'identity': {'id': META['user_id'], 'name': 'Tester'},
            'token': 'tok_test_new',
            'pages': pages_update
        }
        sync.save('a', '111', prep_update)
        p1 = self.db.fetch_one("SELECT * FROM pages WHERE user_id = 'a' AND page_id = 'p1'")
        self.assertEqual(p1['page_name'], 'Page 1 Updated')
        self.assertEqual(p1['access_token'], 'tok_p1_new')
        self.assertEqual(p1['category'], 'Cat1_New')

    def test_web_save_bulk_and_empty(self):
        # 1. Empty pages
        prep_empty = {
            'metadata': META,
            'identity': {'id': META['user_id'], 'name': 'Web Tester'},
            'token': 'tok_web',
            'pages': []
        }
        job = {'status': 'COMMITTING', 'message': ''}
        res = web._save('a', prep_empty, job)
        self.assertTrue(res['success'])
        self.assertEqual(res['count'], 0)

        # 2. Bulk pages via _sync_web
        pages = [
            {'id': 'wp1', 'name': 'Web Page 1', 'access_token': 'wtok_1', 'category': 'Community', 'token_metadata': {'is_valid': True}},
            {'id': 'wp2', 'name': 'Web Page 2', 'access_token': 'wtok_2', 'category': 'Brand', 'token_metadata': {}},
        ]
        prep_multi = {
            'metadata': META,
            'identity': {'id': META['user_id'], 'name': 'Web Tester'},
            'token': 'tok_web',
            'pages': pages
        }
        res = web._sync_web('a', prep_multi, job)
        self.assertTrue(res['success'])
        self.assertEqual(res['count'], 2)
        
        rows = self.db.fetch_all("SELECT * FROM pages WHERE page_id LIKE 'wp%' ORDER BY page_id ASC")
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0]['account_uid'])
        self.assertEqual(rows[0]['web_connection_id'], res['connection_id'])
        self.assertEqual(rows[0]['status'], 'ACTIVE')

    def test_rollback_on_failure(self):
        self.db.fail_page = True
        pages = [{'id': 'fail_p', 'name': 'Fail Page', 'access_token': 'tok', 'category': 'Cat', 'token_metadata': {}}]
        prep = {'metadata': META, 'identity': {'id': META['user_id'], 'name': 'Tester'}, 'token': 'new_tok', 'pages': pages}
        with self.assertRaises(Exception):
            sync.save('a', '111', prep)
        # Verify rollback preserved old token
        self.assertEqual(self.db.fetch_one("SELECT token FROM accounts WHERE user_id = 'a' AND uid = '111'")['token'], 'old-a')

if __name__ == '__main__':
    unittest.main()
