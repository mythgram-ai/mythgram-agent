import { Router, type Request, type Response } from "express";
import type { ToolRegistry } from "../agents/tools/registry.js";
import { isSubAgentRestrictedTool } from "../agents/tools/subAgentRestrictedTools.js";
import { listCustomAgentTools } from "../agents/customagent/index.js";

/** One tool entry advertised to the frontend for sub-agent creation. */
export interface SubAgentToolInfo {
  name: string;
  description: string;
}

/**
 * Tools API — exposes the catalog of tools that can be granted to a sub-agent. The frontend's
 * sub-agent creation popup fetches this list (instead of hardcoding it) so it always mirrors the
 * backend's real tool registry. The restricted sub-agent tools (SUB_AGENT_RESTRICTED_TOOLS) are
 * filtered out here, so the response is exactly the set a sub-agent is allowed to use.
 */
export function buildToolsRouter(tools: ToolRegistry): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    const all: SubAgentToolInfo[] = tools.schemas.map((schema) => ({
      name: schema.function.name,
      description: schema.function.description,
    }));

    // Only the tools a sub-agent is actually allowed to use — the restricted set is removed.
    const subAgentTools = all.filter((tool) => !isSubAgentRestrictedTool(tool.name));

    res.json({
      total: all.length,
      restricted: all.length - subAgentTools.length,
      count: subAgentTools.length,
      tools: subAgentTools,
    });
  });

  /**
   * The catalog of tools a Custom Agent may be granted. A Custom Agent is a top-level Main Agent, so
   * it gets the Main Agent's full tool surface (sub-agent, memory, skills, knowledge, and every other
   * tool) MINUS the multi-agent/team collaboration tools, which never apply to a single top-level
   * agent. The Custom Agent creation UI fetches this so it always mirrors the live tool registry.
   */
  router.get("/custom-agent", (_req: Request, res: Response) => {
    const tools_ = listCustomAgentTools(tools);
    res.json({ total: tools.schemas.length, count: tools_.length, tools: tools_ });
  });

  return router;
}
