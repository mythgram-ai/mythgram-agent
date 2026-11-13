# Examples

Practical, copy-paste examples for running, driving, and configuring Mythgram.
Everything here is written against the current codebase (`packages/mythgram` +
`packages/frontend-main`).

| Guide | What you'll learn |
| --- | --- |
| [quickstart.md](quickstart.md) | Install, start, and run your first agent task. |
| [api-examples.md](api-examples.md) | Drive the backend directly over HTTP: health, models, streaming chat, sessions, files, scraping. |
| [agent-prompts.md](agent-prompts.md) | Prompts and workflows that show off research, coding, planning, and multi-agent runs. |
| [configuration.md](configuration.md) | Environment recipes for providers, search, memory, and local model servers. |
| [acp-editors.md](acp-editors.md) | Connect an ACP editor (Zed, Neovim, …) to Mythgram. |

> **Security note:** Mythgram has no authentication layer and its tools can run
> shell commands and modify files in the workspace. Run it on a trusted machine,
> bind it to localhost, and never expose the port to an untrusted network without
> an authenticating proxy. See the [deploy guide](../deploy/README.md).

## Conventions used below

- The backend runs on `http://localhost:8787` (override with `PORT`).
- In development the Vite console runs on `http://localhost:5173` and proxies
  `/api/*` to the backend; in production the backend serves the built console on
  the same port.
- Shell snippets assume Bash on Linux/macOS. Substitute `jq` with your own JSON
  tooling if it is not installed (`jq` is used only to pretty-print).
