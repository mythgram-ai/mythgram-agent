# Connect an ACP editor

Mythgram speaks the [Agent Client Protocol](https://agentclientprotocol.com), so
any ACP-compatible client — Zed, Neovim/`codecompanion`, custom tooling — can
drive it as a subprocess. ACP sessions reuse the exact runtimes configured in the
console: Default Agent, Chat mode, Custom Agents, teams, the CEO system, context
management, the memory agent, connectors, MCP servers, TTS, and the workspace.

## How it works

1. Keep the app running: `mythgram start`.
2. The backend writes `<workspace>/.mythgram/.acp-endpoint.json` on boot.
3. When an ACP client spawns `npx --yes mythgram` with piped stdio (no TTY), the
   CLI automatically runs the ACP stdio bridge instead of starting the UI. The
   bridge reads `.acp-endpoint.json` to find the running backend, so **no base URL
   is passed**.
4. The bridge resolves each turn from `GET /api/acp/turn` and streams results back
   over stdio.

No authentication is required because this is local.

## Advertised connection

The console's **ACP** panel shows the exact command/config for your install:

- **command:** `npx`
- **args:** `["--yes", "mythgram"]`

You can also force the bridge manually:

```bash
mythgram acp          # run the stdio bridge (uses the local backend)
```

## Zed

`~/.config/zed/settings.json` (or the settings opened with
`zed: open settings`):

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

Restart Zed, open the agent panel, and select **mythgram**.

## Neovim (codecompanion / generic ACP client)

```lua
require("codecompanion").setup({
  adapters = {
    acp = {
      mythgram = function()
        return {
          name = "mythgram",
          command = "npx",
          args = { "--yes", "mythgram" },
        }
      end,
    },
  },
})
```

## Local install (from this repo)

If `mythgram` is not installed globally, point the client at the built CLI or run
it through the package:

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

or, from the repo, run `node packages/mythgram/dist/cli.js acp` after
`./scripts/build.sh`.

## Choosing the runtime

Open the **ACP** panel in the console to pick the active runtime (Default Agent,
Chat mode, a specific Custom Agent, a team, or the CEO system) and any per-session
overrides. The bridge uses whatever the panel persists.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Bridge starts but no tools work | The app must be running: `mythgram start`, then `mythgram status`. |
| `no endpoint` / cannot connect | Ensure you launched the client from within the workspace that holds `.mythgram/.acp-endpoint.json`. |
| Editor can't find the command | Install globally (`npm install -g mythgram`) or use a full path to the CLI. |
| Wrong workspace | Restart the app from the intended folder, or set `WORKSPACE_ROOT`. |
