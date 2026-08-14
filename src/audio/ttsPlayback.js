import { wavToPcm } from "./wavUtil.js";
import * as msg from "../protocol/messages.js";

const AUDIO_TTS = new Set(["pyttsx3", "edge", "edge-tts", "google", "gtts"]);

export function ttsCanSpeak(tts) {
    return tts && AUDIO_TTS.has(String(tts.provider || "").toLowerCase());
}

/** Native protocol: JSON audio_start + one WAV binary + audio_end */
export async function playTtsNative(socket, tts, text) {
    if (!ttsCanSpeak(tts) || !text) return;
    const wav = await tts.synthesize(text);
    if (!wav) return;
    const send = (o) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o));
    };
    send(msg.audioStart("wav", 16000, 1));
    socket.send(wav);
    send(msg.audioEnd());
}

/** Xiaozhi: opus packets or one WAV blob for browser PCM mode */
export async function playTtsXiaozhi(socket, tts, text, { codec, opusEnc }) {
    if (!ttsCanSpeak(tts) || !text) return;
    const wav = await tts.synthesize(text);
    if (!wav) return;
    const send = (o) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o));
    };
    const sendBinary = (b) => {
        if (socket.readyState === socket.OPEN) socket.send(b);
    };
    if (codec === "opus") {
        const pcm = wavToPcm(wav);
        if (!pcm || !pcm.length) return;
        send({ type: "tts", state: "start", text });
        const packets = opusEnc.encode(Buffer.from(pcm));
        for (const p of packets) sendBinary(p);
        send({ type: "tts", state: "stop" });
        return;
    }
    send({ type: "audio_start", format: "wav", sample_rate: 16000 });
    sendBinary(wav);
    send({ type: "audio_end" });
}
