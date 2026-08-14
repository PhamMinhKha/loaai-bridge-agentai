/** Extract PCM16 payload from a WAV buffer. Returns null if empty. */
export function wavToPcm(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf.slice(0, 4).toString("ascii") !== "RIFF") {
        return Buffer.from(buf);
    }
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const id = buf.slice(offset, offset + 4).toString("ascii");
        const size = buf.readUInt32LE(offset + 4);
        const start = offset + 8;
        if (id === "data") {
            return Buffer.from(buf.subarray(start, Math.min(start + size, buf.length)));
        }
        offset = start + size + (size % 2);
    }
    return buf.length > 44 ? Buffer.from(buf.subarray(44)) : null;
}

export function pcmToWav(pcm, sampleRate = 16000) {
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    return wav;
}
