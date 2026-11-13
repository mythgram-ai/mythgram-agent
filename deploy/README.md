# Deploying Mythgram

A production-oriented guide to running Mythgram — a single Node.js process that
serves the agent backend **and** the prebuilt web console on **one port** — plus
copy-paste configuration files in [`examples/`](examples/README.md).

> **Read this first (security).** Mythgram has **no authentication layer** and its
> tools can run shell commands and read/write files in the workspace. Treat it like
> a local developer tool: bind it to localhost (or a private interface) and put an
> authenticating reverse proxy in front of it before any shared/remote access.
> Never expose the raw port to the public internet.

---

## 1. How it runs

At build time the React/Vite console is compiled into
`packages/mythgram/dist/web`. At runtime the Express backend serves those static
files and the `/api/*` routes **on the same listener** (`packages/mythgram/src/index.ts`),
so the browser only ever makes same-origin requests — no CORS and no second web
server are required.

The published `mythgram` command starts the app through a **daemon/supervisor**
that health-checks `/health` and restarts it on crash. For containers and process
managers you can instead run the server directly (see Option E).

```
              ┌─────────────────────────────────────────────┐
  browser ───▶│  :8787   Express (API + static web console)  │
              │          SQLite in <workspace>/.mythgram/    │
              └─────────────────────────────────────────────┘
```

Key facts:

- **One port** (default `8787`) serves the UI and the API.
- **State** lives in `<workspace>/.mythgram/mythgram.db` (SQLite, WAL mode).
- **Workspace** defaults to the process working directory; sandboxed file tools
  and shell commands operate only inside it.
- Environment defaults come from a `.env` file in the process working directory.

---

## 2. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js **>= 20.9.0** | Node 22 LTS recommended (matches CI). |
| npm | Ships with Node. |
| Build toolchain | Only needed if `better-sqlite3` must compile from source (`python3`, `make`, `g++`). Prebuilt binaries normally avoid this. |
| A writable directory | The workspace, where `.mythgram/` is created. |
| A model provider | Hosted API key, or a reachable local model server (Ollama/LM Studio/llama.cpp). |

---

## 3. Choose a deployment option

| Option | Best for | Supervisor | Autostart |
| --- | --- | --- | --- |
| **A. Global npm + `mythgram`** | Single user, simplest | Built-in daemon | `mythgram install` |
| **B. Source checkout + `mythgram`** | Running your own build | Built-in daemon | `mythgram install` |
| **C. systemd unit** | Servers with systemd (via `mythgram install`) | systemd (user service) | systemd |
| **D. PM2** | Teams already using PM2 | PM2 | `pm2 startup` |
| **E. Docker / Compose** | Reproducible, isolated | Container restart policy | Compose/`restart` |

Everything below assumes you run the app **in the workspace directory** (the folder
the agent should operate on).

---

## 4. Build the artifact (source deployments)

The publishable package is built from the repo root:

```bash
./scripts/setup.sh          # install backend + frontend dependencies
./scripts/build.sh          # typecheck + backend build + frontend build
# → packages/mythgram/dist          (compiled backend)
# → packages/mythgram/dist/web      (bundled console, served by the backend)
```

`./scripts/build.sh --pack` additionally runs `npm pack --dry-run` so you can
inspect exactly what ships. Bump the root `package.json` `version` before
publishing.

---

## 5. Option A — Global npm install (recommended)

```bash
npm install -g mythgram

cd /srv/mythgram-workspace        # the folder the agent will work on
mythgram                          # starts the daemon, prints the URL
```

```
  Mythgram is running → http://localhost:8787
  Workspace           → /srv/mythgram-workspace
  Data folder         → /srv/mythgram-workspace/.mythgram
```

Persist across reboots:

```bash
mythgram install     # systemd user service when available, else cron @reboot
mythgram status
mythgram logs --lines 200
```

Operate it:

```bash
mythgram restart
mythgram stop
mythgram uninstall   # stop + remove autostart entries
```

Change the port with `PORT=9000 mythgram start`.

---

## 6. Option B — From source

