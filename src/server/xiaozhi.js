import { OpusDecodeStream, OpusEncodeStream, OPUS_FRAME_MS } from "../audio/opusCodec.js";
import { getOrCreateSession, setState } from "../sessions/sessionManager.js";
import { mergePrefs, resolveAgent, resolveTts } from "../runtime/options.js";
import { playTtsXiaozhi } from "../audio/ttsPlayback.js";
import { mirrorChatToTelegram } from "../runtime/telegramSync.js";
import { sendJson } from "../runtime/log.js";
import { saveSttDump } from "../runtime/sttDump.js";
import { acceptSttText } from "../runtime/sttFilter.js";

const VOICE_ENERGY = 200;
const SILENCE_MS = 1200;
const LISTEN_MS = 30000;
const WARMUP_MS = 900;
const HOT_FRAMES = 6; // ~360ms tiếng thật, tránh pop lúc mở mic

function pcmChunkEnergy(buf) {
    try {
        if (!buf || buf.length < 2) return 0;
        const v = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
        let sum = 0;
        for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
        return v.length ? Math.sqrt(sum / v.length) : 0;
    } catch { return 0; }
}

export function handleXiaozhi(socket, stt, initialFormat, initialPrefs, extra = {}) {
    let deviceId = null;
    let session = null;
    let silenceTimer = null, listenTimer = null;
    let voiceStarted = false;
    let listenArmedAt = Date.now();
    let hotFrames = 0;
    let codec = (initialFormat === "pcm") ? "pcm" : "opus";
    let prefs = { ...initialPrefs };
    const opusDec = new OpusDecodeStream();
    const opusEnc = new OpusEncodeStream();

    const send = (o) => sendJson(socket, o, "xiaozhi");
    const clearSilence = () => { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } };
    const clearListen = () => { if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; } };
    const armSilence = () => { clearSilence(); silenceTimer = setTimeout(() => finalizeAudio(), SILENCE_MS); };
    const armListen = () => {
        clearListen();
        listenTimer = setTimeout(() => {
            if (!voiceStarted) {
                stt.reset();
                send({ type: "state", state: "listening" });
                armListen();
            }
        }, LISTEN_MS);
    };

    const finalizeAudio = async (fromClient = false) => {
        clearSilence();
        if (!session) return;
        if (!voiceStarted && !fromClient) return;
        voiceStarted = false;
        send({ type: "state", state: "processing" });
        const t0 = Date.now();
        try {
            const transcript = await stt.flush();
            const sttMs = Date.now() - t0;
            const raw = transcript == null ? "" : String(transcript);
            const text = acceptSttText(raw);
            if (raw.trim() && !text) {
                console.log("[xiaozhi-stt] drop hallucination", sttMs, "ms", JSON.stringify(raw.trim()));
            } else {
                console.log("[xiaozhi-stt]", sttMs, "ms", text ? JSON.stringify(text) : "(empty)");
            }
            saveSttDump({
                text: text || (raw.trim() ? `(hallucination) ${raw.trim()}` : ""),
                pcm: stt.lastPcm,
                deviceId,
                source: "xiaozhi",
                sttMs
            });
            if (text) {
                const ok = send({ type: "stt", text, sttMs });
                console.log("[xiaozhi-stt] transcript → client:", ok ? "yes" : "NO");
                await handleTextCommand(text);
            } else {
                send({ type: "state", state: "listening" });
                armListen();
            }
        } catch (e) {
            console.error("[xiaozhi-stt]", e.message);
            send({ type: "state", state: "listening" });
            armListen();
        }
    };

    const handleTextCommand = async (text) => {
        send({ type: "state", state: "thinking" });
        const agent = resolveAgent(prefs);
        const tts = resolveTts(prefs);
        const later = async ({ text: reply, error }) => {
            if (error) {
                send({ type: "error", code: "AGENT_ERROR", message: error });
                mirrorChatToTelegram({ user: text, error });
                return;
            }
            send({ type: "llm", text: reply, emotion: "neutral" });
            mirrorChatToTelegram({ user: text, assistant: reply });
            try {
                await playTtsXiaozhi(socket, tts, reply, { codec, opusEnc });
            } catch (e) { console.error("[xiaozhi-tts]", e.message); }
        };
        try {
            const result = await agent.sendMessage({ sessionId: session.sessionId, text, onLater: later });
            const reply = result.text || "";
            send({ type: "state", state: "speaking" });
            send({ type: "llm", text: reply, emotion: "neutral" });
            if (result.deferred) {
                mirrorChatToTelegram({ user: text, running: true });
            } else {
                mirrorChatToTelegram({ user: text, assistant: reply });
            }
            try {
                await playTtsXiaozhi(socket, tts, reply, { codec, opusEnc });
            } catch (e) { console.error("[xiaozhi-tts]", e.message); }
        } catch (e) {
            console.error("[xiaozhi-agent]", e.message);
            send({ type: "error", code: "AGENT_ERROR", message: e.message });
            mirrorChatToTelegram({ user: text, error: e.message });
        }
        send({ type: "state", state: "listening" });
        armListen();
    };

    deviceId = extra.deviceId || "xiaozhi-" + Math.random().toString(36).slice(2, 8);
    session = getOrCreateSession(deviceId);
    send({
        type: "hello",
        session_id: session.sessionId,
        transport: "websocket",
        audio_params: { sample_rate: 16000, frame_duration: OPUS_FRAME_MS }
    });
    send({ type: "config_ok", ...prefs });
    send({ type: "state", state: "listening" });
    armListen();

    let rxFrames = 0;
    socket.on("message", async (data, isBinary) => {
        try {
            if (isBinary) {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                let pcm = buf;
                if (codec === "opus") pcm = opusDec.decode(buf);
                rxFrames++;
                if (!pcm || !pcm.length) {
                    if (rxFrames <= 5 || rxFrames % 50 === 0) {
                        console.warn("[xiaozhi] empty pcm after decode frame", rxFrames, "opus", buf.length);
                    }
                    return;
                }
                if (Date.now() - listenArmedAt < WARMUP_MS) {
                    return;
                }
                stt.push(pcm);
                const energy = pcmChunkEnergy(pcm);
                if (rxFrames <= 3 || rxFrames % 50 === 0) {
                    console.log("[xiaozhi] audio frame", rxFrames, "opus", buf.length, "pcm", pcm.length, "rms", Math.round(energy));
                }
                if (energy > VOICE_ENERGY) {
                    hotFrames++;
                } else {
                    hotFrames = 0;
                }
                if (!voiceStarted && hotFrames >= HOT_FRAMES) {
                    voiceStarted = true;
                    clearListen();
                    send({ type: "state", state: "listening" });
                    console.log("[xiaozhi] voice started rms", Math.round(energy), "hot", hotFrames);
                }
                if (voiceStarted && energy > VOICE_ENERGY) armSilence();
                return;
            }
            const message = JSON.parse(data.toString());
            if (message.type === "hello") {
                if (message.audio_params && message.audio_params.format) {
                    codec = message.audio_params.format === "pcm" ? "pcm" : "opus";
                }
                if (message.device_id) {
                    deviceId = message.device_id;
                    session = getOrCreateSession(deviceId);
                }
                if (message.agent || message.tts || message.voice) {
                    prefs = mergePrefs(prefs, message);
                    send({ type: "config_ok", ...prefs });
                }
            } else if (message.type === "config") {
                prefs = mergePrefs(prefs, message);
                send({ type: "config_ok", ...prefs });
            } else if (message.type === "text") {
                console.log("[xiaozhi] text from client", JSON.stringify(message.text || ""));
                await handleTextCommand(message.text);
            } else if (message.type === "audio_start") {
                voiceStarted = false;
                hotFrames = 0;
                rxFrames = 0;
                listenArmedAt = Date.now();
                if (stt && stt.reset) stt.reset();
                clearSilence();
                send({ type: "state", state: "listening" });
                armListen();
            } else if (message.type === "pause") {
                voiceStarted = false;
                hotFrames = 0;
                clearSilence();
                clearListen();
                if (stt && stt.reset) stt.reset();
                send({ type: "state", state: "idle" });
                console.log("[xiaozhi] paused — stay idle until audio_start");
            } else if (message.type === "audio_end") {
                if (!voiceStarted) {
                    console.log("[xiaozhi] ignore audio_end before voice");
                    return;
                }
                await finalizeAudio(true);
            }
        } catch (e) {
            console.error("[xiaozhi]", e.message);
        }
    });

    socket.on("close", () => {
        clearSilence(); clearListen();
        if (stt && stt.reset) stt.reset();
        console.log("xiaozhi device disconnected:", deviceId);
    });
}
