/**
 * The single canonical list of tools that are RESTRICTED from the sub-agent system.
 *
 * These tools are never available to a sub-agent — no matter how the sub-agent was created
 * (manually by the user in the UI, automatically by the LLM via create_sub_agent, or shipped as a
 * built-in default) and no matter how it is run. They fall into three groups:
 *
 *  - Sub-agent delegation/meta tools (a sub-agent must never spawn or manage other sub-agents):
 *      call_sub_agent, call_multiple_sub_agents, list_sub_agents, delete_sub_agent,
 *      list_sub_agent_sessions, reuse_same_sub_agent_session, create_sub_agent
 *  - Human-in-the-loop tools (only the main agent talks to the user / plans / presents results):
 *      ask_question_to_user, submit_plan, embed_url, attach_files
 *  - Skill deletion + the shared todo list (main-agent-only responsibilities):
 *      delete_skill, TodoWrite, read_todos
 *  - Multi-agent team collaboration tools (only for team agents — head/members):
 *      delegate_task_or_send_message, get_team_members_status, send_message_to_team,
 *      list_agent_team_members, message_team_leader
 *  - Channel-only tools (only for Main/Custom Agent turns arriving from a channel):
 *      send_responses
 *  - Agent-driven MCP management tools (only for main/custom/team/CEO agents):
 *      connect_remote_mcp, connect_local_mcp_server, list_available_mcp_servers,
 *      delete_mcp_server, on_off_mcp_server, get_mcp_server_status
 *  - Agent-driven application-connector management tools (only for main/custom/team/CEO agents):
 *      connect_applications_connectors, list_available_application_connectors,
 *      disconnect_application_connector, get_application_connector_status
 *  - Agent-driven communication-channel management tools (only for main/custom/team/CEO agents):
 *      request_channel_connection_to_user, list_available_channels, disconnect_channels,
 *      get_channel_status, send_message_to_communication_channel
 *  - Prompt-library tools (only for main/custom/team/CEO agents):
 *      save_prompt_in_prompt_library, delete_prompt_from_prompt_library,
 *      list_available_prompts_in_prompt_library
 *  - Custom-system-prompt tools (only for main/custom/team/CEO agents):
 *      save_custom_system_prompt, delete_custom_system_prompt,
 *      list_available_custom_system_prompt
 *  - Agent-driven custom-agent management tools (only for main/custom/team/CEO agents):
 *      create_agent, list_available_agents, delete_agent
 *
 * This list is the ONE source of truth. It is reused by:
 *  - subagents.ts (SUB_AGENT_EXCLUDED_TOOLS)         — runtime enforcement for every sub-agent run
 *  - buildsubagent.ts (SUB_AGENT_CREATE_RESTRICTED_TOOLS) — LLM-created sub-agents
 *  - sub-agents/index.ts (DEFAULT_SUB_AGENT_DISALLOWED_TOOLS) — built-in default sub-agents
 *  - api/tools.ts (the /api/tools endpoint)          — the tools the UI offers on manual creation
 *
 * Keep it in exactly one place; do not fork it.
 */
export const SUB_AGENT_RESTRICTED_TOOLS: readonly string[] = [
  "call_sub_agent",
  "call_multiple_sub_agents",
  "list_sub_agents",
  "delete_sub_agent",
  "list_sub_agent_sessions",
  "reuse_same_sub_agent_session",
  "create_sub_agent",
  "delete_skill",
  "submit_plan",
  "ask_question_to_user",
  "embed_url",
  "attach_files",
  "TodoWrite",
  "read_todos",
  // Multi-agent team collaboration tools — only for team agents (head/members), never sub-agents.
  "delegate_task_or_send_message",
  "get_team_members_status",
  "send_message_to_team",
  "list_agent_team_members",
  "message_team_leader",
  // CEO multi-agent tools — only for the CEO / team leaders inside a CEO system, never sub-agents.
  "assign_tasks_to_teams",
  "list_teams",
  "report_task_completion_to_ceo",
  // Messaging-channel tools — only for Main/Custom Agent turns arriving from a channel.
  "send_responses",
  // Agent-driven MCP management tools — only for main/custom/team/CEO agents, never sub-agents.
  "connect_remote_mcp",
  "connect_local_mcp_server",
  "list_available_mcp_servers",
  "delete_mcp_server",
  "on_off_mcp_server",
  "get_mcp_server_status",
  // Agent-driven application-connector management tools — only for main/custom/team/CEO agents.
  "connect_applications_connectors",
  "list_available_application_connectors",
  "disconnect_application_connector",
  "get_application_connector_status",
  // Agent-driven communication-channel management tools — only for main/custom/team/CEO agents.
  "request_channel_connection_to_user",
  "list_available_channels",
  "disconnect_channels",
  "get_channel_status",
  "send_message_to_communication_channel",
  // Prompt-library management tools — only for main/custom/team/CEO agents, never sub-agents.
  "save_prompt_in_prompt_library",
  "delete_prompt_from_prompt_library",
  "list_available_prompts_in_prompt_library",
  // Custom-system-prompt management tools — only for main/custom/team/CEO agents, never sub-agents.
  "save_custom_system_prompt",
  "delete_custom_system_prompt",
  "list_available_custom_system_prompt",
  // Agent-driven custom-agent management tools — only for main/custom/team/CEO agents.
  "create_agent",
  "list_available_agents",
  "delete_agent",
];

/** Fast membership test for the restricted set. */
const RESTRICTED = new Set(SUB_AGENT_RESTRICTED_TOOLS);

/** True when a tool name is restricted from the sub-agent system. */
export function isSubAgentRestrictedTool(name: string): boolean {
  return RESTRICTED.has(name);
}
