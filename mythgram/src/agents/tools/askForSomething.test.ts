import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  askForSomethingTool,
  ASK_FOR_SOMETHING_SUBMITTED,
  ASK_FOR_SOMETHING_REJECTED,
  ASK_FOR_SOMETHING_TIMEOUT,
  ASK_FOR_SOMETHING_CHANNEL_UNAVAILABLE,
  buildValues,
} from "./askForSomething.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";
import { AskRequestStore } from "../../services/askRequestStore.js";

/** Wait ~1 tick so a pending execute has registered its request before we answer. */
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE_ARGS = {
  items: [
    { request: "Provide your OpenAI API key.", placeholder: "sk-..." },
    { request: "Provide the database connection string.", placeholder: "postgres://user:pass@host/db" },
  ],
};

describe("ask_for_something tool", () => {
  let registry: ToolRegistry;
  let store: AskRequestStore;

  before(() => {
    registry = new ToolRegistry().registerAll([askForSomethingTool]);
    store = new AskRequestStore();
  });

  interface EmittedEvent {
    event: string;
    data: Record<string, unknown>;
  }

  type CtxWithEmit = ToolContext & { __emitted: EmittedEvent[] };

  function makeCtx(overrides: Partial<ToolContext> = {}): CtxWithEmit {
    const emitted: EmittedEvent[] = [];
    return {
      workspaceRoot: "/tmp",
      shellTimeoutMs: 10_000,
      chatId: "chat-1",
      toolCallId: "toolcall-1",
      askForSomething: store,
      askForSomethingTimeoutMs: 60_000,
      emit: (event, data) => emitted.push({ event, data }),
      ...overrides,
      __emitted: emitted,
    } as CtxWithEmit;
  }

  function emittedFor(ctx: CtxWithEmit): EmittedEvent[] {
    return ctx.__emitted;
  }

  it("is registered with a valid OpenAI function schema", () => {
    assert.ok(registry.has("ask_for_something"));
    const schema = registry.schemas.find((s) => s.function.name === "ask_for_something");
    assert.ok(schema, "ask_for_something must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    const items = params.properties.items as {
      type: string;
      minItems?: number;
      items: { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties?: boolean };
    };
    assert.equal(items.type, "array");
    assert.equal(items.minItems, 1);
    assert.equal(items.items.additionalProperties, false);
    assert.ok(items.items.properties.request);
    assert.ok(items.items.properties.placeholder);
    assert.ok(items.items.required.includes("request"));
    assert.ok(items.items.required.includes("placeholder"));
    assert.deepEqual(params.required, ["items"]);
    assert.equal(params.additionalProperties, false);
  });

  it("validates the arguments with the zod schema", () => {
    const parsed = askForSomethingTool.schema.parse(SAMPLE_ARGS);
    assert.equal(parsed.items.length, 2);
    assert.equal(parsed.items[0].placeholder, "sk-...");
  });

  it("rejects a missing items array via the registry", async () => {
    const result = await registry.execute("ask_for_something", {}, makeCtx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects an empty items array via the registry", async () => {
    const result = await registry.execute("ask_for_something", { items: [] }, makeCtx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects whitespace-only fields during execution", async () => {
    const result = await registry.execute(
      "ask_for_something",
      { items: [{ request: "  ", placeholder: "x" }] },
      makeCtx(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_items");
  });

  it("fails cleanly when run without a runtime (e.g. inside a sub-agent)", async () => {
    const result = await registry.execute(
      "ask_for_something",
      SAMPLE_ARGS,
      makeCtx({ askForSomething: undefined }),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "no_ask_runtime");
  });

  it("returns channel_unavailable on a messaging-channel turn without blocking", async () => {
    const ctx = makeCtx({
      channel: {
        kind: "telegram",
        channelId: "c1",
        channelName: "Test",
        userKey: "tg:1",
        userLabel: "User",
        sendMessage: async () => {},
        sendFiles: async () => ({ delivered: 0, errors: [] }),
      },
    });
    const result = await registry.execute("ask_for_something", SAMPLE_ARGS, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { decision: string; message: string };
    assert.equal(data.decision, "channel_unavailable");
    assert.equal(data.message, ASK_FOR_SOMETHING_CHANNEL_UNAVAILABLE);
  });

  it("emits an ask_for_something event before blocking on the user's response", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("ask_for_something", SAMPLE_ARGS, ctx);
    await tick();

    const events = emittedFor(ctx);
    const evt = events.find((e) => e.event === "ask_for_something");
    assert.ok(evt, "ask_for_something event must be emitted");
    assert.equal(evt!.data.id, "toolcall-1");
    assert.equal(evt!.data.chat_id, "chat-1");
    assert.deepEqual(evt!.data.items, SAMPLE_ARGS.items);

    store.submit("chat-1", "toolcall-1", [
      { request: SAMPLE_ARGS.items[0]!.request, value: "sk-123", rejected: false },
      { request: SAMPLE_ARGS.items[1]!.request, value: "postgres://x", rejected: false },
    ]);
    const result = await runPromise;
    assert.equal(result.ok, true);
  });

  it("returns the structured result with values when the user submits", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("ask_for_something", SAMPLE_ARGS, ctx);
    await tick();
    const values = [
      { request: SAMPLE_ARGS.items[0]!.request, value: "sk-abc", rejected: false },
      { request: SAMPLE_ARGS.items[1]!.request, value: "", rejected: true },
    ];
    assert.equal(store.submit("chat-1", "toolcall-1", values), true);
    const result = await runPromise;

    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "submitted");
    assert.equal(data.message, ASK_FOR_SOMETHING_SUBMITTED);
    const out = data.values as Array<{ request: string; value: string; rejected: boolean }>;
    assert.equal(out.length, 2);
    assert.equal(out[0]!.value, "sk-abc");
    assert.equal(out[1]!.rejected, true);
  });

  it("returns a rejected result when the user rejects all", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("ask_for_something", SAMPLE_ARGS, ctx);
    await tick();
    assert.equal(store.reject("chat-1", "toolcall-1"), true);
    const result = await runPromise;
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "rejected");
    assert.equal(data.message, ASK_FOR_SOMETHING_REJECTED);
  });

  it("continues autonomously with the timeout message when the user never responds", async () => {
    const ctx = makeCtx({ askForSomethingTimeoutMs: 30 });
    const started = Date.now();
    const result = await registry.execute("ask_for_something", SAMPLE_ARGS, ctx);
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 2000, `timeout must fire quickly, took ${elapsed}ms`);
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "timeout");
    assert.equal(data.message, ASK_FOR_SOMETHING_TIMEOUT);
    assert.equal(data.timed_out, true);
  });

  it("resolves to an aborted error when the turn is aborted while waiting", async () => {
    const controller = new AbortController();
    const ctx = makeCtx({ signal: controller.signal });
    const runPromise = registry.execute("ask_for_something", SAMPLE_ARGS, ctx);
    await tick();
    controller.abort();
    const result = await runPromise;

    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "aborted");
    assert.equal(store.submit("chat-1", "toolcall-1", []), false);
  });

  it("submit/reject on an unknown request are no-ops", () => {
    assert.equal(store.submit("chat-1", "does-not-exist", []), false);
    assert.equal(store.reject("chat-1", "does-not-exist"), false);
  });

  it("exposes a clear UI label, stable strings, and aligned buildValues", () => {
    assert.equal(askForSomethingTool.name, "ask_for_something");
    assert.equal(askForSomethingTool.label(SAMPLE_ARGS as never), "Ask for 2 items");
    assert.equal(
      askForSomethingTool.label({ items: [{ request: "a", placeholder: "b" }] } as never),
      "Ask for 1 item",
    );
    assert.ok(askForSomethingTool.description.length > 0);
    assert.match(ASK_FOR_SOMETHING_SUBMITTED, /information/i);
    assert.match(ASK_FOR_SOMETHING_REJECTED, /rejected/i);

    const items = [
      { request: "key", placeholder: "sk-..." },
      { request: "url", placeholder: "https://..." },
      { request: "id", placeholder: "123" },
    ];
    const values = buildValues(items, [
      { value: "abc" },
      { rejected: true },
      {},
    ]);
    assert.equal(values.length, 3);
    assert.deepEqual(values[0], { request: "key", value: "abc", rejected: false });
    assert.deepEqual(values[1], { request: "url", value: "", rejected: true });
    assert.deepEqual(values[2], { request: "id", value: "", rejected: false });
  });
});
