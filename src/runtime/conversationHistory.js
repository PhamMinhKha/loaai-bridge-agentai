import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pcmToWav } from "../audio/wavUtil.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_CONVERSATIONS = 50;

function storageDir() {
    const raw = process.env.CONVERSATION_DIR || path.join(ROOT, "data", "conversations");
    return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

function indexPath() {
    return path.join(storageDir(), "index.json");
}

function readIndex() {
    try {
        const p = indexPath();
        if (!fs.existsSync(p)) return [];
        const list = JSON.parse(fs.readFileSync(p, "utf8"));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function writeIndex(list) {
    const dir = storageDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexPath(), JSON.stringify(list, null, 2), "utf8");
}

function safeIdPart(s) {
    return String(s || "unknown").replace(/[^\w.-]+/g, "_").slice(0, 32);
}

function sourceLabel(source) {
    if (source === "xiaozhi") return "ESP32";
    if (source === "ws") return "Web";
    return source || "Unknown";
}

function trimToMax(list) {
    while (list.length > MAX_CONVERSATIONS) {
        const removed = list.pop();
        if (removed?.wav) {
            try {
                fs.unlinkSync(path.join(storageDir(), removed.wav));
            } catch { /* ignore */ }
        }
    }
}

/** Lưu câu nói + audio PCM. Trả về id hoặc null. */
export function saveConversation({ text, pcm, deviceId, source, sttMs, sampleRate = 16000 }) {
    const body = String(text || "").trim();
    if (!body) return null;
    const pcmBuf = Buffer.isBuffer(pcm) ? pcm : Buffer.alloc(0);
    if (pcmBuf.length < 640) return null; // < ~20ms

    try {
        const dir = storageDir();
        fs.mkdirSync(dir, { recursive: true });
        const id = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}_${safeIdPart(source)}`;
        const wavName = `${id}.wav`;
        fs.writeFileSync(path.join(dir, wavName), pcmToWav(pcmBuf, sampleRate));

        const rec = {
            id,
            at: new Date().toISOString(),
            source: source || "ws",
            sourceLabel: sourceLabel(source),
            deviceId: deviceId || "",
            text: body,
            reply: "",
            sttMs: sttMs || null,
            durationMs: Math.round(pcmBuf.length / 32),
            wav: wavName
        };

        const list = readIndex();
        list.unshift(rec);
        trimToMax(list);
        writeIndex(list);
        console.log("[conv-history]", id, sourceLabel(source), JSON.stringify(body.slice(0, 60)));
        return id;
    } catch (e) {
        console.warn("[conv-history]", e.message);
        return null;
    }
}

export function attachConversationReply(id, reply, error = null) {
    if (!id) return;
    try {
        const list = readIndex();
        const rec = list.find((r) => r.id === id);
        if (!rec) return;
        if (error) {
            rec.reply = `(lỗi agent) ${error}`;
        } else {
            rec.reply = String(reply || "").trim();
        }
        writeIndex(list);
    } catch (e) {
        console.warn("[conv-history] reply", e.message);
    }
}

export function listConversations(limit = MAX_CONVERSATIONS) {
    return readIndex().slice(0, limit).map((r) => ({
        id: r.id,
        at: r.at,
        source: r.source,
        sourceLabel: r.sourceLabel || sourceLabel(r.source),
        deviceId: r.deviceId,
        text: r.text,
        reply: r.reply || "",
        sttMs: r.sttMs,
        durationMs: r.durationMs,
        hasAudio: Boolean(r.wav),
        audioUrl: r.wav ? `/api/conversations/${encodeURIComponent(r.id)}/audio` : null
    }));
}

export function getConversationAudioPath(id) {
    if (!id || /[^a-zA-Z0-9._-]/.test(id)) return null;
    const list = readIndex();
    const rec = list.find((r) => r.id === id);
    if (!rec?.wav) return null;
    const file = path.join(storageDir(), rec.wav);
    return fs.existsSync(file) ? file : null;
}
