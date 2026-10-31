import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { globTool, MAX_GLOB_MATCHES } from "./glob.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("glob tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-glob-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(globTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content = "x\n"): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return abs;
  }

  async function run(args: Record<string, unknown>) {
    return registry.execute("glob", args, ctx);
  }

  it("finds files matching a recursive pattern", async () => {
    await writeFile("src/a.ts", "a\n");
    await writeFile("src/nested/b.ts", "b\n");
    await writeFile("src/c.js", "c\n");
    const result = await run({ pattern: "**/*.ts" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as string[];
    assert.ok(matches.includes("src/a.ts"), `expected src/a.ts in ${JSON.stringify(matches)}`);
    assert.ok(matches.includes("src/nested/b.ts"), `expected src/nested/b.ts in ${JSON.stringify(matches)}`);
    assert.ok(!matches.includes("src/c.js"), "should not match .js files");
    assert.equal(data.match_count, matches.length);
    assert.equal(data.pattern, "**/*.ts");
  });

  it("matches bare extensions at any depth", async () => {
    await writeFile("pkg.json", "{}\n");
    await writeFile("nested/deep/inner.json", "{}\n");
    const result = await run({ pattern: "*.json" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as string[];
    assert.ok(matches.includes("pkg.json"));
    assert.ok(matches.includes("nested/deep/inner.json"));
  });

  it("supports brace expansion", async () => {
    await writeFile("brace/x.ts", "x\n");
    await writeFile("brace/y.tsx", "y\n");
    await writeFile("brace/z.js", "z\n");
    const result = await run({ pattern: "brace/*.{ts,tsx}" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as string[];
    assert.ok(matches.includes("brace/x.ts"));
    assert.ok(matches.includes("brace/y.tsx"));
    assert.ok(!matches.includes("brace/z.js"));
  });

  it("searches within a subdirectory when path is given", async () => {
    await writeFile("sub/only.md", "sub\n");
    await writeFile("top.md", "top\n");
    const subAbs = path.join(workspace, "sub");
    const result = await run({ pattern: "**/*.md", path: subAbs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as string[];
    assert.ok(matches.includes("sub/only.md"), `expected sub/only.md in ${JSON.stringify(matches)}`);
    assert.ok(!matches.includes("top.md"), "should not match files outside the search directory");
  });

  it("matches directories as well as files", async () => {
    await fs.mkdir(path.join(workspace, "mydir", "inner"), { recursive: true });
    await writeFile("mydir/inner/file.txt", "f\n");
    const result = await run({ pattern: "mydir/**" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as string[];
    assert.ok(matches.length >= 1, "expected at least one match under mydir/**");
    assert.ok(matches.every((m) => m.startsWith("mydir")), `all matches should be under mydir: ${JSON.stringify(matches)}`);
  });

  it("ignores node_modules, dist, and build directories", async () => {
    await writeFile("node_modules/skip.ts", "x\n");
    await writeFile("dist/skip.ts", "x\n");
    await writeFile("build/skip.ts", "x\n");
    await writeFile("src/keep-glob-check.ts", "x\n");
    const result = await run({ pattern: "**/keep-glob-check.ts" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as string[];
    assert.deepEqual(matches, ["src/keep-glob-check.ts"]);
  });

  it("caps results at 100 matches", async () => {
    await fs.mkdir(path.join(workspace, "many"), { recursive: true });
    for (let i = 0; i < 120; i += 1) {
      await writeFile(`many/f${String(i).padStart(3, "0")}.txt`, "x\n");
    }
    const result = await run({ pattern: "many/*.txt" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as unknown[];
    assert.equal(matches.length, MAX_GLOB_MATCHES);
    assert.equal(data.truncated, true);
  });

  it("rejects empty patterns", async () => {
    const result = await run({ pattern: "   " });
    assert.equal(result.ok, false);
  });

  it("rejects paths outside the workspace", async () => {
    const result = await run({ pattern: "**/*.ts", path: "/etc" });
    assert.equal(result.ok, false);
  });

  it("rejects a file path (must be a directory)", async () => {
    const abs = await writeFile("notadir.txt", "x\n");
    const result = await run({ pattern: "*.txt", path: abs });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code?: string })?.code, "unsupported_path_type");
  });
});
