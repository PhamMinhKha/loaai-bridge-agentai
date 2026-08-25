#!/usr/bin/env bash
# Setup Loa Ai Agent Bridge trên Ubuntu VPS (dòng lệnh).
#
# Menu (mặc định):  ./scripts/setup-vps-ubuntu.sh
# Tự động hết:      ./scripts/setup-vps-ubuntu.sh --auto
#                   sudo ./scripts/setup-vps-ubuntu.sh --auto
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
info() { printf "\033[36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[33m%s\033[0m\n" "$*"; }

AUTO=0
if [ "${1:-}" = "--auto" ] || [ "${1:-}" = "-y" ] || [ "${SETUP_AUTO:-}" = "1" ]; then
  AUTO=1
fi

SERVICE_NAME="voice-gateway"
PORT_DEFAULT="8888"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    red "Cần quyền root/sudo cho: $*"
    return 1
  fi
}

svc_user() {
  if [ "$(id -u)" -eq 0 ]; then
    echo "${SUDO_USER:-loa}"
  else
    echo "$(id -un)"
  fi
}

node_bin() {
  command -v node 2>/dev/null || echo "/usr/bin/node"
}

upsert_env() {
  local key="$1" val="$2"
  local envf="$ROOT/.env"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    BEGIN { found=0 }
    $0 ~ "^" k "=" { print k "=" v; found=1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$envf" > "$tmp"
  mv "$tmp" "$envf"
}

ensure_env_file() {
  if [ ! -f "$ROOT/.env" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    info "Tạo .env từ .env.example"
  fi
}

check_os() {
  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    if [ "${ID:-}" != "ubuntu" ] && [ "${ID_LIKE:-}" != *"debian"* ] && [ "${ID:-}" != "debian" ]; then
      warn "Cảnh báo: script tối ưu Ubuntu/Debian (đang: ${PRETTY_NAME:-unknown})."
    else
      info "Hệ điều hành: ${PRETTY_NAME:-unknown}"
    fi
  fi
}

install_apt() {
  info "Cài gói hệ thống (apt)"
  if ! run_root apt-get update -y; then
    warn "apt update lỗi (repo hỏng?). Vẫn thử cài gói."
  fi
  run_root apt-get install -y \
    git curl ca-certificates \
    build-essential python3 python3-venv python3-pip python3-dev \
    ffmpeg libopus-dev pkg-config openssl
}

install_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$major" -ge 18 ]; then
      green "Node $(node -v) / npm $(npm -v) đã đủ"
      return 0
    fi
    warn "Node $(node -v) < 18 — cài Node 20"
  else
    info "Thiếu Node.js hoặc npm — cài Node 20"
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | run_root bash -
  run_root apt-get install -y nodejs
  if ! command -v npm >/dev/null 2>&1; then
    run_root apt-get install -y npm
  fi
  green "Node $(node -v) / npm $(npm -v)"
}

install_app() {
  info "npm install + Python venv (setup-dev.sh)"
  chmod +x "$ROOT/scripts/setup-dev.sh"
  bash "$ROOT/scripts/setup-dev.sh"
}

configure_env_vps() {
  ensure_env_file
  local py="$ROOT/.venv/bin/python"
  [ -x "$py" ] || py="$(command -v python3 || true)"
  upsert_env HOST "0.0.0.0"
  upsert_env PORT "${PORT:-$PORT_DEFAULT}"
  upsert_env TLS_ENABLED "false"
  upsert_env REQUIRE_DEVICE_TOKEN "true"
  upsert_env STT_PROVIDER "whisper"
  upsert_env WHISPER_MODEL "${WHISPER_MODEL:-small}"
  upsert_env TTS_PROVIDER "edge"
  upsert_env TTS_VOICE "${TTS_VOICE:-vi-VN-HoaiMyNeural}"
  if [ -n "$py" ]; then
    upsert_env WHISPER_PYTHON "$py"
    upsert_env TTS_PYTHON "$py"
  fi

  local secret=""
  if grep -q '^DEVICE_TOKEN_SECRET=' "$ROOT/.env"; then
    secret="$(grep '^DEVICE_TOKEN_SECRET=' "$ROOT/.env" | head -1 | cut -d= -f2-)"
  fi
  if [ -z "$secret" ] || [ "$secret" = "helloloaai" ]; then
    secret="$(openssl rand -hex 32)"
    upsert_env DEVICE_TOKEN_SECRET "$secret"
    green "Đã tạo DEVICE_TOKEN_SECRET mới (lưu trong .env — copy vào ESP32 hello.token)"
  else
    info "Giữ DEVICE_TOKEN_SECRET hiện có"
  fi
  green ".env VPS: HOST=0.0.0.0 REQUIRE_DEVICE_TOKEN=true WHISPER_MODEL=${WHISPER_MODEL:-small} TTS=edge"
}

install_systemd() {
  local user node wd unit
  user="$(svc_user)"
  node="$(node_bin)"
  wd="$ROOT"
  unit="/etc/systemd/system/${SERVICE_NAME}.service"

  if ! id "$user" >/dev/null 2>&1; then
    info "Tạo user $user"
    run_root useradd -m -s /bin/bash "$user" || true
  fi
  run_root chown -R "$user:$user" "$wd" || true

  info "Ghi $unit (User=$user ExecStart=$node)"
  run_root tee "$unit" >/dev/null <<EOF
[Unit]
Description=Loa Ai Agent Bridge (voice-gateway)
After=network.target

[Service]
Type=simple
User=$user
Group=$user
WorkingDirectory=$wd
Environment=NODE_ENV=production
ExecStart=$node src/index.js
Restart=on-failure
RestartSec=5
MemoryMax=4G

[Install]
WantedBy=multi-user.target
EOF
  run_root systemctl daemon-reload
  run_root systemctl enable --now "$SERVICE_NAME"
  run_root systemctl --no-pager --full status "$SERVICE_NAME" || true
  green "Service $SERVICE_NAME đã enable + start"
}

firewall_open() {
  local port
  port="${PORT:-$PORT_DEFAULT}"
  if ! command -v ufw >/dev/null 2>&1; then
    run_root apt-get install -y ufw
  fi
  run_root ufw allow OpenSSH
  run_root ufw allow "${port}/tcp"
  local ufw_st
  ufw_st="$(ufw status 2>/dev/null || true)"
  if echo "$ufw_st" | grep -qi "Status: inactive"; then
    warn "UFW đang tắt. Bật với: sudo ufw --force enable  (đã allow OpenSSH + ${port})"
    if [ "$AUTO" -eq 1 ]; then
      run_root ufw --force enable
    fi
  fi
  run_root ufw status || true
}

cmd_health() {
  local port
  port="${PORT:-$PORT_DEFAULT}"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active --quiet "$SERVICE_NAME" && green "systemd: $SERVICE_NAME đang chạy" || warn "systemd: $SERVICE_NAME chưa active"
  fi
  if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    curl -sS "http://127.0.0.1:${port}/health"
    echo
    green "Health OK"
  else
    red "Không gọi được http://127.0.0.1:${port}/health"
    return 1
  fi
}

cmd_service() {
  local act="${1:-status}"
  run_root systemctl "$act" "$SERVICE_NAME"
}

full_auto() {
  check_os
  install_apt
  install_node
  install_app
  configure_env_vps
  install_systemd
  if [ "$AUTO" -eq 1 ]; then
    firewall_open
  fi
  sleep 2
  cmd_health || warn "Service có thể đang khởi động Whisper — đợi vài giây rồi chọn 6."
  echo
  green "Setup VPS xong."
  echo "  UI:        http://<IP-VPS>:${PORT:-$PORT_DEFAULT}/"
  echo "  WebSocket: ws://<IP-VPS>:${PORT:-$PORT_DEFAULT}/ws"
  echo "  Token:     grep DEVICE_TOKEN_SECRET $ROOT/.env"
  echo "  Log:       sudo journalctl -u $SERVICE_NAME -f"
}

show_menu() {
  echo
  echo "Loa Ai Agent Bridge — setup Ubuntu VPS"
  echo "Thư mục: $ROOT"
  echo
  echo "  1) Setup tự động đầy đủ (apt + Node + app + .env VPS + systemd)"
  echo "  2) Chỉ cài phụ thuộc + npm + .venv (không systemd)"
  echo "  3) Cài / bật systemd (chạy nền, reboot vẫn sống)"
  echo "  4) Ghi .env kiểu VPS (token + Whisper small + Edge TTS)"
  echo "  5) Mở firewall UFW (SSH + cổng ${PORT:-$PORT_DEFAULT})"
  echo "  6) Kiểm tra health / trạng thái"
  echo "  7) Restart service"
  echo "  8) Stop service"
  echo "  0) Thoát"
  echo
}

menu_loop() {
  check_os
  while true; do
    show_menu
    local choice=""
    read -r -p "Chọn [1-8, 0]: " choice || true
    case "$choice" in
      1) full_auto ;;
      2) install_apt; install_node; install_app ;;
      3) install_systemd ;;
      4) configure_env_vps ;;
      5) firewall_open ;;
      6) cmd_health || true ;;
      7) cmd_service restart; sleep 1; cmd_health || true ;;
      8) cmd_service stop ;;
      0|q|Q) green "Xong."; exit 0 ;;
      *) warn "Không hợp lệ. Gõ 1, 2, 3, … hoặc 0." ;;
    esac
  done
}

if [ "$AUTO" -eq 1 ]; then
  full_auto
else
  menu_loop
fi
