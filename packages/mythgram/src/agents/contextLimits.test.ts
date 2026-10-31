import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistry } from "./providers/registry.js";
import { OpenAICompatibleProvider } from "./providers/base.js";
import type { ProviderModel } from "./providers/types.js";
import {
  catalogContextLimit,
  clearContextLimitCache,
  manualContextLimit,
  manualLimitKey,
  resolveServerContextLimit,
} from "./contextLimits.js";

/** Registry stub whose catalog is fully scripted (no network). */
function registryWith(models: ProviderModel[] | Error, calls: { count: number }): ProviderRegistry {
  const provider = new OpenAICompatibleProvider({ id: "p", label: "P", defaultBaseUrl: "http://x" });
  provider.listModels = async () => {
    calls.count += 1;
    if (models instanceof Error) throw models;
    // Never-resolving catalog entries are simulated by the caller via timeoutMs tests.
    return models;
  };
  return new ProviderRegistry().register(provider);
}

function model(id: string, context_window: number | null): ProviderModel {
  return {
    id,
    provider: "p",
    label: id,
    owned_by: null,
    context_window,
    max_output_tokens: null,
    pricing: null,
    description: null,
    capabilities: null,
  };
}

describe("server-side context limits (channels/schedules summarization)", () => {
  beforeEach(() => {
    clearContextLimitCache();
  });

  it("manual Settings entry wins without touching the catalog", async () => {
    const calls = { count: 0 };
    const limit = await resolveServerContextLimit({
      providers: registryWith([model("m", 1000)], calls),
      provider: "p",
      model: "m",
      apiKey: "k",
      manualLimits: { [manualLimitKey("p", "m")]: 77_000 },
    });
    assert.equal(limit, 77_000);
    assert.equal(calls.count, 0);
  });

  it("rejects malformed manual entries and falls through to the catalog", async () => {
    const calls = { count: 0 };
    const limit = await resolveServerContextLimit({
      providers: registryWith([model("m", 32_000)], calls),
      provider: "p",
      model: "m",
      apiKey: "k",
      manualLimits: { [manualLimitKey("p", "m")]: "128k" },
    });
    assert.equal(limit, 32_000);
    assert.equal(calls.count, 1);
  });

  it("manualContextLimit validates bounds and keying", () => {
    assert.equal(manualContextLimit({ "p::m": 128_000 }, "p", "m"), 128_000);
    assert.equal(manualContextLimit({ "p::m": 999 }, "p", "m"), null);
    assert.equal(manualContextLimit({ "p::m": 1.5 }, "p", "m"), null);
    assert.equal(manualContextLimit({ "p::m": 2_000_000_000 }, "p", "m"), null);
    assert.equal(manualContextLimit(null, "p", "m"), null);
    assert.equal(manualContextLimit({}, "", "m"), null);
    assert.equal(manualContextLimit({}, "p", ""), null);
  });

  it("resolves the catalog window and matches case-insensitively", async () => {
    const calls = { count: 0 };
    const first = await catalogContextLimit({
      providers: registryWith([model("GPT-4o", 128_000)], calls),
      provider: "p",
      model: "gpt-4o",
      apiKey: "k",
    });
    assert.equal(first, 128_000);
    // Second call is served from cache (no second lookup).
    const second = await catalogContextLimit({
      providers: registryWith([model("gpt-4o", 1)], calls),
      provider: "p",
      model: "gpt-4o",
      apiKey: "k",
    });
    assert.equal(second, 128_000);
    assert.equal(calls.count, 1);
  });

  it("returns null (handoff disabled) when the catalog is unreachable or windowless", async () => {
    const failing = { count: 0 };
    assert.equal(
      await catalogContextLimit({
        providers: registryWith(new Error("down"), failing),
        provider: "p",
        model: "m",
        apiKey: "k",
      }),
      null,
    );
    const windowless = { count: 0 };
    assert.equal(
      await catalogContextLimit({
        providers: registryWith([model("m", null)], windowless),
        provider: "unknown-provider",
        model: "m",
        apiKey: "k",
      }),
      null,
    );
    // Unknown provider id resolves to null without throwing.
    assert.equal(failing.count, 1);
  });

  it("never triggers network for empty provider/model", async () => {
    const calls = { count: 0 };
    const providers = registryWith([model("m", 10)], calls);
    assert.equal(await catalogContextLimit({ providers, provider: "", model: "m", apiKey: "k" }), null);
    assert.equal(await catalogContextLimit({ providers, provider: "p", model: "", apiKey: "k" }), null);
    assert.equal(await resolveServerContextLimit({ providers, provider: "", model: "", apiKey: "k" }), null);
    assert.equal(calls.count, 0);
  });

  it("times out a hanging catalog lookup instead of stalling the turn", async () => {
    const calls = { count: 0 };
    const hanging = new OpenAICompatibleProvider({ id: "p", label: "P", defaultBaseUrl: "http://x" });
    hanging.listModels = async () => {
      calls.count += 1;
      await new Promise(() => {
        // never settles — the timeout must win
      });
      return [];
    };
    const providers = new ProviderRegistry().register(hanging);
    const limit = await catalogContextLimit({ providers, provider: "p", model: "m", apiKey: "k", timeoutMs: 20 });
    assert.equal(limit, null);
    assert.equal(calls.count, 1);
  });
});
