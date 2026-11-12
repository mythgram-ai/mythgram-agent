import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  connectorCatalog,
  effectiveStatus,
  emitConnectorsUpdated,
  normalizeConnectorName,
  publicConnection,
  refreshConnectorStatus,
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
        "The exact name of the application connector whose current status should be retrieved. Use a connector name returned by list_available_application_connectors.",
      ),
  })
  .strict();

type GetConnectorStatusArgs = z.infer<typeof schema>;

/**
 * get_application_connector_status — the authoritative "can I use this app right now?"
 * check. The stored status is re-polled from Composio first, so a connection the user
 * just finished authorizing in the browser is reported as connected immediately
 * instead of as still-pending.
 */
export const getApplicationConnectorStatusTool = defineTool({
  name: "get_application_connector_status",
  description:
    "Get the current status of an application connector. Use this tool to determine whether a connector is connected, disconnected, enabled, disabled, or requires user action. Before calling this tool, use list_available_application_connectors if you do not already know the exact connector name.",
  schema,
  label: (args: GetConnectorStatusArgs) => {
    const connectorId = normalizeConnectorName(args.connector_name);
    return connectorId ? `App connector status: ${connectorId}` : "Get app connector status";
  },
  async execute(args: GetConnectorStatusArgs, ctx: ToolContext): Promise<ToolResult> {
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
    const client = requireComposioClient(ctx);
    const entry =
      (await connectorCatalog(client)).find((c) => c.connector_name === connectorId) ?? {
        connector_name: connectorId,
        label: connectorId,
        description: "",
        homepage: "",
        toolkit: connectorId,
      };

    const refreshed = await refreshConnectorStatus(manager, client, connectorId);
    if (refreshed) emitConnectorsUpdated(ctx, manager);

    const status = effectiveStatus(refreshed);
    const connected = status === "connected";

    return {
      ok: true,
      data: {
        connector_name: connectorId,
        label: entry.label,
        description: entry.description,
        homepage: entry.homepage,
        available: true,
        status,
        connected,
        enabled: connected,
        disabled: status === "failed",
        requires_user_action: status === "requires_user_action",
        tools_usable: connected,
        connection: refreshed ? publicConnection(refreshed) : null,
        message:
          status === "connected"
            ? `${entry.label} is connected and its app tools are usable — call them as real function calls.`
            : status === "requires_user_action"
              ? `${entry.label} has a connection request waiting on the user — they still need to authorize it. ` +
                `Ask them to press Connect (the button is in this block and on the Connectors page), then re-check with get_application_connector_status using connector_name "${connectorId}".`
              : status === "failed"
                ? `The ${entry.label} connection failed and is disabled. ` +
                  `Ask the user to reconnect it with connect_applications_connectors using connector_name "${connectorId}".`
                : `${entry.label} is not connected. ` +
                  `Use connect_applications_connectors with connector_name "${connectorId}" to ask the user to connect it.`,
      },
    };
  },
});
