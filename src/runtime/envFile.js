import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VG_ROOT = path.join(__dirname, "..", "..");

const BUNDLE_ENV = path.join(VG_ROOT, ".env");

/** Writable per-user config (MSI / Program Files cannot update bundle .env). */
export function userEnvPath() {
    if (process.env.VG_USER_ENV) return process.env.VG_USER_ENV;
    const base = process.env.LOCALAPPDATA || process.env.HOME || os.homedir();
    return path.join(base, "Loa Ai Agent Bridge", ".env");
}

function bundleEnvReadOnly() {
    if (process.env.VG_ENV_WRITABLE === "1") return false;
    const root = VG_ROOT.replace(/\\/g, "/").toLowerCase();
    if (root.includes("/program files/") || root.includes("/program files (x86)/")) return true;
    try {
        if (!fs.existsSync(BUNDLE_ENV)) return false;
        fs.accessSync(path.dirname(BUNDLE_ENV), fs.constants.W_OK);
        return false;
    } catch {
        return true;
    }
}

/** Path used for reads/writes of gateway .env (user dir when bundle is read-only). */
export function getVgEnvPath() {
    const user = userEnvPath();
    if (bundleEnvReadOnly()) return user;
    if (fs.existsSync(user)) return user;
    return BUNDLE_ENV;
}

export const VG_ENV = getVgEnvPath();

let envLoaded = false;

/** Load bundle defaults, then user overrides. Safe to call multiple times. */
export function loadVgEnv() {
    if (envLoaded) return;
    envLoaded = true;
    if (fs.existsSync(BUNDLE_ENV)) {
        dotenv.config({ path: BUNDLE_ENV });
    }
    const user = userEnvPath();
    if (fs.existsSync(user)) {
        dotenv.config({ path: user, override: true });
    }
    ensureUserEnvBootstrap();
}

/** Copy bundle .env → user .env once when MSI install cannot persist settings. */
function ensureUserEnvBootstrap() {
    if (!bundleEnvReadOnly()) return;
    const user = userEnvPath();
    if (fs.existsSync(user)) return;
    if (!fs.existsSync(BUNDLE_ENV)) return;
    try {
        fs.mkdirSync(path.dirname(user), { recursive: true });
        fs.copyFileSync(BUNDLE_ENV, user);
        dotenv.config({ path: user, override: true });
        console.log("[env] bootstrapped user .env at", user);
    } catch (e) {
        console.warn("[env] bootstrap user .env failed:", e.message);
    }
}

export function upsertEnvFile(filePath, entries) {
    let target = filePath || getVgEnvPath();
    if (bundleEnvReadOnly() && target === BUNDLE_ENV) {
        target = userEnvPath();
    }
    let text = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (!text && fs.existsSync(BUNDLE_ENV) && target !== BUNDLE_ENV) {
        text = fs.readFileSync(BUNDLE_ENV, "utf8");
    }
    if (text && !text.endsWith("\n")) text += "\n";
    const added = [];
    const updated = [];
    for (const [key, value] of Object.entries(entries)) {
        const re = new RegExp(`^${key}=.*$`, "m");
        if (re.test(text)) {
            text = text.replace(re, `${key}=${value}`);
            updated.push(key);
        } else {
            text += `${key}=${value}\n`;
            added.push(key);
        }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return { filePath: target, added, updated };
}
