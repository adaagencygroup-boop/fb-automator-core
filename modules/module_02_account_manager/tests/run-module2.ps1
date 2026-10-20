param([switch]$SkipBrowser)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$results = Join-Path $root ('test-results/module2/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force $results | Out-Null
$python = Join-Path $root '.venv/Scripts/python.exe'
$summary = @()
$servers = @()
$oldApi = $env:NEXT_PUBLIC_API_URL
$oldResults = $env:MODULE2_RESULTS
$oldData = $env:MODULE2_DATA
$data = Join-Path $results 'isolated-data'
function Run-Check($Name, $Exe, $Arguments, $Directory) {
    Push-Location $Directory
    try {
        $ErrorActionPreference = 'Continue'
        & $Exe @Arguments *> (Join-Path $results "$Name.log")
        $code = $LASTEXITCODE
        return @{ name = $Name; exit_code = $code; status = $(if ($code -eq 0) {'Đạt'} else {'Lỗi'}) }
    } finally { Pop-Location }
}
function Wait-Server($Url, $Process) {
    for ($i = 0; $i -lt 60; $i++) {
        if ($Process.HasExited) { throw "Server exited: $Url" }
        try { $r = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2; if ($r.StatusCode -eq 200) { return } } catch {}
        Start-Sleep -Seconds 1
    }
    throw "Server readiness timeout: $Url"
}
try {
    $env:MODULE2_RESULTS = $results
    $summary += Run-Check 'be' $python @('-m','modules.module_02_account_manager.tests.run_suite') $root
    $beDetails = Get-Content -Raw (Join-Path $results 'be-summary.json') | ConvertFrom-Json
    $summary[-1].passed = $beDetails.passed
    $summary[-1].blocked = @($beDetails.blocked).Count
    if ($beDetails.blocked.Count -gt 0 -and $summary[-1].exit_code -eq 0) { $summary[-1].status = 'Chưa kiểm chứng' }
    $fe = Join-Path $root 'frontend'
    $summary += Run-Check 'fe' 'node' @('--test','--test-isolation=none','src/modules/module_02_account_manager/hooks/useAccountPages.test.mjs','src/modules/module_02_account_manager/hooks/useAccountRealtime.test.mjs','src/modules/module_02_account_manager/utils/account-realtime.test.mjs','src/modules/module_02_account_manager/utils/drag-selection.test.mjs','src/modules/module_02_account_manager/utils/import-mapping.test.mjs') $fe
    $summary += Run-Check 'lint' 'npm.cmd' @('run','lint') $fe
    $env:NEXT_PUBLIC_API_URL = 'http://127.0.0.1:28132'
    $summary += Run-Check 'build' 'npm.cmd' @('run','build') $fe
    if ($summary[-1].exit_code -ne 0 -and (Select-String -Path (Join-Path $results 'build.log') -Pattern 'Failed to fetch.*Google Fonts' -Quiet)) { $summary[-1].status = 'Bị chặn' }
    if ($SkipBrowser) {
        $summary += @{name='e2e'; status='Chưa kiểm chứng'; reason='Explicit SkipBrowser'}
    } elseif ($summary[-1].exit_code -ne 0) {
        $summary += @{name='e2e'; status='Bị chặn'; reason='Build failed; see build.log'}
    } else {
        try {
            # Never attach to an existing service or stop processes owned by others.
            foreach ($port in @(28132,3012)) {
                if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Test port $port is occupied" }
            }
            $env:MODULE2_RESULTS = $results
            New-Item -ItemType Directory -Force $data | Out-Null
            $env:MODULE2_DATA = $data
            $api = Start-Process $python -ArgumentList @('-m','uvicorn','modules.module_02_account_manager.tests.browser_app:app','--host','127.0.0.1','--port','28132') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $results 'api.log') -RedirectStandardError (Join-Path $results 'api-error.log')
            $servers += $api
            Wait-Server 'http://127.0.0.1:28132/api/health' $api
            $ui = Start-Process 'node' -ArgumentList @('node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3012') -WorkingDirectory $fe -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $results 'ui.log') -RedirectStandardError (Join-Path $results 'ui-error.log')
            $servers += $ui
            Wait-Server 'http://127.0.0.1:3012/accounts' $ui
            $summary += Run-Check 'e2e' $python @('-m','modules.module_02_account_manager.tests.browser_e2e') $root
        } catch { $summary += @{name='e2e'; status='Bị chặn'; reason=$_.Exception.Message} }
    }
} finally {
    foreach ($server in $servers) {
        if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue; $server.WaitForExit(10000) | Out-Null }
    }
    $env:NEXT_PUBLIC_API_URL = $oldApi
    $env:MODULE2_RESULTS = $oldResults
    $env:MODULE2_DATA = $oldData
    if (Test-Path -LiteralPath $data) {
        $resolvedData = (Resolve-Path -LiteralPath $data).Path
        if (-not $resolvedData.StartsWith($results + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup target outside results' }
        Remove-Item -LiteralPath $resolvedData -Recurse -Force
    }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $results 'summary.json')
    Write-Output "Evidence: $results"
}
if ($summary | Where-Object { $_.status -ne 'Đạt' }) { exit 1 }
