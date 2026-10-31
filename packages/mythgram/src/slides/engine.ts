import { promises as fs } from "node:fs";
import path from "node:path";
import { createSlideProjectId } from "../database/ids.js";
import { safeResolve } from "../utils/paths.js";
import { DEFAULT_SLIDE_TEMPLATES } from "./defaultTemplates.js";
import type {
  ManageSlidesInput,
  OrganizeSlidesInput,
  Slide,
  SlideProject,
  SlideProjectSummary,
  SlideTemplate,
  SlideTemplateSummary,
  StoredSlideProject,
  StoredSlideTemplate,
} from "./types.js";

/** Hard limits that keep a slide project safe to store and render. */
export const MAX_SLIDES_PER_PROJECT = 200;
export const MAX_SLIDE_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_SLIDE_PROJECT_NAME = 200;
export const MAX_SLIDE_PROJECT_DESCRIPTION = 2000;

/** A domain error carrying a stable machine-readable code for the tool layer. */
export class SlidesEngineError extends Error {
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "SlidesEngineError";
    this.code = code;
    this.extra = extra;
  }
}

/** The persistence surface the engine needs (implemented by SlidesRepo). */
export interface SlidesStore {
  listProjects(): StoredSlideProject[];
  getProject(id: string): StoredSlideProject | null;
  saveProject(row: StoredSlideProject): void;
  deleteProject(id: string): boolean;
  listTemplates(): StoredSlideTemplate[];
  getTemplate(id: string): StoredSlideTemplate | null;
  saveTemplate(row: StoredSlideTemplate): void;
  deleteTemplate(id: string): boolean;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function titleFromHtml(html: string): string | undefined {
  const title = /<title[^>]*>\s*([^<]{1,200})\s*<\/title>/i.exec(html);
  if (title?.[1]?.trim()) return title[1].trim();
  const heading = /<h1[^>]*>\s*([\s\S]{1,200}?)<\/h1>/i.exec(html);
  if (!heading?.[1]) return undefined;
  const text = heading[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, 200) : undefined;
}

/** Parse/normalize a stored slides JSON string into a clean, contiguous slide list. */
export function normalizeSlides(raw: unknown): Slide[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const byNumber = new Map<number, Slide>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const number =
      typeof record.slide_number === "number" && Number.isFinite(record.slide_number)
        ? Math.floor(record.slide_number)
        : NaN;
    const html = typeof record.html === "string" ? record.html : "";
    if (!Number.isInteger(number) || number < 1 || html.trim().length === 0) continue;
    if (!byNumber.has(number)) {
      byNumber.set(number, {
        slide_number: number,
        html,
        file_path: typeof record.file_path === "string" ? record.file_path : undefined,
        title: typeof record.title === "string" ? record.title : undefined,
      });
    }
  }

  return Array.from(byNumber.values())
    .sort((a, b) => a.slide_number - b.slide_number)
    .map((slide, index) => ({ ...slide, slide_number: index + 1 }));
}

function toProject(row: StoredSlideProject): SlideProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    slides: normalizeSlides(row.slides),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplate(row: StoredSlideTemplate): SlideTemplate {
  return { ...toProject(row), builtin: false };
}

export function toProjectSummary(project: SlideProject): SlideProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    slide_count: project.slides.length,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

export function toTemplateSummary(template: SlideTemplate): SlideTemplateSummary {
  return { ...toProjectSummary(template), builtin: template.builtin };
}

/**
 * Slides engine: owns slide projects and templates.
 *
 * It is deliberately storage-agnostic (any SlidesStore works) so it can be unit
 * tested without SQLite. All input paths are resolved through safeResolve and can
 * never escape the workspace; every file read is bounded and validated.
 */
export class SlidesManager {
  constructor(private readonly store: SlidesStore) {}