```bash
git clone https://github.com/mythgram-ai/mythgram-agent.git
cd mythgram-agent
./scripts/setup.sh
./scripts/build.sh

cd /srv/mythgram-workspace
node /path/to/mythgram-agent/packages/mythgram/dist/cli.js start
```

The CLI is at `packages/mythgram/dist/cli.js` (`<repo>/bin` points to it). You can
also npm-link it: `npm link` from the repo root makes `mythgram` available on PATH.

---

## 7. Option C — systemd

`mythgram install` writes a **systemd user** unit when a user session bus is
available. For a **system** service (start on boot without a login session), use
the unit in [`examples/mythgram.service`](examples/mythgram.service) and:

```bash
sudo cp deploy/examples/mythgram.service /etc/systemd/system/mythgram.service
sudo systemctl daemon-reload
sudo systemctl enable --now mythgram
systemctl status mythgram
journalctl -u mythgram -f
```

Set `Environment=PORT=8787`, `Environment=WORKSPACE_ROOT=/srv/mythgram-workspace`,
and point `ExecStart` at the built CLI or the global binary.

---

## 8. Option D — PM2

See [`examples/ecosystem.config.cjs`](examples/ecosystem.config.cjs).

```bash
npm install -g pm2
pm2 start deploy/examples/ecosystem.config.cjs
pm2 save
pm2 startup            # follow the printed instruction to enable boot start
pm2 logs mythgram
```

---

## 9. Option E — Docker

> The root `Dockerfile`/`Dockerfile.base` in this repo are **stale scaffolding**
> (they reference old `frontend/`/`backend/` paths). Use the corrected multi-stage
> build in [`examples/Dockerfile`](examples/Dockerfile) and the
> [`docker-compose.yml`](examples/docker-compose.yml).

```bash
# from the repo root, using the corrected Dockerfile
docker build -f deploy/examples/Dockerfile -t mythgram:local .
docker run --rm -p 127.0.0.1:8787:8787 \
  -v "$PWD/workspace:/workspace" \
  -e WORKSPACE_ROOT=/workspace \
  mythgram:local
```

Notes:

- Publish to **`127.0.0.1` only** unless a reverse proxy fronts it.
- Mount a host volume at `/workspace` so `.mythgram/` and your files persist.
- Run as a non-root user; the example image does.
- The container runs the backend directly (no daemon) with a `restart` policy for
  supervision.

---

## 10. Reverse proxy and TLS

To expose Mythgram safely, terminate TLS at a proxy and add authentication. The
critical requirement is to **disable response buffering** so server-sent events
(agent streaming) are delivered immediately.

