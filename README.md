# Mythgram 🪄

Mythgram AI is a general-purpose AI assistant and action-taking agent workspace—not just a coding chatbot. It can help with research, writing, planning, software development, and everyday digital work: explore a project, edit files, run commands, search the web, and use connected tools to carry tasks forward. It draws on persistent memory and knowledge, reusable skills and prompts, specialist agents and coordinated teams, and scheduled or messaging-based workflows.

The browser-based console brings chat and workspace management together: configure agents and models, review conversations, manage integrations and schedules, and inspect files and results. A TypeScript/Express backend runs agent tasks and stores workspace state in SQLite, while a React/Vite frontend provides the interactive console. Connect to hosted model providers, local model servers, or a custom OpenAI-compatible endpoint—the model can be remote even when Mythgram and its workspace data run locally. Model credentials and most application settings are configured in the web console; optional server-side integrations can be configured through environment variables.

Mythgram is published as a single npm package with a `mythgram` CLI. The package bundles the backend **and** a prebuilt copy of the web console, which the backend serves on **one port** — so installing and running it is just `npm install -g mythgram` followed by `mythgram`.

> **Security note:** Mythgram can run shell commands and read or modify files in its configured workspace. The backend currently has no authentication layer. Run it only in a trusted environment, keep its workspace and `.mythgram` data private, and do not expose the backend or development UI to an untrusted network without adding an appropriate access-control boundary.

## Features

- **Streaming agent chat:** ReAct-style tool use, live reasoning/output events, stop and resume behavior, and persisted conversation/event history.
- **Workspace tools:** File listing, reading, writing and editing; shell execution; text/code search; web search and scraping; image and QR-code inspection; and checkpoints.
- **Model choice:** A registry of hosted and local providers, plus user-defined providers. Configure provider, model, credentials, and model-specific options in **Settings**.
- **Agent customization:** Main-agent system prompts, custom agents, task modes, reusable prompt library, skills, and specialist sub-agents.
- **Multi-agent work:** Teams with a coordinating agent and members, plus a CEO-style agent that coordinates teams.
- **Memory and knowledge:** Persistent memory and knowledge bases, URL-based knowledge import, and a background memory agent.
- **Context management:** Context usage monitoring, automatic summarization handoffs, and sliding-window truncation.
- **Integrations:** MCP servers and Composio-backed app connectors, exposed to agent runs when enabled.
- **Automation and messaging:** Persistent schedules run in the backend; Telegram, Discord, and Slack channel providers can route messages through an agent. WhatsApp appears in the codebase as a placeholder, not a supported ready-to-use channel.
- **Agent Client Protocol (ACP):** Any ACP client (for example the Zed editor) can drive Mythgram over stdio. Configure which runtime ACP sessions use in the console's **ACP** panel, then copy the generated connection config.
- **Continuous, supervised runtime:** `mythgram` starts the app through a built-in daemon that health-checks and auto-restarts it, so it keeps running in the background.
- **Other workspace controls:** User profiles, global search, file/preview panels, and text-to-speech provider settings.
- **Separate local TTS helper:** `packages/local-tts/` contains a standalone Piper TTS service and web UI; it is not required to run the main application.

---

## Requirements

- **Node.js `>= 20.9.0`** (Node.js 22.12 or newer is recommended for the current frontend toolchain).
- **npm** (included with Node.js).
- A supported model provider and its credentials, or a reachable local model server, to run model-backed agent turns.
- A C/C++ build toolchain may be needed on platforms where npm must compile the `better-sqlite3` native dependency (prebuilt binaries usually avoid this).

---

## Install

Pick one of the following.

### Option A — Global install (recommended)

Gives you the `mythgram` command everywhere:

```bash
npm install -g mythgram
```

### Option B — Run without installing

```bash
npx --yes mythgram start
```

### Option C — Local project install

```bash
npm install mythgram
npx mythgram start
```

