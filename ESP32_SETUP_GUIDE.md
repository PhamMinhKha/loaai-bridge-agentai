# Hướng dẫn cấu hình ESP32-S3 kết nối Loa Ai Agent Bridge

Hướng dẫn code firmware ESP32-S3 (board `esp-vocat`, firmware `xiaozhi-esp32`) để
nói chuyện với **Loa Ai Agent Bridge** chạy trên PC (Windows). Bridge xử lý STT → Agent
→ TTS, ESP32 chỉ lo thu phát audio + giao tiếp WebSocket.

---

## 1. Chuẩn bị

### 1.1 PC (chạy Gateway)
- Gateway đã chạy: `node src/index.js` → lắng nghe `http://<PC_IP>:8888`
- ESP32 và PC **cùng mạng LAN** (WiFi hoặc Ethernet).
- Lấy IP của PC (cmd: `ipconfig` → IPv4, ví dụ `192.168.1.132`).

### 1.2 ESP32-S3
- Board: `esp-vocat` (hoặc bất kỳ ESP32-S3 có mic + speaker).
- Firmware base: `github.com/78/xiaozhi-esp32`
- Toolchain: ESP-IDF v5.x.

---

## 2. Thông số kết nối (phải khớp với Gateway)

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| Protocol | WebSocket | |
| URL (mặc định) | `ws://<PC_IP>:8888/ws` | Port lấy từ `PORT` trong `.env` |
| URL (WSS bật) | `wss://<PC_IP>:8888/ws` | Bật trong tab **Cài đặt** → **WSS cho LAN** |
| URL (Cloudflare Tunnel) | `wss://voice.yourdomain.com/ws` | Named Tunnel; hostname cố định. Tắt WSS tự ký của gateway. Xem [SETUP.md](./SETUP.md) mục 4b |
| Audio format | **Opus** | Gateway decode Opus → PCM16 rồi chạy Whisper |
| Sample rate | `16000` Hz | |
| Channels | `1` (mono) | |
| Frame duration | `60` ms | 1 packet Opus = 60ms (960 samples) |
| Codec | Opus (raw, không header) | frame binary thô, version 1 |

> Gateway cũng hỗ trợ `format:"pcm"` (PCM16 thô) cho web test, nhưng firmware
> thật nên dùng **Opus** để tiết kiệm băng thông.

### 2.1 WSS (bảo mật LAN)

1. Mở Loa Ai Agent Bridge → tab **Cài đặt** → bật **WSS cho LAN** → restart.
2. ESP32 dùng `wss://<PC_IP>:8888/ws` thay `ws://`.
3. **Tự nhận cert (khuyến nghị)** — không cần embed vào firmware:
   - Lần đầu: kết nối WSS với **bỏ qua verify cert** (insecure / `setInsecure()`).
   - Gateway gửi ngay trong JSON `hello` / `hello_ack`:
     - `tls_cert` — PEM public cert
     - `tls_cert_sha256` — fingerprint để kiểm tra
   - ESP32 lưu `tls_cert` vào **NVS/flash**, các lần sau verify bình thường.
4. **Copy cert thủ công** (nếu firmware hỗ trợ): tab Cài đặt → **Copy cert PEM**, hoặc `GET /api/tls/cert`.
5. Cert file trên PC: `data/tls/gateway.crt`.

Nếu đổi IP LAN, xóa `data/tls/` và restart để tạo lại cert SAN.

### 2.2 Internet qua Cloudflare Tunnel

Không dùng IP LAN. ESP32 kết nối `wss://voice.yourdomain.com/ws` (cert Cloudflare, verify bình thường — không insecure, không lưu `tls_cert` tự ký).

Trong `.env` gateway: `HOST=127.0.0.1`, `TLS_ENABLED=false`, `REQUIRE_DEVICE_TOKEN=true`, `DEVICE_TOKEN_SECRET=...`. Field `token` trong hello **phải** trùng secret. Chi tiết tạo tunnel: [SETUP.md](./SETUP.md) mục 4b.

`*.trycloudflare.com` đổi mỗi lần chạy — đừng flash vào firmware.

**Ví dụ xử lý hello trên ESP32 (pseudo):**

