import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUMMARY_REQUEST_PROMPT_FILE,
  SUMMARY_SYSTEM_PROMPT_FILE,
  clearPromptCache,
  loadSummaryRequestPrompt,
  loadSummarySystemPrompt,
} from "./prompts.js";

describe("summarization prompt files", () => {
  it("loads the exact system prompt file without modification", () => {
    clearPromptCache();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.join(here, "prompts", SUMMARY_SYSTEM_PROMPT_FILE), "utf8");
    assert.equal(loadSummarySystemPrompt(), raw);
    assert.ok(raw.includes("context summary agent"));
    // Second load returns the identical cached value.
    assert.equal(loadSummarySystemPrompt(), raw);
  });

  it("loads the exact request prompt file without modification", () => {
    clearPromptCache();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.join(here, "prompts", SUMMARY_REQUEST_PROMPT_FILE), "utf8");
    assert.equal(loadSummaryRequestPrompt(), raw);
    assert.ok(raw.includes("Permitted snapshot follows"));
    assert.equal(loadSummaryRequestPrompt(), raw);
  });
});
