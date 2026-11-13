# Deployment examples

Copy-paste configuration files referenced by the [deploy guide](../README.md).
Adjust paths, users, domains, and the port to match your environment, then
follow the "Install" comment at the top of each file.

| File | Purpose |
| --- | --- |
| [`mythgram.service`](mythgram.service) | systemd **system** unit running the compiled server (supervised, boot start). |
| [`ecosystem.config.cjs`](ecosystem.config.cjs) | PM2 process definition. |
| [`Dockerfile`](Dockerfile) | Correct multi-stage container build for the current monorepo. |
| [`docker-compose.yml`](docker-compose.yml) | Compose service with a persistent data volume and healthcheck. |
| [`nginx.conf`](nginx.conf) | nginx reverse proxy: TLS, basic auth, and SSE-safe buffering. |
| [`Caddyfile`](Caddyfile) | Caddy reverse proxy with automatic HTTPS and streaming. |
| [`.env.production`](.env.production) | Example production environment variables. |
| [`backup.sh`](backup.sh) | Consistent SQLite backup with retention. |
| [`healthcheck.sh`](healthcheck.sh) | Probe `/health`; exit non-zero when unhealthy. |

## Quick start

**systemd**

```bash
sudo cp deploy/examples/mythgram.service /etc/systemd/system/mythgram.service
sudo systemctl daemon-reload
sudo systemctl enable --now mythgram
journalctl -u mythgram -f
```

**PM2**

```bash
npm install -g pm2
pm2 start deploy/examples/ecosystem.config.cjs
pm2 save && pm2 startup
```

**Docker Compose**

```bash
docker compose -f deploy/examples/docker-compose.yml up -d --build
curl -fsS http://localhost:8787/health
```

**nginx**

```bash
sudo cp deploy/examples/nginx.conf /etc/nginx/conf.d/mythgram.conf
sudo htpasswd -c /etc/nginx/.htpasswd admin
sudo nginx -t && sudo systemctl reload nginx
```

## Common adjustments

- **Port:** change `PORT` (env/unit/compose) and the proxy `proxy_pass` target
  together.
- **Workspace:** point `WORKSPACE_ROOT` (and the mounted volume / `ReadWritePaths`)
  at the folder the agent should operate on.
- **Data dir:** set `MYTHGRAM_DATA_DIR` to a stable path so restarts from a
  different working directory never fork your chats.
- **CORS:** replace `*` with your exact public origin(s).

> Reminder: the backend has no authentication. Always run it behind an
> authenticating proxy (basic auth, SSO, or VPN) before exposing it beyond
> localhost.
