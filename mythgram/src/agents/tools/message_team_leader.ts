import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({
  my_name: z
    .string()
    .min(1, "my_name is required.")
    .describe(
      "Your name as the team member sending this message. This identifies who is communicating " +
        "with the head team leader.",
    ),
  message: z
    .string()
    .min(1, "message is required.")
    .describe(
      "The message to send to the head team leader. This can be a task completion report, " +
        "progress update, question, request for clarification, important information, or general " +
        "work-related communication.",
    ),
});

/**
 * message_team_leader — MEMBERS ONLY. Lets a team member report to (or ask/inform) the head/leader
 * — typically to say a delegated task is complete. The message is appended to the leader's EXISTING
 * conversation via its mailbox (no new session), and if the leader is busy the report waits in the
 * queue and is delivered together with any other pending reports when the leader is next free.
 */
export const messageTeamLeaderTool = defineTool({
  name: "message_team_leader",
  description:
    "Use this tool to communicate directly with the head team leader. You can use it to inform " +
    "the team leader that a task has been completed, report task progress or updates, ask " +
    "questions, request clarification or guidance, share important information, or have general " +
    "work-related communication. Always provide your name so the head team leader knows which " +
    "team member sent the message.",
  schema,
  label: (args) => `Report to leader${args.my_name ? ` (from ${args.my_name})` : ""}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const team = ctx.team;
    if (!team) {
      return {
        ok: false,
        error: {
          code: "not_in_team",
          message: "This tool is only available to members of an active agent team.",
        },
      };
    }
    if (team.isLeader) {
      return {
        ok: false,
        error: {
          code: "members_only",
          message:
            "You are the team leader — you don't report to yourself. Use " +
            "delegate_task_or_send_message to communicate with members.",
        },
      };
    }

    // The message always goes to the leader; my_name is included in the framing so the leader knows
    // exactly who reported. Prefix the caller's real id so an incorrect my_name can't hide identity.
    const framed = `From team member "${team.selfId}" (self-reported name: ${args.my_name}):\n\n${args.message}`;
    const result = team.deliver([{ agent_id: team.leaderId, message: framed }], "to_leader");

    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? { code: "delivery_failed", message: result.message },
      };
    }

    return {
      ok: true,
      data: {
        from: team.selfId,
        to: team.leaderId,
        message:
          `Your message was sent to the team leader ("${team.leaderId}"). The leader will review ` +
          "it when free — you can continue with any remaining work or finish up.",
      },
    };
  },
});
