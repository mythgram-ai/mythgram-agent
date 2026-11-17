---
name: self-connect-app
description: "Connect Composio-powered app connectors (GitHub, Slack, Notion, Gmail, Outlook, Google Calendar, and more) and use their native app tools. Use when the user asks to connect, check, use, or disconnect an app connector, or when a task needs tools from an external app."
---

# Self Connect App

## Mission
Connect the external app a task needs, then use that app's real tools to complete the task. Never simulate app actions or claim a connection that was not confirmed.

## Availability
The four connector management tools are available to the Main Agent, Custom Agents, and team/CEO agents only. Sub-agents and chat mode do not have them (`connectors_unavailable`). Native app tools of already-connected apps are available on all surfaces.

## Prerequisites
- A Composio API key must be configured in Settings → Composio (preferred) or via the server's `COMPOSIO_API_KEY`. If missing, the tools return `composio_key_missing` — tell the user where to add it.
- Only OAuth-capable apps are offered. The catalog is fetched live from Composio, so there is no fixed list; use the tool to discover what is available.

## The four management tools

All four use strict schemas: pass only the documented fields. All names must be the exact `connector_name` returned by `list_available_application_connectors` (a lowercase slug like `github` or `googlecalendar`).

### list_available_application_connectors()
No arguments. Returns `count`, `connected_count`, and `connectors[]` with `connector_name`, `label`, `description`, `homepage`, `toolkit`, `status`, `connected`, `requires_user_action`, `account_label`. Call this first whenever you need an app or an exact connector name.

### connect_applications_connectors(connector_name)
Request connection to an app. `connector_name` (string, required) must come from the list tool.
- A Connect button appears in the chat UI and the user authorizes the app in the browser, up to 3 minutes.
- On success the tool returns `connected: true`, `tool_count`, and `tools[]`; every tool of that app is attached to this conversation immediately.
- If the user does not finish in time, it returns `connect_pending: true`. Tell the user to press Connect and then call `get_application_connector_status`.
- If already connected, it re-attaches the tools and returns `already_connected: true`.
- Errors: `unknown_connector`, `composio_key_missing`, `connector_connect_failed`, `aborted`.

### get_application_connector_status(connector_name)
Returns `status` (`connected`, `disconnected`, `requires_user_action`, `failed`), `connected`, `enabled`, `requires_user_action`, `tools_usable`, `connection`, and a message with next steps. It re-polls the provider first, so the result is current.

### disconnect_application_connector(connector_name)
Disconnects the app and removes its tools immediately. Returns `disconnected`, `removed_tools`, `remote_cleanup_failed`. Only call when the user explicitly asks to disconnect.

## Using app tools

Once a connector is active, its tools appear as native functions in SCREAMING_SNAKE_CASE (for example `GITHUB_CREATE_ISSUE`, `SLACK_SEND_MESSAGE`). Each has its own schema from Composio.

- Call them as ordinary function calls with exact, structured arguments.
- All tools of every connected app are available — there is no allowlist and no cap.
- Execute real operations only; pass real values from the user's request, never invented data.
- App tools are routed to the user's connected account; the agent never sees tokens.

## Workflow

1. Identify the app the task needs. If you do not know the exact connector name, call `list_available_application_connectors`.
2. Check whether it is already connected. If not, call `connect_applications_connectors` and tell the user to press the Connect button.
3. Confirm with `get_application_connector_status` if the result was pending or ambiguous.
4. Call the app's native tools with precise arguments to perform the work.
5. Report the real result. If an app tool fails, report the error instead of pretending it succeeded.
6. Disconnect only on explicit user request.

## Caveats

- Connector tools are live OAuth integrations: they can read from and write to the user's real accounts. Confirm intent before destructive or public actions (sending messages, deleting files, creating issues).
- Connection state persists in app state; tokens remain with Composio and are never stored locally.
- A connection can fail later (`failed` status). Re-check status before relying on it in a new session.
- `who_im` reports currently connected apps; use it for a quick inventory.
- Never fabricate tool names. Discover them from the connection result, `who_im`, or the app's native tool catalog.
