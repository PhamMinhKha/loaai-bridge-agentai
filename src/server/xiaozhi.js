import { OpusDecodeStream, OpusEncodeStream, OPUS_FRAME_MS } from "../audio/opusCodec.js";
import { getOrCreateSession, setState } from "../sessions/sessionManager.js";
import { mergePrefs, resolveAgent, resolveTts } from "../runtime/options.js";
import { playTtsXiaozhi } from "../audio/ttsPlayback.js";
import { mirrorChatToTelegram } from "../runtime/telegramSync.js";

const VOICE_ENERGY = 200;
const SILENCE_MS = 1200;
const LISTEN_MS = 30000;

function pcmChunkEnergy(buf) {
    try {
        const ab = new ArrayBuffer(buf.length);
        new Uint8Array(ab).set(buf);
        const v = new Int16Array(ab);
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
    let codec = (initialFormat === "pcm") ? "pcm" : "opus";
    let prefs = { ...initialPrefs };
    const opusDec = new OpusDecodeStream();
    const opusEnc = new OpusEncodeStream();

    const send = (o) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)); };
    const clearSilence = () => { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } };
    const clearListen = () => { if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; } };
    const armSilence = () => { clearSilence(); silenceTimer = setTimeout(() => finalizeAudio(), SILENCE_MS); };
    const armListen = () => {
        clearListen();
        listenTimer = setTimeout(() => {
            if (!voiceStarted) { send({ type: "state", state: "idle" }); setState(deviceId, "idle"); stt.reset(); }
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
            console.log("[xiaozhi-stt]", sttMs, "ms", (transcript || "").slice(0, 40));
            if (transcript && transcript.trim()) {
                send({ type: "stt", text: transcript.trim(), sttMs });
                await handleTextCommand(transcript.trim());
            } else {
                send({ type: "state", state: "idle" });
                armListen();
            }
        } catch (e) {
            console.error("[xiaozhi-stt]", e.message);
            send({ type: "state", state: "idle" });
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
    send({ type: "state", state: "idle" });
    armListen();

    socket.on("message", async (data, isBinary) => {
        try {
            if (isBinary) {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                let pcm = buf;
                if (codec === "opus") pcm = opusDec.decode(buf);
                if (!pcm || !pcm.length) return;
                stt.push(pcm);
                const energy = pcmChunkEnergy(pcm);
                if (!voiceStarted && energy > VOICE_ENERGY) {
                    voiceStarted = true;
                    clearListen();
                    send({ type: "state", state: "listening" });
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
                await handleTextCommand(message.text);
            } else if (message.type === "audio_end") {
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
