import opusPkg from "@discordjs/opus";
const { OpusEncoder } = opusPkg;
import OpusScript from "opusscript";

const SR = 16000;
const CHANNELS = 1;
const FRAME_MS = 60; // xiaozhi default opus frame duration
const FRAME_SAMPLES = (SR * FRAME_MS) / 1000; // 960
const FRAME_BYTES = FRAME_SAMPLES * 2; // PCM16 = 1920 bytes per frame

// Encoder: PCM16 Buffer (s16le) -> array of raw opus packets (60ms each)
export class OpusEncodeStream {
    constructor() {
        this.enc = new OpusEncoder(SR, CHANNELS);
    }
    // pcm: Buffer of 16-bit LE samples (any length). Returns array of opus packet Buffers.
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

// Decoder: raw opus packet Buffer -> PCM16 Buffer (1920 bytes for 60ms)
export class OpusDecodeStream {
    constructor() {
        this.dec = new OpusScript(SR, CHANNELS);
    }
    decode(packet) {
        try {
            const pcm = this.dec.decode(Buffer.from(packet));
            // opusscript returns Int16Array; convert to Buffer s16le
            if (!pcm) return Buffer.alloc(0);
            const buf = Buffer.alloc(pcm.length * 2);
            for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], i * 2);
            return buf;
        } catch (e) {
            return Buffer.alloc(0);
        }
    }
}

export const OPUS_SR = SR;
export const OPUS_FRAME_MS = FRAME_MS;
export const OPUS_FRAME_BYTES = FRAME_BYTES;
