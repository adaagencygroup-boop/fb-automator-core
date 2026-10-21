"""Build Next with worker threads when the environment restricts child processes."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
logs = root / "scratch"
logs.mkdir(exist_ok=True)
with (logs / "frontend-meta-build-threads.txt").open("w", encoding="utf-8") as output:
    result = subprocess.run(["node", "node_modules/next/dist/bin/next", "build"], cwd=root / "frontend",
                            env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1", "FRONTEND_BUILD_WORKER_THREADS": "1"},
                            stdout=output, stderr=subprocess.STDOUT)
raise SystemExit(result.returncode)
