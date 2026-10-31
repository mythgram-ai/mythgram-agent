import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({
  plan: z
    .string()
    .describe(
      "The complete project implementation plan, including the overall summary and milestones.",
    ),
});

/**
 * Result strings returned to the model, one per possible human decision. Kept in one place so
 * the tool's behaviour is easy to read and the tests can assert exact wording.
 */
export const SUBMIT_PLAN_APPROVED =
  "the plan approved, now start your task according to the plan";
export const SUBMIT_PLAN_CANCELED =
  "the plan user canceled, retry with a batter plan or try something new that user need";
export const SUBMIT_PLAN_EDITED =
  "the user approved the plan with some modifications, start your task according to the modified plan";
export const SUBMIT_PLAN_TIMEOUT =
  "time out of the submit plan tool, start the task because user is not here, do the task independently";

/** Default wait for a user decision when the runtime does not provide one (ms). */
const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

export const submitPlanTool = defineTool({
  name: "submit_plan",
  description:
    "Submit the completed project implementation plan for the user's review. The plan is " +
    "displayed to the user, who can approve it, cancel it, or edit it before approving. " +
    "Use this tool only after analyzing the requirements and determining the implementation " +
    "approach. The plan should clearly explain the overall objective, proposed architecture, " +
    "major implementation steps, important technical considerations, dependencies, and " +
    "milestones required to complete the work. Keep the plan practical, ordered, and specific " +
    "enough that it can be used as a clear roadmap for implementation.",
  schema,
  label: () => "Submit Plan",
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const plan = args.plan.trim();
    if (!plan) {
      return {
        ok: false,
        error: { code: "empty_plan", message: "The submitted plan cannot be empty." },
      };
    }

    const store = ctx.planApprovals;
    if (!store) {
      return {
        ok: false,
        error: {
          code: "no_plan_approval_store",
          message:
            "submit_plan cannot run without a plan-approval runtime. It is only available on the " +
            "main agent, not inside a sub-agent.",
        },
      };
    }

    const chatId = ctx.chatId ?? ctx.toolCallId ?? "unknown";
    const toolCallId = ctx.toolCallId ?? generateId(chatId);

    // Surface the plan to the frontend so it can render the big review block BEFORE we block on
    // the user's decision.
    ctx.emit?.("plan_review", {
      id: toolCallId,
      chat_id: chatId,
      plan,
    });

    const result = await store.create({
      chatId,
      toolCallId,
      plan,
      timeoutMs: ctx.planApprovalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
      signal: ctx.signal,
    });

    switch (result.decision) {
      case "approved":
        return {
          ok: true,
          data: {
            tool: "submit_plan",
            plan,
            decision: "approved",
            message: SUBMIT_PLAN_APPROVED,
            approved: true,
          },
        };
      case "edited":
        return {
          ok: true,
          data: {
            tool: "submit_plan",
            plan: result.plan ?? plan,
            decision: "edited",
            message: SUBMIT_PLAN_EDITED,
            approved: true,
          },
        };
      case "canceled":
        return {
          ok: true,
          data: {
            tool: "submit_plan",
            plan,
            decision: "canceled",
            message: SUBMIT_PLAN_CANCELED,
            approved: false,
          },
        };
      case "timeout":
        return {
          ok: true,
          data: {
            tool: "submit_plan",
            plan,
            decision: "timeout",
            message: SUBMIT_PLAN_TIMEOUT,
            approved: false,
            timed_out: true,
          },
        };
      case "aborted":
      default:
        return {
          ok: false,
          error: { code: "aborted", message: "Plan review was aborted before a decision was made." },
        };
    }
  },
});

/** Fallback id so a plan can still be referenced when no tool-call id is available. */
function generateId(seed: string): string {
  return `plan_${seed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}