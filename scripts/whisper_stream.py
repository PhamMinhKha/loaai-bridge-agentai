#!/usr/bin/env python
# Persistent local Whisper STT worker (single-thread, streaming-friendly).
# Model stays loaded. Gateway streams raw PCM16 mono chunks on stdin.
# Control protocol (1 control byte + optional framed payload):
#   'C' + uint32 LE length + <length> bytes raw PCM16  -> append to buffer
#   'F' -> transcribe buffer, emit {"text":..., "final":true}, CLEAR buffer
#   'P' -> transcribe buffer, emit {"text":..., "partial":true}, KEEP buffer
#   'R' -> clear buffer
import sys, json, struct, wave, tempfile, os

def main():
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        sys.stderr.write(f"import error: {e}\n"); sys.exit(1)

    model_size = sys.argv[1] if len(sys.argv) > 1 else "medium"
    model = WhisperModel(model_size, device="cpu", compute_type="int8", cpu_threads=8)
    SR = 16000
    buf = bytearray()

    def transcribe_buffer(clear):
        nonlocal buf
        if not buf:
            return ""
        pcm = bytes(buf)
        if clear:
            buf = bytearray()
        wf = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        wav = bytearray()
        wav += b"RIFF"; wav += struct.pack("<I", 36+len(pcm)); wav += b"WAVE"
        wav += b"fmt "; wav += struct.pack("<IHHIIHH", 16, 1, 1, SR, SR*2, 2, 16)
        wav += b"data"; wav += struct.pack("<I", len(pcm)); wav += pcm
        wf.write(bytes(wav)); wf.close()
        segments, _ = model.transcribe(wf.name, language="vi", beam_size=5, without_timestamps=True)
        text = "".join(s.text for s in segments).strip()
        os.unlink(wf.name)
        return text

    stdin = sys.stdin.buffer
    out = sys.stdout

    def read_exact(n):
        parts = []
        while n > 0:
            chunk = stdin.read(n)
            if not chunk:
                break
            parts.append(chunk)
            n -= len(chunk)
        return b"".join(parts)

    while True:
        ctrl = read_exact(1)
        if not ctrl:
            break
        c = ctrl[0]
        if c == ord('C'):
            (n,) = struct.unpack("<I", read_exact(4))
            buf.extend(read_exact(n))
        elif c == ord('F'):
            text = transcribe_buffer(clear=True)
            out.write(json.dumps({"text": text, "final": True}) + "\n"); out.flush()
        elif c == ord('P'):
            text = transcribe_buffer(clear=False)
            out.write(json.dumps({"text": text, "partial": True}) + "\n"); out.flush()
        elif c == ord('R'):
            buf = bytearray()

if __name__ == "__main__":
    main()
