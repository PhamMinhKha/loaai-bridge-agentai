import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:3000/ws");
const PCM = Buffer.alloc(1024, 128); // fake audio chunk

ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", device_id: "vad-001", token: "x" }));
    setTimeout(() => {
        ws.send(JSON.stringify({ type: "audio_start", format: "pcm16", sample_rate: 16000 }));
        // stream 5 chunks ~ every 200ms (keeps silence timer reset)
        let i = 0;
        const iv = setInterval(() => {
            ws.send(PCM); // binary
            if (++i >= 5) clearInterval(iv);
        }, 200);
        // after last chunk, stop sending -> silence > SILENCE_MS -> server cuts
    }, 300);
});

ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    console.log("SERVER:", JSON.stringify(m));
});

ws.on("error", (e) => console.log("ERR", e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 4000);
