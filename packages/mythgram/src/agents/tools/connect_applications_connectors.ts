import { z } from "zod";
import { getConnector, COMPOSIO_DEFAULT_USER_ID } from "../connectors/index.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  CONNECTOR_CONNECTION_TIMEOUT_MS,
  attachConnectorToTurn,
  connectorCatalog,
  connectorError,
  emitConnectorConnectRequired,
  emitConnectorsUpdated,
  normalizeConnectorName,
  publicConnection,
  requireComposioClient,
  requireConnectorManager,
  validConnectorNames,
  waitForConnectorConnection,
} from "./connectorManagement.js";

const schema = z
  .object({
    connector_name: z
      .string()
      .trim()
      .min(1, "A connector name is required.")
      .describe(
        "The exact name of the application connector to connect. Use a connector name returned by list_available_application_connectors.",
      ),
  })
  .strict();

type ConnectConnectorArgs = z.infer<typeof schema>;

/**
 * connect_applications_connectors — ask the USER to authorize an app, then make its
 * tools usable immediately.
 *
 * The backend opens the Composio OAuth link session itself (so no browser round-trip
 * through the REST API is needed), persists the pending connection, and emits
 * `connector_connect_required` so the chat UI renders a Connect button inside this
 * tool's block. The call then blocks up to 3 minutes polling Composio, and on success
 * attaches the connector's FULL native tool catalog to the live turn — so the very next
 * model iteration can already call e.g. `GITHUB_CREATE_ISSUE` as a real function call.
 */
export const connectApplicationsConnectorsTool = defineTool({
  name: "connect_applications_connectors",
  description:
    "Request the user to connect an application connector. Use this tool when an application connector is required but is not currently connected. The tool triggers the user-facing connection flow and displays a Connect button for the specified application. Before calling this tool, use list_available_application_connectors if you do not already know the exact connector name. The user must complete the connection flow.",
  schema,
  label: (args: ConnectConnectorArgs) => {
    const connector = normalizeConnectorName(args.connector_name);
    const label = connector ? (getConnector(connector)?.name ?? connector) : "";
    return label ? `Connect app: ${label}` : "Connect application connector";
  },
  async execute(args: ConnectConnectorArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireConnectorManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.connectorManager!;

    const connectorId = normalizeConnectorName(args.connector_name);
    if (!connectorId) {
      return {
        ok: false,
        error: {
          code: "unknown_connector",
          message:
            `Unknown application connector "${args.connector_name}". ` +
            `Available connectors: ${validConnectorNames()}. ` +
            "Call list_available_application_connectors to see them, then retry with one of those exact names.",
        },
      };
    }
    const entry = connectorCatalog().find((c) => c.connector_name === connectorId)!;
    const definition = getConnector(connectorId)!;

    const client = requireComposioClient(ctx);
    if (!client) {
      return {
        ok: false,
        error: {
          code: "composio_key_missing",
          message:
            "Application connectors are not configured: no Composio API key is set. " +
            "Ask the user to add one in Settings → Composio, then retry — or guide them to the Connectors page to connect the app manually.",
        },
      };
    }

    // Already authorized: never make the user redo the flow. Just make sure the app's
    // tools are live on this turn (a reconnect may have happened since it was built).
    const existing = manager.get(connectorId);
    if (existing?.status === "active") {
      const attached = await attachConnectorToTurn(ctx, connectorId, existing.connectedAccountId);
      emitConnectorsUpdated(ctx, manager);
      return {
        ok: true,
        data: {
          ...publicConnection(existing),
          connector_name: connectorId,
          label: entry.label,
          already_connected: true,
          connected: true,
          tool_count: attached.attached,
          tools: attached.tools,
          message:
            `${entry.label} is already connected` +
            (existing.accountLabel ? ` (${existing.accountLabel})` : "") +
            `. Its ${attached.attached} app tool(s) are available to you right now — ` +
            "call them as real function calls, no further connection needed.",
        },
      };
    }

    // Start the OAuth session: resolve (or create) the toolkit's auth config, open the
    // Composio link, and persist the pending connection before asking the user to act.
    let link;
    try {
      const authConfig = (await client.findAuthConfig(definition.toolkitSlug)) ??
        (await client.createAuthConfig(definition.toolkitSlug));
      link = await client.createLink(authConfig.id, COMPOSIO_DEFAULT_USER_ID);
    } catch (error) {
      const code = (error as { code?: string }).code;
      return connectorError(
        typeof code === "string" && code.startsWith("composio_") ? code : "connector_connect_failed",
        error,
      );
    }
    manager.upsertPending(connectorId, link.connectedAccountId);
    emitConnectorsUpdated(ctx, manager);

    // Surface the Connect button, then block for the user's authorization.
    emitConnectorConnectRequired(ctx, entry, link);
    ctx.emit?.("status", {
      state: "waiting",
      label: `Waiting for authorization — connect ${entry.label}…`,
    });

    const outcome = await waitForConnectorConnection(manager, client, connectorId, {
      timeoutMs: CONNECTOR_CONNECTION_TIMEOUT_MS,
      signal: ctx.signal,
    });

    if (outcome.status === "aborted" || ctx.signal?.aborted) {
      return {
        ok: false,
        error: {
          code: "aborted",
          message: `The ${entry.label} connection request was aborted. The connection is saved — the user can finish it from the Connectors page.`,
        },
      };
    }

    if (outcome.status === "failed") {
      emitConnectorsUpdated(ctx, manager);
      return {
        ok: false,
        error: {
          code: "connector_connect_failed",
          message:
            `Could not connect ${entry.label}: ${outcome.message} ` +
            "Ask the user to try connecting it again (press Connect, or use the Connectors page).",
        },
      };
    }

    if (outcome.status === "pending") {
      return {
        ok: true,
        data: {
          connector_name: connectorId,
          label: entry.label,
          connected: false,
          connect_pending: true,
          message:
            `The user has not finished authorizing ${entry.label} within 3 minutes. ` +
            `The connection is saved and shows a Connect button in this block and on the Connectors page — ` +
            `ask the user to press Connect, then call get_application_connector_status with connector_name "${connectorId}" ` +
            `to confirm; its app tools become usable on your next turn.`,
        },
      };
    }

    // Connected — attach the app's FULL tool catalog to the live turn so the agent can
    // use it immediately, not on the next chat turn.
    const attached = await attachConnectorToTurn(ctx, connectorId, outcome.connection.connectedAccountId);
    emitConnectorsUpdated(ctx, manager);
    return {
      ok: true,
      data: {
        ...publicConnection(outcome.connection),
        connector_name: connectorId,
        label: entry.label,
        connected: true,
        tool_count: attached.attached,
        tools: attached.tools,
        message:
          `${entry.label} is now connected (${attached.attached} native app tool(s) attached to this conversation). ` +
          "Call them as real function calls with exact arguments whenever the task touches this app — " +
          "no further setup is needed.",
      },
    };
  },
});
