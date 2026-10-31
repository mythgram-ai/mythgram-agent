import type { ToolContext, ToolResult } from "../agents/tools/types.js";
import { SlidesEngineError, SlidesManager, toProjectSummary, toTemplateSummary } from "./engine.js";
import { SlidesTemplateChoiceStore } from "./choiceStore.js";
import type {
  ManageSlidesInput,
  OrganizeSlidesInput,
  SlideProject,
  SlideTemplate,
} from "./types.js";

/** ask_user_to_choose_slides_template waits exactly two minutes for the user's choice. */
export const SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS = 120_000;

/** Message returned to the model when the user made no choice in time. */
export const SLIDES_TEMPLATE_CHOICE_TIMEOUT_MESSAGE =
  "The user did not choose a slide template within two minutes. Continue autonomously: pick the " +
  "most suitable template from the list yourself (get_available_slides_template, then " +
  "read_slides_template) and proceed with the task.";

/** Message returned when the tool is called on a messaging-channel turn. */
export const SLIDES_TEMPLATE_CHOICE_CHANNEL_UNAVAILABLE =
  "ask_user_to_choose_slides_template is not available in messaging channels (Telegram, Discord, " +
  "Slack) because they have no interactive template picker. Choose the most suitable template " +
  "yourself with get_available_slides_template and read_slides_template, then continue.";

/**
 * Runtime bridge injected into ToolContext for every agent surface that may create,
 * present, and manage slides: the Main Agent, Custom Agents, and every team/CEO agent.
 * It wraps the persistent SlidesManager plus the in-memory template-choice store.
 */
export interface SlidesRuntime {
  listTemplates(): ToolResult;
  readTemplates(templateIds: string[]): ToolResult;
  organizeSlides(input: OrganizeSlidesInput, ctx: ToolContext): Promise<ToolResult>;
  presentProjects(projectIds: string[], ctx: ToolContext): ToolResult;
  manageSlides(input: ManageSlidesInput, ctx: ToolContext): Promise<ToolResult>;
  saveAsTemplate(projectId: string, ctx: ToolContext): ToolResult;
  askUserToChooseTemplate(ctx: ToolContext): Promise<ToolResult>;
}

