import urllib.request
import subprocess
import webbrowser
import argparse
import time
import sys
import os
from pathlib import Path
if hasattr(sys.stdout, "reconfigure"):
  try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
  except Exception:
    pass
baseDir = Path(__file__).resolve().parent
frontendDir = baseDir / "frontend"
adminDir = baseDir / "admin"
logsDir = baseDir / "logs"
logsDir.mkdir(parents=True, exist_ok=True)
backendUrl = "http://127.0.0.1:28129/api/health"
frontendUrl = "http://127.0.0.1:3000"
adminUrl = "http://127.0.0.1:3010/login"
def freePort(port: int):
  if sys.platform == "win32":
    try:
      cmd = f'powershell -Command "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"'
      subprocess.run(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
      pass
def printLogTail(logFile: Path, maxLines: int = 20):
  if not logFile.exists():
    return
  try:
    lines = logFile.read_text(encoding="utf-8", errors="replace").splitlines()
    tail = lines[-maxLines:]
    print("\n(Chi Tiet Log Loi)")
    for line in tail:
      print(f"  {line}")
  except Exception:
    pass
def waitForUrl(url: str, timeout: int = 40, proc: subprocess.Popen = None, serviceName: str = "Service", logFile: Path = None) -> bool:
  startTime = time.time()
  urlsToCheck = [url]
  if "localhost" in url:
    urlsToCheck.append(url.replace("localhost", "127.0.0.1"))
  elif "127.0.0.1" in url:
    urlsToCheck.append(url.replace("127.0.0.1", "localhost"))
  while time.time() - startTime < timeout:
    if proc and proc.poll() is not None:
      print(f"  (Error) {serviceName} Da Dung Voi Exit Code {proc.poll()}!")
      if logFile:
        printLogTail(logFile)
      return False
    for targetUrl in urlsToCheck:
      try:
        req = urllib.request.Request(targetUrl, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
          if response.status in (200, 304):
            return True
      except Exception:
        pass
    time.sleep(1)
  if logFile:
    printLogTail(logFile)
  return False
def killProcessTree(pid: int):
  try:
    subprocess.run(
      ["taskkill", "/F", "/T", "/PID", str(pid)],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
  except Exception:
    pass
def npmCmd():
  return "npm.cmd" if os.name == "nt" else "npm"
def spawn(cmd, cwd, logName):
  logsDir.mkdir(parents=True, exist_ok=True)
  logFile = open(logsDir / logName, "w", encoding="utf-8", errors="replace")
  proc = subprocess.Popen(cmd, cwd=str(cwd), stdout=logFile, stderr=subprocess.STDOUT)
  proc._fb_log = logFile
  return proc
def closeProc(proc):
  if not proc:
    return
  logFile = getattr(proc, "_fb_log", None)
  killProcessTree(proc.pid)
  if logFile:
    logFile.close()
def tailLog(name):
  path = logsDir / name
  if not path.exists():
    return
  text = path.read_text(encoding="utf-8", errors="replace").strip()
  if not text:
    return
  lines = text.splitlines()[-8:]
  print(f"  (Log) {name}:")
  for line in lines:
    print(f"    {line}")
def runProject(openBrowser: bool = True):
  print("=" * 70)
  print("(Start) Khoi Dong Facebook Automator Pro")
  print("=" * 70)
  freePort(28129)
  freePort(3000)
  freePort(3010)
  backendProc = None
  frontendProc = None
  adminProc = None
  try:
    print("\n(1/3) Backend Local Engine (Port 28129)")
    backendProc = spawn([sys.executable, "-u", "engine.py", "--port", "28129"], baseDir, "engine.log")
    if waitForUrl(backendUrl, timeout=1200, proc=backendProc, serviceName="Backend"):
      print("  (Ok) Backend: http://127.0.0.1:28129")
      print("  (Ok) Swagger: http://127.0.0.1:28129/docs")
    else:
      print("  (Error) Backend Khong Phan Hoi Sau 1200 Giay")
      engineLog = logsDir / "engine.log"
      if engineLog.exists():
        steps = [line for line in engineLog.read_text(encoding="utf-8", errors="replace").splitlines() if "[Startup]" in line]
        if steps:
          print(f"  (Last Startup Step) {steps[-1]}")
      tailLog("engine.log")
      return False
    print("\n(2/3) Giao Dien User Next.js (Port 3000)")
    frontendProc = spawn([npmCmd(), "run", "dev", "--", "-H", "127.0.0.1", "-p", "3000", "--webpack"], frontendDir, "frontend.log")
    if waitForUrl(frontendUrl, timeout=180, proc=frontendProc, serviceName="User UI"):
      print("  (Ok) User UI: http://127.0.0.1:3000")
    else:
      print("  (Error) User UI Khong Phan Hoi Sau 180 Giay")
      tailLog("frontend.log")
      return False
    print("\n(3/3) Giao Dien Admin Next.js (Port 3010)")
    adminProc = spawn([npmCmd(), "run", "dev", "--", "--webpack"], adminDir, "admin.log")
    if waitForUrl(adminUrl, timeout=60, proc=adminProc, serviceName="Admin UI"):
      print("  (Ok) Admin UI: http://127.0.0.1:3010")
    else:
      print("  (Error) Admin UI Khong Phan Hoi Sau 60 Giay")
      tailLog("admin.log")
      return False
    print("\n" + "=" * 70)
    print("(Success) User UI, Admin UI Va Backend Da Len")
    print("  >> User UI:    http://127.0.0.1:3000")
    print("  >> Admin UI:   http://127.0.0.1:3010")
    print("  >> Backend:    http://127.0.0.1:28129")
    print("  >> Swagger:    http://127.0.0.1:28129/docs")
    print("=" * 70)
    if openBrowser:
      webbrowser.open("http://127.0.0.1:3000")
      webbrowser.open("http://127.0.0.1:3010/login")
    print("\n(Info) Nhan (Ctrl + C) De Dung User UI, Admin UI Va Backend")
    while True:
      time.sleep(1)
  except KeyboardInterrupt:
    print("\n(Info) Nhan Tin Hieu Dung Tu Nguoi Dung")
  except Exception as exc:
    print(f"\n(Error) Loi Ngoai Y Muon: {exc}")
    return False
  finally:
    print("\n(Cleanup) Dang Dong Tien Trinh Con")
    closeProc(backendProc)
    print("  * Da Dung Backend (28129)")
    closeProc(frontendProc)
    print("  * Da Dung User UI (3000)")
    closeProc(adminProc)
    print("  * Da Dung Admin UI (3010)")
    freePort(28129)
    freePort(3000)
    freePort(3010)
    print("(Cleanup Done) Hoan Tat Don Dep, Cong 28129, 3000 Va 3010 Da Duoc Giai Phong!")
  return True
if __name__ == "__main__":
  parser = argparse.ArgumentParser(description="Chay User UI, Admin UI Va Backend Facebook Automator Pro")
  parser.add_argument("--no-browser", action="store_true", help="Khong Tu Dong Mo Trinh Duyet")
  args = parser.parse_args()
  success = runProject(openBrowser=not args.no_browser)