import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

/** One HTML slide rendered on a 1280x720 (16:9) canvas. */
export interface Slide {
  slide_number: number;
  html: string;
  file_path?: string;
  title?: string;
}

export interface SlideProject {
  id: string;
  name: string;
  description: string;
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

export interface SlideTemplate extends SlideProject {
  builtin: boolean;
}

export interface SlideProjectSummary {
  id: string;
  name: string;
  description: string;
  slide_count: number;
  created_at: number;
  updated_at: number;
}

export interface SlideTemplateSummary extends SlideProjectSummary {
  builtin: boolean;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const number = typeof r.slide_number === "number" ? Math.floor(r.slide_number) : NaN;
  const html = str(r.html);
  if (!Number.isInteger(number) || number < 1 || html.trim().length === 0) return null;
  return {
    slide_number: number,
    html,
    file_path: typeof r.file_path === "string" ? r.file_path : undefined,
    title: typeof r.title === "string" ? r.title : undefined,
  };
}

/** Normalize a project/template payload from the API (drops malformed slides). */
export function normalizeSlideProject(raw: unknown): SlideProject | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  if (!id) return null;
  const slidesRaw = Array.isArray(r.slides) ? r.slides : [];
  const slides = slidesRaw
    .map(normalizeSlide)
    .filter((slide): slide is Slide => slide !== null)
    .sort((a, b) => a.slide_number - b.slide_number)
    .map((slide, index) => ({ ...slide, slide_number: index + 1 }));
  if (slides.length === 0) return null;
  return {
    id,
    name: str(r.name) || "Untitled slides",
    description: str(r.description),
    slides,
    createdAt: num(r.createdAt ?? r.created_at),
    updatedAt: num(r.updatedAt ?? r.updated_at),
  };
}

export function normalizeSlideTemplate(raw: unknown): SlideTemplate | null {
  const project = normalizeSlideProject(raw);
  if (!project) return null;
  return { ...project, builtin: (raw as Record<string, unknown>).builtin === true };
}

export function normalizeTemplateSummaries(raw: unknown): SlideTemplateSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: SlideTemplateSummary[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: str(r.name) || "Untitled template",
      description: str(r.description),
      slide_count: num(r.slide_count),
      created_at: num(r.created_at),
      updated_at: num(r.updated_at),
      builtin: r.builtin === true,
    });
  }
  return out;
}

export function normalizeProjectSummaries(raw: unknown): SlideProjectSummary[] {
  return normalizeTemplateSummaries(raw).map(({ builtin: _builtin, ...rest }) => rest);
}

export async function fetchSlideTemplates(): Promise<SlideTemplateSummary[]> {
  const data = await requestJson<{ templates?: unknown }>(
    routeUrl(API_ROUTES.slidesTemplates),
  );
  return normalizeTemplateSummaries(data.templates);
}

export async function fetchSlideTemplate(id: string): Promise<SlideTemplate> {
  const data = await requestJson<{ template?: unknown }>(
    routeUrl(API_ROUTES.slidesTemplate, { params: { id } }),
  );
  const template = normalizeSlideTemplate(data.template);
  if (!template) throw new Error("The slide template could not be loaded.");
  return template;
}

export async function deleteSlideTemplate(id: string): Promise<SlideTemplateSummary[]> {
  const data = await requestJson<{ templates?: unknown }>(
    routeUrl(API_ROUTES.slidesTemplateDelete, { params: { id } }),
    { method: "DELETE" },
  );
  return normalizeTemplateSummaries(data.templates);
}

export async function fetchSlideProjects(): Promise<SlideProjectSummary[]> {
  const data = await requestJson<{ projects?: unknown }>(
    routeUrl(API_ROUTES.slidesProjects),
  );
  return normalizeProjectSummaries(data.projects);
}

export async function fetchSlideProject(id: string): Promise<SlideProject> {
  const data = await requestJson<{ project?: unknown }>(
    routeUrl(API_ROUTES.slidesProject, { params: { id } }),
  );
  const project = normalizeSlideProject(data.project);
  if (!project) throw new Error("The slide project could not be loaded.");
  return project;
}

export async function deleteSlideProject(id: string): Promise<SlideProjectSummary[]> {
  const data = await requestJson<{ projects?: unknown }>(
    routeUrl(API_ROUTES.slidesProjectDelete, { params: { id } }),
    { method: "DELETE" },
  );
  return normalizeProjectSummaries(data.projects);
}

export async function saveSlideProjectAsTemplate(id: string): Promise<{
  template: SlideTemplate | null;
  templates: SlideTemplateSummary[];
}> {
  const data = await requestJson<{ template?: unknown; templates?: unknown }>(
    routeUrl(API_ROUTES.slidesProjectSaveAsTemplate, { params: { id } }),
    { method: "POST" },
  );
  return {
    template: normalizeSlideTemplate(data.template),
    templates: normalizeTemplateSummaries(data.templates),
  };
}

/**
 * Submit the user's selected slide template to a pending
 * ask_user_to_choose_slides_template call. Returns false when the request is no longer pending.
 */
export async function submitSlidesTemplateChoice(
  chatId: string,
  toolCallId: string,
  templateId: string,
): Promise<boolean> {
  try {
    const data = await requestJson<{ ok?: boolean }>(
      routeUrl(API_ROUTES.chatSlidesTemplateChoice, { params: { chatId, toolCallId } }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      },
    );
    return data.ok === true;
  } catch {
    return false;
  }
}