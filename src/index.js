import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pkg from "../package.json" with { type: "json" };
import { config } from "./config/config.js";
import { createWebSocketServer } from "./server/websocket.js";
import { broadcastConfig } from "./server/wsBroadcast.js";
import { publicOptions, applyGlobalOptions, getPrefs } from "./runtime/options.js";
import { isLoopback, setupHermesForVoiceGateway } from "./runtime/hermesSetup.js";
import { setupOpenClawForVoiceGateway } from "./runtime/openclawSetup.js";
import { getStt, initSttFromEnv } from "./runtime/sttRuntime.js";
import { runDevSetup } from "./runtime/devSetup.js";
import { runDiagnostics } from "./runtime/diagnostics.js";
import { getServerInfo, restartGateway } from "./runtime/serverControl.js";
import {
    getTunnelStatus,
    writeTunnelConfig,
    routeTunnelDns,
    createTunnel,
    startTunnelRun,
    stopTunnelRun,
    installTunnelService,
    startTunnelService,
    testPublicHealth,
    setupTunnelAuto,
    setupTunnelFull,
    buildEsp32HelloConfig
} from "./runtime/cloudflareTunnel.js";
import { getLanAddresses, loadTlsOptions, readPublicCertInfo, isTlsEnabled } from "./runtime/tlsSetup.js";
import { listConversations, getConversationAudioPath } from "./runtime/conversationHistory.js";
import { VG_ROOT, getVgEnvPath, userEnvPath } from "./runtime/envFile.js";

/** Bump when adding loopback API routes — desktop app uses /health features.apiVersion to detect stale processes. */
const GATEWAY_API_VERSION = 2;

const app = express();
app.use(express.json());

function requireLoopback(req, res) {
    if (!isLoopback(req)) {
        res.status(403).json({ error: "Chỉ gọi API này từ máy local (127.0.0.1)" });
        return false;
    }
    return true;
}

/** WKWebView (Tauri) times out if no response headers for ~60s during long setup. */
function beginLongJsonResponse(res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
}

function endLongJsonResponse(res, statusCode, payload) {
    if (!res.headersSent) res.status(statusCode);
    res.end(JSON.stringify(payload));
}

app.get("/health", async (req, res) => {
    try {
        const opts = await publicOptions();
        const server = getServerInfo();
        res.json({
            ok: true,
            service: "loa-ai-agent-bridge",
            version: pkg.version,
            gatewayRoot: VG_ROOT,
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
            agents: opts.agents.map((a) => ({ id: a.id, reachable: a.reachable })),
            features: { tunnelApi: true, apiVersion: GATEWAY_API_VERSION }
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/options", async (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        res.json(await publicOptions());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/options", async (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const prefs = applyGlobalOptions(req.body || {});
        broadcastConfig(prefs);
        res.json(await publicOptions());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/setup/hermes", async (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ chạy setup Hermes từ máy local (127.0.0.1)" });
    }
    beginLongJsonResponse(res);
    try {
        const result = await setupHermesForVoiceGateway();
        broadcastConfig(getPrefs());
        endLongJsonResponse(res, 200, result);
    } catch (e) {
        endLongJsonResponse(res, 500, { ok: false, error: e.message });
    }
});

app.post("/api/setup/openclaw", async (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ chạy setup OpenClaw từ máy local (127.0.0.1)" });
    }
    beginLongJsonResponse(res);
    try {
        const result = await setupOpenClawForVoiceGateway();
        broadcastConfig(getPrefs());
        endLongJsonResponse(res, 200, result);
    } catch (e) {
        endLongJsonResponse(res, 500, { ok: false, error: e.message });
    }
});

