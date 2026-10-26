import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { listSkillsTool } from "./list_skills.js";
import { skillInitializeTool } from "./skill_initialize.js";
import { createSkillTool } from "./createskill.js";
import { createSkillRuntime } from "../skills.js";
import type { SkillDefinition, SkillRuntime, ToolContext } from "./types.js";

function makeSkills(): SkillDefinition[] {
  return [
    {
      name: "git-workflow",
      description: "Work with Git repositories",
      skillFile: "SKILL.md",
      files: [
        { path: "SKILL.md", content: "# Git Workflow\nHow to use git." },
        { path: "references/branching.md", content: "branching" },
        { path: "scripts/commit.sh", content: "echo commit" },
      ],
      enabled: true,
    },
    {
      name: "notion",
      description: "Work with Notion",
      // Renamed entry file (user changed SKILL.md -> GUIDE.md).
      skillFile: "GUIDE.md",
      files: [
        { path: "GUIDE.md", content: "# Notion" },
        { path: "references/pages.md", content: "pages" },
      ],
      enabled: true,
    },
    {
      name: "disabled-skill",
      description: "Should be hidden",
      skillFile: "SKILL.md",
      files: [{ path: "SKILL.md", content: "hidden" }],
      enabled: false,
    },
  ];
}

describe("skills tools", () => {
  let workspace: string;
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().registerAll([listSkillsTool, skillInitializeTool]);
  });

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-skills-"));
  });

  after(async () => {
    // best-effort cleanup handled per-test below
  });

  function ctxFor(skills: SkillDefinition[]): ToolContext {
    return {
      workspaceRoot: workspace,
      shellTimeoutMs: 10_000,
      skills: createSkillRuntime(skills),
    };
  }

  it("list_skills returns only enabled skills with file trees", async () => {
    const result = await registry.execute("list_skills", {}, ctxFor(makeSkills()));
    assert.equal(result.ok, true);
    const data = result.data as { count: number; skills: Array<Record<string, unknown>> };
    assert.equal(data.count, 2);
    const names = data.skills.map((s) => s.name);
    assert.deepEqual(names.sort(), ["git-workflow", "notion"]);

    const git = data.skills.find((s) => s.name === "git-workflow")!;
    assert.equal(git.skill_file, "SKILL.md");
    // Entry file first, then the rest sorted alphabetically.
    assert.deepEqual(git.files, [
      "SKILL.md",
      "references/branching.md",
      "scripts/commit.sh",
    ]);
    assert.match(String(git.tree), /git-workflow\//);
    assert.match(String(git.tree), /SKILL\.md/);
    assert.match(String(git.tree), /references\//);
  });

  it("skill_initialize creates .mythgram/skills and writes all files, returning relative paths", async () => {
    const result = await registry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["git-workflow", "notion"] },
      ctxFor(makeSkills()),
    );
    assert.equal(result.ok, true);
    const data = result.data as {
      success: boolean;
      initialized: Array<{ skill_name: string; path: string; skill_file: string; files: string[] }>;
      failed: unknown[];
    };
    assert.equal(data.success, true);
    assert.equal(data.failed.length, 0);
    assert.equal(data.initialized.length, 2);

    const git = data.initialized.find((s) => s.skill_name === "git-workflow")!;
    assert.equal(git.path, ".mythgram/skills/git-workflow");
    assert.equal(git.skill_file, ".mythgram/skills/git-workflow/SKILL.md");

    // Files actually exist on disk.
    const skillMd = await fs.readFile(
      path.join(workspace, ".mythgram", "skills", "git-workflow", "SKILL.md"),
      "utf8",
    );
    assert.match(skillMd, /# Git Workflow/);
    const branching = await fs.readFile(
      path.join(workspace, ".mythgram", "skills", "git-workflow", "references", "branching.md"),
      "utf8",
    );
    assert.equal(branching, "branching");

    // Renamed entry file is honored.
    const notion = data.initialized.find((s) => s.skill_name === "notion")!;
    assert.equal(notion.skill_file, ".mythgram/skills/notion/GUIDE.md");
    await fs.readFile(path.join(workspace, ".mythgram", "skills", "notion", "GUIDE.md"), "utf8");

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("skill_initialize reports already-initialized skills in failed[] without throwing", async () => {
    const skills = makeSkills();
    const first = await registry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["git-workflow"] },
      ctxFor(skills),
    );
    assert.equal((first.data as { success: boolean }).success, true);

    const second = await registry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["git-workflow"] },
      ctxFor(skills),
    );
    assert.equal(second.ok, true);
    const data = second.data as {
      success: boolean;
      initialized: unknown[];
      failed: Array<{ skill_name: string; error: string }>;
    };
    assert.equal(data.success, false);
    assert.equal(data.initialized.length, 0);
    assert.equal(data.failed.length, 1);
    assert.equal(data.failed[0].skill_name, "git-workflow");
    assert.match(data.failed[0].error, /already initialized/i);

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("skill_initialize reports unknown/disabled skills in failed[]", async () => {
    const result = await registry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["does-not-exist", "notion"] },
      ctxFor(makeSkills()),
    );
    assert.equal(result.ok, true);
    const data = result.data as {
      success: boolean;
      initialized: Array<{ skill_name: string }>;
      failed: Array<{ skill_name: string; error: string }>;
    };
    assert.equal(data.success, false);
    assert.equal(data.initialized.length, 1);
    assert.equal(data.initialized[0].skill_name, "notion");
    assert.equal(data.failed.length, 1);
    assert.equal(data.failed[0].skill_name, "does-not-exist");

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("skill_initialize rejects invalid skill name patterns via schema validation", async () => {
    const result = await registry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["Not Valid Name"] },
      ctxFor(makeSkills()),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("skill_initialize rejects duplicate skill names via schema validation", async () => {
    const result = await registry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["notion", "notion"] },
      ctxFor(makeSkills()),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("a skill created with create_skill can be initialized in the SAME turn", async () => {
    // Registry with all three tools, as the main agent has.
    const fullRegistry = new ToolRegistry().registerAll([
      createSkillTool,
      listSkillsTool,
      skillInitializeTool,
    ]);

    // A single shared skill runtime for the whole turn (starts with no user skills).
    const runtime: SkillRuntime = createSkillRuntime([]);
    const ctx: ToolContext = { workspaceRoot: workspace, shellTimeoutMs: 10_000, skills: runtime };

    // Author the skill's source directory on disk.
    const source = path.join(workspace, "src-skill");
    await fs.mkdir(path.join(source, "references"), { recursive: true });
    await fs.writeFile(path.join(source, "SKILL.md"), "# Deploy\nHow to deploy.", "utf8");
    await fs.writeFile(path.join(source, "references", "steps.md"), "steps", "utf8");

    // 1) create_skill
    const created = await fullRegistry.execute(
      "create_skill",
      { name: "deploy-helper", description: "Helps deploy.", source_path: source },
      ctx,
    );
    assert.equal(created.ok, true, "create_skill should succeed");

    // 2) list_skills must now surface the freshly created skill (same turn, same runtime).
    const listed = await fullRegistry.execute("list_skills", {}, ctx);
    const listData = listed.data as { skills: Array<{ name: string }> };
    assert.ok(
      listData.skills.some((s) => s.name === "deploy-helper"),
      "list_skills should include the newly created skill",
    );

    // 3) skill_initialize must find and materialize it — this is the reported bug.
    const initialized = await fullRegistry.execute(
      "skill_initialize",
      { file_path: workspace, skill_names: ["deploy-helper"] },
      ctx,
    );
    assert.equal(initialized.ok, true);
    const initData = initialized.data as {
      success: boolean;
      initialized: Array<{ skill_name: string }>;
      failed: Array<{ skill_name: string; error: string }>;
    };
    assert.equal(initData.success, true, `expected success, got failures: ${JSON.stringify(initData.failed)}`);
    assert.equal(initData.initialized.length, 1);
    assert.equal(initData.initialized[0].skill_name, "deploy-helper");

    // Files actually landed on disk.
    const md = await fs.readFile(
      path.join(workspace, ".mythgram", "skills", "deploy-helper", "SKILL.md"),
      "utf8",
    );
    assert.match(md, /# Deploy/);

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("list_skills returns an empty list when no skill runtime is present", async () => {
    const result = await registry.execute("list_skills", {}, {
      workspaceRoot: workspace,
      shellTimeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { skills: unknown[] }).skills, []);

    await fs.rm(workspace, { recursive: true, force: true });
  });
});
