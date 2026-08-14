# Changelog — Voice Gateway

Tất cả thay đổi đáng chú ý của dự án được ghi tại đây.

## [Unreleased] — 2026-08-14

### Added
- **Chụp màn hình PC** gửi qua WebSocket: client `{ "type": "screenshot" }` hoặc nói
  “chụp màn hình”; server trả JPEG base64 (`type: screenshot`). Nút trên web UI.
  JPEG tối đa **360×auto** (nặng nhẹ cho màn ESP32). Không gửi JPEG binary.
- Lệnh thoại **tạm biệt / kết thúc / good bye**: cả câu đúng cụm đó thì không gọi
  agent — về `idle`. Web (PCM) đóng WS; ESP32 giữ kết nối, bỏ audio đến `audio_start`.
- Dump STT (text + WAV) vào `data/stt/` khi `STT_DUMP=true`.
- **Tab "📖 Cấu hình ESP32"** trên web UI (`public/index.html`): hướng dẫn cấu hình
  firmware xiaozhi-esp32 kết nối gateway. Bao gồm địa chỉ WS động (`ws://<host>/ws`),
  JSON hello mẫu (`audio_params.format=opus`), quy trình gửi audio Opus raw, bảng
  message Gateway → ESP32, tuỳ chọn `.env` và lệnh chạy. Mọi code block có nút Copy.
- File `.env.example`, `SETUP.md`, `requirements.txt`, `doc/`, `scripts/setup-dev.*`
  và các module runtime mới (`src/runtime/`, `src/audio/ttsPlayback.js`,
  `src/audio/wavUtil.js`, `src/agents/hermesRun.js`, `src/agents/openaiChat.js`).

### Changed
- Whisper: `vad_filter`, `condition_on_previous_text=false`, `no_speech_threshold=0.6`
  để giảm ảo giác khi im lặng/nhiễu.
- `pause` thật sự giữ idle (bỏ audio) đến `audio_start`.
- **VAD chống pop mic**: bỏ ~900ms audio sau khi arm listen (`WARMUP_MS`);
  cần ~6 frame RMS cao liên tiếp (`HOT_FRAMES`) mới coi là bắt đầu nói.
  Ngưỡng `VOICE_ENERGY` giữ 200.
- Message `pause` → `idle` (reset STT/VAD), chờ `audio_start` mới nghe lại.
- Bỏ `audio_end` nếu chưa có tiếng (`voiceStarted`), tránh cắt phiên ảo.
- **Decode Opus ưu tiên native `@discordjs/opus`**, fallback `opusscript` nếu native lỗi;
  chuẩn hoá PCM về Buffer s16le (`src/audio/opusCodec.js`).
- **Giữ `listening`** khi hết `LISTEN_MS`, STT trống, STT lỗi, hoặc vừa hello;
  timeout chỉ reset STT rồi arm lại vòng nghe (không đẩy `idle`).
- Xử lý `audio_start`: reset STT/VAD, warmup và quay lại `listening`.
- Flow Text (tab 2) quay về `listening` sau khi trả lời xong, giữ vòng hội thoại.
- Cập nhật agents (`hermes.js`, `openclaw.js`), `audioManager.js`, `config.js`,
  `index.js` để hỗ trợ dual-flow audio (Opus/PCM) + text và 2-tab web test bench.

### Fixed
- Chặn ảo giác Whisper kiểu outro YouTube (“Hãy subscribe cho kênh Ghiền Mì Gõ…”)
  — coi như chưa nói, không gửi STT/agent.
- `pcmChunkEnergy` đọc `Int16Array` trực tiếp từ Buffer (tránh copy `ArrayBuffer`
  lệch offset, RMS = 0 → không bao giờ vào `voiceStarted`).
- Log decode/frame rỗng để debug packet Opus không ra PCM.
- State ESP32/text: sau TTS chuyển `speaking` → `listening` (chờ câu tiếp).
- Message state dùng `{type:"state", state:"..."}` thay vì `{type:"idle"}`.

## [Initial] — ESP32-S3 xiaozhi protocol
- Dual flow (audio Opus/PCM + text), 2-tab web test bench, Opus codec,
  venv311 Whisper fix.
