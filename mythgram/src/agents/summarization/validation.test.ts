import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFinalSummary } from "./validation.js";
import { MIN_SUMMARY_CHARS } from "./types.js";

describe("final summary validation", () => {
  it("accepts a real complete summary", () => {
    const text = "Goal: build X. Done: files a/b. Verified via tests. Next: deploy.";
    const result = validateFinalSummary(text);
    assert.equal(result.ok, true);
    assert.equal(result.summary, text.trim());
  });

  it("rejects empty summaries (never a false success)", () => {
    for (const bad of ["", "   ", "\n\t ", null, undefined, 42]) {
      const result = validateFinalSummary(bad);
      assert.equal(result.ok, false);
      assert.equal(result.code, "summary_empty");
    }
  });

  it("rejects trivially short summaries", () => {
    const result = validateFinalSummary("ok");
    assert.equal(result.ok, false);
    assert.equal(result.code, "summary_too_short");
    assert.ok((result.message ?? "").includes(String(MIN_SUMMARY_CHARS)));
  });
});
