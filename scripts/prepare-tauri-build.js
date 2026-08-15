/**
 * Chuẩn bị bundle gateway cho Tauri build.
 * Copy src/, public/, scripts/, package files vào dist/gateway-bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "gateway-bundle");

function rmrf(p) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        if (name === "node_modules" || name === ".git") continue;
        const s = path.join(src, name);
        const d = path.join(dest, name);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

for (const item of ["src", "public", "scripts"]) {
    copyDir(path.join(ROOT, item), path.join(OUT, item));
}

for (const f of ["package.json", "package-lock.json", "requirements.txt", ".env.example"]) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
}
// Bundled app reads PORT from env at runtime; ship .env as fallback for direct node runs.
const envExample = path.join(OUT, ".env.example");
if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(OUT, ".env"));
}

console.log("npm ci --omit=dev trong gateway-bundle…");
const r = spawnSync("npm", ["ci", "--omit=dev"], { cwd: OUT, stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) {
    console.error("npm ci thất bại — thử npm install");
    spawnSync("npm", ["install", "--omit=dev"], { cwd: OUT, stdio: "inherit", shell: process.platform === "win32" });
}

console.log("Gateway bundle sẵn sàng:", OUT);
