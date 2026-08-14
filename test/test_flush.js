import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamingSTT } from "../src/audio/audioManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SR = 16000;
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
        for (let i = 0; i < total; i += channels) samples.push(b.readInt16LE(dataOff + i * 2));
    }
    if (rate !== SR) {
        const ratio = rate / SR;
        const out = [];
        for (let i = 0; i < samples.length; i += Math.round(ratio)) out.push(samples[i]);
        return Buffer.from(new Int16Array(out).buffer);
    }
    return Buffer.from(new Int16Array(samples).buffer);
}

const stt = new StreamingSTT({
    provider: "whisper", model: "base",
    python: process.env.WHISPER_PYTHON || process.env.TTS_PYTHON || "python"
});
const pcm = readWavPCM16(path.join(__dirname, "fixtures", "test_vi.wav"));
console.log("pcm bytes", pcm.length);
stt.push(pcm);
setTimeout(async () => {
    const t = await stt.flush();
    console.log("FLUSH RESULT:", JSON.stringify(t));
    process.exit(0);
}, 3000);
