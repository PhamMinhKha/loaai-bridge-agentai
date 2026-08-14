import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pcmToWav } from "../audio/wavUtil.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function dumpDir() {
    const raw = process.env.STT_DUMP_DIR || path.join(ROOT, "data", "stt");
    return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

function enabled() {
    return String(process.env.STT_DUMP ?? "true").toLowerCase() !== "false";
}

function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_${d.getMilliseconds()}`;
}

function safeId(s) {
    return String(s || "unknown").replace(/[^\w.-]+/g, "_").slice(0, 40);
}

/** Lưu PCM + transcript để kiểm tra STT. Trả về đường dẫn .txt hoặc null. */
export function saveSttDump({ text, pcm, deviceId, source, sttMs, sampleRate = 16000 }) {
    if (!enabled()) return null;
    try {
        const dir = dumpDir();
        fs.mkdirSync(dir, { recursive: true });
        const base = `${stamp()}_${safeId(source)}_${safeId(deviceId)}`;
        const txtPath = path.join(dir, `${base}.txt`);
        const jsonlPath = path.join(dir, "index.jsonl");
        const pcmBuf = Buffer.isBuffer(pcm) ? pcm : Buffer.alloc(0);
        let wavName = "";
        if (pcmBuf.length > 0) {
            wavName = `${base}.wav`;
            fs.writeFileSync(path.join(dir, wavName), pcmToWav(pcmBuf, sampleRate));
        }
        const body = (text && String(text).trim()) || "(empty)";
        fs.writeFileSync(txtPath, body, "utf8");
        const rec = {
            at: new Date().toISOString(),
            source: source || "",
            deviceId: deviceId || "",
            sttMs: sttMs || null,
            bytes: pcmBuf.length,
            msAudio: Math.round(pcmBuf.length / 32),
            text: body,
            wav: wavName || null,
            txt: path.basename(txtPath)
        };
        fs.appendFileSync(jsonlPath, JSON.stringify(rec) + "\n", "utf8");
        console.log("[stt-dump]", txtPath, wavName ? wavName : "(no wav)", JSON.stringify(body));
        return txtPath;
    } catch (e) {
        console.warn("[stt-dump]", e.message);
        return null;
    }
}
