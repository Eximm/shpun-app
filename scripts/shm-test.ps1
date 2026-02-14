param(
  [string]$Action = "status",
  [string]$TgProfile = "ShpynSDNSystem",
  [int]$TgUserId = 142912013,
  [string]$Username = "test",
  [string]$Login = "test"
)

# Load .env.local
$envFile = Join-Path $PSScriptRoot "..\.env.local"
if (!(Test-Path $envFile)) { throw ".env.local not found at $envFile" }

Get-Content $envFile | ForEach-Object {
  if ($_ -match "^\s*#") { return }
  if ($_ -match "^\s*$") { return }
  $parts = $_.Split("=",2)
  if ($parts.Length -eq 2) {
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    [Environment]::SetEnvironmentVariable($name, $value)
  }
}

$base = $env:SHM_BASE
$tpl  = $env:SHM_TEMPLATE
$loginEnv = $env:SHM_LOGIN
$passEnv  = $env:SHM_PASSWORD

if (!$base -or !$tpl -or !$loginEnv -or !$passEnv) {
  throw "Missing SHM_* vars in .env.local (SHM_BASE, SHM_TEMPLATE, SHM_LOGIN, SHM_PASSWORD)"
}

# 1) Auth: get session_id
$authBody = "login=$([uri]::EscapeDataString($loginEnv))&password=$([uri]::EscapeDataString($passEnv))"
$auth = Invoke-RestMethod -Method Post -Uri "$base/shm/user/auth.cgi" -ContentType "application/x-www-form-urlencoded" -Body $authBody

if (!$auth.session_id) { throw "No session_id in auth response: $($auth | ConvertTo-Json -Depth 10)" }
$sessionId = $auth.session_id

# 2) Call template
$payload = @{ action = $Action }

if ($Action -eq "auth.telegram") {
  $payload.tg_profile = $TgProfile
  $payload.tg_user_id = $TgUserId
  $payload.username   = $Username
  $payload.login      = $Login
}

if ($Action -eq "onboarding.mark") {
  # пример: отметить что пароль уже предлагали
  $payload.password_prompted = $true
}

$json = $payload | ConvertTo-Json -Depth 10

$res = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/shm/v1/template/$tpl" `
  -Headers @{ "session-id" = $sessionId } `
  -ContentType "application/json" `
  -Body $json

$res | ConvertTo-Json -Depth 20
