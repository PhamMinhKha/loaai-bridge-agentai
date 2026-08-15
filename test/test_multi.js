import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SR = 16000;
function readWavPCM16(path) {
    const b = fs.readFileSync(path);
    const off = b.indexOf(Buffer.from("data"));
    const pcmLen = b.readUInt32LE(off + 4);
    return b.subarray(off + 8, off + 8 + pcmLen);
}
function pcmToFloat(pcm) {
    const n = pcm.length / 2;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = pcm.readInt16LE(i * 2) / 0x7fff;
    return out;
}
function resample(inp, inRate, outRate) {
    const ratio = inRate / outRate;
    const outLen = Math.round(inp.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const idx = i * ratio;
        const i0 = Math.floor(idx); const frac = idx - i0;
        const s0 = inp[i0] || 0; const s1 = inp[i0 + 1] || 0;
        out[i] = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac)) * 0x7fff;
    }
    return out;
}

const pcm = resample(pcmToFloat(readWavPCM16(path.join(__dirname, "fixtures", "test_vi.wav"))), 16000, 16000);
const CHUNK = SR * 2 * 0.2;
const rounds = 2;

const ws = new WebSocket("ws://127.0.0.1:8888/ws");
let round = 0;
ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", device_id: "multitest", token: "test" }));
});
ws.on("message", (d) => {
    if (typeof d !== "string") return;
    const m = JSON.parse(d);
    if (m.type === "hello_ack") {
        startRound();
    } else if (m.type === "idle") {
        if (round < rounds) startRound();
        else { console.log("=== ALL ROUNDS DONE ==="); ws.close(); process.exit(0); }
    } else if (m.type === "transcript") {
        console.log("ROUND", round, "TRANSCRIPT:", JSON.stringify(m.text));
    } else if (m.type === "agent_message") {
        console.log("ROUND", round, "AGENT:", JSON.stringify(m.text));
    } else if (m.type === "audio_start") {
        windowChunks = [];
    } else if (m.type === "audio_end") {
        console.log("ROUND", round, "TTS bytes:", windowChunks.length);
    }
});
let windowChunks = [];
ws.on("message", (d) => { if (d instanceof Buffer || d instanceof ArrayBuffer) windowChunks.push(d); });

function startRound() {
    round++;
    console.log("--- ROUND", round, "start ---");
    ws.send(JSON.stringify({ type: "audio_start", format: "pcm16", sample_rate: 16000, channels: 1 }));
    let i = 0;
    const iv = setInterval(() => {
        const slice = pcm.subarray(i, i + CHUNK);
        if (slice.length === 0) { clearInterval(iv); ws.send(JSON.stringify({ type: "audio_end" })); return; }
        ws.send(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength));
        i += CHUNK;
    }, 200);
    setTimeout(() => { clearInterval(iv); ws.send(JSON.stringify({ type: "audio_end" })); }, 12000);
}
setTimeout(() => { console.log("TIMEOUT - possible hang"); process.exit(1); }, 90000);
