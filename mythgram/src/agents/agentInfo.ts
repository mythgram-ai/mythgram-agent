import type { AgentInfoRuntime, AgentSelfInfo, TodoItem } from "./tools/types.js";
import { createAgentInfoRuntime } from "./tools/whoIm.js";

/**
 * Input for {@link createAgentInfoRuntimeFrom}. Every field is optional except the identity type,
 * the workspace root, and the available tool names, so each agent surface supplies only what it
 * actually knows.
 */
export interface AgentInfoInput {
  /** Which kind of agent this is. */
  type: AgentSelfInfo["agent"]["type"];
  id?: string;
  name?: string;
  description?: string;
  role?: string;
  provider?: string;
  model?: string;
  visionCapable?: boolean;
  workspaceRoot: string;
  contextLimit?: number | null;
  summaryThreshold?: number;
  contextManagementMethod?: string;
  slidingWindowTruncatePercent?: number;
  availableTools: readonly string[];
  skills?: Array<{ name: string; description: string }>;
  subAgents?: Array<{ name: string; description: string }>;
  mcpServers?: string[];
  connectors?: string[];
  userProfile?: { id?: string; name?: string; description?: string } | null;
  memoryFiles?: Array<{ path: string }>;
  knowledgeFiles?: Array<{ path: string }>;
  todos?: TodoItem[];
}

/**
 * Assemble an {@link AgentInfoRuntime} from the values a surface knows. Missing optional pieces are
 * simply omitted so `who_im` never reports empty sections. Never throws.
 */
export function createAgentInfoRuntimeFrom(input: AgentInfoInput): AgentInfoRuntime {
  const info: AgentSelfInfo = {
    agent: {
      type: input.type,
      ...(input.id ? { id: input.id } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.role ? { role: input.role } : {}),
    },
    model: {
      ...(input.model ? { id: input.model } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      vision_capable: input.visionCapable === true,
    },
    context: {
      context_limit: typeof input.contextLimit === "number" ? input.contextLimit : null,
      ...(typeof input.summaryThreshold === "number"
        ? { summary_threshold: input.summaryThreshold }
        : {}),
      ...(input.contextManagementMethod
        ? { context_management_method: input.contextManagementMethod }
        : {}),
      ...(typeof input.slidingWindowTruncatePercent === "number"
        ? { sliding_window_truncate_percent: input.slidingWindowTruncatePercent }
        : {}),
      available_tools: [...input.availableTools],
      tool_count: input.availableTools.length,
    },
    workspace_root: input.workspaceRoot,
    generated_at: new Date().toISOString(),
  };

  if (input.skills && input.skills.length > 0) info.skills = input.skills;
  if (input.subAgents && input.subAgents.length > 0) info.sub_agents = input.subAgents;
  if (input.mcpServers && input.mcpServers.length > 0) info.mcp_servers = input.mcpServers;
  if (input.connectors && input.connectors.length > 0) info.connectors = input.connectors;
  if (input.userProfile) {
    info.user_profile = {
      ...(input.userProfile.id ? { id: input.userProfile.id } : {}),
      ...(input.userProfile.name ? { name: input.userProfile.name } : {}),
      ...(input.userProfile.description ? { description: input.userProfile.description } : {}),
    };
  }
  if (input.memoryFiles && input.memoryFiles.length > 0) {
    info.memory = {
      file_count: input.memoryFiles.length,
      paths: input.memoryFiles.map((f) => f.path),
    };
  }
  if (input.knowledgeFiles && input.knowledgeFiles.length > 0) {
    info.knowledge = {
      file_count: input.knowledgeFiles.length,
      paths: input.knowledgeFiles.map((f) => f.path),
    };
  }
  if (input.todos && input.todos.length > 0) {
    const count = (status: TodoItem["status"]): number =>
      input.todos!.filter((t) => t.status === status).length;
    info.todos = {
      total: input.todos.length,
      pending: count("pending"),
      in_progress: count("in_progress"),
      completed: count("completed"),
    };
  }

  return createAgentInfoRuntime(info);
}

/**
 * Resolve the active user profile's display fields from a UserProfileManager-shaped object.
 * Kept structural (not importing the manager) so callers can pass the manager directly.
 */
export function activeProfileInfo(
  manager:
    | { getActive(): { id: string; name: string; description: string } }
    | undefined,
): { id?: string; name?: string; description?: string } | null {
  if (!manager) return null;
  try {
    const profile = manager.getActive();
    return { id: profile.id, name: profile.name, description: profile.description };
  } catch {
    return null;
  }
}
