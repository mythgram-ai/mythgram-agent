import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { submitPlanTool, SUBMIT_PLAN_APPROVED, SUBMIT_PLAN_CANCELED, SUBMIT_PLAN_EDITED, SUBMIT_PLAN_TIMEOUT } from "./submit_plan.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";
import { PlanApprovalStore } from "../../services/planApprovalStore.js";

/** Wait ~1 tick so a pending execute has registered its plan before we decide. */
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("submit_plan tool", () => {
  let registry: ToolRegistry;
  let store: PlanApprovalStore;

  before(() => {
    registry = new ToolRegistry().registerAll([submitPlanTool]);
    store = new PlanApprovalStore();
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
      planApprovals: store,
      planApprovalTimeoutMs: 60_000,
      emit: (event, data) => emitted.push({ event, data }),
      ...overrides,
      __emitted: emitted,
    } as CtxWithEmit;
  }

  function emittedFor(ctx: CtxWithEmit): EmittedEvent[] {
    return ctx.__emitted;
  }

  it("is registered and selectable by the LLM alongside existing tools", () => {
    assert.ok(registry.has("submit_plan"));
    const schema = registry.schemas.find((s) => s.function.name === "submit_plan");
    assert.ok(schema, "submit_plan must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.plan, "plan property must be declared");
    assert.ok((props.plan as { type?: string }).type, "plan.type");
    const required = schema!.function.parameters.required as string[];
    assert.ok(required.includes("plan"), "plan must be required");
  });

  it("validates the plan argument with the zod schema", () => {
    const parsed = submitPlanTool.schema.parse({ plan: "build the app" });
    assert.equal(parsed.plan, "build the app");
  });

  it("rejects a missing plan via the registry", async () => {
    const ctx = makeCtx();
    const result = await registry.execute("submit_plan", {} as Record<string, unknown>, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects an empty plan during execution", async () => {
    const ctx = makeCtx();
    const result = await registry.execute("submit_plan", { plan: "   " }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "empty_plan");
  });

  it("fails cleanly when run without a plan-approval runtime (e.g. inside a sub-agent)", async () => {
    const ctx = makeCtx({ planApprovals: undefined });
    const result = await registry.execute("submit_plan", { plan: "some plan" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "no_plan_approval_store");
  });

  it("emits a plan_review SSE event before blocking on the user's decision", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("submit_plan", { plan: "review me" }, ctx);
    await tick();

    const events = emittedFor(ctx);
    assert.ok(events.length > 0, "must emit at least one event");
    const review = events.find((e) => e.event === "plan_review");
    assert.ok(review, "plan_review event must be emitted");
    assert.equal(review!.data.id, "toolcall-1");
    assert.equal(review!.data.chat_id, "chat-1");
    assert.equal(review!.data.plan, "review me");

    await store.decide("chat-1", "toolcall-1", "approved");
    const result = await runPromise;
    assert.equal(result.ok, true);
  });

  it("returns the approved message and structured result when the user approves", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("submit_plan", { plan: "step by step plan" }, ctx);
    await tick();
    assert.equal(store.decide("chat-1", "toolcall-1", "approved"), true);
    const result = await runPromise;

    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "approved");
    assert.equal(data.message, SUBMIT_PLAN_APPROVED);
    assert.equal(data.plan, "step by step plan");
    assert.equal(data.approved, true);
    assert.equal(data.tool, "submit_plan");
  });

  it("returns the canceled message with a retry hint when the user cancels", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("submit_plan", { plan: "not good enough" }, ctx);
    await tick();
    assert.equal(store.decide("chat-1", "toolcall-1", "canceled"), true);
    const result = await runPromise;

    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "canceled");
    assert.equal(data.message, SUBMIT_PLAN_CANCELED);
    assert.equal(data.approved, false);
  });

  it("returns the modified plan and 'approved with modifications' message when the user edits", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("submit_plan", { plan: "original plan" }, ctx);
    await tick();
    const revised = "a revised and improved plan with milestones";
    assert.equal(store.decide("chat-1", "toolcall-1", "edited", revised), true);
    const result = await runPromise;

    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "edited");
    assert.equal(data.message, SUBMIT_PLAN_EDITED);
    assert.equal(data.plan, revised);
    assert.equal(data.approved, true);
  });

  it("continues independently with the timeout message when the user never responds", async () => {
    const ctx = makeCtx({ planApprovalTimeoutMs: 30 });
    const started = Date.now();
    const result = await registry.execute("submit_plan", { plan: "no user around" }, ctx);
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 2000, `timeout must fire quickly, took ${elapsed}ms`);
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "timeout");
    assert.equal(data.message, SUBMIT_PLAN_TIMEOUT);
    assert.equal(data.timed_out, true);
    assert.equal(data.approved, false);
  });

  it("returns a no-op (ok:false) for a decision on a plan that is not pending", () => {
    assert.equal(store.decide("chat-1", "does-not-exist", "approved"), false);
    assert.equal(store.decide("chat-1", "toolcall-1", "approved"), false, "already decided");
  });

  it("resolves to an aborted error when the turn is aborted while waiting", async () => {
    const controller = new AbortController();
    const ctx = makeCtx({ signal: controller.signal });
    const runPromise = registry.execute("submit_plan", { plan: "abort me" }, ctx);
    await tick();
    controller.abort();
    const result = await runPromise;

    assert.equal(result.ok, false);
    const error = result.error as { code: string };
    assert.equal(error.code, "aborted");
    // The pending entry must have been cleaned up.
    assert.equal(store.decide("chat-1", "toolcall-1", "approved"), false);
  });

  it("does not throw and returns a valid ToolResult for every decision path", async () => {
    const results = await Promise.all([
      (async () => {
        const c = makeCtx();
        // Give each run its own toolCallId so the store keys don't collide.
        c.toolCallId = "t-approve";
        const p = registry.execute("submit_plan", { plan: "p" }, c);
        await tick();
        store.decide("chat-1", "t-approve", "approved");
        return p;
      })(),
      (async () => {
        const c = makeCtx();
        c.toolCallId = "t-cancel";
        const p = registry.execute("submit_plan", { plan: "p" }, c);
        await tick();
        store.decide("chat-1", "t-cancel", "canceled");
        return p;
      })(),
      (async () => {
        const c = makeCtx();
        c.toolCallId = "t-edit";
        const p = registry.execute("submit_plan", { plan: "p" }, c);
        await tick();
        store.decide("chat-1", "t-edit", "edited", "new plan");
        return p;
      })(),
    ]);

    for (const result of results) {
      assert.equal(typeof result.ok, "boolean");
      if (result.ok) assert.ok(result.data);
      assert.deepEqual(Object.keys(result).sort(), ["data", "ok"]);
    }
  });

  it("exposes stable result strings and a clear UI label", () => {
    assert.equal(submitPlanTool.name, "submit_plan");
    assert.equal(submitPlanTool.label({ plan: "anything" }), "Submit Plan");
    assert.ok(submitPlanTool.description.length > 0);
    assert.match(SUBMIT_PLAN_APPROVED, /approved/i);
    assert.match(SUBMIT_PLAN_CANCELED, /canceled/i);
    assert.match(SUBMIT_PLAN_EDITED, /modified/i);
    assert.match(SUBMIT_PLAN_TIMEOUT, /time out/i);
  });
});