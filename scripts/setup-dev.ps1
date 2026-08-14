# Cài môi trường development Voice Gateway (Windows PowerShell).
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Write-Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }

Write-Info "Thư mục dự án: $Root"

function Get-Cmd($name) {
    Get-Command $name -ErrorAction SilentlyContinue
}

if (-not (Get-Cmd "node")) {
    Write-Err "Chưa có Node.js. Cài Node 18+ từ https://nodejs.org rồi mở lại PowerShell."
    exit 1
}
if (-not (Get-Cmd "npm")) {
    Write-Err "Chưa có npm (đi kèm Node.js)."
    exit 1
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 18) {
    Write-Err "Cần Node.js >= 18 (đang có $(node -v))"
    exit 1
}
Write-Ok "Node $(node -v) / npm $(npm -v)"

$py = $null
foreach ($c in @("python", "py")) {
    if (Get-Cmd $c) { $py = $c; break }
}
if (-not $py) {
    Write-Err "Chưa có Python 3.10+. Cài từ https://www.python.org (tick Add python.exe to PATH)."
    exit 1
}
if ($py -eq "py") { $pyArgs = @("-3") } else { $pyArgs = @() }
Write-Ok (& $py @pyArgs --version 2>&1 | Out-String).Trim()

Write-Info "npm install"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install thất bại. Trên Windows có thể cần Visual Studio Build Tools để compile @discordjs/opus." }

$venv = Join-Path $Root ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Info "Tạo virtualenv .venv"
    & $py @pyArgs -m venv $venv
}
Write-Info "pip install -r requirements.txt"
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r (Join-Path $Root "requirements.txt")

$envFile = Join-Path $Root ".env"
$example = Join-Path $Root ".env.example"
if (-not (Test-Path $envFile)) {
    Write-Info "Tạo .env từ .env.example"
    Copy-Item $example $envFile
}

$lines = Get-Content $envFile -Encoding UTF8
$seenW = $false
$seenT = $false
$out = foreach ($line in $lines) {
    if ($line -match '^WHISPER_PYTHON=') { $seenW = $true; "WHISPER_PYTHON=$venvPy"; continue }
    if ($line -match '^TTS_PYTHON=') { $seenT = $true; "TTS_PYTHON=$venvPy"; continue }
    $line
}
if (-not $seenW) { $out += "WHISPER_PYTHON=$venvPy" }
if (-not $seenT) { $out += "TTS_PYTHON=$venvPy" }
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($envFile, $out, $utf8)
Write-Ok "Đã trỏ WHISPER_PYTHON / TTS_PYTHON -> $venvPy"

Write-Host ""
Write-Ok "Cài đặt dev xong."
Write-Host "  Phát triển (tự reload):  npm run dev"
Write-Host "  Production:              npm start"
Write-Host "  Trang test:              http://localhost:3000"
Write-Host ""
Write-Host "Mặc định agent=mock. OpenClaw/Hermes: sửa .env rồi restart."
Write-Host "Hướng dẫn đầy đủ: SETUP.md"
