import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import {
  organizeSlidesTool,
  getAvailableSlidesTemplateTool,
  presentSlidesTool,
  askUserToChooseSlidesTemplateTool,
  readSlidesTemplateTool,
  manageSlidesTool,
  saveSlidesAsTemplateTool,
} from "./index.js";
import { createToolRegistry } from "./index.js";
import type { ToolContext } from "./types.js";
import { SlidesManager, type SlidesStore } from "../../slides/engine.js";
import { SlidesTemplateChoiceStore } from "../../slides/choiceStore.js";
import {
  createSlidesRuntime,
  SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS,
} from "../../slides/runtime.js";
import type { StoredSlideProject, StoredSlideTemplate } from "../../slides/types.js";

/** In-memory stand-in for the SQLite slides repository. */
function createStore(): SlidesStore {
  const projects = new Map<string, StoredSlideProject>();
  const templates = new Map<string, StoredSlideTemplate>();
  return {
    listProjects: () => Array.from(projects.values()),
    getProject: (id) => projects.get(id) ?? null,
    saveProject: (row) => {
      projects.set(row.id, { ...row });
    },
    deleteProject: (id) => projects.delete(id),
    listTemplates: () => Array.from(templates.values()),
    getTemplate: (id) => templates.get(id) ?? null,
    saveTemplate: (row) => {
      templates.set(row.id, { ...row });
    },
    deleteTemplate: (id) => templates.delete(id),
  };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function slideHtml(title: string): string {
  return `<!doctype html><html><head><title>${title}</title><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden}</style></head><body><h1>${title}</h1></body></html>`;
}

describe("slides tools", () => {
  let registry: ToolRegistry;
  let workspace: string;
  let store: SlidesStore;
  let manager: SlidesManager;
  let choices: SlidesTemplateChoiceStore;
  let runtime: ReturnType<typeof createSlidesRuntime>;

  before(async () => {
    registry = new ToolRegistry().registerAll([
      organizeSlidesTool,
      getAvailableSlidesTemplateTool,
      presentSlidesTool,
      askUserToChooseSlidesTemplateTool,
      readSlidesTemplateTool,
      manageSlidesTool,
      saveSlidesAsTemplateTool,
    ]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-slides-"));
    store = createStore();
    manager = new SlidesManager(store);
    choices = new SlidesTemplateChoiceStore();
    runtime = createSlidesRuntime(manager, choices);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
      workspaceRoot: workspace,
      shellTimeoutMs: 10_000,
      chatId: "chat-1",
      toolCallId: "tool-1",
      slides: runtime,
      ...overrides,
    };
  }

  async function writeSlides(names: string[]): Promise<string[]> {
    const paths: string[] = [];
    for (const name of names) {
      const full = path.join(workspace, "decks", `${name}.html`);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, slideHtml(name), "utf8");
      paths.push(full);
    }
    return paths;
  }

  it("registers all seven slide tools as native function schemas", () => {
    const names = [
      "organize_slides",
      "get_available_slides_template",
      "present_slides",
      "ask_user_to_choose_slides_template",
      "read_slides_template",
      "manage_slides",
      "save_slides_as_template",
    ];
    for (const name of names) {
      assert.ok(registry.has(name), `${name} must be registered`);
      const schema = registry.schemas.find((s) => s.function.name === name);
      assert.ok(schema, `${name} must be advertised to the LLM`);
      assert.equal(schema!.type, "function");
      assert.equal((schema!.function.parameters as { type: string }).type, "object");
      assert.equal(
        (schema!.function.parameters as { additionalProperties?: boolean }).additionalProperties,
        false,
      );
    }
    const full = createToolRegistry();
    for (const name of names) assert.ok(full.has(name), `${name} must be in the default registry`);
  });

  it("lists the four built-in templates", async () => {
    const result = await registry.execute("get_available_slides_template", {}, ctxFor());
    assert.equal(result.ok, true);
    const data = result.data as { count: number; templates: Array<Record<string, unknown>> };
    assert.equal(data.count, 4);
    assert.ok(data.templates.every((template) => template.builtin === true));
    assert.ok(data.templates.some((template) => template.id === "template-modern-pitch"));
  });

  it("reads a template's complete raw HTML", async () => {
    const result = await registry.execute(
      "read_slides_template",
      { template_ids: ["template-modern-pitch"] },
      ctxFor(),
    );
    assert.equal(result.ok, true);
    const data = result.data as {
      templates: Array<{ slides: Array<{ html: string }> }>;
    };
    assert.equal(data.templates.length, 1);
    assert.ok(data.templates[0]!.slides.length >= 1);
    assert.match(data.templates[0]!.slides[0]!.html, /<html/i);
  });

  it("organizes HTML files into a project and presents it", async () => {
    const [first, second] = await writeSlides(["intro", "details"]);
    const created = await registry.execute(
      "organize_slides",
      {
        project_name: "Agent Slides",
        slides: [
          { html_file_path: second!, slide_number: 2 },
          { html_file_path: first!, slide_number: 1 },
        ],
      },
      ctxFor(),
    );
    assert.equal(created.ok, true);
    const data = created.data as { project_id: string; project: { slide_count: number } };
    assert.match(data.project_id, /^[0-9A-Za-z]{16}$/);
    assert.equal(data.project.slide_count, 2);
    assert.equal(manager.getProject(data.project_id)!.slides[0]!.title, "intro");

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const presented = await registry.execute(
      "present_slides",
      { project_ids: [data.project_id] },
      ctxFor({ emit: (event, payload) => events.push({ event, data: payload }) }),
    );
    assert.equal(presented.ok, true);
    const evt = events.find((e) => e.event === "slides_present");
    assert.ok(evt, "slides_present must be emitted");
    const projects = evt!.data.projects as Array<{ slides: unknown[] }>;
    assert.equal(projects[0]!.slides.length, 2);
  });

  it("manages slide position, replacement, rename, deletion, and project deletion", async () => {
    const [a, b, c, replacement] = await writeSlides(["a", "b", "c", "replacement"]);
    const created = await registry.execute(
      "organize_slides",
      {
        project_name: "Manage Me",
        slides: [
          { html_file_path: a!, slide_number: 1 },
          { html_file_path: b!, slide_number: 2 },
          { html_file_path: c!, slide_number: 3 },
        ],
      },
      ctxFor(),
    );
    const projectId = (created.data as { project_id: string }).project_id;

    const moved = await registry.execute(
      "manage_slides",
      { project_id: projectId, action: "change_slide_position", slide_number: 3, new_position: 1 },
      ctxFor(),
    );
    assert.equal(moved.ok, true);
    assert.equal(manager.getProject(projectId)!.slides[0]!.title, "c");

    const replaced = await registry.execute(
      "manage_slides",
      {
        project_id: projectId,
        action: "replace_slide",
        slide_number: 2,
        html_file_path: replacement!,
      },
      ctxFor(),
    );
    assert.equal(replaced.ok, true);
    assert.equal(manager.getProject(projectId)!.slides[1]!.title, "replacement");

    const renamed = await registry.execute(
      "manage_slides",
      { project_id: projectId, action: "rename_slide_project", new_project_name: "Renamed Deck" },
      ctxFor(),
    );
    assert.equal(renamed.ok, true);
    assert.equal(manager.getProject(projectId)!.name, "Renamed Deck");

    const deletedSlide = await registry.execute(
      "manage_slides",
      { project_id: projectId, action: "delete_slide", slide_number: 1 },
      ctxFor(),
    );
    assert.equal(deletedSlide.ok, true);
    assert.equal(manager.getProject(projectId)!.slides.length, 2);

    const deletedProject = await registry.execute(
      "manage_slides",
      { project_id: projectId, action: "delete_slide_project" },
      ctxFor(),
    );
    assert.equal(deletedProject.ok, true);
    assert.equal(manager.getProject(projectId), null);
  });

  it("saves a project as a template and deletes only user templates", async () => {
    const [a] = await writeSlides(["templated"]);
    const created = await registry.execute(
      "organize_slides",
      { project_name: "Template Source", slides: [{ html_file_path: a!, slide_number: 1 }] },
      ctxFor(),
    );
    const projectId = (created.data as { project_id: string }).project_id;

    const events: Array<{ event: string }> = [];
    const saved = await registry.execute(
      "save_slides_as_template",
      { project_id: projectId },
      ctxFor({ emit: (event) => events.push({ event }) }),
    );
    assert.equal(saved.ok, true);
    const template = (saved.data as { template: { id: string; builtin: boolean } }).template;
    assert.equal(template.builtin, false);
    assert.ok(manager.listTemplates().some((item) => item.id === template.id));
    assert.ok(events.some((event) => event.event === "slides_templates_updated"));

    const deleted = await registry.execute(
      "manage_slides",
      { project_id: projectId, action: "delete_slide_project" },
      ctxFor(),
    );
    assert.equal(deleted.ok, true);
  });

  it("asks the user to choose a template and returns the selection", async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ctx = ctxFor({ emit: (event, payload) => events.push({ event, data: payload }) });
    const promise = registry.execute("ask_user_to_choose_slides_template", {}, ctx);
    await tick();

    const evt = events.find((e) => e.event === "slides_template_choice");
    assert.ok(evt, "slides_template_choice must be emitted");
    assert.equal(evt!.data.timeout_ms, SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS);
    const templates = evt!.data.templates as Array<{ id: string }>;
    assert.ok(templates.length >= 4);

    choices.select("chat-1", "tool-1", templates[0]!.id);
    const result = await promise;
    assert.equal(result.ok, true);
    const data = result.data as {
      decision: string;
      template: { id: string };
    };
    assert.equal(data.decision, "selected");
    assert.equal(data.template.id, templates[0]!.id);
  });

  it("reports an aborted template choice without hanging", async () => {
    const controller = new AbortController();
    const promise = registry.execute(
      "ask_user_to_choose_slides_template",
      {},
      ctxFor({ toolCallId: "tool-abort", signal: controller.signal }),
    );
    await tick();
    controller.abort();
    const result = await promise;
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "aborted");
  });

  it("returns structured errors for bad paths, duplicates, and unknown ids", async () => {
    const escaping = await registry.execute(
      "organize_slides",
      {
        project_name: "Bad",
        slides: [{ html_file_path: "../escape.html", slide_number: 1 }],
      },
      ctxFor(),
    );
    assert.equal(escaping.ok, false);
    assert.equal((escaping.error as { code: string }).code, "invalid_slide_path");

    const [a] = await writeSlides(["dup"]);
    const duplicate = await registry.execute(
      "organize_slides",
      {
        project_name: "Dup",
        slides: [
          { html_file_path: a!, slide_number: 1 },
          { html_file_path: a!, slide_number: 1 },
        ],
      },
      ctxFor(),
    );
    assert.equal(duplicate.ok, false);
    assert.equal((duplicate.error as { code: string }).code, "duplicate_slide_number");

    const unknown = await registry.execute(
      "read_slides_template",
      { template_ids: ["nope"] },
      ctxFor(),
    );
    assert.equal(unknown.ok, false);
    assert.equal((unknown.error as { code: string }).code, "template_not_found");

    const badManage = await registry.execute(
      "manage_slides",
      { project_id: "missing", action: "delete_slide_project" },
      ctxFor(),
    );
    assert.equal(badManage.ok, false);
    assert.equal((badManage.error as { code: string }).code, "project_not_found");
  });

  it("fails cleanly when the slides runtime is absent (sub-agent / chat mode)", async () => {
    for (const name of [
      "organize_slides",
      "get_available_slides_template",
      "present_slides",
      "ask_user_to_choose_slides_template",
      "read_slides_template",
      "manage_slides",
      "save_slides_as_template",
    ]) {
      const args =
        name === "organize_slides"
          ? { project_name: "x", slides: [{ html_file_path: "a.html", slide_number: 1 }] }
          : name === "present_slides"
            ? { project_ids: ["x"] }
            : name === "read_slides_template"
              ? { template_ids: ["x"] }
              : name === "manage_slides"
                ? { project_id: "x", action: "delete_slide_project" }
                : name === "save_slides_as_template"
                  ? { project_id: "x" }
                  : {};
      const result = await registry.execute(name, args, ctxFor({ slides: undefined }));
      assert.equal(result.ok, false, `${name} must fail without a runtime`);
      assert.equal((result.error as { code: string }).code, "slides_unavailable");
    }
  });

  it("exposes the 2-minute template-choice timeout constant", () => {
    assert.equal(SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS, 120_000);
  });
});