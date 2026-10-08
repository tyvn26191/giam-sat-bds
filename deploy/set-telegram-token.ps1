# Store the Telegram bot token in Secret Manager and attach it to the worker (Windows).
# Usage (PowerShell, from the repo folder):
#   powershell -ExecutionPolicy Bypass -File deploy\set-telegram-token.ps1
# The token is typed at a hidden prompt, written to a temp file only for the upload, then deleted.
param(
  [string]$Project = 'giam-sat-bds-1008601',
  [string]$Region = 'asia-northeast1',
  [string]$Service = 'gsb-worker'
)
$ErrorActionPreference = 'Stop'
$gcloud = Join-Path $env:LOCALAPPDATA 'Google\google-cloud-sdk\bin\gcloud.cmd'
if (-not (Test-Path $gcloud)) { $gcloud = 'gcloud' }
$sa = "gsb-worker@$Project.iam.gserviceaccount.com"

$secure = Read-Host 'Dan Telegram bot token (an khi go) roi Enter' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
if ($token -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') { throw 'Token khong dung dang 123456789:AA... — kiem tra lai tin nhan cua @BotFather.' }

$tmp = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tmp, $token)
  & $gcloud secrets describe TELEGRAM_BOT_TOKEN --project $Project *> $null
  if ($LASTEXITCODE -ne 0) {
    & $gcloud secrets create TELEGRAM_BOT_TOKEN --project $Project --replication-policy=automatic --data-file=$tmp
  } else {
    & $gcloud secrets versions add TELEGRAM_BOT_TOKEN --project $Project --data-file=$tmp
  }
} finally {
  Remove-Item $tmp -Force
}
& $gcloud secrets add-iam-policy-binding TELEGRAM_BOT_TOKEN --project $Project --member="serviceAccount:$sa" --role=roles/secretmanager.secretAccessor | Out-Null
& $gcloud run services update $Service --project $Project --region $Region --update-secrets=TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest
Write-Host 'Xong: worker da co Telegram token.' -ForegroundColor Green