app.post("/api/setup/dev", async (req, res) => {
    if (!isLoopback(req)) {
        return res.status(403).json({ error: "Chỉ chạy setup từ máy local (127.0.0.1)" });
    }
    beginLongJsonResponse(res);
    try {
        endLongJsonResponse(res, 200, await runDevSetup());
    } catch (e) {
        endLongJsonResponse(res, 500, { ok: false, error: e.message });
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
        res.json({ ok: true, ...getServerInfo({ includeSecrets: isLoopback(req) }) });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/tunnel/status", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        res.json({ ok: true, ...getTunnelStatus() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/write-config", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const { tunnelName, hostname, port, uuid } = req.body || {};
        const server = getServerInfo();
        const result = writeTunnelConfig({
            tunnelName,
            hostname: hostname || server.publicHostname,
            port: port ?? server.port,
            uuid
        });
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/route-dns", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const { tunnelName, hostname } = req.body || {};
        const server = getServerInfo();
        const result = routeTunnelDns({
            tunnelName,
            hostname: hostname || server.publicHostname
        });
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/create", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const { tunnelName } = req.body || {};
        const result = createTunnel(tunnelName);
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/start", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const { tunnelName } = req.body || {};
        const result = startTunnelRun({ tunnelName });
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/stop", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        res.json(stopTunnelRun());
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/install-service", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const install = installTunnelService();
        if (!install.ok) return res.status(400).json(install);
        const start = startTunnelService();
        res.json({ ok: start.ok, install, start, error: start.ok ? null : start.error });
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.get("/api/tunnel/test-public", async (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const server = getServerInfo();
        const hostname = req.query.hostname || server.publicHostname;
        const result = await testPublicHealth(hostname);
        if (!result.ok) return res.status(502).json(result);
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/setup-auto", async (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const { tunnelName, hostname, port } = req.body || {};
        const server = getServerInfo();
        const result = await setupTunnelAuto({
            tunnelName,
            hostname: hostname || server.publicHostname,
            port: port ?? server.port
        });
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post("/api/tunnel/setup-full", async (req, res) => {
    if (!requireLoopback(req, res)) return;
    req.setTimeout(360000);
    res.setTimeout(360000);
    try {
        const { tunnelName, hostname, port, installService, deviceToken } = req.body || {};
        const server = getServerInfo({ includeSecrets: true });
        const result = await setupTunnelFull({
            tunnelName,
            hostname: hostname || server.publicHostname,
            port: port ?? server.port,
            installService: Boolean(installService),
            deviceToken: deviceToken || server.deviceTokenSecret || ""
        });
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.get("/api/tunnel/esp32-config", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        const server = getServerInfo({ includeSecrets: true });
        const hostname = req.query.hostname || server.publicHostname;
        const deviceId = req.query.deviceId || "esp32-001";
        if (!hostname) {
            return res.status(400).json({ ok: false, error: "Chưa có PUBLIC_HOSTNAME" });
        }
        res.json({
            ok: true,
            ...buildEsp32HelloConfig({
                hostname,
                token: server.deviceTokenSecret || "",
                deviceId
            })
        });
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
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
        const { port, tlsEnabled, publicEnabled, publicHostname, requireDeviceToken, deviceTokenSecret } = req.body || {};
        const result = restartGateway({
            port,
            tlsEnabled,
            publicEnabled,
            publicHostname,
            requireDeviceToken,
            deviceTokenSecret
        });
        res.json({ ok: true, ...result, ...getServerInfo({ includeSecrets: true }) });
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.get("/api/conversations", (req, res) => {
    if (!requireLoopback(req, res)) return;
    try {
        res.json({ ok: true, items: listConversations() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get("/api/conversations/:id/audio", (req, res) => {
    if (!requireLoopback(req, res)) return;
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

console.log(`[env] ${getVgEnvPath()}`);
if (p.agent === "hermes") {
    const tok = process.env.HERMES_TOKEN || "";
    console.log(`[hermes] token ${tok ? "configured" : "MISSING — sẽ đồng bộ từ Hermes API_SERVER_KEY"}`);
}

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
    // Always 0.0.0.0: LAN (ESP32) + localhost + Cloudflare (vẫn vào 127.0.0.1).
    // HOST=127.0.0.1 khi bật tunnel từng làm chết http://<IP-LAN>:8888/.
    const listenHost = "0.0.0.0";
    server.listen(port, listenHost, () => {
        console.log(`Loa Ai Agent Bridge listening on ${listenHost}:${port} (agent=${p.agent} tts=${p.tts})`);
        console.log(`  local:  http://127.0.0.1:${port}/`);
        const lanIps = getLanAddresses();
        if (lanIps.length) {
            for (const ip of lanIps) {
                console.log(`  LAN:    http://${ip}:${port}/   ws://${ip}:${port}/ws`);
            }
        } else {
            console.log(`  LAN:    http://<IP-PC>:${port}/   (máy khác cùng Wi‑Fi/LAN)`);
        }
    });
}
