import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { upsertEnvFile } from "./envFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const VENV = path.join(ROOT, ".venv");
const ENV_FILE = path.join(ROOT, ".env");

function venvPython() {
    const win = process.platform === "win32";
    const p = win
        ? path.join(VENV, "Scripts", "python.exe")
        : path.join(VENV, "bin", "python");
    return fs.existsSync(p) ? p : null;
}

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: ROOT,
            windowsHide: true,
            shell: process.platform === "win32" && (cmd === "npm" || cmd === "pip"),
            ...opts
        });
        let out = "";
        child.stdout?.on("data", (d) => { out += d.toString(); });
        child.stderr?.on("data", (d) => { out += d.toString(); });
        const t = setTimeout(() => {
            child.kill();
            reject(new Error(`timeout: ${cmd} ${args.join(" ")}`));
        }, opts.timeoutMs || 300000);
        child.on("error", (e) => { clearTimeout(t); reject(e); });
        child.on("close", (code) => {
            clearTimeout(t);
            if (code !== 0) reject(new Error((out || `exit ${code}`).trim().slice(0, 400)));
            else resolve(out.trim());
        });
    });
}

function findSystemPython() {
    for (const cmd of ["python3", "python"]) {
        try {
            const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
            if (r.status === 0) return cmd;
        } catch { /* ignore */ }
    }
    return null;
}

export async function runDevSetup() {
    const steps = [];
    const errors = [];

    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < 18) {
        errors.push(`Cần Node.js >= 18 (đang có ${process.version})`);
    } else {
        steps.push(`Node ${process.version} OK`);
    }

    const sysPy = findSystemPython();
    if (!sysPy) {
        errors.push("Chưa có Python 3.10+");
    } else {
        steps.push(`Python hệ thống: ${sysPy}`);
    }

    try {
        steps.push("npm install…");
        await run("npm", ["install"], { timeoutMs: 300000 });
        steps.push("npm install xong");
    } catch (e) {
        errors.push(`npm install: ${e.message}`);
    }

    let py = venvPython();
    if (!py && sysPy) {
        try {
            steps.push("Tạo .venv…");
            await run(sysPy, ["-m", "venv", VENV], { timeoutMs: 120000 });
            py = venvPython();
            steps.push(".venv đã tạo");
        } catch (e) {
            errors.push(`venv: ${e.message}`);
        }
    }

    if (py) {
        try {
            steps.push("pip install requirements…");
            await run(py, ["-m", "pip", "install", "--upgrade", "pip"], { timeoutMs: 120000 });
            await run(py, ["-m", "pip", "install", "-r", "requirements.txt"], { timeoutMs: 600000 });
            steps.push("pip install xong");
        } catch (e) {
            errors.push(`pip: ${e.message}`);
        }
    } else {
        errors.push("Không tìm thấy Python trong .venv");
    }

    if (!fs.existsSync(ENV_FILE)) {
        const example = path.join(ROOT, ".env.example");
        if (fs.existsSync(example)) {
            fs.copyFileSync(example, ENV_FILE);
            steps.push("Đã tạo .env từ .env.example");
        }
    } else {
        steps.push(".env đã tồn tại");
    }

    if (py) {
        upsertEnvFile(ENV_FILE, {
            WHISPER_PYTHON: py,
            TTS_PYTHON: py
        });
        steps.push(`WHISPER_PYTHON / TTS_PYTHON → ${py}`);
    }

    return {
        ok: errors.length === 0,
        steps,
        errors
    };
}
