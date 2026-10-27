# Daily job email for one person, started by a Windows task "<Label> Daily Job Email" (wakes the laptop from sleep,
# catches up after the laptop was off; repeat hourly for a few hours as retries). Usage: powershell -File tools\daily.ps1 -Person alex [-Force]
# Runs the person's n8n workflows (imported by tools/host.js) from the command line, so the n8n window need not be open.
# At most one email per day: a second start on the same day does nothing. -Force runs anyway (tests).
param([Parameter(Mandatory = $true)][ValidatePattern('^[a-z]+$')][string]$Person, [switch]$Force)
$ErrorActionPreference = 'Stop'
$n8n = Join-Path $env:APPDATA 'npm\n8n.cmd'   # full path: scheduled tasks may not have npm on PATH
$project = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $project 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$Person-mail.log"
$stamp = Join-Path $logDir "$Person-mail.last-run"
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $log -Encoding utf8 }

# workflow ids and names come from the person's profile (finder/profiles/<person>.js)
$profileJs = Join-Path $project "finder\profiles\$Person.js"
if (-not (Test-Path $profileJs)) { throw "No profile finder\profiles\$Person.js" }
$hostInfo = & node -e "const p = require(process.argv[1]); console.log(JSON.stringify({ ids: p.host.ids, label: p.host.names.label, port: p.host.brokerPort + 1 }))" $profileJs | ConvertFrom-Json
$label = $hostInfo.label

$today = Get-Date -Format 'yyyy-MM-dd'
if (-not $Force -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $today)) { exit 0 }
$alerted = Join-Path $logDir "$Person-mail.alerted"
function Alert-Owner($why) {
    # one popup per day; the hourly retries stay quiet
    if ((Test-Path $alerted) -and ((Get-Content $alerted -Raw).Trim() -eq $today)) { return }
    Set-Content -Path $alerted -Value $today -Encoding ascii
    $text = "$label's job email was NOT sent.`n`n$why`n`nOpen n8n (http://localhost:5678) -> Credentials -> reconnect Google Sheets, Docs and Gmail. The email then goes out by itself with the next hourly retry."
    $msg = Join-Path $logDir "$Person-mail.alert.txt"
    Set-Content -Path $msg -Value $text -Encoding utf8
    # separate process so the popup does not hold up this script
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).Popup((Get-Content -Raw -LiteralPath '$msg'), 0, '$label job email', 48)"
}

# own task-runner port so this works while the main n8n window is running
$env:N8N_RUNNERS_BROKER_PORT = [string]$hostInfo.port
$env:N8N_RUNNERS_TASK_TIMEOUT = '900'
try {
    Log 'Run started'
    # read-only test of the Google logins first: a dead Gmail login would otherwise add the new jobs to the sheet
    # but never email them (they would count as already seen tomorrow)
    $pre = & $n8n execute --id=SentinelPreCheck --rawOutput 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        $cred = [regex]::Match($pre, 'The credential "([^"]+)" needs to be reconnected').Groups[1].Value
        $why = if ($cred) { "Google login '$cred' has expired." } else { "The Google login test failed (see logs\$Person-mail.log)." }
        Alert-Owner $why
        throw "Pre-check failed, nothing changed: $($pre.Substring([Math]::Max(0, $pre.Length - 300)))"
    }
    # sheet check first (no AI): Applied On, follow-ups due, expired links; a failure here does not stop the email
    $check = & $n8n execute --id=$($hostInfo.ids.daily) --rawOutput 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Log "Sheet check failed (email still sent): $($check.Substring([Math]::Max(0, $check.Length - 300)))" }
    $out = & $n8n execute --id=$($hostInfo.ids.finder) --rawOutput 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        # n8n execute sometimes crashes right after start on Windows (0xC0000409): one retry
        Start-Sleep 20
        $out = & $n8n execute --id=$($hostInfo.ids.finder) --rawOutput 2>&1 | Out-String
    }
    if ($LASTEXITCODE -ne 0) { throw "Workflow failed: $($out.Substring([Math]::Max(0, $out.Length - 600)))" }
    $subject = [regex]::Match($out, '"subject":\s*"([^"]+)"').Groups[1].Value
    Set-Content -Path $stamp -Value $today -Encoding ascii
    Log "Email sent: $subject"
    if ((Get-Date).DayOfWeek -eq 'Sunday') {
        # weekly summary after the daily email; a failure here is only logged
        $week = & $n8n execute --id=$($hostInfo.ids.weekly) --rawOutput 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Log "Weekly summary failed: $($week.Substring([Math]::Max(0, $week.Length - 300)))" } else { Log 'Weekly summary sent' }
    }
} catch {
    Log "FAILED: $($_.Exception.Message)"
    Alert-Owner "The job search failed (see logs\$Person-mail.log)."
    exit 1
}
