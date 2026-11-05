"""
PyQt5 optional shim — Local Engine / Tauri sidecar không cần GUI Qt.
Khi PyQt5 có sẵn (dev desktop cũ) dùng bản thật; nếu thiếu thì stub tối thiểu.
"""

try:
    from PyQt5.QtCore import QObject, QThread, pyqtSignal  # noqa: F401
except ImportError:

    class QObject:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

    class _Signal:
        def __init__(self, *_types):
            self._slots = []

        def connect(self, slot):
            self._slots.append(slot)

        def emit(self, *args):
            for slot in list(self._slots):
                slot(*args)

    def pyqtSignal(*_types):  # type: ignore
        return _Signal(*_types)

    class QThread(QObject):  # type: ignore
        def __init__(self, parent=None):
            super().__init__()
            self._parent = parent

        def start(self):
            raise RuntimeError(
                "QThread stub: PyQt5 không có trong sidecar. "
                "Worker GUI không chạy được ở chế độ Local Engine."
            )

        def run(self):
            pass

        def msleep(self, _ms):
            pass

        def quit(self):
            pass

        def wait(self, *_args, **_kwargs):
            return True

