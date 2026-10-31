import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { listAvailableChannelsTool } from "./list_available_channels.js";
import { requestChannelConnectionToUserTool } from "./request_channel_connection_to_user.js";
import { disconnectChannelsTool } from "./disconnect_channels.js";
import { getChannelStatusTool } from "./get_channel_status.js";
import { sendMessageToCommunicationChannelTool } from "./send_message_to_communication_channel.js";
import {
  CHANNEL_CONNECTION_TIMEOUT_MS,
  CHANNEL_MANAGEMENT_TOOL_NAMES,
  channelCatalog,
  waitForChannelConnection,
} from "./channelManagement.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";
import type { ToolContext } from "./types.js";
import type { ChannelConnectionPublic, ChannelKind } from "../../channels/types.js";

function publicChannel(
  overrides: Partial<ChannelConnectionPublic> & { id: string; kind: ChannelKind },
): ChannelConnectionPublic {
  return {
    name: overrides.kind,
    enabled: true,
    status: "connected",
    botName: "Bot",
    botId: "1",
    activeAgentId: null,
    chatCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Minimal ChannelManager stub — only the methods the five tools touch. */
function makeManager(initial: ChannelConnectionPublic[] = []) {
  let connections = [...initial];
  return {
    listPublic(): ChannelConnectionPublic[] {
      return [...connections];
    },
    async deleteChannel(id: string): Promise<boolean> {
      const before = connections.length;
      connections = connections.filter((c) => c.id !== id);
      return connections.length < before;
    },
    async sendMessageToChannel(
      kind: ChannelKind,
      text: string,
    ): Promise<{ delivered: number; targets: string[]; errors: string[]; message: string }> {
      const targets = connections.filter((c) => c.kind === kind && c.enabled && c.status === "connected");
      if (targets.length === 0) {
        return { delivered: 0, targets: [], errors: [], message: "No connected channel.", errorCode: "channel_not_connected" } as unknown as {
          delivered: number;
          targets: string[];
          errors: string[];
          message: string;
        };
      }
      return {
        delivered: targets.length,
        targets: targets.map((c) => c.name),
        errors: [],
        message: `Sent the message to ${targets.length} ${kind} user(s) via "${text.slice(0, 20)}".`,
      };
    },
  } as unknown as import("../../channels/manager.js").ChannelManager;
}

function ctxFor(
  manager?: import("../../channels/manager.js").ChannelManager,
  extra?: Partial<ToolContext>,
): { ctx: ToolContext; events: Array<{ event: string; data: Record<string, unknown> }> } {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot: "/tmp/channel-test-workspace",
    shellTimeoutMs: 10_000,
    ...(manager ? { channelManager: manager } : {}),
    emit: (event, data) => events.push({ event, data }),
    ...extra,
  };
  return { ctx, events };
}

describe("agent-driven communication-channel management tools", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry().registerAll([
      listAvailableChannelsTool,
      requestChannelConnectionToUserTool,
      disconnectChannelsTool,
      getChannelStatusTool,
      sendMessageToCommunicationChannelTool,
    ]);
  });

  it("registers all five tools with native function schemas (zod-derived, strict)", () => {
    for (const name of CHANNEL_MANAGEMENT_TOOL_NAMES) {
      assert.ok(registry.has(name), `${name} must be registered`);
      const schema = registry.schemas.find((s) => s.function.name === name);
      assert.ok(schema, `${name} must appear in the OpenAI tools array`);
      assert.equal(schema!.type, "function");
      assert.equal(
        (schema!.function.parameters as { additionalProperties?: boolean }).additionalProperties,
        false,
        `${name} must forbid additional properties`,
      );
    }
    // Required-field contracts from the task spec.
    const requiredOf = (name: string): string[] =>
      ((registry.schemas.find((s) => s.function.name === name)!.function.parameters as { required?: string[] }).required ?? []).slice().sort();
    assert.deepEqual(requiredOf("request_channel_connection_to_user"), ["channel_name"]);
    assert.deepEqual(requiredOf("list_available_channels"), []);
    assert.deepEqual(requiredOf("disconnect_channels"), ["channel_name"]);
    assert.deepEqual(requiredOf("get_channel_status"), ["channel_name"]);
    assert.deepEqual(requiredOf("send_message_to_communication_channel"), ["channel_name", "message"]);
  });

  it("waits up to 3 minutes for the user to connect (spec timeout)", () => {
    assert.equal(CHANNEL_CONNECTION_TIMEOUT_MS, 3 * 60_000);
  });

  it("list_available_channels returns telegram, discord, slack with setup guides", async () => {
    const { ctx } = ctxFor(makeManager());
    const result = await registry.execute("list_available_channels", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { count: number; channels: Array<{ channel_name: string; setup_guide: string; description: string }> };
    assert.equal(data.count, 3);
    const names = data.channels.map((c) => c.channel_name).sort();
    assert.deepEqual(names, ["discord", "slack", "telegram"]);
    for (const channel of data.channels) {
      assert.ok(channel.setup_guide.trim().length > 0, `${channel.channel_name} must carry a setup guide`);
      assert.ok(channel.description.trim().length > 0);
    }
  });

  it("list_available_channels works without a manager (catalog only)", async () => {
    const { ctx } = ctxFor(undefined);
    const result = await registry.execute("list_available_channels", {}, ctx);
    assert.equal(result.ok, true);
    assert.equal((result.data as { count: number }).count, 3);
  });

  it("channelCatalog mirrors the Channels page (label + guide + addressing)", () => {
    const catalog = channelCatalog();
    assert.equal(catalog.length, 3);
    for (const entry of catalog) {
      assert.ok(entry.label.trim().length > 0);
      assert.ok(entry.setup_guide.trim().length > 0);
      assert.ok(entry.addressing.trim().length > 0);
    }
  });

  it("request_channel_connection_to_user rejects unknown channels", async () => {
    const { ctx } = ctxFor(makeManager());
    const result = await registry.execute("request_channel_connection_to_user", { channel_name: "whatsapp" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unknown_channel");
  });

  it("request returns immediately when the channel is already connected (no wait)", async () => {
    const manager = makeManager([publicChannel({ id: "ch_1", kind: "telegram" })]);
    const { ctx, events } = ctxFor(manager);
    const result = await registry.execute("request_channel_connection_to_user", { channel_name: "Telegram" }, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { connected: boolean; already_connected: boolean };
    assert.equal(data.connected, true);
    assert.equal(data.already_connected, true);
    assert.equal(events.find((e) => e.event === "channel_connection_request"), undefined);
  });

  it("request emits the inline configuration form with guide, then aborts fast (never hangs 3 minutes)", async () => {
    const manager = makeManager();
    const { ctx, events } = ctxFor(manager);
    const controller = new AbortController();
    controller.abort();
    const abortedCtx: ToolContext = { ...ctx, signal: controller.signal };
    const result = await registry.execute("request_channel_connection_to_user", { channel_name: "discord" }, abortedCtx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "aborted");
    const form = events.find((e) => e.event === "channel_connection_request");
    assert.ok(form, "must emit channel_connection_request so the chat UI shows the config form + guide + Connect button");
    assert.equal(form!.data.channel_name, "discord");
    assert.ok(typeof form!.data.setup_guide === "string" && (form!.data.setup_guide as string).length > 0);
    assert.ok(typeof form!.data.description === "string");
    assert.ok(typeof form!.data.addressing === "string");
  });

  it("waitForChannelConnection resolves null on timeout (user did not finish in time)", async () => {
    const manager = makeManager();
    const result = await waitForChannelConnection(manager, "slack", { timeoutMs: 30 });
    assert.equal(result, null);
  });

  it("disconnect_channels rejects unknown channels and unconfigured channels", async () => {
    const { ctx } = ctxFor(makeManager());
    const unknown = await registry.execute("disconnect_channels", { channel_name: "nope" }, ctx);
    assert.equal(unknown.ok, false);
    assert.equal((unknown.error as { code: string }).code, "unknown_channel");

    const missing = await registry.execute("disconnect_channels", { channel_name: "telegram" }, ctx);
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "channel_not_configured");
  });

  it("disconnect_channels removes every connection of that kind", async () => {
    const manager = makeManager([
      publicChannel({ id: "ch_1", kind: "telegram", name: "Main" }),
      publicChannel({ id: "ch_2", kind: "telegram", name: "Backup" }),
    ]);
    const { ctx, events } = ctxFor(manager);
    const result = await registry.execute("disconnect_channels", { channel_name: "telegram" }, ctx);
    assert.equal(result.ok, true);
    assert.equal((result.data as { disconnected_count: number }).disconnected_count, 2);
    assert.equal(manager.listPublic().length, 0);
    assert.ok(events.find((e) => e.event === "channels_updated"), "must emit channels_updated so the Channels page converges");
  });

  it("get_channel_status reports not-configured vs connected", async () => {
    const empty = ctxFor(makeManager()).ctx;
    const missing = await registry.execute("get_channel_status", { channel_name: "slack" }, empty);
    assert.equal(missing.ok, true);
    assert.equal((missing.data as { configured: boolean; connected: boolean }).configured, false);
    assert.equal((missing.data as { connected: boolean }).connected, false);

    const manager = makeManager([publicChannel({ id: "ch_1", kind: "slack", status: "connected" })]);
    const { ctx } = ctxFor(manager);
    const live = await registry.execute("get_channel_status", { channel_name: "slack" }, ctx);
    assert.equal(live.ok, true);
    const data = live.data as { configured: boolean; connected: boolean; connection_count: number };
    assert.equal(data.configured, true);
    assert.equal(data.connected, true);
    assert.equal(data.connection_count, 1);
  });

  it("get_channel_status rejects unknown channels", async () => {
    const { ctx } = ctxFor(makeManager());
    const result = await registry.execute("get_channel_status", { channel_name: "irc" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unknown_channel");
  });

  it("send_message_to_communication_channel requires a connected channel", async () => {
    const { ctx } = ctxFor(makeManager());
    const notConnected = await registry.execute(
      "send_message_to_communication_channel",
      { channel_name: "telegram", message: "hello" },
      ctx,
    );
    assert.equal(notConnected.ok, false);
    assert.equal((notConnected.error as { code: string }).code, "channel_not_connected");
  });

  it("send_message_to_communication_channel delivers via the manager", async () => {
    const manager = makeManager([publicChannel({ id: "ch_1", kind: "telegram", name: "Main" })]);
    const { ctx } = ctxFor(manager);
    const result = await registry.execute(
      "send_message_to_communication_channel",
      { channel_name: "telegram", message: "Hello from the agent" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as { delivered: number; channel_name: string };
    assert.equal(data.delivered, 1);
    assert.equal(data.channel_name, "telegram");
  });

  it("send_message rejects unknown channels", async () => {
    const { ctx } = ctxFor(makeManager());
    const result = await registry.execute(
      "send_message_to_communication_channel",
      { channel_name: "carrier-pigeon", message: "hi" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unknown_channel");
  });

  it("management tools are unavailable without a manager (sub-agent/chat context)", async () => {
    const bare: ToolContext = { workspaceRoot: "/tmp", shellTimeoutMs: 10_000 };
    const argsFor: Record<string, Record<string, unknown>> = {
      request_channel_connection_to_user: { channel_name: "telegram" },
      disconnect_channels: { channel_name: "telegram" },
      get_channel_status: { channel_name: "telegram" },
      send_message_to_communication_channel: { channel_name: "telegram", message: "hi" },
    };
    for (const name of [
      "request_channel_connection_to_user",
      "disconnect_channels",
      "get_channel_status",
      "send_message_to_communication_channel",
    ]) {
      const result = await registry.execute(name, argsFor[name]!, bare);
      assert.equal(result.ok, false, `${name} must refuse without a manager`);
      assert.equal((result.error as { code: string }).code, "channels_unavailable");
    }
  });

  it("all five tools are restricted from sub-agents (main/custom/team/CEO only)", () => {
    for (const name of CHANNEL_MANAGEMENT_TOOL_NAMES) {
      assert.ok(
        (SUB_AGENT_RESTRICTED_TOOLS as readonly string[]).includes(name),
        `${name} must be in SUB_AGENT_RESTRICTED_TOOLS`,
      );
    }
  });
});
