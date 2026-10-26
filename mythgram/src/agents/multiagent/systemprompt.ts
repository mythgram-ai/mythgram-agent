import { SYSTEM_SENDER_ID, USER_SENDER_ID } from "./types.js";
import type { AgentTeamDefinition, MailboxMessage, TeamMemberDefinition } from "./types.js";

/** A readable roster of the whole team (leader + members) with descriptions — shared by all agents. */
function rosterBlock(team: AgentTeamDefinition): string {
  const lines: string[] = [
    `Team name: "${team.name}"`,
    `Team leader (head): "${team.leader_name}"`,
    "Members:",
  ];
  if (team.members.length === 0) {
    lines.push("  (no specialist members)");
  } else {
    for (const m of team.members) {
      lines.push(`  - "${m.name}" — ${m.description || "(no description)"}`);
    }
  }
  return lines.join("\n");
}

/** The environment block shared by every team agent. */
function environmentBlock(workspaceRoot: string): string {
  return `# Environment
- You run on the user's machine and share ONE workspace with the rest of the team: ${workspaceRoot}
- All file paths are relative to this workspace (file_read requires an absolute path). Shell commands run from it. Files you create persist on disk and are visible to your teammates.
- To edit files, prefer apply_patch: pass one "input" string wrapped in "*** Begin Patch" … "*** End Patch" with "*** Add File: <path>", "*** Update File: <path>" (optional "*** Move to: <path>", then "@@" hunks whose lines start with " " for context, "-" to delete a line, or "+" to add a line), or "*** Delete File: <path>". Paths must be ABSOLUTE. The whole patch is validated and dry-run before any file is written. str_replace / apply_multiple_edits / file_write remain available too.
- Use real native tool calls only. Never describe a tool call in prose or invent tools you were not given.
- You share the team's memory and knowledge base with your teammates; coordinate through the team tools, not by guessing what others are doing.
- You also share the user's prompt library with the whole organization: save a reusable prompt with save_prompt_in_prompt_library (title + short description + the complete prompt), permanently remove one with delete_prompt_from_prompt_library (call list_available_prompts_in_prompt_library first to get the exact prompt_id), and inspect what exists with list_available_prompts_in_prompt_library. A prompt you save appears in the user's Prompt Library immediately, so store reusable prompts there instead of copying them into files.
- You also share the user's custom system prompts with the whole organization: save one with save_custom_system_prompt (first write the COMPLETE prompt into a workspace file, then pass a unique name + short description + that file's absolute path), permanently remove one with delete_custom_system_prompt (call list_available_custom_system_prompt first to get the exact 20-digit id), and inspect what exists with list_available_custom_system_prompt. Never invent or modify ids.
- You also share the user's custom agents with the whole organization: create a top-level custom agent with create_agent (first write its system prompt into a workspace Markdown file, then pass name + short description + that file's path), inspect what exists with list_available_agents (exact names + short descriptions), and permanently remove one with delete_agent (call list_available_agents first for the exact name). An agent you create or delete persists immediately everywhere.`;
}

/** Guidance on the collaboration tools, tailored to whether send_message_to_team is enabled. When a
 * `ceoName` is provided, the team is operating under a CEO agent and the leader additionally sees the
 * report_task_completion_to_ceo tool. */
function collaborationToolsBlock(
  isLeader: boolean,
  sendMessageEnabled: boolean,
  ceoName?: string,
): string {
  const lines: string[] = ["# Team collaboration tools (native function calls)"];
  lines.push(
    "- list_agent_team_members(): List everyone on the team with their role and description. Use it to pick the right specialist.",
  );
  if (isLeader) {
    lines.push(
      "- delegate_task_or_send_message(messages[]): Assign tasks to — or message — one or more members at once. Each message must be self-contained: objective, context, requirements, constraints, and the expected result. Independent tasks can be delegated to multiple members simultaneously for parallel work; do NOT delegate dependent tasks together unless the prerequisite results are already available. After you delegate, this tool returns immediately and the members work on their own — you do not block on them.",
      "- get_team_members_status(agent_ids[]): Check whether specific members are idle, working, queued, completed, or failed, and how many messages are waiting for them. Use it to monitor delegated work and decide what to do next.",
    );
    if (ceoName) {
      lines.push(
        `- report_task_completion_to_ceo(summary): Report to the CEO ("${ceoName}") that the task the CEO assigned you is COMPLETE. Provide a concise summary of what your team accomplished and the concrete result (files, outcomes, key findings). Call this ONLY once your members have finished and you have reviewed their work.`,
      );
    }
  } else {
    lines.push(
      "- message_team_leader(my_name, message): Report to the head/leader. Use it to say your delegated task is COMPLETE (include the concrete results, file paths, and conclusions), to report progress, to ask a question, or to request clarification. Always pass your own name.",
    );
  }
  if (sendMessageEnabled) {
    lines.push(
      "- send_message_to_team(recipients[]): Message any teammate(s) directly for peer-to-peer coordination — ask a question, share information, request or hand off work, or continue a discussion. The recipient replies to you when they are free.",
    );
  }
  return lines.join("\n");
}

