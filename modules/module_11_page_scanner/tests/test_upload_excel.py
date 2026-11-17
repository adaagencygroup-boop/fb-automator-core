"""Tab "Tải tệp (.txt / .csv / .excel)": file .xlsx phải đọc được (trước đây bị đọc như văn bản → toàn dòng lỗi)."""
from __future__ import annotations

import asyncio
import importlib
import io
import unittest
import zipfile
from unittest import mock

from modules.module_11_page_scanner.page_source import (
    decode_page_upload,
    parse_page_file_content,
    xlsx_to_csv_text,
)

router = importlib.import_module("modules.module_11_page_scanner.api.router")

NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'


def make_xlsx(rows_xml: str, shared: list) -> bytes:
    sst = "".join(f"<si><t>{s}</t></si>" for s in shared)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/sharedStrings.xml", f'<sst {NS} count="{len(shared)}">{sst}</sst>')
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {NS}><sheetData>{rows_xml}</sheetData></worksheet>")
    return buf.getvalue()


SAMPLE = make_xlsx(
    """
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c></row>
    <row r="3"><c r="A3"><v>1.09283746192847E+14</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>https://m.facebook.com/biluxuryvn/about?ref=x</t></is></c></row>
    <row r="5"><c r="A5" t="s"><v>1</v></c></row>
    <row r="6"><c r="A6" t="s"><v>2</v></c></row>
    """,
    ["page_url", "https://www.facebook.com/innisfreevietnam", "không phải link"],
)


class TestXlsxUpload(unittest.TestCase):
    def test_xlsx_to_csv_reads_shared_inline_and_numeric_cells(self):
        text = xlsx_to_csv_text(SAMPLE)
        lines = text.splitlines()
        self.assertEqual(lines[0], "page_url")
        self.assertIn("109283746192847", lines)  # số khoa học → UID nguyên
        self.assertIn("https://m.facebook.com/biluxuryvn/about?ref=x", lines)

    def test_parse_xlsx_counts_valid_duplicate_invalid(self):
        res = parse_page_file_content(decode_page_upload("pages.xlsx", SAMPLE))
        self.assertEqual(res["total_lines"], 5)  # dòng tiêu đề "page_url" không bị tính là lỗi
        self.assertEqual(res["valid_count"], 3)
        self.assertEqual(res["dedup_count"], 1)
        self.assertEqual(res["invalid_count"], 1)

    def test_old_xls_rejected_with_clear_message(self):
        with self.assertRaises(ValueError) as ctx:
            decode_page_upload("pages.xls", b"\xd0\xcf\x11\xe0")
        self.assertIn(".xlsx", str(ctx.exception))

    def test_corrupt_xlsx_rejected(self):
        with self.assertRaises(ValueError):
            decode_page_upload("pages.xlsx", b"not a zip")

    def test_csv_with_bom_keeps_header_detection(self):
        data = "﻿page_url,note\nhttps://www.facebook.com/innisfreevietnam,a\n".encode("utf-8")
        res = parse_page_file_content(decode_page_upload("pages.csv", data))
        self.assertEqual((res["valid_count"], res["invalid_count"]), (1, 0))

    def test_upload_endpoint_accepts_xlsx(self):
        class _File:
            filename = "danh_sach.xlsx"

            async def read(self):
                return SAMPLE

        with mock.patch.object(router, "_get_owner", return_value="42"):
            res = asyncio.run(router.upload_pages_file(file=_File(), filter_existing=False, save_to_db=False))
        self.assertEqual(res["valid_count"], 3)
        self.assertEqual([i["status"] for i in res["line_items"]], ["VALID", "VALID", "VALID", "DUPLICATE", "INVALID"])


if __name__ == "__main__":
    unittest.main()
