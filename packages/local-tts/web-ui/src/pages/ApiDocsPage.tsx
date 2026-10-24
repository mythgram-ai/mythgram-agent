import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { copyToClipboard } from '../lib/format'
import { IconAlert, IconBook, IconCopy } from '../components/icons'
import { Panel } from '../components/ui'

const DEFAULT_BASE = 'http://localhost:7878/v1'

function CodeBlock({ lang, children }: { lang: string; children: string }) {
  return (
    <div className="code-block" style={{ marginTop: 12 }}>
      <div className="code-block-head">
        <span>{lang}</span>
        <button
          className="copy-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => void copyToClipboard(children)}
        >
          <IconCopy size={11} /> Copy
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

function Section({ id, title, children, hint }: { id: string; title: string; children: ReactNode; hint?: string }) {
  return (
    <section id={id} className="docs-section">
      <Panel title={title}>
        {hint ? <p className="docs-hint">{hint}</p> : null}
        {children}
      </Panel>
    </section>
  )
}

const SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'base-url', label: 'Base URL & endpoints' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'configuration', label: 'Server-side configuration' },
  { id: 'models', label: 'GET /v1/models' },
  { id: 'speech', label: 'POST /v1/audio/speech' },
  { id: 'formats', label: 'Response formats' },
  { id: 'errors', label: 'Errors' },
  { id: 'examples', label: 'Code examples' },
  { id: 'notes', label: 'Limits & security notes' },
]

