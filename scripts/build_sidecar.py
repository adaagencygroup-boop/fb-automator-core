"""Build the Python engine for the current Rust host (Windows or Linux)."""
import sys
import subprocess
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TAURI_BIN_DIR = BASE_DIR / "src-tauri" / "binaries"


def host_target():
    """PyInstaller builds native binaries, so use the Rust host's target triple."""
    result = subprocess.run(
        ["rustc", "-vV"], capture_output=True, text=True, check=True
    )
    for line in result.stdout.splitlines():
        if line.startswith("host:"):
            target = line.partition(":")[2].strip()
            if target:
                return target
    raise RuntimeError("Không xác định được host target từ rustc -vV.")


def build_sidecar():
    if sys.version_info < (3, 11):
        raise RuntimeError("Build engine cần Python 3.11 trở lên.")
    spec_file = BASE_DIR / "build_engine.spec"
    if not spec_file.is_file():
        raise FileNotFoundError(f"Không tìm thấy: {spec_file}")

    # Chạy PyInstaller
    target = host_target()
    print(f"Building local_engine for {target}...", flush=True)
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--distpath", str(BASE_DIR / "dist"),
            "--workpath", str(BASE_DIR / "build"), str(spec_file),
        ],
        cwd=BASE_DIR,
        check=True,
    )

    extension = ".exe" if sys.platform == "win32" else ""
    built_binary = BASE_DIR / "dist" / f"local_engine{extension}"
    if not built_binary.is_file():
        raise FileNotFoundError(f"Không tìm thấy engine đã build: {built_binary}")

    # Tạo thư mục src-tauri/binaries nếu chưa có
    TAURI_BIN_DIR.mkdir(parents=True, exist_ok=True)

    destination = TAURI_BIN_DIR / f"local_engine-{target}{extension}"
    shutil.copy2(built_binary, destination)
    print(f"Sidecar ready: {destination}", flush=True)
    return destination


if __name__ == "__main__":
    try:
        build_sidecar()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Build sidecar failed: {exc}", file=sys.stderr)
        sys.exit(1)
