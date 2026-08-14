import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WAV = process.argv[2] || path.join(__dirname, "fixtures", "sine.wav");
const SR = 16000;

// crude WAV reader: supports PCM16 mono/stereo, resamples by simple decimation
function readWavPCM16(path) {
    const b = fs.readFileSync(path);
    const channels = b.readUInt16LE(22);
    const rate = b.readUInt32LE(24);
    const bits = b.readUInt16LE(34);
    let off = 12;
    while (off < b.length) {
        const id = b.toString("ascii", off, off + 4);
        const sz = b.readUInt32LE(off + 4);
        if (id === "data") break;
        off += 8 + sz;
    }
    const dataOff = off + 8;
    const samples = [];
    if (bits === 16) {
        const total = (b.length - dataOff) / 2;
        for (let i = 0; i < total; i += channels) {
            samples.push(b.readInt16LE(dataOff + i * 2));
        }
    }
    // decimate to 16kHz if needed
    if (rate !== SR) {
        const ratio = rate / SR;
        const out = [];
        for (let i = 0; i < samples.length; i += Math.round(ratio)) out.push(samples[i]);
        return Buffer.from(new Int16Array(out).buffer);
    }
    return Buffer.from(new Int16Array(samples).buffer);
}

const pcm = readWavPCM16(WAV);
console.log("PCM bytes:", pcm.length, "≈", (pcm.length / 2 / SR).toFixed(1), "s");

const ws = new WebSocket("ws://127.0.0.1:3000/ws");
// send in 200ms chunks
const CHUNK = SR * 2 * 0.2;
ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", device_id: "wav-001", token: "x" }));
    setTimeout(() => {
        ws.send(JSON.stringify({ type: "audio_start", format: "pcm16", sample_rate: SR }));
        let i = 0;
        const iv = setInterval(() => {
            const slice = pcm.subarray(i, i + CHUNK);
            if (slice.length === 0) { clearInterval(iv); ws.send(JSON.stringify({type:'audio_end'})); return; }
            ws.send(slice); i += CHUNK;
        }, 200);
    }, 300);
});
ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    console.log("SERVER:", JSON.stringify(m));
});
ws.on("error", (e) => console.log("ERR", e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 60000);
