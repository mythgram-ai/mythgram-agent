import type Database from "better-sqlite3";

/**
 * Persistence for HTML slide projects and user-created slide templates.
 *
 * Slides are stored as a JSON array (never as separate rows) because a deck is a
 * single ordered unit: reordering/deleting a slide must update the whole project
 * atomically. Built-in templates are NOT stored here — they live in code (see
 * packages/mythgram/src/slides/defaultTemplates.ts); this table only holds user templates
 * saved with save_slides_as_template.
 */
export interface SlideRow {
  id: string;
  name: string;
  description: string;
  /** JSON array of { slide_number, html, file_path?, title? }. */
  slides: string;
  createdAt: number;
  updatedAt: number;
}

export interface SlideTemplateRow extends SlideRow {}

export class SlidesRepo {
  private readonly listProjectsStmt: Database.Statement;
  private readonly getProjectStmt: Database.Statement;
  private readonly upsertProjectStmt: Database.Statement;
  private readonly deleteProjectStmt: Database.Statement;
  private readonly listTemplatesStmt: Database.Statement;
  private readonly getTemplateStmt: Database.Statement;
  private readonly upsertTemplateStmt: Database.Statement;
  private readonly deleteTemplateStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.listProjectsStmt = db.prepare(
      `SELECT id, name, description, slides, created_at AS createdAt, updated_at AS updatedAt
       FROM slide_projects ORDER BY updated_at DESC, created_at DESC`,
    );
    this.getProjectStmt = db.prepare(
      `SELECT id, name, description, slides, created_at AS createdAt, updated_at AS updatedAt
       FROM slide_projects WHERE id = ?`,
    );
    this.upsertProjectStmt = db.prepare(
      `INSERT INTO slide_projects (id, name, description, slides, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         slides = excluded.slides,
         updated_at = excluded.updated_at`,
    );
    this.deleteProjectStmt = db.prepare(`DELETE FROM slide_projects WHERE id = ?`);

    this.listTemplatesStmt = db.prepare(
      `SELECT id, name, description, slides, created_at AS createdAt, updated_at AS updatedAt
       FROM slide_templates ORDER BY updated_at DESC, created_at DESC`,
    );
    this.getTemplateStmt = db.prepare(
      `SELECT id, name, description, slides, created_at AS createdAt, updated_at AS updatedAt
       FROM slide_templates WHERE id = ?`,
    );
    this.upsertTemplateStmt = db.prepare(
      `INSERT INTO slide_templates (id, name, description, slides, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         slides = excluded.slides,
         updated_at = excluded.updated_at`,
    );
    this.deleteTemplateStmt = db.prepare(`DELETE FROM slide_templates WHERE id = ?`);
  }

  listProjects(): SlideRow[] {
    return this.listProjectsStmt.all() as SlideRow[];
  }

  getProject(id: string): SlideRow | null {
    const row = this.getProjectStmt.get(id) as SlideRow | undefined;
    return row ?? null;
  }

  saveProject(row: SlideRow): void {
    this.upsertProjectStmt.run(
      row.id,
      row.name,
      row.description,
      row.slides,
      row.createdAt,
      row.updatedAt,
    );
  }

  deleteProject(id: string): boolean {
    return this.deleteProjectStmt.run(id).changes > 0;
  }

  listTemplates(): SlideTemplateRow[] {
    return this.listTemplatesStmt.all() as SlideTemplateRow[];
  }

  getTemplate(id: string): SlideTemplateRow | null {
    const row = this.getTemplateStmt.get(id) as SlideTemplateRow | undefined;
    return row ?? null;
  }

  saveTemplate(row: SlideTemplateRow): void {
    this.upsertTemplateStmt.run(
      row.id,
      row.name,
      row.description,
      row.slides,
      row.createdAt,
      row.updatedAt,
    );
  }

  deleteTemplate(id: string): boolean {
    return this.deleteTemplateStmt.run(id).changes > 0;
  }
}
