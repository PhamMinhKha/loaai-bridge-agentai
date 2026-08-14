import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/config.js";
import { upsertEnvFile, VG_ENV, VG_ROOT } from "./envFile.js";
import { DEFAULT_CERT_PATH, DEFAULT_KEY_PATH, getLanAddresses, tlsReady, readPublicCertInfo } from "./tlsSetup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(VG_ROOT, "src", "index.js");

function parsePort(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
        throw new Error("Port phải từ 1024 đến 65535");
    }
    return n;
}

function tlsEnabledFromEnv() {
    return process.env.TLS_ENABLED === "true" || config.tlsEnabled;
}

function certPathFromEnv() {
    return process.env.TLS_CERT_PATH || config.tlsCertPath || DEFAULT_CERT_PATH;
}

function keyPathFromEnv() {
    return process.env.TLS_KEY_PATH || config.tlsKeyPath || DEFAULT_KEY_PATH;
}

export function getServerInfo() {
    const port = Number(process.env.PORT || config.port || 3000);
    const host = process.env.HOST || config.host || "0.0.0.0";
    const tlsEnabled = tlsEnabledFromEnv();
    const certPath = certPathFromEnv();
    const keyPath = keyPathFromEnv();
    const lanIps = getLanAddresses();
    const primaryLanIp = lanIps[0] || null;

    const httpUrlLocal = `http://127.0.0.1:${port}/`;
    const wsUrlLocal = `ws://127.0.0.1:${port}/ws`;
    const httpUrlLan = tlsEnabled && primaryLanIp
        ? `https://${primaryLanIp}:${port}/`
        : `http://${primaryLanIp || "<IP-PC>"}:${port}/`;
    const wsUrlLan = tlsEnabled && primaryLanIp
        ? `wss://${primaryLanIp}:${port}/ws`
        : primaryLanIp
            ? `ws://${primaryLanIp}:${port}/ws`
            : null;

    const certInfo = tlsEnabled && tlsReady(certPath, keyPath)
        ? readPublicCertInfo(certPath, keyPath)
        : null;

    return {
        port,
        host,
        tlsEnabled,
        tlsReady: tlsEnabled ? tlsReady(certPath, keyPath) : false,
        certPath: tlsEnabled ? certPath : null,
        tlsCertSha256: certInfo?.sha256 || null,
        tlsProvision: tlsEnabled ? "hello" : null,
        lanIps,
        httpUrl: httpUrlLocal,
        httpUrlLocal,
        httpUrlLan,
        wsUrl: wsUrlLocal,
        wsUrlLocal,
        wsUrlLan
    };
}

export function setServerPort(port) {
    const p = parsePort(port);
    upsertEnvFile(VG_ENV, { PORT: String(p) });
    return p;
}

export function setServerTls(enabled) {
    upsertEnvFile(VG_ENV, { TLS_ENABLED: enabled ? "true" : "false" });
    return Boolean(enabled);
}

export function applyServerSettings({ port, tlsEnabled } = {}) {
    const entries = {};
    if (port != null) entries.PORT = String(parsePort(port));
    if (tlsEnabled != null) entries.TLS_ENABLED = tlsEnabled ? "true" : "false";
    if (Object.keys(entries).length) upsertEnvFile(VG_ENV, entries);
    return getServerInfo();
}

export function restartGateway({ port, tlsEnabled } = {}) {
    const info = applyServerSettings({ port, tlsEnabled });
    const p = info.port;
    if (!fs.existsSync(ENTRY)) {
        throw new Error(`Không tìm thấy ${ENTRY}`);
    }
    const env = { ...process.env, PORT: String(p) };
    if (info.tlsEnabled) env.TLS_ENABLED = "true";
    else env.TLS_ENABLED = "false";

    setTimeout(() => {
        const child = spawn(process.execPath, [ENTRY], {
            detached: true,
            stdio: "ignore",
            cwd: VG_ROOT,
            env,
            windowsHide: true
        });
        child.unref();
        process.exit(0);
    }, 300);
    return { port: p, tlsEnabled: info.tlsEnabled, restarting: true };
}
