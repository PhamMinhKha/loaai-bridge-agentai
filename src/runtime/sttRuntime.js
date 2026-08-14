import { config } from "../config/config.js";
import { StreamingSTT, normalizeSttProvider } from "../audio/audioManager.js";

let instance = null;
const overrides = {
    provider: normalizeSttProvider(config.stt.provider),
    model: config.stt.model || "medium",
    apiKey: config.stt.apiKey || ""
};

function buildCfg() {
    return {
        provider: overrides.provider,
        model: overrides.model,
        python: config.stt.python,
        apiKey: overrides.apiKey
    };
}

export function getSttPrefs() {
    return {
        stt: overrides.provider,
        whisperModel: overrides.model,
        sttApiKey: overrides.apiKey
    };
}

export function getStt() {
    if (!instance) {
        instance = new StreamingSTT(buildCfg());
    }
    return instance;
}

export function reconfigureStt(patch = {}) {
    if (patch.provider !== undefined) {
        overrides.provider = normalizeSttProvider(patch.provider);
    }
    if (patch.model !== undefined) overrides.model = patch.model;
    if (patch.apiKey !== undefined) overrides.apiKey = patch.apiKey;
    if (!instance) {
        instance = new StreamingSTT(buildCfg());
    } else {
        instance.reconfigure(buildCfg());
    }
    return instance;
}

export function initSttFromEnv() {
    overrides.provider = normalizeSttProvider(config.stt.provider);
    overrides.model = config.stt.model || "medium";
    overrides.apiKey = config.stt.apiKey || "";
    getStt();
}
