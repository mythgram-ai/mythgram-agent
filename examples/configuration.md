# Configuration examples

Mythgram has two configuration surfaces:

1. **The web console → Settings** manages model providers and credentials, and
   stores them in `.mythgram/mythgram.db`. This is the normal way to configure
   models.
2. **A `.env` file** provides optional server-side defaults and integration keys.
   The backend loads `.env` from its **process working directory**.

Copy the full reference and edit only what you need:

```bash
cp packages/mythgram/.env.example .env
```

See the complete, commented list in
[`packages/mythgram/.env.example`](../packages/mythgram/.env.example). Below are
ready-to-use recipes.

---

## Port, workspace, and data directory

```dotenv
PORT=8787
# Workspace the file/shell tools are sandboxed to (defaults to process.cwd())
WORKSPACE_ROOT=/home/you/projects/my-app
# Fixed application data dir; never moved when the workspace changes
MYTHGRAM_DATA_DIR=/home/you/.mythgram-data
CORS_ORIGINS=http://localhost:5173
```

Run on a different port without a file:

```bash
PORT=9000 mythgram start
```

---

## Model providers

Model credentials and model selection live in **Settings**. To point at a local
model server, add a provider there (or use the built-in **Local** provider) with:

- **Base URL:** `http://localhost:11434` (Ollama), `http://localhost:1234/v1`
  (LM Studio), or your llama.cpp server.
- **API key:** usually empty for local servers.

Optional server-side keys used by integrations (the console updates these per
user, but you can set fallbacks here):

```dotenv
OPENROUTER_API_KEY=sk-or-...
GITHUB_TOKEN=ghp_...        # raises GitHub search rate limits
```

---

## Web search and fetch

DuckDuckGo and the built-in fetcher are the keyless defaults. To use keyed
providers:

```dotenv
# Search: duckduckgo (default) | tavily | exa | serpapi
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...

# Fetch/scrape: builtin (default) | firecrawl
FETCH_PROVIDER=firecrawl
FIRECRAWL_API_KEY=fc-...
```

---

## App connectors (Composio)

```dotenv
COMPOSIO_API_KEY=...
```

---

## Background memory agent

Builds durable memory after every N completed user turns. Turn it off to save
tokens:

```dotenv
MEMORY_AGENT_ENABLED=true
MEMORY_AGENT_INTERVAL=3
```

---

## Context management

```dotenv
# Summarize-and-handoff at 90% context utilization
SUMMARY_THRESHOLD=0.9
# Sliding-window truncation frees ~30% of the oldest tokens near the limit
SLIDING_WINDOW_TRUNCATE_PERCENT=0.3
# ReAct iterations per turn
MAX_ITERATIONS=1000
```

---

## Tool timeouts

```dotenv
SHELL_TIMEOUT_MS=180000
PLAN_APPROVAL_TIMEOUT_MS=60000
QUESTION_TIMEOUT_MS=180000

# LSP (used by the `lsp` tool): request / startup / idle timeouts
MYTHGRAM_LSP_REQUEST_TIMEOUT_MS=15000
MYTHGRAM_LSP_INITIALIZE_TIMEOUT_MS=30000
MYTHGRAM_LSP_IDLE_TIMEOUT_MS=300000
```

---

## Image generation keys (server fallbacks)

```dotenv
GEMINI_API_KEY=...
MINIMAX_API_KEY=...
NVIDIA_API_KEY=nvapi-...
CLIPDROP_API_KEY=...
# Pollinations is free and keyless; OpenRouter images reuse OPENROUTER_API_KEY
```

---

## Text-to-speech keys

```dotenv
KITTENML_API_KEY=...
# or reuse a shared OpenRouter key
OPENROUTER_API_KEY=sk-or-...
```

---

## Frontend (development only)

`packages/frontend-main/.env.example`:

```dotenv
# Backend target for the Vite /api proxy (resolved on the dev-server machine)
MYTHGRAM_API_URL=http://localhost:8787
VITE_PORT=5173
```

```bash
cd packages/frontend-main
MYTHGRAM_API_URL=http://localhost:8787 VITE_PORT=6000 npm run dev
```

In production the backend serves the built console on one port, so these are not
needed.

---

## Putting it together: a local-first setup

```dotenv
# .env (in the folder you run `mythgram` from)
PORT=8787
WORKSPACE_ROOT=/home/you/projects/my-app
SEARCH_PROVIDER=duckduckgo
FETCH_PROVIDER=builtin
MEMORY_AGENT_ENABLED=true
MEMORY_AGENT_INTERVAL=5
SUMMARY_THRESHOLD=0.9
```

Then in **Settings**, select the **Local** provider pointing at Ollama
(`http://localhost:11434`) and pick a model such as `qwen2.5-coder`. Everything
runs on your machine; only the model server is local too, so no data leaves the
host.
