import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEVICE_TOKEN, parsePublicHostname } from "./serverControl.js";
import { upsertEnvFile, VG_ENV } from "./envFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VG_ROOT = path.join(__dirname, "..", "..");
const TUNNEL_DATA = path.join(VG_ROOT, "data", "tunnel");
const TUNNEL_PID_FILE = path.join(TUNNEL_DATA, "cloudflared.pid");
const TUNNEL_LOG_FILE = path.join(TUNNEL_DATA, "cloudflared.log");

const DEFAULT_TUNNEL_NAME = "loa-gateway";

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function cloudflaredDir() {
    return path.join(os.homedir(), ".cloudflared");
}

export function cloudflaredConfigPath() {
    return path.join(cloudflaredDir(), "config.yml");
}

function findCloudflaredInWinGetPackages() {
    const base = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
        : null;
    if (!base || !fs.existsSync(base)) return null;
    try {
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (!/cloudflare|cloudflared/i.test(entry.name)) continue;
            const direct = path.join(base, entry.name, "cloudflared.exe");
            if (fs.existsSync(direct)) return direct;
            for (const sub of fs.readdirSync(path.join(base, entry.name), { withFileTypes: true })) {
                if (!sub.isDirectory()) continue;
                const nested = path.join(base, entry.name, sub.name, "cloudflared.exe");
                if (fs.existsSync(nested)) return nested;
            }
        }
    } catch { /* ignore */ }
    return null;
}

function findCloudflaredBin() {
    if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
        return process.env.CLOUDFLARED_PATH;
    }

    const lookup = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], {
        encoding: "utf8",
        timeout: 5000,
        shell: process.platform === "win32",
        windowsHide: true
    });
    if (lookup.status === 0 && lookup.stdout) {
        const line = lookup.stdout.trim().split(/\r?\n/).find((l) => l.trim());
        if (line && fs.existsSync(line.trim())) return line.trim();
    }

    const extras = [];
    if (process.platform === "win32") {
        if (process.env.ProgramFiles) {
            extras.push(path.join(process.env.ProgramFiles, "cloudflared", "cloudflared.exe"));
        }
        if (process.env["ProgramFiles(x86)"]) {
            extras.push(path.join(process.env["ProgramFiles(x86)"], "cloudflared", "cloudflared.exe"));
        }
        if (process.env.LOCALAPPDATA) {
            extras.push(path.join(process.env.LOCALAPPDATA, "cloudflared", "cloudflared.exe"));
        }
        extras.push("C:\\Program Files\\cloudflared\\cloudflared.exe");
        extras.push("C:\\Program Files (x86)\\cloudflared\\cloudflared.exe");
        const winget = findCloudflaredInWinGetPackages();
        if (winget) extras.unshift(winget);
    }
    for (const p of extras) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

function persistCloudflaredPath(bin) {
    if (!bin) return;
    const normalized = bin.replace(/\\/g, "/");
    upsertEnvFile(VG_ENV, { CLOUDFLARED_PATH: normalized });
    process.env.CLOUDFLARED_PATH = bin;
}

export function installCloudflared({ force = false } = {}) {
    if (process.platform !== "win32") {
        return { ok: false, error: "Tự cài cloudflared hiện chỉ hỗ trợ Windows (winget)" };
    }
    let bin = findCloudflaredBin();
    if (bin && !force) {
        persistCloudflaredPath(bin);
        return { ok: true, path: bin, alreadyInstalled: true };
    }
    const args = [
        "install", "Cloudflare.cloudflared", "-e",
        "--accept-package-agreements", "--accept-source-agreements"
    ];
    if (force || !bin) args.push("--force");
    const ran = spawnSync("winget", args, {
        encoding: "utf8",
        timeout: 300000,
        shell: true,
        windowsHide: true
    });
    const out = `${ran.stdout || ""}${ran.stderr || ""}`.trim();
    bin = findCloudflaredBin();
    if (bin) {
        persistCloudflaredPath(bin);
        return {
            ok: true,
            path: bin,
            output: out,
            alreadyInstalled: /already installed|No available upgrade/i.test(out)
        };
    }
    if (/already installed|No available upgrade/i.test(out)) {
        return {
            ok: false,
            error: "winget báo đã cài nhưng không tìm thấy cloudflared.exe — thử cài lại: winget install Cloudflare.cloudflared --force",
            output: out
        };
    }
    return { ok: false, error: out || "Không cài được cloudflared qua winget", output: out };
}

