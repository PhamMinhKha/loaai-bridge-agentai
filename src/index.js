import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config/config.js";
import { createWebSocketServer } from "./server/websocket.js";
import { StreamingSTT } from "./audio/audioManager.js";
import { publicOptions, applyGlobalOptions, getPrefs } from "./runtime/options.js";
import { isLoopback, setupHermesForVoiceGateway } from "./runtime/hermesSetup.js";

const app = express();
app.use(express.json());

app.get("/health", async (req, res) => {
    try {
        const opts = await publicOptions();
        res.json({
            ok: true,
            service: "voice-gateway",
            agent: opts.current.agent,
            tts: opts.current.tts,
            stt: opts.stt,
            agents: opts.agents.map((a) => ({ id: a.id, reachable: a.reachable }))
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/options", async (req, res) => {
    try {
        res.json(await publicOptions());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/options", async (req, res) => {
    try {
        applyGlobalOptions(req.body || {});
        res.json(await publicOptions());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/setup/hermes", async (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ chạy setup Hermes từ máy local (127.0.0.1)" });
    }
    try {
        res.json(await setupHermesForVoiceGateway());
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const stt = new StreamingSTT(config.stt);

createWebSocketServer(server, stt, {
  silenceMs: Number(process.env.SILENCE_MS || 1200),
  listenMs: Number(process.env.LISTEN_MS || 30000)
});

server.listen(config.port, config.host, () => {
    const p = getPrefs();
    console.log(`Voice Gateway listening on ${config.host}:${config.port} (agent=${p.agent} tts=${p.tts})`);
    console.log(`  local:  http://127.0.0.1:${config.port}/`);
    console.log(`  LAN:    http://<IP-PC>:${config.port}/   (máy khác cùng Wi‑Fi/LAN)`);
});
