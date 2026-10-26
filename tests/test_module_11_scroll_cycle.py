"""
Kiểm tra quy tắc CYCLE_DETECTED đã chốt (chỉ dẫn 3.2):
chỉ dừng CYCLE khi batch có 0 Page mới VÀ chữ ký đã từng xuất hiện.
"""


def should_stop_cycle(new_keys_count: int, signature, seen_signatures: set) -> bool:
    return new_keys_count == 0 and bool(signature) and signature in seen_signatures


def test_cycle_not_when_batch_has_new_pages():
    seen = {frozenset({"a", "b"})}
    sig = frozenset({"a", "b"})
    assert should_stop_cycle(2, sig, seen) is False


def test_cycle_when_zero_new_and_signature_seen():
    seen = {frozenset({"a", "b"})}
    sig = frozenset({"a", "b"})
    assert should_stop_cycle(0, sig, seen) is True


def test_no_cycle_when_zero_new_but_signature_new():
    seen = {frozenset({"a", "b"})}
    sig = frozenset({"c", "d"})
    assert should_stop_cycle(0, sig, seen) is False


def test_search_and_hashtag_no_new_limits():
    """SEARCH NO_NEW_LIMIT = 5; HASHTAG cũng 5 (chỉ dẫn 2.5)."""
    import re
    from pathlib import Path

    text = Path("modules/module_11_page_scanner/scanner.py").read_text(encoding="utf-8")
    assert re.search(r"NO_NEW_LIMIT = 5\s+# SEARCH", text), "SEARCH phải NO_NEW_LIMIT = 5"
    # Trong run_hashtag_search_flow
    assert "MAX_SCROLL_BATCHES = 200" in text
    assert "MAX_DURATION_SEC = 900" in text
    # HASHTAG NO_NEW_LIMIT = 5 (không còn = 3 trong khối hashtag)
    hashtag_block = text.split("def run_hashtag_search_flow", 1)[-1]
    assert "NO_NEW_LIMIT = 5" in hashtag_block[:5000]
