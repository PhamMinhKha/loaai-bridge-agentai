import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:8888/ws");
const SR = 16000;
// 200ms of loud sine wave (exceeds VOICE_ENERGY) as Int16 PCM
function sineChunk(freq = 440, ms = 200) {
    const n = (SR * ms) / 1000;
    const buf = Buffer.alloc(n * 2);
    const view = new Int16Array(buf.buffer, buf.byteOffset, n);
    for (let i = 0; i < n; i++) {
        view[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0x7000;
    }
    return buf;
}

ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", device_id: "whisper-001", token: "x" }));
    setTimeout(() => {
        ws.send(JSON.stringify({ type: "audio_start", format: "pcm16", sample_rate: SR }));
        // stream loud audio ~2s (keeps voiceStarted + resets silence)
        let elapsed = 0;
        const iv = setInterval(() => {
            ws.send(sineChunk());
            elapsed += 200;
            if (elapsed >= 2000) {
                clearInterval(iv);
                // stop sending -> silence 1.2s -> server cuts -> whisper runs
            }
        }, 200);
    }, 300);
});

ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    console.log("SERVER:", JSON.stringify(m));
});
ws.on("error", (e) => console.log("ERR", e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 20000);
