import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "screenshot.ps1");

function fold(s) {
    return String(s || "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();
}

export function isScreenshotCommand(text) {
    const t = fold(text);
    return /\bscreenshot\b/.test(t) || /chup(\s*(anh|hinh))?\s*man\s*hinh/.test(t);
}

export function screenshotOptions(req = {}, extra = {}) {
    const maxWidth = Number(req.maxWidth || extra.maxWidth || process.env.SCREENSHOT_MAX_WIDTH || 360);
    const quality = Number(req.quality || extra.quality || process.env.SCREENSHOT_QUALITY || 60);
    return {
        maxWidth: Math.max(80, Math.min(360, maxWidth || 360)),
        quality: Math.max(20, Math.min(95, quality || 60))
    };
}

function runPs(args) {
    return new Promise((resolve, reject) => {
        const p = spawn("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args], {
            windowsHide: true
        });
        let out = "";
        let err = "";
        p.stdout.on("data", (d) => { out += d.toString(); });
        p.stderr.on("data", (d) => { err += d.toString(); });
        p.on("error", reject);
        p.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error((err || out || "screenshot exit " + code).trim().slice(0, 400)));
            }
            resolve(out.trim());
        });
    });
}

/** Chụp màn hình PC (mọi monitor). Trả JPEG + meta. */
export async function captureScreenshot(opts = {}) {
    const { maxWidth, quality } = screenshotOptions(opts);
    const out = path.join(os.tmpdir(), `vg-shot-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    try {
        const raw = await runPs(["-Out", out, "-MaxWidth", String(maxWidth), "-Quality", String(quality)]);
        let meta = {};
        try { meta = JSON.parse(raw || "{}"); } catch { meta = {}; }
        const buf = fs.readFileSync(out);
        return {
            type: "screenshot",
            mime: "image/jpeg",
            width: meta.width || null,
            height: meta.height || null,
            srcWidth: meta.srcWidth || null,
            srcHeight: meta.srcHeight || null,
            bytes: buf.length,
            data: buf.toString("base64")
        };
    } finally {
        try { fs.unlinkSync(out); } catch { /* ignore */ }
    }
}

export async function sendScreenshot(send, req = {}, extra = {}) {
    const shot = await captureScreenshot({ ...screenshotOptions(req, extra), ...req });
    const ok = send(shot);
    console.log("[screenshot]", shot.width, "x", shot.height, shot.bytes, "bytes", ok ? "sent" : "NOT sent");
    return shot;
}
