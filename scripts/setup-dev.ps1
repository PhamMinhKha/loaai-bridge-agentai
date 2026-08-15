# Cai moi truong development Loa Ai Agent Bridge (Windows PowerShell).
# ASCII-only strings: Windows PowerShell 5.1 parses .ps1 as ANSI unless UTF-8 BOM.
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Write-Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }

Write-Info "Thu muc du an: $Root"

function Get-Cmd($name) {
    Get-Command $name -ErrorAction SilentlyContinue
}

if (-not (Get-Cmd "node")) {
    Write-Err "Chua co Node.js. Cai Node 18+ tu https://nodejs.org roi mo lai PowerShell."
    exit 1
}
if (-not (Get-Cmd "npm")) {
    Write-Err "Chua co npm (di kem Node.js)."
    exit 1
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 18) {
    Write-Err "Can Node.js >= 18 (dang co $(node -v))"
    exit 1
}
Write-Ok "Node $(node -v) / npm $(npm -v)"

$py = $null
foreach ($c in @("python", "py")) {
    if (Get-Cmd $c) { $py = $c; break }
}
if (-not $py) {
    Write-Err "Chua co Python 3.10+. Cai tu https://www.python.org (tick Add python.exe to PATH)."
    exit 1
}
if ($py -eq "py") { $pyArgs = @("-3") } else { $pyArgs = @() }
Write-Ok (& $py @pyArgs --version 2>&1 | Out-String).Trim()

Write-Info "npm install"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install that bai. Tren Windows co the can Visual Studio Build Tools de compile @discordjs/opus." }

$venv = Join-Path $Root ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Info "Tao virtualenv .venv"
    & $py @pyArgs -m venv $venv
}
Write-Info "pip install -r requirements.txt"
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r (Join-Path $Root "requirements.txt")

$envFile = Join-Path $Root ".env"
$example = Join-Path $Root ".env.example"
if (-not (Test-Path $envFile)) {
    Write-Info "Tao .env tu .env.example"
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
Write-Ok "Da tro WHISPER_PYTHON / TTS_PYTHON -> $venvPy"

Write-Host ""
Write-Ok "Cai dat dev xong."
Write-Host "  Phat trien (tu reload):  npm run dev"
Write-Host "  Production:              npm start"
Write-Host "  Trang test:              http://localhost:8888"
Write-Host ""
Write-Host "Mac dinh agent=mock. OpenClaw/Hermes: sua .env roi restart."
Write-Host "Huong dan day du: SETUP.md"
