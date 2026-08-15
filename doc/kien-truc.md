# Kiến trúc mã nguồn

## Vai trò hệ thống

```
ESP32 (Opus) ─┐
              ├─► WebSocket /ws ─► Loa Ai Agent Bridge ─► Whisper (Python)
Trình duyệt ──┘         │                              │
  (PCM 16k)             │                              ▼
                        │                         Agent (mock / OpenClaw / Hermes)
                        │                              │
                        ◄──────── TTS audio (WAV hoặc Opus) ◄─┘
```

Gateway **không** chứa firmware. Firmware chỉ cần tuân thủ protocol WebSocket.

## Cây thư mục (phần runtime)

```
src/
  index.js                 # HTTP + Express static + gắn WS + STT/TTS/Agent
  config/config.js         # Đọc .env
  server/
    websocket.js           # Protocol gốc (hello không có audio_params opus/pcm)
    xiaozhi.js             # Protocol xiaozhi-esp32 (hello có audio_params.format)
  protocol/messages.js     # Builder JSON phía protocol gốc
  sessions/sessionManager.js
  agents/                  # mock | openclaw | hermes
  audio/
    audioManager.js        # StreamingSTT, EdgeTTS, Pyttsx3TTS
    opusCodec.js           # Encode/decode Opus 16kHz, frame 60ms
scripts/
  whisper_stream.py        # Worker Whisper sống lâu (stdin control C/F/P/R)
  whisper_stt.py           # Whisper one-shot (file WAV) — dùng bởi STTManager
public/index.html          # Test bench: mic PCM + text, handshake xiaozhi
```

## Điểm vào: `src/index.js`

1. Tạo Express: `GET /health`, static `public/`.
2. `createAgent(config)` theo `AGENT_PROVIDER`.
3. `StreamingSTT` luôn được tạo (Whisper stream nếu `STT_PROVIDER=whisper`).
4. TTS: `edge-tts` → `EdgeTTS`; `pyttsx3` → `Pyttsx3TTS`; còn lại → `TTSManager` (no-op/`none`).
5. `createWebSocketServer(httpServer, agent, stt, tts, { silenceMs, listenMs })`.
6. Listen `PORT` (mặc định 8888).

**Lưu ý:** một instance `StreamingSTT` dùng chung cho mọi socket. Worker Python là single-thread FIFO — nhiều client đồng thời sẽ xếp hàng trên cùng một process Whisper.

## Session

`sessionManager.js` giữ `Map(deviceId → { sessionId, deviceId, createdAt, state })` **in-memory**. Mất khi restart. `sessionId` là UUID, gửi cho client và agent.

`REQUIRE_DEVICE_TOKEN` / `DEVICE_TOKEN_SECRET` đã có trong config nhưng **chưa được kiểm tra** trên handshake.

## Agent

| Provider | Class | Hành vi |
|----------|--------|---------|
| `mock` | `MockAdapter` | Echo / vài câu tiếng Việt cứng |
| `openclaw` | `OpenClawAdapter` | `POST {url}/api/chat` `{ session_id, message }` |
| `hermes` | `HermesAdapter` | Cùng hình dạng HTTP như OpenClaw |

Interface: `sendMessage({ sessionId, text }) → { text }`. `streamMessage` khai báo nhưng chưa dùng.

## Audio / codec

| Thành phần | Chi tiết |
|------------|----------|
| PCM nội bộ | 16-bit LE, mono, 16 kHz |
| VAD | RMS energy trên chunk PCM; ngưỡng `VOICE_ENERGY = 200` |
| Opus | `@discordjs/opus` encode, `opusscript` decode; frame 60 ms = 960 sample = 1920 byte PCM |
| STT stream | Control byte stdin: `C`+len+pcm, `F` flush+clear, `P` partial giữ buffer, `R` reset |
| TTS pyttsx3 | WAV PCM16 (thường có header 44 byte; xiaozhi Opus cắt `subarray(44)`) |
| TTS edge-tts | MP3 (protocol gốc gửi nguyên buffer; xiaozhi Opus giả định WAV — không khớp edge-tts) |

## Biến môi trường chính

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `PORT` | `8888` | HTTP/WS |
| `AGENT_PROVIDER` | `mock` | `mock` \| `openclaw` \| `hermes` |
| `OPENCLAW_URL` / `TOKEN` | — | Backend OpenClaw |
| `HERMES_URL` / `TOKEN` | — | Backend Hermes |
| `STT_PROVIDER` | `none` | `whisper` mới ra text |
| `WHISPER_MODEL` | `medium` | Model faster-whisper |
| `WHISPER_PYTHON` | `python` | Interpreter worker |
| `TTS_PROVIDER` | `none` | `pyttsx3` \| `edge-tts` |
| `TTS_VOICE` | `vi-VN-HoaiMyNeural` | Giọng edge-tts |
| `TTS_RATE` | `160` | Tốc độ pyttsx3 |
| `SILENCE_MS` | `1200` | Im lặng → chốt câu (protocol gốc đọc opts/env; xiaozhi hardcode 1200) |
| `LISTEN_MS` | `30000` | Chờ tiếng đầu; hết hạn → idle |
| `PARTIAL_ENABLED` | `false` | Transcript từng phần (chỉ protocol gốc) |
