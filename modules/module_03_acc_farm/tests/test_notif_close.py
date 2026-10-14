"""Check thông báo: bảng thông báo / bài viết mở từ thông báo phải được đóng sau kịch bản."""
import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm.farming import flow
from modules.module_03_acc_farm.farming.locators import FARM_NOTIF

FLOW = "modules.module_03_acc_farm.farming.flow"


def visible_sequence(panel_states, bell=True):
    """_find_visible giả: bảng thông báo hiện theo panel_states (lần lượt), chuông luôn có."""
    states = iter(panel_states)

    def find(driver, locators, root=None):
        if locators == FARM_NOTIF["panel"]:
            return [Mock()] if next(states, False) else []
        if locators == FARM_NOTIF["bell_button"][:1]:
            return [Mock()] if bell else []
        return []
    return find


class ClosePanelTests(unittest.TestCase):
    def run_close(self, panel_states):
        with patch(f"{FLOW}._find_visible", side_effect=visible_sequence(panel_states)), \
                patch(f"{FLOW}.ActionChains") as chains, \
                patch(f"{FLOW}._human_click") as click, \
                patch(f"{FLOW}._move_mouse_off"), \
                patch(f"{FLOW}.time.sleep"):
            flow._close_notif_panel(Mock())
        escs = sum(1 for c in chains.return_value.send_keys.call_args_list if c.args == (flow.Keys.ESCAPE,))
        return escs, click.call_count

    def test_esc_once_when_it_closes(self):
        self.assertEqual(self.run_close([True, False, False]), (1, 0))

    def test_already_closed_does_nothing(self):
        self.assertEqual(self.run_close([False, False]), (0, 0))

    def test_reclick_bell_when_esc_fails(self):
        self.assertEqual(self.run_close([True, True, True, False]), (2, 1))


class LeaveOpenedNotificationTests(unittest.TestCase):
    def test_closes_post_popup_and_returns_home(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/groups/1/posts/2/"
        dialogs = iter([[Mock()], []])
        with patch(f"{FLOW}._find_visible", side_effect=lambda d, loc, root=None: next(dialogs, [])), \
                patch(f"{FLOW}._close_dialogs") as close, \
                patch(f"{FLOW}._open") as open_page, \
                patch(f"{FLOW}._move_mouse_off"), \
                patch(f"{FLOW}.time.sleep"):
            flow._leave_opened_notification(driver, Mock())
        close.assert_called_once()
        open_page.assert_called_once()
        self.assertEqual(open_page.call_args.args[2], flow.FB_HOME)

    def test_stays_when_already_home_without_popup(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        with patch(f"{FLOW}._find_visible", return_value=[]), \
                patch(f"{FLOW}._close_dialogs") as close, \
                patch(f"{FLOW}._open") as open_page, \
                patch(f"{FLOW}._move_mouse_off"):
            flow._leave_opened_notification(driver, Mock())
        close.assert_not_called()
        open_page.assert_not_called()


if __name__ == "__main__":
    unittest.main()
