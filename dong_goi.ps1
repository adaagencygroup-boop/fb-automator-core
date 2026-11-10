# dong_goi.ps1 - Đóng gói ứng dụng FB Page Automator
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

python scripts\build_release.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Đóng gói thất bại! Vui lòng kiểm tra log ở trên." -ForegroundColor Red
    pause
    exit 1
}

pause
exit 0