export function ensureCloudflared() {
    let bin = findCloudflaredBin();
    if (bin) {
        persistCloudflaredPath(bin);
        return { ok: true, path: bin, installed: false };
    }
    const installed = installCloudflared({ force: true });
    if (!installed.ok) return installed;
    bin = findCloudflaredBin();
    if (!bin) {
        return { ok: false, error: "Cài xong nhưng chưa thấy cloudflared — khởi động lại app" };
    }
    persistCloudflaredPath(bin);
    return { ok: true, path: bin, installed: true, output: installed.output };
}

export function launchCloudflaredLogin() {
    const bin = findCloudflaredBin();
    if (!bin) return { ok: false, error: "Chưa có cloudflared" };
    if (isCloudflaredLoggedIn()) {
        return { ok: true, alreadyLoggedIn: true };
    }
    spawn(bin, ["tunnel", "login"], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        shell: false
    });
    return {
        ok: true,
        waiting: true,
        message: "Trình duyệt sẽ mở — chọn zone domain (vd loaai.me)"
    };
}

export async function waitForCloudflaredLogin(timeoutMs = 180000) {
    if (isCloudflaredLoggedIn()) return { ok: true, alreadyLoggedIn: true };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (isCloudflaredLoggedIn()) return { ok: true };
        await sleep(2000);
    }
    return {
        ok: false,
        error: "Hết thời gian chờ đăng nhập Cloudflare (3 phút). Bấm lại sau khi login xong."
    };
}

export function buildEsp32HelloConfig({ hostname, token, deviceId = "esp32-001" } = {}) {
    const host = parsePublicHostname(hostname);
    return {
        wsUrl: `wss://${host}/ws`,
        hello: {
            type: "hello",
            version: 1,
            device_id: deviceId,
            token: token || "",
            transport: "websocket",
            audio_params: {
                format: "opus",
                sample_rate: 16000,
                channels: 1,
                frame_duration: 60
            }
        }
    };
}

