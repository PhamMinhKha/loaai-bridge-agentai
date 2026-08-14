import { WebSocketServer } from "ws";
import { getOrCreateSession, setState } from "../sessions/sessionManager.js";
import * as msg from "../protocol/messages.js";
import { handleXiaozhi } from "./xiaozhi.js";
import { getPrefs, mergePrefs, resolveAgent, resolveTts } from "../runtime/options.js";
import { playTtsNative } from "../audio/ttsPlayback.js";
import { mirrorChatToTelegram } from "../runtime/telegramSync.js";
import { sendJson } from "../runtime/log.js";
import { saveSttDump } from "../runtime/sttDump.js";
import { acceptSttText } from "../runtime/sttFilter.js";
import { isScreenshotCommand, sendScreenshot } from "../runtime/screenshot.js";
import { isGoodbyeCommand } from "../runtime/voiceCommands.js";

const VOICE_ENERGY = 200;
const PARTIAL_ENABLED = (process.env.PARTIAL_ENABLED || "false").toLowerCase() === "true";

function pcmChunkEnergy(buf) {
    try {
        const v = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
        let sum = 0;
        for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
        return Math.sqrt(sum / v.length);
    } catch {
        return 0;
    }
}

export function createWebSocketServer(server, stt, opts = {}) {
    const wss = new WebSocketServer({ server, path: "/ws" });

    const SILENCE_MS = Number(opts.silenceMs || process.env.SILENCE_MS || 1200);
    const LISTEN_MS = Number(opts.listenMs || process.env.LISTEN_MS || 30000);

    wss.on("connection", (socket) => {
        let deviceId = null;
        let session = null;
        let silenceTimer = null;
        let listenTimer = null;
        let partialTimer = null;
        let voiceStarted = false;
        let prefs = { ...getPrefs() };

        const send = (obj) => sendJson(socket, obj, "ws");

        const applyClientPrefs = (patch) => {
            prefs = mergePrefs(prefs, patch);
            console.log("[ws-prefs]", prefs);
            send({ type: "config_ok", ...prefs });
        };

        const clearSilence = () => {
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        };
        const clearListen = () => {
            if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
        };
        const clearPartial = () => {
            if (partialTimer) { clearTimeout(partialTimer); partialTimer = null; }
        };

        const armSilence = () => {
            clearSilence();
            silenceTimer = setTimeout(() => finalizeAudio(), SILENCE_MS);
        };

        const armListen = () => {
            clearListen();
            listenTimer = setTimeout(() => {
                if (!voiceStarted) {
                    send(msg.state("idle"));
                    setState(deviceId, "idle");
                    stt.reset();
                }
            }, LISTEN_MS);
        };

        const finalizeAudio = async () => {
            clearSilence();
            if (!session || !voiceStarted) return;
            voiceStarted = false;
            clearPartial();
            send(msg.state("processing"));
            const t0 = Date.now();
            try {
                const transcript = await stt.flush();
                const sttMs = Date.now() - t0;
                const raw = transcript == null ? "" : String(transcript);
                const text = acceptSttText(raw);
                if (raw.trim() && !text) {
                    console.log("[stt] drop hallucination", sttMs, "ms", JSON.stringify(raw.trim()));
                } else {
                    console.log("[stt]", sttMs, "ms", text ? JSON.stringify(text) : "(empty)");
                }
                saveSttDump({
                    text: text || (raw.trim() ? `(hallucination) ${raw.trim()}` : ""),
                    pcm: stt.lastPcm,
                    deviceId,
                    source: "ws",
                    sttMs
                });
                if (text) {
                    const ok = send(msg.transcript(text, { sttMs }));
                    console.log("[stt] transcript → client:", ok ? "yes" : "NO");
                    await handleTextCommand(text);
                } else {
                    send(msg.state("idle"));
                }
            } catch (e) {
                console.error("[stt]", e.message);
                send(msg.error("STT_ERROR", e.message));
                send(msg.state("idle"));
            }
        };

        const handleTextCommand = async (text) => {
            const lower = text.toLowerCase();
            if (/^(tăng|giảm|lên|hạ)\s*âm\s*lượng/.test(text) ||
                /^(mute|tắt tiếng|im lặng)/.test(lower)) {
                send(msg.state("idle"));
                send(msg.agentMessage("(đã xử lý lệnh cục bộ: âm lượng/mute)", session.sessionId));
                return;
            }
            if (isScreenshotCommand(text)) {
                try {
                    await sendScreenshot(send, {});
                    send(msg.agentMessage("Đã chụp màn hình máy tính.", session.sessionId));
                } catch (e) {
                    send(msg.error("SCREENSHOT_ERROR", e.message));
                }
                send(msg.state("idle"));
                return;
            }
            if (isGoodbyeCommand(text)) {
                send({ type: "goodbye", text });
                send(msg.state("idle"));
                clearSilence();
                clearListen();
                voiceStarted = false;
                if (stt && stt.reset) stt.reset();
                console.log("[ws] goodbye", JSON.stringify(text));
                setTimeout(() => {
                    try { if (socket.readyState === socket.OPEN) socket.close(); } catch { /* ignore */ }
                }, 150);
                return;
            }
            send(msg.state("thinking"));
            const agent = resolveAgent(prefs);
            const tts = resolveTts(prefs);
            const later = async ({ text: reply, error }) => {
                if (error) {
                    send(msg.error("AGENT_ERROR", error));
                    mirrorChatToTelegram({ user: text, error });
                    return;
                }
                send(msg.agentMessage(reply, session.sessionId));
                mirrorChatToTelegram({ user: text, assistant: reply });
                try { await playTtsNative(socket, tts, reply); }
                catch (e) { console.error("[tts]", e.message); }
            };
            try {
                const result = await agent.sendMessage({ sessionId: session.sessionId, text, onLater: later });
                const reply = result.text || "";
                send(msg.state("speaking"));
                send(msg.agentMessage(reply, session.sessionId));
                if (result.deferred) {
                    mirrorChatToTelegram({ user: text, running: true });
                } else {
                    mirrorChatToTelegram({ user: text, assistant: reply });
                }
                try {
                    await playTtsNative(socket, tts, reply);
                } catch (e) { console.error("[tts]", e.message); }
            } catch (e) {
                send(msg.error("AGENT_ERROR", e.message));
                mirrorChatToTelegram({ user: text, error: e.message });
            }
            send(msg.state("listening"));
            armListen();
        };

        socket.on("message", async (data, isBinary) => {
            try {
                if (isBinary) {
                    stt.push(data);
                    const energy = pcmChunkEnergy(data);
                    if (energy > 0) console.log("[vad] energy", energy.toFixed(0), "voiceStarted", voiceStarted);
                    if (!voiceStarted && energy > VOICE_ENERGY) {
                        voiceStarted = true;
                        clearListen();
                    }
                    if (voiceStarted && energy > VOICE_ENERGY) {
                        armSilence();
                        if (PARTIAL_ENABLED && !partialTimer) {
                            partialTimer = setInterval(async () => {
                                try {
                                    const pt = await stt.partial();
                                    if (pt) send(msg.transcriptPartial(pt));
                                } catch (e) { console.error("[partial]", e.message); }
                            }, 1500);
                        }
                    }
                    return;
                }
                const message = JSON.parse(data.toString());
                switch (message.type) {
                    case "hello":
                        if (message.agent || message.tts || message.voice) {
                            prefs = mergePrefs(prefs, message);
                        }
                        if (message.audio_params && (message.audio_params.format === "opus" || message.audio_params.format === "pcm")) {
                            const fmt = message.audio_params.format;
                            socket.removeAllListeners("message");
                            socket.removeAllListeners("close");
                            handleXiaozhi(socket, stt, fmt, prefs, { deviceId: message.device_id });
                            return;
                        }
                        deviceId = message.device_id;
                        session = getOrCreateSession(deviceId);
                        send(msg.helloAck(deviceId, session.sessionId));
                        send({ type: "config_ok", ...prefs });
                        break;

                    case "config":
                        applyClientPrefs(message);
                        break;

                    case "text":
                        if (!session) throw new Error("Device not authenticated");
                        await handleTextCommand(message.text);
                        break;

                    case "screenshot":
                        try {
                            await sendScreenshot(send, message, { compact: false });
                        } catch (e) {
                            send(msg.error("SCREENSHOT_ERROR", e.message));
                        }
                        break;

                    case "audio_start":
                        stt.reset();
                        voiceStarted = false;
                        clearSilence();
                        send(msg.state("listening"));
                        armListen();
                        break;

                    case "audio_end":
                        await finalizeAudio();
                        break;

                    case "interrupt":
                        clearSilence(); clearListen();
                        stt.reset();
                        voiceStarted = false;
                        setState(deviceId, "listening");
                        send(msg.state("listening"));
                        armListen();
                        break;

                    default:
                        send(msg.error("UNKNOWN_MESSAGE", "Unknown message type"));
                }
            } catch (error) {
                console.error(error);
                send(msg.error("SERVER_ERROR", error.message));
            }
        });

        socket.on("close", () => {
            clearSilence(); clearListen();
            if (stt && stt.reset) stt.reset();
            console.log("Device disconnected:", deviceId);
        });
    });

    return wss;
}
