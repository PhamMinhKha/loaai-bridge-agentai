import { randomBytes } from "node:crypto";
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

export function parsePublicHostname(value) {
    let s = String(value || "").trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!s) return "";
    if (s.includes(":") && !s.startsWith("[")) {
        s = s.replace(/:\d+$/, "");
    }
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(s) || !s.includes(".")) {
        throw new Error("Hostname không hợp lệ (vd voice.yourdomain.com)");
    }
    return s;
}

function publicEnabledFromEnv() {
    return process.env.PUBLIC_ENABLED === "true" || config.publicEnabled === true;
}

function newDeviceToken() {
    return randomBytes(24).toString("base64url");
}

export function getServerInfo({ includeSecrets = false } = {}) {
    const port = Number(process.env.PORT || config.port || 8888);
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

    const publicEnabled = publicEnabledFromEnv();
    let publicHostname = "";
    try {
        publicHostname = parsePublicHostname(process.env.PUBLIC_HOSTNAME || config.publicHostname || "");
    } catch {
        publicHostname = "";
    }
    const requireDeviceToken = process.env.REQUIRE_DEVICE_TOKEN === "true" || config.requireDeviceToken;
    const deviceTokenSecret = process.env.DEVICE_TOKEN_SECRET || config.deviceTokenSecret || "";
    const publicHttpUrl = publicHostname ? `https://${publicHostname}/` : null;
    const publicWsUrl = publicHostname ? `wss://${publicHostname}/ws` : null;

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
        wsUrlLan,
        publicEnabled,
        publicHostname,
        publicHttpUrl,
        publicWsUrl,
        requireDeviceToken,
        deviceTokenSet: Boolean(deviceTokenSecret),
        ...(includeSecrets ? { deviceTokenSecret } : {})
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

export function applyServerSettings({
    port,
    tlsEnabled,
    publicEnabled,
    publicHostname,
    requireDeviceToken,
    deviceTokenSecret
} = {}) {
    const entries = {};
    if (port != null) entries.PORT = String(parsePort(port));

    let hostname = "";
    if (publicHostname != null) {
        hostname = parsePublicHostname(publicHostname);
        entries.PUBLIC_HOSTNAME = hostname;
    } else {
        try {
            hostname = parsePublicHostname(process.env.PUBLIC_HOSTNAME || config.publicHostname || "");
        } catch {
            hostname = "";
        }
    }

    if (publicEnabled === true) {
        if (!hostname) {
            throw new Error("Nhập hostname Cloudflare (vd voice.yourdomain.com)");
        }
        entries.PUBLIC_ENABLED = "true";
        entries.HOST = "127.0.0.1";
        entries.TLS_ENABLED = "false";
        entries.REQUIRE_DEVICE_TOKEN = "true";
        const existing = String(deviceTokenSecret ?? process.env.DEVICE_TOKEN_SECRET ?? config.deviceTokenSecret ?? "").trim();
        entries.DEVICE_TOKEN_SECRET = existing || newDeviceToken();
    } else if (publicEnabled === false) {
        entries.PUBLIC_ENABLED = "false";
        entries.HOST = "0.0.0.0";
        if (tlsEnabled != null) entries.TLS_ENABLED = tlsEnabled ? "true" : "false";
        if (requireDeviceToken != null) {
            entries.REQUIRE_DEVICE_TOKEN = requireDeviceToken ? "true" : "false";
        }
        if (deviceTokenSecret != null) entries.DEVICE_TOKEN_SECRET = String(deviceTokenSecret);
    } else {
        if (tlsEnabled != null) entries.TLS_ENABLED = tlsEnabled ? "true" : "false";
        if (requireDeviceToken != null) {
            entries.REQUIRE_DEVICE_TOKEN = requireDeviceToken ? "true" : "false";
        }
        if (deviceTokenSecret != null) entries.DEVICE_TOKEN_SECRET = String(deviceTokenSecret);
    }

    if (Object.keys(entries).length) {
        upsertEnvFile(VG_ENV, entries);
        for (const [k, v] of Object.entries(entries)) process.env[k] = v;
    }
    return getServerInfo({ includeSecrets: true });
}

export function restartGateway(settings = {}) {
    const info = applyServerSettings(settings);
    const p = info.port;
    if (!fs.existsSync(ENTRY)) {
        throw new Error(`Không tìm thấy ${ENTRY}`);
    }
    const env = {
        ...process.env,
        PORT: String(p),
        HOST: info.host,
        TLS_ENABLED: info.tlsEnabled ? "true" : "false",
        PUBLIC_ENABLED: info.publicEnabled ? "true" : "false",
        PUBLIC_HOSTNAME: info.publicHostname || "",
        REQUIRE_DEVICE_TOKEN: info.requireDeviceToken ? "true" : "false"
    };
    if (info.deviceTokenSecret) env.DEVICE_TOKEN_SECRET = info.deviceTokenSecret;

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
    return { port: p, tlsEnabled: info.tlsEnabled, publicEnabled: info.publicEnabled, restarting: true };
}
