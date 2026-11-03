param(
  [string]$RemoteUser = "helio",
  [string]$RemoteHost = "192.168.0.70",
  [string]$RemoteDir = "/home/helio/apps/admin-financeiro",
  [switch]$NoLogs
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path $PSScriptRoot
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Archive = Join-Path $env:TEMP "admin-financeiro-$Timestamp.tar.gz"
$RemoteArchive = "/tmp/admin-financeiro-$Timestamp.tar.gz"

$SshExe = "C:\Windows\System32\OpenSSH\ssh.exe"
$ScpExe = "C:\Windows\System32\OpenSSH\scp.exe"

if (!(Test-Path $SshExe)) { $SshExe = "ssh" }
if (!(Test-Path $ScpExe)) { $ScpExe = "scp" }

function Run-Step {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Falha em: $Label"
  }
}

Write-Host "Deploy Admin Financeiro" -ForegroundColor Green
Write-Host "Origem:  $ProjectRoot"
Write-Host "Destino: ${RemoteUser}@${RemoteHost}:$RemoteDir"

Run-Step "Empacotando arquivos locais" {
  tar `
    --exclude=.git `
    --exclude=node_modules `
    --exclude=backend/node_modules `
    --exclude=frontend/node_modules `
    --exclude=backend/.env `
    --exclude=backend/uploads `
    --exclude=frontend/dist `
    --exclude=*.rpt `
    --exclude=*.xlsx `
    --exclude=dev-server*.log `
    -czf $Archive `
    -C $ProjectRoot `
    .
}

Run-Step "Enviando pacote para o Debian" {
  & $ScpExe $Archive "${RemoteUser}@${RemoteHost}:$RemoteArchive"
}

$RemoteCommand = @"
set -e
mkdir -p "$RemoteDir"
tar -xzf "$RemoteArchive" -C "$RemoteDir"
rm -f "$RemoteArchive"
cd "$RemoteDir"
docker compose -f docker-compose.app.yml build
docker compose -f docker-compose.app.yml run --rm admin-financeiro-app npm --prefix backend run migrate
docker compose -f docker-compose.app.yml up -d
docker compose -f docker-compose.app.yml ps
"@

Run-Step "Build, migration e restart no Docker" {
  & $SshExe "${RemoteUser}@${RemoteHost}" $RemoteCommand
}

if (!$NoLogs) {
  Run-Step "Ultimos logs do app" {
    & $SshExe "${RemoteUser}@${RemoteHost}" "cd '$RemoteDir' && docker compose -f docker-compose.app.yml logs --tail=80 admin-financeiro-app"
  }
}

Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Deploy concluido: http://$RemoteHost:3001" -ForegroundColor Green
