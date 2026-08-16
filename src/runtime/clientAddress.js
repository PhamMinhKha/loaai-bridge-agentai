/** True when the request arrived via Cloudflare Tunnel / reverse proxy. */
export function isProxied(req) {
    const h = req?.headers || {};
    return Boolean(h["cf-connecting-ip"] || h["x-forwarded-for"] || h["x-real-ip"]);
}

/** Normalize ::ffff:192.168.x.x → 192.168.x.x for range checks. */
export function normalizeClientIp(raw) {
    const ip = String(raw || "").trim();
    if (ip.startsWith("::ffff:")) return ip.slice(7);
    return ip;
}

/** Direct RFC1918 / link-local — ESP32 và thiết bị cùng Wi‑Fi/LAN. */
export function isPrivateLan(req) {
    const ip = normalizeClientIp(req?.socket?.remoteAddress || "");
    if (!ip || ip.includes(":")) return false;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("169.254.")) return true;
    const m = /^172\.(\d+)\./.exec(ip);
    if (m) {
        const second = Number(m[1]);
        if (second >= 16 && second <= 31) return true;
    }
    return false;
}

/**
 * Direct loopback only. Traffic from cloudflared (127.0.0.1 + CF/X-Forwarded headers)
 * is treated as remote so public tunnel clients cannot call admin APIs.
 */
export function isLoopback(req) {
    const ip = req?.socket?.remoteAddress || "";
    const direct = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!direct) return false;
    if (isProxied(req)) return false;
    return true;
}
