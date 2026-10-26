import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoredMessage } from "../../services/sessionStore.js";
import { buildSummarySnapshot, serializeSnapshot } from "./inputBuilder.js";

function handoff() {
  return { chatId: "chat1", handoffId: "handoff_test123" };
}

describe("summary input isolation (allowlist)", () => {
  it("includes chat data in original order without duplicates", () => {
    const messages: StoredMessage[] = [
      { role: "user", content: "Build a landing page" },
      { role: "assistant", content: "On it" },
      { role: "user", content: "Add a hero section" },
    ];
    const snap = buildSummarySnapshot(messages, handoff());
    assert.equal(snap.chatData.length, 3);
    assert.deepEqual(
      snap.chatData.map((m) => m.content),
      ["Build a landing page", "On it", "Add a hero section"],
    );
    assert.equal(snap.latestUserInput, "Add a hero section");
  });

  it("includes only the latest user input in the explicit field", () => {
    const messages: StoredMessage[] = [
      { role: "user", content: "First request" },
      { role: "assistant", content: "Working" },
      { role: "user", content: "Second request" },
      { role: "assistant", content: "Done part" },
      { role: "user", content: "Latest request here" },
    ];
    const snap = buildSummarySnapshot(messages, handoff());
    assert.equal(snap.latestUserInput, "Latest request here");
    const serialized = serializeSnapshot(snap);
    const latestSection = serialized.split("<latest_user_input>")[1]?.split("</latest_user_input>")[0] ?? "";
    assert.ok(latestSection.includes("Latest request here"));
    assert.ok(!latestSection.includes("First request"));
    assert.ok(!latestSection.includes("Second request"));
  });

  it("preserves tool-call relationships and ordering", () => {
    const messages: StoredMessage[] = [
      { role: "user", content: "List files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "file_list", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", name: "file_list", content: '{"items":[]}' },
    ];
    const snap = buildSummarySnapshot(messages, handoff());
    assert.equal(snap.toolTraffic.length, 1);
    assert.equal(snap.toolTraffic[0]?.result?.content, '{"items":[]}');
    // Tool messages remain in chat data in order.
    assert.deepEqual(snap.chatData.map((m) => m.role), ["user", "assistant", "tool"]);
  });

  it("excludes system messages and hidden reasoning", () => {
    const messages: StoredMessage[] = [
      { role: "system", content: "You are Mythgram, secret instructions" } as StoredMessage,
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi", reasoning_content: "hidden chain of thought" },
    ];
    const snap = buildSummarySnapshot(messages, handoff());
    assert.ok(snap.chatData.every((m) => m.role !== "system"));
    assert.ok(snap.chatData.every((m) => (m as { reasoning_content?: unknown }).reasoning_content === undefined));
    const serialized = serializeSnapshot(snap);
    assert.ok(!serialized.includes("secret instructions"));
    assert.ok(!serialized.includes("hidden chain of thought"));
  });

  it("excludes memory and knowledge blocks and tool traffic", () => {
    const messages: StoredMessage[] = [
      {
        role: "user",
        content:
          "<persistent_memory>\n## MEMORY.md\nsecret memory\n</persistent_memory>\n\n<knowledge_base>\nsecret kb\n</knowledge_base>\n\nReal user ask",
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "m1", type: "function", function: { name: "memory_read", arguments: "{}" } },
          { id: "k1", type: "function", function: { name: "knowledge_search", arguments: "{}" } },
          { id: "f1", type: "function", function: { name: "file_list", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "m1", name: "memory_read", content: "secret memory content" },
      { role: "tool", tool_call_id: "k1", name: "knowledge_search", content: "secret kb content" },
      { role: "tool", tool_call_id: "f1", name: "file_list", content: "ok" },
    ];
    const snap = buildSummarySnapshot(messages, handoff());
    const serialized = serializeSnapshot(snap);
    assert.ok(!serialized.includes("secret memory"));
    assert.ok(!serialized.includes("secret kb"));
    assert.ok(!serialized.includes("memory_read"));
    assert.ok(!serialized.includes("knowledge_search"));
    assert.ok(serialized.includes("file_list"));
    assert.equal(snap.latestUserInput, "Real user ask");
  });

  it("isolates the snapshot from the mutable source (no shared references)", () => {
    const messages: StoredMessage[] = [{ role: "user", content: "Original" }];
    const snap = buildSummarySnapshot(messages, handoff());
    messages[0]!.content = "MUTATED";
    assert.equal(snap.chatData[0]?.content, "Original");
    assert.equal(snap.latestUserInput, "Original");
  });

  it("handles provider-specific multimodal content without leaking images", () => {
    const messages: StoredMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        ],
      } as unknown as StoredMessage,
    ];
    const snap = buildSummarySnapshot(messages, handoff());
    const serialized = serializeSnapshot(snap);
    assert.ok(serialized.includes("Look at this"));
    assert.ok(!serialized.includes("base64,AAA"));
  });
});
