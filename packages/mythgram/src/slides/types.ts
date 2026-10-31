/**
 * Shared slide-domain types.
 *
 * A slide is a complete, standalone HTML document sized for a 16:9 presentation
 * canvas (1280x720 design coordinates). Slides are stored with their HTML so a
 * project stays intact even if the original file on disk is edited or deleted.
 */

export interface Slide {
  /** 1-based position of the slide inside its project. */
  slide_number: number;
  /** Complete HTML document for this slide. */
  html: string;
  /** Original workspace file path the HTML was read from, when known. */
  file_path?: string;
  /** Optional human title (derived from the document title when available). */
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
  /** True for the pre-created templates that ship with the application. */
  builtin: boolean;
}

/** Confirmation summary returned by agent tools (never includes slide HTML). */
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

export interface SlideFileInput {
  html_file_path: string;
  slide_number: number;
}

export interface OrganizeSlidesInput {
  project_name: string;
  slides: SlideFileInput[];
}

export type ManageSlidesAction =
  | "delete_slide"
  | "replace_slide"
  | "change_slide_position"
  | "rename_slide_project"
  | "delete_slide_project";

export interface ManageSlidesInput {
  project_id: string;
  action: ManageSlidesAction;
  slide_number?: number;
  html_file_path?: string;
  new_position?: number;
  new_project_name?: string;
}

/** Internal persistence shape used by the repository/engine. */
export interface StoredSlideProject {
  id: string;
  name: string;
  description: string;
  /** JSON array of Slide. */
  slides: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredSlideTemplate extends StoredSlideProject {}