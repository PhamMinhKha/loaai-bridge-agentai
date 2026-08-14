import fs from "node:fs";

const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeOpenAi(wavPath, apiKey, model = "whisper-1") {
    if (!apiKey) throw new Error("STT OpenAI: thiếu API key (STT_API_KEY)");
    const buf = fs.readFileSync(wavPath);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
    form.append("model", model);
    form.append("language", "vi");

    const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error(`OpenAI STT: ${raw.slice(0, 200)}`); }
    if (!res.ok) throw new Error(data.error?.message || `OpenAI STT HTTP ${res.status}`);
    return data.text || "";
}
