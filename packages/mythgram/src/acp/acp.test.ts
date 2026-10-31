import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeAcpConfig, AcpConfigManager } from "./configuration.js";
import { DEFAULT_ACP_CONFIG } from "./types.js";

describe("normalizeAcpConfig", () => {
  it("returns safe defaults for missing/garbage input", () => {
    assert.deepEqual(normalizeAcpConfig(undefined), DEFAULT_ACP_CONFIG);
    assert.deepEqual(normalizeAcpConfig(null), DEFAULT_ACP_CONFIG);
    assert.deepEqual(normalizeAcpConfig("nope"), DEFAULT_ACP_CONFIG);
    assert.deepEqual(normalizeAcpConfig([]), DEFAULT_ACP_CONFIG);
  });

  it("accepts valid values and trims strings", () => {
    const config = normalizeAcpConfig({
      enabled: false,
      mode: "team",
      teamId: "  t1  ",
      provider: "  local ",
      effort: " high ",
      contextManagementMethod: "sliding_window",
      slidingWindowTruncatePercent: 0.5,
      summaryThreshold: 0.8,
      contextLimit: 128000,
      memoryAgent: "off",
      memoryAgentInterval: 5,
      temperature: 0.4,
    });
    assert.equal(config.enabled, false);
    assert.equal(config.mode, "team");
    assert.equal(config.teamId, "t1");
    assert.equal(config.provider, "local");
    assert.equal(config.effort, "high");
    assert.equal(config.contextManagementMethod, "sliding_window");
    assert.equal(config.slidingWindowTruncatePercent, 0.5);
    assert.equal(config.summaryThreshold, 0.8);
    assert.equal(config.contextLimit, 128000);
    assert.equal(config.memoryAgent, "off");
    assert.equal(config.memoryAgentInterval, 5);
    assert.equal(config.temperature, 0.4);
  });

  it("rejects unknown enum values and clamps numerics", () => {
    const config = normalizeAcpConfig({
      mode: "bogus",
      contextManagementMethod: "bogus",
      memoryAgent: "bogus",
      slidingWindowTruncatePercent: 5,
      summaryThreshold: 3,
      memoryAgentInterval: 999,
      contextLimit: -10,
      temperature: 9,
    });
    assert.equal(config.mode, "default");
    assert.equal(config.contextManagementMethod, "inherit");
    assert.equal(config.memoryAgent, "inherit");
    assert.equal(config.slidingWindowTruncatePercent, 0.05);
    assert.equal(config.summaryThreshold, null);
    assert.equal(config.memoryAgentInterval, 50);
    assert.equal(config.contextLimit, null);
    assert.equal(config.temperature, 2);
  });
});

describe("AcpConfigManager", () => {
  it("persists and reloads a normalized document through app state", () => {
    const store = new Map<string, unknown>();
    const appState = {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
    } as unknown as import("../database/repositories/appStateRepo.js").AppStateRepo;

    const manager = new AcpConfigManager(appState);
    assert.deepEqual(manager.get(), DEFAULT_ACP_CONFIG);

    const saved = manager.save({ mode: "custom", customAgentId: "abc" });
    assert.equal(saved.mode, "custom");
    assert.equal(saved.customAgentId, "abc");
    assert.equal(manager.get().mode, "custom");
    assert.equal(manager.get().customAgentId, "abc");
  });
});
