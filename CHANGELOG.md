# Changelog — Loa Ai Agent Bridge

Tất cả thay đổi đáng chú ý của dự án được ghi tại đây.

## [Unreleased] — 2026-08-16

### Changed
- Tab **Chat văn bản**: ô nhập đổi sang `<textarea>` nhiều dòng; **Enter** gửi, **Shift+Enter** xuống dòng.
- Tab **⚙ Cài đặt → Cổng máy chủ**: hiển thị **IP LAN**, URL HTTP và WebSocket (copy được) cho ESP32 / thiết bị trong mạng.
- Đổi agent qua UI ghi `AGENT_PROVIDER` vào `.env` (giữ sau restart gateway).

### Added
- **`wsBroadcast.js`**: broadcast cấu hình agent/STT/TTS tới mọi WebSocket đang kết nối (web + ESP32).

### Fixed
- ESP32 vẫn dùng **Mock** sau khi chuyển sang Hermes/OpenClaw trên web — kết nối cũ giữ prefs lúc hello;
  giờ nhận `config_ok` ngay khi bấm **Áp dụng** (không cần reconnect).

## [Unreleased] — 2026-08-15

### Changed
- Port mặc định HTTP/WS **3000 → 8888** (tránh trùng dev và port 6000 bị WebView2 chặn `ERR_UNSAFE_PORT`).
- **Desktop MSI/Tauri**: ẩn cửa sổ console trên bản release; bundle `gateway-bundle` ổn định hơn;
  truyền `PORT` rõ ràng khi spawn Node; log gateway tại `%LOCALAPPDATA%\Loa Ai Agent Bridge\gateway.log`;
  reload WebView khi gateway sẵn sàng; click tray navigate lại URL.
- `scripts/setup-dev.ps1`: chuỗi ASCII-only (tránh lỗi parse PowerShell 5.1 trên Windows).
- Đổi tên hiển thị app thành **Loa Ai Agent Bridge** (title bar, tray, web UI, docs, cert TLS, log server, Telegram mirror).
- **Web UI** tái cấu trúc đa tab: Giọng nói, Chat, Cấu hình, Thiết lập, ESP32, Thông tin, Cài đặt;
  header giao diện hiển thị **Loa Ai Agent Bridge** (phiên bản ở tab Thông tin).
- **macOS desktop**: icon menu bar template (`trayTemplate.png`); đóng cửa sổ → ẩn Dock (chỉ còn menu bar), mở lại → hiện Dock.
- Tab **Thông tin**: sơ đồ luồng **Loa Ai → Agent Bridge → Agent** (OpenClaw/Hermes/Mock) đổi theo agent đang chọn.
- Nút **Kết nối OpenClaw** dùng logo SVG thay emoji tia sét.
- Cài đặt port: badge **TCP** trên, **Port** và ô nhập cùng hàng, dải `1024 – 65535` bên dưới.
- Chụp màn hình: hỗ trợ Windows PowerShell tốt hơn (`scripts/screenshot.ps1`, `screenshot.js`).
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

### Added
- **Ứng dụng desktop Tauri 2** (`src-tauri/`, `npm run tauri:dev` / `tauri:build`): chạy gateway Node
  bundled, tray icon, đóng cửa sổ → ẩn vào tray, title bar `Loa Ai Agent Bridge v… - LoaAi.me`.
- **Icon app** tùy chỉnh (microphone + gateway, bo góc Dock macOS) — nguồn `scripts/app-icon.svg`,
  sinh `icon.icns` / `icon.ico` / favicon.
