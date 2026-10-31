import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const recipientSchema = z.object({
  agent_id: z
    .string()
    .min(1, "agent_id is required.")
    .describe("The exact unique ID of the target agent team member."),
  message: z
    .string()
    .min(1, "message is required.")
    .describe(
      "The message to send to this agent. It may contain a new task, instruction, question, " +
        "request for clarification, feedback, context, update, follow-up, coordination request, " +
        "or any other agent-to-agent communication.",
    ),
});

const schema = z.object({
  recipients: z
    .array(recipientSchema)
    .min(1, "Provide at least one recipient.")
    .describe(
      "The list of agent team members that should receive messages. Each recipient is identified " +
        "by their exact agent ID and can receive an independent message.",
    ),
});

/**
 * send_message_to_team — LEADER + MEMBERS (sensitive; disabled by default, gated by the user's
 * Settings toggle). General agent-to-agent messaging: any team agent can message any other team
 * agent(s). The tool response tells the caller who they are and that the message was delivered,
 * so peer collaboration flows keep their bearings. Each message is appended to the recipient's
 * EXISTING conversation via its mailbox — no new session is created.
 */
export const sendMessageToTeamTool = defineTool({
  name: "send_message_to_team",
  description:
    "Send messages to one or more agent team members using their exact agent IDs. Use this tool " +
    "when you need to communicate with existing team members. Messages can be used to assign new " +
    "tasks, provide instructions, ask questions, request clarification, share information or " +
    "context, give feedback, send updates, continue an existing discussion, coordinate work, " +
    "delegate responsibilities, change priorities, request progress reports, or have general " +
    "agent-to-agent communication. Multiple team members can receive messages in a single tool " +
    "call.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.recipients) ? args.recipients.length : 0;
    const names = Array.isArray(args.recipients)
      ? args.recipients.map((r) => r.agent_id).filter(Boolean).slice(0, 3).join(", ")
      : "";
    return `Message ${count} teammate${count === 1 ? "" : "s"}${names ? `: ${names}` : ""}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const team = ctx.team;
    if (!team) {
      return {
        ok: false,
        error: {
          code: "not_in_team",
          message: "This tool is only available to agents inside an active agent team.",
        },
      };
    }
    if (!team.sendMessageToTeamEnabled) {
      return {
        ok: false,
        error: {
          code: "tool_disabled",
          message:
            "Agent-to-agent messaging (send_message_to_team) is disabled. The user can enable it " +
            "in Settings. Members should report to the leader with message_team_leader instead.",
        },
      };
    }

    // Never message yourself.
    const recipients = args.recipients.filter(
      (r) => r.agent_id.trim().toLowerCase() !== team.selfId.trim().toLowerCase(),
    );
    if (recipients.length === 0) {
      return {
        ok: false,
        error: {
          code: "no_valid_recipients",
          message: "No valid recipients (you cannot send a message to yourself).",
        },
      };
    }

    const result = team.deliver(
      recipients.map((r) => ({ agent_id: r.agent_id, message: r.message })),
      "message",
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
        from: team.selfId,
        delivered: result.delivered,
        unknown: result.unknown,
        message:
          `Message sent from "${team.selfId}". ` +
          result.message +
          " The recipient(s) will process your message and may reply later — continue with your " +
          "work.",
      },
    };
  },
});
