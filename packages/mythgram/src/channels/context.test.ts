import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { MythgramDatabase } from "../database/index.js";
import { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import { resolveChannelRunContext } from "./context.js";

const config = {
  port: 0,
  workspaceRoot: "",
  maxIterations: 1000,
  corsOrigins: "*",
  shellTimeoutMs: 10_000,
  planApprovalTimeoutMs: 60_000,
  questionTimeoutMs: 180_000,
  searchProvider: "duckduckgo",
  fetchProvider: "builtin",
  tavilyApiKey: "",
  exaApiKey: "",
  serpapiApiKey: "",
  firecrawlApiKey: "",
  composioApiKey: "",
  visionModelPatterns: [],
  textOnlyModelPatterns: [],
  memoryAgentEnabled: true,
  memoryAgentInterval: 3,
  summaryThreshold: 0.9,
} as AppConfig;

describe("channel run context carries summarization limits", () => {
  let dir: string | null = null;
  let db: MythgramDatabase | null = null;
  afterEach(() => {
    try {
      db?.close();
    } catch {
      // ignore
    }
    try {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    dir = null;
    db = null;
  });

  it("resolves the manual Settings limit synchronously for channel turns", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "channels-ctx-"));
    db = MythgramDatabase.open(dir);
    db.appState.set("settings", {
      provider: "openrouter",
      model: "x/model",
      apiKeys: { openrouter: "k" },
      manualContextLimits: { "openrouter::x/model": 200_000 },
    });
    const ctx = resolveChannelRunContext(db, config, new MainAgentPromptManager(db.appState));
    assert.equal(ctx.provider, "openrouter");
    assert.equal(ctx.model, "x/model");
    assert.equal(ctx.contextLimit, 200_000);
    assert.equal(ctx.summaryThreshold, 0.9);
  });

  it("leaves the limit null (handoff disabled) when nothing configures it", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "channels-ctx-"));
    db = MythgramDatabase.open(dir);
    db.appState.set("settings", { provider: "openrouter", model: "x/model", apiKeys: { openrouter: "k" } });
    const ctx = resolveChannelRunContext(db, config, new MainAgentPromptManager(db.appState));
    assert.equal(ctx.contextLimit, null);
    assert.equal(ctx.summaryThreshold, 0.9);
  });
});
