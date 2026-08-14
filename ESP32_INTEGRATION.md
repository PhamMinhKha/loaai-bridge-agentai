# ESP32 Firmware Integration (Server side)

Gateway đã sẵn sàng nhận kết nối từ firmware ESP32 của bạn. Không cần code firmware ở đây — chỉ cần firmware tuân thủ protocol WebSocket dưới.

## Kết nối

```
ws://<PC_IP>:3000/ws
```

## Protocol (ESP32 → Gateway)

### 1. hello (JSON)
```json
{ "type": "hello", "device_id": "esp32-001", "token": "test" }
```
Gateway trả:
```json
{ "type": "hello_ack", "device_id": "esp32-001", "session_id": "..." }
```

### 2. audio_start (JSON)
```json
{ "type": "audio_start", "format": "pcm16", "sample_rate": 16000, "channels": 1 }
```

### 3. Binary PCM16 chunks
Gửi raw PCM16 mono 16kHz trực tiếp qua frame binary WebSocket (không base64).
Gateway tự phát hiện tiếng (energy) và tự ngắt câu sau 1.2s im lặng (VAD server-side).
- `LISTEN_MS=30000`: từ idle→listening chờ có tiếng tối đa 30s
- `SILENCE_MS=1200`: đang nói mà im lặng 1.2s → tự chốt câu

### 4. audio_end (JSON, tùy chọn)
```json
{ "type": "audio_end" }
```
Nếu firmware đã tự cắt VAD cục bộ, gửi audio_end để chốt ngay. Nếu không gửi, server tự ngắt theo SILENCE_MS.

## Gateway → ESP32

| Message | Ý nghĩa |
|---------|---------|
| `{"type":"state","state":"listening"}` | Đang nghe |
| `{"type":"state","state":"processing"}` | Đang xử lý audio |
| `{"type":"transcript_partial","text":"..."}` | Text đang nhận diện (từng phần) |
| `{"type":"transcript","text":"..."}` | Text cuối câu |
| `{"type":"state","state":"thinking"}` | Agent suy nghĩ |
| `{"type":"state","state":"speaking"}` | Đang phát tiếng |
| `{"type":"agent_message","text":"..."}` | Câu trả lời text |
| `{"type":"audio_start","format":"wav","sample_rate":16000}` + binary + `{"type":"audio_end"}` | TTS audio để phát qua speaker |

## Config (.env)
- `STT_PROVIDER=whisper`, `WHISPER_MODEL=medium` (local, không cần mạng)
- `TTS_PROVIDER=pyttsx3` (offline Windows SAPI) hoặc `edge-tts` (cần mạng)
- `AGENT_PROVIDER=mock|openclaw|hermes`

## Chạy
```bash
npm install
node src/index.js
# ESP32 connect ws://<pc_ip>:3000/ws
```
