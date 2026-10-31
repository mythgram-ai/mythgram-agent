import { zodToJsonSchema } from "zod-to-json-schema";
import type { AnyTool, ToolContext, ToolResult } from "./types.js";

/** OpenAI-compatible function/tool schema. */
export interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * ToolRegistry keeps the tools and derives OpenAI function schemas from each tool's zod schema.
 * Registering a new tool is a single `register(tool)` call — schemas + validation come for free.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>();
  private cachedSchemas: OpenAIToolSchema[] | null = null;

  register(tool: AnyTool): this {
    this.tools.set(tool.name, tool);
    this.cachedSchemas = null;
    return this;
  }

  registerAll(tools: AnyTool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  /** OpenAI `tools` array passed to the provider on every request. */
  get schemas(): OpenAIToolSchema[] {
    if (this.cachedSchemas) return this.cachedSchemas;
    this.cachedSchemas = Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema, {
          target: "openApi3",
          $refStrategy: "none",
        }) as Record<string, unknown>,
      },
    }));
    return this.cachedSchemas;
  }

  /**
   * OpenAI `tools` array restricted to a subset of tool names (order follows the registry).
   * Used to give a sub-agent only the tools its definition allows. Unknown names are ignored.
   */
  schemasFor(names: Iterable<string>): OpenAIToolSchema[] {
    const allow = new Set(names);
    return this.schemas.filter((schema) => allow.has(schema.function.name));
  }

  /** All registered tool names. */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Human friendly label for UI chips; tolerant of unparsed args. */
  label(name: string, args: Record<string, unknown>): string {
    const tool = this.tools.get(name);
    if (!tool) return name;
    try {
      return tool.label(args as never);
    } catch {
      return name;
    }
  }

  /** Validate arguments with the tool's zod schema, then execute. Never throws. */
  async execute(
    name: string,
    rawArgs: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: { code: "unknown_tool", message: `Unknown tool: ${name}` } };
    }

    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "invalid_arguments",
          message: `Invalid arguments for ${name}: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        },
      };
    }

    try {
      return await tool.execute(parsed.data as never, ctx);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "tool_execution_failed",
          message: `Tool '${name}' failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }
}