/** Map an engine/domain error to the structured ToolResult shape the model understands. */
export function slidesFailure(error: unknown): ToolResult {
  if (error instanceof SlidesEngineError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...error.extra,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "slides_operation_failed",
      message: `Slide operation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  };
}

function templateSummary(template: SlideTemplate) {
  return toTemplateSummary(template);
}

/**
 * Build the per-turn SlidesRuntime. The manager is the single persistent source of
 * truth (SQLite slide_projects / slide_templates); the choice store coordinates the
 * interactive template picker.
 */
export function createSlidesRuntime(
  manager: SlidesManager,
  choices: SlidesTemplateChoiceStore,
): SlidesRuntime {
  return {
    listTemplates: () => {
      try {
        const templates = manager.listTemplateSummaries();
        return {
          ok: true,
          data: {
            count: templates.length,
            templates,
            message:
              templates.length === 0
                ? "No slide templates are available."
                : "Use read_slides_template with a template id to inspect the full HTML of a template.",
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },

    readTemplates: (templateIds) => {
      try {
        const templates = manager.readTemplates(templateIds);
        return {
          ok: true,
          data: {
            count: templates.length,
            templates: templates.map((template) => ({
              id: template.id,
              name: template.name,
              description: template.description,
              builtin: template.builtin,
              slides: template.slides.map((slide) => ({
                slide_number: slide.slide_number,
                title: slide.title,
                html: slide.html,
              })),
            })),
            message:
              "These are the complete raw HTML slides of the requested template(s). Use them as a structural and visual reference, then create the user's slides as new HTML files.",
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },

    organizeSlides: async (input, ctx) => {
      try {
        const project = await manager.organizeSlides(input, ctx.workspaceRoot);
        const summary = toProjectSummary(project);
        return {
          ok: true,
          data: {
            created: true,
            project: summary,
            project_id: project.id,
            message:
              `Created slide project "${project.name}" (project_id: ${project.id}) with ` +
              `${project.slides.length} slide(s). Use present_slides with this project id to show it to the user.`,
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },

    presentProjects: (projectIds, ctx) => {
      try {
        const projects: SlideProject[] = [];
        const missing: string[] = [];
        for (const id of projectIds) {
          const project = manager.getProject(id);
          if (project) projects.push(project);
          else missing.push(id);
        }
        if (missing.length > 0) {
          return {
            ok: false,
            error: {
              code: "project_not_found",
              message: `Unknown slide project id(s): ${missing.join(", ")}.`,
              missing_project_ids: missing,
              available_projects: manager.listProjectSummaries().map((project) => ({
                id: project.id,
                name: project.name,
              })),
            },
          };
        }

        try {
          ctx.emit?.("slides_present", {
            // The frontend attaches the deck to THIS tool block so it remains viewable
            // in the conversation instead of opening a one-time popup.
            tool_call_id: ctx.toolCallId ?? null,
            projects: projects.map((project) => ({
              id: project.id,
              name: project.name,
              description: project.description,
              slides: project.slides,
            })),
          });
        } catch {
          // Presentation is best-effort; the structured result still tells the model what happened.
        }

        return {
          ok: true,
          data: {
            presented: true,
            count: projects.length,
            projects: projects.map(toProjectSummary),
            message:
              "The slide project preview(s) are now rendered inside the present_slides tool block in the user's conversation. Ask the user for feedback or continue with any requested changes.",
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },

    manageSlides: async (input, ctx) => {
      try {
        const project = await manager.manageSlides(input, ctx.workspaceRoot);
        if (!project) {
          return {
            ok: true,
            data: {
              deleted: true,
              project_id: input.project_id,
              action: input.action,
              message: `Deleted slide project ${input.project_id}.`,
            },
          };
        }
        return {
          ok: true,
          data: {
            completed: true,
            action: input.action,
            project: toProjectSummary(project),
            message: `Applied "${input.action}" to slide project "${project.name}".`,
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },

    saveAsTemplate: (projectId, ctx) => {
      try {
        const template = manager.saveAsTemplate(projectId);
        try {
          ctx.emit?.("slides_templates_updated", {
            templates: manager.listTemplateSummaries(),
          });
        } catch {
          // best-effort mirror for the panel
        }
        return {
          ok: true,
          data: {
            saved: true,
            template: templateSummary(template),
            message:
              `Saved slide project as reusable template "${template.name}" (template_id: ${template.id}).`,
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },

    askUserToChooseTemplate: async (ctx) => {
      if (ctx.channel) {
        return {
          ok: true,
          data: {
            tool: "ask_user_to_choose_slides_template",
            templates: manager.listTemplateSummaries(),
            decision: "channel_unavailable",
            message: SLIDES_TEMPLATE_CHOICE_CHANNEL_UNAVAILABLE,
          },
        };
      }

      try {
        const templates = manager.listTemplateSummaries();
        if (templates.length === 0) {
          return {
            ok: false,
            error: {
              code: "no_slide_templates",
              message: "No slide templates are available to choose from.",
            },
          };
        }

        const chatId = ctx.chatId ?? ctx.toolCallId ?? "unknown";
        const toolCallId = ctx.toolCallId ?? `slides_choice_${Date.now()}`;

        try {
          ctx.emit?.("slides_template_choice", {
            id: toolCallId,
            chat_id: chatId,
            templates,
            timeout_ms: SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS,
          });
        } catch {
          // The emit is best-effort; the user can still answer through the pending store.
        }

        const result = await choices.create({
          chatId,
          toolCallId,
          timeoutMs: SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS,
          signal: ctx.signal,
        });

        if (result.decision === "selected") {
          const selected = result.templateId ? manager.getTemplate(result.templateId) : null;
          if (!selected) {
            return {
              ok: false,
              error: {
                code: "template_not_found",
                message: `The selected template "${result.templateId ?? ""}" is no longer available.`,
                available_templates: templates.map((template) => ({
                  id: template.id,
                  name: template.name,
                })),
              },
            };
          }
          return {
            ok: true,
            data: {
              tool: "ask_user_to_choose_slides_template",
              decision: "selected",
              template: templateSummary(selected),
              templates,
              message:
                `The user chose template "${selected.name}" (template_id: ${selected.id}). ` +
                "Read it with read_slides_template, then build the slides.",
            },
          };
        }

        if (result.decision === "timeout") {
          return {
            ok: true,
            data: {
              tool: "ask_user_to_choose_slides_template",
              decision: "timeout",
              templates,
              timed_out: true,
              message: SLIDES_TEMPLATE_CHOICE_TIMEOUT_MESSAGE,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "aborted",
            message: "The template choice was aborted before the user selected a template.",
          },
        };
      } catch (error) {
        return slidesFailure(error);
      }
    },
  };
}