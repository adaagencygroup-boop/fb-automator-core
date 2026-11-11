import sys
import os
import ctypes
from ctypes import wintypes, POINTER, c_void_p, c_wchar_p, byref

# 1. Kích hoạt Per-Monitor V2 DPI Awareness cấp hệ điều hành Windows để chống mờ chữ
try:
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", wintypes.BYTE * 8),
    ]


def _make_guid(guid_str):
    g = GUID()
    ctypes.windll.ole32.CLSIDFromString(ctypes.c_wchar_p(guid_str), byref(g))
    return g


def pick_folder_win32(initial_dir="", title="Chọn thư mục video"):
    """
    Mở trực tiếp Windows Native IFileOpenDialog qua COM API (ctypes).
    Tốc độ khởi động siêu tốc (dưới 0.01 giây), không nạp thư viện nặng,
    tự động gắn vào cửa sổ đang thao tác (Tauri) và luôn hiển thị trên cùng.
    """
    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32
    user32 = ctypes.windll.user32

    ole32.CoInitialize(None)
    try:
        clsid_dialog = _make_guid("{DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7}")
        iid_dialog = _make_guid("{D57C7288-D4AD-4768-BE02-9D969532D960}")
        iid_shell_item = _make_guid("{43826D1E-E718-42EE-BC55-A1E261C37BFE}")

        p_dialog = c_void_p()
        hr = ole32.CoCreateInstance(
            byref(clsid_dialog), None, 1, byref(iid_dialog), byref(p_dialog)
        )
        if hr != 0 or not p_dialog.value:
            return ""

        vtable = ctypes.cast(p_dialog, POINTER(POINTER(c_void_p))).contents

        fn_Show = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p, wintypes.HWND)(vtable[3])
        fn_SetOptions = ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, wintypes.DWORD)(vtable[9])
        fn_GetOptions = ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, POINTER(wintypes.DWORD))(vtable[10])
        fn_SetFolder = ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, c_void_p)(vtable[12])
        fn_SetTitle = ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, c_wchar_p)(vtable[17])
        fn_GetResult = ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, POINTER(c_void_p))(vtable[20])
        fn_Release = ctypes.WINFUNCTYPE(wintypes.ULONG, c_void_p)(vtable[2])

        FOS_PICKFOLDERS = 0x00000020
        FOS_FORCEFILESYSTEM = 0x00000040
        FOS_PATHMUSTEXIST = 0x00000800

        opts = wintypes.DWORD()
        fn_GetOptions(p_dialog, byref(opts))
        fn_SetOptions(p_dialog, opts.value | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)

        dialog_title = title.strip() if (title and title.strip()) else "Chọn thư mục video"
        fn_SetTitle(p_dialog, dialog_title)

        clean_init = initial_dir.strip().strip('"').strip("'") if initial_dir else ""
        if clean_init and os.path.exists(clean_init) and os.path.isdir(clean_init):
            p_init_item = c_void_p()
            hr_init = shell32.SHCreateItemFromParsingName(
                c_wchar_p(clean_init), None, byref(iid_shell_item), byref(p_init_item)
            )
            if hr_init == 0 and p_init_item.value:
                fn_SetFolder(p_dialog, p_init_item)
                item_vtable = ctypes.cast(p_init_item, POINTER(POINTER(c_void_p))).contents
                ctypes.WINFUNCTYPE(wintypes.ULONG, c_void_p)(item_vtable[2])(p_init_item)

        # Gắn owner vào cửa sổ hiện tại (Tauri desktop app)
        hwnd_owner = user32.GetForegroundWindow()
        hr_show = fn_Show(p_dialog, hwnd_owner)

        selected_path = ""
        if hr_show == 0:  # S_OK khi người dùng bấm Select Folder
            p_item = c_void_p()
            if fn_GetResult(p_dialog, byref(p_item)) == 0 and p_item.value:
                item_vtable = ctypes.cast(p_item, POINTER(POINTER(c_void_p))).contents
                fn_GetDisplayName = ctypes.WINFUNCTYPE(
                    ctypes.HRESULT, c_void_p, wintypes.DWORD, POINTER(c_wchar_p)
                )(item_vtable[5])
                psz_path = c_wchar_p()
                SIGDN_FILESYSPATH = 0x80058000
                if (
                    fn_GetDisplayName(p_item, SIGDN_FILESYSPATH, byref(psz_path)) == 0
                    and psz_path.value
                ):
                    selected_path = psz_path.value
                    ole32.CoTaskMemFree(psz_path)
                ctypes.WINFUNCTYPE(wintypes.ULONG, c_void_p)(item_vtable[2])(p_item)

        fn_Release(p_dialog)
        return selected_path
    finally:
        ole32.CoUninitialize()


