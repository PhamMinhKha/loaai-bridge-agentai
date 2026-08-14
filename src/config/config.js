import "dotenv/config";

export const config = {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "0.0.0.0",

    agentProvider: process.env.AGENT_PROVIDER || "mock",

    requireDeviceToken:
        process.env.REQUIRE_DEVICE_TOKEN === "true",

    deviceTokenSecret: process.env.DEVICE_TOKEN_SECRET || "",

    openclaw: {
        url: process.env.OPENCLAW_URL || "http://127.0.0.1:18789",
        token: process.env.OPENCLAW_TOKEN || "",
        model: process.env.OPENCLAW_MODEL || "openclaw/default"
    },

    hermes: {
        url: process.env.HERMES_URL || "http://127.0.0.1:8642",
        token: process.env.HERMES_TOKEN || "",
        model: process.env.HERMES_MODEL || "hermes-agent"
    },

    agentTimeoutMs: Number(process.env.AGENT_TIMEOUT_MS || 180000),
    /** Chờ TTS/web trước khi chuyển chạy nền */
    agentWaitMs: Number(process.env.AGENT_WAIT_MS || 90000),
    /** Thời gian tối đa cho job nền (mặc định 30 phút) */
    agentMaxMs: Number(process.env.AGENT_MAX_MS || 1800000),

    stt: {
        provider: process.env.STT_PROVIDER || "none",
        apiKey: process.env.STT_API_KEY,
        model: process.env.WHISPER_MODEL || "medium",
        python: process.env.WHISPER_PYTHON || "python"
    },

    tts: {
        provider: process.env.TTS_PROVIDER || "none",
        apiKey: process.env.TTS_API_KEY,
        voice: process.env.TTS_VOICE || "vi-VN-HoaiMyNeural",
        python: process.env.TTS_PYTHON || "python",
        rate: Number(process.env.TTS_RATE || 160)
    }
};
