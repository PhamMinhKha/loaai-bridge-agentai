import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pkg from "../package.json" with { type: "json" };
import { config } from "./config/config.js";
import { createWebSocketServer } from "./server/websocket.js";
import { publicOptions, applyGlobalOptions, getPrefs } from "./runtime/options.js";
import { isLoopback, setupHermesForVoiceGateway } from "./runtime/hermesSetup.js";
import { setupOpenClawForVoiceGateway } from "./runtime/openclawSetup.js";
import { getStt, initSttFromEnv } from "./runtime/sttRuntime.js";
import { runDevSetup } from "./runtime/devSetup.js";
import { runDiagnostics } from "./runtime/diagnostics.js";
import { getServerInfo, restartGateway } from "./runtime/serverControl.js";
import { getLanAddresses, loadTlsOptions, readPublicCertInfo, isTlsEnabled } from "./runtime/tlsSetup.js";
import { listConversations, getConversationAudioPath } from "./runtime/conversationHistory.js";

const app = express();
app.use(express.json());

app.get("/health", async (req, res) => {
    try {
        const opts = await publicOptions();
        const server = getServerInfo();
        res.json({
            ok: true,
            service: "loa-ai-agent-bridge",
            version: pkg.version,
            port: server.port,
            host: config.host,
            tlsEnabled: server.tlsEnabled,
            tlsReady: server.tlsReady,
            wsUrl: server.wsUrlLocal,
            wsUrlLocal: server.wsUrlLocal,
            wsUrlLan: server.wsUrlLan,
            lanIps: server.lanIps,
            agent: opts.current.agent,
            tts: opts.current.tts,
            stt: opts.current.stt,
            whisperModel: opts.current.whisperModel,
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

app.post("/api/setup/openclaw", async (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ chạy setup OpenClaw từ máy local (127.0.0.1)" });
    }
    try {
        res.json(await setupOpenClawForVoiceGateway());
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post("/api/setup/dev", async (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ chạy setup từ máy local (127.0.0.1)" });
    }
    try {
        res.json(await runDevSetup());
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/diagnostics", async (req, res) => {
    try {
        res.json(await runDiagnostics());
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/server", (req, res) => {
    try {
        res.json({ ok: true, ...getServerInfo() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/tls/info", (req, res) => {
    try {
        if (!isTlsEnabled()) {
            return res.json({ ok: true, tlsEnabled: false });
        }
        const info = readPublicCertInfo();
        if (!info) {
            return res.status(404).json({ ok: false, error: "Chưa có cert TLS" });
        }
        res.json({
            ok: true,
            tlsEnabled: true,
            certPath: info.certPath,
            tls_cert_sha256: info.sha256,
            tls_cert: info.pem
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/tls/cert", (req, res) => {
    try {
        const info = readPublicCertInfo();
        if (!info) {
            return res.status(404).type("text/plain").send("TLS cert not available");
        }
        res.type("application/x-pem-file").send(info.pem + "\n");
    } catch (e) {
        res.status(500).type("text/plain").send(e.message);
    }
});

app.post("/api/server/restart", (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ restart từ máy local (127.0.0.1)" });
    }
    try {
        const { port, tlsEnabled } = req.body || {};
        const result = restartGateway({ port, tlsEnabled });
        res.json({ ok: true, ...result, ...getServerInfo() });
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.get("/api/conversations", (req, res) => {
    try {
        res.json({ ok: true, items: listConversations() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/conversations/:id/audio", (req, res) => {
    try {
        const file = getConversationAudioPath(req.params.id);
        if (!file) return res.status(404).json({ ok: false, error: "Không tìm thấy audio" });
        res.download(file, `${req.params.id}.wav`);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "public")));

initSttFromEnv();

const wsOpts = {
    silenceMs: Number(process.env.SILENCE_MS || 1200),
    listenMs: Number(process.env.LISTEN_MS || 30000)
};

const port = config.port;
const tlsEnabled = config.tlsEnabled;
const p = getPrefs();

if (tlsEnabled) {
    const tls = await loadTlsOptions(config.tlsCertPath, config.tlsKeyPath);
    const httpServer = http.createServer(app);
    const httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, app);

    createWebSocketServer(httpServer, wsOpts);
    createWebSocketServer(httpsServer, wsOpts);

    httpServer.listen(port, "127.0.0.1", () => {
        console.log(`Loa Ai Agent Bridge local HTTP on 127.0.0.1:${port} (agent=${p.agent} tts=${p.tts})`);
        console.log(`  local:  http://127.0.0.1:${port}/`);
        console.log(`  ws:     ws://127.0.0.1:${port}/ws`);
    });

    httpsServer.listen(port, "0.0.0.0", () => {
        const lanIps = getLanAddresses();
        console.log(`Loa Ai Agent Bridge LAN HTTPS/WSS on 0.0.0.0:${port}`);
        console.log(`  cert:   ${tls.certPath}`);
        if (lanIps.length) {
            for (const ip of lanIps) {
                console.log(`  LAN:    https://${ip}:${port}/  wss://${ip}:${port}/ws`);
            }
        } else {
            console.log(`  LAN:    https://<IP-PC>:${port}/  wss://<IP-PC>:${port}/ws`);
        }
    });
} else {
    const server = http.createServer(app);
    createWebSocketServer(server, wsOpts);
    server.listen(port, config.host, () => {
        console.log(`Loa Ai Agent Bridge listening on ${config.host}:${port} (agent=${p.agent} tts=${p.tts})`);
        console.log(`  local:  http://127.0.0.1:${port}/`);
        console.log(`  LAN:    http://<IP-PC>:${port}/   (máy khác cùng Wi‑Fi/LAN)`);
    });
}
