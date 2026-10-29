import { Router, type Request, type Response } from "express";
import { SlidesEngineError, toTemplateSummary } from "../slides/engine.js";
import type { SlidesManager } from "../slides/engine.js";
import { DEFAULT_SLIDE_TEMPLATES } from "../slides/defaultTemplates.js";

/**
 * Slides API — preview/manage slide templates and projects for the frontend panel.
 *
 * The agent tools write through the same SlidesManager, so a project the agent creates
 * appears in the panel immediately (and vice versa). Built-in templates are read-only.
 */
export function buildSlidesRouter(manager: SlidesManager): Router {
  const router = Router();

  const fail = (res: Response, error: unknown): void => {
    if (error instanceof SlidesEngineError) {
      res.status(400).json({ error: error.message, code: error.code, ...error.extra });
      return;
    }
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      code: "slides_operation_failed",
    });
  };

  /** List every available template (built-in + user-created) without slide HTML. */
  router.get("/templates", (_req: Request, res: Response) => {
    try {
      const templates = manager.listTemplateSummaries();
      res.json({ ok: true, count: templates.length, templates });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Restore (re-expose) the built-in templates. They are always available, so this is a no-op list. */
  router.post("/templates/restore-defaults", (_req: Request, res: Response) => {
    res.json({ ok: true, templates: DEFAULT_SLIDE_TEMPLATES.map(toTemplateSummary) });
  });

  /** Read one template with its complete slide HTML (for preview). */
  router.get("/templates/:id", (req: Request, res: Response) => {
    try {
      const template = manager.getTemplate(String(req.params.id));
      if (!template) {
        res.status(404).json({ error: "Slide template not found.", code: "template_not_found" });
        return;
      }
      res.json({ ok: true, template });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Delete a user-created template. Built-in templates return a structured error. */
  router.delete("/templates/:id", (req: Request, res: Response) => {
    try {
      const removed = manager.deleteTemplate(String(req.params.id));
      res.json({ ok: removed, templates: manager.listTemplateSummaries() });
    } catch (error) {
      fail(res, error);
    }
  });

  /** List every slide project (newest first) without slide HTML. */
  router.get("/projects", (_req: Request, res: Response) => {
    try {
      const projects = manager.listProjectSummaries();
      res.json({ ok: true, count: projects.length, projects });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Read one slide project with its complete slide HTML (for preview). */
  router.get("/projects/:id", (req: Request, res: Response) => {
    try {
      const project = manager.getProject(String(req.params.id));
      if (!project) {
        res.status(404).json({ error: "Slide project not found.", code: "project_not_found" });
        return;
      }
      res.json({ ok: true, project });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Save an existing project as a reusable template (same behavior as the agent tool). */
  router.post("/projects/:id/save-as-template", (req: Request, res: Response) => {
    try {
      const template = manager.saveAsTemplate(String(req.params.id));
      res.json({ ok: true, template, templates: manager.listTemplateSummaries() });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Delete a slide project. */
  router.delete("/projects/:id", (req: Request, res: Response) => {
    try {
      const removed = manager.deleteProject(String(req.params.id));
      res.json({ ok: removed, projects: manager.listProjectSummaries() });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}