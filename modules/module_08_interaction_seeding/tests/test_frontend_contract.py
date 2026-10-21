"""
Giao diện và backend phải khớp nhau: tên trường gửi lên khi tạo chiến dịch, và mọi API mà service.js gọi.
(Lỗi kiểu giao diện gửi min_delay_sec trong khi backend đọc delay_seconds_min sẽ bị bắt ở đây.)
"""
import re
import unittest
from pathlib import Path

from .helpers import R

FRONTEND = Path(__file__).resolve().parents[3] / "frontend/src/modules/module_08_interaction_seeding"
PAGES = ["seeding-page/page.jsx", "seeding-profile/page.jsx", "seeding-post/page.jsx"]


def payload_keys(source: str) -> set[str]:
    """Tên các trường cấp ngoài cùng trong object truyền vào seedingApi.createSeedingCampaign({...})."""
    start = source.index("createSeedingCampaign({") + len("createSeedingCampaign(")
    depth, keys, token = 0, set(), ""
    for ch in source[start:]:
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
            if depth == 0:
                break
        if depth == 1:
            if ch in ":,\n" and re.fullmatch(r"\s*[A-Za-z_]\w*\s*", token or " "):
                if token.strip():
                    keys.add(token.strip())
            token = "" if ch in ":,\n{" else token + ch
            if ch == ":":
                token = "\0"  # bỏ qua phần giá trị cho tới dấu phẩy
        elif depth > 1 and token != "\0":
            token = "\0"
    return keys


class FrontendContractTests(unittest.TestCase):
    def test_create_campaign_fields_exist_in_backend(self):
        backend_fields = set(R.CreateCampaignRequest.model_fields)
        for page in PAGES:
            with self.subTest(page=page):
                keys = payload_keys((FRONTEND / page).read_text(encoding="utf-8"))
                self.assertIn("campaign_type", keys)
                unknown = keys - backend_fields
                self.assertFalse(unknown, f"{page} gửi trường backend không đọc: {sorted(unknown)}")

    def test_every_api_called_by_service_js_exists(self):
        source = (FRONTEND / "service.js").read_text(encoding="utf-8")
        calls = re.findall(r"api\.(get|post|delete|put)\(\s*[`\"'](/api/seeding[^`\"'?]*)", source)
        self.assertGreater(len(calls), 10)
        routes = {(m, r.path) for r in R.router.routes for m in r.methods}
        for method, path in calls:
            with self.subTest(call=f"{method.upper()} {path}"):
                pattern = re.sub(r"\$\{[^}]+\}", "{x}", path.replace("/api", "", 1))
                found = any(m == method.upper() and re.sub(r"\{[^}]+\}", "{x}", p) == pattern for m, p in routes)
                self.assertTrue(found, f"service.js gọi {method.upper()} {path} nhưng backend không có API này")


class LinkRulesMatchFrontendTests(unittest.TestCase):
    """Giao diện (validation.js) và backend phải chuẩn hóa link và lấy ID giống nhau, nếu không thì lọc trùng ở ô nhập
    link (giao diện) và mục tiêu lưu trong DB (backend) bị lệch nhau."""

    def test_same_link_and_id_as_frontend(self):
        import json
        import shutil
        import subprocess
        import tempfile

        from .test_url_rules import SAMPLE_LINKS

        node = shutil.which("node")
        if not node:
            self.skipTest("Máy không có Node.js")
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "validation.mjs").write_text((FRONTEND / "validation.js").read_text(encoding="utf-8"), encoding="utf-8")
            (tmp / "run.mjs").write_text(
                'import { normalizeTargetUrl, extractTargetFbId } from "./validation.mjs";\n'
                "const inputs = JSON.parse(process.argv[2]);\n"
                "console.log(JSON.stringify(inputs.map(([t, u]) => {\n"
                "  const n = normalizeTargetUrl(u, t); return [n, extractTargetFbId(n, t)]; })));\n",
                encoding="utf-8",
            )
            out = subprocess.run([node, str(tmp / "run.mjs"), json.dumps(SAMPLE_LINKS)],
                                 capture_output=True, text=True, timeout=60, check=True).stdout
        for (target_type, raw), (js_url, js_id) in zip(SAMPLE_LINKS, json.loads(out)):
            with self.subTest(raw=raw):
                py_url = R.normalize_target_url(js_url, target_type)   # backend nhận link giao diện đã chuẩn hóa
                self.assertEqual(py_url, js_url)
                self.assertEqual(R.extract_fb_id(py_url, target_type), js_id)


if __name__ == "__main__":
    unittest.main()
