import assert from "node:assert/strict";
import { buildConfigYaml } from "../src/runtime/cloudflareTunnel.js";

const yaml = buildConfigYaml({
    uuid: "11111111-2222-3333-4444-555555555555",
    hostname: "hermes.loaai.me",
    port: 8888,
    credentialsFile: "C:/Users/Admin/.cloudflared/11111111-2222-3333-4444-555555555555.json"
});

assert.match(yaml, /tunnel: 11111111-2222-3333-4444-555555555555/);
assert.match(yaml, /hostname: hermes\.loaai\.me/);
assert.match(yaml, /service: http:\/\/127\.0\.0\.1:8888/);
assert.match(yaml, /credentials-file: C:\/Users\/Admin\/\.cloudflared\//);

console.log("ok test_cloudflare_tunnel");
