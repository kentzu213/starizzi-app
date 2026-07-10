# syntax=docker/dockerfile:1
# izzi Voice TTS — FastAPI wrapper around VieNeu-TTS. CPU/ONNX, on-device.
FROM python:3.11-slim

WORKDIR /app

# ffmpeg + libsndfile for audio I/O; build tools for any native wheels vieneu pulls.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# Model cache lives in a mounted volume (see docker-compose.izzi.yml).
ENV HF_HOME=/models VIENEU_CACHE=/models
EXPOSE 5111

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5111"]