export default function ApiDocsPage() {
  return (
    <div className="content-inner">
      <div className="page-head">
        <h1>API documentation</h1>
        <p>
          Everything about this application's OpenAI-compatible speech API — endpoints, auth,
          request and response shapes, error codes, and ready-to-paste client code.
        </p>
      </div>

      <div className="chip-nav">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>{s.label}</a>
        ))}
      </div>

      <div className="stack gap-16">
        {/* ── overview ─────────────────────────────────────────── */}
        <Section id="overview" title="1 · Overview">
          <p>
            Piper Studio ships an <b>OpenAI-compatible text-to-speech API</b>. Anything that can
            talk to OpenAI's <code className="inline">/v1/audio/speech</code> endpoint — the
            official OpenAI SDKs, home-automation setups, your own scripts — can point its{' '}
            <i>base URL</i> at this server and start generating speech with the voices you downloaded here.
          </p>
          <ul>
            <li><b>One requirement:</b> clients only need the <b>base URL</b> — e.g. <code className="inline">http://localhost:7878/v1</code>.</li>
            <li><b>Optional:</b> if API-key authentication is enabled on the <Link to="/voice-api">API page</Link>, clients also send that one key. That is the entire client-side setup.</li>
            <li><b>Server-side configuration:</b> which voice speaks, its speed, volume, prosody and the compute device are configured <b>here in this app</b> — never sent by clients. See <a href="#configuration">Server-side configuration</a>.</li>
            <li><b>No rate limits:</b> this API never throttles by design. It is a local service; run it on a trusted network.</li>
            <li><b>CORS is open</b> (<code className="inline">*</code>), so browser-based clients work too.</li>
          </ul>
        </Section>

        {/* ── base url ─────────────────────────────────────────── */}
        <Section id="base-url" title="2 · Base URL & endpoints" hint="Copy the exact base URL from the API page — it accounts for your server's host. The examples below use the default.">
          <p>All API paths hang off the <b>base URL</b>: <code className="inline">{DEFAULT_BASE}</code> (port 7878 is the backend's default; the API page shows yours).</p>
          <table className="docs-table">
            <thead>
              <tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              <tr><td><code className="inline">GET</code></td><td><code className="inline">/v1/models</code></td><td>List the model ids the server reports (OpenAI shape)</td></tr>
              <tr><td><code className="inline">GET</code></td><td><code className="inline">/v1/models/&#123;model_id&#125;</code></td><td>Details for one model id</td></tr>
              <tr><td><code className="inline">POST</code></td><td><code className="inline">/v1/audio/speech</code></td><td>Synthesize text to audio bytes</td></tr>
            </tbody>
          </table>
          <p>
            Health and admin routes (<code className="inline">/api/…</code>) are separate and
            power the web UI itself; they are not part of the OpenAI-compatible surface.
          </p>
        </Section>

        {/* ── authentication ───────────────────────────────────── */} 
        <Section id="authentication" title="3 · Authentication" hint="Off by default. When enabled, every /v1 request must carry the shared key.">
          <p>
            Open the <Link to="/voice-api">API page</Link> and flip <b>“Require an API key”</b>. While
            it is off, no key is needed. When it is on, send the key with one of two headers:
          </p>
          <table className="docs-table">
            <thead>
              <tr><th>Header</th><th>Value</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr><td><code className="inline">Authorization</code></td><td><code className="inline">Bearer &lt;key&gt;</code></td><td>Standard; what every OpenAI SDK sends. Scheme matching is case-insensitive.</td></tr>
              <tr><td><code className="inline">X-Api-Key</code></td><td><code className="inline">&lt;key&gt;</code></td><td>Alternative for clients that cannot set custom Authorization headers.</td></tr>
            </tbody>
          </table>
          <p>
            Keys are created on the API page (or auto-generated when you enable auth without
            one). The key is stored <b>in plain text</b> inside{' '}
            <code className="inline">backend/data/settings.json</code> — by design, there is no
            encryption. Treat it like a shared secret on your network: it grants unlimited
            speech synthesis. A wrong or missing key returns <code className="inline">401</code>{' '}
            errors in OpenAI's error format (<code className="inline">missing_api_key</code> /{' '}
            <code className="inline">invalid_api_key</code>) so SDKs surface them cleanly.
          </p>
          <p>
            <b>Enabling auth without a key never locks you out</b>: the server mints a random
            key for you and displays it on the API page. Conversely, if auth is somehow enabled
            while the stored key is empty, the server fails closed (all requests rejected with{' '}
            <code className="inline">auth_not_configured</code>) until a key is set.
          </p>
        </Section>

        {/* ── configuration ────────────────────────────────────── */}
        <Section id="configuration" title="4 · Server-side configuration" hint="The most important design rule of this API: clients send nothing but the text. Everything else comes from this app.">
          <p>
            The <Link to="/voice-api">API page</Link> is where all TTS configuration lives:
          </p>
          <ul>
            <li><b>Default voice</b> — any downloaded piper voice (e.g. <code className="inline">en_US-amy-medium</code>) selected from the ones you installed.</li>
            <li><b>Speaker</b> — for multi-speaker models, which speaker slot API callers hear.</li>
            <li><b>Speed</b> — <code className="inline">0.25 – 4.0×</code>, applied to every call.</li>
            <li><b>Volume</b> — <code className="inline">0.05 – 2.0×</code>.</li>
            <li><b>Phoneme noise / cadence variation</b> — advanced prosody tuning (<code className="inline">noise_scale</code>, <code className="inline">noise_w_scale</code>).</li>
            <li><b>Loudness normalization</b> — on/off.</li>
          </ul>
          <p>
            If a client still sends OpenAI-style fields request anyway — <code className="inline">model</code>,{' '}
            <code className="inline">voice</code>, <code className="inline">speed</code> — the
            server <b>accepts them for compatibility but ignores them</b>. SDK clients keep
            working because those fields pass validation; the server's own configuration
            always decides what is spoken. This keeps the promise: <i>a client needs only the
            base URL (and the key when auth is on) — no client-side control over the model or
            its settings.</i>
          </p>
          <p>
            Changing the config on the API page takes effect on the very next API call — the
            server resolves the voice, speaker, prosody and device fresh each time.
          </p>
        </Section>

        {/* ── models ───────────────────────────────────────────── */}
        <Section id="models" title="5 · GET /v1/models" hint="Lets SDK-driven apps discover the server. Model ids are logical aliases; the engine and voice behind them are configured server-side.">
          <p>Request:</p>
          <CodeBlock lang="curl">{`curl ${DEFAULT_BASE}/models

# when API-key auth is on, add the key:
curl ${DEFAULT_BASE}/models \\
  -H "Authorization: Bearer <api key>"`}</CodeBlock>
          <p>Response — OpenAI's usual list shape:</p>
          <CodeBlock lang="json">{`{
  "object": "list",
  "data": [
    { "id": "tts-1",    "object": "model", "created": 1792828963, "owned_by": "piper-studio-local" },
    { "id": "tts-1-hd", "object": "model", "created": 1792828963, "owned_by": "piper-studio-local" }
  ]
}`}</CodeBlock>
          <p>
            Both ids are aliases: <code className="inline">tts-1</code> and{' '}
            <code className="inline">tts-1-hd</code> behave identically here since quality comes
            from the selected piper voice. Unknown ids return <code className="inline">404 model_not_found</code>.
            The ids clients send to <code className="inline">/v1/audio/speech</code> are still
            ignored — the server's configuration rules.
          </p>
        </Section>

        {/* ── speech ───────────────────────────────────────────── */}
        <Section id="speech" title="6 · POST /v1/audio/speech" hint="The main endpoint. Sends synthesized audio bytes back; OpenAI's Audio Speech API shape.">
          <p className="docs-hint">Request body is JSON; response is raw audio bytes.</p>
          <h3 className="docs-h3">Request fields</h3>
          <table className="docs-table">
            <thead>
              <tr><th>Field</th><th>Type</th><th>Required</th><th>Behaviour on this server</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code className="inline">input</code></td><td>string</td><td><b>yes</b></td>
                <td>
                  The text to speak. 1 – 8000 characters after trimming; blank or over-long →{' '}
                  <code className="inline">400 invalid_request</code>. Whitespace is trimmed.
                </td>
              </tr>
              <tr>
                <td><code className="inline">response_format</code></td><td>string</td><td>no</td>
                <td>
                  One of <code className="inline">wav</code> (default),{' '}
                  <code className="inline">pcm</code>, <code className="inline">mp3</code>,{' '}
                  <code className="inline">flac</code>, <code className="inline">aac</code>,{' '}
                  <code className="inline">opus</code>. See <a href="#formats">Response formats</a>.
                </td>
              </tr>
              <tr>
                <td><code className="inline">model</code></td><td>string</td><td>no (up to 100 chars)</td>
                <td>
                  <b>Accepted but ignored</b> — the server-side configuration selects the
                  actual voice. Accepting it keeps standard SDK clients happy.
                </td>
              </tr>
              <tr>
                <td><code className="inline">voice</code></td><td>string</td><td>no (up to 200 chars)</td>
                <td><b>Accepted but ignored</b> — the default voice picked on the API page speaks.</td>
              </tr>
              <tr>
                <td><code className="inline">speed</code></td><td>number</td><td>no</td>
                <td><b>Accepted but ignored</b> — server-side speed applies to every call.</td>
              </tr>
            </tbody>
          </table>
          <div className="banner" style={{ marginTop: 12 }}>
            <span className="ico"><IconBook size={15} /></span>
            <span>
              Remember: <code className="inline">model</code>, <code className="inline">voice</code>{' '}
              and <code className="inline">speed</code> exist only so OpenAI-shaped clients don't
              break. Sending them or not changes nothing about the output.
            </span>
          </div>
          <h3 className="docs-h3">Response</h3>
          <p>
            <b>200 OK</b> with the audio bytes under <code className="inline">Content-Type</code>{' '}
            matching the requested format (<code className="inline">audio/wav</code> by default).
            Introspection headers ride along:
          </p>
          <table className="docs-table">
            <thead>
              <tr><th>Header</th><th>Meaning</th></tr>
            </thead>
            <tbody>
              <tr><td><code className="inline">Content-Disposition</code></td><td><code className="inline">inline; filename="piper-&lt;voice&gt;.wav"</code> — handy when saving</td></tr>
              <tr><td><code className="inline">X-Voice-Key</code></td><td>The piper voice key that produced the audio</td></tr>
              <tr><td><code className="inline">X-Sample-Rate</code></td><td>Sample rate in Hz (typical piper voices: 16000)</td></tr>
              <tr><td><code className="inline">X-Channels</code></td><td>Channel count (mono → 1)</td></tr>
              <tr><td><code className="inline">X-Sample-Width</code></td><td>Bytes per sample (16-bit audio → 2)</td></tr>
              <tr><td><code className="inline">X-Duration-Ms</code></td><td>Audio duration in milliseconds</td></tr>
              <tr><td><code className="inline">X-Elapsed-Ms</code></td><td>Synthesis wall time in milliseconds</td></tr>
              <tr><td><code className="inline">X-Device</code></td><td>Compute device used: <code className="inline">cpu</code> or <code className="inline">cuda</code></td></tr>
              <tr><td><code className="inline">X-Audio-Format</code></td><td>Requested format, echoed back</td></tr>
            </tbody>
          </table>
        </Section>

        {/* ── formats ──────────────────────────────────────────── */}
        <Section id="formats" title="7 · Response formats" hint="wav/pcm are always available; compressed formats need ffmpeg on the server host.">
          <table className="docs-table">
            <thead>
              <tr><th>Format</th><th>Container</th><th>Availability</th></tr>
            </thead>
            <tbody>
              <tr><td><code className="inline">wav</code></td><td>RIFF/WAVE PCM (default)</td><td>always — native, nothing extra needed</td></tr>
              <tr><td><code className="inline">pcm</code></td><td>Raw samples</td><td>always — 16-bit little-endian, mono, at the voice's sample rate; no header</td></tr>
              <tr><td><code className="inline">mp3</code></td><td>MPEG-1 L3</td><td>needs <code className="inline">ffmpeg</code> — rejected with a clear 400 otherwise</td></tr>
              <tr><td><code className="inline">flac</code></td><td>FLAC</td><td>needs <code className="inline">ffmpeg</code></td></tr>
              <tr><td><code className="inline">aac</code></td><td>ADTS AAC</td><td>needs <code className="inline">ffmpeg</code></td></tr>
              <tr><td><code className="inline">opus</code></td><td>Ogg Opus</td><td>needs <code className="inline">ffmpeg</code></td></tr>
            </tbody>
          </table>
          <p>
            Compressed formats are transcoded server-side from the engine's native WAV
            (timestamps: mp3/aac 128k, opus 96k). If <code className="inline">ffmpeg</code> is
            missing, those requests fail immediately with{' '}
            <code className="inline">400 unsupported_response_format</code> explaining what to
            do — install ffmpeg, or use <code className="inline">wav</code>/<code className="inline">pcm</code>.
          </p>
          <p><b>Note for `pcm`:</b> OpenAI's pcm output is 24 kHz; here it is the chosen piper voice's own rate (usually 16 kHz) — read <code className="inline">X-Sample-Rate</code> from the response to interpret the stream.</p>
        </Section>

        {/* ── errors ───────────────────────────────────────────── */}
        <Section id="errors" title="8 · Errors" hint="Every failure returns JSON in OpenAI's error envelope. Non-2xx, never HTML.">
          <CodeBlock lang="example">{`{
  "error": {
    "message": "Incorrect API key provided.",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}`}</CodeBlock>
          <p><code className="inline">type</code> is <code className="inline">invalid_request_error</code> for client problems and <code className="inline">server_error</code> for the rest; <code className="inline">param</code> names the offending request field when one applies.</p>
          <table className="docs-table">
            <thead>
              <tr><th>HTTP</th><th>code</th><th>Meaning</th><th>How to fix</th></tr>
            </thead>
            <tbody>
              <tr><td>400</td><td><code className="inline">invalid_request</code></td><td>Malformed JSON, blank/over-long <code className="inline">input</code>, unknown <code className="inline">response_format</code></td><td>Correct the body; the message names the field</td></tr>
              <tr><td>400</td><td><code className="inline">unsupported_response_format</code></td><td>Compressed format requested but ffmpeg is absent</td><td>Use wav/pcm or install ffmpeg on the server host</td></tr>
              <tr><td>400</td><td><code className="inline">speaker_config_invalid</code></td><td>Configured speaker is out of range for the default voice</td><td>Fix the Speaker choice on the API page</td></tr>
              <tr><td>401</td><td><code className="inline">missing_api_key</code></td><td>Auth on and no key header found</td><td>Send <code className="inline">Authorization: Bearer &lt;key&gt;</code> or <code className="inline">X-Api-Key</code></td></tr>
              <tr><td>401</td><td><code className="inline">invalid_api_key</code></td><td>Key does not match</td><td>Copy the current key from the API page</td></tr>
              <tr><td>404</td><td><code className="inline">model_not_found</code></td><td>Unknown id on GET /v1/models/&#123;id&#125; or unknown path</td><td>Use an id from /v1/models</td></tr>
              <tr><td>500</td><td><code className="inline">auth_not_configured</code></td><td>Auth enabled but the server stores no key</td><td>Set/generate a key on the API page</td></tr>
              <tr><td>500</td><td><code className="inline">transcode_failed</code></td><td>ffmpeg failed or timed out</td><td>Retry with format <code className="inline">wav</code>; check ffmpeg on the host</td></tr>
              <tr><td>500</td><td><code className="inline">pcm_extract_failed</code></td><td>WAV could not be parsed into raw samples</td><td>Rare; retry or use <code className="inline">wav</code></td></tr>
              <tr><td>500</td><td><code className="inline">internal_error</code></td><td>Unexpected server fault</td><td>Check the Logs page for the trace</td></tr>
              <tr><td>503</td><td><code className="inline">no_default_voice</code></td><td>No default voice chosen on the API page</td><td>Pick one under “Default voice for API clients”</td></tr>
              <tr><td>503</td><td><code className="inline">voice_not_ready</code></td><td>Default voice's model files are missing/corrupt</td><td>Re-download the voice on Voices &amp; setup, or pick another</td></tr>
              <tr><td>503</td><td><code className="inline">engine_not_installed</code></td><td>piper-tts wheel not installed yet</td><td>Install it on the Voices &amp; setup page</td></tr>
            </tbody>
          </table>
          <p>
            Audio failures (401 aside) are deliberately 503 “Retry-able” client messages —
            they describe server setup, not client bugs. There is <b>no rate limiting</b>, so
            never worry about 429s: this server does not send them.
          </p>
        </Section>

        {/* ── examples ─────────────────────────────────────────── */}
        <Section id="examples" title="9 · Code examples" hint="Copy-paste ready. URL substitution: swap the base URL for the one shown on the API page, and add the Authorization header when auth is on.">
          <h3 className="docs-h3">curl — minimal (auth off)</h3>
          <CodeBlock lang="bash">{`curl ${DEFAULT_BASE}/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Today is a wonderful day."}' \\
  --output speech.wav

file speech.wav
# -> RIFF (little-endian) data, WAVE audio, ... 16 bit, mono`}</CodeBlock>
          <h3 className="docs-h3">curl — with API key and no client config</h3>
          <CodeBlock lang="bash">{`curl ${DEFAULT_BASE}/audio/speech \\
  -H "Authorization: Bearer <api key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Hello from Piper Studio."}' \\
  --output speech.wav

# response_format variants:
for FMT in wav pcm mp3 flac aac opus; do
  curl ${DEFAULT_BASE}/audio/speech \\
    -H "Authorization: Bearer <api key>" \\
    -H "Content-Type: application/json" \\
    -d '{"model":"tts-1","input":"Hello.","response_format":"'$FMT'"}' \\
    --output "speech.$FMT"
done`}</CodeBlock>
          <h3 className="docs-h3">curl — listen inline (no file)</h3>
          <CodeBlock lang="bash">{`# pipe straight into an audio player (Linux example with ffplay)
curl -s ${DEFAULT_BASE}/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tts-1","input":"Streaming straight to my speakers."}' \\
  --output - | ffplay -nodisp -autoexit -`}</CodeBlock>
          <h3 className="docs-h3">Python — official OpenAI SDK</h3>
          <CodeBlock lang="python">{`from openai import OpenAI

client = OpenAI(
    base_url="${DEFAULT_BASE}",  # the only thing that changes vs. OpenAI cloud
    api_key="<api key>",        # any placeholder works while auth is off
)

# streaming download (returns a valid WAV here):
with client.audio.speech.with_streaming_response.create(
    model="tts-1",              # server lists tts-1 / tts-1-hd; value is ignored
    voice="alloy",              # ignored — the server's default voice speaks
    input="Hello from the official SDK, synthesized locally.",
    response_format="wav",
) as response:
    response.stream_to_file("speech.wav")

# simple in-memory call:
audio = client.audio.speech.create(
    model="tts-1",
    voice="alloy",
    input="Raw bytes, same API.",
    response_format="pcm",
)
raw = audio.read()   # (only when response_format="pcm")`}</CodeBlock>
          <h3 className="docs-h3">Python — plain requests</h3>
          <CodeBlock lang="python">{`import requests

url = "${DEFAULT_BASE}/audio/speech"
headers = {"Content-Type": "application/json"}
# headers["Authorization"] = "Bearer <api key>"   # add when auth is on
body = {
    "model": "tts-1",
    "input": "Generated with plain requests, no SDK.",
    "response_format": "wav",
}

resp = requests.post(url, json=body, headers=headers, timeout=120)
resp.raise_for_status()
print(resp.headers["X-Voice-Key"], resp.headers["X-Sample-Rate"])
with open("speech.wav", "wb") as f:
    f.write(resp.content)`}</CodeBlock>
          <h3 className="docs-h3">Node.js — official OpenAI SDK</h3>
          <CodeBlock lang="javascript">{`import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${DEFAULT_BASE}",
  apiKey: "<api key>", // any placeholder works while auth is off
});

const audio = await client.audio.speech.create({
  model: "tts-1",
  voice: "alloy",
  input: "Hello from Node, using the official SDK.",
  response_format: "wav",
});

const buffer = Buffer.from(await audio.arrayBuffer());
await fs.promises.writeFile("speech.wav", buffer);`}</CodeBlock>
          <h3 className="docs-h3">Node.js — plain fetch</h3>
          <CodeBlock lang="javascript">{`import fs from "fs";

const res = await fetch("${DEFAULT_BASE}/audio/speech", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    // "Authorization": "Bearer <api key>",   // add when auth is on
  },
  body: JSON.stringify({
    model: "tts-1",
    input: "Plain fetch needs no SDK.",
    response_format: "wav",
  }),
});

if (!res.ok) {
  const err = await res.json();
  throw new Error(err.error?.message ?? "request failed");
}

const buffer = Buffer.from(await res.arrayBuffer());
await fs.promises.writeFile("speech.wav", buffer);
console.log("saved speech.wav");`}</CodeBlock>
          <h3 className="docs-h3">Browser — fetch + playback (CORS is open)</h3>
          <CodeBlock lang="javascript">{`const res = await fetch("${DEFAULT_BASE}/audio/speech", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    // "Authorization": "Bearer <api key>",
  },
  body: JSON.stringify({ model: "tts-1", input: "Playing in the browser." }),
});

const audioBlob = await res.blob();
const url = URL.createObjectURL(audioBlob);
const player = new Audio(url);
player.play();`}</CodeBlock>
          <div className="banner" style={{ marginTop: 12 }}>
            <span className="ico"><IconAlert size={15} /></span>
            <span>
              Notice what every example has in common: only a base URL (plus the optional
              key). No voice names, no model settings, no prosody flags — those all live on
              the API page in this app.
            </span>
          </div>
        </Section>

        {/* ── notes ────────────────────────────────────────────── */}
        <Section id="notes" title="10 · Limits & security notes">
          <ul>
            <li><b>No rate limits.</b> Any HTTP 429 will never come from this server. It is a local/per-organization service, so feel free to hammer it — CPU load becomes the natural throttle. Long texts (up to 8000 characters) may take longer on weak hardware.</li>
            <li><b>Key storage is plain text</b> inside <code className="inline">backend/data/settings.json</code> (no encryption, as intended). Backups of that folder include the key.</li>
            <li><b>Auth is a single shared key</b> — it is an on/off switch per network, not per-user accounts.</li>
            <li><b>CORS is wide open</b> (<code className="inline">*</code>): any web page you visit could attempt requests to <code className="inline">http://localhost:7878</code>. With auth off that means any local page can synthesize speech — enable the API key if that matters to you.</li>
            <li><b>Requests are small</b>: only <code className="inline">input</code> (and optionally <code className="inline">response_format</code>) change the outcome; everything else is server-side.</li>
            <li><b>Concurrency</b>: synthesis runs in piper's in-process engine; parallel calls queue on it. Voices are cached after first load, so repeated calls to the same voice are fast.</li>
            <li><b>Memory</b>: audio is synthesized in memory then returned; nothing is written to disk by API calls.</li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
