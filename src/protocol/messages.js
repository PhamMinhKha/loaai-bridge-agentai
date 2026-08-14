// Unified protocol message builders (Gateway -> ESP32)
export function helloAck(deviceId, sessionId) {
    return { type: "hello_ack", device_id: deviceId, session_id: sessionId };
}

export function state(state) {
    return { type: "state", state };
}

export function transcriptPartial(text) {
    return { type: "transcript_partial", text };
}

export function transcript(text, meta = {}) {
    return { type: "transcript", text, ...meta };
}

export function agentMessage(text, sessionId) {
    return { type: "agent_message", session_id: sessionId, text };
}

export function audioStart(format = "pcm16", sampleRate = 16000, channels = 1) {
    return { type: "audio_start", format, sample_rate: sampleRate, channels };
}

export function audioEnd() {
    return { type: "audio_end" };
}

export function error(code, message) {
    return { type: "error", code, message };
}
