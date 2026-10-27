# local-tts-studio

Local Piper **text-to-speech** studio, shipped as a single pip package. One
command starts a server that opens **exactly one port (7878)** and serves:

- **Web UI** — speech studio, voice catalog/downloads, logs, system monitor
  (`http://127.0.0.1:7878/`)
- **REST API** under `/api/*` (used by the web UI itself)
- **OpenAI-compatible speech API** under `/v1/*` (`/v1/audio/speech`) so any
  OpenAI client can point at `http://127.0.0.1:7878/v1`

## Install

From **GitHub Releases** (wheel is attached to the release):

```bash
pip install https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0-py3-none-any.whl
```

Or from source (sdist builds the same package):

```bash
pip install https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0.tar.gz
```

## Run

```bash
local-tts
```

Then open **http://127.0.0.1:7878** in your browser. The web UI, REST API and
OpenAI-compatible API are all served from that single port — no other ports are
opened. Press `Ctrl+C` to stop.

### Options

```bash
local-tts --host 0.0.0.0   # listen on the LAN (default: 127.0.0.1)
local-tts --port 7878      # change the port (default: 7878)
local-tts --version
```

Environment overrides: `LOCAL_TTS_HOST`, `LOCAL_TTS_PORT`, `LOCAL_TTS_DATA_DIR`.

## First-time setup

1. Open the web UI → **Voices & setup**.
2. Click **Install piper** (installs the `piper-tts` engine into the same
   Python environment, done once).
3. Pick a voice from the catalog to download (e.g. `en_US-amy-medium`).
4. Go to **Speech studio**, type text, synthesize.

## Configuration / data locations

Settings, downloaded voices and the voice catalog live in a per-user data
directory (override with `LOCAL_TTS_DATA_DIR`):

| OS      | Path                                                        |
| ------- | ----------------------------------------------------------- |
| Linux   | `~/.local/share/local-tts`                                  |
| macOS   | `~/Library/Application Support/local-tts`                   |
| Windows | `%LOCALAPPDATA%\local-tts`                                  |

## OpenAI-compatible API example

```bash
curl http://127.0.0.1:7878/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"local-tts","voice":"en_US-amy-medium","input":"Hello world"}' \
  --output hello.wav
```

## License

MIT
