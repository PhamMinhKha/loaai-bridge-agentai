import { config } from "../config/config.js";
import { createAgent } from "../agents/factory.js";
import { createTts, normalizeTtsProvider, normalizeSttProvider } from "../audio/audioManager.js";
import { probeOpenAi } from "../agents/openaiChat.js";
import { upsertEnvFile, VG_ENV } from "./envFile.js";
import { reconfigureStt, getSttPrefs as runtimeSttPrefs } from "./sttRuntime.js";

export const EDGE_VOICES = [
    { id: "vi-VN-HoaiMyNeural", label: "Tiếng Việt — Hoài My (nữ)" },
    { id: "vi-VN-NamMinhNeural", label: "Tiếng Việt — Nam Minh (nam)" },
    { id: "en-US-JennyNeural", label: "English — Jenny" },
    { id: "en-US-GuyNeural", label: "English — Guy" }
];

export const GOOGLE_VOICES = [
    { id: "vi", label: "Tiếng Việt (gTTS)" },
    { id: "en", label: "English (gTTS)" }
];

export const WHISPER_MODELS = [
    { id: "tiny", label: "tiny — nhanh" },
    { id: "base", label: "base" },
    { id: "small", label: "small" },
    { id: "medium", label: "medium (mặc định)" },
    { id: "large-v3", label: "large-v3 — chính xác nhất" }
];

export const STT_PROVIDERS = [
    { id: "none", label: "Tắt STT" },
    { id: "whisper", label: "Whisper local (offline)" },
    { id: "openai", label: "OpenAI Whisper API" }
];

function normalizeAgent(name) {
    const p = String(name || "mock").toLowerCase();
    if (p === "openclaw" || p === "hermes" || p === "mock") return p;
    return "mock";
}

const state = {
    agentProvider: normalizeAgent(config.agentProvider),
    ttsProvider: normalizeTtsProvider(config.tts.provider),
    ttsVoice: config.tts.voice || "vi-VN-HoaiMyNeural",
    sttProvider: normalizeSttProvider(config.stt.provider),
    whisperModel: config.stt.model || "medium",
    sttApiKey: config.stt.apiKey || "",
    openclaw: { ...config.openclaw },
    hermes: { ...config.hermes },
    telegramSync: String(process.env.TELEGRAM_SYNC || "true").toLowerCase() !== "false",
    telegramTo: process.env.TELEGRAM_TO || "telegram"
};

const agentCache = new Map();
const ttsCache = new Map();

export function getPrefs() {
    return {
        agent: state.agentProvider,
        tts: state.ttsProvider,
        voice: state.ttsVoice,
        stt: state.sttProvider,
        whisperModel: state.whisperModel
    };
}

export function getSttPrefs() {
    return runtimeSttPrefs();
}

export function getTelegramPrefs() {
    return { sync: state.telegramSync, to: state.telegramTo };
}

export function mergePrefs(base, patch = {}) {
    const next = { ...base };
    if (patch.agent) next.agent = normalizeAgent(patch.agent);
    if (patch.tts || patch.ttsProvider) next.tts = normalizeTtsProvider(patch.tts || patch.ttsProvider);
    if (patch.voice) next.voice = patch.voice;
    if (patch.stt || patch.sttProvider) next.stt = normalizeSttProvider(patch.stt || patch.sttProvider);
    if (patch.whisperModel) next.whisperModel = patch.whisperModel;
    return next;
}

function persistSttEnv() {
    const entries = {
        STT_PROVIDER: state.sttProvider,
        WHISPER_MODEL: state.whisperModel
    };
    if (state.sttApiKey) entries.STT_API_KEY = state.sttApiKey;
    upsertEnvFile(VG_ENV, entries);
}

