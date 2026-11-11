import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Provider, StreamDelta } from "../agents/providers/types.js";
import {
  createAbortError,
  defaultRetrySettings,
  resolveRetryDelay,
  retryMaxAttempts,
  runWithRetry,
  sanitizeRetrySettings,
  streamWithRetry,
  withRetry,
  type RetrySettings,
} from "./index.js";

/** Collects the delays the engine *would* have waited, without real waiting. */
function noSleep(log?: number[]): (ms: number) => Promise<void> {
  return async (ms: number) => {
    log?.push(ms);
  };
}

function policy(overrides: Partial<RetrySettings> = {}): RetrySettings {
  return {
    enabled: true,
    attempts: [{ delayMs: 5_000 }, { delayMs: 10_000 }],
    infinite: false,
    restartOnPartialStream: false,
    ...overrides,
  };
}

describe("retry settings", () => {
  it("defaults to retry ON with the specified 7-attempt schedule", () => {
    const s = sanitizeRetrySettings(undefined);
    assert.equal(s.enabled, true);
    assert.equal(s.infinite, true);
    assert.equal(s.restartOnPartialStream, true);
    assert.deepEqual(
      s.attempts.map((a) => a.delayMs),
      [5_000, 10_000, 15_000, 25_000, 30_000, 60_000, 120_000],
    );
  });

  it("sanitizes untrusted input and clamps delays / accepts the settings shape", () => {
    const s = sanitizeRetrySettings({
      enabled: "no",
      infinite: "yes",
      attempts: [1, "2000", { delayMs: 3_000 }, { delay_ms: 4_000 }, "bogus"],
    });
    assert.equal(s.enabled, false);
    assert.equal(s.infinite, true);
    // 1 is clamped up to the 1000ms floor; bogus is dropped.
    assert.deepEqual(
      s.attempts.map((a) => a.delayMs),
      [1_000, 2_000, 3_000, 4_000],
    );
  });

  it("resolves the schedule and reuses the last delay forever when infinite", () => {
    const s = policy({ attempts: [{ delayMs: 5_000 }, { delayMs: 10_000 }], infinite: true });
    assert.equal(resolveRetryDelay(s, 1), 5_000);
    assert.equal(resolveRetryDelay(s, 2), 10_000);
    assert.equal(resolveRetryDelay(s, 3), 10_000);
    assert.equal(retryMaxAttempts(s), null);

    const finite = policy({ infinite: false });
    assert.equal(resolveRetryDelay(finite, 3), null);
    assert.equal(retryMaxAttempts(finite), 2);
  });
});

describe("runWithRetry", () => {
  it("retries until the operation succeeds and reports each wait", async () => {
    const waits: number[] = [];
    const events: number[] = [];
    let calls = 0;
    const result = await runWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`boom ${calls}`);
        return "ok";
      },
      {
        settings: policy(),
        sleep: noSleep(waits),
        onRetry: (event) => {
          events.push(event.attempt);
        },
      },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [5_000, 10_000]);
    assert.deepEqual(events, [1, 2]);
  });

  it("rethrows the last error once a finite policy is exhausted", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        runWithRetry(
          async () => {
            calls += 1;
            throw new Error("always fails");
          },
          { settings: policy({ infinite: false }), sleep: noSleep() },
        ),
      /always fails/,
    );
    // initial attempt + 2 retries
    assert.equal(calls, 3);
  });

  it("retries indefinitely when infinite", async () => {
    let calls = 0;
    const result = await runWithRetry(
      async () => {
        calls += 1;
        if (calls < 12) throw new Error("flaky");
        return calls;
      },
      { settings: policy({ infinite: true }), sleep: noSleep() },
    );
    assert.equal(result, 12);
  });

  it("does not retry when disabled", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        runWithRetry(
          async () => {
            calls += 1;
            throw new Error("nope");
          },
          { settings: policy({ enabled: false }) },
        ),
      /nope/,
    );
    assert.equal(calls, 1);
  });

  it("stops and throws an AbortError once the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => runWithRetry(async () => "never", { settings: policy(), signal: controller.signal }),
      (error: Error) => error.name === "AbortError",
    );
    assert.equal(createAbortError().name, "AbortError");
  });
});

