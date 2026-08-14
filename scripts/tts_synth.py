#!/usr/bin/env python
# Unified TTS -> WAV PCM16 mono 16 kHz.
# Usage: python tts_synth.py --provider pyttsx3|edge|google --voice NAME --rate 160 --out out.wav
# Text is read from stdin.
import argparse, audioop, os, shutil, subprocess, sys, tempfile, wave

SR = 16000


def write_wav(path, pcm, sample_rate=SR):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)


def read_wav_pcm(path):
    with wave.open(path, "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        rate = wf.getframerate()
        pcm = wf.readframes(wf.getnframes())
    if sw != 2:
        raise RuntimeError("expected 16-bit wav")
    if nch == 2:
        pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
    if rate != SR:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, SR, None)
    return pcm


def decode_mp3_to_pcm(mp3_path):
    try:
        import miniaudio
        decoded = miniaudio.decode_file(
            mp3_path,
            nchannels=1,
            sample_rate=SR,
            sample_format=miniaudio.SampleFormat.SIGNED16,
        )
        return bytes(decoded.samples)
    except Exception as e:
        sys.stderr.write(f"miniaudio decode failed: {e}\n")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("cannot decode mp3: install miniaudio (pip) or ffmpeg")
    wav_tmp = mp3_path + ".wav"
    subprocess.check_call(
        [ffmpeg, "-y", "-i", mp3_path, "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", wav_tmp],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        return read_wav_pcm(wav_tmp)
    finally:
        try:
            os.unlink(wav_tmp)
        except OSError:
            pass


def synth_pyttsx3(text, rate, out_path):
    import pyttsx3
    tmp = out_path + ".src.wav"
    e = pyttsx3.init()
    e.setProperty("rate", rate)
    e.save_to_file(text, tmp)
    e.runAndWait()
    pcm = read_wav_pcm(tmp)
    os.unlink(tmp)
    write_wav(out_path, pcm)


def synth_edge(text, voice, out_path):
    import asyncio
    import edge_tts
    mp3 = out_path + ".mp3"

    async def _run():
        comm = edge_tts.Communicate(text, voice)
        await comm.save(mp3)

    asyncio.run(_run())
    try:
        pcm = decode_mp3_to_pcm(mp3)
        write_wav(out_path, pcm)
    finally:
        try:
            os.unlink(mp3)
        except OSError:
            pass


def synth_google(text, voice, out_path):
    from gtts import gTTS
    lang = (voice or "vi").replace("_", "-")
    if lang.lower().startswith("vi"):
        lang = "vi"
    elif "-" in lang:
        lang = lang.split("-")[0].lower()
    mp3 = out_path + ".mp3"
    gTTS(text=text, lang=lang).save(mp3)
    try:
        pcm = decode_mp3_to_pcm(mp3)
        write_wav(out_path, pcm)
    finally:
        try:
            os.unlink(mp3)
        except OSError:
            pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--provider", required=True)
    p.add_argument("--voice", default="vi-VN-HoaiMyNeural")
    p.add_argument("--rate", type=int, default=160)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    text = sys.stdin.buffer.read().decode("utf-8").strip()
    if not text:
        sys.stderr.write("empty text\n")
        sys.exit(2)
    provider = args.provider.strip().lower()
    if provider in ("edge-tts", "edge"):
        synth_edge(text, args.voice, args.out)
    elif provider == "google" or provider == "gtts":
        synth_google(text, args.voice, args.out)
    elif provider == "pyttsx3":
        synth_pyttsx3(text, args.rate, args.out)
    else:
        sys.stderr.write(f"unknown tts provider: {provider}\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
