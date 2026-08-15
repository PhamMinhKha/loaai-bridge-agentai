import assert from "node:assert/strict";
import { isLoopback, isProxied } from "../src/runtime/clientAddress.js";
import { tokensEqual, checkDeviceHello, remoteRequiresAuth } from "../src/runtime/deviceAuth.js";
import { parsePublicHostname } from "../src/runtime/serverControl.js";

function req(ip, headers = {}) {
    return { socket: { remoteAddress: ip }, headers };
}

assert.equal(isLoopback(req("127.0.0.1")), true);
assert.equal(isLoopback(req("::1")), true);
assert.equal(isLoopback(req("::ffff:127.0.0.1")), true);
assert.equal(isLoopback(req("192.168.1.10")), false);
assert.equal(isProxied(req("127.0.0.1", { "cf-connecting-ip": "1.2.3.4" })), true);
assert.equal(isLoopback(req("127.0.0.1", { "cf-connecting-ip": "1.2.3.4" })), false);
assert.equal(isLoopback(req("127.0.0.1", { "x-forwarded-for": "1.2.3.4" })), false);

assert.equal(tokensEqual("secret", "secret"), true);
assert.equal(tokensEqual("secret", "other"), false);
assert.equal(tokensEqual("", "secret"), false);
assert.equal(tokensEqual("secret", ""), false);

const secretOpts = { requireDeviceToken: true, deviceTokenSecret: "s3cret" };
const offOpts = { requireDeviceToken: false, deviceTokenSecret: "s3cret" };
const local = req("127.0.0.1");
const tunneled = req("127.0.0.1", { "cf-connecting-ip": "8.8.8.8" });

assert.equal(checkDeviceHello({ token: "wrong" }, local, secretOpts).ok, true);
assert.equal(checkDeviceHello({ token: "s3cret" }, tunneled, secretOpts).ok, true);
assert.equal(checkDeviceHello({ token: "wrong" }, tunneled, secretOpts).ok, false);
assert.equal(checkDeviceHello({ token: "wrong" }, tunneled, secretOpts).code, "AUTH_INVALID");
assert.equal(checkDeviceHello({}, tunneled, { requireDeviceToken: true, deviceTokenSecret: "" }).code, "AUTH_REQUIRED");
assert.equal(checkDeviceHello({ token: "wrong" }, tunneled, offOpts).ok, true);
assert.equal(remoteRequiresAuth(local, secretOpts), false);
assert.equal(remoteRequiresAuth(tunneled, secretOpts), true);
assert.equal(remoteRequiresAuth(tunneled, offOpts), false);

assert.equal(parsePublicHostname("https://Voice.YourDomain.com/ws"), "voice.yourdomain.com");
assert.equal(parsePublicHostname(""), "");
assert.throws(() => parsePublicHostname("localhost"));
assert.throws(() => parsePublicHostname("not a host"));

console.log("ok test_device_auth");
