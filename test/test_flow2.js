import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:8888/ws");
let gotHello = false, gotStt = false, gotTts = false, gotLlm = false, ttsBytes = 0;

ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", version: 1, features: { mcp: true }, transport: "websocket",
        audio_params: { format: "pcm", sample_rate: 16000, channels: 1, frame_duration: 60 } }));
});

ws.on("message", (d, isBinary) => {
    if (isBinary) { ttsBytes += d.length; return; }
    const m = JSON.parse(d.toString());
    if (m.type === "hello") { gotHello = true; console.log("HELLO session", m.session_id.slice(0,8)); ws.send(JSON.stringify({ type: "text", text: "xin chào" })); }
    else if (m.type === "stt") console.log("STT:", m.text);
    else if (m.type === "llm") { gotLlm = true; console.log("LLM:", m.text); }
    else if (m.type === "tts") { gotTts = true; console.log("TTS", m.state); if (m.state === "stop") { console.log("=== DONE hello=%s llm=%s tts=%s bytes=%d ===", gotHello, gotLlm, gotTts, ttsBytes); ws.close(); process.exit(0); } }
    else if (m.type === "idle") console.log("IDLE");
    else if (m.type === "state") { /* states */ }
});

setTimeout(() => { console.log("TIMEOUT hello=%s llm=%s tts=%s bytes=%d", gotHello, gotLlm, gotTts, ttsBytes); process.exit(1); }, 60000);