```c
// Lần đầu: client.setInsecure() hoặc tương đương ESP-IDF
// Sau khi nhận hello JSON:
if (cJSON_GetObjectItem(root, "tls_cert")) {
    nvs_set_str(nvs, "vg_tls_cert", tls_cert_pem);
    nvs_commit(nvs);
}
// Lần sau: load từ NVS, setRootCA, không dùng insecure
```

---

## 3. Luồng kết nối (state machine)

```
ESP32                                          Gateway (PC)
  |---- WebSocket connect ws://<PC_IP>:8888/ws -->|
  |                                               |
  |<--- server hello {type:"hello", session_id,   |
  |                 audio_params{sr:16000,frame:60}}|
  |                                               |
  |---- client hello (JSON) ---------------------->|  (xem §4)
  |<--- {type:"state", state:"listening"} ---------|
  |                                               |
  |==== Opus audio frames (binary) ===============>|  (nói vào mic)
  |                                               |  Gateway tự VAD:
  |                                               |  - có tiếng -> listening
  |                                               |  - im 1.2s   -> tự chốt câu
  |<--- {type:"state", state:"processing"} -------|
  |<--- {type:"stt", text:"..."} -----------------|  (STT kết quả)
  |<--- {type:"state", state:"thinking"} ---------|
  |<--- {type:"state", state:"speaking"} ---------|
  |<--- {type:"tts", state:"start", text:"..."} --|
  |<--- Opus audio frames (binary) ================|  (TTS trả về)
  |<--- {type:"tts", state:"stop"} ---------------|
  |<--- {type:"state", state:"listening"} --------|  (quay lại chờ câu tiếp)
  |                                               |
  |   (nếu 30s không nói gì)                       |
  |<--- {type:"state", state:"idle"} -------------|
```

---

## 4. Client Hello (gửi ngay sau khi WebSocket mở)

ESP32 gửi JSON chào server (trước khi stream audio):

```json
{
  "type": "hello",
  "version": 1,
  "device_id": "esp32-001",
  "token": "<DEVICE_TOKEN_SECRET>",
  "transport": "websocket",
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

Gateway trả lời (server hello) rồi chuyển sang `listening`:

```json
{
  "type": "hello",
  "session_id": "abc123...",
  "transport": "websocket",
  "audio_params": { "sample_rate": 16000, "frame_duration": 60 }
}
```

> Nếu `audio_params.format` khác `"opus"`/`"pcm"`, Gateway coi là client thường
> (không phải xiaozhi) và đòi `device_id` + `token` riêng. **Nhớ gửi format đúng.**

---

## 5. Gửi audio (ESP32 → Gateway)

- Mỗi **frame binary WebSocket** = 1 packet Opus (60ms @ 16kHz mono).
- Gateway tự VAD:
  - Phát hiện tiếng → báo `state:"listening"`.
  - Im lặng `SILENCE_MS=1200` ms → tự chốt câu, chạy STT.
  - Nếu firmware đã cắt VAD cục bộ → gửi `{"type":"audio_end"}` để chốt ngay.
- Từ lúc `listening`, nếu `LISTEN_MS=30000` ms không có tiếng → tự về `idle`.

Ví dụ gửi binary (pseudo-code ESP-IDF):

```c
// encode PCM16 (16k mono) thành Opus 60ms, gửi raw qua WebSocket binary frame
size_t opus_len = opus_encode(encoder, pcm_frame_960samples, 960, opus_buf, MAX_OPUS);
websocket_send_binary(opus_buf, opus_len);   // 1 frame = 1 message
```

---

## 6. Nhận phản hồi (Gateway → ESP32)

ESP32 xử lý các message JSON sau:

| Message | Ý nghĩa | Xử lý trên ESP32 |
|---------|---------|------------------|
| `{"type":"state","state":"listening"}` | Đang nghe mic | Bật mic, thu audio |
| `{"type":"state","state":"processing"}` | Đang decode/xử lý | Tắt mic tạm |
| `{"type":"stt","text":"..."}` | STT kết quả câu | Hiển thị (tùy chọn) |
| `{"type":"state","state":"thinking"}` | Agent suy nghĩ | Chờ |
| `{"type":"state","state":"speaking"}` | Đang phát TTS | Chuẩn bị speaker |
| `{"type":"tts","state":"start","text":"..."}` | Bắt đầu TTS (có text) | Log text |
| `Opus frames (binary)` | Audio TTS | Decode Opus → PCM → phát speaker |
| `{"type":"tts","state":"stop"}` | Kết thúc TTS | Ngưng phát |
| `{"type":"state","state":"idle"}` | Hết timeout, nghỉ | Chờ lần nói sau |

> Lưu ý: format state nhận được là **`{type:"state", state:"..."}`**, KHÔNG phải
> `{type:"idle"}` riêng lẻ. Một số bản cũ hay nhầm chỗ này.

---

## 7. Cấu hình `.env` trên PC (Gateway)

File `D:\voice-gateway\.env` (mẫu xem `.env.example`):

```ini
PORT=8888

