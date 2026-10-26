import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exact prompt-file loading for the summary agent.
 *
 * The two source files are used verbatim — never rewritten, paraphrased, or
 * templated here. Callers append the filtered snapshot after the request prompt.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(HERE, "prompts");

export const SUMMARY_SYSTEM_PROMPT_FILE = "summary_agent_system-prompt.md";
export const SUMMARY_REQUEST_PROMPT_FILE = "summar_request_prompt.md";

let cachedSystem: string | null = null;
let cachedRequest: string | null = null;

/** Exact contents of summary_agent_system-prompt.md (verbatim). */
export function loadSummarySystemPrompt(): string {
  if (cachedSystem !== null) return cachedSystem;
  const abs = path.join(PROMPTS_DIR, SUMMARY_SYSTEM_PROMPT_FILE);
  cachedSystem = fs.readFileSync(abs, "utf8");
  return cachedSystem;
}

/** Exact contents of summar_request_prompt.md (verbatim). */
export function loadSummaryRequestPrompt(): string {
  if (cachedRequest !== null) return cachedRequest;
  const abs = path.join(PROMPTS_DIR, SUMMARY_REQUEST_PROMPT_FILE);
  cachedRequest = fs.readFileSync(abs, "utf8");
  return cachedRequest;
}

/** Test hook: clear the cached file contents. */
export function clearPromptCache(): void {
  cachedSystem = null;
  cachedRequest = null;
}
