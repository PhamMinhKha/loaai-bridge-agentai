import { Agent } from "./agent.js";
import { openaiChatCompletions } from "./openaiChat.js";
import { config } from "../config/config.js";
import { startHermesRun, waitHermesRun, isRunTerminal } from "./hermesRun.js";
import { readHermesApiKey } from "../runtime/hermesEnv.js";

const history = new Map();

const ACK =
    "Việc này lâu hơn bình thường, mình đang làm nền. Kết quả sẽ gửi Telegram khi xong — bạn cứ hỏi tiếp được.";

export class HermesAdapter extends Agent {
    constructor(cfg = {}) {
        super();
        this.url = cfg.url || "http://127.0.0.1:8642";
        this.token = cfg.token || "";
        this.model = cfg.model || "hermes-agent";
    }

    /** Always use latest token — stale in-memory adapter caused 401 after Setup Hermes. */
    _refreshToken() {
        const key = readHermesApiKey() || process.env.HERMES_TOKEN || this.token || "";
        if (key) this.token = key;
    }

    async sendMessage({ sessionId, text, onLater } = {}) {
        if (!this.url) throw new Error("Hermes URL not configured (HERMES_URL)");
        this._refreshToken();
        if (!this.token) {
            throw new Error("HERMES_TOKEN trống — bấm «Setup Hermes API» hoặc restart app");
        }
        const key = sessionId || "default";
        const prev = history.get(key) || [];
        try {
            return await this._viaRuns({ key, prev, text, onLater });
        } catch (e) {
            console.warn("[hermes] runs API fallback:", e.message);
            return this._viaCompletions({ key, prev, text });
        }
    }

    async _viaRuns({ key, prev, text, onLater }) {
        const waitMs = Number(config.agentWaitMs || 90000);
        const maxMs = Number(config.agentMaxMs || 30 * 60 * 1000);
        const started = await startHermesRun({
            baseUrl: this.url,
            token: this.token,
            input: text,
            sessionId: key,
            history: prev,
            model: this.model
        });
        const first = await waitHermesRun({
            baseUrl: this.url,
            token: this.token,
            runId: started.runId,
            waitMs
        });
        if (first.status === "completed") {
            return this._store(key, prev, text, first.output || "");
        }
        if (isRunTerminal(first)) {
            throw new Error(first.error || `Hermes run ${first.status}`);
        }
        this._continueInBackground({
            key, prev, text, runId: started.runId, remainMs: maxMs - waitMs, onLater
        });
        return { text: ACK, deferred: true, runId: started.runId };
    }

    _continueInBackground({ key, prev, text, runId, remainMs, onLater }) {
        const t0 = Date.now();
        console.log("[hermes] background run", runId, "max", remainMs, "ms");
        waitHermesRun({
            baseUrl: this.url,
            token: this.token,
            runId,
            waitMs: remainMs,
            intervalMs: 4000
        }).then((st) => {
            const sec = Math.round((Date.now() - t0) / 1000);
            if (st.status === "completed") {
                const reply = st.output || "";
                this._store(key, prev, text, reply);
                console.log("[hermes] background done", runId, sec, "s");
                if (typeof onLater === "function") onLater({ text: reply, runId });
                return;
            }
            const err = st.error || `Hermes run ${st.status || "timeout"} sau ${sec}s`;
            console.warn("[hermes] background fail", runId, err);
            if (typeof onLater === "function") onLater({ error: err, runId });
        }).catch((e) => {
            console.warn("[hermes] background error", runId, e.message);
            if (typeof onLater === "function") onLater({ error: e.message, runId });
        });
    }

    _store(key, prev, userText, reply) {
        const messages = [...prev, { role: "user", content: userText }];
        history.set(key, [...messages, { role: "assistant", content: reply || "" }].slice(-24));
        return { text: reply || "" };
    }

    async _viaCompletions({ key, prev, text }) {
        const messages = [...prev, { role: "user", content: text }];
        const result = await openaiChatCompletions({
            baseUrl: this.url,
            token: this.token,
            model: this.model,
            messages,
            timeoutMs: config.agentWaitMs || config.agentTimeoutMs,
            extraHeaders: { "X-Hermes-Session-Id": key }
        });
        this._store(key, prev, text, result.text || "");
        return result;
    }
}