# STT: Whisper local (không cần mạng)
STT_PROVIDER=whisper
WHISPER_MODEL=medium
WHISPER_PYTHON=python          # dùng venv311 (Python 3.11) cho Whisper

# TTS: pyttsx3 offline (Windows SAPI) hoặc edge-tts (cần mạng)
TTS_PROVIDER=pyttsx3
TTS_VOICE=vi-VN-HoaiMyNeural
TTS_PYTHON=python

# Agent: mock | openclaw | hermes
AGENT_PROVIDER=mock

# Timeout VAD / chờ
LISTEN_MS=30000                # chờ có tiếng tối đa 30s rồi về idle
SILENCE_MS=1200                # im lặng 1.2s -> tự chốt câu
PARTIAL_ENABLED=false           # STT từng phần (tắt để giảm latency)
```

---

## 8. Chạy thử

### PC (Gateway)
```bash
cd D:\voice-gateway
npm install
node src/index.js
# log: "Loa Ai Agent Bridge listening on :8888 (agent=mock)"
```

### ESP32 (flash)
1. Build firmware `xiaozhi-esp32` với config:
   - WiFi SSID/pass (cùng LAN với PC).
   - WebSocket server: `ws://<PC_IP>:8888/ws`
   - Audio: Opus, 16kHz, mono, 60ms frame.
2. Flash & monitor:
   ```bash
   idf.py build flash monitor
   ```
3. Nói vào mic ESP32 → nghe tiếng trả lời từ speaker.

### Kiểm tra nhanh qua Web (không cần ESP32)
Mở `http://<PC_IP>:8888` → tab **Flow 1 (Mic)** hoặc **Flow 2 (Text)** để test
Gateway trước. Tab **📖 Cấu hình ESP32** có sẵn bản hướng dẫn này trên giao diện.

---

## 9. Xử lý lỗi thường gặp

| Triệu chứng | Nguyên nhân | Sửa |
|-------------|------------|-----|
| Connect fail | Sai IP / port, hoặc khác LAN | Check `ipconfig`, `PORT` trong `.env` |
| WSS connect fail | Cert chưa lưu trên ESP32 | Lần đầu WSS + insecure, lưu `tls_cert` từ hello vào NVS |
| Gateway báo `UNKNOWN_MESSAGE` | Gửi hello thiếu `audio_params.format` | Thêm `"format":"opus"` vào hello |
| Không nghe TTS / loạn tiếng | Sai frame size Opus (không 60ms) | Đảm bảo 960 samples/frame |
| Kẹt ở `idle` sau 1 câu | Đúng behaviour (30s timeout) | Gửi audio mới để wake lên |
| Mic không thu được | ESP32 chưa bật mic khi `listening` | Xem state machine §3 |

---

## 10. Tóm tắt các điểm cốt lõi để code firmware

1. Connect `ws://<PC_IP>:8888/ws`.
2. Nhận server hello → gửi client hello có `audio_params.format="opus"`.
3. Khi Gateway báo `state:"listening"` → thu mic, encode Opus 60ms/frame, gửi binary.
4. Khi Gateway báo `state:"speaking"` → decode Opus binary thành PCM, phát speaker.
5. Lặp lại vòng 3-4 cho tới khi `state:"idle"` (nghỉ 30s).

Firmware chỉ cần tuân thủ protocol trên — **Gateway không cần sửa code firmware**.
