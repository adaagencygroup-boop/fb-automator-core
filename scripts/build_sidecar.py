"""
Build PyInstaller onedir local_engine và chuẩn bị cho Tauri:
  - src-tauri/engine-runtime/   → cả thư mục onedir (exe + _internal)
  - Tauri bundle.resources map → $INSTDIR/local_engine/
Boot nhanh: không giải nén onefile mỗi lần mở app.
"""
import shutil
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TAURI_DIR = BASE_DIR / "src-tauri"
ENGINE_RUNTIME = TAURI_DIR / "engine-runtime"
ONEDIR = BASE_DIR / "dist" / "local_engine"


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

    target = host_target()
    print("=" * 70)
    print(f"BẮT ĐẦU ĐÓNG GÓI LOCAL ENGINE (PyInstaller ONEDIR) — {target}")
    print("=" * 70)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath",
            str(BASE_DIR / "dist"),
            "--workpath",
            str(BASE_DIR / "build"),
            str(spec_file),
        ],
        cwd=BASE_DIR,
        check=True,
    )

    extension = ".exe" if sys.platform == "win32" else ""
    built_exe = ONEDIR / f"local_engine{extension}"
    if not built_exe.is_file():
        raise FileNotFoundError(f"Không tìm thấy onedir tại: {built_exe}")

    if ENGINE_RUNTIME.exists():
        shutil.rmtree(ENGINE_RUNTIME, ignore_errors=True)
    ENGINE_RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ONEDIR, ENGINE_RUNTIME)

    # Giữ binaries/.gitkeep — không còn copy single-file sidecar
    bin_dir = TAURI_DIR / "binaries"
    bin_dir.mkdir(parents=True, exist_ok=True)
    for stale in bin_dir.glob(f"local_engine*{extension}"):
        stale.unlink(missing_ok=True)

    size_mb = sum(
        p.stat().st_size for p in ENGINE_RUNTIME.rglob("*") if p.is_file()
    ) / (1024 * 1024)
    print("\n" + "=" * 70)
    print("BUILD SIDECAR ONEDIR HOÀN TẤT!")
    print(f"Nguồn: {ONEDIR}")
    print(f"Tauri resources: {ENGINE_RUNTIME} (~{size_mb:.0f} MB)")
    print("Chạy: npx @tauri-apps/cli build  → 1 file NSIS setup")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(build_sidecar() or 0)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Build sidecar failed: {exc}", file=sys.stderr)
        sys.exit(1)
