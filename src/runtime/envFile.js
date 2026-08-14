import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VG_ROOT = path.join(__dirname, "..", "..");
export const VG_ENV = path.join(VG_ROOT, ".env");

export function upsertEnvFile(filePath, entries) {
    let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    if (text && !text.endsWith("\n")) text += "\n";
    const added = [];
    const updated = [];
    for (const [key, value] of Object.entries(entries)) {
        const re = new RegExp(`^${key}=.*$`, "m");
        if (re.test(text)) {
            text = text.replace(re, `${key}=${value}`);
            updated.push(key);
        } else {
            text += `${key}=${value}\n`;
            added.push(key);
        }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
    return { filePath, added, updated };
}
