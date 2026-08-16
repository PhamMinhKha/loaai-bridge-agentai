import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "../config/config.js";
import { probeOpenAi, probeOpenAiAuth } from "../agents/openaiChat.js";
import { getSttPrefs } from "./sttRuntime.js";
import { VG_ENV, VG_ROOT } from "./envFile.js";

const VENV_PY = process.platform === "win32"
    ? path.join(VG_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(VG_ROOT, ".venv", "bin", "python");

function check(id, label, status, message) {
    return { id, label, status, message };
}

function runPy(args, timeoutMs = 15000) {
    const py = fs.existsSync(VENV_PY) ? VENV_PY : config.stt.python;
    return new Promise((resolve) => {
        const child = spawn(py, args, { windowsHide: true });
        let out = "";
        child.stdout?.on("data", (d) => { out += d.toString(); });
        child.stderr?.on("data", (d) => { out += d.toString(); });
        const t = setTimeout(() => { child.kill(); resolve({ ok: false, out: "timeout" }); }, timeoutMs);
        child.on("close", (code) => {
            clearTimeout(t);
            resolve({ ok: code === 0, out: out.trim() });
        });
        child.on("error", (e) => {
            clearTimeout(t);
            resolve({ ok: false, out: e.message });
        });
    });
}

export async function runDiagnostics() {
    const checks = [];
    const sttPrefs = getSttPrefs();

    const nodeMajor = Number(process.versions.node.split(".")[0]);
    checks.push(check(
        "node",
        "Node.js",
        nodeMajor >= 18 ? "ok" : "fail",
        `Phiên bản ${process.version}${nodeMajor >= 18 ? "" : " — cần >= 18"}`
    ));

    if (fs.existsSync(VG_ENV)) {
        checks.push(check("env", "File .env", "ok", VG_ENV));
    } else {
        checks.push(check("env", "File .env", "fail", "Chưa có — chạy Tự setup"));
    }

    if (fs.existsSync(VENV_PY)) {
        const ver = await runPy(["--version"], 5000);
        checks.push(check(
            "venv",
            "Python venv",
            ver.ok ? "ok" : "fail",
            ver.ok ? ver.out : ver.out || "Không chạy được"
        ));
    } else {
        checks.push(check("venv", "Python venv", "fail", `.venv chưa có tại ${VENV_PY}`));
    }

    const fw = await runPy(["-c", "import faster_whisper; print('ok')"], 10000);
    checks.push(check(
        "faster_whisper",
        "faster-whisper",
        fw.ok ? "ok" : "fail",
        fw.ok ? "Đã cài" : (fw.out || "Chưa cài — chạy Tự setup")
    ));

    if (sttPrefs.stt === "whisper") {
        const model = sttPrefs.whisperModel || "medium";
        const probe = await runPy([
            "-c",
            `from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(model)}, device="cpu", compute_type="int8"); print("ok")`
        ], 120000);
        checks.push(check(
            "whisper_model",
            `Whisper model (${model})`,
            probe.ok ? "ok" : "warn",
            probe.ok ? "Load OK" : (probe.out.slice(0, 120) || "Chưa tải model — cần mạng lần đầu")
        ));
    } else if (sttPrefs.stt === "openai") {
        const keyOk = Boolean(sttPrefs.sttApiKey && sttPrefs.sttApiKey.startsWith("sk-"));
        checks.push(check(
            "stt_openai",
            "OpenAI API key",
            keyOk ? "ok" : "fail",
            keyOk ? "Đã cấu hình" : "Thiếu hoặc sai định dạng STT_API_KEY"
        ));
    } else {
        checks.push(check("stt", "STT provider", "warn", "STT đang tắt (none)"));
    }

    checks.push(check(
        "gateway",
        "Gateway port",
        "ok",
        `Đang listen ${config.host}:${config.port}`
    ));

    const [openclawOk, hermesOk] = await Promise.all([
        probeOpenAi(config.openclaw.url, config.openclaw.token, 2000),
        probeOpenAiAuth(config.hermes.url, config.hermes.token, 2000)
    ]);
    checks.push(check(
        "openclaw",
        "OpenClaw",
        openclawOk ? "ok" : "warn",
        openclawOk ? `Reachable ${config.openclaw.url}` : `Chưa reachable ${config.openclaw.url}`
    ));
    checks.push(check(
        "hermes",
        "Hermes Agent",
        hermesOk ? "ok" : "warn",
        hermesOk ? `Reachable ${config.hermes.url}` : `Chưa reachable ${config.hermes.url}`
    ));

    const fail = checks.some((c) => c.status === "fail");
    const warn = checks.some((c) => c.status === "warn");
    return {
        ok: !fail,
        status: fail ? "fail" : warn ? "warn" : "ok",
        checks
    };
}
