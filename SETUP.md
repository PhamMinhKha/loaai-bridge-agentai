# Setup — Loa Ai Agent Bridge

Gateway Node.js (**Loa Ai Agent Bridge**): ESP32 / trình duyệt ↔ STT (Whisper) ↔ Agent (mock / OpenClaw / Hermes) ↔ TTS.

## Yêu cầu

| Công cụ | Phiên bản | Ghi chú |
|---------|-----------|---------|
| Node.js + npm | ≥ 18 | https://nodejs.org |
| Python | ≥ 3.10 | STT Whisper + TTS |
| (macOS) Xcode CLT | — | `xcode-select --install` để build Opus |
| (Windows) VS Build Tools | tùy chọn | nếu `npm install` lỗi native `@discordjs/opus` |

Cần mạng lần đầu (npm, pip, model Whisper, Edge/Google TTS).

---

## 1. Cài đặt development (tự động)

Clone repo, chạy **một** lệnh:

**Windows** (PowerShell):

```powershell
cd voice-gateway
powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
```

Hoặc double-click `scripts\setup-dev.bat`.

**macOS / Linux:**

```bash
cd voice-gateway
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

**Mọi hệ điều hành** (đã có Node):

```bash
npm run setup:dev
```

Script sẽ:

1. Kiểm tra Node ≥ 18 và Python
2. `npm install`
3. Tạo `.venv` và `pip install -r requirements.txt`
4. Copy `.env.example` → `.env` nếu chưa có
5. Ghi `WHISPER_PYTHON` / `TTS_PYTHON` trỏ vào Python trong `.venv`

---

## 2. Chạy development

Tự reload khi sửa `src/`:

```bash
npm run dev
```

Mở:

- UI test: http://localhost:8888
- Health: http://localhost:8888/health
- WebSocket: `ws://localhost:8888/ws`

Đổi Agent / TTS ngay trên UI (không cần restart). STT Whisper vẫn lấy từ `.env`.

Log: chọn Mock + pyttsx3 trước khi nối OpenClaw/Hermes.

---

## 3. Chạy production

Không dùng `--watch`. Cấu hình thật trong `.env` rồi:

```bash
npm start
```

Gợi ý:

- `PORT` — cổng HTTP/WS (mặc định 8888)
- `STT_PROVIDER=whisper` và `WHISPER_MODEL` phù hợp máy (CPU: `base` / `small`; mạnh hơn: `medium`)
- `TTS_PROVIDER=edge` hoặc `google` (cần mạng) hoặc `pyttsx3` (Windows offline)
- `AGENT_PROVIDER=openclaw` hoặc `hermes` + URL/token
- Firewall: mở `PORT` trên LAN nếu ESP32 kết nối `ws://<IP_PC>:8888/ws`

Process manager (tùy chọn):

```bash
# Windows (NSSM / pm2) hoặc macOS launchd
npx pm2 start src/index.js --name voice-gateway
```

Chạy nền Windows đơn giản: `start_vg.bat` (cùng thư mục repo).

---

## 3b. App desktop (Tauri)

Yêu cầu thêm: **Rust** (`rustc`, `cargo`) và **Node** trên PATH.

```bash
npm run setup:dev    # lần đầu
npm run tauri:dev    # dev: spawn gateway + cửa sổ app + tray
npm run tauri:build  # đóng gói .dmg (macOS) / .exe (Windows)
```

- Đóng cửa sổ → ẩn vào tray (Windows) / menu bar (macOS); gateway vẫn chạy nền.
- Tray / menu bar → **Mở Loa Ai Agent Bridge** / bật **Khởi động cùng Windows** hoặc **Launch at login** / **Thoát**.
- Tab **Cài đặt** (app desktop): toggle autostart, đổi port, WSS LAN.
- UI in-app: tab **Setup & Kiểm tra** (Tự setup, Hermes, diagnostics), chọn STT Whisper/OpenAI, test mic tab Flow 1.
- Build production cần Node cài trên máy người dùng (bundle Node sidecar: P2).

---

## 4. Cấu hình `.env`

File mẫu: [`.env.example`](./.env.example). Không commit `.env`.

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `PORT` | `8888` | HTTP + WebSocket |
| `TLS_ENABLED` | `false` | Bật HTTPS/WSS cho LAN (ESP32). Localhost vẫn `http`/`ws` |
| `TLS_CERT_PATH` | `data/tls/gateway.crt` | Cert PEM (tự sinh nếu trống) |
| `TLS_KEY_PATH` | `data/tls/gateway.key` | Private key PEM |
| `STT_PROVIDER` | `whisper` | `none` \| `whisper` |
| `WHISPER_MODEL` | `medium` | Model faster-whisper |
| `WHISPER_PYTHON` | `.venv` sau setup | Interpreter STT |
| `TTS_PROVIDER` | `pyttsx3` | `none` \| `pyttsx3` \| `edge` \| `google` |
| `TTS_VOICE` | `vi-VN-HoaiMyNeural` | Giọng Edge |
| `TTS_PYTHON` | `.venv` sau setup | Interpreter TTS |
| `AGENT_PROVIDER` | `mock` | `mock` \| `openclaw` \| `hermes` |
| `OPENCLAW_URL` | `http://127.0.0.1:18789` | Gateway OpenClaw (`/v1/chat/completions`) |
| `OPENCLAW_TOKEN` | — | Bearer token |
| `HERMES_URL` | `http://127.0.0.1:8642` | Hermes API server |
| `HERMES_TOKEN` | — | Trùng `API_SERVER_KEY` |
| `LISTEN_MS` | `30000` | Chờ tiếng đầu |
| `SILENCE_MS` | `1200` | Im lặng → chốt câu |

OpenClaw: bật `gateway.http.endpoints.chatCompletions`. Hermes: `API_SERVER_ENABLED=true`.

### WSS cho LAN (ESP32)

Tab **Cài đặt** → bật **WSS cho LAN** → **Áp dụng & restart**.

| Client | URL |
|--------|-----|
| Tauri / trình duyệt local | `http://127.0.0.1:PORT/` · `ws://127.0.0.1:PORT/ws` |
| ESP32 / thiết bị LAN | `https://<IP-PC>:PORT/` · `wss://<IP-PC>:PORT/ws` |

Cert self-signed được tạo tại `data/tls/` (SAN: localhost, 127.0.0.1, IP LAN). ESP32 **không cần embed firmware**: lần đầu kết nối WSS (insecure), gateway tự gửi `tls_cert` trong hello — lưu NVS rồi verify các lần sau. Hoặc copy cert từ tab Cài đặt / `GET /api/tls/cert`.

---

## 5. Test thủ công

Gateway phải đang chạy (`npm run dev` hoặc `npm start`).

```bash
node test/test_flow2.js          # hello + text → agent + TTS
node test/test_client.js         # protocol gốc, text
node test/test_flow1.js          # gửi WAV fixtures/test_vi.wav
```

Chi tiết: [test/README.md](./test/README.md).

---

## 6. Cài tay (nếu không dùng script)

```bash
npm install
python3 -m venv .venv
# Windows: .venv\Scripts\python -m pip install -r requirements.txt
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env   # Windows: copy .env.example .env
# Sửa WHISPER_PYTHON và TTS_PYTHON trỏ tới python trong .venv
npm run dev
```

---

## Tài liệu khác

- [doc/README.md](./doc/README.md) — luồng hoạt động, kiến trúc, TODO
- [ESP32_INTEGRATION.md](./ESP32_INTEGRATION.md) — protocol firmware
