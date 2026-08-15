import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Usage: node test/test_stt_file.js [path_to_wav]
const wavPath = process.argv[2] || path.join(__dirname, "fixtures", "test_vi.wav");
const SR = 16000;
const buf = fs.readFileSync(wavPath);

// Parse WAV: expect 16-bit PCM mono 16k. Strip 44-byte header.
if (buf.toString("ascii", 0, 4) !== "RIFF") {
  console.error("Not a WAV file"); process.exit(1);
}
// Find "data" chunk
let off = 12;
let dataStart = -1, dataLen = 0;
while (off < buf.length - 8) {
  const id = buf.toString("ascii", off, off + 4);
  const sz = buf.readUInt32LE(off + 4);
  if (id === "data") { dataStart = off + 8; dataLen = sz; break; }
  off += 8 + sz + (sz & 1);
}
if (dataStart < 0) { console.error("No data chunk"); process.exit(1); }
const pcm = buf.subarray(dataStart, dataStart + dataLen);

const ws = new WebSocket("ws://127.0.0.1:8888/ws");
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", device_id: "stt-test-001", token: "x" }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "audio_start", format: "pcm16", sample_rate: SR }));
    const CHUNK = SR * 0.2 * 2; // 200ms
    let i = 0;
    const iv = setInterval(() => {
      if (i >= pcm.length) {
        clearInterval(iv);
        // small silence tail, then audio_end
        setTimeout(() => ws.send(JSON.stringify({ type: "audio_end" })), 200);
        return;
      }
      ws.send(pcm.subarray(i, Math.min(i + CHUNK, pcm.length)));
      i += CHUNK;
    }, 200);
  }, 300);
});
ws.on("message", (d) => {
  let m; try { m = JSON.parse(d.toString()); } catch { return; }
  console.log("SERVER:", JSON.stringify(m));
  if (m.type === "transcript") {
    console.log("\n>>> TRANSCRIPT RESULT:", m.text);
    setTimeout(() => { ws.close(); process.exit(0); }, 300);
  }
  if (m.type === "error") {
    setTimeout(() => { ws.close(); process.exit(1); }, 300);
  }
});
ws.on("error", (e) => { console.log("ERR", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); ws.close(); process.exit(1); }, 30000);
