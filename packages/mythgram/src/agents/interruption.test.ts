import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERRUPTED_TOOL_RESULT, pushPartialAssistant, repairInterruptedToolCalls } from "./interruption.js";

test("pushPartialAssistant keeps streamed text and skips empty output", () => {
  const messages: Array<{ role: string; content?: unknown; reasoning_content?: string }> = [];
  pushPartialAssistant(messages, ["  "], []);
  assert.equal(messages.length, 0);
  pushPartialAssistant(messages, ["Hello ", "wor"], ["think"]);
  assert.deepEqual(messages, [{ role: "assistant", content: "Hello wor", reasoning_content: "think" }]);
});

test("repairInterruptedToolCalls fills unanswered tool calls", () => {
  const messages = [
    { role: "user", content: "go" },
    { role: "assistant", content: null, tool_calls: [{ id: "a" }, { id: "b" }] },
    { role: "tool", tool_call_id: "a", content: "{}" },
    { role: "user", content: "Continue" },
  ];
  const repaired = repairInterruptedToolCalls(messages);
  assert.equal(repaired.length, 5);
  assert.deepEqual(repaired[3], { role: "tool", tool_call_id: "b", content: INTERRUPTED_TOOL_RESULT });
  assert.equal(repaired[4]!.role, "user");
  assert.equal(messages.length, 4, "original transcript is untouched");
});

test("repairInterruptedToolCalls leaves complete transcripts unchanged", () => {
  const messages = [
    { role: "assistant", content: null, tool_calls: [{ id: "a" }] },
    { role: "tool", tool_call_id: "a", content: "{}" },
    { role: "assistant", content: "done" },
  ];
  assert.deepEqual(repairInterruptedToolCalls(messages), messages);
});
