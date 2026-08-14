import crypto from "node:crypto";

const sessions = new Map(); // deviceId -> session

export function getOrCreateSession(deviceId) {
    let session = sessions.get(deviceId);
    if (!session) {
        session = {
            sessionId: crypto.randomUUID(),
            deviceId,
            createdAt: Date.now(),
            state: "idle"
        };
        sessions.set(deviceId, session);
    }
    return session;
}

export function getSession(deviceId) {
    return sessions.get(deviceId) || null;
}

export function setState(deviceId, state) {
    const s = sessions.get(deviceId);
    if (s) s.state = state;
}

export function removeSession(deviceId) {
    sessions.delete(deviceId);
}

export function allSessions() {
    return [...sessions.values()];
}
