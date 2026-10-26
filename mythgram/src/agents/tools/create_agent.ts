import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireCustomAgents } from "./customAgentManagement.js";

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "The name of the custom agent is required.")
      .describe("The name of the custom agent."),
    short_description: z
      .string()
      .trim()
      .min(1, "A short description is required.")
      .describe("A short description of what the custom agent does."),
    system_prompt_file: z
      .string()
      .trim()
      .min(1, "A system prompt file path is required.")
      .describe(
        "Workspace-relative path to the Markdown file containing the custom agent's system prompt, " +
          "for example: workspace/prompt/prompt.md",
      ),
  })
  .strict();

type CreateAgentArgs = z.infer<typeof schema>;

/**
 * create_agent — create a custom AI agent from a workspace Markdown prompt file.
 *
 * Flow the model must follow: first create the Markdown file holding the agent's system
 * prompt (with file_write / apply_patch), then call this tool with the agent name, a
 * short description, and that file's workspace-relative path. The file's FULL contents
 * are saved as the new agent's system prompt verbatim. This creates a top-level custom
 * agent (not a sub-agent).
 */
export const createAgentTool = defineTool({
  name: "create_agent",
  description:
    "Create a custom AI agent from a name, short description, and a workspace-relative Markdown " +
    "file containing the agent's system prompt. The contents of the specified prompt file are " +
    "saved as the agent's system prompt.",
  schema,
  label: (args: CreateAgentArgs) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    return name ? `Create Agent: ${name}` : "Create Agent";
  },
  async execute(args: CreateAgentArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireCustomAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.customAgents!.create(
      {
        name: args.name,
        shortDescription: args.short_description,
        systemPromptFile: args.system_prompt_file,
        availableToolNames: ctx.availableToolNames,
      },
      ctx,
    );
  },
});
