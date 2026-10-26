import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { deleteSkillTool, DELETE_DEFAULT_SKILL_ERROR } from "./delete_skill.js";
import type {
  SkillDefinition,
  SkillInitializeResult,
  SkillRuntime,
  ToolContext,
} from "./types.js";

/** A minimal SkillRuntime whose only exercised surface is `definitions`. */
function makeRuntime(definitions: SkillDefinition[]): SkillRuntime {
  return {
    definitions,
    list: () => [],
    register: (skill) => {
      definitions.push(skill);
    },
    initialize: async (): Promise<SkillInitializeResult> => ({
      success: true,
      initialized: [],
      failed: [],
    }),
  };
}

const USER_SKILLS: SkillDefinition[] = [
  { name: "myskill", description: "A user skill", skillFile: "SKILL.md", files: [] },
  { name: "Reporter", description: "Writes reports", skillFile: "SKILL.md", files: [] },
];

function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: "/tmp",
    shellTimeoutMs: 10_000,
    skills: makeRuntime(USER_SKILLS),
    ...overrides,
  };
}

describe("delete_skill tool", () => {
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().registerAll([deleteSkillTool]);
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("delete_skill"));
    const schema = registry.schemas.find((s) => s.function.name === "delete_skill");
    assert.ok(schema, "delete_skill must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.skill_name, "skill_name property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["skill_name"]);
  });

  it("deletes an existing user-defined skill by exact name", async () => {
    const result = await registry.execute("delete_skill", { skill_name: "myskill" }, ctxFor());
    assert.equal(result.ok, true);
    const data = result.data as { deleted_skill: string; message: string };
    assert.equal(data.deleted_skill, "myskill");
    assert.match(data.message, /Deleted skill/);
  });

  it("matches the registered name case-insensitively and returns its canonical name", async () => {
    const result = await registry.execute("delete_skill", { skill_name: "reporter" }, ctxFor());
    assert.equal(result.ok, true);
    assert.equal((result.data as { deleted_skill: string }).deleted_skill, "Reporter");
  });

  it("refuses to delete a built-in default skill", async () => {
    const result = await registry.execute("delete_skill", { skill_name: "debugger" }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "cannot_delete_default_skill");
    assert.equal(result.error?.message, DELETE_DEFAULT_SKILL_ERROR);
  });

  it("refuses to delete a default skill regardless of casing", async () => {
    const result = await registry.execute("delete_skill", { skill_name: "Code-Architect" }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.message, DELETE_DEFAULT_SKILL_ERROR);
  });

  it("returns an error when the skill does not exist", async () => {
    const result = await registry.execute("delete_skill", { skill_name: "ghost" }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "unknown_skill");
  });

  it("rejects an empty name via schema validation", async () => {
    const result = await registry.execute("delete_skill", { skill_name: "   " }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("fails cleanly when there is no skill runtime (sub-agent context)", async () => {
    const result = await registry.execute(
      "delete_skill",
      { skill_name: "myskill" },
      ctxFor({ skills: undefined }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "registry_unavailable");
  });

  it("produces a readable UI label", () => {
    assert.equal(registry.label("delete_skill", { skill_name: "myskill" }), "Delete Skill: myskill");
  });
});
