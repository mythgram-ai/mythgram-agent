import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { connectorCatalog, publicConnection, requireConnectorManager } from "./connectorManagement.js";

const schema = z.object({}).strict();

/**
 * list_available_application_connectors — the discovery entry point for the whole
 * connector surface. The model must learn the exact connector name here before any of
 * the other three tools can be called with it.
 */
export const listAvailableApplicationConnectorsTool = defineTool({
  name: "list_available_application_connectors",
  description:
    "List all application connectors that are available to connect. Use this tool when you need to know which application connectors are supported or when you need the exact connector name before calling connect_applications_connectors. The returned connector names should be used exactly as provided.",
  schema,
  label: () => "List available app connectors",
  async execute(_args: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireConnectorManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.connectorManager!;

    const catalog = connectorCatalog();
    const connectors = catalog.map((entry) => {
      const connection = publicConnection(manager.get(entry.connector_name));
      return {
        ...entry,
        status: String(connection.status),
        connected: connection.connected === true,
        requires_user_action: connection.requires_user_action === true,
        account_label: String(connection.account_label ?? ""),
      };
    });
    const connectedCount = connectors.filter((c) => c.connected).length;

    return {
      ok: true,
      data: {
        count: connectors.length,
        connected_count: connectedCount,
        connectors,
        message:
          `${connectors.length} application connector(s) available (${connectedCount} connected): ` +
          `${connectors.map((c) => c.connector_name).join(", ")}. ` +
          "Use a connector_name exactly as returned to connect_applications_connectors, " +
          "disconnect_application_connector, or get_application_connector_status.",
      },
    };
  },
});
