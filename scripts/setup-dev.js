import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const win = process.platform === "win32";
const script = path.join(root, win ? "setup-dev.ps1" : "setup-dev.sh");
const r = win
    ? spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { stdio: "inherit" })
    : spawnSync("bash", [script], { stdio: "inherit" });
process.exit(r.status ?? 1);
