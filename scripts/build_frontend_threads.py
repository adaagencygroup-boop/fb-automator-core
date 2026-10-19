"""Build Next with worker threads when the environment restricts child processes."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
config = root / "frontend/next.config.mjs"
original = config.read_bytes()
logs = root / "scratch"
logs.mkdir(exist_ok=True)
try:
    config.write_bytes(original.replace(b"const nextConfig = {", b"const nextConfig = {\n  experimental: { workerThreads: true, cpus: 2 },"))
    with (logs / "frontend-meta-build-threads.txt").open("w", encoding="utf-8") as output:
        result = subprocess.run(["node", "node_modules/next/dist/bin/next", "build"], cwd=root / "frontend",
                                env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1"}, stdout=output, stderr=subprocess.STDOUT)
finally:
    config.write_bytes(original)
raise SystemExit(result.returncode)