function runCloudflared(args, timeoutMs = 20000) {
    const bin = findCloudflaredBin();
    if (!bin) {
        return { ok: false, error: "Chưa cài cloudflared (winget install Cloudflare.cloudflared)" };
    }
    const r = spawnSync(bin, args, {
        encoding: "utf8",
        timeout: timeoutMs,
        shell: false,
        windowsHide: true
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
    if (r.error) {
        return { ok: false, error: r.error.message, output: out };
    }
    if (r.status !== 0) {
        return { ok: false, error: out || `cloudflared exit ${r.status}`, output: out };
    }
    return { ok: true, output: out, stdout: r.stdout || "", stderr: r.stderr || "" };
}

export function listCredentialFiles() {
    const dir = cloudflaredDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
        .map((name) => {
            const uuid = name.replace(/\.json$/i, "");
            return { uuid, path: path.join(dir, name) };
        });
}

export function listTunnels() {
    const ran = runCloudflared(["tunnel", "list", "--output", "json"]);
    if (!ran.ok) return ran;
    try {
        const tunnels = JSON.parse(ran.stdout || "[]");
        return { ok: true, tunnels: Array.isArray(tunnels) ? tunnels : [] };
    } catch (e) {
        return { ok: false, error: `Không đọc được danh sách tunnel: ${e.message}`, output: ran.output };
    }
}

export function resolveTunnelUuid(tunnelName = DEFAULT_TUNNEL_NAME, explicitUuid) {
    if (explicitUuid) {
        const cred = path.join(cloudflaredDir(), `${explicitUuid}.json`);
        if (!fs.existsSync(cred)) {
            return { ok: false, error: `Không thấy credentials ${cred}` };
        }
        return { ok: true, uuid: explicitUuid, tunnelName };
    }

    const listed = listTunnels();
    if (listed.ok) {
        const hit = listed.tunnels.find((t) => t.name === tunnelName);
        if (hit?.id) {
            return { ok: true, uuid: hit.id, tunnelName: hit.name || tunnelName };
        }
    }

    const creds = listCredentialFiles();
    if (creds.length === 1) {
        return {
            ok: true,
            uuid: creds[0].uuid,
            tunnelName,
            guessed: true,
            hint: listed.ok
                ? `Không thấy tunnel tên "${tunnelName}" — dùng UUID duy nhất trong .cloudflared`
                : "cloudflared không trong PATH — dùng file cred duy nhất tìm được"
        };
    }

    if (listed.ok && listed.tunnels.length) {
        const names = listed.tunnels.map((t) => t.name).filter(Boolean).join(", ");
        return {
            ok: false,
            error: `Không thấy tunnel "${tunnelName}". Có sẵn: ${names || "(trống)"}. Chạy: cloudflared tunnel create ${tunnelName}`
        };
    }

    if (creds.length > 1) {
        return {
            ok: false,
            error: `Nhiều file cred trong .cloudflared — cần cloudflared tunnel list hoặc nhập UUID tunnel`
        };
    }

    return {
        ok: false,
        error: `Chưa có tunnel. Chạy: cloudflared tunnel create ${tunnelName}`
    };
}

export function buildConfigYaml({ uuid, hostname, port, credentialsFile }) {
    const cred = (credentialsFile || path.join(cloudflaredDir(), `${uuid}.json`))
        .replace(/\\/g, "/");
    return `tunnel: ${uuid}
credentials-file: ${cred}
ingress:
  - hostname: ${hostname}
    service: http://127.0.0.1:${port}
  - service: http_status:404
`;
}

export function writeTunnelConfig({
    tunnelName = DEFAULT_TUNNEL_NAME,
    hostname,
    port,
    uuid
} = {}) {
    const host = parsePublicHostname(hostname);
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
        return { ok: false, error: "Port không hợp lệ (1024–65535)" };
    }

    const resolved = resolveTunnelUuid(tunnelName, uuid);
    if (!resolved.ok) return resolved;

    const credPath = path.join(cloudflaredDir(), `${resolved.uuid}.json`);
    if (!fs.existsSync(credPath)) {
        return { ok: false, error: `Không thấy ${credPath}. Chạy cloudflared tunnel create ${tunnelName} trước.` };
    }

    const yaml = buildConfigYaml({
        uuid: resolved.uuid,
        hostname: host,
        port: p,
        credentialsFile: credPath
    });

    fs.mkdirSync(cloudflaredDir(), { recursive: true });
    fs.writeFileSync(cloudflaredConfigPath(), yaml, "utf8");

    return {
        ok: true,
        configPath: cloudflaredConfigPath(),
        credentialsFile: credPath,
        uuid: resolved.uuid,
        tunnelName: resolved.tunnelName || tunnelName,
        hostname: host,
        port: p,
        yaml,
        guessed: Boolean(resolved.guessed),
        hint: resolved.hint || null
    };
}

export function routeTunnelDns({ tunnelName = DEFAULT_TUNNEL_NAME, hostname } = {}) {
    const host = parsePublicHostname(hostname);
    const ran = runCloudflared(["tunnel", "route", "dns", tunnelName, host], 30000);
    if (!ran.ok) {
        const blob = `${ran.error || ""} ${ran.output || ""}`;
        if (/already|exists|duplicate|record already/i.test(blob)) {
            return { ok: true, hostname: host, tunnelName, output: ran.output, alreadyExists: true };
        }
        return { ok: false, error: ran.error, output: ran.output };
    }
    return { ok: true, hostname: host, tunnelName, output: ran.output };
}

export function isCloudflaredLoggedIn() {
    return fs.existsSync(path.join(cloudflaredDir(), "cert.pem"));
}

export function createTunnel(tunnelName = DEFAULT_TUNNEL_NAME) {
    const existing = resolveTunnelUuid(tunnelName);
    if (existing.ok) {
        return { ok: true, alreadyExists: true, uuid: existing.uuid, tunnelName };
    }
    const ran = runCloudflared(["tunnel", "create", tunnelName], 60000);
    if (!ran.ok) return ran;
    const resolved = resolveTunnelUuid(tunnelName);
    return {
        ok: resolved.ok,
        tunnelName,
        uuid: resolved.ok ? resolved.uuid : null,
        output: ran.output,
        error: resolved.ok ? undefined : resolved.error
    };
}

function readTunnelPid() {
    if (!fs.existsSync(TUNNEL_PID_FILE)) return null;
    const pid = Number(String(fs.readFileSync(TUNNEL_PID_FILE, "utf8")).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isTunnelProcessRunning() {
    const pid = readTunnelPid();
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function startTunnelRun({ tunnelName = DEFAULT_TUNNEL_NAME } = {}) {
    if (isTunnelProcessRunning()) {
        return { ok: true, alreadyRunning: true, pid: readTunnelPid(), logPath: TUNNEL_LOG_FILE };
    }
    const bin = findCloudflaredBin();
    if (!bin) {
        return { ok: false, error: "Chưa cài cloudflared (winget install Cloudflare.cloudflared)" };
    }
    if (!fs.existsSync(cloudflaredConfigPath())) {
        return { ok: false, error: "Chưa có config.yml — bấm Tạo config.yml trước" };
    }
    fs.mkdirSync(TUNNEL_DATA, { recursive: true });
    const logFd = fs.openSync(TUNNEL_LOG_FILE, "a");
    fs.writeSync(logFd, `\n===== tunnel run ${tunnelName} ${new Date().toISOString()} =====\n`);
    const child = spawn(bin, ["tunnel", "run", tunnelName], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true
    });
    fs.closeSync(logFd);
    child.unref();
    fs.writeFileSync(TUNNEL_PID_FILE, String(child.pid));
    return { ok: true, pid: child.pid, logPath: TUNNEL_LOG_FILE, tunnelName };
}

export function stopTunnelRun() {
    const pid = readTunnelPid();
    if (!pid) return { ok: true, stopped: false };
    try {
        process.kill(pid);
        fs.unlinkSync(TUNNEL_PID_FILE);
        return { ok: true, stopped: true, pid };
    } catch (e) {
        return { ok: false, error: e.message, pid };
    }
}

export function installTunnelService() {
    const ran = runCloudflared(["service", "install"], 60000);
    if (!ran.ok) return ran;
    return { ok: true, output: ran.output };
}

export function startTunnelService() {
    if (process.platform !== "win32") {
        return runCloudflared(["service", "start"], 30000);
    }
    const ran = spawnSync("sc", ["start", "cloudflared"], {
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true
    });
    const out = `${ran.stdout || ""}${ran.stderr || ""}`.trim();
    if (ran.status === 0 || /already/i.test(out)) {
        return { ok: true, output: out };
    }
    return { ok: false, error: out || `sc exit ${ran.status}`, output: out };
}

export async function testPublicHealth(hostname, attempts = 5) {
    const host = parsePublicHostname(hostname);
    const url = `https://${host}/health`;
    let lastError = "";
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch { body = null; }
            if (res.ok && body?.ok) {
                return { ok: true, url, body };
            }
            lastError = body?.error || text.slice(0, 200) || `HTTP ${res.status}`;
        } catch (e) {
            lastError = e.message;
        }
        if (i < attempts - 1) await sleep(2000);
    }
    return { ok: false, url, error: lastError };
}

export async function setupTunnelAuto({
    tunnelName = DEFAULT_TUNNEL_NAME,
    hostname,
    port
} = {}) {
    const steps = [];
    const push = (step, result) => {
        steps.push({ step, ...result });
        return result;
    };

    const bin = findCloudflaredBin();
    if (!bin) {
        push("cloudflared", { ok: false, error: "Chưa cài cloudflared" });
        return { ok: false, steps, needsInstall: true, error: "Chưa cài cloudflared" };
    }
    push("cloudflared", { ok: true, path: bin });

    if (!isCloudflaredLoggedIn()) {
        push("login", { ok: false });
        return {
            ok: false,
            steps,
            needsLogin: true,
            error: "Chưa đăng nhập Cloudflare — chạy: cloudflared tunnel login"
        };
    }
    push("login", { ok: true });

    const created = push("create", createTunnel(tunnelName));
    if (!created.ok) {
        return { ok: false, steps, error: created.error || "Không tạo được tunnel" };
    }

    const config = push("config", writeTunnelConfig({ tunnelName, hostname, port }));
    if (!config.ok) {
        return { ok: false, steps, error: config.error || "Không ghi config.yml" };
    }

    const dns = push("dns", routeTunnelDns({ tunnelName, hostname }));
    if (!dns.ok) {
        return { ok: false, steps, error: dns.error || "Không trỏ DNS" };
    }

    const started = push("start", startTunnelRun({ tunnelName }));
    if (!started.ok) {
        return { ok: false, steps, error: started.error || "Không chạy tunnel" };
    }

    await sleep(3000);
    const host = parsePublicHostname(hostname);
    const test = push("test", await testPublicHealth(host));
    return {
        ok: test.ok,
        steps,
        error: test.ok ? null : (test.error || "URL công khai chưa phản hồi — đợi vài phút rồi thử lại"),
        publicHttpUrl: `https://${host}/`,
        publicWsUrl: `wss://${host}/ws`,
        publicHealthUrl: `https://${host}/health`
    };
}

export async function setupTunnelFull({
    tunnelName = DEFAULT_TUNNEL_NAME,
    hostname,
    port,
    installService = false,
    loginWaitMs = 180000,
    deviceToken = ""
} = {}) {
    const steps = [];
    const push = (step, result) => {
        steps.push({ step, ...result });
        return result;
    };

    const ensured = push("install", ensureCloudflared());
    if (!ensured.ok) {
        return { ok: false, steps, error: ensured.error || "Không cài được cloudflared" };
    }

    if (!isCloudflaredLoggedIn()) {
        const launched = push("login_launch", launchCloudflaredLogin());
        if (!launched.ok) {
            return { ok: false, steps, error: launched.error };
        }
        const waited = push("login_wait", await waitForCloudflaredLogin(loginWaitMs));
        if (!waited.ok) {
            return {
                ok: false,
                steps,
                needsLogin: true,
                error: waited.error,
                userAction: "Hoàn tất đăng nhập trong trình duyệt rồi bấm Thiết lập lại"
            };
        }
    } else {
        push("login", { ok: true, alreadyLoggedIn: true });
    }

    const core = await setupTunnelAuto({ tunnelName, hostname, port });
    for (const s of core.steps || []) {
        if (!steps.some((x) => x.step === s.step)) steps.push(s);
    }

    if (!core.ok && !core.steps?.length) {
        return { ok: false, steps, error: core.error || "Thiết lập tunnel thất bại" };
    }

    if (installService) {
        const svc = installTunnelService();
        const svcStep = push("service", svc);
        if (svc.ok) {
            push("service_start", startTunnelService());
        } else {
            svcStep.skipped = true;
            svcStep.hint = "Bỏ qua service (cần Admin). Tunnel vẫn chạy nền qua app.";
        }
    }

    const host = parsePublicHostname(hostname);
    const esp32 = buildEsp32HelloConfig({
        hostname: host,
        token: deviceToken || process.env.DEVICE_TOKEN_SECRET || DEFAULT_DEVICE_TOKEN
    });

    return {
        ok: Boolean(core.ok),
        steps,
        error: core.ok ? null : (core.error || "Chưa test được URL công khai"),
        publicHttpUrl: core.publicHttpUrl || `https://${host}/`,
        publicWsUrl: core.publicWsUrl || `wss://${host}/ws`,
        publicHealthUrl: core.publicHealthUrl || `https://${host}/health`,
        esp32
    };
}

export function getTunnelStatus() {
    const bin = findCloudflaredBin();
    const listed = bin ? listTunnels() : { ok: false, tunnels: [] };
    let configYaml = null;
    const cfgPath = cloudflaredConfigPath();
    if (fs.existsSync(cfgPath)) {
        try { configYaml = fs.readFileSync(cfgPath, "utf8"); } catch { /* ignore */ }
    }
    return {
        cloudflaredInstalled: Boolean(bin),
        cloudflaredPath: bin,
        cloudflaredLoggedIn: isCloudflaredLoggedIn(),
        cloudflaredDir: cloudflaredDir(),
        configPath: cfgPath,
        configExists: fs.existsSync(cfgPath),
        configYaml,
        credentialFiles: listCredentialFiles(),
        tunnels: listed.ok ? listed.tunnels : [],
        tunnelsError: listed.ok ? null : listed.error,
        tunnelRunning: isTunnelProcessRunning(),
        tunnelPid: readTunnelPid(),
        tunnelLogPath: fs.existsSync(TUNNEL_LOG_FILE) ? TUNNEL_LOG_FILE : null
    };
}
