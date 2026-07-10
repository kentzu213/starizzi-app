"""
izzi Voice TTS — a thin FastAPI wrapper around VieNeu-TTS (on-device Vietnamese
TTS + zero-shot voice cloning, CPU/ONNX). Runs fully local; no cloud, no secrets.

API (consumed by the voice-studio .ocx over loopback):
  GET  /health        — liveness (process up)
  GET  /health/live   — liveness alias
  GET  /health/ready  — readiness (200 only once the model is loaded, else 503)
  GET  /voices        — built-in default voices
  POST /tts           — { text, voice?, ref_audio_b64? } -> { ok, format, audio_b64 }

VieNeu-TTS API (per docs.vieneu.io):
  from vieneu import Vieneu
  tts = Vieneu(); audio = tts.infer(text="..."); tts.save(audio, "out.wav")
The exact kwargs for voice/clone can vary by version, so /tts degrades to
text-only if unknown kwargs are rejected.
"""
import base64
import os
import tempfile
import threading

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="izzi Voice TTS (VieNeu-TTS)")

_tts = None
_ready = False
_load_error: str | None = None
_lock = threading.Lock()

# Built-in multi-speaker voices (VieNeu-TTS v3 ships default speakers).
DEFAULT_VOICES = ["female-north", "female-south", "male-north", "male-south"]


def _load():
    """Load the model once (thread-safe). Sets _ready / _load_error."""
    global _tts, _ready, _load_error
    if _tts is not None:
        return _tts
    with _lock:
        if _tts is not None:
            return _tts
        try:
            from vieneu import Vieneu  # defaults to VieNeu-TTS v3 Turbo
            _tts = Vieneu()
            _ready = True
            _load_error = None
        except Exception as exc:  # noqa: BLE001 — surface load failure via /health/ready
            _load_error = str(exc)
            print(f"[voice-tts] model load failed: {exc}", flush=True)
    return _tts


@app.on_event("startup")
def _startup() -> None:
    # Warm the model in the background so /health stays responsive while the
    # (potentially large) first-run download happens.
    threading.Thread(target=_load, daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    if _ready and _tts is not None:
        return {"status": "ready"}
    return JSONResponse({"status": "loading", "error": _load_error}, status_code=503)


@app.get("/voices")
def voices():
    return {"voices": DEFAULT_VOICES}


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    # base64 WAV for zero-shot voice cloning. RESPONSIBLE USE ONLY: you must have
    # consent from the person whose voice is cloned (the model license forbids
    # non-consensual cloning / impersonation).
    ref_audio_b64: str | None = None


@app.post("/tts")
def tts(req: TTSRequest):
    engine = _load()
    if engine is None:
        return JSONResponse({"ok": False, "error": _load_error or "model not loaded"}, status_code=503)
    if not (req.text or "").strip():
        return JSONResponse({"ok": False, "error": "text is required"}, status_code=400)

    ref_path = None
    out_path = tempfile.mktemp(suffix=".wav")
    try:
        kwargs = {"text": req.text}
        if req.ref_audio_b64:
            ref_path = tempfile.mktemp(suffix=".wav")
            with open(ref_path, "wb") as f:
                f.write(base64.b64decode(req.ref_audio_b64))
            kwargs["ref_audio"] = ref_path
        elif req.voice:
            kwargs["voice"] = req.voice

        try:
            audio = engine.infer(**kwargs)
        except TypeError:
            # kwarg names differ in this version — fall back to plain TTS.
            audio = engine.infer(text=req.text)

        engine.save(audio, out_path)
        with open(out_path, "rb") as f:
            data = f.read()
        return {"ok": True, "format": "wav", "audio_b64": base64.b64encode(data).decode("ascii")}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)
    finally:
        for p in (ref_path, out_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
