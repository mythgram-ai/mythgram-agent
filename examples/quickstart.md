# Quick start

From a fresh clone to your first agent task in a few minutes.

## 1. Install

**Published package (recommended):**

```bash
npm install -g mythgram
```

**From this repo (development):**

```bash
./scripts/setup.sh     # installs deps for backend + frontend and seeds .env files
```

Requirements: **Node.js >= 20.9.0** (22.12+ recommended) and npm.

## 2. Start the app

**Global install** — run `mythgram` in the folder you want the agent to work on:

```bash
cd ~/projects/my-app
mythgram
```

```
  Mythgram is running → http://localhost:8787
  Workspace           → /home/you/projects/my-app
  Data folder         → /home/you/projects/my-app/.mythgram

  The app runs in the background and restarts itself if it crashes.
  Stop it with: mythgram stop    Status: mythgram status
```

One port serves **both** the API and the bundled web console. Open
<http://localhost:8787> in your browser.

**From this repo** — start both dev servers at once:

```bash
./scripts/dev.sh
# backend + API  → http://localhost:8787
# web console    → http://localhost:5173  (Vite proxies /api to the backend)
```

Useful process commands:

```bash
mythgram status      # supervisor + app health
mythgram logs        # tail logs
mythgram restart
mythgram stop
mythgram install     # autostart across reboots (systemd user service / cron)
```

## 3. Configure a model

1. Open the console (8787 in production, 5173 in dev).
2. Go to **Settings**, pick a provider, paste its API key, and choose a model.
   Providers include OpenRouter, DeepSeek, Groq, Cerebras, Mistral, Cohere,
   NVIDIA, Hugging Face, a generic **Local** server (Ollama/LM Studio/llama.cpp),
   and user-defined **Custom** OpenAI-compatible endpoints.
3. Settings persist in `.mythgram/mythgram.db` — no restart needed.

Prefer environment defaults? Copy and edit the example env file:

```bash
cp packages/mythgram/.env.example .env
```

## 4. Run your first task

Type a request in the chat box. Mythgram streams reasoning, tool calls, and
output live, and can stop/resume a turn.

```
List the files in this repo, then summarize what the project does in 5 bullets.
Create a new file HELLO.md containing "hello from mythgram" and show me the diff.
```

Good first tasks:

- **Explore:** "Give me a tour of this codebase — entry points, main modules, and how they connect."
- **Edit:** "Add an npm script called `smoke` that runs `node -e \"console.log('ok')\"` to package.json."
- **Research:** "Search the web for the current stable Node.js LTS version and cite your sources."
- **Plan:** "Draft and submit a plan to add input validation to the /api/scrape route."

## 5. Verify a checkout (contributors)

```bash
./scripts/full-test.sh        # init + typecheck + build + test for both packages
./scripts/lint.sh             # oxlint for the frontend packages
./scripts/build.sh --pack     # build the publishable artifact and inspect the tarball
```

## Where state lives

```
<workspace>/.mythgram/
├── mythgram.db          # SQLite: chats, settings, memory, knowledge, schedules…
├── mythgram.db-wal
├── .acp-endpoint.json   # lets ACP bridges discover the running backend
└── deamon/              # supervisor pid + logs
```

Keep `.mythgram/` private and back it up if you care about your chats. Switch
workspaces with `WORKSPACE_ROOT` or `POST /api/workspace` — switching never moves
the data directory.
