import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import selfsigned from "selfsigned";
import { config } from "../config/config.js";
import { VG_ROOT } from "./envFile.js";

export const DEFAULT_TLS_DIR = path.join(VG_ROOT, "data", "tls");
export const DEFAULT_CERT_PATH = path.join(DEFAULT_TLS_DIR, "gateway.crt");
export const DEFAULT_KEY_PATH = path.join(DEFAULT_TLS_DIR, "gateway.key");

export function getLanAddresses() {
    const ips = new Set();
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces || []) {
            if (iface.family === "IPv4" && !iface.internal) {
                ips.add(iface.address);
            }
        }
    }
    return [...ips];
}

function resolvePaths(certPath, keyPath) {
    return {
        certPath: certPath || DEFAULT_CERT_PATH,
        keyPath: keyPath || DEFAULT_KEY_PATH
    };
}

function materialExists(certPath, keyPath) {
    return fs.existsSync(certPath) && fs.existsSync(keyPath);
}

function buildSanList() {
    return ["localhost", "127.0.0.1", ...getLanAddresses()];
}

function writePemFiles(certPath, keyPath, certPem, keyPem) {
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    fs.writeFileSync(certPath, certPem);
    fs.writeFileSync(keyPath, keyPem);
}

function generateWithOpenssl(sans, certPath, keyPath) {
    const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" });
    if (openssl.status !== 0) return false;

    const sanParts = sans.flatMap((name) => {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return [`IP:${name}`];
        return [`DNS:${name}`];
    });
    const subj = "/CN=Voice Gateway";
    const gen = spawnSync(
        "openssl",
        [
            "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", keyPath,
            "-out", certPath,
            "-days", "825",
            "-nodes",
            "-subj", subj,
            "-addext", `subjectAltName=${sanParts.join(",")}`
        ],
        { encoding: "utf8" }
    );
    return gen.status === 0 && materialExists(certPath, keyPath);
}

async function generateWithSelfsigned(sans, certPath, keyPath) {
    const altNames = sans.map((name) => {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return { type: 7, ip: name };
        return { type: 2, value: name };
    });
    const pems = await selfsigned.generate(
        [{ name: "commonName", value: "Voice Gateway" }],
        {
            days: 825,
            keySize: 2048,
            algorithm: "sha256",
            extensions: [{ name: "subjectAltName", altNames }]
        }
    );
    writePemFiles(certPath, keyPath, pems.cert, pems.private);
    return materialExists(certPath, keyPath);
}

export async function ensureTlsMaterial(certPath = "", keyPath = "") {
    const paths = resolvePaths(certPath, keyPath);
    if (materialExists(paths.certPath, paths.keyPath)) {
        return { ...paths, generated: false };
    }

    const sans = buildSanList();
    const ok = generateWithOpenssl(sans, paths.certPath, paths.keyPath)
        || await generateWithSelfsigned(sans, paths.certPath, paths.keyPath);
    if (!ok) {
        throw new Error("Không tạo được cert TLS (openssl/selfsigned)");
    }
    return { ...paths, generated: true };
}

export async function loadTlsOptions(certPath = "", keyPath = "") {
    const paths = await ensureTlsMaterial(certPath, keyPath);
    return {
        ...paths,
        key: fs.readFileSync(paths.keyPath),
        cert: fs.readFileSync(paths.certPath)
    };
}

export function tlsReady(certPath = "", keyPath = "") {
    const paths = resolvePaths(certPath, keyPath);
    return materialExists(paths.certPath, paths.keyPath);
}

export function readPublicCertInfo(certPath = "", keyPath = "") {
    const paths = resolvePaths(certPath, keyPath);
    if (!materialExists(paths.certPath, paths.keyPath)) return null;
    const pem = fs.readFileSync(paths.certPath, "utf8").trim();
    const sha256 = crypto.createHash("sha256").update(pem).digest("hex");
    return { pem, sha256, certPath: paths.certPath };
}

export function isTlsEnabled() {
    return process.env.TLS_ENABLED === "true" || config.tlsEnabled;
}

/** Gửi kèm hello WSS để ESP32 lưu cert vào NVS (không cần embed firmware). */
export function getTlsProvisionPayload() {
    if (!isTlsEnabled() || !tlsReady()) return null;
    const info = readPublicCertInfo();
    if (!info) return null;
    return {
        tls_cert: info.pem,
        tls_cert_sha256: info.sha256
    };
}
