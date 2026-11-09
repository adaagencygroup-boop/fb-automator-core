#!/usr/bin/env python3
"""Build Tauri updater latest.json from signed installer artifacts.

Usage:
  python scripts/build_latest_json.py \\
    --version 2.0.1 \\
    --notes "Bug fixes" \\
    --repo adaagencygroup-boop/fb-automator-core \\
    --out latest.json \\
    --artifact-dir path/to/downloaded/artifacts
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


PLATFORM_RULES = (
    # (platform_key, url_suffix_matchers for downloadable asset, signature file matchers)
    (
        "windows-x86_64",
        (".nsis.zip", "-setup.exe", "_x64-setup.exe"),
        (".nsis.zip.sig", "-setup.exe.sig", "_x64-setup.exe.sig"),
    ),
    (
        "linux-x86_64",
        (".AppImage.tar.gz", ".AppImage"),
        (".AppImage.tar.gz.sig", ".AppImage.sig"),
    ),
)


def find_file(root: Path, suffixes: tuple[str, ...]) -> Path | None:
    files = [p for p in root.rglob("*") if p.is_file()]
    for suffix in suffixes:
        for path in sorted(files):
            if path.name.endswith(suffix) and not path.name.endswith(".sig"):
                return path
    return None


def find_sig(root: Path, suffixes: tuple[str, ...]) -> Path | None:
    files = [p for p in root.rglob("*") if p.is_file()]
    for suffix in suffixes:
        for path in sorted(files):
            if path.name.endswith(suffix):
                return path
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--notes", default="")
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--tag", default="", help="Release tag; default v{version}")
    parser.add_argument("--artifact-dir", required=True)
    parser.add_argument("--out", default="latest.json")
    args = parser.parse_args()

    version = args.version.lstrip("v")
    tag = args.tag or f"v{version}"
    root = Path(args.artifact_dir)
    if not root.exists():
        raise SystemExit(f"Artifact dir not found: {root}")

    platforms: dict[str, dict[str, str]] = {}
    for platform, asset_suffixes, sig_suffixes in PLATFORM_RULES:
        asset = find_file(root, asset_suffixes)
        sig = find_sig(root, sig_suffixes)
        if not asset or not sig:
            continue
        # Prefer pairing: same stem when possible
        if asset.name + ".sig" != sig.name and not sig.name.startswith(asset.name):
            paired = asset.with_name(asset.name + ".sig")
            if paired.exists():
                sig = paired
        platforms[platform] = {
            "url": f"https://github.com/{args.repo}/releases/download/{tag}/{asset.name}",
            "signature": sig.read_text(encoding="utf-8").strip(),
        }

    if not platforms:
        raise SystemExit(f"No signed updater artifacts found under {root}")

    payload = {
        "version": version,
        "notes": args.notes or f"Release {tag}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    out = Path(args.out)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out} with platforms: {', '.join(platforms)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
