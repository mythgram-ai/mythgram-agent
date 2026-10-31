/**
 * The single canonical list of the multi-agent collaboration tools.
 *
 * These five tools exist ONLY for agents that are part of an active agent team (a head/leader and
 * its members). They are never exposed to the normal single agent or to sub-agents — the normal
 * agent registry filters them out (see agent.ts), and each team agent is shown only the subset
 * appropriate for its role (see the multiagent runtime). Keep this list as the one source of truth.
 *
 *  - delegate_task_or_send_message — LEADER ONLY: assign tasks to / message one or more members.
 *  - get_team_members_status       — LEADER ONLY: inspect member statuses (idle/working/queued/...).
 *  - send_message_to_team          — LEADER + MEMBERS (sensitive; disabled by default): free-form
 *                                    agent-to-agent messaging between any team members.
 *  - list_agent_team_members       — LEADER + MEMBERS: list the team members (name + description).
 *  - message_team_leader           — MEMBERS ONLY: report to / message the head/leader.
 */
export const TEAM_TOOL_NAMES = [
  "delegate_task_or_send_message",
  "get_team_members_status",
  "send_message_to_team",
  "list_agent_team_members",
  "message_team_leader",
] as const;

export type TeamToolName = (typeof TEAM_TOOL_NAMES)[number];

/**
 * The multi-agent tools that exist ONLY for the CEO multi-agent system (a CEO agent that controls
 * several agent teams' head/leaders). Like the five team tools, they are never exposed to the normal
 * single agent, Custom Agents, or sub-agents; each CEO-mode agent is shown only the subset
 * appropriate for its role (see teamTools' allowedCeoAgentTools + the CEO runtime).
 *
 *  - assign_tasks_to_teams           — CEO ONLY: assign task prompts to one or more team leaders.
 *  - list_teams                      — CEO ONLY: list every controlled team (leaders + members).
 *  - report_task_completion_to_ceo   — TEAM LEADER ONLY (in CEO mode): report completion to the CEO.
 */
export const CEO_TOOL_NAMES = [
  "assign_tasks_to_teams",
  "list_teams",
  "report_task_completion_to_ceo",
] as const;

export type CeoToolName = (typeof CEO_TOOL_NAMES)[number];

/** Every multi-agent tool (ordinary team tools + CEO tools) — hidden from the single agent, Custom
 * Agents, and sub-agents. This is the union used by every "these tools only exist inside a team/CEO
 * system" filter, so adding a new collaboration tool in one place propagates everywhere. */
export const ALL_MULTI_AGENT_TOOL_NAMES: readonly string[] = [...TEAM_TOOL_NAMES, ...CEO_TOOL_NAMES];

/** Fast membership test for the team tool set. */
const TEAM_TOOL_SET = new Set<string>(TEAM_TOOL_NAMES);

/** Fast membership test for the CEO tool set. */
const CEO_TOOL_SET = new Set<string>(CEO_TOOL_NAMES);

/** True when a tool name is one of the five multi-agent collaboration tools. */
export function isTeamTool(name: string): boolean {
  return TEAM_TOOL_SET.has(name);
}

/** True when a tool name is one of the CEO multi-agent tools. */
export function isCeoTool(name: string): boolean {
  return CEO_TOOL_SET.has(name);
}

/** Team tools available to the head/leader (delegation, status, listing). */
export const LEADER_TEAM_TOOLS: readonly string[] = [
  "delegate_task_or_send_message",
  "get_team_members_status",
  "list_agent_team_members",
];

/** Team tools available to a member (reporting to the leader, listing). */
export const MEMBER_TEAM_TOOLS: readonly string[] = ["message_team_leader", "list_agent_team_members"];

/** The sensitive tool that is only added (for BOTH roles) when the user has enabled it in Settings. */
export const OPTIONAL_TEAM_TOOL = "send_message_to_team";

/**
 * The tools a team agent (head or member) may NEVER use, on top of the team tools it is not granted
 * for its role. The human-in-the-loop tools are excluded because several team agents run
 * concurrently and a blocking user prompt from a background agent would be confusing/deadlock-prone;
 * only the head reports to the user in natural language. The sub-agent session-reuse tools are
 * gated exactly like they are for the single agent.
 */
export const TEAM_AGENT_BASE_EXCLUDED_TOOLS: readonly string[] = [
  "submit_plan",
  "ask_question_to_user",
  "list_sub_agent_sessions",
  "reuse_same_sub_agent_session",
  // Channel-only tools never apply inside a team: teams never serve channel turns.
  "send_responses",
];

