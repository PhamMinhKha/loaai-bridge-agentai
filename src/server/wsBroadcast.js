/** Registry of live WebSocket clients — push config updates when agent/STT/TTS changes. */
const clients = new Set();

/** @param {(patch: object) => void} applyPatch */
export function registerWsClient(applyPatch) {
    clients.add(applyPatch);
    return () => clients.delete(applyPatch);
}

/** Push new prefs to every connected browser / ESP32 session. */
export function broadcastConfig(prefs) {
    for (const apply of clients) {
        try {
            apply(prefs);
        } catch (e) {
            console.warn("[ws-broadcast]", e.message);
        }
    }
}
