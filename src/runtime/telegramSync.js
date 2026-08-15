import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { findHermesBin } from "./hermesSetup.js";
import { getTelegramPrefs } from "./options.js";

function clip(s, n = 3500) {
    const t = String(s || "").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "\n…";
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function formatTurn({ user, assistant, error, running }) {
    const u = escapeHtml(clip(user, 1200));
    const lines = [
        "🎤 <b>Loa Ai Agent Bridge</b>",
        "",
        "🟠 <b>Bạn hỏi</b>",
        `<blockquote>${u}</blockquote>`,
        ""
    ];
    if (running) {
        lines.push("⏳ <b>Đang chạy nền</b> (có thể 9–30 phút)");
        lines.push("Kết quả sẽ gửi vào chat này khi xong. Bạn cứ hỏi tiếp được.");
    } else if (error) {
        const err = escapeHtml(clip(error, 800));
        lines.push("🔴 <b>Lỗi — đã dừng</b>");
        lines.push(`<code>${err}</code>`);
        if (/timeout/i.test(error)) {
            lines.push("");
            lines.push("Hermes làm quá thời gian tối đa (AGENT_MAX_MS).");
        }
    } else {
        const a = escapeHtml(clip(assistant, 2500) || "(không có trả lời)");
        lines.push("🟢 <b>Hermes</b>");
        lines.push(a);
    }
    return lines.join("\n");
}

export function mirrorChatToTelegram({ user, assistant, error, running }) {
    const prefs = getTelegramPrefs();
    if (!prefs.sync) return Promise.resolve(false);
    const body = formatTurn({ user, assistant, error, running });
    const bin = findHermesBin();
    const target = prefs.to || "telegram";
    const tmp = path.join(os.tmpdir(), `vg-tg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    try {
        fs.writeFileSync(tmp, body, "utf8");
    } catch (e) {
        console.warn("[telegram] write temp", e.message);
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const child = spawn(bin, ["send", "--to", target, "--quiet", "--file", tmp], {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let err = "";
        child.stderr.on("data", (d) => { err += d.toString(); });
        const t = setTimeout(() => {
            child.kill();
            console.warn("[telegram] send timeout");
            resolve(false);
        }, 20000);
        const done = (ok) => {
            clearTimeout(t);
            try { fs.unlinkSync(tmp); } catch {}
            resolve(ok);
        };
        child.on("error", (e) => {
            console.warn("[telegram]", e.message);
            done(false);
        });
        child.on("close", (code) => {
            if (code !== 0) console.warn("[telegram]", (err || `exit ${code}`).trim().slice(0, 240));
            else console.log("[telegram] synced");
            done(code === 0);
        });
    });
}