export function applyGlobalOptions(patch = {}) {
    const prev = { ...state, sttApiKey: state.sttApiKey };
    if (patch.agent) state.agentProvider = normalizeAgent(patch.agent);
    if (patch.tts || patch.ttsProvider) {
        state.ttsProvider = normalizeTtsProvider(patch.tts || patch.ttsProvider);
    }
    if (patch.voice) state.ttsVoice = patch.voice;
    if (patch.stt || patch.sttProvider) {
        state.sttProvider = normalizeSttProvider(patch.stt || patch.sttProvider);
    }
    if (patch.whisperModel) state.whisperModel = patch.whisperModel;
    if (patch.sttApiKey) state.sttApiKey = String(patch.sttApiKey);
    if (patch.openclawUrl) state.openclaw.url = patch.openclawUrl;
    if (patch.openclawToken) state.openclaw.token = patch.openclawToken;
    if (patch.openclawModel) state.openclaw.model = patch.openclawModel;
    if (patch.hermesUrl) state.hermes.url = patch.hermesUrl;
    if (patch.hermesToken) state.hermes.token = patch.hermesToken;
    if (patch.hermesModel) state.hermes.model = patch.hermesModel;
    if (typeof patch.telegramSync === "boolean") state.telegramSync = patch.telegramSync;
    if (patch.telegramTo) state.telegramTo = String(patch.telegramTo);

    const sttChanged = state.sttProvider !== prev.sttProvider ||
        state.whisperModel !== prev.whisperModel ||
        state.sttApiKey !== prev.sttApiKey;
    if (sttChanged) {
        persistSttEnv();
        reconfigureStt({
            provider: state.sttProvider,
            model: state.whisperModel,
            apiKey: state.sttApiKey
        });
    }

    if (state.agentProvider !== prev.agentProvider ||
        state.openclaw.url !== prev.openclaw.url ||
        state.hermes.url !== prev.hermes.url) {
        agentCache.clear();
    }
    if (state.ttsProvider !== prev.ttsProvider || state.ttsVoice !== prev.ttsVoice) {
        ttsCache.clear();
    }
    console.log("[config]", getPrefs());
    return getPrefs();
}

export function resolveAgent(prefs = getPrefs()) {
    const provider = normalizeAgent(prefs.agent);
    const key = `${provider}|${state.openclaw.url}|${state.hermes.url}`;
    if (!agentCache.has(key)) {
        agentCache.set(key, createAgent({
            agentProvider: provider,
            openclaw: {
                url: state.openclaw.url || process.env.OPENCLAW_URL || "http://127.0.0.1:18789",
                token: state.openclaw.token || process.env.OPENCLAW_TOKEN || "",
                model: state.openclaw.model || process.env.OPENCLAW_MODEL || "openclaw/default"
            },
            hermes: {
                url: state.hermes.url || process.env.HERMES_URL || "http://127.0.0.1:8642",
                token: state.hermes.token || process.env.HERMES_TOKEN || "",
                model: state.hermes.model || process.env.HERMES_MODEL || "hermes-agent"
            }
        }));
    }
    return agentCache.get(key);
}

export function resolveTts(prefs = getPrefs()) {
    const provider = normalizeTtsProvider(prefs.tts);
    const voice = prefs.voice || state.ttsVoice;
    const key = `${provider}|${voice}`;
    if (!ttsCache.has(key)) {
        ttsCache.set(key, createTts({
            provider,
            voice,
            python: config.tts.python,
            rate: config.tts.rate
        }));
    }
    return ttsCache.get(key);
}

export async function publicOptions() {
    const [openclawReachable, hermesReachable] = await Promise.all([
        probeOpenAi(state.openclaw.url || "http://127.0.0.1:18789", state.openclaw.token),
        probeOpenAi(state.hermes.url || "http://127.0.0.1:8642", state.hermes.token)
    ]);
    return {
        current: {
            ...getPrefs(),
            sttApiKeySet: Boolean(state.sttApiKey)
        },
        agents: [
            { id: "mock", label: "Mock (echo local)", configured: true, reachable: true },
            {
                id: "openclaw",
                label: "OpenClaw",
                configured: Boolean(state.openclaw.url || true),
                reachable: openclawReachable,
                url: state.openclaw.url || "http://127.0.0.1:18789"
            },
            {
                id: "hermes",
                label: "Hermes Agent",
                configured: Boolean(state.hermes.url || true),
                reachable: hermesReachable,
                url: state.hermes.url || "http://127.0.0.1:8642"
            }
        ],
        tts: [
            { id: "none", label: "Không TTS (chỉ text)" },
            { id: "pyttsx3", label: "Windows SAPI (pyttsx3, offline)" },
            { id: "edge", label: "Microsoft Edge TTS (cần mạng)" },
            { id: "google", label: "Google gTTS (cần mạng)" }
        ],
        voices: {
            edge: EDGE_VOICES,
            google: GOOGLE_VOICES,
            pyttsx3: [{ id: "sapi", label: "Giọng hệ thống Windows" }],
            none: []
        },
        stt: STT_PROVIDERS,
        whisperModels: WHISPER_MODELS,
        telegram: getTelegramPrefs()
    };
}
