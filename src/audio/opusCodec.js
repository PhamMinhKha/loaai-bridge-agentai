import opusPkg from "@discordjs/opus";
const { OpusEncoder } = opusPkg;
import OpusScript from "opusscript";

const SR = 16000;
const CHANNELS = 1;
const FRAME_MS = 60; // xiaozhi default opus frame duration
const FRAME_SAMPLES = (SR * FRAME_MS) / 1000; // 960
const FRAME_BYTES = FRAME_SAMPLES * 2; // PCM16 = 1920 bytes per frame

function toPcm16Buffer(pcm) {
    if (!pcm) return Buffer.alloc(0);
    if (Buffer.isBuffer(pcm)) return Buffer.from(pcm);
    if (pcm instanceof Int16Array) {
        return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    }
    if (pcm instanceof Uint8Array) return Buffer.from(pcm);
    return Buffer.alloc(0);
}

// Encoder: PCM16 Buffer (s16le) -> array of raw opus packets (60ms each)
export class OpusEncodeStream {
    constructor() {
        this.enc = new OpusEncoder(SR, CHANNELS);
    }
    encode(pcm) {
        const out = [];
        let offset = 0;
        while (offset + FRAME_BYTES <= pcm.length) {
            const frame = pcm.subarray(offset, offset + FRAME_BYTES);
            try {
                const pkt = this.enc.encode(frame);
                if (pkt && pkt.length) out.push(Buffer.from(pkt));
            } catch (e) { /* skip bad frame */ }
            offset += FRAME_BYTES;
        }
        return out;
    }
}

// Decoder: raw opus packet -> PCM16 s16le Buffer (1920 bytes for 60ms)
export class OpusDecodeStream {
    constructor() {
        this.native = null;
        this.script = null;
        this.decodeFails = 0;
        try {
            this.native = new OpusEncoder(SR, CHANNELS);
        } catch (e) {
            console.warn("[opus] native decoder unavailable, using opusscript:", e.message);
        }
        try {
            this.script = new OpusScript(SR, CHANNELS);
        } catch (e) {
            console.warn("[opus] opusscript unavailable:", e.message);
        }
    }
    decode(packet) {
        const buf = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
        if (!buf.length) return Buffer.alloc(0);
        if (this.native) {
            try {
                const pcm = toPcm16Buffer(this.native.decode(buf));
                if (pcm.length) return pcm;
            } catch (e) {
                this.decodeFails++;
                if (this.decodeFails <= 5 || this.decodeFails % 50 === 0) {
                    console.warn("[opus] native decode fail", this.decodeFails, e.message, "pkt", buf.length);
                }
            }
        }
        if (this.script) {
            try {
                const pcm = toPcm16Buffer(this.script.decode(buf));
                if (pcm.length) return pcm;
            } catch (e) {
                this.decodeFails++;
                if (this.decodeFails <= 5 || this.decodeFails % 50 === 0) {
                    console.warn("[opus] script decode fail", this.decodeFails, e.message, "pkt", buf.length);
                }
            }
        }
        return Buffer.alloc(0);
    }
}

export const OPUS_SR = SR;
export const OPUS_FRAME_MS = FRAME_MS;
export const OPUS_FRAME_BYTES = FRAME_BYTES;
