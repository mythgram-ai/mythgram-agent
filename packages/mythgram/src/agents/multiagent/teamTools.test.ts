import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../tools/index.js";
import { allowedTeamAgentTools, allowedCeoAgentTools } from "../tools/teamTools.js";
import { buildHeadSystemPrompt, buildMemberSystemPrompt } from "./systemprompt.js";
import { buildCeoSystemPrompt } from "./ceo/systemprompt.js";
import { CHAT_MODE_TOOLS, buildChatSystemPrompt } from "../chat.js";
import { listCustomAgentTools } from "../customagent/loader.js";
import type { AgentTeamDefinition } from "./types.js";
import type { CeoAgentDefinition } from "./ceo/types.js";

/**
 * Regression guard for the image generation tool's reach across every agent surface. The generate_image
 * tool is wired into the shared ToolContext for the Main Agent, Custom Agents, team/CEO agents, chat
 * mode, and sub-agents; these tests assert it is both GRANTED (in the allowed-tool sets / chat surface
 * / custom-agent catalog) and DOCUMENTED (in every system prompt that describes its tools), so an agent
 * outside the Main Agent actually learns it can generate images.
 */
const team: AgentTeamDefinition = {
  id: "t1",
  name: "Image Team",
  leader_name: "Lead",
  leader_system_prompt: "Lead the team.",
  members: [{ name: "Artist", description: "generates visuals", system_prompt: "Make visuals." }],
};

const ceo: CeoAgentDefinition = {
  id: "ceo1",
  name: "Vera",
  description: "The CEO",
  system_prompt: "Run the organization.",
  teams: [team],
};

describe("generate_image availability across agent surfaces", () => {
  const registry = createToolRegistry();
  const names = registry.names();

  it("is a registered tool", () => {
    assert.ok(names.includes("generate_image"));
  });

  it("is granted to team leaders and members", () => {
    assert.ok(allowedTeamAgentTools(names, "leader", false).includes("generate_image"));
    assert.ok(allowedTeamAgentTools(names, "member", false).includes("generate_image"));
  });

  it("is granted to the CEO, leaders, and members of a CEO system", () => {
    assert.ok(allowedCeoAgentTools(names, "ceo", false).includes("generate_image"));
    assert.ok(allowedCeoAgentTools(names, "leader", false).includes("generate_image"));
    assert.ok(allowedCeoAgentTools(names, "member", false).includes("generate_image"));
  });

  it("is granted in chat mode", () => {
    assert.ok(CHAT_MODE_TOOLS.includes("generate_image"));
  });

  it("is selectable for a Custom Agent", () => {
    const catalog = listCustomAgentTools(registry).map((t) => t.name);
    assert.ok(catalog.includes("generate_image"));
  });

  it("is documented in the leader, member, and CEO system prompts", () => {
    assert.match(buildHeadSystemPrompt(team, "/tmp/ws", false), /generate_image/);
    assert.match(buildMemberSystemPrompt(team.members[0]!, team, "/tmp/ws", false), /generate_image/);
    assert.match(buildCeoSystemPrompt(ceo, [team], "/tmp/ws"), /generate_image/);
  });

  it("is documented in the chat-mode system prompt", () => {
    assert.match(buildChatSystemPrompt(), /generate_image/);
  });
});
