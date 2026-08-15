# Loa Ai Agent Bridge — tài liệu luồng hoạt động

Gateway Node.js đứng giữa thiết bị thoại (ESP32 / trình duyệt) và pipeline **STT → Agent → TTS**.

| Tài liệu | Nội dung |
|----------|----------|
| [luong-hoat-dong.md](./luong-hoat-dong.md) | Luồng runtime: khởi động, handshake, VAD, STT, agent, TTS, trạng thái |
| [kien-truc.md](./kien-truc.md) | Cấu trúc thư mục, vai trò từng module, biến môi trường |
| [TODO.md](./TODO.md) | Việc còn thiếu |
| [../SETUP.md](../SETUP.md) | Cài đặt, chạy dev / production |

Chạy: xem [SETUP.md](../SETUP.md) (script `npm run setup:dev`, `npm run dev`, `npm start`).

- HTTP: `http://localhost:8888` (trang test `public/index.html`)
- Health: `GET /health`
- WebSocket: `ws://<host>:8888/ws`