  /** Built-in templates first, then user-created templates (newest first). */
  listTemplates(): SlideTemplate[] {
    const userTemplates = this.store
      .listTemplates()
      .map(toTemplate)
      .filter((template) => template.slides.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return [...DEFAULT_SLIDE_TEMPLATES.map((template) => ({ ...template })), ...userTemplates];
  }

  listTemplateSummaries(): SlideTemplateSummary[] {
    return this.listTemplates().map(toTemplateSummary);
  }

  getTemplate(id: string): SlideTemplate | null {
    const templateId = cleanText(id, 128);
    if (!templateId) return null;
    const builtin = DEFAULT_SLIDE_TEMPLATES.find((template) => template.id === templateId);
    if (builtin) return { ...builtin };
    const row = this.store.getTemplate(templateId);
    if (!row) return null;
    const template = toTemplate(row);
    return template.slides.length > 0 ? template : null;
  }

  /** Read one or more templates; throws a structured error listing any unknown ids. */
  readTemplates(ids: string[]): SlideTemplate[] {
    const templates = ids.map((id) => this.getTemplate(id));
    const missing = ids.filter((_, index) => templates[index] === null);
    if (missing.length > 0) {
      throw new SlidesEngineError(
        "template_not_found",
        `Unknown slide template id(s): ${missing.join(", ")}. Use get_available_slides_template to list valid ids.`,
        {
          missing_template_ids: missing,
          available_templates: this.listTemplateSummaries().map((template) => ({
            id: template.id,
            name: template.name,
          })),
        },
      );
    }
    return templates as SlideTemplate[];
  }

  listProjects(): SlideProject[] {
    return this.store
      .listProjects()
      .map(toProject)
      .filter((project) => project.slides.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listProjectSummaries(): SlideProjectSummary[] {
    return this.listProjects().map(toProjectSummary);
  }

  getProject(id: string): SlideProject | null {
    const projectId = cleanText(id, 128);
    if (!projectId) return null;
    const row = this.store.getProject(projectId);
    if (!row) return null;
    const project = toProject(row);
    return project.slides.length > 0 ? project : null;
  }

  /** Create a new project from one or more HTML files. */
  async organizeSlides(input: OrganizeSlidesInput, workspaceRoot: string): Promise<SlideProject> {
    const name = cleanText(input.project_name, MAX_SLIDE_PROJECT_NAME);
    if (!name) {
      throw new SlidesEngineError("project_name_required", "A non-empty project_name is required.");
    }
    if (!Array.isArray(input.slides) || input.slides.length === 0) {
      throw new SlidesEngineError("slides_required", "At least one slide must be provided.");
    }
    if (input.slides.length > MAX_SLIDES_PER_PROJECT) {
      throw new SlidesEngineError(
        "too_many_slides",
        `A slide project can contain at most ${MAX_SLIDES_PER_PROJECT} slides.`,
      );
    }

    const seen = new Set<number>();
    const slides: Slide[] = [];
    for (const item of input.slides) {
      const number = item.slide_number;
      if (!Number.isInteger(number) || number < 1) {
        throw new SlidesEngineError(
          "invalid_slide_number",
          "Every slide_number must be a positive integer.",
        );
      }
      if (seen.has(number)) {
        throw new SlidesEngineError(
          "duplicate_slide_number",
          `slide_number ${number} was provided more than once. Each slide needs a unique number.`,
        );
      }
      seen.add(number);
      slides.push(await this.readSlideFile(item.html_file_path, number, workspaceRoot));
    }

    slides.sort((a, b) => a.slide_number - b.slide_number);
    const now = Date.now();
    const project: SlideProject = {
      id: createSlideProjectId(),
      name,
      description: "",
      slides: slides.map((slide, index) => ({ ...slide, slide_number: index + 1 })),
      createdAt: now,
      updatedAt: now,
    };
    this.persistProject(project);
    return project;
  }

  /** Apply one management action to an existing project. */
  async manageSlides(input: ManageSlidesInput, workspaceRoot: string): Promise<SlideProject | null> {
    const projectId = cleanText(input.project_id, 128);
    if (!projectId) {
      throw new SlidesEngineError("project_id_required", "A non-empty project_id is required.");
    }
    const project = this.getProject(projectId);
    if (!project) {
      throw new SlidesEngineError(
        "project_not_found",
        `No slide project with id "${projectId}" exists. Use the project id returned by organize_slides.`,
        {
          available_projects: this.listProjectSummaries().map((item) => ({
            id: item.id,
            name: item.name,
          })),
        },
      );
    }

    switch (input.action) {
      case "delete_slide":
        return this.deleteSlide(project, input.slide_number);
      case "replace_slide":
        return this.replaceSlide(project, input.slide_number, input.html_file_path, workspaceRoot);
      case "change_slide_position":
        return this.changeSlidePosition(project, input.slide_number, input.new_position);
      case "rename_slide_project":
        return this.renameProject(project, input.new_project_name);
      case "delete_slide_project":
        this.store.deleteProject(project.id);
        return null;
      default:
        throw new SlidesEngineError(
          "unsupported_action",
          `Unsupported action "${String(input.action)}".`,
        );
    }
  }

  /** Delete a slide project by id. Returns true when one was removed. */
  deleteProject(id: string): boolean {
    const projectId = cleanText(id, 128);
    if (!projectId) return false;
    return this.store.deleteProject(projectId);
  }

  /** Save a copy of an existing project as a reusable user template. */
  saveAsTemplate(projectId: string): SlideTemplate {
    const project = this.getProject(projectId);
    if (!project) {
      throw new SlidesEngineError("project_not_found", `No slide project with id "${projectId}" exists.`);
    }
    const now = Date.now();
    const template: SlideTemplate = {
      id: createSlideProjectId(),
      name: project.name,
      description:
        project.description ||
        `Template saved from the slide project "${project.name}".`,
      slides: project.slides.map((slide) => ({ ...slide })),
      createdAt: now,
      updatedAt: now,
      builtin: false,
    };
    this.persistTemplate(template);
    return template;
  }

  /** Delete a user-created template. Built-in templates are read-only. */
  deleteTemplate(id: string): boolean {
    const templateId = cleanText(id, 128);
    if (!templateId) {
      throw new SlidesEngineError("template_id_required", "A non-empty template id is required.");
    }
    if (DEFAULT_SLIDE_TEMPLATES.some((template) => template.id === templateId)) {
      throw new SlidesEngineError(
        "builtin_template_read_only",
        "Built-in slide templates cannot be deleted.",
      );
    }
    return this.store.deleteTemplate(templateId);
  }

  private deleteSlide(project: SlideProject, slideNumber: number | undefined): SlideProject {
    const number = this.requireSlideNumber(project, slideNumber);
    if (project.slides.length <= 1) {
      throw new SlidesEngineError(
        "cannot_delete_last_slide",
        "A slide project must keep at least one slide. Use delete_slide_project to remove the whole project.",
      );
    }
    const slides = project.slides
      .filter((slide) => slide.slide_number !== number)
      .map((slide, index) => ({ ...slide, slide_number: index + 1 }));
    return this.saveUpdatedProject(project, slides);
  }

  private async replaceSlide(
    project: SlideProject,
    slideNumber: number | undefined,
    htmlFilePath: string | undefined,
    workspaceRoot: string,
  ): Promise<SlideProject> {
    const number = this.requireSlideNumber(project, slideNumber);
    const filePath = cleanText(htmlFilePath, 4096);
    if (!filePath) {
      throw new SlidesEngineError(
        "html_file_path_required",
        "A non-empty html_file_path is required to replace a slide.",
      );
    }
    const replacement = await this.readSlideFile(filePath, number, workspaceRoot);
    const slides = project.slides.map((slide) =>
      slide.slide_number === number ? replacement : slide,
    );
    return this.saveUpdatedProject(project, slides);
  }

  private changeSlidePosition(
    project: SlideProject,
    slideNumber: number | undefined,
    newPosition: number | undefined,
  ): SlideProject {
    const number = this.requireSlideNumber(project, slideNumber);
    const total = project.slides.length;
    if (!Number.isInteger(newPosition) || (newPosition as number) < 1 || (newPosition as number) > total) {
      throw new SlidesEngineError(
        "invalid_new_position",
        `new_position must be an integer between 1 and ${total}.`,
      );
    }
    const target = newPosition as number;
    if (target === number) return project;

    const slides = project.slides.slice();
    const [moved] = slides.splice(number - 1, 1);
    if (!moved) return project;
    slides.splice(target - 1, 0, moved);
    return this.saveUpdatedProject(
      project,
      slides.map((slide, index) => ({ ...slide, slide_number: index + 1 })),
    );
  }

  private renameProject(project: SlideProject, newName: string | undefined): SlideProject {
    const name = cleanText(newName, MAX_SLIDE_PROJECT_NAME);
    if (!name) {
      throw new SlidesEngineError(
        "new_project_name_required",
        "A non-empty new_project_name is required to rename a slide project.",
      );
    }
    return this.saveUpdatedProject(project, project.slides, name);
  }

  private saveUpdatedProject(
    project: SlideProject,
    slides: Slide[],
    name = project.name,
  ): SlideProject {
    const updated: SlideProject = {
      ...project,
      name,
      slides,
      updatedAt: Date.now(),
    };
    this.persistProject(updated);
    return updated;
  }

  private requireSlideNumber(project: SlideProject, value: number | undefined): number {
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new SlidesEngineError(
        "slide_number_required",
        "A positive integer slide_number is required for this action.",
      );
    }
    const number = value as number;
    if (!project.slides.some((slide) => slide.slide_number === number)) {
      throw new SlidesEngineError(
        "slide_not_found",
        `Slide ${number} does not exist in project "${project.name}" (it has ${project.slides.length} slides).`,
        { slide_count: project.slides.length },
      );
    }
    return number;
  }

  /** Read and validate one HTML slide file from inside the workspace. */
  private async readSlideFile(
    inputPath: string,
    slideNumber: number,
    workspaceRoot: string,
  ): Promise<Slide> {
    const rawPath = cleanText(inputPath, 4096);
    if (!rawPath) {
      throw new SlidesEngineError("html_file_path_required", "A non-empty html_file_path is required.");
    }
    const extension = path.extname(rawPath).toLowerCase();
    if (extension !== ".html" && extension !== ".htm") {
      throw new SlidesEngineError(
        "invalid_slide_extension",
        `"${rawPath}" is not an HTML file. Slides must be .html or .htm files.`,
      );
    }

    let absolutePath: string;
    try {
      absolutePath = safeResolve(workspaceRoot, rawPath);
    } catch (error) {
      throw new SlidesEngineError(
        "invalid_slide_path",
        error instanceof Error ? error.message : String(error),
      );
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      throw new SlidesEngineError(
        "slide_file_not_found",
        `The slide file "${rawPath}" does not exist in the workspace.`,
      );
    }
    if (!stat.isFile()) {
      throw new SlidesEngineError("slide_path_not_file", `"${rawPath}" is not a regular file.`);
    }
    if (stat.size === 0) {
      throw new SlidesEngineError("empty_slide_file", `The slide file "${rawPath}" is empty.`);
    }
    if (stat.size > MAX_SLIDE_HTML_BYTES) {
      throw new SlidesEngineError(
        "slide_file_too_large",
        `The slide file "${rawPath}" is ${stat.size} bytes; the maximum is ${MAX_SLIDE_HTML_BYTES} bytes.`,
      );
    }

    const html = await fs.readFile(absolutePath, "utf8");
    if (html.trim().length === 0) {
      throw new SlidesEngineError("empty_slide_file", `The slide file "${rawPath}" has no content.`);
    }
    if (!html.includes("<")) {
      throw new SlidesEngineError(
        "invalid_slide_html",
        `The slide file "${rawPath}" does not contain valid HTML markup.`,
      );
    }

    return {
      slide_number: slideNumber,
      html,
      file_path: rawPath,
      title: titleFromHtml(html),
    };
  }

  private persistProject(project: SlideProject): void {
    this.store.saveProject({
      id: project.id,
      name: project.name,
      description: cleanText(project.description, MAX_SLIDE_PROJECT_DESCRIPTION),
      slides: JSON.stringify(project.slides),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  }

  private persistTemplate(template: SlideTemplate): void {
    this.store.saveTemplate({
      id: template.id,
      name: template.name,
      description: cleanText(template.description, MAX_SLIDE_PROJECT_DESCRIPTION),
      slides: JSON.stringify(template.slides),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    });
  }
}