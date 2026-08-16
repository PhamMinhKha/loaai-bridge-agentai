import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function hermesHome() {
    if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
    if (process.platform === "win32") {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "hermes");
    }
    return path.join(os.homedir(), ".hermes");
}

export function hermesEnvPath() {
    const home = hermesHome();
    const candidates = [
        path.join(home, ".env"),
        path.join(os.homedir(), ".hermes", ".env")
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

/** Read API_SERVER_KEY from Hermes ~/.hermes/.env (or %LOCALAPPDATA%\\hermes\\.env). */
export function readHermesApiKey() {
    const file = hermesEnvPath();
    if (!fs.existsSync(file)) return null;
    const m = fs.readFileSync(file, "utf8").match(/^API_SERVER_KEY=(.*)$/m);
    const key = m?.[1]?.trim();
    return key || null;
}
