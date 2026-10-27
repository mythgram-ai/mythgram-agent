# Mythgram Agent 🪄

Mythgram AI is a general-purpose AI assistant and action-taking agent workspace—not just a coding chatbot. It can help with research, writing, planning, software development, and everyday digital work: explore a project, edit files, run commands, search the web, and use connected tools to carry tasks forward. It can draw on persistent memory and knowledge, reusable skills and prompts, specialist agents and coordinated teams, and scheduled or messaging-based workflows. Mythgram belongs to the broader personal-agent category that includes projects such as OpenClaw, Hermes, and Manus; its focus is a workspace you can run and configure yourself, with agents that work through tools rather than only returning answers.

The browser-based console, **frontend-main**, brings chat and workspace management together: configure agents and models, review conversations, manage integrations and schedules, and inspect files and results. A TypeScript/Express backend runs agent tasks and stores workspace state in SQLite, while a React/Vite frontend provides the interactive console. Connect to hosted model providers, local model servers, or a custom OpenAI-compatible endpoint—the model can be remote even when Mythgram and its workspace data run locally. Model credentials and most application settings are configured in the web console; optional server-side integrations can be configured through environment variables.

> **Security note:** Mythgram can run shell commands and read or modify files in its configured workspace. The backend currently has no authentication layer. Run it only in a trusted environment, keep its workspace and `.mythgram` data private, and do not expose the backend or development UI to an untrusted network without adding an appropriate access-control boundary.

## Features

- **Streaming agent chat:** ReAct-style tool use, live reasoning/output events, stop and resume behavior, and persisted conversation/event history.

- **Workspace tools:** File listing, reading, writing and editing; shell execution; text/code search; web search and scraping; image and QR-code inspection; and checkpoints.

- **Model choice:** A registry of hosted and local providers, plus user-defined providers. Configure provider, model, credentials, and model-specific options in **Settings**.

- **Agent customization:** Main-agent system prompts, custom agents, task modes, reusable prompt library, skills, and specialist sub-agents.

- **Multi-agent work:** Teams with a coordinating agent and members, plus a CEO-style agent that can coordinate teams.

- **Memory and knowledge:** Persistent memory and knowledge bases, URL-based knowledge import, and a background memory agent.

- **Context management:** Context usage monitoring, automatic summarization handoffs, and sliding-window truncation.

- **Integrations:** MCP servers and Composio-backed app connectors, with tools exposed to agent runs when enabled.

- **Automation and messaging:** Persistent schedules run in the backend; Telegram, Discord, and Slack channel providers can route messages through an agent. WhatsApp appears in the codebase as a placeholder, not a supported ready-to-use channel.

- **Other workspace controls:** User profiles, global search, file/preview panels, and text-to-speech provider settings.

- **Separate local TTS helper:** `packages/local-tts/` contains a standalone Piper TTS service and web UI; it is not required to run the main application.

## Repository layout

```
.
├── mythgram/          # TypeScript/Express agent backend and SQLite persistence
├── frontend-main/     # React 19 + Vite web console
├── packages/
│   └── local-tts/     # Standalone Python/Piper TTS service and web UI
├── start.sh           # Starts the main backend and frontend in development mode
├── stop.sh            # Stops processes listening on the default development ports
└── .github/workflows/ # Backend/frontend build and deployment-status workflows
```

The backend owns the agent runtime, API, scheduler, channel services, integrations, and database. The frontend calls same-origin `/api/*` paths; Vite proxies those requests to the backend, including long-lived server-sent event (SSE) streams.

## Requirements

- **Node.js 22.12 or newer** is recommended for the current frontend toolchain. The backend package declares Node.js `>=20.9.0`.

- npm (included with Node.js).

- A supported model provider and its credentials, or a reachable local model server, to run model-backed agent turns.

- A C/C++ build toolchain may be needed on platforms where npm must compile the `better-sqlite3` native dependency.

## Quick start

From the repository root:

```bash
./start.sh
```

The script installs dependencies for both packages, then starts the backend and frontend in development mode. Open:

