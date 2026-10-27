# local-tts container package: Piper TTS studio, web UI + API on the single port 7878.
# Multi-stage: build the web UI, assemble the local-tts wheel, install and serve.

FROM node:24-slim AS webui
WORKDIR /src
COPY web-ui/package.json web-ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web-ui/ ./
RUN npm run build

FROM python:3.12.10-slim AS wheel
WORKDIR /pkg
COPY python/ ./
RUN rm -rf local_tts/_web
COPY --from=webui /src/dist/ local_tts/_web/
RUN pip install --no-cache-dir build && python -m build --wheel --outdir /out

FROM python:3.12.10-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=wheel /out/*.whl /tmp/
RUN pip install --no-cache-dir /tmp/*.whl && rm /tmp/*.whl
ENV LOCAL_TTS_HOST=0.0.0.0 \
    LOCAL_TTS_DATA_DIR=/data
VOLUME /data
EXPOSE 7878
ENTRYPOINT ["local-tts"]
