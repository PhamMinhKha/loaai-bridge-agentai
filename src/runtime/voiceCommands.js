function fold(s) {
    return String(s || "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Cả câu chỉ là tạm biệt / kết thúc / good bye (không phải một phần câu dài). */
export function isGoodbyeCommand(text) {
    const t = fold(text);
    return /^(tam biet|ket thuc|good\s*bye|goodbye)$/.test(t);
}
