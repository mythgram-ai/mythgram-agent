# API examples

The Mythgram backend is an Express server exposing `GET /health` plus REST/SSE
routes under `/api/`. These examples call it directly with `curl`. Set a base URL
once:

```bash
export MYTHGRAM=http://localhost:8787
```

In production the same origin serves the web console, so the browser uses these
same `/api/*` paths with no proxy. In development Vite (`:5173`) proxies them.

---

## Health

```bash
curl -s "$MYTHGRAM/health" | jq
```

```json
{
  "status": "healthy",
  "service": "mythgram",
  "workspace": "/home/you/project",
  "providers": ["openrouter", "deepseek", "local", "custom"],
  "tools": ["read_file", "write_file", "shall", "..."],
  "max_iterations": 1000,
  "database": "/home/you/project/.mythgram/mythgram.db",
  "sqlite_version": "3.x.x"
}
```

---

## Providers and models

```bash
# All registered providers (built-ins + your custom ones)
curl -s "$MYTHGRAM/api/providers" | jq '.[].id'

# List models for a hosted provider (needs a key)
curl -s -X POST "$MYTHGRAM/api/providers/models" \
  -H 'content-type: application/json' \
  -d '{"provider":"openrouter","api_key":"sk-or-..."}' | jq '.models[:5]'

# A local server needs no key (Ollama, LM Studio, llama.cpp, ...)
curl -s -X POST "$MYTHGRAM/api/providers/models" \
  -H 'content-type: application/json' \
  -d '{"provider":"local","base_url":"http://localhost:11434"}' | jq

# A custom OpenAI-compatible endpoint
curl -s -X POST "$MYTHGRAM/api/providers/models" \
  -H 'content-type: application/json' \
  -d '{
        "provider":"custom_myllm",
        "base_url":"https://llm.example.com/v1",
        "api_key":"my-key",
        "headers":{"X-Org":"1"}
      }' | jq
```

---

## Streaming chat (SSE)

`POST /api/chat/stream` accepts both ways of starting a turn:

- **New turn:** include `user_message`, `provider`, `model`, and `api_key`
  (or `custom_provider`, or `provider:"local"` with no key).
- **Resume/attach:** send only `chat_id` (and optionally `since_event_id`) to
  re-attach to a run that is already streaming.

The response is `text/event-stream`. Each event is `event: <name>` + `data: <json>`,
with names like `status`, `reasoning`, `token`, `content`, `tool_call`,
`tool_result`, `iteration`, `context_usage`, `error`, and `done`.

```bash
curl -N -s -X POST "$MYTHGRAM/api/chat/stream" \
  -H 'content-type: application/json' \
  -d '{
        "chat_id": "demo-chat-001",
        "user_message": "Summarize this repository in three bullets.",
        "provider": "openrouter",
        "model": "anthropic/claude-3.5-sonnet",
        "api_key": "sk-or-..."
      }'
```

Trimmed output:

```
event: status
data: {"state":"running"}

event: reasoning
data: {"text":"I will inspect the workspace first..."}

event: tool_call
data: {"name":"read_directory","arguments":{"path":"."}}

event: tool_result
data: {"name":"read_directory","result":"..."}

event: content
data: {"text":"- This repo is ..."}

event: done
data: {"chat_id":"demo-chat-001"}
```

### Resume a dropped stream

Every event carries an incremental id. Reconnect and pass the last id you saw to
replay only what you missed:

```bash
curl -N -s -X POST "$MYTHGRAM/api/chat/stream" \
  -H 'content-type: application/json' \
  -d '{"chat_id":"demo-chat-001","since_event_id":42}'
```

### Abort a running turn

```bash
curl -s -X POST "$MYTHGRAM/api/chat/abort/demo-chat-001" | jq
```

The agent's interactive tools also have reply endpoints when a turn is paused:
`POST /api/chat/plan/:chatId/:toolCallId` (plan approval),
`POST /api/chat/question/:chatId/:toolCallId` (question answered),
`POST /api/chat/ask/:chatId/:toolCallId` (custom ask), and
`POST /api/chat/slides-template/:chatId/:toolCallId`.

---

## Sessions

```bash
# Create a session
SID=$(curl -s -X POST "$MYTHGRAM/api/sessions" \
  -H 'content-type: application/json' -d '{"title":"Demo"}' | jq -r .id)
echo "$SID"

# List sessions, or only the ones currently streaming
curl -s "$MYTHGRAM/api/sessions" | jq '.sessions[].title'
curl -s "$MYTHGRAM/api/sessions/running" | jq

# Fetch one session (UI-shaped history) and its raw provider context
curl -s "$MYTHGRAM/api/sessions/$SID" | jq
curl -s "$MYTHGRAM/api/sessions/$SID/context?agent=main" | jq

# Fork a session (copy history into a new id)
curl -s -X POST "$MYTHGRAM/api/sessions/$SID/fork" | jq

# Delete a session
curl -s -X DELETE "$MYTHGRAM/api/sessions/$SID" | jq
```

---

## Application state

The console stores settings and documents in SQLite, not localStorage. `GET
/api/state` returns everything needed to boot in one round trip.

```bash
curl -s "$MYTHGRAM/api/state" | jq '.state | keys'
curl -s "$MYTHGRAM/api/state" | jq '{sqlite: .sqlite_version, sessions: (.sessions|length)}'

# Persist a state document (PUT or POST both work)
curl -s -X PUT "$MYTHGRAM/api/state/ui_prefs" \
  -H 'content-type: application/json' \
  -d '{"value":{"theme":"dark"}}' | jq
```

---

## Workspace and files

```bash
# Current workspace root
curl -s "$MYTHGRAM/api/workspace" | jq

# Switch workspace (does not move the .mythgram data dir)
curl -s -X POST "$MYTHGRAM/api/workspace" \
  -H 'content-type: application/json' \
  -d '{"path":"/home/you/other-project"}' | jq

# File tree for the explorer
curl -s "$MYTHGRAM/api/files/tree?path=." | jq '.tree'

# Read a file as text
curl -s "$MYTHGRAM/api/files/read?path=README.md" | jq -r .content | head

# Inline preview vs. download (images, PDFs, HTML, ...)
curl -s "$MYTHGRAM/api/files/preview?path=docs/logo.png" -o /tmp/logo.png

# Upload prompt attachments into <workspace>/uploads/
curl -s -X POST "$MYTHGRAM/api/files/upload" \
  -F "files=@./notes.pdf" -F "files=@./diagram.png" | jq
```

---

## Scrape a URL

Fetch and extract a page as text, markdown, or HTML. A pasted `curl` command is
also accepted (its URL and headers are parsed):

```bash
curl -s -X POST "$MYTHGRAM/api/scrape" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","format":"markdown"}' | jq '{title, status, content}'

# Bring your own headers / auth
curl -s -X POST "$MYTHGRAM/api/scrape" \
  -H 'content-type: application/json' \
  -d '{"url":"https://api.example.com/data","headers":{"Authorization":"Bearer token"}}' | jq
```

---

## Tips

- Add `-N` (no buffer) to any `curl` that consumes an SSE stream, or piping will
  hide events until the connection closes.
- Every route is same-origin with the console, so you can also drive it from the
  browser devtools using relative `/api/...` URLs.
- See the [deploy guide](../deploy/README.md) before exposing any of this beyond
  localhost — there is no authentication layer.
