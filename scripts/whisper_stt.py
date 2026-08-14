#!/usr/bin/env python
# Local Whisper STT via faster-whisper.
# Usage: python whisper_stt.py <wav_path> [model_size]
# Prints JSON: {"text": "..."}
import sys, json, os

# Avoid onnxruntime/MKL over-allocating threads -> "mkl_malloc: failed to allocate memory"
os.environ.setdefault("OMP_NUM_THREADS", "1")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"text": ""}))
        return
    wav = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "medium"
    try:
        from faster_whisper import WhisperModel
        m = WhisperModel(model, device="cpu", compute_type="int8")
        segments, _ = m.transcribe(
            wav,
            language="vi",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
        )
        text = "".join(s.text for s in segments).strip()
        print(json.dumps({"text": text}))
    except Exception as e:
        print(json.dumps({"text": "", "error": str(e)}))

if __name__ == "__main__":
    main()
