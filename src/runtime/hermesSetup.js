import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeOpenAi, probeOpenAiAuth } from "../agents/openaiChat.js";
import { applyGlobalOptions, publicOptions } from "./options.js";
import { upsertEnvFile, getVgEnvPath } from "./envFile.js";
import { restartGateway } from "./serverControl.js";
import { hermesEnvPath, hermesHome, readHermesApiKey } from "./hermesEnv.js";

const DEFAULT_PORT = 8642;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_KEY = "voice-gateway-local";
const DEFAULT_MODEL = "hermes-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VG_ROOT = path.join(__dirname, "..", "..");
const VG_ENV = getVgEnvPath();

export { isLoopback } from "./clientAddress.js";

export function findHermesBin() {
    const home = hermesHome();
    const candidates = [
        path.join(home, "hermes-agent", "venv", "Scripts", "hermes.exe"),
        path.join(home, "hermes-agent", "venv", "bin", "hermes"),
        path.join(os.homedir(), ".local", "bin", "hermes")
    ];
    return candidates.find((p) => fs.existsSync(p)) || "hermes";
}

function run(cmd, args, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            windowsHide: true,
            shell: process.platform === "win32" && cmd === "hermes"
        });
        let out = "";
        child.stdout.on("data", (d) => { out += d.toString(); });
        child.stderr.on("data", (d) => { out += d.toString(); });
        const t = setTimeout(() => {
            child.kill();
            reject(new Error(`timeout: ${cmd} ${args.join(" ")}`));
        }, timeoutMs);
        child.on("error", (e) => {
            clearTimeout(t);
            reject(e);
        });
        child.on("close", (code) => {
            clearTimeout(t);
            if (code !== 0) reject(new Error((out || `exit ${code}`).trim().slice(0, 400)));
            else resolve(out.trim());
        });
    });
}

async function waitReachable(url, token, attempts = 12) {
    for (let i = 0; i < attempts; i++) {
        if (await probeOpenAiAuth(url, token, 1500)) return true;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

export async function setupHermesForVoiceGateway() {
    const steps = [];
    const url = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
    const hermesFile = hermesEnvPath();
    const bin = findHermesBin();

    let key = readHermesApiKey() || DEFAULT_KEY;

    const already = await probeOpenAiAuth(url, key, 1500);
    steps.push(already
        ? `API Hermes đã reachable tại ${url}`
        : `API Hermes chưa reachable tại ${url} — sẽ ghi .env và restart gateway`);

    const hermesWrite = upsertEnvFile(hermesFile, {
        API_SERVER_ENABLED: "true",
        API_SERVER_HOST: DEFAULT_HOST,
        API_SERVER_PORT: String(DEFAULT_PORT),
        API_SERVER_KEY: key
    });
    steps.push(`Đã cập nhật ${hermesWrite.filePath} (API_SERVER_*)`);

    const vgWrite = upsertEnvFile(VG_ENV, {
        HERMES_URL: url,
        HERMES_TOKEN: key,
        HERMES_MODEL: DEFAULT_MODEL,
        AGENT_PROVIDER: "hermes"
    });
    steps.push(`Đã cập nhật ${vgWrite.filePath} (HERMES_URL / HERMES_TOKEN)`);

    applyGlobalOptions({
        agent: "hermes",
        hermesUrl: url,
        hermesToken: key,
        hermesModel: DEFAULT_MODEL
    });

    let restarted = false;
    if (!already) {
        try {
            steps.push(`Restart Hermes gateway (${bin})…`);
            await run(bin, ["gateway", "restart"]);
            restarted = true;
            steps.push("Hermes gateway restart xong");
        } catch (e) {
            steps.push(`Restart gateway lỗi: ${e.message}`);
        }
    }

    const reachable = already || await waitReachable(url, key);
    if (!reachable) {
        steps.push("Vẫn chưa reachable. Cài Hermes và chạy: hermes gateway restart");
    } else {
        steps.push(`Hermes Agent reachable tại ${url}`);
    }

    const options = await publicOptions();
    steps.push("Restart Voice Gateway để nạp HERMES_TOKEN…");
    try {
        restartGateway({});
    } catch (e) {
        steps.push(`Restart Voice Gateway: ${e.message} — thoát app (tray → Thoát) rồi mở lại`);
    }
    return {
        ok: reachable,
        restarted,
        url,
        hermesEnv: hermesWrite.filePath,
        steps,
        options
    };
}