**nginx** (full config in [`examples/nginx.conf`](examples/nginx.conf)):

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # required for SSE
    proxy_cache off;
    proxy_read_timeout 3600s;     # long agent turns
    proxy_set_header Connection "";
}
```

**Caddy** (automatic HTTPS; see [`examples/Caddyfile`](examples/Caddyfile)):

```caddyfile
mythgram.example.com {
    basic_auth {
        admin $2a$14$REPLACE_WITH_BCRYPT_HASH
    }
    reverse_proxy 127.0.0.1:8787 {
        flush_interval -1         # stream SSE without buffering
    }
}
```

Always add at least one auth layer (basic auth, an SSO gateway, or a VPN) and set
`CORS_ORIGINS` to your public origin instead of `*`.

---

## 11. Production configuration

Place a `.env` next to where the process runs (its working directory), or set
variables in the service/container environment:

```dotenv
PORT=8787
WORKSPACE_ROOT=/srv/mythgram-workspace
MYTHGRAM_DATA_DIR=/srv/mythgram-workspace/.mythgram
CORS_ORIGINS=https://mythgram.example.com
SEARCH_PROVIDER=duckduckgo
FETCH_PROVIDER=builtin
MEMORY_AGENT_ENABLED=true
SUMMARY_THRESHOLD=0.9
```

Model provider credentials are configured in **Settings** (stored in the DB); the
optional server-side keys in `.env` act as fallbacks. See the full reference in
`packages/mythgram/.env.example` and the
[configuration examples](../examples/configuration.md).

---

## 12. Security hardening checklist

- [ ] Bind to `127.0.0.1` (or a private interface), never `0.0.0.0` on a public host.
- [ ] Put an authenticating proxy/VPN in front; there is **no** built-in auth.
- [ ] Terminate TLS; redirect HTTP → HTTPS.
- [ ] Set `CORS_ORIGINS` to specific origins (not `*`).
- [ ] Use a **dedicated workspace** containing only files the agent may touch.
- [ ] Run as an unprivileged user; restrict filesystem permissions.
- [ ] Keep `.mythgram/` private (it holds chats, settings, and memory).
- [ ] Do not commit `.env` or `.mythgram/` to version control.
- [ ] Review `stop.sh` before use — it kills whatever holds ports `8787`/`5173`.
- [ ] Back up the database and workspace regularly (see below).

---

## 13. Data, backups, and restores

Everything runtime-related lives under the workspace's `.mythgram/`:

```
<workspace>/.mythgram/
├── mythgram.db          # SQLite (chats, settings, memory, knowledge, schedules…)
├── mythgram.db-wal      # write-ahead log
├── mythgram.db-shm
├── .acp-endpoint.json
└── deamon/              # supervisor pid + logs
```

SQLite runs in WAL mode, so copy all three `mythgram.db*` files together (or use
`.backup`) for a consistent snapshot. A cron-friendly backup script is in
[`examples/backup.sh`](examples/backup.sh).

```bash
# Consistent online backup with the sqlite3 CLI
sqlite3 "$WORKSPACE/.mythgram/mythgram.db" ".backup '/backups/mythgram-$(date +%F).db'"
```

To restore: stop the app, replace the DB files, then start it again.

---

## 14. Upgrades and rollback

```bash
# Global install
npm install -g mythgram@latest
mythgram restart

# Source checkout
git pull && ./scripts/full-test.sh && ./scripts/build.sh
mythgram restart
```

Before upgrading, back up `.mythgram/`. To roll back, reinstall the previous
version (`npm install -g mythgram@<version>`) or check out the previous tag and
rebuild. Data migrations are applied automatically on boot.

---

## 15. Monitoring and health

- **Health:** `GET /health` returns status, workspace, provider ids, tool names,
  database path, and SQLite version. Use it for probes:

  ```bash
  curl -fsS http://localhost:8787/health | jq '{status, workspace}'
  ```

- **Logs:** `mythgram logs` (daemon), `journalctl -u mythgram` (systemd),
  `pm2 logs mythgram` (PM2), or `docker logs` (container).
- **Probes:** liveness → TCP/HTTP `/health`; readiness → `/health` returns 200.
  Allow a generous startup grace period (SQLite opens + migrations on first boot).

---

## 16. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Port already in use | Another instance / process | `mythgram stop`, or change `PORT`. |
| UI loads but API calls fail | Wrong origin / CORS | Set `CORS_ORIGINS` to the public origin. |
| Streaming stalls behind a proxy | Response buffering | `proxy_buffering off` (nginx) / `flush_interval -1` (Caddy). |
| `better-sqlite3` build errors | Missing toolchain | Install `python3 make g++`, or use Node LTS with prebuilt binaries. |
| Chats empty after moving folders | Running in a new cwd | Set `MYTHGRAM_DATA_DIR`/`WORKSPACE_ROOT` to the original paths. |
| App exits immediately | Workspace not writable | Ensure the user can write `<workspace>/.mythgram/`. |
| Editor ACP can't connect | App not running / wrong cwd | `mythgram start`; launch from the workspace that holds `.mythgram/`. |

---

## 17. Quick reference

```bash
# Build
./scripts/setup.sh && ./scripts/build.sh --pack

# Run (choose one)
mythgram                                       # global + daemon
node packages/mythgram/dist/cli.js start        # source + daemon
docker compose -f deploy/examples/docker-compose.yml up -d

# Operate
mythgram status | logs | restart | stop
mythgram install | uninstall

# Verify
curl -fsS http://localhost:8787/health
./scripts/full-test.sh
```

See [`examples/`](examples/README.md) for the full set of copy-paste configuration
files: systemd units, PM2, nginx, Caddy, Docker, Compose, `.env.production`,
backup, and health-check scripts.
