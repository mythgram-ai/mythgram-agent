import { z } from "zod";
import { defineTool, type SubAgentDefinition, type ToolContext, type ToolResult } from "./types.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";

/** Maximum length of the sub-agent's invocation name (its call ID). */
export const MAX_SUB_AGENT_NAME_CHARS = 70;

/** Maximum length of the short description the main agent uses to pick the sub-agent. */
export const MAX_SUB_AGENT_DESC_CHARS = 300;

/**
 * A valid sub-agent name: lowercase letters/digits with single separators (hyphen or underscore),
 * and NO spaces or tabs. Keeping the name a single lowercase token makes it an unambiguous call ID
 * the LLM can target reliably with call_sub_agent (e.g. "deepexplorer", "code-reviewer").
 */
export const SUB_AGENT_NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** The human/model-facing rule explaining the naming constraint, reused in errors and prompts. */
export const SUB_AGENT_NAME_RULE =
  "The sub-agent name must be lowercase, contain no spaces or tabs, and use only lowercase " +
  "letters, digits, and single hyphens or underscores (e.g. \"deepexplorer\" or \"code-reviewer\").";

/**
 * Tools an LLM-authored sub-agent is never granted. This is the single canonical restricted set
 * (SUB_AGENT_RESTRICTED_TOOLS): the sub-agent delegation/meta tools, the human-in-the-loop tools,
 * and the shared todo + skill deletion tools. Every other registered tool is granted by default;
 * the user can further restrict a created sub-agent by editing it afterwards.
 */
export const SUB_AGENT_CREATE_RESTRICTED_TOOLS: readonly string[] = SUB_AGENT_RESTRICTED_TOOLS;

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A sub-agent name is required.")
    .max(
      MAX_SUB_AGENT_NAME_CHARS,
      `The sub-agent name must be ${MAX_SUB_AGENT_NAME_CHARS} characters or fewer.`,
    )
    .regex(SUB_AGENT_NAME_PATTERN, SUB_AGENT_NAME_RULE)
    .describe(
      "Enter a unique name for the sub-agent. This name is its call ID (used with call_sub_agent) " +
        "and must be unique. It must be lowercase with NO spaces or tabs — use only lowercase " +
        "letters, digits, and single hyphens or underscores (e.g. \"deepexplorer\" or " +
        "\"code-reviewer\"). Maximum 70 characters.",
    ),
  description: z
    .string()
    .trim()
    .min(1, "A short description is required.")
    .max(
      MAX_SUB_AGENT_DESC_CHARS,
      `The short description must be ${MAX_SUB_AGENT_DESC_CHARS} characters or fewer.`,
    )
    .describe(
      "Enter a concise description of what the sub-agent is responsible for, when it should be " +
        "used, and what type of work it is designed to perform. This description is used by the " +
        "main agent to understand when the sub-agent is relevant. Maximum 300 characters.",
    ),
  system_prompt: z
    .string()
    .min(1, "A system prompt is required.")
    .describe(
      "Enter the comprehensive system prompt that will control the sub-agent. Define its role, " +
        "objectives, responsibilities, reasoning and execution behavior, workflow, output " +
        "requirements, constraints, failure handling, and any domain-specific instructions it " +
        "must follow. Write the prompt as complete system-level instructions. There is no " +
        "character limit.",
    ),
});

export const buildSubAgentTool = defineTool({
  name: "create_sub_agent",
  description:
    "Create and register a specialized sub-agent that you can invoke for a specific task or " +
    "responsibility. Before creating a sub-agent, define a clear invocation name, a concise " +
    "description of its purpose, and a comprehensive system prompt that fully specifies how the " +
    "sub-agent must behave and operate. The sub-agent name is its call ID and must be unique; it " +
    "must be lowercase with NO spaces or tabs (use only lowercase letters, digits, and single " +
    "hyphens or underscores, e.g. \"deepexplorer\" or \"code-reviewer\"). Do not omit any required " +
    "field. The created sub-agent is saved to the user's browser-local storage (treated as a " +
    "user-owned installed sub-agent) and becomes available to list_sub_agents / call_sub_agent in " +
    "this and future sessions. By default the sub-agent is granted every tool except the restricted " +
    "sub-agent tools (call_sub_agent, call_multiple_sub_agents, list_sub_agents, delete_sub_agent, " +
    "list_sub_agent_sessions, reuse_same_sub_agent_session, create_sub_agent, delete_skill, " +
    "submit_plan, ask_question_to_user, embed_url, attach_files, TodoWrite, read_todos); the user " +
    "can restrict its tools further later.",
  schema,
  label: (args) => `Create Sub-Agent: ${args.name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const available = ctx.availableToolNames;
    if (!available) {
      return {
        ok: false,
        error: {
          code: "registry_unavailable",
          message:
            "The tool registry is not available in this context, so the sub-agent's allowed tools " +
            "could not be determined. create_sub_agent can only be used by the main agent.",
        },
      };
    }

    try {
      const name = args.name.trim();
      const excluded = new Set(SUB_AGENT_CREATE_RESTRICTED_TOOLS);
      const seen = new Set<string>();
      const tools: string[] = [];
      for (const toolName of available) {
        if (seen.has(toolName) || excluded.has(toolName)) continue;
        seen.add(toolName);
        tools.push(toolName);
      }

      const created: SubAgentDefinition = {
        name,
        description: args.description.trim(),
        system_prompt: args.system_prompt,
        tools,
        enabled: true,
      };

      // Register the sub-agent into the live turn so it is immediately callable by call_sub_agent /
      // call_multiple_sub_agents and visible to list_sub_agents in the SAME turn — without waiting
      // for the frontend to persist it and echo it back on the next turn. The frontend still
      // persists it (via the returned created_sub_agent payload) so it survives across turns.
      ctx.subAgents?.register(created);

      return {
        ok: true,
        data: {
          created_sub_agent: created,
          granted_tools: tools.length,
          message:
            `Created sub-agent "${name}" and granted it ${tools.length} tools. It has been saved ` +
            "to the user's browser and is now available via list_sub_agents and call_sub_agent.",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "create_sub_agent_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});