class QObject:
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
def pyqtSignal(*_types):
  return _Signal(*_types)
class QThread(QObject):
  def __init__(self, parent=None):
    super().__init__()
    self._parent = parent
  def start(self):
    raise RuntimeError(
      "QThread stub: GUI worker không chạy được ở chế độ Local Engine."
    )
  def run(self):
    pass
  def msleep(self, _ms):
    pass
  def quit(self):
    pass
  def wait(self, *_args, **_kwargs):
    return True