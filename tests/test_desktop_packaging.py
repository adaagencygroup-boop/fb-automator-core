"""Native sidecar packaging and installed Linux storage; no application DB access."""
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from config import paths
from scripts import build_sidecar

ROOT = Path(__file__).resolve().parents[1]


class SidecarBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "build_engine.spec").touch()
        (self.root / "dist").mkdir()
        self.binaries = self.root / "binaries"
        self.patchers = [
            patch.object(build_sidecar, "BASE_DIR", self.root),
            patch.object(build_sidecar, "TAURI_BIN_DIR", self.binaries),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_native_names_and_executable_permissions(self):
        for platform, target, extension in (
            ("linux", "x86_64-unknown-linux-gnu", ""),
            ("linux", "aarch64-unknown-linux-gnu", ""),
            ("win32", "x86_64-pc-windows-msvc", ".exe"),
        ):
            with self.subTest(target=target):
                binary = self.root / "dist" / f"local_engine{extension}"
                binary.write_bytes(b"packaged-engine")
                binary.chmod(0o755)
                with patch.object(build_sidecar.sys, "platform", platform), patch.object(
                    build_sidecar, "host_target", return_value=target
                ), patch.object(build_sidecar.subprocess, "run"):
                    destination = build_sidecar.build_sidecar()
                self.assertEqual(destination.name, f"local_engine-{target}{extension}")
                self.assertEqual(destination.read_bytes(), b"packaged-engine")
                self.assertTrue(os.access(destination, os.X_OK))

    def test_failed_build_does_not_replace_sidecar_with_stale_output(self):
        (self.root / "dist" / "local_engine").write_bytes(b"stale-output")
        self.binaries.mkdir()
        existing = self.binaries / "local_engine-x86_64-unknown-linux-gnu"
        existing.write_bytes(b"previous-good-build")
        with patch.object(build_sidecar, "host_target", return_value="x86_64-unknown-linux-gnu"), patch.object(
            build_sidecar.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "PyInstaller")
        ), self.assertRaises(subprocess.CalledProcessError):
            build_sidecar.build_sidecar()
        self.assertEqual(existing.read_bytes(), b"previous-good-build")

    def test_missing_output_is_a_build_error(self):
        with patch.object(build_sidecar, "host_target", return_value="x86_64-unknown-linux-gnu"), patch.object(
            build_sidecar.subprocess, "run"
        ), self.assertRaises(FileNotFoundError):
            build_sidecar.build_sidecar()
        self.assertFalse(self.binaries.exists())

    def test_rust_host_is_read_instead_of_assuming_windows(self):
        result = subprocess.CompletedProcess([], 0, "rustc 1.90.0\nhost: aarch64-unknown-linux-gnu\n")
        with patch.object(build_sidecar.subprocess, "run", return_value=result):
            self.assertEqual(build_sidecar.host_target(), "aarch64-unknown-linux-gnu")

    def test_missing_rust_host_is_a_build_error(self):
        result = subprocess.CompletedProcess([], 0, "rustc 1.90.0\n")
        with patch.object(build_sidecar.subprocess, "run", return_value=result), self.assertRaises(RuntimeError):
            build_sidecar.host_target()

    def test_unsupported_python_fails_before_building(self):
        with patch.object(build_sidecar.sys, "version_info", (3, 10, 12)), patch.object(
            build_sidecar.subprocess, "run"
        ) as run, self.assertRaisesRegex(RuntimeError, "Python 3.11"):
            build_sidecar.build_sidecar()
        run.assert_not_called()


class InstalledStorageTests(unittest.TestCase):
    def test_source_storage_stays_in_project(self):
        with patch.object(paths.sys, "frozen", False, create=True):
            self.assertEqual(paths.runtime_root(), ROOT)

    def test_linux_uses_xdg_storage_instead_of_usr_bin(self):
        with patch.object(paths.sys, "frozen", True, create=True), patch.object(
            paths.sys, "platform", "linux"
        ), patch.object(paths.sys, "executable", "/usr/bin/local_engine"), patch.dict(
            os.environ, {"XDG_DATA_HOME": "/tmp/custom-app-data"}, clear=True
        ):
            self.assertEqual(paths.runtime_root(), Path("/tmp/custom-app-data/FBAutomator"))

    def test_linux_default_data_directory(self):
        with patch.object(paths.sys, "frozen", True, create=True), patch.object(
            paths.sys, "platform", "linux"
        ), patch.dict(os.environ, {}, clear=True), patch.object(Path, "home", return_value=Path("/tmp/user")):
            self.assertEqual(paths.runtime_root(), Path("/tmp/user/.local/share/FBAutomator"))

    def test_installed_constants_create_only_user_writable_directories(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(
            paths.sys, "frozen", True, create=True
        ), patch.object(paths.sys, "platform", "linux"), patch.object(
            paths.sys, "executable", "/usr/bin/local_engine"
        ), patch.object(paths.sys, "_MEIPASS", "/read-only-bundle", create=True), patch.dict(
            os.environ, {"XDG_DATA_HOME": temporary}, clear=True
        ), patch("dotenv.load_dotenv"):
            constants = runpy.run_path(str(ROOT / "config" / "constants.py"))
            for key in ("DATA_DIR", "LOGS_DIR", "DOWNLOADS_DIR", "UPLOADS_DIR"):
                self.assertTrue(constants[key].is_relative_to(temporary))
            for key in ("DATA_DIR", "LOGS_DIR", "DOWNLOADS_DIR"):
                self.assertTrue(constants[key].is_dir())
            self.assertEqual(constants["BUNDLE_DIR"], Path("/read-only-bundle"))

    def test_core_and_account_plugin_share_linux_profiles(self):
        # Import before simulating a frozen interpreter so third-party imports
        # retain the normal development interpreter configuration.
        from modules.module_02_account_manager import context  # noqa: F401

        for override in (None, "/tmp/overridden-account-storage"):
            environment = {"XDG_DATA_HOME": "/tmp/desktop-profile-test"}
            if override:
                environment["FB_ACCOUNT_DATA_DIR"] = override
            with self.subTest(override=override), patch.object(paths.sys, "frozen", True, create=True), patch.object(
                paths.sys, "platform", "linux"
            ), patch.dict(os.environ, environment, clear=True):
                core = runpy.run_path(str(ROOT / "core" / "browser" / "profile.py"))
                plugin = runpy.run_path(
                    str(ROOT / "modules" / "module_02_account_manager" / "utils" / "paths.py"),
                    run_name="modules.module_02_account_manager.utils._packaging_test_paths",
                )
                expected = Path(override or "/tmp/desktop-profile-test/FBAutomator/data/module_02_account_manager").resolve()
                self.assertEqual(Path(core["PROFILES_DIR"]), expected / "browser_profiles")
                self.assertEqual(core["PROFILES_DIR"], plugin["PROFILES_DIR"])


if __name__ == "__main__":
    unittest.main()
