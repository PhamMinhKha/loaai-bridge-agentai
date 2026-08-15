import WebSocket from "ws";
const SR = 16000;
const ws = new WebSocket("ws://127.0.0.1:8888/ws");

function sineChunk(freq = 440, ms = 200) {
  const n = (SR * ms) / 1000;
  const buf = Buffer.alloc(n * 2);
  const view = new Int16Array(buf.buffer, buf.byteOffset, n);
  for (let i = 0; i < n; i++) view[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0x7000;
  return buf;
}
function silenceChunk(ms = 200) {
  return Buffer.alloc((SR * ms) / 1000 * 2);
}

let cut = false;
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", device_id: "autocut-001", token: "x" }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "audio_start", format: "pcm16", sample_rate: SR }));
    console.log(">> speaking 2s (loud)...");
    let t = 0;
    const iv = setInterval(() => {
      ws.send(sineChunk()); t += 200;
      if (t >= 2000) {
        clearInterval(iv);
        console.log(">> now SILENT 2s (expect auto-cut after 1.2s)...");
        let s = 0;
        const iv2 = setInterval(() => {
          ws.send(silenceChunk()); s += 200;
          if (s >= 2000) clearInterval(iv2);
        }, 200);
      }
    }, 200);
  }, 300);
});
ws.on("message", (d) => {
  let m; try { m = JSON.parse(d.toString()); } catch { return; }
  console.log("SERVER:", JSON.stringify(m));
  if (m.type === "transcript" && !cut) { cut = true; console.log("\n>>> AUTO-CUT WORKED, transcript received without audio_end"); setTimeout(() => { ws.close(); process.exit(0); }, 400); }
  if (m.type === "error") { setTimeout(() => { ws.close(); process.exit(1); }, 300); }
});
ws.on("error", (e) => { console.log("ERR", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT: no auto-cut"); ws.close(); process.exit(1); }, 45000);