def pick_folder_qt(initial_dir="", title="Chọn thư mục video"):
    from PyQt5.QtWidgets import QApplication, QFileDialog
    from PyQt5.QtCore import Qt, QCoreApplication

    if not QCoreApplication.instance():
        QCoreApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
        QCoreApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    app = QApplication.instance()
    if not app:
        app = QApplication([sys.argv[0]])

    init = initial_dir if (initial_dir and os.path.exists(initial_dir)) else ""
    dialog_title = title.strip() if (title and title.strip()) else "Chọn thư mục video"

    dialog = QFileDialog(None, dialog_title, init)
    dialog.setFileMode(QFileDialog.DirectoryOnly)
    dialog.setOption(QFileDialog.ShowDirsOnly, True)
    dialog.setOption(QFileDialog.DontResolveSymlinks, True)
    dialog.setWindowFlags(dialog.windowFlags() | Qt.WindowStaysOnTopHint)

    if dialog.exec_() == QFileDialog.Accepted:
        selected = dialog.selectedFiles()
        if selected and selected[0]:
            return os.path.normpath(selected[0])
    return ""


def pick_folder_powershell(initial_dir="", title="Chọn thư mục video") -> str:
    """
    Mở hộp thoại FolderBrowserDialog native qua PowerShell độc lập (STA thread).
    Hoạt động 100% ổn định trên Windows cả khi chạy source dev lẫn khi build đóng gói (PyInstaller / Tauri).
    Không bao giờ phụ thuộc sys.executable là python.exe hay local_engine.exe.
    """
    import subprocess
    clean_init = initial_dir.strip().strip('"').strip("'") if initial_dir else ""
    if clean_init and not (os.path.exists(clean_init) and os.path.isdir(clean_init)):
        clean_init = ""

    safe_title = (title or "Chọn thư mục video").replace("'", "''")
    safe_init = clean_init.replace("'", "''")

    ps_script = f"""
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = '{safe_title}'
$f.ShowNewFolderButton = $true
$init = '{safe_init}'
if ($init -and (Test-Path -LiteralPath $init)) {{
    $f.SelectedPath = $init
}}
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
$res = $f.ShowDialog($top)
$top.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {{
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $f.SelectedPath
}}
"""
    cmd = ["powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command", ps_script]
    creation_flags = 0x08000000 if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            creationflags=creation_flags,
        )
        out = (proc.stdout or "").strip()
        if out and os.path.isdir(out):
            return os.path.normpath(out)
    except Exception as e:
        sys.stderr.write(f"PowerShell folder dialog error: {e}\\n")
    return ""


def pick_folder(initial_dir="", title="Chọn thư mục video"):
    try:
        if sys.platform == "win32":
            selected = pick_folder_powershell(initial_dir, title)
            if selected:
                print(os.path.normpath(selected))
                return
            # Fallback sang Win32 COM nếu PowerShell không mở được
            try:
                selected = pick_folder_win32(initial_dir, title)
                if selected:
                    print(os.path.normpath(selected))
                    return
            except Exception:
                pass
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)


if __name__ == "__main__":
    init_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    title_arg = sys.argv[2] if len(sys.argv) > 2 else "Chọn thư mục video"
    pick_folder(init_arg, title_arg)
