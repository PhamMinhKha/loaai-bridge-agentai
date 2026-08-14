# Changelog — Voice Gateway

Tất cả thay đổi đáng chú ý của dự án được ghi tại đây.

## [Unreleased] — 2026-08-14

### Added
- **Tab "📖 Cấu hình ESP32"** trên web UI (`public/index.html`): hướng dẫn cấu hình
  firmware xiaozhi-esp32 kết nối gateway. Bao gồm địa chỉ WS động (`ws://<host>/ws`),
  JSON hello mẫu (`audio_params.format=opus`), quy trình gửi audio Opus raw, bảng
  message Gateway → ESP32, tuỳ chọn `.env` và lệnh chạy. Mọi code block có nút Copy.
- File `.env.example`, `SETUP.md`, `requirements.txt`, `doc/`, `scripts/setup-dev.*`
  và các module runtime mới (`src/runtime/`, `src/audio/ttsPlayback.js`,
  `src/audio/wavUtil.js`, `src/agents/hermesRun.js`, `src/agents/openaiChat.js`).

### Changed
- **Decode Opus ưu tiên native `@discordjs/opus`**, fallback `opusscript` nếu native lỗi;
  chuẩn hoá PCM về Buffer s16le (`src/audio/opusCodec.js`).
- **Ngưỡng VAD thấp hơn** (`VOICE_ENERGY` 200 → 80) để bắt giọng nhỏ hơn trên ESP32.
- **Giữ `listening`** khi hết `LISTEN_MS`, STT trống, STT lỗi, hoặc vừa hello;
  timeout chỉ reset STT rồi arm lại vòng nghe (không đẩy `idle`).
- Xử lý `audio_start`: reset STT/VAD và quay lại `listening`.
- Flow Text (tab 2) quay về `listening` sau khi trả lời xong, giữ vòng hội thoại.
- Cập nhật agents (`hermes.js`, `openclaw.js`), `audioManager.js`, `config.js`,
  `index.js` để hỗ trợ dual-flow audio (Opus/PCM) + text và 2-tab web test bench.

### Fixed
- `pcmChunkEnergy` đọc `Int16Array` trực tiếp từ Buffer (tránh copy `ArrayBuffer`
  lệch offset, RMS = 0 → không bao giờ vào `voiceStarted`).
- Log decode/frame rỗng để debug packet Opus không ra PCM.
- State ESP32/text: sau TTS chuyển `speaking` → `listening` (chờ câu tiếp).
- Message state dùng `{type:"state", state:"..."}` thay vì `{type:"idle"}`.

## [Initial] — ESP32-S3 xiaozhi protocol
- Dual flow (audio Opus/PCM + text), 2-tab web test bench, Opus codec,
  venv311 Whisper fix.
