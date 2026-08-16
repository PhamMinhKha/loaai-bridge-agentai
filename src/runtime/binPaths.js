import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VG_ROOT = path.join(__dirname, "..", "..");

function venvPython(root = VG_ROOT) {
    const win = process.platform === "win32";
    const p = win
        ? path.join(root, ".venv", "Scripts", "python.exe")
        : path.join(root, ".venv", "bin", "python");
    return fs.existsSync(p) ? p : null;
}

function commandWorks(cmd) {
    try {
        const r = spawnSync(cmd, ["--version"], { encoding: "utf8", windowsHide: true });
        return r.status === 0;
    } catch {
        return false;
    }
}

/** Resolve python for STT/TTS when GUI app PATH is minimal (Tauri / LaunchAgent). */
export function resolvePythonPath(explicit) {
    const hint = String(explicit || "").trim();
    if (hint && hint !== "python" && hint !== "python3" && fs.existsSync(hint)) return hint;

    const fromVenv = venvPython();
    if (fromVenv) return fromVenv;

    const candidates = [
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
        path.join(os.homedir(), ".local", "bin", "python3")
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    for (const cmd of ["python3", "python"]) {
        if (commandWorks(cmd)) return cmd;
    }
    return hint || "python3";
}

function nvmOpenClawPaths() {
    const out = [];
    const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node");
    if (!fs.existsSync(nvmRoot)) return out;
    try {
        for (const ver of fs.readdirSync(nvmRoot)) {
            out.push(path.join(nvmRoot, ver, "bin", "openclaw"));
        }
    } catch { /* ignore */ }
    return out;
}

/** Resolve openclaw CLI when PATH from Tauri/LaunchAgent omits nvm/Homebrew. */
export function findOpenClawBin() {
    const candidates = [
        process.env.OPENCLAW_BIN,
        "/opt/homebrew/bin/openclaw",
        "/usr/local/bin/openclaw",
        path.join(os.homedir(), ".local", "bin", "openclaw"),
        ...nvmOpenClawPaths()
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || "openclaw";
}
