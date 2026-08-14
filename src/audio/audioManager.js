import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribeOpenAi } from "./openaiStt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "whisper_stt.py");

export function normalizeSttProvider(name) {
    const p = String(name || "none").toLowerCase();
    if (p === "whisper" || p === "openai") return p;
    return "none";
}

// Write PCM16 mono buffers into a WAV file, return path.
export function writeWav(pcmBuffers, sampleRate = 16000) {
    const pcm = Buffer.concat(pcmBuffers);
    const wav = Buffer.alloc(44 + pcm.length);
    // RIFF header
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);          // PCM chunk size
    wav.writeUInt16LE(1, 20);           // PCM format
    wav.writeUInt16LE(1, 22);           // mono
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28); // byte rate
    wav.writeUInt16LE(2, 32);           // block align
    wav.writeUInt16LE(16, 34);          // bits per sample
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    const tmp = path.join(os.tmpdir(), `vg-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    fs.writeFileSync(tmp, wav);
    return tmp;
}

export class STTManager {
    constructor(cfg = {}) {
        this.provider = cfg.provider || "none";
        this.apiKey = cfg.apiKey;
        this.model = cfg.model || "medium";
        this.python = cfg.python || "python";
    }

    async transcribe(audioBuffers, sampleRate = 16000) {
        if (this.provider === "none") return "";
        if (this.provider === "mock") return "bạn có khỏe không";
        if (this.provider === "whisper") {
            const wav = writeWav(audioBuffers, sampleRate);
            try {
                const out = await new Promise((resolve, reject) => {
                    const p = spawn(this.python, [SCRIPT, wav, this.model], { windowsHide: true });
                    let buf = "";
                    p.stdout.on("data", (d) => (buf += d.toString()));
                    p.stderr.on("data", (d) => process.stderr.write(d));
                    p.on("close", (code) => {
                        try { resolve(JSON.parse(buf || "{}")); }
                        catch (e) { reject(new Error("whisper output parse error")); }
                    });
                    p.on("error", reject);
                });
                return out.text || "";
            } finally {
                try { fs.unlinkSync(wav); } catch {}
            }
        }
        throw new Error(`STT provider '${this.provider}' not implemented yet`);
    }
}



// Streaming STT: keeps one Whisper process alive, feeds PCM chunks, flushes on sentence end.
// Worker is single-threaded and processes control bytes sequentially, so responses
// come back in FIFO order. We use a promise queue (NOT a single _pending) so that a
// partial("P") and a flush("F") issued close together don't clobber each other.
export class StreamingSTT {
    constructor(cfg = {}) {
        this.provider = normalizeSttProvider(cfg.provider);
        this.model = cfg.model || "medium";
        this.python = cfg.python || "python";
        this.apiKey = cfg.apiKey || "";
        this.proc = null;
        this._buf = Buffer.alloc(0);
        this._queue = [];          // FIFO of { resolve, timer }
        this._stdoutBuf = "";      // partial stdout accumulator
        this.lastPcm = Buffer.alloc(0);
    }

    reconfigure(cfg = {}) {
        const nextProvider = normalizeSttProvider(cfg.provider ?? this.provider);
        const nextModel = cfg.model ?? this.model;
        const nextKey = cfg.apiKey !== undefined ? cfg.apiKey : this.apiKey;
        const changed = nextProvider !== this.provider ||
            nextModel !== this.model ||
            nextKey !== this.apiKey;
        this.provider = nextProvider;
        this.model = nextModel;
        if (cfg.python) this.python = cfg.python;
        if (cfg.apiKey !== undefined) this.apiKey = cfg.apiKey;
        if (this.proc) {
            try { this.proc.kill(); } catch {}
            this.proc = null;
        }
        while (this._queue.length) {
            const q = this._queue.shift();
            clearTimeout(q.timer);
            q.resolve(null);
        }
        this._buf = Buffer.alloc(0);
        this.lastPcm = Buffer.alloc(0);
        if (changed) console.log("[stt] reconfigured", this.provider, this.model);
    }

    _ensure() {
        if (this.proc && this.proc.exitCode === null) return;
        // kill a dead proc if any
        if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; }
        // reject anything still waiting
        while (this._queue.length) { const q = this._queue.shift(); clearTimeout(q.timer); q.resolve(null); }
        const script = path.join(__dirname, "..", "..", "scripts", "whisper_stream.py");
        const cleanEnv = { ...process.env };
        delete cleanEnv.PYTHONPATH;
        delete cleanEnv.PYTHONHOME;
        this.proc = spawn(this.python, [script, this.model], { windowsHide: true, env: cleanEnv });
        this.proc.stderr.on("data", (d) => process.stderr.write(d));
        this.proc.on("exit", () => {
            // worker died: fail pending requests so callers don't hang forever
            while (this._queue.length) { const q = this._queue.shift(); clearTimeout(q.timer); q.resolve(null); }
            this.proc = null;
        });
        this.proc.stdout.on("data", (d) => {
            this._stdoutBuf += d.toString();
            let nl;
            while ((nl = this._stdoutBuf.indexOf("\n")) >= 0) {
                const line = this._stdoutBuf.slice(0, nl).trim();
                this._stdoutBuf = this._stdoutBuf.slice(nl + 1);
                if (!line) continue;
                let r = null;
                try { r = JSON.parse(line); } catch { continue; }
                const q = this._queue.shift();
                if (q) { clearTimeout(q.timer); q.resolve(r); }
            }
        });
    }

    _request(ctrl, pcm, timeoutMs = 45000) {
        this._ensure();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // time out this slot; shift it out so the FIFO stays in order
                const idx = this._queue.findIndex((x) => x.resolve === resolve);
                if (idx >= 0) this._queue.splice(idx, 1);
                resolve(null);
            }, timeoutMs);
            this._queue.push({ resolve, timer });
            this.proc.stdin.write(Buffer.from([ord_c(ctrl)]));
            if (pcm && pcm.length) {
                const len = Buffer.alloc(4); len.writeUInt32LE(pcm.length, 0);
                this.proc.stdin.write(len); this.proc.stdin.write(pcm);
            }
        });
    }

    push(chunk) {
        this._buf = Buffer.concat([this._buf, chunk]);
        if (this.provider !== "whisper") return;
        // stream chunk to worker right away (control 'C' needs no response)
        this._ensure();
        this.proc.stdin.write(Buffer.from([ord_c("C")]));
        const len = Buffer.alloc(4); len.writeUInt32LE(chunk.length, 0);
        this.proc.stdin.write(len); this.proc.stdin.write(chunk);
    }

    async partial() {
        if (this.provider !== "whisper") return "";
        const r = await this._request("P", null);
        return r ? (r.text || "") : "";
    }

    async flush() {
        if (this.provider === "none") {
            this.lastPcm = Buffer.alloc(0);
            this._buf = Buffer.alloc(0);
            return "";
        }
        const pcm = this._buf;
        this.lastPcm = pcm;
        this._buf = Buffer.alloc(0);
        if (!pcm.length) return "";

        if (this.provider === "openai") {
            const wav = writeWav([pcm]);
            try {
                return await transcribeOpenAi(wav, this.apiKey);
            } finally {
                try { fs.unlinkSync(wav); } catch {}
            }
        }

        const r = await this._request("F", null);
        return r ? (r.text || "") : "";
    }

    reset() {
        this._ensure();
        if (this.proc) this.proc.stdin.write(Buffer.from([ord_c("R")]));
        this._buf = Buffer.alloc(0);
        this.lastPcm = Buffer.alloc(0);
    }
}

function ord_c(ch) { return ch.charCodeAt(0); }

// Edge TTS via edge-tts CLI (python). Returns mp3 Buffer.
export class EdgeTTS {
    constructor(cfg = {}) {
        this.provider = cfg.provider || "none";
        this.voice = cfg.voice || "vi-VN-HoaiMyNeural";
        this.python = cfg.python || "python";
    }
    async synthesize(text) {
        if (this.provider !== "edge-tts") return null;
        const tmpIn = os.tmpdir() + `/vg-tts-${Date.now()}.mp3`;
        return await new Promise((resolve, reject) => {
            const p = spawn(this.python, ["-m", "edge_tts", "--voice", this.voice, "--text", text, "--write-media", tmpIn], { windowsHide: true });
            p.stderr.on("data", (d) => process.stderr.write(d));
            p.on("close", (code) => {
                if (code !== 0) return reject(new Error("edge-tts exit " + code));
                try { const buf = fs.readFileSync(tmpIn); fs.unlinkSync(tmpIn); resolve(buf); }
                catch (e) { reject(e); }
            });
            p.on("error", reject);
        });
    }
}

// Offline TTS via pyttsx3 (Windows SAPI). Returns wav Buffer (PCM16 16k mono).
export class Pyttsx3TTS {
    constructor(cfg = {}) {
        this.provider = cfg.provider || "none";
        this.python = cfg.python || "python";
        this.rate = cfg.rate || 160;
    }
    async synthesize(text) {
        if (this.provider !== "pyttsx3") return null;
        const tmpWav = os.tmpdir() + `/vg-tts-${Date.now()}.wav`;
        return await new Promise((resolve, reject) => {
            const py = spawn(this.python, ["-c",
                `import pyttsx3,sys; e=pyttsx3.init(); e.setProperty('rate',${this.rate}); e.save_to_file(${JSON.stringify(text)},${JSON.stringify(tmpWav)}); e.runAndWait()`],
                { windowsHide: true });
            py.stderr.on("data", (d) => process.stderr.write(d));
            py.on("close", (code) => {
                if (code !== 0) return reject(new Error("pyttsx3 exit " + code));
                try { const buf = fs.readFileSync(tmpWav); fs.unlinkSync(tmpWav); resolve(buf); }
                catch (e) { reject(e); }
            });
            py.on("error", reject);
        });
    }
}

export class TTSManager {
    constructor(cfg = {}) {
        this.provider = cfg.provider || "none";
        this.apiKey = cfg.apiKey;
    }
    async synthesize() {
        return null;
    }
}

const TTS_SCRIPT = path.join(__dirname, "..", "..", "scripts", "tts_synth.py");

export function normalizeTtsProvider(name) {
    const p = String(name || "none").toLowerCase();
    if (p === "edge-tts" || p === "edge") return "edge";
    if (p === "gtts" || p === "google") return "google";
    if (p === "pyttsx3") return "pyttsx3";
    return "none";
}

/** Always returns a WAV (PCM16 mono 16 kHz) Buffer, or null. */
export class ScriptTTS {
    constructor(cfg = {}) {
        this.provider = normalizeTtsProvider(cfg.provider);
        this.voice = cfg.voice || "vi-VN-HoaiMyNeural";
        this.python = cfg.python || "python";
        this.rate = Number(cfg.rate || 160);
    }

    async synthesize(text) {
        if (this.provider === "none" || !text) return null;
        const tmpWav = path.join(os.tmpdir(), `vg-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
        return await new Promise((resolve, reject) => {
            const p = spawn(this.python, [
                TTS_SCRIPT,
                "--provider", this.provider,
                "--voice", this.voice,
                "--rate", String(this.rate),
                "--out", tmpWav
            ], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } });
            let err = "";
            p.stderr.on("data", (d) => { err += d.toString(); process.stderr.write(d); });
            p.stdin.write(text);
            p.stdin.end();
            p.on("close", (code) => {
                if (code !== 0) {
                    return reject(new Error(`${this.provider} tts failed: ${(err || "exit " + code).trim().slice(0, 300)}`));
                }
                try {
                    const buf = fs.readFileSync(tmpWav);
                    fs.unlinkSync(tmpWav);
                    resolve(buf);
                } catch (e) { reject(e); }
            });
            p.on("error", reject);
        });
    }
}

export function createTts(cfg = {}) {
    const provider = normalizeTtsProvider(cfg.provider);
    if (provider === "none") return new TTSManager({ provider: "none" });
    return new ScriptTTS({ ...cfg, provider });
}
