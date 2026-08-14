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
    return /\bscreenshot\b/.test(t)
        || /chup(\s*(anh|hinh))?\s*man(\s*hinh)?/.test(t)
        || /xem\s*(anh\s*)?man\s*hinh/.test(t)
        || /man\s*hinh\s*(may\s*tinh|desktop|pc|may\s*tinh)/.test(t);
}

export function screenshotOptions(req = {}, extra = {}) {
    const compact = extra.compact === true;
    const maxWidth = Number(req.maxWidth || extra.maxWidth || process.env.SCREENSHOT_MAX_WIDTH || (compact ? 240 : 360));
    const quality = Number(req.quality || extra.quality || process.env.SCREENSHOT_QUALITY || (compact ? 45 : 60));
    return {
        maxWidth: Math.max(80, Math.min(360, maxWidth || 360)),
        quality: Math.max(20, Math.min(95, quality || 60))
    };
}

function runCmd(cmd, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args);
        let out = "";
        let err = "";
        p.stdout.on("data", (d) => { out += d.toString(); });
        p.stderr.on("data", (d) => { err += d.toString(); });
        p.on("error", reject);
        p.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error((err || out || `${cmd} exit ${code}`).trim().slice(0, 400)));
            }
            resolve(out.trim());
        });
    });
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

function align16(n) {
    return Math.max(80, Math.floor(Number(n) / 16) * 16);
}

function parseSipsSize(text) {
    const w = /pixelWidth:\s*(\d+)/.exec(text || "");
    const h = /pixelHeight:\s*(\d+)/.exec(text || "");
    return {
        width: w ? Number(w[1]) : 0,
        height: h ? Number(h[1]) : 0
    };
}

function targetSize(srcW, srcH, maxWidth) {
    let w = srcW;
    let h = srcH;
    if (w > maxWidth) {
        h = Math.round(h * (maxWidth / w));
        w = maxWidth;
    }
    return { width: align16(w), height: align16(h), srcWidth: srcW, srcHeight: srcH };
}

/** JPEG decoder trên ESP32 cần cạnh chia hết 16 (MCU 4:2:0). */
async function resizeWithSips(out, maxWidth, quality) {
    const info = await runCmd("sips", ["-g", "pixelWidth", "-g", "pixelHeight", out]);
    const src = parseSipsSize(info);
    const size = targetSize(src.width || maxWidth, src.height || maxWidth, maxWidth);
    await runCmd("sips", [
        "-z", String(size.height), String(size.width),
        "-s", "format", "jpeg",
        "-s", "formatOptions", String(quality),
        out,
        "--out", out
    ]);
    return size;
}

async function captureDarwin(out) {
    try {
        await runCmd("screencapture", ["-x", "-t", "jpg", out]);
    } catch (e) {
        const hint = " Cấp quyền Screen Recording cho Terminal/Node: System Settings → Privacy & Security → Screen Recording.";
        throw new Error((e && e.message ? e.message : "screencapture failed") + hint);
    }
}

async function captureLinux(out) {
    try {
        await runCmd("import", ["-window", "root", out]);
        return;
    } catch {
        /* try gnome-screenshot */
    }
    try {
        await runCmd("gnome-screenshot", ["-f", out]);
        return;
    } catch {
        /* try grim (Wayland) */
    }
    await runCmd("grim", [out]);
}

/** Chụp màn hình PC (mọi monitor). Trả JPEG + meta. */
export async function captureScreenshot(opts = {}) {
    const { maxWidth, quality } = screenshotOptions(opts);
    const out = path.join(os.tmpdir(), `vg-shot-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    try {
        let meta = {};
        if (process.platform === "win32") {
            const raw = await runPs(["-Out", out, "-MaxWidth", String(maxWidth), "-Quality", String(quality)]);
            try { meta = JSON.parse(raw || "{}"); } catch { meta = {}; }
        } else if (process.platform === "darwin") {
            await captureDarwin(out);
            meta = await resizeWithSips(out, maxWidth, quality);
        } else {
            await captureLinux(out);
            try {
                await runCmd("convert", [out, "-resize", `${maxWidth}x`, "-quality", String(quality), out]);
            } catch { /* giữ ảnh gốc nếu không có ImageMagick */ }
            meta = {};
        }
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
