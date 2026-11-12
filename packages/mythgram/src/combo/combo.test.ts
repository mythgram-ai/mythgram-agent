import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ChatCompletionOptions, Provider, StreamDelta } from "../agents/providers/types.js";
import {
  defaultComboSettings,
  resetActiveCombo,
  sanitizeComboSettings,
  withCombo,
  withResilience,
} from "./index.js";
import type { ComboSettings } from "./index.js";
import { defaultRetrySettings, type RetrySettings } from "../retry/index.js";

/** A mock provider that throws until its `failTimes`-th call, then succeeds. */
function mockProvider(id: string, failTimes = 0): { provider: Provider; calls: () => number } {
  let calls = 0;
  const provider: Provider = {
    metadata: { id, label: id, defaultBaseUrl: "" },
    listModels: async () => [],
    async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
      calls += 1;
      if (calls <= failTimes) throw new Error(`${id} boom ${calls}`);
      yield { text: `${id}-ok` };
    },
  };
  return { provider, calls: () => calls };
}

interface Resolvers {
  [id: string]: Provider;
}

function options(
  settings: Partial<ComboSettings>,
  resolvers: Resolvers,
  retry?: Partial<RetrySettings>,
): Parameters<typeof withCombo>[1] {
  return {
    settings,
    retry,
    providerId: "primary",
    model: "m",
    apiKey: "k",
    resolve: (entry) => {
      const provider = resolvers[entry.provider];
      if (!provider) throw new Error(`unknown provider ${entry.provider}`);
      return provider;
    },
  };
}

async function collect(provider: Provider, opts: ChatCompletionOptions = { apiKey: "k", model: "m", messages: [], tools: [] }): Promise<string> {
  let text = "";
  for await (const delta of provider.streamChatCompletion(opts)) text += delta.text ?? "";
  return text;
}

describe("combo settings", () => {
  it("defaults to combo OFF with no entries", () => {
    const s = sanitizeComboSettings(undefined);
    assert.equal(s.enabled, false);
    assert.deepEqual(s.entries, []);
    assert.deepEqual(defaultComboSettings(), { enabled: false, entries: [] });
  });

  it("drops entries without a provider and caps the chain", () => {
    const s = sanitizeComboSettings({
      enabled: "yes",
      comboId: "c1",
      entries: [{ provider: "a", model: "m1" }, { model: "no-provider" }, null, { provider: "b", model: "m2" }],
    });
    assert.equal(s.enabled, true);
    assert.equal(s.comboId, "c1");
    assert.deepEqual(
      s.entries.map((e) => e.provider),
      ["a", "b"],
    );
  });
});

describe("withCombo", () => {
  it("falls back to plain retry behavior when the combo has fewer than two entries", async () => {
    const a = mockProvider("a");
    const primary = mockProvider("primary");
    const wrapped = withCombo(primary.provider, options({ enabled: true, comboId: "solo", entries: [{ id: "1", provider: "a", model: "m", apiKey: "k" }] }, { a: a.provider }));
    await collect(wrapped);
    // The single-entry combo is not usable, so the primary (not "a") is used.
    assert.equal(primary.calls(), 1);
    assert.equal(a.calls(), 0);
  });

  it("uses the first entry and switches to the next on error without retrying the failed one", async () => {
    const a = mockProvider("a", Number.MAX_SAFE_INTEGER); // always fails
    const b = mockProvider("b"); // succeeds first try
    const combo = {
      enabled: true,
      comboId: "switch",
      entries: [
        { id: "1", provider: "a", model: "m", apiKey: "k" },
        { id: "2", provider: "b", model: "m", apiKey: "k" },
      ],
    } satisfies ComboSettings;
    resetActiveCombo();
    const wrapped = withCombo(mockProvider("primary").provider, options(combo, { a: a.provider, b: b.provider }));

    assert.equal(await collect(wrapped), "b-ok");
    assert.equal(a.calls(), 1, "first entry tried exactly once (no retry)");
    assert.equal(b.calls(), 1);

    // Core combo behavior: the failed provider is never reused on the next call.
    assert.equal(await collect(wrapped), "b-ok");
    assert.equal(a.calls(), 1, "failed provider is not reused for later calls");
    resetActiveCombo();
  });

  it("retries ONLY the last entry when every provider fails", async () => {
    const a = mockProvider("a", Number.MAX_SAFE_INTEGER);
    const b = mockProvider("b", 2); // fails twice, then succeeds
    const combo = {
      enabled: true,
      comboId: "retry-last",
      entries: [
        { id: "1", provider: "a", model: "m", apiKey: "k" },
        { id: "2", provider: "b", model: "m", apiKey: "k" },
      ],
    } satisfies ComboSettings;
    resetActiveCombo();
    const retry: Partial<RetrySettings> = {
      ...defaultRetrySettings(),
      enabled: true,
      attempts: [{ delayMs: 1 }],
      infinite: true,
      restartOnPartialStream: false,
    };
    const noSleep = async (): Promise<void> => {};
    const wrapped = withCombo(mockProvider("primary").provider, {
      ...options(combo, { a: a.provider, b: b.provider }, retry),
      sleep: noSleep,
    });

    assert.equal(await collect(wrapped), "b-ok");
    assert.equal(a.calls(), 1, "non-last entry never retries");
    assert.ok(b.calls() >= 3, "last entry retries until it succeeds");
    resetActiveCombo();
  });

  it("reports each combo advance through onCombo", async () => {
    const a = mockProvider("a", Number.MAX_SAFE_INTEGER);
    const b = mockProvider("b", Number.MAX_SAFE_INTEGER);
    const c = mockProvider("c");
    const entries = [
      { id: "1", provider: "a", model: "m", apiKey: "k" },
      { id: "2", provider: "b", model: "m", apiKey: "k" },
      { id: "3", provider: "c", model: "m", apiKey: "k" },
    ];
    const events: number[] = [];
    const wrapped = withCombo(mockProvider("primary").provider, {
      ...options({ enabled: true, comboId: "events", name: "My Combo", entries }, { a: a.provider, b: b.provider, c: c.provider }),
      onCombo: (event) => {
        events.push(event.index);
      },
    });
    assert.equal(await collect(wrapped), "c-ok");
    assert.deepEqual(events, [1, 2]);
    resetActiveCombo();
  });
});

describe("withResilience", () => {
  it("prefers an active combo over fallback (no fallback provider is used)", async () => {
    const a = mockProvider("a", Number.MAX_SAFE_INTEGER);
    const b = mockProvider("b");
    const fallbackTarget = mockProvider("fallback");
    const combo = {
      enabled: true,
      comboId: "priority",
      entries: [
        { id: "1", provider: "a", model: "m", apiKey: "k" },
        { id: "2", provider: "b", model: "m", apiKey: "k" },
      ],
    } satisfies ComboSettings;
    resetActiveCombo();
    const wrapped = withResilience(mockProvider("primary").provider, {
      combo,
      fallback: {
        enabled: true,
        method: "provider",
        providers: [{ id: "f", provider: "fallback", model: "m", apiKey: "k" }],
        apis: [],
      },
      providerId: "primary",
      model: "m",
      apiKey: "k",
      resolve: (target) => {
        if (target.provider === "a") return a.provider;
        if (target.provider === "b") return b.provider;
        if (target.provider === "fallback") return fallbackTarget.provider;
        throw new Error("unknown");
      },
    });
    assert.equal(await collect(wrapped), "b-ok");
    assert.equal(fallbackTarget.calls(), 0, "fallback is not used while a combo is active");
    resetActiveCombo();
  });
});
