import type { AppConfig } from "../../config.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ChatSession } from "../../services/sessionStore.js";
import type { SessionEventBuffer } from "../../services/eventBuffer.js";
import type { RunAgentRequest } from "../agent.js";
import type { CustomAgentConfig } from "./configuration.js";
import { isConnectorToolName } from "../connectors/index.js";
import { isMcpToolName } from "../mcp/index.js";
import { CHANNEL_ONLY_TOOLS, buildChannelSystemSection } from "../tools/sendResponses.js";
import { resolveCustomAgentSystemPrompt, resolveCustomAgentTools } from "./loader.js";

/**
 * The minimal shape of the shared core agent runtime the Custom Agent runner delegates to. The
 * built-in `AgentRunner` satisfies this structurally, so both the default Main Agent and every
 * Custom Agent execute through the exact same runtime code (spec §11) — same execution lifecycle,
 * ReAct loop, native tool calling, streaming, cancellation, persistence, and memory-agent trigger.
 */
export interface CoreAgentRuntime {
  run(
    request: RunAgentRequest,
    session: ChatSession,
    buffer: SessionEventBuffer,
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * CustomAgentRunner — the dedicated runtime for executing Custom Agents.
 *
 * Architecturally a Custom Agent is a real, independent, TOP-LEVEL Main Agent (spec §5): this runner
 * does NOT wrap the Main Agent as a sub-agent, delegate to it, or require it to be running. It simply
 * parameterizes the SHARED core runtime with the Custom Agent's configuration:
 *   - its edited system prompt (used verbatim), and
 *   - its selected tools, resolved fresh against the live registry (latest schemas; removed tools
 *     dropped safely).
 * Everything else — streaming, tool execution, observations, session/state, error handling,
 * interruption, persistence, the background memory agent — is inherited unchanged from the core
 * runtime, giving Custom Agents full feature parity with the Main Agent.
 */
export class CustomAgentRunner {
  constructor(
    private readonly core: CoreAgentRuntime,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
  ) {}

  /**
   * Execute one autonomous turn for a Custom Agent. The turn runs through the shared core runtime
   * with the Custom Agent's system prompt and allowed tools applied via request overrides.
   */
  async run(
    request: RunAgentRequest,
    agent: CustomAgentConfig,
    session: ChatSession,
    buffer: SessionEventBuffer,
    signal: AbortSignal,
  ): Promise<void> {
    const resolved = resolveCustomAgentTools(this.tools, agent.selectedTools);
    const basePrompt = resolveCustomAgentSystemPrompt(agent, this.config.workspaceRoot);
    // Channel turns append the channel rules (send_responses usage, disabled
    // ask_question_to_user, plan approval via /@ok / /@no) to the Custom Agent's own
    // prompt. Web-app turns never see this section.
    const systemPrompt =
      request.channel && request.channel !== null
        ? `${basePrompt}\n\n${buildChannelSystemSection(request.channel)}`
        : basePrompt;

    // Connector + MCP tool selections (SCREAMING_SNAKE_CASE slugs / `mcp_*`
    // namespaced tools, never in the static registry) are preserved verbatim:
    // the shared core runtime filters the turn's catalogs by this list, so a
    // Custom Agent only reaches the tools it selected.
    const selectedConnectorTools = agent.selectedTools.filter(
      (name) => isConnectorToolName(name) && !resolved.allowed.includes(name),
    );
    const selectedMcpTools = agent.selectedTools.filter(
      (name) => isMcpToolName(name) && !resolved.allowed.includes(name),
    );
    // Channel turns always carry the channel tools, even though they are never selectable
    // in the creation UI (the catalog excludes them — see loader.ts).
    const selectedChannelTools =
      request.channel && request.channel !== null ? [...CHANNEL_ONLY_TOOLS] : [];
    const allowedToolNames = [...resolved.allowed, ...selectedConnectorTools, ...selectedMcpTools, ...selectedChannelTools];

    // Announce which top-level agent is handling this turn (a Custom Agent, not a sub-agent) so the
    // UI/persistence can label it. Sent before the run so it is captured in the event log.
    buffer.append("custom_agent_active", {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      allowed_tools: allowedToolNames,
      missing_tools: resolved.missing,
    });

    const enriched: RunAgentRequest = {
      ...request,
      systemPromptOverride: systemPrompt,
      allowedToolNames,
      customAgent: agent,
    };

    await this.core.run(enriched, session, buffer, signal);
  }
}
