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
- `HOST=0.0.0.0` cho LAN; `HOST=127.0.0.1` khi mở qua Cloudflare Tunnel
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
- Tab **Cài đặt** (app desktop): toggle autostart, đổi port, WSS LAN, **Internet (domain công khai)**.
- UI in-app: tab **Setup & Kiểm tra** (Tự setup, Hermes, diagnostics), chọn STT Whisper/OpenAI, test mic tab Flow 1.
- Build production cần Node cài trên máy người dùng (bundle Node sidecar: P2).

**`tauri:dev` vẫn thấy UI/code cũ?**

1. Dev mode dùng repo gốc (`D:\voice-gateway`), **không** dùng snapshot trong `src-tauri\target\debug\gateway-bundle`.
2. Nếu port 8888 đã có Node cũ (lần chạy trước / tray), app **không spawn lại** — WebView vẫn load gateway cũ. Thoát hẳn app (tray → **Thoát**), rồi tắt process Node trên port đó:

```powershell
Get-NetTCPConnection -LocalPort 8888 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
```

3. Chạy lại `pnpm run tauri:dev`. Kiểm tra: `http://127.0.0.1:8888/health` → field `gatewayRoot` trỏ về thư mục repo hiện tại.

---

## 4. Cấu hình `.env`

File mẫu: [`.env.example`](./.env.example). Không commit `.env`.

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `PORT` | `8888` | HTTP + WebSocket |
| `HOST` | `0.0.0.0` | `0.0.0.0` = LAN; `127.0.0.1` = chỉ máy này (bắt buộc khi dùng Cloudflare Tunnel) |
| `TLS_ENABLED` | `false` | Bật HTTPS/WSS cho LAN (ESP32). Localhost vẫn `http`/`ws`. **Tắt** khi dùng Cloudflare Tunnel |
| `REQUIRE_DEVICE_TOKEN` | `false` | Bật khi mở `/ws` ra internet; ESP32 gửi `hello.token` |
| `DEVICE_TOKEN_SECRET` | — | Token trùng với field `token` trong hello |
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

## 4b. Cloudflare Tunnel (ra internet, hostname cố định)

Trong app: tab **Cài đặt** → **Internet (domain công khai)** → nhập hostname → bật **Mở ra internet** → **Áp dụng domain & restart**. App ghi `HOST=127.0.0.1`, tắt WSS tự ký, tạo device token. Vẫn cần `cloudflared` Named Tunnel trỏ hostname về `http://127.0.0.1:PORT`.

Gateway vẫn chạy trên máy Windows. [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) tạo ống HTTPS/WSS ra internet. Máy phải **bật 24/7**.

**Domain có đổi không?**

- **Không đổi** — Named Tunnel + Public Hostname (ví dụ `voice.yourdomain.com`). Giữ nguyên qua restart, miễn là không xóa tunnel / không đổi hostname.
- **Có đổi mỗi lần chạy** — `cloudflared tunnel --url http://127.0.0.1:8888` ra `*.trycloudflare.com`. Chỉ để test vài phút; **đừng** flash URL này vào ESP32.

Named Tunnel cần **một domain đã add vào Cloudflare** (zone). Tài khoản CF chưa đủ. Chưa có domain thì mua domain rẻ rồi trỏ nameserver vào CF — phần tunnel vẫn miễn phí.

### Bind trước khi mở tunnel

Trong `.env`:

```
HOST=127.0.0.1
TLS_ENABLED=false
REQUIRE_DEVICE_TOKEN=true
DEVICE_TOKEN_SECRET=<chuỗi bí mật dài>
```

Giữ `PORT=8888`. **Tắt WSS tự ký** — Cloudflare cấp cert thật; chồng TLS sẽ làm ESP32 verify sai. Kiểm tra `http://127.0.0.1:8888/health`.

### Tạo Named Tunnel (Windows)

1. Cài `cloudflared` (xem link trên).
2. `cloudflared tunnel login` — chọn zone/domain.
3. `cloudflared tunnel create loa-gateway` — ra UUID, file cred tại `%USERPROFILE%\.cloudflared\`.
4. Copy [scripts/cloudflared-config.example.yml](./scripts/cloudflared-config.example.yml) → `%USERPROFILE%\.cloudflared\config.yml`, sửa UUID + hostname:

```yaml
tunnel: <UUID>
credentials-file: C:\Users\Admin\.cloudflared\<UUID>.json
ingress:
  - hostname: voice.yourdomain.com
    service: http://127.0.0.1:8888
  - service: http_status:404
```

5. DNS: `cloudflared tunnel route dns loa-gateway voice.yourdomain.com` (CNAME → `<UUID>.cfargotunnel.com`).
6. Chạy: `cloudflared tunnel run loa-gateway`.
7. Cài Windows service để sống sau reboot:

```powershell
cloudflared service install
# rồi start service Cloudflared (services.msc) hoặc:
# sc start cloudflared
```

### URL client

| Client | URL |
|--------|-----|
| Browser / UI | `https://voice.yourdomain.com/` |
| ESP32 | `wss://voice.yourdomain.com/ws` |
| Health | `https://voice.yourdomain.com/health` |

ESP32 dùng cert Cloudflare (trusted), không cần provision cert tự ký như LAN. Firmware cần SNI + WSS. Path `/ws` Cloudflare proxy mặc định.

Hello ESP32 phải gửi `token` trùng `DEVICE_TOKEN_SECRET`. UI/test trên `127.0.0.1` được miễn token.

### Bảo mật

Không bật token + bind localhost = bất kỳ ai có URL đều nói chuyện với agent, đọc lịch sử, đổi options, lệnh chụp màn hình.

- `HOST=127.0.0.1` — chỉ cloudflared trên máy này vào được.
- `REQUIRE_DEVICE_TOKEN=true` — bắt buộc cho `/ws` từ internet.
- Cloudflare Access (login email) cho UI `/` nếu muốn; **không** bọc `/ws` bằng Access browser (ESP32 không làm SSO).
- `/api/options` và `/api/conversations` chỉ gọi được từ loopback thật (request qua tunnel bị 403 nhờ header `CF-Connecting-IP`).
- Coi hostname + token như secret; không share công khai.

### Giới hạn

- Tắt PC / sleep / mất mạng = offline (domain vẫn giữ).
- STT/TTS/Agent vẫn chạy trên máy nhà.
- `*.trycloudflare.com` đổi mỗi lần — không dùng cho ESP32.

---

## 5. Test thủ công

Gateway phải đang chạy (`npm run dev` hoặc `npm start`).

```bash
node test/test_device_auth.js    # token + loopback vs tunnel headers
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
