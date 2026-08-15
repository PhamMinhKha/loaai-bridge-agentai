/** True when the request arrived via Cloudflare Tunnel / reverse proxy. */
export function isProxied(req) {
    const h = req?.headers || {};
    return Boolean(h["cf-connecting-ip"] || h["x-forwarded-for"] || h["x-real-ip"]);
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