describe("streamWithRetry", () => {
  async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const item of gen) out.push(item);
    return out;
  }

  it("retries a failed stream and yields the successful attempt", async () => {
    let calls = 0;
    const deltas = await collect(
      streamWithRetry(
        async function* () {
          calls += 1;
          if (calls === 1) throw new Error("stream blew up");
          yield { text: "a" };
          yield { text: "b" };
        },
        { settings: policy(), sleep: noSleep() },
      ),
    );
    assert.equal(calls, 2);
    assert.deepEqual(deltas, [{ text: "a" }, { text: "b" }]);
  });

  it("surfaces the error on a partial stream when restartOnPartialStream is off", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        collect(
          streamWithRetry(
            async function* () {
              calls += 1;
              yield { text: "partial" } as StreamDelta;
              throw new Error("died mid-stream");
            },
            { settings: policy({ restartOnPartialStream: false }), sleep: noSleep() },
          ),
        ),
      /died mid-stream/,
    );
    assert.equal(calls, 1);
  });

  it("retries a partial stream when restartOnPartialStream is on", async () => {
    let calls = 0;
    const deltas = await collect(
      streamWithRetry(
        async function* () {
          calls += 1;
          if (calls === 1) {
            yield { text: "partial" };
            throw new Error("died mid-stream");
          }
          yield { text: "full-answer" };
        },
        { settings: policy({ restartOnPartialStream: true }), sleep: noSleep() },
      ),
    );
    assert.equal(calls, 2);
    assert.deepEqual(deltas, [{ text: "partial" }, { text: "full-answer" }]);
  });
});

describe("withRetry (provider wrapper)", () => {
  function flakyProvider(failures: number): { provider: Provider; calls: () => number } {
    let calls = 0;
    const provider: Provider = {
      metadata: { id: "flaky", label: "Flaky", defaultBaseUrl: "" },
      async listModels() {
        return [];
      },
      async *streamChatCompletion() {
        calls += 1;
        if (calls <= failures) throw new Error(`failure ${calls}`);
        yield { text: "ok" } as StreamDelta;
      },
    };
    return { provider, calls: () => calls };
  }

  it("returns the original provider untouched when retries are disabled", () => {
    const { provider } = flakyProvider(0);
    const wrapped = withRetry(provider, { settings: policy({ enabled: false }) });
    assert.equal(wrapped, provider);
  });

  it("retries streaming requests and preserves metadata", async () => {
    const { provider, calls } = flakyProvider(2);
    const wrapped = withRetry(provider, { settings: policy(), sleep: noSleep() });
    assert.equal(wrapped.metadata.id, "flaky");
    const out: StreamDelta[] = [];
    for await (const d of wrapped.streamChatCompletion({
      apiKey: "",
      model: "m",
      messages: [],
      tools: [],
    })) {
      out.push(d);
    }
    assert.equal(calls(), 3);
    assert.deepEqual(out, [{ text: "ok" }]);
  });

  it("does not expose chatCompletion when the inner provider lacks it", () => {
    const { provider } = flakyProvider(0);
    const wrapped = withRetry(provider, { settings: policy(), sleep: noSleep() });
    assert.equal(typeof wrapped.chatCompletion, "undefined");
  });

  it("wraps and retries chatCompletion when present", async () => {
    let calls = 0;
    const provider: Provider = {
      metadata: { id: "p", label: "P", defaultBaseUrl: "" },
      async listModels() {
        return [];
      },
      async *streamChatCompletion() {
        yield { text: "x" } as StreamDelta;
      },
      async chatCompletion() {
        calls += 1;
        if (calls < 2) throw new Error("non-stream fail");
        return { text: "done", reasoning: "", toolCalls: [], finishReason: "stop" };
      },
    };
    const wrapped = withRetry(provider, { settings: policy(), sleep: noSleep() });
    const result = await wrapped.chatCompletion!({ apiKey: "", model: "m", messages: [], tools: [] });
    assert.equal(calls, 2);
    assert.equal(result.text, "done");
  });
});

describe("defaultRetrySettings", () => {
  it("returns a deep copy so callers cannot mutate the shared defaults", () => {
    const a = defaultRetrySettings();
    a.attempts[0]!.delayMs = 1;
    assert.equal(defaultRetrySettings().attempts[0]!.delayMs, 5_000);
  });
});
