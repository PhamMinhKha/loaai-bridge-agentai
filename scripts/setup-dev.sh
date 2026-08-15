#!/usr/bin/env bash
# Cài môi trường development Loa Ai Agent Bridge (macOS / Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
info() { printf "\033[36m==> %s\033[0m\n" "$*"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "Thiếu lệnh: $1"
    return 1
  fi
}

info "Thư mục dự án: $ROOT"

if ! command -v node >/dev/null 2>&1; then
  red "Chưa có Node.js. Cài Node 18+ (https://nodejs.org hoặc: brew install node)"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  red "Chưa có npm (đi kèm Node.js)."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  red "Cần Node.js >= 18 (đang có $(node -v))"
  exit 1
fi
green "Node $(node -v) / npm $(npm -v)"

PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3"
elif command -v python >/dev/null 2>&1; then PY="python"
else
  red "Chưa có Python 3.10+. Cài: brew install python"
  exit 1
fi
green "Python $($PY --version 2>&1)"

if [ "$(uname -s)" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
  info "Chưa có Xcode Command Line Tools (cần để build @discordjs/opus)."
  info "Chạy: xcode-select --install  rồi chạy lại script này."
fi

info "npm install"
npm install

VENV="$ROOT/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  info "Tạo virtualenv .venv"
  "$PY" -m venv "$VENV"
fi
info "pip install -r requirements.txt (faster-whisper, edge-tts, gTTS, pyttsx3, miniaudio)"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$ROOT/requirements.txt"

ENV_FILE="$ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  info "Tạo .env từ .env.example"
  cp "$ROOT/.env.example" "$ENV_FILE"
fi

VENV_PY="$VENV/bin/python"
# Ghi đường dẫn Python venv vào .env (không đụng các key khác)
tmp="$(mktemp)"
awk -v py="$VENV_PY" '
  BEGIN { w=0; t=0 }
  /^WHISPER_PYTHON=/ { print "WHISPER_PYTHON=" py; w=1; next }
  /^TTS_PYTHON=/ { print "TTS_PYTHON=" py; t=1; next }
  { print }
  END {
    if (!w) print "WHISPER_PYTHON=" py
    if (!t) print "TTS_PYTHON=" py
  }
' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"
green "Đã trỏ WHISPER_PYTHON / TTS_PYTHON -> $VENV_PY"

green ""
green "Cài đặt dev xong."
echo "  Phát triển (tự reload):  npm run dev"
echo "  Production:              npm start"
echo "  Trang test:              http://localhost:8888"
echo ""
echo "Mặc định agent=mock. OpenClaw/Hermes: sửa .env rồi restart."
echo "Hướng dẫn đầy đủ: SETUP.md"
