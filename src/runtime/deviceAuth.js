import { timingSafeEqual } from "node:crypto";
import { config } from "../config/config.js";
import { isLoopback, isPrivateLan } from "./clientAddress.js";

export function tokensEqual(provided, secret) {
    const a = Buffer.from(String(provided ?? ""), "utf8");
    const b = Buffer.from(String(secret ?? ""), "utf8");
    if (!b.length || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Remote clients must send hello.token === DEVICE_TOKEN_SECRET when
 * REQUIRE_DEVICE_TOKEN=true. Loopback (Tauri / local tests) and LAN (RFC1918) are exempt.
 * Internet via Cloudflare (proxied 127.0.0.1) still requires token.
 */
export function checkDeviceHello(message, req, opts = {}) {
    const requireToken = opts.requireDeviceToken ?? config.requireDeviceToken;
    const secret = opts.deviceTokenSecret ?? config.deviceTokenSecret;
    if (!requireToken) return { ok: true };
    if (req && isLoopback(req)) return { ok: true };
    if (req && isPrivateLan(req)) return { ok: true };
    if (!secret) {
        return { ok: false, code: "AUTH_REQUIRED", message: "Device token required" };
    }
    if (!tokensEqual(message?.token, secret)) {
        return { ok: false, code: "AUTH_INVALID", message: "Invalid device token" };
    }
    return { ok: true };
}

export function remoteRequiresAuth(req, opts = {}) {
    const requireToken = opts.requireDeviceToken ?? config.requireDeviceToken;
    if (!requireToken) return false;
    if (req && isLoopback(req)) return false;
    if (req && isPrivateLan(req)) return false;
    return true;
}
