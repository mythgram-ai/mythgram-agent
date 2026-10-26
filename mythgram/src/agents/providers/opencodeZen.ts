import { randomUUID } from "node:crypto";
import { OpenAICompatibleProvider } from "./base.js";

/**
 * OpenCode Zen is OpenAI-compatible for the request/response shape, but its gateway
 * classifies any request that is MISSING the official opencode CLI headers as an
 * anonymous/free client and rate-limits it (HTTP 429 `FreeUsageLimitError`) — even when
 * the API key has paid credits. To be recognized as an authenticated client we must send
 * the same identifying headers the opencode CLI sends:
 *   - User-Agent: opencode/<channel>/<version>/cli
 *   - x-opencode-client: cli
 *   - x-opencode-session / x-opencode-project: stable ids for the client lifetime
 *   - x-opencode-request: a fresh id per request
 */
const OPENCODE_USER_AGENT = "opencode/latest/1.3.15/cli";

// Stable for the lifetime of this process, mimicking one long-lived CLI session/project.
const SESSION_ID = `ses_${randomId()}`;
const PROJECT_ID = `prj_${randomId()}`;

class OpenCodeZenProvider extends OpenAICompatibleProvider {
  protected override headers(apiKey: string): Record<string, string> {
    return {
      ...super.headers(apiKey),
      "User-Agent": OPENCODE_USER_AGENT,
      "x-opencode-client": "cli",
      "x-opencode-session": SESSION_ID,
      "x-opencode-project": PROJECT_ID,
      "x-opencode-request": `req_${randomId()}`,
    };
  }
}

function randomId(): string {
  return randomUUID().replace(/-/g, "");
}

export const opencodeZenProvider = new OpenCodeZenProvider({
  id: "opencode_zen",
  label: "OpenCode Zen",
  defaultBaseUrl: "https://opencode.ai/zen/v1",
});
