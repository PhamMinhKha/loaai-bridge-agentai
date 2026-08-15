import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const b = fs.readFileSync(path.join(__dirname, "fixtures", "test_vi.wav"));
const off = b.indexOf(Buffer.from("data"));
const pcmLen = b.readUInt32LE(off + 4);
const pcm = b.subarray(off + 8, off + 8 + pcmLen);

const ws = new WebSocket("ws://127.0.0.1:8888/ws");
let gotStt = false, gotLlm = false, gotTts = false, ttsBytes = 0;

ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", version: 1, features: { mcp: true }, transport: "websocket",
        audio_params: { format: "pcm", sample_rate: 16000, channels: 1, frame_duration: 60 } }));
});

ws.on("message", (d, isBinary) => {
    if (isBinary) { ttsBytes += d.length; return; }
    const m = JSON.parse(d.toString());
    if (m.type === "hello") {
        console.log("HELLO", m.session_id.slice(0,8));
        // stream PCM in 1920-byte (60ms) chunks every 60ms
        let i = 0;
        const iv = setInterval(() => {
            if (i >= pcm.length) { clearInterval(iv); return; }
            const chunk = pcm.subarray(i, i + 1920);
            ws.send(chunk);
            i += 1920;
        }, 60);
        setTimeout(() => clearInterval(iv), pcm.length / 1920 * 60 + 2000);
    }
    else if (m.type === "stt") { gotStt = true; console.log("STT:", m.text, m.sttMs ? "(" + m.sttMs + "ms)" : ""); }
    else if (m.type === "llm") { gotLlm = true; console.log("LLM:", m.text); }
    else if (m.type === "tts") { gotTts = true; console.log("TTS", m.state); if (m.state === "stop") { console.log("=== DONE stt=%s llm=%s tts=%s bytes=%d ===", gotStt, gotLlm, gotTts, ttsBytes); ws.close(); process.exit(0); } }
    else if (m.type === "idle") console.log("IDLE");
});

setTimeout(() => { console.log("TIMEOUT stt=%s llm=%s tts=%s bytes=%d", gotStt, gotLlm, gotTts, ttsBytes); process.exit(1); }, 60000);
