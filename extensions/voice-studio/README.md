# Voice Studio (VieNeu-TTS) — Managed Local Backend

Text-to-speech + zero-shot voice cloning for **Vietnamese & English**, running
**fully on the user's machine** (VieNeu-TTS, CPU/ONNX, offline after the model
downloads). When the user opens the extension, Starizzi's `LocalServiceManager`
runs `docker compose up`, waits for `/health/ready` (200 only once the model has
loaded), then injects `backendUrl` so the extension's commands work over loopback.

## How the host drives it

1. Reads the `service` block in `manifest.json` (project `izzi-svc-voice-studio`,
   port 5111, health `/health/ready`, loopback).
2. `docker compose -f service/docker-compose.izzi.yml up -d`, health-gates on
   `/health/ready`, injects `backendUrl=http://127.0.0.1:<port>`.
3. No secrets — the model runs locally; nothing leaves the machine.
4. First run downloads the model into the `vieneu_models` volume (slow once,
   fast after — that's why `readyTimeoutMs` is 10 min).

## Agent commands (executeCommand)

| Command | Params | Description |
|---|---|---|
| `voice-studio.status` | `{}` | Backend reachable + model loaded? |
| `voice-studio.listVoices` | `{}` | Built-in default voices |
| `voice-studio.tts` | `{ text, voice?, refAudioB64? }` | Text→speech; returns `{ ok, format, audioB64 }` |

## Image contract (what CI publishes)

`VOICE_TTS_IMAGE` (default `ghcr.io/kentzu213/izzi-voice-tts:latest`), built by
`.github/workflows/publish-voice-image.yml` from `service/backend/`:

- FastAPI on port **5111**; `GET /health`, `GET /health/ready` (503 until model
  loaded), `GET /voices`, `POST /tts`.
- Wraps VieNeu-TTS per docs.vieneu.io: `Vieneu().infer(text=...)` + `.save(...)`.
- `/tts` returns base64 WAV as JSON (the extension's `net.fetch` bridge is text).

## No-Docker fallback

If Docker isn't installed, the host uses `VOICE_BACKEND_URL` (a hosted TTS
endpoint) via `service.fallback.remoteEnvVar`.

## Responsible use

Voice cloning (`refAudioB64`) requires the **consent** of the person whose voice
is cloned. Non-consensual cloning / impersonation is prohibited by the model
license and by izzi policy. The panel surfaces this before enabling cloning.