- Web console: [http://localhost:5173](http://localhost:5173)

- Backend health check: [http://localhost:8787/health](http://localhost:8787/health)

Press **Ctrl+C** in the terminal to stop both processes. Logs are written to `.mythgram-backend.log` and `.mythgram-frontend.log` at the repository root. The script uses `npm install` each time it runs.

### Run components separately

For a reproducible install using the committed lockfiles, open two terminals from the repository root.

Terminal 1 — backend:

```bash
cd mythgram
npm ci
npm run dev
```

Terminal 2 — frontend:

```bash
cd frontend-main
npm ci
MYTHGRAM_API_URL=http://localhost:8787 npm run dev
```

Then visit [http://localhost:5173](http://localhost:5173). The frontend needs the backend to be available; it is not a standalone app. To run the built frontend locally after building it, use `npm run preview` in `frontend-main/` (default preview port `4173`); the backend must still be running.

On Windows, run the backend and frontend commands in separate terminals. The root shell scripts are Bash scripts; `stop.sh` also relies on `fuser`.

## Configuration

### Backend

`mythgram/.env.example` documents backend settings. Copy it to `mythgram/.env` and adjust only what you need:

```bash
cp mythgram/.env.example mythgram/.env
```

The backend loads `.env` from its process working directory. Main settings include:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Express API port. |
| `WORKSPACE_ROOT` | Current working directory | Workspace used by file tools and for the `.mythgram` data directory. Can be absolute or relative to the backend process directory. |
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

Optional integration/fallback keys include `TAVILY_API_KEY`, `EXA_API_KEY`, `SERPAPI_API_KEY`, `FIRECRAWL_API_KEY`, `COMPOSIO_API_KEY`, `OPENROUTER_API_KEY`, and `KITTENML_API_KEY`. See `mythgram/.env.example` for additional controls. Model-provider credentials are generally managed through the frontend Settings rather than required in this environment file.

**Workspace and database location:** the backend uses the current working directory when `WORKSPACE_ROOT` is unset. The root `start.sh` changes into `mythgram/` before starting it, so the default database is `mythgram/.mythgram/mythgram.db`. Set `WORKSPACE_ROOT` to choose a different workspace; the application creates its `.mythgram/` directory and SQLite database automatically. Protect this directory: it contains persisted application state and conversation data.

### Frontend

`frontend-main/.env.example` lists:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MYTHGRAM_API_URL` | `http://localhost:8787` | Backend target for Vite's `/api` proxy. |
| `VITE_PORT` | `5173` | Development server port. |

These values are read by `vite.config.ts` from the process environment. Export them in the shell (as in the manual run command above) if you need to override them. The UI communicates with the backend through the Vite proxy rather than making browser requests directly to the backend.

## Development commands

Run commands from the relevant package directory.

### Backend (`mythgram/`)

```bash
npm run dev        # Watch mode, using tsx
npm start          # Run the TypeScript entry point
npm run build      # TypeScript build/check command
npm run typecheck  # Type check without emitting
npm test           # Backend test suite
```

### Frontend (`frontend-main/`)

```bash
npm run dev        # Vite development server
npm run build      # Type check and production Vite build
npm run typecheck  # Type check
npm run lint       # oxlint
npm run preview    # Preview the built frontend
```

Backend tests use Node's test runner through `tsx`; the frontend package does not currently define a test script. The GitHub Actions production-build workflows install with `npm ci` and run the component build commands. They do not run the full backend test suite as part of those build workflows.

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

For the authoritative route implementations, see `mythgram/src/index.ts` and `mythgram/src/api/`.

## Standalone local TTS helper

The optional `packages/local-tts/` project is a separate Python/Piper service with its own web console. It requires Python 3 and Node.js/npm. From the repository root:

```bash
./packages/local-tts/dev.sh
```

The script prepares a Python virtual environment, installs the local UI dependencies, and starts the service at [http://localhost:7878](http://localhost:7878) with its UI at [http://localhost:4000](http://localhost:4000). Piper installation and voice management are handled through that UI. This helper is separate from the main Mythgram startup and is not needed for the main app's TTS integrations.

## Deployment and security considerations

- The root `Dockerfile` and `Dockerfile.base` are stale scaffolding: they refer to `frontend/` and `backend/` paths and a Python/FastAPI application that do not match the current `frontend-main/` and `mythgram/` projects. They are not a working container deployment recipe for the current application.

- The default backend CORS configuration is permissive, and the API has no built-in authentication. Restrict network access and CORS, and place the service behind a trusted authenticated proxy before any shared or public deployment.

- Agent tools can access and modify files in the selected workspace and run shell commands. Use a dedicated workspace with only the files the agent should access.

- SQLite is stored under the workspace's `.mythgram/` directory. Back it up along with any workspace files you need to preserve; do not publish it or commit credentials from application state.

- `stop.sh` terminates processes bound to ports `8787` and `5173` using `fuser`; it is not limited to processes started by `start.sh`. Review its behavior before using it on a machine where those ports may be used by other applications.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project's contribution expectations. In brief, changes should be complete, tested, build-clean, and accompanied by reproducible validation steps. See [SECURITY.md](SECURITY.md) for the current security policy.

## License

This project is licensed under the [MIT License](LICENSE).

