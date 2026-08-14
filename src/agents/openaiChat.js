export async function openaiChatCompletions({
    baseUrl,
    token,
    model,
    messages,
    user,
    extraHeaders = {},
    timeoutMs = 60000
}) {
    if (!baseUrl) throw new Error("Agent URL not configured");
    const url = `${String(baseUrl).replace(/\/$/, "")}/v1/chat/completions`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...extraHeaders
            },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                ...(user ? { user } : {})
            }),
            signal: ac.signal
        });
        const raw = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${raw.slice(0, 240)}`);
        }
        let data;
        try {
            data = JSON.parse(raw);
        } catch {
            throw new Error("Agent returned non-JSON");
        }
        const text =
            data.choices?.[0]?.message?.content ||
            data.text ||
            data.reply ||
            data.message ||
            "";
        if (typeof text !== "string") {
            return { text: JSON.stringify(text) };
        }
        return { text };
    } catch (e) {
        if (e.name === "AbortError") {
            throw new Error(`Agent timeout (${Math.round(timeoutMs / 1000)}s)`);
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

export async function probeOpenAi(baseUrl, token, timeoutMs = 1200) {
    if (!baseUrl) return false;
    const url = `${String(baseUrl).replace(/\/$/, "")}/v1/models`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: ac.signal
        });
        return res.ok || res.status === 401;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}