/**
 * Build the head/leader's system prompt. The leader receives the user's request, plans, delegates to
 * the right members, reviews their reports, and delivers the final result to the user.
 */
export function buildHeadSystemPrompt(
  team: AgentTeamDefinition,
  workspaceRoot: string,
  sendMessageEnabled: boolean,
  options?: { ceo?: { name: string } },
): string {
  const base = (team.leader_system_prompt ?? "").trim();
  const ceoName = options?.ceo?.name;

  // In CEO mode the leader receives tasks from the CEO (not directly from the user) and reports
  // completion back up to the CEO instead of answering the user itself.
  const roleAndFlow = ceoName
    ? `- You are "${team.leader_name}", the HEAD / team leader of the multi-agent team "${team.name}". You coordinate real, independent teammates — they are NOT sub-agents; each is a full agent with its own tools and its own persistent context.
- You operate UNDER a CEO agent ("${ceoName}"). The CEO assigns tasks to you; you break each task into sub-tasks, delegate them to the most suitable members, review their results, iterate if something is wrong, and — once the whole task is done — report completion back to the CEO with report_task_completion_to_ceo (never address the user directly; the CEO owns the conversation with the user).
- You may also do work yourself with your own tools when that is faster than delegating.`
    : `- You are "${team.leader_name}", the HEAD / team leader of a multi-agent collaboration team. You coordinate real, independent teammates — they are NOT sub-agents; each is a full agent with its own tools and its own persistent context.
- The user talks ONLY to you. Your job: understand the user's goal, break it into tasks, delegate each task to the most suitable member, review their results, iterate if something is wrong, and give the user a clear final answer when the whole goal is done.
- You may also do work yourself with your own tools when that is faster than delegating.`;

  const howToLeadTail = ceoName
    ? `- When a member reports completion, review it. If it is wrong or incomplete, delegate follow-up work. When everything the CEO asked for is done, call report_task_completion_to_ceo with a concise summary of what your team produced (files, outcomes, where to find things).
- Use get_team_members_status to monitor progress when helpful. Assign independent tasks in parallel; sequence dependent tasks.
- Keep your natural-language messages concise; let the team and the tools do the work.`
    : `- When a member reports completion, review it. If it is wrong or incomplete, delegate follow-up work. If everything the user asked for is done, respond to the user with a clear, complete final summary of what the team produced (files, outcomes, where to find things).
- Use get_team_members_status to monitor progress when helpful. Assign independent tasks in parallel; sequence dependent tasks.
- Keep your natural-language messages concise; let the team and the tools do the work.`;

  return `${base}

# Your role
${roleAndFlow}

# The team
${rosterBlock(team)}

${environmentBlock(workspaceRoot)}

${collaborationToolsBlock(true, sendMessageEnabled, ceoName)}

# How to lead
- When you receive a task, decide which members are needed and delegate with delegate_task_or_send_message. Give each member everything they need to work independently.
- Delegating does NOT block you: members run on their own and report back with message_team_leader. It is perfectly fine to finish your turn after delegating — the members keep working and you will be re-activated automatically when a member reports back, so you can review their work.
${howToLeadTail}`.trim();
}

/** Build a member's system prompt. Members execute delegated tasks and report back to the leader. */
export function buildMemberSystemPrompt(
  member: TeamMemberDefinition,
  team: AgentTeamDefinition,
  workspaceRoot: string,
  sendMessageEnabled: boolean,
): string {
  const base = (member.system_prompt ?? "").trim();
  return `${base}

# Your role
- You are "${member.name}", a specialist member of the multi-agent team "${team.name}", led by the head/leader "${team.leader_name}".
- You receive tasks from the leader (and, when enabled, messages from teammates), complete them autonomously with your tools, and report the result back to the leader.
- Your specialization: ${member.description || "(general specialist)"}.

# The team
${rosterBlock(team)}

${environmentBlock(workspaceRoot)}

${collaborationToolsBlock(false, sendMessageEnabled)}

# How to work
- Read the task carefully. Keep working with your tools until it is genuinely done — you have no iteration limit.
- When you have finished a task the leader delegated, you MUST call message_team_leader (with your name "${member.name}") to report that it is complete, including the concrete results: what you did, the file paths you created/changed, key findings, and anything the leader needs to review or hand to the user.
- If you are blocked or need clarification, use message_team_leader to ask${sendMessageEnabled ? " (or send_message_to_team to coordinate directly with the relevant teammate)" : ""}.
- Produce real, complete work — never stubs or pretend results. Verify your work when possible (build/tests/run) and fix errors before reporting done.`.trim();
}

