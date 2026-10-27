# local-tts

Local Piper **text-to-speech** studio. One command (or one `docker run`)
starts a server that opens **exactly one port (7878)** and serves:

- **Web UI** — speech studio, voice catalog/downloads, logs, system monitor
  (`http://127.0.0.1:7878/`)
- **REST API** under `/api/*` (used by the web UI itself)
- **OpenAI-compatible speech API** under `/v1/*` (`/v1/audio/speech`) so any
  OpenAI client can point at `http://127.0.0.1:7878/v1`

## Install — three ways

All three run the same server; pick whichever fits your setup.

### 1. pip, from PyPI

Already published on PyPI as `local-tts-studio` (the plain `local-tts` name is
blocked by PyPI's name-similarity policy; the command stays `local-tts`):

```bash
pip install local-tts-studio
local-tts
```

### 2. pip, straight from a GitHub Release

The release workflow (`.github/workflows/local-tts-publish.yml`) attaches the
built wheel and sdist to every `v*` release:

```bash
pip install https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0-py3-none-any.whl
local-tts
```

(Source build instead: `pip install https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0.tar.gz`)

### 3. Docker, from the GitHub Packages container registry

The same workflow publishes an OCI image to **ghcr.io** — it shows up on the
repository's **Packages** page:

- Package page: <https://github.com/mythgram-ai/mythgram-agent/pkgs/container/local-tts>
- Tags: `main` tracks the current `main` branch; once a `v*` release tag is
  pushed the workflow also adds `X.Y.Z` and `latest` tags.

```bash
docker pull ghcr.io/mythgram-ai/local-tts:main

docker run -d --name local-tts \
  -p 7878:7878 \
  -v local-tts-data:/data \
  ghcr.io/mythgram-ai/local-tts:main
```

Then open **http://127.0.0.1:7878** — the web UI, `/api` and `/v1` still all
live on that single port. Stop with `docker stop local-tts`.

The image is a real runtime, not a demo artifact: it builds the web UI,
assembles the wheel, installs it, runs `local-tts` with `LOCAL_TTS_HOST=0.0.0.0`
(needed inside a container so the mapped port works) and keeps all settings and
downloaded voices in the `/data` volume so they survive re-creation of the
container.

## First-time setup (same for all three)

1. Open the web UI → **Voices & setup**.
2. Click **Install piper** (installs the `piper-tts` engine, done once).
3. Pick a voice from the catalog to download (e.g. `en_US-amy-medium`).
4. Go to **Speech studio**, type text, synthesize.

## Options (pip installs)

```bash
local-tts --host 0.0.0.0   # listen on the LAN (default: 127.0.0.1)
local-tts --port 7878      # change the port (default: 7878)
local-tts --version
```

Environment overrides: `LOCAL_TTS_HOST`, `LOCAL_TTS_PORT`, `LOCAL_TTS_DATA_DIR`.

## Configuration / data locations

Settings, downloaded voices and the voice catalog live in a per-user data
directory (override with `LOCAL_TTS_DATA_DIR`):

| OS      | Path                                      |
| ------- | ----------------------------------------- |
| Linux   | `~/.local/share/local-tts`                |
| macOS   | `~/Library/Application Support/local-tts` |
| Windows | `%LOCALAPPDATA%\local-tts`                |
| Docker  | `/data` (mount a volume here)             |

## OpenAI-compatible API example

```bash
curl http://127.0.0.1:7878/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"local-tts","voice":"en_US-amy-medium","input":"Hello world"}' \
  --output hello.wav
```

## Publishing new versions

Maintainers cut a release and the workflow does the rest:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

That publishes the Python distributions to the GitHub Release *and* pushes the
X.Y.Z / latest container images to ghcr.io.

## License

MIT
