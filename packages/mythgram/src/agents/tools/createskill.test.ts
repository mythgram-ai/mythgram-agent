import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { createSkillTool, MAX_SKILL_NAME_CHARS, MAX_SKILL_DESC_CHARS } from "./createskill.js";
import type { ToolContext } from "./types.js";

describe("create_skill tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(() => {
    registry = new ToolRegistry().registerAll([createSkillTool]);
  });

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-create-skill-"));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  function ctxFor(): ToolContext {
    return { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
  }

  async function seedSkillDir(dirName: string): Promise<string> {
    const dir = path.join(workspace, dirName);
    await fs.mkdir(path.join(dir, "references"), { recursive: true });
    await fs.mkdir(path.join(dir, "scripts"), { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Git Workflow\nHow to use git.\n", "utf8");
    await fs.writeFile(path.join(dir, "references", "branching.md"), "branching content", "utf8");
    await fs.writeFile(path.join(dir, "scripts", "commit.sh"), "echo commit", "utf8");
    return dir;
  }

  it("is registered and selectable by the LLM alongside existing tools", () => {
    assert.ok(registry.has("create_skill"));
    const schema = registry.schemas.find((s) => s.function.name === "create_skill");
    assert.ok(schema, "create_skill must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.name, "name property must be declared");
    assert.ok(props.description, "description property must be declared");
    assert.ok(props.source_path, "source_path property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required.sort(), ["description", "name", "source_path"]);
  });

  it("packages a source directory into a skill named by `name`, preferring SKILL.md as entry", async () => {
    await seedSkillDir("egskill");
    const result = await registry.execute(
      "create_skill",
      { name: "gitworkflow", description: "Work with Git repositories.", source_path: path.join(workspace, "egskill") },
      ctxFor(),
    );

    assert.equal(result.ok, true);
    const data = result.data as {
      created_skill: {
        name: string;
        description: string;
        skill_file: string;
        files: Array<{ path: string; content: string }>;
        enabled: boolean;
      };
      file_count: number;
      entry_file: string;
    };
    assert.ok(data.created_skill, "must return the created skill definition");
    assert.equal(data.created_skill.name, "gitworkflow");
    assert.equal(data.created_skill.description, "Work with Git repositories.");
    assert.equal(data.created_skill.enabled, true);
    // The installed skill folder is named after `name`, not the source dir.
    assert.equal(data.created_skill.skill_file, "SKILL.md");
    assert.equal(data.entry_file, "SKILL.md");
    assert.equal(data.file_count, 3);
    assert.equal(data.created_skill.files.length, 3);

    const byPath = new Map(data.created_skill.files.map((f) => [f.path, f.content]));
    assert.equal(byPath.get("SKILL.md"), "# Git Workflow\nHow to use git.\n");
    assert.equal(byPath.get("references/branching.md"), "branching content");
    assert.equal(byPath.get("scripts/commit.sh"), "echo commit");
  });

  it("errors cleanly when the source directory does not exist", async () => {
    const result = await registry.execute(
      "create_skill",
      { name: "ghost", description: "Missing dir.", source_path: path.join(workspace, "does-not-exist") },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "source_not_found");
  });

  it("errors cleanly when the source path is a file, not a directory", async () => {
    const file = path.join(workspace, "notadir.txt");
    await fs.writeFile(file, "hello", "utf8");
    const result = await registry.execute(
      "create_skill",
      { name: "file-as-skill", description: "Bad source.", source_path: file },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "source_not_directory");
  });

  it("errors cleanly when the source directory is empty", async () => {
    const empty = path.join(workspace, "empty");
    await fs.mkdir(empty, { recursive: true });
    const result = await registry.execute(
      "create_skill",
      { name: "empty-skill", description: "Empty source.", source_path: empty },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "empty_skill_source");
  });

  it("falls back to root markdown / first file when no SKILL.md is present", async () => {
    const dir = path.join(workspace, "guide");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "README.md"), "# Guide", "utf8");
    await fs.writeFile(path.join(dir, "notes.txt"), "x", "utf8");

    const first = await registry.execute(
      "create_skill",
      { name: "guide", description: "Guide skill.", source_path: dir },
      ctxFor(),
    );
    assert.equal(first.ok, true);
    assert.equal((first.data as { entry_file: string }).entry_file, "README.md");
  });

  it("prevents a source_path that escapes the workspace", async () => {
    const outside = os.tmpdir();
    const result = await registry.execute(
      "create_skill",
      { name: "escape", description: "Bad path.", source_path: path.join(outside, "something") },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    const code = (result.error as { code: string }).code;
    assert.ok(["create_skill_failed", "source_not_found"].includes(code), `unexpected code ${code}`);
  });

  it("validates args with the zod schema", () => {
    const parsed = createSkillTool.schema.parse({
      name: "mytool",
      description: "My tool.",
      source_path: "/workspace/mytool/",
    });
    assert.equal(parsed.name, "mytool");
  });

  it("rejects a missing required argument via the registry", async () => {
    const result = await registry.execute(
      "create_skill",
      { name: "x", description: "d" } as Record<string, unknown>,
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects name/description over their maximum lengths via schema validation", async () => {
    const longName = await registry.execute(
      "create_skill",
      { name: "a".repeat(MAX_SKILL_NAME_CHARS + 1), description: "d", source_path: "/x" },
      ctxFor(),
    );
    assert.equal(longName.ok, false);
    assert.equal((longName.error as { code: string }).code, "invalid_arguments");

    const longDesc = await registry.execute(
      "create_skill",
      { name: "ok", description: "d".repeat(MAX_SKILL_DESC_CHARS + 1), source_path: "/x" },
      ctxFor(),
    );
    assert.equal(longDesc.ok, false);
    assert.equal((longDesc.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects a skill name containing uppercase (capital) letters", async () => {
    await seedSkillDir("egskill");
    const source = path.join(workspace, "egskill");

    for (const badName of ["GitWorkflow", "git-Workflow", "GIT", "myTool"]) {
      const result = await registry.execute(
        "create_skill",
        { name: badName, description: "Work with Git.", source_path: source },
        ctxFor(),
      );
      assert.equal(result.ok, false, `name "${badName}" must be rejected`);
      assert.equal((result.error as { code: string }).code, "invalid_arguments");
      assert.match(
        (result.error as { message: string }).message,
        /lowercase/i,
        `error for "${badName}" should explain the lowercase rule`,
      );
    }
  });

  it("rejects skill names that skill_initialize could not initialize (spaces, underscores, symbols)", async () => {
    await seedSkillDir("egskill");
    const source = path.join(workspace, "egskill");

    for (const badName of ["git workflow", "git_workflow", "git--workflow", "-git", "git.workflow"]) {
      const result = await registry.execute(
        "create_skill",
        { name: badName, description: "Work with Git.", source_path: source },
        ctxFor(),
      );
      assert.equal(result.ok, false, `name "${badName}" must be rejected`);
      assert.equal((result.error as { code: string }).code, "invalid_arguments");
    }
  });

  it("accepts a lowercase, hyphen-separated skill name with digits", async () => {
    await seedSkillDir("egskill");
    const source = path.join(workspace, "egskill");
    const result = await registry.execute(
      "create_skill",
      { name: "git-workflow-2", description: "Work with Git.", source_path: source },
      ctxFor(),
    );
    assert.equal(result.ok, true);
    assert.equal((result.data as { created_skill: { name: string } }).created_skill.name, "git-workflow-2");
  });

  it("exposes a clear UI label", () => {
    assert.equal(createSkillTool.label({ name: "gitworkflow", description: "d", source_path: "/x" }), "Create Skill: gitworkflow");
  });
});