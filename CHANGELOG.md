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
- **Flow Text (tab 2) quay về `listening` sau khi trả lời xong** thay vì `idle`,
  giữ vòng lặp hội thoại liên tục (`src/server/xiaozhi.js`, `src/server/websocket.js`).
- **Tự động về `idle` sau 30s** (LISTEN_MS) nếu không có tiếng mới — fix lỗi
  server gửi sai format `{type:"idle"}` thành `{type:"state", state:"idle"}`
  (client/web/ESP32 không hiểu message cũ nên dot không đổi). Sửa 4 chỗ trong
  `src/server/xiaozhi.js`.
- Cập nhật agents (`hermes.js`, `openclaw.js`), `audioManager.js`, `config.js`,
  `index.js` để hỗ trợ dual-flow audio (Opus/PCM) + text và 2-tab web test bench.
- Loại bỏ các test script cũ (`test_client.js`, `test_stt_autocut.js`,
  `test_stt_file.js`, `test_vad.js`, `test_whisper.js`).

### Fixed
- State machine ESP32/text: sau TTS xong chuyển `speaking` → `listening` (chờ câu
  tiếp) → `idle` (sau timeout), thay vì kẹt ở `idle`.
- `vg_run.log` không còn bị track (đã bỏ khỏi git index; chỉ ignore runtime log).

## [Initial] — ESP32-S3 xiaozhi protocol
- Dual flow (audio Opus/PCM + text), 2-tab web test bench, Opus codec,
  venv311 Whisper fix.
