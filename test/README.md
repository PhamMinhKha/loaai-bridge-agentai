# Test clients

Script thủ công (không phải unit test). **Chạy gateway trước** (`npm run dev` hoặc `npm start`).

Audio mẫu nằm ở `test/fixtures/` (`test_vi.wav`, `sine.wav`).

```bash
# Từ thư mục gốc repo
node test/test_flow2.js          # xiaozhi PCM: text → agent → TTS
node test/test_client.js         # protocol gốc: hello + text
node test/test_flow1.js          # stream WAV tiếng Việt
node test/test_stt_file.js       # STT file WAV (protocol gốc)
node test/test_multi.js          # hai vòng audio
node test/test_flush.js          # StreamingSTT.flush trực tiếp (không cần WS)
node test/test_vad.js            # VAD / energy
node test/test_whisper.js        # sine → Whisper
node test/test_stt_autocut.js    # cắt câu khi im lặng
node test/test_partial.js        # partial (cần PARTIAL_ENABLED=true)
node test/test_wav.js            # [wavPath] mặc định fixtures/sine.wav
```
