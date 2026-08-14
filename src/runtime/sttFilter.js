/** Whisper (vi) hay bịa outro YouTube khi im lặng / nhiễu. Coi như chưa nói. */

function fold(s) {
    return String(s || "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const PATTERNS = [
    /\bsubscribe\b/,
    /ghien\s*mi\s*go/,
    /ghien\s*mo\b/,
    /kenh\s*ghien/,
    /khong bo lo.{0,40}video/,
    /video hap dan/,
    /thanks for watching/,
    /like and subscribe/
];

export function isSttHallucination(text) {
    const t = fold(text);
    if (!t) return false;
    return PATTERNS.some((re) => re.test(t));
}

/** Trả "" nếu rỗng hoặc ảo giác — caller xử lý như chưa nói. */
export function acceptSttText(text) {
    const raw = text == null ? "" : String(text).trim();
    if (!raw) return "";
    if (isSttHallucination(raw)) return "";
    return raw;
}
