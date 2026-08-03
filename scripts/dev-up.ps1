# Portable PostgreSQL 16 + MinIO'yu tek komutla ayağa kaldırır (Docker yok,
# UAC/servis yok — bkz. docs/local-postgres-setup.md, docs/local-minio-setup.md).
# Makine yeniden başladığında ikisi de otomatik başlamaz (servis olarak kurulu
# değiller) — bu script idempotent'tir, zaten ayaktaysa dokunmaz.
#
# Kullanım:
#   .\scripts\dev-up.ps1
#   .\scripts\dev-up.ps1 -Stop     # ikisini de durdurur

param(
    [switch]$Stop
)

$ErrorActionPreference = "Stop"

$PgRoot = "$env:USERPROFILE\pgportable"
$PgBin = "$PgRoot\pgsql\bin"
$PgData = "$PgRoot\data"
$PgLog = "$PgRoot\pg.log"
$PgPort = 5432
$PgUser = "postgres"
$PgPassword = "devlocal_pg_2026"
$PgDatabases = @("arac_yazilim", "arac_yazilim_test")

$MinioData = "$env:USERPROFILE\minio-data"
$MinioLog = "$env:USERPROFILE\minio-data.log"
$MinioUser = "arac_yazilim_dev"
$MinioPassword = "devlocal_minio_2026"
$MinioPort = 9000
$MinioConsolePort = 9001
$MinioBucket = "arac-yazilim-ecu-files"

function Find-Exe($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "$name.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Test-Port($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Wait-Port($port, $timeoutSeconds = 30) {
    $elapsed = 0
    while (-not (Test-Port $port)) {
        Start-Sleep -Seconds 1
        $elapsed++
        if ($elapsed -ge $timeoutSeconds) {
            throw "Port $port $timeoutSeconds saniye içinde ayağa kalkmadı."
        }
    }
}

function Stop-Services {
    if (Test-Port $PgPort) {
        Write-Host "PostgreSQL durduruluyor..." -ForegroundColor Yellow
        & "$PgBin\pg_ctl.exe" -D $PgData stop -m fast | Out-Null
    } else {
        Write-Host "PostgreSQL zaten kapalı." -ForegroundColor DarkGray
    }

    if (Test-Port $MinioPort) {
        Write-Host "MinIO durduruluyor..." -ForegroundColor Yellow
        Get-Process minio -ErrorAction SilentlyContinue | Stop-Process -Force
    } else {
        Write-Host "MinIO zaten kapalı." -ForegroundColor DarkGray
    }
}

if ($Stop) {
    Stop-Services
    exit 0
}

# --- PostgreSQL ---
if (-not (Test-Path $PgBin)) {
    throw "Portable PostgreSQL bulunamadı: $PgBin (bkz. docs/local-postgres-setup.md 'Portable native kurulum' bölümü)"
}

if (Test-Port $PgPort) {
    Write-Host "PostgreSQL zaten ayakta (port $PgPort)." -ForegroundColor Green
} else {
    Write-Host "PostgreSQL başlatılıyor..." -ForegroundColor Cyan
    & "$PgBin\pg_ctl.exe" -D $PgData -l $PgLog -w start
    Wait-Port $PgPort
    Write-Host "PostgreSQL ayakta (port $PgPort)." -ForegroundColor Green
}

$env:PGPASSWORD = $PgPassword
foreach ($db in $PgDatabases) {
    $exists = & "$PgBin\psql.exe" -U $PgUser -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$db'"
    if ($exists -ne "1") {
        Write-Host "Veritabanı oluşturuluyor: $db" -ForegroundColor Cyan
        & "$PgBin\createdb.exe" -U $PgUser -h localhost $db
    }
}

# --- MinIO ---
$minioExe = Find-Exe "minio"
$mcExe = Find-Exe "mc"
if (-not $minioExe) {
    throw "minio.exe bulunamadı (bkz. docs/local-minio-setup.md — 'winget install --id MinIO.Server')"
}

if (Test-Port $MinioPort) {
    Write-Host "MinIO zaten ayakta (port $MinioPort)." -ForegroundColor Green
} else {
    Write-Host "MinIO başlatılıyor..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $MinioData | Out-Null

    $env:MINIO_ROOT_USER = $MinioUser
    $env:MINIO_ROOT_PASSWORD = $MinioPassword
    Start-Process -FilePath $minioExe `
        -ArgumentList @("server", "`"$MinioData`"", "--address", "`":$MinioPort`"", "--console-address", "`":$MinioConsolePort`"") `
        -WindowStyle Hidden `
        -RedirectStandardOutput $MinioLog `
        -RedirectStandardError "$MinioLog.err"

    Wait-Port $MinioPort
    Write-Host "MinIO ayakta (port $MinioPort, konsol $MinioConsolePort)." -ForegroundColor Green
}

if ($mcExe) {
    & $mcExe alias set local "http://localhost:$MinioPort" $MinioUser $MinioPassword | Out-Null
    & $mcExe mb --ignore-existing "local/$MinioBucket" | Out-Null
    & $mcExe anonymous set none "local/$MinioBucket" | Out-Null
    Write-Host "MinIO bucket hazır: $MinioBucket" -ForegroundColor Green
} else {
    Write-Host "mc.exe bulunamadı — bucket kontrolü atlandı (bkz. docs/local-minio-setup.md)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Hazır:" -ForegroundColor Green
Write-Host "  PostgreSQL : postgresql://postgres:***@localhost:$PgPort/arac_yazilim"
Write-Host "  MinIO S3   : http://localhost:$MinioPort"
Write-Host "  MinIO UI   : http://localhost:$MinioConsolePort"
Write-Host ""
Write-Host "Durdurmak için: .\scripts\dev-up.ps1 -Stop" -ForegroundColor DarkGray
