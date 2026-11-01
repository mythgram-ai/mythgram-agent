import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { saveArtifactsTool } from "./save_artifacts.js";
import { listArtifactsTool } from "./list_artifacts.js";
import { deleteArtifactsTool } from "./delete_artifacts.js";
import { showArtifactToUserTool } from "./show_artifact_to_user.js";
import { readArtifactTool } from "./read_artifact.js";
import { artifactsManager } from "../../artifacts/index.js";
import type { ToolContext } from "./types.js";

const registry = new ToolRegistry().registerAll([
  saveArtifactsTool,
  listArtifactsTool,
  deleteArtifactsTool,
  showArtifactToUserTool,
  readArtifactTool,
]);

const tmpRoots: string[] = [];

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mythgram-artifacts-"));
  tmpRoots.push(root);
  return root;
}

function ctxFor(workspaceRoot: string, toolCallId = "call_1") {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    toolCallId,
    emit: (event, data) => events.push({ event, data }),
  };
  return { ctx, events };
}

after(async () => {
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact tools", () => {
  it("registers all five tools with the documented schemas", () => {
    for (const name of [
      "save_artifacts",
      "list_artifacts",
      "delete_artifacts",
      "show_artifact_to_user",
      "read_artifact",
    ]) {
      assert.ok(registry.has(name), `${name} should be registered`);
    }
    const save = registry.schemas.find((s) => s.function.name === "save_artifacts")!;
    const props = save.function.parameters.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(props).sort(), [
      "artifact_file_path",
      "description",
      "title",
      "type",
    ]);
    assert.deepEqual([...(save.function.parameters.required as string[])].sort(), [
      "artifact_file_path",
      "description",
      "title",
      "type",
    ]);
  });

  it("saves a file as an artifact, listing and reading it back", async () => {
    const root = await makeWorkspace();
    const source = path.join(root, "report.md");
    await writeFile(source, "# Report\nhello artifacts", "utf8");
    const { ctx, events } = ctxFor(root);

    const save = await registry.execute(
      "save_artifacts",
      {
        artifact_file_path: source,
        title: "Quarterly report",
        description: "Q3 numbers",
        type: "markdown",
      },
      ctx,
    );
    assert.equal(save.ok, true);
    const meta = (save.data as { artifact: { id: string; type: string; file: string } }).artifact;
    assert.equal(meta.type, "markdown");
    assert.match(meta.file, /^\.mythgram\/artifacts\/[0-9A-Za-z]{16}\.md$/);
    assert.equal(events.at(-1)!.event, "artifacts_updated");

    const list = await registry.execute("list_artifacts", {}, ctx);
    assert.equal((list.data as { count: number }).count, 1);

    const read = await registry.execute("read_artifact", { artifact_id: meta.id }, ctx);
    assert.equal(read.ok, true);
    assert.equal((read.data as { content: string }).content, "# Report\nhello artifacts");
  });

  it("shows an artifact in the tool block with a tool_call_id", async () => {
    const root = await makeWorkspace();
    const source = path.join(root, "data.csv");
    await writeFile(source, "a,b\n1,2", "utf8");
    const { ctx, events } = ctxFor(root, "call_show");

    const save = await registry.execute(
      "save_artifacts",
      { artifact_file_path: source, title: "Data", description: "csv", type: "csv" },
      ctx,
    );
    const id = (save.data as { artifact: { id: string } }).artifact.id;

    const show = await registry.execute("show_artifact_to_user", { artifact_id: id }, ctx);
    assert.equal(show.ok, true);
    const showEvent = events.find((e) => e.event === "artifact_show")!;
    assert.ok(showEvent);
    assert.equal(showEvent.data.tool_call_id, "call_show");
    assert.equal((showEvent.data.artifact as { content: string }).content, "a,b\n1,2");
  });

  it("deletes an artifact and its file", async () => {
    const root = await makeWorkspace();
    const source = path.join(root, "notes.txt");
    await writeFile(source, "notes", "utf8");
    const { ctx } = ctxFor(root);
    const save = await registry.execute(
      "save_artifacts",
      { artifact_file_path: source, title: "Notes", description: "text", type: "text" },
      ctx,
    );
    const meta = (save.data as { artifact: { id: string; file: string } }).artifact;
    const abs = path.join(root, meta.file);

    const del = await registry.execute("delete_artifacts", { artifact_id: meta.id }, ctx);
    assert.equal(del.ok, true);
    const list = await registry.execute("list_artifacts", {}, ctx);
    assert.equal((list.data as { count: number }).count, 0);
    await assert.rejects(access(abs));
  });

  it("rejects image, video, and audio files", async () => {
    const root = await makeWorkspace();
    for (const [name, ext] of [
      ["photo", ".png"],
      ["clip", ".mp4"],
      ["sound", ".mp3"],
    ] as const) {
      const source = path.join(root, `${name}${ext}`);
      await writeFile(source, "binary", "utf8");
      const { ctx } = ctxFor(root);
      const res = await registry.execute(
        "save_artifacts",
        { artifact_file_path: source, title: name, description: "media", type: "text" },
        ctx,
      );
      assert.equal(res.ok, false, `${ext} must be rejected`);
      assert.equal((res.error as { code: string }).code, "artifact_media_not_allowed");
    }
    const list = await registry.execute("list_artifacts", {}, ctxFor(root).ctx);
    assert.equal((list.data as { count: number }).count, 0);
  });

  it("rejects a path outside the workspace", async () => {
    const root = await makeWorkspace();
    const { ctx } = ctxFor(root);
    const res = await registry.execute(
      "save_artifacts",
      { artifact_file_path: "../../etc/passwd", title: "x", description: "y", type: "text" },
      ctx,
    );
    assert.equal(res.ok, false);
  });

  it("supports pin, duplicate and edit through the manager", async () => {
    const root = await makeWorkspace();
    const source = path.join(root, "doc.md");
    await writeFile(source, "v1", "utf8");
    const saved = await artifactsManager.save(
      { artifactFilePath: source, title: "Doc", description: "d", type: "markdown" },
      root,
    );

    const pinned = await artifactsManager.setPinned(saved.id, true, root);
    assert.equal(pinned.pinned, true);
    assert.equal((await artifactsManager.list(root))[0]!.id, saved.id);

    const updated = await artifactsManager.update(
      saved.id,
      { title: "Doc v2", content: "v2" },
      root,
    );
    assert.equal(updated.title, "Doc v2");
    const read = await artifactsManager.read(saved.id, root);
    assert.equal(read.content, "v2");

    const copy = await artifactsManager.duplicate(saved.id, root);
    assert.notEqual(copy.id, saved.id);
    assert.equal((await artifactsManager.list(root)).length, 2);
  });

  it("returns a not-found error for an unknown delete id", async () => {
    const root = await makeWorkspace();
    const { ctx } = ctxFor(root);
    const res = await registry.execute("delete_artifacts", { artifact_id: "missing" }, ctx);
    assert.equal(res.ok, false);
    assert.equal((res.error as { code: string }).code, "artifact_not_found");
  });
});
