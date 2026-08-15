import { timingSafeEqual } from "node:crypto";
import { config } from "../config/config.js";
import { isLoopback } from "./clientAddress.js";

export function tokensEqual(provided, secret) {
    const a = Buffer.from(String(provided ?? ""), "utf8");
    const b = Buffer.from(String(secret ?? ""), "utf8");
    if (!b.length || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Remote clients must send hello.token === DEVICE_TOKEN_SECRET when
 * REQUIRE_DEVICE_TOKEN=true. Direct loopback (Tauri / local tests) is exempt.
 */
export function checkDeviceHello(message, req, opts = {}) {
    const requireToken = opts.requireDeviceToken ?? config.requireDeviceToken;
    const secret = opts.deviceTokenSecret ?? config.deviceTokenSecret;
    if (!requireToken) return { ok: true };
    if (req && isLoopback(req)) return { ok: true };
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
    return Boolean(requireToken && !(req && isLoopback(req)));
}
