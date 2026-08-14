# TODO — bổ sung Voice Gateway

Cập nhật sau khi làm P0 trong code. Mục **Test thật** (máy có Edge/OpenClaw/Hermes chạy) vẫn để trống cho bạn tick khi thử.

---

## P0 — UI web: chọn TTS và Agent

- [x] Panel cấu hình trên trang test (trước Flow 1)
  - [x] Chọn **Agent**: `mock` | `openclaw` | `hermes`
  - [x] Chọn **TTS**: `none` | `pyttsx3` | `edge` | `google`
  - [x] (TTS Edge) chọn giọng, mặc định `vi-VN-HoaiMyNeural`
  - [x] (TTS Google) chọn locale, mặc định `vi`
  - [x] OpenClaw/Hermes: URL mặc định + trạng thái reachable (token lấy từ `.env`)
  - [x] Nút **Áp dụng**
  - [x] Hiện provider đang dùng
- [x] `GET /api/options` / `POST /api/options`
- [x] JSON WS `{ type: "config", agent, tts, voice }` + `config_ok`
- [x] Prefs theo socket; POST đổi default process
- [x] `resolveAgent` / `resolveTts` thay instance cố định
- [x] Hello mang `{ agent, tts, voice }`
- [x] UI báo OpenClaw/Hermes reachable hay không

---

## P0 — TTS Microsoft Edge

- [x] `requirements.txt`: `edge-tts`, `miniaudio`
- [x] Factory `createTts` + `scripts/tts_synth.py` (luôn ra WAV PCM16 16 kHz)
- [x] Xiaozhi Opus: WAV → PCM → Opus (không còn cắt header trên MP3)
- [x] Web PCM: gửi WAV cho `<audio>`
- [x] Lỗi TTS log + `AGENT_ERROR` hiện UI khi agent fail
- [x] Giọng VI/EN trên `/api/options`
- [ ] Test thật: web play + ESP32 Opus play với Edge

---

## P0 — TTS Google

- [x] Hướng **A. gTTS** (miễn phí, cần mạng)
- [x] Provider `google` trong `tts_synth.py` + factory + UI
- [x] `TTS_PROVIDER=google`, giọng `vi` / `en`
- [ ] Test thật trên UI
- [ ] (P2) Google Cloud TTS nếu cần chất lượng/SSML

---

## P0 — OpenClaw

- [x] Contract: `POST /v1/chat/completions` (OpenAI-compatible, port 18789)
- [x] `user` + `x-openclaw-session-key` = `conv:vg-{sessionId}`
- [x] Parse `choices[0].message.content`
- [x] Timeout / HTTP lỗi → `AGENT_ERROR`
- [x] `.env.example`
- [ ] Test: UI chọn OpenClaw, gateway OpenClaw đang chạy, token đúng

---

## P0 — Hermes

- [x] Contract: Hermes API server `POST http://127.0.0.1:8642/v1/chat/completions`
- [x] History theo session + header `X-Hermes-Session-Id`
- [x] `.env.example`: `HERMES_URL`, `HERMES_TOKEN`, `HERMES_MODEL`
- [x] UI hiện reachable
- [ ] Test: bật `API_SERVER_ENABLED=true`, chọn Hermes trên UI

---

## P1 — ổn định

- [x] `requirements.txt`
- [x] TTS `none` không synthesize
- [x] pyttsx3 vẫn là fallback offline
- [x] ESP32 Opus luôn PCM 16 kHz trước encode
- [ ] Ẩn player khi `tts=none`

---

## P1 — DX

- [x] `.env.example`
- [x] `GET /health` có agent/tts/stt/reachable
- [x] Log `[config]` / `[ws-prefs]`
- [ ] Tab ESP32: ví dụ hello kèm `agent`/`tts`

---

## P2 — sau này

- [ ] Streaming TTS
- [ ] `streamMessage` trên Agent
- [ ] `REQUIRE_DEVICE_TOKEN`
- [ ] STT worker theo session
- [x] Xiaozhi lấy `device_id` từ hello nếu có
- [ ] Xiaozhi: `audio_end` / `interrupt`

---

## P2 — App desktop (Windows + macOS)

Chuyển Voice Gateway từ Node server + trình duyệt thành **app desktop**, chạy nền; khi người dùng đóng cửa sổ thì **không thoát**, chỉ thu vào **khay hệ thống** (Windows: system tray / notification area; macOS: menu bar).

- [x] Chọn stack **Tauri** bọc `src/index.js` + UI `public/`
- [x] Đóng cửa sổ = ẩn, process gateway vẫn listen (HTTP/WS port)
- [x] Icon khay / menu bar: mở lại cửa sổ, trạng thái gateway, Quit thật sự
- [x] Windows: tray + Start with Windows (tùy chọn)
- [x] macOS: menu bar extra + Launch at login (tùy chọn); notarize/signing sau
- [x] Build script: `npm run tauri:build` → `.dmg` / `.app` (macOS), `.exe` (Windows)
- [x] Cài đặt lần đầu: tab Setup — Tự setup, Hermes API, Kiểm tra lỗi; STT local/OpenAI
- [x] Không phụ thuộc mở trình duyệt thủ công; UI in-app (`?app=1`)

### STT runtime (web + app)

- [x] Chọn STT: `none` | `whisper` (local, chọn model) | `openai` (API key)
- [x] Hot-swap STT runtime qua `POST /api/options`
- [x] `GET /api/diagnostics` + `POST /api/setup/dev`

### WSS LAN (P1)

- [x] `TLS_ENABLED` — HTTPS/WSS cho LAN, HTTP/WS localhost giữ nguyên
- [x] Tab Cài đặt: toggle WSS, preview URL local/LAN
- [x] Cert self-signed tự sinh `data/tls/`
- [x] Tự truyền cert qua hello WSS (`tls_cert`, `tls_cert_sha256`) + API `/api/tls/cert`
- [ ] ESP32 firmware: lưu cert từ hello vào NVS + test WSS thật trên board

