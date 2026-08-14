export function clipLog(s, n = 800) {
    const t = String(s ?? "");
    if (t.length <= n) return t;
    return t.slice(0, n) + "…";
}

/** Gửi JSON tới client và log type + text (hoặc lý do không gửi được). */
export function sendJson(socket, obj, tag = "ws") {
    const type = obj?.type || "?";
    const text = obj?.text;
    const preview = type === "screenshot"
        ? `${obj.width || "?"}x${obj.height || "?"} ${obj.bytes || 0}B`
        : text != null
            ? JSON.stringify(clipLog(text))
            : (obj?.state || obj?.code || "");
    if (!socket || socket.readyState !== socket.OPEN) {
        console.warn(`[${tag}] NOT sent type=${type} (socket closed)`, preview);
        return false;
    }
    socket.send(JSON.stringify(obj));
    if (type === "stt" || type === "transcript" || type === "transcript_partial" ||
        type === "llm" || type === "agent_message" || type === "error" || type === "screenshot") {
        console.log(`[${tag}] sent → client type=${type}`, preview);
    }
    return true;
}
