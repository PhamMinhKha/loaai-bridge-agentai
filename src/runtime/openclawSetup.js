import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeOpenAi } from "../agents/openaiChat.js";
import { applyGlobalOptions, publicOptions } from "./options.js";
import { upsertEnvFile } from "./envFile.js";

const DEFAULT_PORT = 18789;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MODEL = "openclaw/default";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VG_ENV = path.join(__dirname, "..", "..", ".env");

function openclawHome() {
    if (process.env.OPENCLAW_HOME) return process.env.OPENCLAW_HOME;
    return path.join(os.homedir(), ".openclaw");
}

export function openclawConfigPath() {
    if (process.env.OPENCLAW_CONFIG_PATH) return process.env.OPENCLAW_CONFIG_PATH;
    return path.join(openclawHome(), "openclaw.json");
}

export function findOpenClawBin() {
    const candidates = [
        process.env.OPENCLAW_BIN,
        "/opt/homebrew/bin/openclaw",
        "/usr/local/bin/openclaw",
        path.join(os.homedir(), ".local", "bin", "openclaw")
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || "openclaw";
}

function run(cmd, args, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            windowsHide: true,
            shell: process.platform === "win32" && (cmd === "openclaw" || cmd.endsWith("openclaw.exe"))
        });
        let out = "";
        child.stdout.on("data", (d) => { out += d.toString(); });
        child.stderr.on("data", (d) => { out += d.toString(); });
        const t = setTimeout(() => {
            child.kill();
            reject(new Error(`timeout: ${cmd} ${args.join(" ")}`));
        }, timeoutMs);
        child.on("error", (e) => { clearTimeout(t); reject(e); });
        child.on("close", (code) => {
            clearTimeout(t);
            if (code !== 0) reject(new Error((out || `exit ${code}`).trim().slice(0, 400)));
            else resolve(out.trim());
        });
    });
}

function readConfig(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
        throw new Error(`Không đọc được ${filePath}: ${e.message}`);
    }
}

function writeConfig(filePath, cfg) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + "\n");
}

function ensureChatCompletions(cfg) {
    const next = { ...cfg };
    next.gateway = { ...(next.gateway || {}) };
    next.gateway.http = { ...(next.gateway.http || {}) };
    next.gateway.http.endpoints = { ...(next.gateway.http.endpoints || {}) };
    next.gateway.http.endpoints.chatCompletions = {
        ...(next.gateway.http.endpoints.chatCompletions || {}),
        enabled: true
    };
    if (!next.gateway.mode) next.gateway.mode = "local";
    return next;
}

function gatewayPort(cfg) {
    return Number(cfg?.gateway?.port || process.env.OPENCLAW_GATEWAY_PORT || DEFAULT_PORT);
}

function gatewayToken(cfg) {
    return String(
        cfg?.gateway?.auth?.token ||
        process.env.OPENCLAW_GATEWAY_TOKEN ||
        ""
    ).trim();
}

async function waitReachable(url, token, attempts = 15) {
    for (let i = 0; i < attempts; i++) {
        if (await probeOpenAi(url, token, 2000)) return true;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

export async function setupOpenClawForVoiceGateway() {
    const steps = [];
    const cfgFile = openclawConfigPath();
    const bin = findOpenClawBin();
    let cfg = readConfig(cfgFile);

    const prevEnabled = cfg?.gateway?.http?.endpoints?.chatCompletions?.enabled;
    if (!prevEnabled) {
        cfg = ensureChatCompletions(cfg);
        writeConfig(cfgFile, cfg);
        steps.push(`Đã bật gateway.http.endpoints.chatCompletions trong ${cfgFile}`);
    } else {
        steps.push("chatCompletions đã bật trong openclaw.json");
    }

    const port = gatewayPort(cfg);
    const url = `http://${DEFAULT_HOST}:${port}`;
    let token = gatewayToken(cfg);

    if (!token) {
        try {
            steps.push("Tạo gateway token…");
            const out = await run(bin, ["doctor", "--generate-gateway-token"], 30000);
            steps.push(out.split("\n")[0] || "Token đã tạo");
            cfg = readConfig(cfgFile);
            token = gatewayToken(cfg);
        } catch (e) {
            steps.push(`Không tạo token tự động: ${e.message}`);
        }
    }

    if (!token) {
        steps.push("Chưa có gateway.auth.token — chạy: openclaw configure");
    }

    const already = await probeOpenAi(url, token, 2000);
    steps.push(already
        ? `OpenClaw đã reachable tại ${url}`
        : `OpenClaw chưa reachable tại ${url} — sẽ restart gateway`);

    upsertEnvFile(VG_ENV, {
        OPENCLAW_URL: url,
        OPENCLAW_TOKEN: token,
        OPENCLAW_MODEL: DEFAULT_MODEL,
        AGENT_PROVIDER: "openclaw"
    });
    steps.push(`Đã cập nhật ${VG_ENV} (OPENCLAW_URL / OPENCLAW_TOKEN)`);

    applyGlobalOptions({
        agent: "openclaw",
        openclawUrl: url,
        openclawToken: token,
        openclawModel: DEFAULT_MODEL
    });

    let restarted = false;
    if (!already) {
        try {
            steps.push(`Restart OpenClaw gateway (${bin})…`);
            await run(bin, ["gateway", "restart"], 60000);
            restarted = true;
            steps.push("OpenClaw gateway restart xong");
        } catch (e) {
            steps.push(`Restart lỗi: ${e.message}`);
        }
        if (!(await waitReachable(url, token, 3))) {
            try {
                steps.push("Cài LaunchAgent/service OpenClaw…");
                await run(bin, ["gateway", "install", "--force"], 90000);
                await run(bin, ["gateway", "restart"], 60000);
                restarted = true;
                steps.push("Đã cài service + restart gateway");
            } catch (e2) {
                steps.push(`Cài service lỗi: ${e2.message}`);
            }
        }
    }

    const reachable = already || await waitReachable(url, token);
    if (!reachable) {
        steps.push("Vẫn chưa reachable. Chạy: openclaw gateway restart");
    } else {
        steps.push(`OpenClaw reachable tại ${url}`);
    }

    const options = await publicOptions();
    return {
        ok: reachable && Boolean(token),
        restarted,
        url,
        tokenSet: Boolean(token),
        openclawConfig: cfgFile,
        steps,
        options
    };
}