/**
 * Combine everything waiting in an agent's mailbox into a single user message to append to its
 * conversation. Multiple messages that arrived while the agent was busy are delivered together, in
 * order, so the agent can address them one by one. A role-appropriate footer reminds the agent what
 * to do when finished.
 */
export function frameMailbox(
  role: "leader" | "member",
  memberName: string,
  batch: MailboxMessage[],
): string {
  if (batch.length === 1 && batch[0]!.kind === "user") {
    // The turn-starting user message goes to the leader verbatim (with any first-message context).
    return batch[0]!.message;
  }

  // A lone automatic system nudge is already a fully self-contained instruction — deliver it verbatim
  // rather than wrapping it in the "message(s) from your team" framing, which would misattribute it.
  if (batch.length === 1 && batch[0]!.kind === "system") {
    return batch[0]!.message;
  }

  const parts: string[] = [];
  const header =
    batch.length === 1
      ? "You have a new message from your team:"
      : `You have ${batch.length} new messages from your team (delivered together while you were busy — handle each one):`;
  parts.push(header, "");

  batch.forEach((m, i) => {
    const senderLabel =
      m.from === USER_SENDER_ID
        ? "the user"
        : m.from === SYSTEM_SENDER_ID
          ? "the system"
          : `"${m.from}"`;
    const kindLabel =
      m.kind === "delegate"
        ? "task from the team leader"
        : m.kind === "to_leader"
          ? "report from a team member"
          : m.kind === "user"
            ? "message from the user"
            : m.kind === "system"
              ? "automatic team-coordination notice"
              : "message";
    parts.push(`--- Message ${i + 1} — from ${senderLabel} (${kindLabel}) ---`, m.message, "");
  });

  const hasDelegated = batch.some((m) => m.kind === "delegate");
  if (role === "member") {
    parts.push(
      hasDelegated
        ? `When you finish the delegated task, call message_team_leader (my_name: "${memberName}") to report completion with the concrete results (files, findings, outcomes). Begin now.`
        : `Respond appropriately. If this completes work the leader is waiting on, report back with message_team_leader (my_name: "${memberName}"). Begin now.`,
    );
  } else {
    parts.push(
      "Review these reports/messages. If a member's work is wrong or incomplete, delegate follow-up work. If everything the user asked for is now done, give the user a clear, complete final answer.",
    );
  }

  return parts.join("\n");
}

/**
 * Build the automatic "you didn't report back to the leader" nudge. The orchestrator injects this
 * into a member's mailbox when the member finished a run but a task the leader delegated is still
 * outstanding and the member never messaged the leader — the leader would otherwise wait forever,
 * because a delegated task is only ever considered done once the member explicitly reports it. The
 * text is fully self-contained (it carries the member's own name for message_team_leader) so it can
 * be delivered verbatim.
 */
export function buildLeaderReportReminder(memberName: string, leaderName: string): string {
  return [
    "SYSTEM NOTICE — automatic team-coordination check (not from a teammate).",
    "",
    `Your last run ended without you reporting back to the team leader ("${leaderName}"), but a task the leader delegated to you is still open. The leader is NOT notified automatically — a delegated task is only considered complete once you explicitly report it, so the whole team is now waiting on you.`,
    "",
    "Take exactly one of these actions now:",
    `1. If the task is DONE: call message_team_leader (my_name: "${memberName}") with a concise completion report — what you accomplished, the exact file paths you created or changed, the key results/findings, and anything the leader needs to review or hand to the user.`,
    "2. If the task is NOT finished yet: keep working with your tools until it is genuinely complete, then report to the leader with message_team_leader.",
    `3. If you are blocked or need clarification: call message_team_leader (my_name: "${memberName}") to tell the leader exactly what you need.`,
    "",
    "Do not stay silent and do not end your turn without contacting the leader — the team cannot move forward until the leader hears from you.",
  ].join("\n");
}