> Tip: `mythgram` (no arguments) is the interactive start command. When stdin is a pipe (how editors spawn it for ACP), the CLI instead speaks the Agent Client Protocol — see [Connect an ACP editor](#connect-an-acp-editor-zed-etc). Use `mythgram start` to force the app to start in scripts or CI.

---

## Quick start

Open a terminal **in the folder you want the agent to work on** — this becomes the workspace — and run:

```bash
mythgram
```

You will see:

```
  Mythgram is running → http://localhost:8787
  Workspace           → /path/where/you/ran/it
  Data folder         → /path/where/you/ran/it/.mythgram

  The app runs in the background and restarts itself if it crashes.
  Stop it with: mythgram stop    Status: mythgram status
```

Then open **http://localhost:8787** in your browser. One port serves both the web console and the API.

Change the port with the `PORT` environment variable:

```bash
PORT=9000 mythgram start
```

---

## How the app runs (single port + daemon)

The published package ships **one process that serves everything**:

1. At build time, the React/Vite console is compiled to static files in `packages/mythgram/dist/web`.
2. The Express backend serves those files **and** the `/api/*` routes on the same listener (`packages/mythgram/src/index.ts`).
3. The browser only calls same-origin `/api/*` paths, so there is no CORS or proxy needed at runtime.
4. In a development checkout the frontend is instead served by Vite on `:5173`, which proxies `/api` to the backend on `:8787`.

When you run `mythgram`, it starts the app through a **daemon (supervisor)**:

- The CLI launches a detached supervisor and exits, leaving the app running in the background.
- The supervisor restarts the app if it crashes (with backoff) and health-checks `/health` every 15 seconds.
- Supervision stops only when you run `mythgram stop`. It is **not** reboot-persistent until you run `mythgram install` (systemd user service, or a cron `@reboot` fallback).

To watch it in the foreground instead (attached to the terminal, still supervised):

```bash
mythgram start --foreground
```

---

## Configure the agent

1. Open the console at **http://localhost:8787**.
2. Go to **Settings** and choose a provider, paste its API key, and select a model.
3. Optionally connect TTS, connectors, MCP servers, channels, and schedules.
4. Settings persist in `.mythgram/mythgram.db`.

Optional server-side defaults live in a `.env` file in your workspace root. The backend loads `.env` from its working directory. A full example ships inside the package:

```bash
# Linux/macOS (global install)
cp "$(npm root -g)/mythgram/packages/mythgram/.env.example" .env
# then edit .env and restart:  mythgram restart
```

See [Configuration](#configuration) for the supported variables.

---

## The `.mythgram` folder

`mythgram` creates a `.mythgram` data directory **in the folder where you ran the command** (or at `WORKSPACE_ROOT` / `MYTHGRAM_DATA_DIR` if set):

```
<workspace>/.mythgram/
├── mythgram.db          # SQLite: chats, settings, memory, knowledge, schedules...
├── mythgram.db-wal
├── .acp-endpoint.json   # lets ACP bridges discover the running backend
└── deamon/
    ├── supervisor.pid   # supervisor process id
    ├── supervisor.log   # supervisor log
    └── app.log          # backend/app log
```

This directory is the single source of runtime state. Keep it private and back it up if you care about your chats and settings. Switching the workspace in the UI never moves or recreates it.

---

## Manage the running app

```bash
mythgram status            # supervisor + app status
mythgram logs              # tail supervisor/app logs
mythgram logs --lines 200
mythgram restart
mythgram stop
```

Keep it alive across reboots:

```bash
mythgram install           # enable autostart (systemd user service / cron) and start now
mythgram uninstall         # stop + remove autostart entries
```

CLI reference:

| Command | Description |
| --- | --- |
| `mythgram` / `mythgram start` | Start the app (daemonized). |
| `mythgram start --foreground` | Run the supervisor in the foreground. |
| `mythgram stop` | Stop the supervisor and the app. |
| `mythgram restart` | Restart the app. |
| `mythgram status` | Show supervisor + app health. |
| `mythgram logs [--lines N]` | Tail the logs. |
| `mythgram install` | Install autostart and start now. |
| `mythgram uninstall` | Stop and remove autostart. |
| `mythgram acp` | Run the ACP stdio bridge (used by editors). |
| `mythgram help` | Show CLI help. |

---

## Connect an ACP editor (Zed, etc.)

Mythgram can act as an [Agent Client Protocol](https://agentclientprotocol.com) agent, so any ACP client can drive it. The ACP bridge reuses the exact runtimes configured in the console (Default Agent, Chat mode, Custom Agents, agent teams, CEO systems, context management, the memory agent, connectors, MCP servers, TTS, and workspace).

1. Keep Mythgram running: `mythgram start`.
2. Open the **ACP** panel in the console and choose the active runtime and any overrides. It shows the exact connection command/config.
3. The advertised connection is:

   - **command:** `npx`
   - **args:** `["--yes", "mythgram"]`

4. Example Zed `settings.json`:

   ```json
   {
     "agent_servers": {
       "mythgram": {
         "command": "npx",
         "args": ["--yes", "mythgram"]
       }
     }
   }
   ```

The bridge discovers the running backend automatically from `<workspace>/.mythgram/.acp-endpoint.json` (written on boot), so no base URL is passed. ACP clients spawn the bridge with piped stdio, which is how the `mythgram` CLI knows to speak ACP instead of starting the UI. No authentication is required because it runs locally.

---

## Upgrade / uninstall

```bash
npm install -g mythgram@latest     # upgrade
mythgram stop                      # stop before removing
mythgram uninstall                 # remove autostart (if you ran `mythgram install`)
npm uninstall -g mythgram          # remove the package
```

Your data stays in each workspace's `.mythgram/` folder — delete it manually to wipe state.

---

## Working from source (development)

Clone the repo and install dependencies for each package.

### Quick start in dev

From the repository root:

```bash
./start.sh
```

This installs dependencies for both packages and starts the backend and frontend in development mode:

- Web console: [http://localhost:5173](http://localhost:5173)
- Backend health check: [http://localhost:8787/health](http://localhost:8787/health)

Press **Ctrl+C** to stop both. Logs are written to `.mythgram-backend.log` and `.mythgram-frontend.log` at the repository root. On Windows, run the components manually (see below); the root shell scripts are Bash scripts and `stop.sh` relies on `fuser`.

### Run components separately

For a reproducible install using the committed lockfiles, open two terminals from the repository root.

Terminal 1 — backend:

```bash
cd packages/mythgram
npm ci
npm run dev
```

Terminal 2 — frontend:

```bash
cd packages/frontend-main
npm ci
MYTHGRAM_API_URL=http://localhost:8787 npm run dev
```

Then visit [http://localhost:5173](http://localhost:5173). The frontend needs the backend to be available; it is not a standalone app. To run the **built** frontend, run `npm run build` in `packages/frontend-main/` (this emits into `packages/mythgram/dist/web/`); the backend then serves it on `:8787`. You can also use `npm run preview` (default preview port `4173`) while the backend runs.

### Development commands

Backend (`packages/mythgram/`):

```bash
npm run dev        # Watch mode, using tsx
npm start          # Run the TypeScript entry point
npm run build      # Compile to dist/ (tsconfig.build.json)
npm run typecheck  # Type check without emitting
npm test           # Backend test suite
```

Frontend (`packages/frontend-main/`):

```bash
npm run dev        # Vite development server
npm run build      # Type check + production build (emits into packages/mythgram/dist/web)
npm run typecheck  # Type check
npm run lint       # oxlint
npm run preview    # Preview the built frontend
```

Backend tests use Node's test runner through `tsx`; the frontend package does not currently define a test script. The GitHub Actions production-build workflows install with `npm ci` and run the component build commands; they do not run the full backend test suite.

### Build and publish the package (maintainers)

```bash
# from the repo root
npm --prefix packages/mythgram install
npm --prefix packages/frontend-main install

npm run build          # backend → packages/mythgram/dist, frontend → packages/mythgram/dist/web
npm pack --dry-run     # inspect what will ship

npm publish            # prepublishOnly re-runs the build automatically
```

Bump `version` in the root `package.json` before each publish; npm rejects republishing an existing version.

---

## Configuration

### Backend

`packages/mythgram/.env.example` documents backend settings. Copy it to a `.env` file in your workspace (or run directory) and adjust only what you need:

```bash
cp packages/mythgram/.env.example .env
```

The backend loads `.env` from its process working directory. Main settings include:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Express API + console port. |
| `WORKSPACE_ROOT` | Current working directory | Workspace used by file tools and for the `.mythgram` data directory. Absolute or relative. |
| `MYTHGRAM_DATA_DIR` | `<workspace>/.mythgram` | Fixed path to the application data directory (database, artifacts, skills, checkpoints, logs). Not moved when the workspace is switched. |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins, or `*`. Use a narrow value when appropriate for your deployment. |
| `SHELL_TIMEOUT_MS` | `180000` | Shell tool command timeout in milliseconds. |
| `PLAN_APPROVAL_TIMEOUT_MS` | `60000` | How long a submitted plan waits for approval before autonomous continuation. |
| `QUESTION_TIMEOUT_MS` | `180000` | How long an agent's question waits for an answer before autonomous continuation. |
| `SEARCH_PROVIDER` | `duckduckgo` | Web search provider: `duckduckgo`, `tavily`, `exa`, or `serpapi`. DuckDuckGo is the default keyless option. |
| `FETCH_PROVIDER` | `builtin` | Page-fetch provider: `builtin` or `firecrawl`. |
| `MEMORY_AGENT_ENABLED` | `true` | Enables the background memory agent. Set to `false` to disable it. |
| `MEMORY_AGENT_INTERVAL` | `3` | Completed user turns between memory-agent runs. |
| `SUMMARY_THRESHOLD` | `0.9` | Context utilization fraction that triggers summarization. |
| `SLIDING_WINDOW_TRUNCATE_PERCENT` | `0.3` | Fraction of context to free when sliding-window truncation runs. |

Optional integration/fallback keys include `TAVILY_API_KEY`, `EXA_API_KEY`, `SERPAPI_API_KEY`, `FIRECRAWL_API_KEY`, `COMPOSIO_API_KEY`, `OPENROUTER_API_KEY`, and `KITTENML_API_KEY`. See `packages/mythgram/.env.example` for additional controls. Model-provider credentials are generally managed through the frontend **Settings** rather than this environment file.

**Workspace and database location:** the backend uses the current working directory when `WORKSPACE_ROOT` is unset, so running `mythgram` in a folder creates `<folder>/.mythgram/mythgram.db`. The dev `start.sh` changes into `packages/mythgram/`, so the default dev database is `packages/mythgram/.mythgram/mythgram.db`. Protect this directory: it contains persisted application state and conversation data.

### Frontend (development)

`packages/frontend-main/.env.example` lists:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MYTHGRAM_API_URL` | `http://localhost:8787` | Backend target for Vite's `/api` proxy. |
| `VITE_PORT` | `5173` | Development server port. |

These values are read by `vite.config.ts` from the process environment. Export them in the shell (as in the manual run command above) to override them. In development the UI communicates with the backend through the Vite proxy rather than making browser requests directly to the backend.

---

## API overview

The backend exposes `GET /health` and REST/SSE APIs under `/api/`. The main route groups include:

- `/api/chat` — streaming turns, aborts, plan approvals, and user-question responses.
- `/api/providers` and `/api/tools` — provider/model and tool metadata.
- `/api/files`, `/api/workspace`, and `/api/scrape` — workspace file access and web content operations.
- `/api/sessions` and `/api/state` — conversation and application-state persistence.
- `/api/custom-agents`, `/api/profiles`, `/api/main-agent-prompts`, `/api/prompt-library`, and `/api/prompt-agent` — agent and prompt configuration.
- `/api/memory-agent` and `/api/summaries` — memory runs and context summaries.
- `/api/connectors` and `/api/mcp` — app connectors and MCP servers.
- `/api/schedules`, `/api/channels`, and `/api/tts` — scheduled tasks, messaging channels, and speech.
- `/api/acp` — Agent Client Protocol status/configuration and the resolved turn used by the stdio bridge.

For the authoritative route implementations, see `packages/mythgram/src/index.ts` and `packages/mythgram/src/api/`.

---

## Repository layout

```
.
├── packages/            # Monorepo packages
│   ├── mythgram/        # TypeScript/Express agent backend, CLI, and SQLite persistence
│   │   ├── src/         # Backend source (agent runtime, API, daemon, ACP, CLI)
│   │   └── dist/        # Build output: compiled backend + bundled web console (generated)
│   ├── frontend-main/   # React 19 + Vite web console
│   └── local-tts/       # Standalone Python/Piper TTS service and web UI
├── bin / package.json   # Root package: `mythgram` bin → packages/mythgram/dist/cli.js
├── start.sh             # Starts the main backend and frontend in development mode
├── stop.sh              # Stops processes listening on the default development ports
└── .github/workflows/   # Backend/frontend build and deployment-status workflows
```

The backend owns the agent runtime, API, scheduler, channel services, integrations, CLI, daemon, and database. The frontend calls same-origin `/api/*` paths; in production the backend serves the compiled frontend itself, and in development Vite proxies those requests to the backend (including long-lived server-sent event streams).

---

## Standalone local TTS helper

The optional `packages/local-tts/` project is a separate Python/Piper service with its own web console. It requires Python 3 and Node.js/npm. From the repository root:

```bash
./packages/local-tts/dev.sh
```

The script prepares a Python virtual environment, installs the local UI dependencies, and starts the service at [http://localhost:7878](http://localhost:7878) with its UI at [http://localhost:4000](http://localhost:4000). Piper installation and voice management are handled through that UI. This helper is separate from the main Mythgram startup and is not needed for the main app's TTS integrations.

---

## Deployment and security considerations

- The root `Dockerfile` and `Dockerfile.base` are stale scaffolding: they refer to `frontend/` and `backend/` paths and a Python/FastAPI application that do not match the current `packages/frontend-main/` and `packages/mythgram/` projects. They are not a working container deployment recipe for the current application.
- The default backend CORS configuration is permissive, and the API has no built-in authentication. Restrict network access and CORS, and place the service behind a trusted authenticated proxy before any shared or public deployment.
- Agent tools can access and modify files in the selected workspace and run shell commands. Use a dedicated workspace with only the files the agent should access.
- SQLite is stored under the workspace's `.mythgram/` directory. Back it up along with any workspace files you need to preserve; do not publish it or commit credentials from application state.
- `stop.sh` terminates processes bound to ports `8787` and `5173` using `fuser`; it is not limited to processes started by `start.sh`. Review its behavior before using it on a machine where those ports may be used by other applications.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project's contribution expectations. In brief, changes should be complete, tested, build-clean, and accompanied by reproducible validation steps. See [SECURITY.md](SECURITY.md) for the current security policy.

## License

This project is licensed under the [MIT License](LICENSE).
