import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const messageSchema = z.object({
  agent_id: z
    .string()
    .min(1, "agent_id is required.")
    .describe("The exact ID of the team member agent that should receive this message."),
  message: z
    .string()
    .min(1, "message is required.")
    .describe(
      "The message to send to the team member. For task assignments, include all necessary " +
        "context, requirements, constraints, and expected results so the team member can work " +
        "independently. Can also be a question, instruction, update, feedback, or clarification.",
    ),
});

const schema = z.object({
  messages: z
    .array(messageSchema)
    .min(1, "Provide at least one message to send to a team member.")
    .describe(
      "A list of messages to send to team members. Each message can contain a task, instruction, " +
        "question, update, feedback, clarification request, or general communication.",
    ),
});

/**
 * delegate_task_or_send_message — LEADER ONLY. Lets the head/team leader assign tasks to (or
 * message) one or more team members in a single call. Each message is delivered to the target
 * member's EXISTING conversation (via its mailbox) — no new session is created, so the member keeps
 * all of its prior context. Members work independently and report back with message_team_leader.
 */
export const delegateTaskOrSendMessageTool = defineTool({
  name: "delegate_task_or_send_message",
  description:
    "Delegate tasks or communicate with one or more team members in your multi-agent team. Use " +
    "this tool whenever you need to send a task, instruction, question, update, feedback, " +
    "additional context, clarification, or general message to a team member. You can communicate " +
    "with multiple team members in a single call. For task delegation, provide a clear, complete, " +
    "and self-contained message containing the objective, relevant context, requirements, " +
    "constraints, and expected result. Select the most appropriate team member based on their " +
    "specialization and capabilities. Independent tasks can be assigned to multiple team members " +
    "simultaneously for parallel execution. Do not assign dependent tasks simultaneously unless " +
    "the required dependencies or results are already available. This tool can also be used for " +
    "normal agent-to-agent communication, such as asking questions, requesting clarification, " +
    "sharing information, providing feedback, sending updates, or continuing a conversation. " +
    "Always use the exact agent ID of the intended team member. Each team member receives the " +
    "provided message and can respond with the requested information or the result of the " +
    "assigned task.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.messages) ? args.messages.length : 0;
    const names = Array.isArray(args.messages)
      ? args.messages.map((m) => m.agent_id).filter(Boolean).slice(0, 3).join(", ")
      : "";
    return `Delegate to ${count} member${count === 1 ? "" : "s"}${names ? `: ${names}` : ""}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const team = ctx.team;
    if (!team) {
      return {
        ok: false,
        error: {
          code: "not_in_team",
          message: "This tool is only available to the head of an active agent team.",
        },
      };
    }
    if (!team.isLeader) {
      return {
        ok: false,
        error: {
          code: "leader_only",
          message:
            "Only the team leader can delegate tasks. As a team member, use message_team_leader " +
            "to report to the leader, or send_message_to_team (if enabled) to message a peer.",
        },
      };
    }

    const result = team.deliver(
      args.messages.map((m) => ({ agent_id: m.agent_id, message: m.message })),
      "delegate",
    );

    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? { code: "delivery_failed", message: result.message },
      };
    }

    return {
      ok: true,
      data: {
        delivered: result.delivered,
        unknown: result.unknown,
        message:
          result.message +
          " Each member will work independently and report back to you when done. You can keep " +
          "coordinating, check their progress with get_team_members_status, or wait for their " +
          "reports — continue.",
      },
    };
  },
});
