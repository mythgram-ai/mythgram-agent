import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  connectorError,
  detachConnectorFromTurn,
  emitConnectorsUpdated,
  normalizeConnectorName,
  requireComposioClient,
  requireConnectorManager,
  validConnectorNames,
} from "./connectorManagement.js";

const schema = z
  .object({
    connector_name: z
      .string()
      .trim()
      .min(1, "A connector name is required.")
      .describe(
        "The exact name of the application connector to disconnect. Use a connector name returned by list_available_application_connectors.",
      ),
  })
  .strict();

type DisconnectConnectorArgs = z.infer<typeof schema>;

/**
 * disconnect_application_connector — remove an app the user no longer wants connected.
 *
 * The remote Composio account is deleted first (best effort — a stale remote account
 * harms nothing, so a provider failure never blocks the local removal), the record is
 * dropped, and the app's native tools are detached from the live turn so the agent can
 * no longer call them in the same conversation.
 */
export const disconnectApplicationConnectorTool = defineTool({
  name: "disconnect_application_connector",
  description:
    "Disconnect an application connector that is currently connected. Use this tool when the user wants to remove an application's connection or when you need to disconnect a connected application. Before calling this tool, use list_available_application_connectors if you do not already know the exact connector name.",
  schema,
  label: (args: DisconnectConnectorArgs) => {
    const name = typeof args.connector_name === "string" ? args.connector_name.trim() : "";
    return name ? `Disconnect app: ${name}` : "Disconnect application connector";
  },
  async execute(args: DisconnectConnectorArgs, ctx: ToolContext): Promise<ToolResult> {
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

    const stored = manager.get(connectorId);
    if (!stored) {
      return {
        ok: false,
        error: {
          code: "connector_not_connected",
          message:
            `The application connector "${connectorId}" is not connected, so there is nothing to disconnect. ` +
            `Use get_application_connector_status with connector_name "${connectorId}" to check its current state.`,
        },
      };
    }

    // Best-effort remote cleanup: a stale Composio account cannot be exploited by us, so
    // a provider failure must not stop the user from revoking the connection locally.
    const client = requireComposioClient(ctx);
    let remoteError = "";
    if (client) {
      try {
        await client.deleteConnectedAccount(stored.connectedAccountId);
      } catch (error) {
        remoteError = connectorError("connector_remote_delete_failed", error).error?.message ?? "";
      }
    }

    const removed = manager.remove(connectorId);
    const detached = detachConnectorFromTurn(ctx, connectorId);
    emitConnectorsUpdated(ctx, manager);

    return {
      ok: true,
      data: {
        connector_name: connectorId,
        disconnected: removed,
        removed_tools: detached,
        remote_cleanup_failed: remoteError.length > 0,
        message:
          `The application connector "${connectorId}" is now disconnected` +
          (detached > 0 ? ` and its ${detached} app tool(s) are no longer available in this conversation.` : ".") +
          (remoteError
            ? " Note: the provider-side authorization could not be revoked automatically — the user may want to remove the app access from their account settings."
            : ""),
      },
    };
  },
});
