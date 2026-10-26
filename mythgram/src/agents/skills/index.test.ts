import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  DEFAULT_SKILLS_ROOT,
  loadDefaultSkills,
  mergeDefaultSkills,
} from "./index.js";
import type { SkillDefinition } from "../tools/types.js";

const EXPECTED_SKILLS = [
  "code-architect",
  "code-reviewer",
  "debugger",
  "deep-researcher",
  "information-analyst",
  "integration-builder",
  "planner",
  "problem-solver",
  "professional-writer",
  "refactoring-expert",
  "task-executor",
];

describe("default skills", () => {
  it("loads the built-in default skills from the skills folder", async () => {
    const skills = await loadDefaultSkills();

    assert.ok(skills.length >= EXPECTED_SKILLS.length, `expected at least ${EXPECTED_SKILLS.length} default skills, got ${skills.length}`);

    const names = skills.map((s) => s.name).sort();
    for (const expected of EXPECTED_SKILLS) {
      assert.ok(names.includes(expected), `missing default skill: ${expected}`);
    }
  });

  it("every default skill has a valid name, a description, and a non-empty SKILL.md", async () => {
    const skills = await loadDefaultSkills();
    assert.ok(skills.length > 0);

    for (const skill of skills) {
      assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad name: ${skill.name}`);
      assert.ok(skill.description.length > 0, `${skill.name} has no description`);
      assert.equal(skill.enabled, true, `${skill.name} should be enabled`);
      assert.ok(skill.skillFile.length > 0, `${skill.name} has no entry file`);

      const entry = skill.files.find(
        (f) => f.path.toLowerCase() === skill.skillFile.toLowerCase(),
      );
      assert.ok(entry, `${skill.name} entry file missing from files`);
      assert.ok(entry!.content.includes("#"), `${skill.name} SKILL.md appears empty`);
    }
  });

  it("honors the frontmatter name and description", async () => {
    const skills = await loadDefaultSkills();
    const reviewer = skills.find((s) => s.name === "code-reviewer");
    assert.ok(reviewer, "code-reviewer should be present");
    assert.match(reviewer!.description, /review/i);
  });

  it("each default skill is distinct (unique names) and exposes its entry file first", async () => {
    const skills = await loadDefaultSkills();
    const names = skills.map((s) => s.name);
    assert.equal(new Set(names).size, names.length, "skill names must be unique");

    for (const skill of skills) {
      const paths = skill.files.map((f) => f.path);
      const entryIndex = paths.indexOf(skill.skillFile);
      assert.ok(entryIndex !== -1, `${skill.name} entry file must be listed in files`);
      assert.ok(paths.includes("SKILL.md"), `${skill.name} should contain a SKILL.md`);
    }
  });

  it("mergeDefaultSkills keeps defaults, lets user skills override by name, and allows disable", async () => {
    const defaults: SkillDefinition[] = [
      {
        name: "debugger",
        description: "default debugger",
        skillFile: "SKILL.md",
        files: [{ path: "SKILL.md", content: "# debugger" }],
        enabled: true,
      },
      {
        name: "code-architect",
        description: "default architect",
        skillFile: "SKILL.md",
        files: [{ path: "SKILL.md", content: "# architect" }],
        enabled: true,
      },
    ];

    const userSkills: SkillDefinition[] = [
      {
        name: "debugger",
        description: "user debugger overrides default",
        skillFile: "SKILL.md",
        files: [{ path: "SKILL.md", content: "# user debugger" }],
        enabled: false,
      },
      {
        name: "moon-sync",
        description: "brand new user skill",
        skillFile: "SKILL.md",
        files: [{ path: "SKILL.md", content: "# moon" }],
        enabled: true,
      },
    ];

    const merged = mergeDefaultSkills(defaults, userSkills);
    assert.deepEqual(merged.map((s) => s.name).sort(), [
      "code-architect",
      "debugger",
      "moon-sync",
    ]);

    const debuggerSkill = merged.find((s) => s.name === "debugger")!;
    assert.equal(debuggerSkill.enabled, false, "user skill should override default");
    assert.equal(debuggerSkill.description, "user debugger overrides default");

    const architect = merged.find((s) => s.name === "code-architect")!;
    assert.equal(architect.description, "default architect", "default kept when user has none");
  });

  it("DEFAULT_SKILLS_ROOT is a directory", async () => {
    const stats = await fs.stat(DEFAULT_SKILLS_ROOT);
    assert.ok(stats.isDirectory());
  });
});