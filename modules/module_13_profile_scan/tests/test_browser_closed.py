from unittest.mock import MagicMock, patch

from selenium.common.exceptions import NoSuchWindowException, WebDriverException

from modules.module_13_profile_scan import engine


def _run(scan_error=None, open_error=None):
    settings = {"rotate_every": 10, "workers": 1, "delay_min": 0, "delay_max": 0}
    run = engine.Run(1, "o", settings, [{"uid": "A"}, {"uid": "B"}])
    target = {"id": 7, "profile_key": "id:9", "attempts": 0, "source_keys": []}
    run.log = MagicMock()
    run.open_chrome = MagicMock(return_value=(MagicMock(), MagicMock()), side_effect=open_error)
    run.close_chrome = MagicMock()
    run._scan_one = MagicMock(side_effect=scan_error)
    models = MagicMock()
    models.claim_target.side_effect = [target, None]
    with patch.object(engine, "models", models), patch.object(engine, "get_active_job_for_account", return_value=None):
        run._worker(1)
    return run, models


def _assert_stopped(run, models):
    models.claim_target.assert_called_once()
    models.finish_target.assert_called_once_with(7, "PENDING", count_attempt=False)
    assert run.open_chrome.call_count == 1
    assert run._dead == {"A"} and run._closed == {"A"} and not run._in_use
    assert run.log.call_args.args[1] == "error"


def test_closed_while_scanning():
    run, models = _run(scan_error=NoSuchWindowException("no such window"))
    _assert_stopped(run, models)
    run.close_chrome.assert_called_once()


def test_closed_while_opening():
    run, models = _run(open_error=engine.BrowserClosed("x"))
    _assert_stopped(run, models)


def test_network_loss_is_not_closed():
    run, models = _run(scan_error=WebDriverException("unknown error: net::ERR_INTERNET_DISCONNECTED"))
    assert not run._dead and models.claim_target.call_count == 2
    assert models.finish_target.call_args.args[:2] == (7, "PENDING")