- Tab **ℹ️ Thông tin**: nguồn gốc Loa Ai, vai trò cầu nối OpenClaw/Hermes, nút mở [LoaAi.me](https://loaai.me).
- Tab **⚙ Cài đặt**: theme sáng/tối, đổi port TCP (1024–65535), **WSS/TLS LAN** cho ESP32,
  toggle **khởi động cùng hệ thống** (desktop + menu tray).
- **Lịch sử giọng nói** (50 cuộc gần nhất, Web + ESP32): lưu WAV gốc, nghe/tải lại trên tab Giọng nói;
  API `GET /api/conversations`, `GET /api/conversations/:id/audio` (`src/runtime/conversationHistory.js`).
- API mới: `GET /health` (version), `GET /api/server`, `POST /api/server/restart`,
  `GET /api/tls/info`, `GET /api/tls/cert`.
- TLS/WSS tự ký cho LAN (`src/runtime/tlsSetup.js`, `selfsigned`); localhost vẫn HTTP/WS.
- Setup tự động **OpenClaw** (`POST /api/setup/openclaw`, `openclawSetup.js`).
- STT **OpenAI Whisper API** (`STT_PROVIDER=openai`, `src/audio/openaiStt.js`, `sttRuntime.js`).
- Tab **⚡ Thiết lập**: dev setup, Hermes/OpenClaw one-click, diagnostics (`/api/diagnostics`).
- Runtime mới: `envFile.js`, `serverControl.js`, `devSetup.js`, `diagnostics.js`.
- Lệnh Tauri `open_external_url` + quyền shell mở link ngoài trình duyệt hệ thống.
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

### Fixed
- **macOS build màn hình trắng**: app mở từ Finder không thấy Node (PATH GUI thiếu nvm/Homebrew) —
  tìm Node tại `/opt/homebrew/bin`, `/usr/local/bin`, nvm/fnm/volta/asdf; trang loading/lỗi
  thay vì WebView trống; dialog lỗi qua `osascript` khi gateway fail.
- **`@discordjs/opus` crash bản desktop**: lazy-load native addon, fallback `opusscript` khi ABI Node
  không khớp (Homebrew vs nvm lúc build).
- **MSI cài xong không mở được UI**: Node crash với path `\\?\C:\Program Files\...` (EISDIR) —
  strip prefix extended path trước khi spawn; tìm Node tại `Program Files\nodejs` nếu PATH thiếu.
- **WebView ERR_UNSAFE_PORT** khi dùng port 6000 (Chromium chặn port X11) — chuyển mặc định sang 8888.
- Hộp thoại lỗi + vẫn hiện tray/cửa sổ khi gateway khởi động chậm hoặc thất bại lần đầu.
- Nút/link **Mở LoaAi.me**: chữ trắng trên nền xanh, mở URL qua Tauri shell thay vì bị chặn webview.
- Chặn ảo giác Whisper kiểu outro YouTube (“Hãy subscribe cho kênh Ghiền Mì Gõ…”)
  — coi như chưa nói, không gửi STT/agent.
- `pcmChunkEnergy` đọc `Int16Array` trực tiếp từ Buffer (tránh copy `ArrayBuffer`
  lệch offset, RMS = 0 → không bao giờ vào `voiceStarted`).
- Log decode/frame rỗng để debug packet Opus không ra PCM.
- State ESP32/text: sau TTS chuyển `speaking` → `listening` (chờ câu tiếp).
- Message state dùng `{type:"state", state:"..."}` thay vì `{type:"idle"}`.

### Added (Cloudflare Tunnel — internet công khai)
- **`src/runtime/cloudflareTunnel.js`**: tự cài `cloudflared` (winget), login CF, tạo tunnel,
  ghi `config.yml`, trỏ DNS, chạy tunnel, test URL công khai, cài Windows service;
  `setupTunnelAuto` (bước 4→8), `setupTunnelFull` (một lần bấm), `buildEsp32HelloConfig`.
- API tunnel (loopback-only): `GET /api/tunnel/status`, `POST /api/tunnel/setup-full`,
  `POST /api/tunnel/setup-auto`, `GET /api/tunnel/esp32-config`, và các endpoint từng bước
  (write-config, route-dns, create, start/stop, install-service, test-public).
- **`src/runtime/deviceAuth.js`**: bắt buộc `hello.token` khi `REQUIRE_DEVICE_TOKEN=true`;
  loopback được miễn.
- **`src/runtime/clientAddress.js`**: nhận diện client qua Cloudflare proxy headers.
- Chặn `/api/options`, `/api/conversations` và API quản trị khỏi non-loopback khi bật internet.
- **Web UI** (tab Cài đặt → Internet): hostname cố định, device token, áp dụng & restart;
  modal hướng dẫn với **Thiết lập tự động (1 lần bấm)**, **Kiểm tra trạng thái**, copy JSON ESP32.
- `scripts/cloudflared-config.example.yml`, cập nhật `SETUP.md`, `.env.example` (`HOST`, `PUBLIC_*`,
  `CLOUDFLARED_PATH`, `REQUIRE_DEVICE_TOKEN`).
- Test: `test/test_cloudflare_tunnel.js`, `test/test_device_auth.js`.
- `/health` thêm `features.apiVersion` (desktop app phát hiện gateway cũ).

### Changed (Cloudflare Tunnel)
- Gateway bind **`HOST=127.0.0.1`** khi bật `PUBLIC_ENABLED`; tắt WSS tự ký — Cloudflare cấp HTTPS/WSS.
- Tauri dev: luôn dùng repo gốc (không snapshot `gateway-bundle` cũ); tự kill gateway thiếu
  `apiVersion` mới trên port 8888.
- Tìm `cloudflared.exe` tại `Program Files (x86)`, WinGet Packages; tự `winget --force` khi
  winget báo đã cài nhưng thiếu file; lưu `CLOUDFLARED_PATH` vào `.env`.

### Fixed (Cloudflare Tunnel)
- Gateway cũ chiếm port 8888 khiến UI báo "Server trả HTML" — detect qua `apiVersion` và restart.
- Spawn `cloudflared` với đường dẫn có khoảng trắng (`Program Files (x86)`).

### Changed (defaults & UX)
- **Device token mặc định** cố định `helloloaai` thay vì random mỗi lần bật internet
  (`DEFAULT_DEVICE_TOKEN` trong `serverControl.js`, dùng chung cho tunnel/ESP32).
- **TTS mặc định** `edge` (Edge TTS, giọng `vi-VN-HoaiMyNeural`) thay vì `none` / `pyttsx3`.
- **Web UI**: placeholder device token hiển thị mặc định; ẩn card **Bảo mật WSS (LAN)** khi dùng Cloudflare Tunnel.
- **Desktop Tauri**: cửa sổ chính **1024×880** (trước 900×780).
- **Desktop macOS**: mở cửa sổ với trang loading trước, navigate sang gateway khi `/health` sẵn sàng;
  feature `webview-data-url` cho trang lỗi nội bộ.

## [Initial] — ESP32-S3 xiaozhi protocol
- Dual flow (audio Opus/PCM + text), 2-tab web test bench, Opus codec,
  venv311 Whisper fix.
