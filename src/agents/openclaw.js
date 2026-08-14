import { Agent } from "./agent.js";
import { openaiChatCompletions } from "./openaiChat.js";
import { config } from "../config/config.js";

export class OpenClawAdapter extends Agent {
    constructor(cfg = {}) {
        super();
        this.url = cfg.url || "http://127.0.0.1:18789";
        this.token = cfg.token || "";
        this.model = cfg.model || "openclaw/default";
    }

    async sendMessage({ sessionId, text }) {
        if (!this.url) throw new Error("OpenClaw URL not configured (OPENCLAW_URL)");
        const conv = `conv:vg-${sessionId}`;
        return openaiChatCompletions({
            baseUrl: this.url,
            token: this.token,
            model: this.model,
            user: conv,
            messages: [{ role: "user", content: text }],
            extraHeaders: {
                "x-openclaw-session-key": conv
            },
            timeoutMs: config.agentTimeoutMs
        });
    }
}
