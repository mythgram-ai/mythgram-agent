import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { waitTool, WAIT_MIN_SECONDS, WAIT_MAX_SECONDS } from "./wait.js";
import type { ToolContext } from "./types.js";

function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: "/tmp",
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

describe("wait tool", () => {
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().registerAll([waitTool]);
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("wait"));
    const schema = registry.schemas.find((s) => s.function.name === "wait");
    assert.ok(schema, "wait must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.seconds, "seconds property must be declared");
    assert.equal(props.seconds.type, "integer");
    assert.equal(props.seconds.minimum, WAIT_MIN_SECONDS);
    assert.equal(props.seconds.maximum, WAIT_MAX_SECONDS);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["seconds"]);
  });

  it("waits for the requested duration and reports it", async () => {
    const start = Date.now();
    const result = await registry.execute("wait", { seconds: 1 }, ctxFor());
    const elapsed = Date.now() - start;
    assert.equal(result.ok, true);
    const data = result.data as { waited_seconds: number; message: string };
    assert.equal(data.waited_seconds, 1);
    assert.ok(elapsed >= 950, `expected to wait ~1s, waited ${elapsed}ms`);
    assert.match(data.message, /Waited 1 second/);
  });

  it("rejects a duration below the minimum", async () => {
    const result = await registry.execute("wait", { seconds: 0 }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("rejects a duration above the maximum (3 minutes)", async () => {
    const result = await registry.execute("wait", { seconds: 181 }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("rejects a non-integer duration", async () => {
    const result = await registry.execute("wait", { seconds: 1.5 }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("returns immediately with an aborted error when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    const result = await registry.execute("wait", { seconds: 10 }, ctxFor({ signal: controller.signal }));
    const elapsed = Date.now() - start;
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "aborted");
    assert.ok(elapsed < 500, `expected an immediate return, took ${elapsed}ms`);
  });

  it("resolves early with an aborted error when the signal fires mid-wait", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = registry.execute("wait", { seconds: 30 }, ctxFor({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    const elapsed = Date.now() - start;
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "aborted");
    assert.ok(elapsed < 5000, `expected an early return on abort, took ${elapsed}ms`);
  });

  it("produces a readable UI label", () => {
    assert.equal(registry.label("wait", { seconds: 5 }), "Wait 5 seconds");
    assert.equal(registry.label("wait", { seconds: 1 }), "Wait 1 second");
  });
});
