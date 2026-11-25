import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from modules.module_13_profile_scan import engine


def _target(tid, key):
    return {"id": tid, "profile_key": key, "source_keys": ["group:1"]}


class DuplicateTests(unittest.TestCase):
    def setUp(self):
        self.run_ = engine.Run(1, "o", {}, [])
        self.run_.log = MagicMock()
        self.done = {}
        self.status = {}
        self.deep = []
        self.fail = set()
        m = self.models = MagicMock()
        m.done_in_session.side_effect = lambda s, uid, tid: any(u == uid and t != tid for t, u in self.done.items())
        m.finish_target.side_effect = self._finish
        for p in (patch.object(engine, "models", m), patch.object(engine.reader, "read_profile", self._read)):
            p.start()
            self.addCleanup(p.stop)

    def _finish(self, tid, status, uid=None, reason=None, **_):
        self.status[tid] = status
        if status == "DONE":
            self.done[tid] = uid

    def _read(self, driver, key, own, stop, accept):
        data = {"uid": "123", "name": "An"}
        reason = accept(data)
        if reason:
            raise engine.reader.ProfileSkipped(reason)
        self.deep.append(key)
        time.sleep(0.3)
        if key in self.fail:
            raise RuntimeError("x")
        return data

    def _scan(self, target):
        try:
            self.run_._scan_one(None, "A", target)
        except (RuntimeError, engine.reader.Stopped) as exc:
            if not isinstance(exc, engine.reader.Stopped) and str(exc) != "x":
                raise

    def test_one_after_another(self):
        self._scan(_target(1, "id:123"))
        self._scan(_target(2, "user:an"))
        self.assertEqual(self.status, {1: "DONE", 2: "SKIPPED"})
        self.assertEqual(self.deep, ["id:123"])
        self.models.link_profile.assert_called_once_with("o", "123", ["group:1"])
        self.assertEqual(self.run_._scanning, {})

    def _parallel(self):
        threads = [threading.Thread(target=self._scan, args=(t,)) for t in (_target(1, "id:123"), _target(2, "user:an"))]
        for t in threads:
            t.start()
            time.sleep(0.05)
        for t in threads:
            t.join(5)

    def test_two_threads(self):
        self._parallel()
        self.assertEqual(self.status, {1: "DONE", 2: "SKIPPED"})
        self.assertEqual(self.deep, ["id:123"])

    def test_other_thread_failed(self):
        self.fail.add("id:123")
        self._parallel()
        self.assertEqual(self.status, {2: "DONE"})
        self.assertEqual(self.run_._scanning, {})


if __name__ == "__main__":
    unittest.main()