/**
 * Compute the tool names a team agent is allowed to use, given the full registry names, the agent's
 * role, and whether the sensitive send_message_to_team tool is enabled. All non-team tools stay
 * available (files, shell, web, memory, knowledge, skills, sub-agents, todos, wait, ...) except the
 * base-excluded set; the role's team tools are added on top. Connector + MCP tools (connected apps
 * and MCP servers) are appended uncapped — every connected tool is available to every team agent.
 */
export function allowedTeamAgentTools(
  registryNames: readonly string[],
  role: "leader" | "member",
  sendMessageEnabled: boolean,
  connectorToolNames: readonly string[] = [],
  mcpToolNames: readonly string[] = [],
): string[] {
  const excluded = new Set<string>(TEAM_AGENT_BASE_EXCLUDED_TOOLS);
  // Strip ALL multi-agent tools first (ordinary team + CEO); the role-appropriate ones are added
  // back below. In the ordinary team mode no CEO tools are ever granted.
  for (const name of ALL_MULTI_AGENT_TOOL_NAMES) excluded.add(name);

  const allowed = registryNames.filter((name) => !excluded.has(name));

  const roleTools = role === "leader" ? LEADER_TEAM_TOOLS : MEMBER_TEAM_TOOLS;
  for (const name of roleTools) {
    if (registryNames.includes(name)) allowed.push(name);
  }
  if (sendMessageEnabled && registryNames.includes(OPTIONAL_TEAM_TOOL)) {
    allowed.push(OPTIONAL_TEAM_TOOL);
  }
  for (const name of connectorToolNames) {
    if (!allowed.includes(name)) allowed.push(name);
  }
  for (const name of mcpToolNames) {
    if (!allowed.includes(name)) allowed.push(name);
  }
  return allowed;
}

/** Role of an agent inside the CEO multi-agent system: the single CEO, a team head/leader, or a
 * specialist member of one of the controlled teams. */
export type CeoAgentRole = "ceo" | "leader" | "member";

/** The CEO's own tools: assign tasks to teams and list the controlled teams. */
export const CEO_AGENT_TOOLS: readonly string[] = ["assign_tasks_to_teams", "list_teams"];

/** The CEO-mode addition for a team head/leader: report task completion up to the CEO. */
export const CEO_LEADER_TOOL = "report_task_completion_to_ceo";

/**
 * Compute the tool names an agent may use inside the CEO multi-agent system, given the full registry
 * names, the agent's role, and whether the sensitive send_message_to_team tool is enabled.
 *
 * - The CEO gets all non-multi-agent tools (files, shell, web, memory, ...) plus assign_tasks_to_teams
 *   and list_teams. It never gets the team delegation tools (it delegates only through team leaders).
 * - A team head/leader gets exactly the ordinary leader surface PLUS report_task_completion_to_ceo so
 *   it can report back up to the CEO once its members finish.
 * - A member gets exactly the ordinary member surface (unchanged from the normal team mode).
 *
 * All multi-agent tools are stripped first, then only the role-appropriate ones are added back — so no
 * agent can ever reach a tool outside its role.
 */
export function allowedCeoAgentTools(
  registryNames: readonly string[],
  role: CeoAgentRole,
  sendMessageEnabled: boolean,
  connectorToolNames: readonly string[] = [],
  mcpToolNames: readonly string[] = [],
): string[] {
  const excluded = new Set<string>(TEAM_AGENT_BASE_EXCLUDED_TOOLS);
  for (const name of ALL_MULTI_AGENT_TOOL_NAMES) excluded.add(name);

  const allowed = registryNames.filter((name) => !excluded.has(name));

  if (role === "ceo") {
    for (const name of CEO_AGENT_TOOLS) {
      if (registryNames.includes(name)) allowed.push(name);
    }
    for (const name of connectorToolNames) {
      if (!allowed.includes(name)) allowed.push(name);
    }
    for (const name of mcpToolNames) {
      if (!allowed.includes(name)) allowed.push(name);
    }
    return allowed;
  }

  const roleTools = role === "leader" ? LEADER_TEAM_TOOLS : MEMBER_TEAM_TOOLS;
  for (const name of roleTools) {
    if (registryNames.includes(name)) allowed.push(name);
  }
  // The team head/leader additionally reports completion up to the CEO.
  if (role === "leader" && registryNames.includes(CEO_LEADER_TOOL)) {
    allowed.push(CEO_LEADER_TOOL);
  }
  if (sendMessageEnabled && registryNames.includes(OPTIONAL_TEAM_TOOL)) {
    allowed.push(OPTIONAL_TEAM_TOOL);
  }
  for (const name of connectorToolNames) {
    if (!allowed.includes(name)) allowed.push(name);
  }
  for (const name of mcpToolNames) {
    if (!allowed.includes(name)) allowed.push(name);
  }
  return allowed;
}
