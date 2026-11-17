---
name: self-connect-acp-agent
description: "Connect to and drive external ACP-compatible agents (Claude Agent, Codex, Gemini CLI, OpenCode, Goose, Cline, GitHub Copilot, Qwen Code) using the ACP agent tools. Use when the user asks to connect, list, call, interrupt, reset, or remove an external ACP agent, or to delegate work to one."
---

# Self Connect ACP Agent

## Mission
Connect, drive, and manage external ACP-compatible agents through the six ACP agent tools. Deliver the external agent's work back to the user, never just a description of what could be done.

## Scope

These tools make Mythgram an ACP **client** that spawns and drives external CLI agents. Do not confuse this with the separate ACP **server** feature that lets external editors (Zed, Neovim) drive Mythgram via `npx mythgram`.

Availability: these tools are only available to the Main Agent, Custom Agents, and team/CEO agents. Sub-agents, chat mode, and the memory agent do not have them (calls return `acp_agents_unavailable`). If a tool is unavailable, do the work directly instead of asking the user to enable it.

## The six tools

All six reject unknown arguments (strict schemas). Only pass documented fields.

### connect_acp_agents(acp_agent_name, acp_agent_command, acp_agent_args)
Connect a NEW external ACP agent. It is spawned and initialized immediately.
- `acp_agent_name` (string, required): a name for the connection.
- `acp_agent_command` (string, required): ONLY the executable, e.g. `npx`, `opencode`, `goose`. Never include arguments here.
- `acp_agent_args` (array of strings, required, may be empty): arguments only, e.g. `["-y", "@agentclientprotocol/claude-agent-acp"]`. Never include the executable itself.

Success returns `created`, `connected`, `acp_agent_id`, `name`, `status`, `protocol_version`, and a message. A failed connect is rolled back automatically. Limits: command up to 1024 chars, name up to 120 chars, up to 100 args.

Common launch recipes (from the built-in connector presets):
- Claude Agent: command `npx`, args `["-y", "@agentclientprotocol/claude-agent-acp"]`
- Codex: command `npx`, args `["-y", "@agentclientprotocol/codex-acp"]`
- Gemini CLI: command `npx`, args `["-y", "@google/gemini-cli", "--acp"]`
- OpenCode: command `opencode`, args `["acp"]`
- Qwen Code: command `npx`, args `["-y", "@qwen-code/qwen-code", "--acp"]`
- Cline: command `npx`, args `["-y", "cline", "--acp"]`
- GitHub Copilot: command `npx`, args `["-y", "@github/copilot", "--acp"]`
- Goose: command `goose`, args `["acp"]`

When the user names a well-known agent but gives no command, use the matching recipe above. Do not invent packages or commands — if unsure, ask for the launch command.

### list_available_acp_agents()
List every connected ACP agent. No arguments. Returns `count` and `agents[]`, each with `acp_agent_id`, `name`, `command`, `args`, `connected`, `status`, `agent_name`, `protocol_version`, `sessions`, `error`, and `auth_required`.

ALWAYS call this first to get the exact `acp_agent_id` before calling any other agent-specific tool. IDs are 20-digit numbers — never guess or fabricate them.

### call_connected_acp_agents(agents[{acp_agent_id, prompt, wait_for_output}])
Call one or more connected agents concurrently. Each entry is independent.
- `acp_agent_id` (string, required): exact id from `list_available_acp_agents`.
- `prompt` (string, required): the task instructions for that agent.
- `wait_for_output` (boolean, optional, default `true`): when `true`, block until the agent finishes and return its final text inline as `output`. When `false`, launch detached in the background and return immediately with an `output_file` path under `.mythgram/acp/` (e.g. `.mythgram/acp/claude-agent-output-48213.md`); the agent keeps running even after this turn ends.

Entries run in parallel and may mix waited and background calls. The result is `{count, waited_for, running_in_background, failed, agents[]}`. Check `failed` and each entry's `ok`/`error` — the top-level `ok` is true even when individual entries fail. An unknown id appears as a per-entry failure.

Read background output with `file_read` using the returned path. The file starts with `Status: running` and is updated to `completed` or `failed`; re-read it later for the final report. Output files are not auto-deleted.

### start_new_acp_agent_session(acp_agent_id)
Start a FRESH session for an existing agent, discarding its prior context. Use when the next task is unrelated to the current conversation. Subsequent calls in this chat use the new session.

### Interrupt_acp_agent(acp_agent_id, prompt)
Interrupt a running task and send a new instruction; the agent's final output for the new prompt is returned inline.
- NOTE THE CAPITAL `I`. The exact tool name is `Interrupt_acp_agent`. Calling `interrupt_acp_agent` will fail.
- `acp_agent_id` (string, required), `prompt` (string, required).
- If nothing is running on that session, this simply sends the prompt as the next turn.

### delete_acp_agents(acp_agent_id)
Disconnect and permanently remove an agent, its sessions, and its event history. Only call when the user explicitly asks to remove an agent. Never guess the id — use `list_available_acp_agents`.

## Workflow

1. Discover: call `list_available_acp_agents` to see what is already connected. If a suitable agent exists, skip to step 3.
2. Connect: call `connect_acp_agents` with the exact executable and args. Confirm the returned `connected` status and keep the `acp_agent_id`.
3. Delegate: call `call_connected_acp_agents` with a clear, self-contained prompt. Use `wait_for_output: true` when you need the result now; use `false` for long-running work you can poll later.
4. Redirect or reset: use `Interrupt_acp_agent` to change a running task, or `start_new_acp_agent_session` for unrelated work.
5. Retrieve and report: return the external agent's answer, citing the output file when relevant.
6. Clean up: call `delete_acp_agents` only on explicit user request.

## Sessions and context

- Sessions are bound per (chat, agent). The FIRST call auto-creates a session; later calls in the same chat reuse it so the external agent keeps context.
- `start_new_acp_agent_session` unbinds the old session so the next call starts fresh.
- `call_connected_acp_agents`, `Interrupt_acp_agent`, and `start_new_acp_agent_session` require an active chat; they fail with `acp_chat_id_required` outside one. `connect`, `list`, and `delete` do not.
- One prompt at a time per session; a concurrent second prompt is rejected by the external agent.

## Caveats

- External agents are NOT sub-agents: each runs as its own process with its own context and tools.
- Delegated runs have no interactive UI: permission requests are auto-approved with the least-privileged "allow" option (or cancelled if none exists), and elicitation requests are declined. The external agent cannot ask the user questions.
- Only text output is collected from foreground calls; images and other content are ignored in the returned `output`.
- A connection may require browser authentication (`auth_required: true` in the list output). Tool-level connect does not perform auth; the in-chat/console UI does.
- Prompts are capped at 200,000 characters. Cancelled turns get up to 20 seconds to release the session before an interrupt sends its new prompt.
- Never claim an external agent did something unless the tool returned a successful result or the output file says `completed`.
