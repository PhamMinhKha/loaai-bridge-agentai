function authHeaders(token) {
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

export async function startHermesRun({ baseUrl, token, input, sessionId, history, model }) {
    const url = `${String(baseUrl).replace(/\/$/, "")}/v1/runs`;
    const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
            input,
            model,
            session_id: sessionId,
            conversation_history: history || []
        })
    });
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { /* ignore */ }
    if (!res.ok && res.status !== 202) {
        if (res.status === 401) {
            throw new Error(`Hermes runs HTTP 401 — HERMES_TOKEN không khớp API_SERVER_KEY. ${raw.slice(0, 120)}`);
        }
        throw new Error(`Hermes runs HTTP ${res.status} ${raw.slice(0, 200)}`);
    }
    const runId = data.run_id;
    if (!runId) throw new Error("Hermes runs: missing run_id");
    return { runId, status: data.status || "started" };
}

export async function getHermesRun({ baseUrl, token, runId }) {
    const url = `${String(baseUrl).replace(/\/$/, "")}/v1/runs/${encodeURIComponent(runId)}`;
    const res = await fetch(url, { headers: authHeaders(token) });
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { /* ignore */ }
    if (res.status === 404) return { status: "lost", error: "Run hết hạn trên Hermes (không còn status)" };
    if (!res.ok) throw new Error(`Hermes run status HTTP ${res.status} ${raw.slice(0, 200)}`);
    return data;
}

export function isRunTerminal(st) {
    const s = String(st?.status || "").toLowerCase();
    return s === "completed" || s === "failed" || s === "cancelled" || s === "lost";
}

export async function waitHermesRun({ baseUrl, token, runId, waitMs, intervalMs = 2000 }) {
    const deadline = Date.now() + Math.max(1000, waitMs);
    let last = { status: "started" };
    while (Date.now() < deadline) {
        last = await getHermesRun({ baseUrl, token, runId });
        if (isRunTerminal(last)) return last;
        const left = deadline - Date.now();
        await new Promise((r) => setTimeout(r, Math.min(intervalMs, Math.max(200, left))));
    }
    return last;
}
