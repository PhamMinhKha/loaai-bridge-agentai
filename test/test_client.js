import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:3000/ws");
const log = [];
ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", device_id: "test-001", token: "x" }));
    setTimeout(() => {
        ws.send(JSON.stringify({ type: "text", text: "Bạn là ai?" }));
    }, 300);
    setTimeout(() => {
        ws.send(JSON.stringify({ type: "text", text: "thời tiết hôm nay thế nào" }));
    }, 600);
});
ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    log.push(m);
    console.log("SERVER:", JSON.stringify(m));
});
ws.on("error", (e) => console.log("ERR", e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 1500);
