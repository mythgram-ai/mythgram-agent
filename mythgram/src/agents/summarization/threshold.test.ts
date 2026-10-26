import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeThreshold,
  shouldTriggerSummarization,
  utilizationOf,
} from "./threshold.js";
import { DEFAULT_SUMMARY_THRESHOLD } from "./types.js";

describe("summarization threshold", () => {
  it("uses 90% as the default threshold", () => {
    assert.equal(DEFAULT_SUMMARY_THRESHOLD, 0.9);
    assert.equal(normalizeThreshold(undefined), 0.9);
    assert.equal(normalizeThreshold(""), 0.9);
    assert.equal(normalizeThreshold(NaN), 0.9);
  });

  it("computes utilization below 90% as no trigger", () => {
    assert.equal(utilizationOf(89_999, 100_000), 0.89999);
    assert.equal(shouldTriggerSummarization(89_999, 100_000), false);
    assert.equal(shouldTriggerSummarization(50_000, 200_000), false);
  });

  it("triggers at exactly 90%", () => {
    assert.equal(shouldTriggerSummarization(90_000, 100_000), true);
    assert.equal(shouldTriggerSummarization(9_000, 10_000), true);
  });

  it("triggers above 90% and when already exceeded", () => {
    assert.equal(shouldTriggerSummarization(95_000, 100_000), true);
    assert.equal(shouldTriggerSummarization(150_000, 100_000), true);
    assert.equal(shouldTriggerSummarization(200_000, 128_000), true);
  });

  it("supports different model context-window capacities", () => {
    assert.equal(shouldTriggerSummarization(115_200, 128_000), true);
    assert.equal(shouldTriggerSummarization(100_000, 128_000), false);
    assert.equal(shouldTriggerSummarization(180_000, 200_000), true);
    assert.equal(shouldTriggerSummarization(7_200, 8_000), true);
  });

  it("never triggers on unavailable token counts or limits", () => {
    assert.equal(shouldTriggerSummarization(undefined, 100_000), false);
    assert.equal(shouldTriggerSummarization(null, 100_000), false);
    assert.equal(shouldTriggerSummarization(90_000, null), false);
    assert.equal(shouldTriggerSummarization(90_000, undefined), false);
    assert.equal(shouldTriggerSummarization(90_000, 0), false);
    assert.equal(shouldTriggerSummarization(-1, 100_000), false);
    assert.equal(utilizationOf(undefined, 100_000), null);
    assert.equal(utilizationOf(90_000, null), null);
  });

  it("accepts a configurable threshold and rejects invalid values", () => {
    assert.equal(shouldTriggerSummarization(80_000, 100_000, { threshold: 0.8 }), true);
    assert.equal(shouldTriggerSummarization(79_999, 100_000, { threshold: 0.8 }), false);
    assert.equal(normalizeThreshold(0), DEFAULT_SUMMARY_THRESHOLD);
    assert.equal(normalizeThreshold(1.5), DEFAULT_SUMMARY_THRESHOLD);
    assert.equal(normalizeThreshold("0.75"), 0.75);
  });
});
