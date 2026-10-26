import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import type { PendingQuestion, QuestionAnswer } from "../../services/questionStore.js";

const questionSchema = z
  .object({
    question: z
      .string()
      .describe("The question that should be shown to the user."),
    context: z
      .string()
      .describe(
        "Context or explanation that helps the user understand why the question is being asked and make an informed choice.",
      ),
    options: z
      .array(z.string())
      .min(1)
      .describe(
        "Predefined answers that the user can choose from. Must provide at least one option. The user may also provide a custom answer instead of selecting one of these options.",
      ),
  })
  .strict()
  .describe("A single question with context and predefined options.");

const schema = z
  .object({
    questions: z
      .array(questionSchema)
      .min(1)
      .describe(
        "A list of questions to present to the user. Multiple questions can be asked in one tool call.",
      ),
  })
  .strict();

/**
 * Result strings returned to the model, one per possible outcome. Kept in one place so
 * the tool's behaviour is easy to read and the tests can assert exact wording.
 */
export const ASK_ANSWERED =
  "the user answered the questions with the provided answers, continue your task using these answers";
export const ASK_TIMEOUT = "user is not hare start the task by your own";

/**
 * Message returned to the model when ask_question_to_user is called on a messaging-channel
 * turn (Telegram / Discord / Slack). Channels have no interactive question UI, so the tool
 * can never collect answers there — the agent must ask the user directly with send_responses
 * and wait for the next message instead of calling this tool again.
 */
export const ASK_CHANNEL_UNAVAILABLE =
  "The ask_question_to_user tool is not available in messaging channels (Telegram, Discord, " +
  "Slack): channels have no interactive question UI, so no answers can be collected this way. " +
  "If you need information or a decision from the user, ask your question(s) directly with the " +
  "send_responses tool — write them clearly in one message — then end your turn without further " +
  "tool calls and wait for the user's next message before continuing. Do not call " +
  "ask_question_to_user again on this channel turn.";

/** Default wait for the user's answers when the runtime does not provide one (ms) — 3 minutes. */
const DEFAULT_QUESTION_TIMEOUT_MS = 180_000;

export const askUserTool = defineTool({
  name: "ask_question_to_user",
  description:
    "Ask the user one or more questions when additional information, clarification, or a " +
    "decision is required to continue. Each question must include a clear question, context, " +
    "and predefined options. The user can select one of the provided options or provide a " +
    "custom answer. Multiple questions can be presented in a single tool call. Custom answers " +
    "are always allowed.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.questions) ? args.questions.length : 0;
    return `Ask ${count} Question${count === 1 ? "" : "s"}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const normalized = normalizeQuestions(args.questions);
    if (!normalized) {
      return {
        ok: false,
        error: {
          code: "invalid_questions",
          message:
            "Every question must have a non-empty question, context, and at least one non-empty option.",
        },
      };
    }

    // Messaging channels have no interactive question UI: the tool cannot collect answers
    // there. Report this as a successful observation (not an error, so the agent does not
    // retry) telling the agent to ask the user directly with send_responses instead.
    if (ctx.channel) {
      return {
        ok: true,
        data: {
          tool: "ask_question_to_user",
          questions: normalized,
          decision: "channel_unavailable",
          message: ASK_CHANNEL_UNAVAILABLE,
        },
      };
    }

    const store = ctx.askQuestions;
    if (!store) {
      return {
        ok: false,
        error: {
          code: "no_question_store",
          message:
            "ask_question_to_user cannot run without a question-answer runtime. It is only " +
            "available on the main agent, not inside a sub-agent.",
        },
      };
    }

    const chatId = ctx.chatId ?? ctx.toolCallId ?? "unknown";
    const toolCallId = ctx.toolCallId ?? generateId(chatId);

    // Surface the questions to the frontend so it can render the answer block BEFORE we block
    // on the user's response.
    ctx.emit?.("ask_question", {
      id: toolCallId,
      chat_id: chatId,
      questions: normalized,
    });

    const result = await store.create({
      chatId,
      toolCallId,
      questions: normalized,
      timeoutMs: ctx.questionTimeoutMs ?? DEFAULT_QUESTION_TIMEOUT_MS,
      signal: ctx.signal,
    });

    switch (result.decision) {
      case "answered":
        return {
          ok: true,
          data: {
            tool: "ask_question_to_user",
            questions: normalized,
            answers: result.answers ?? [],
            decision: "answered",
            message: ASK_ANSWERED,
          },
        };
      case "timeout":
        return {
          ok: true,
          data: {
            tool: "ask_question_to_user",
            questions: normalized,
            decision: "timeout",
            message: ASK_TIMEOUT,
            timed_out: true,
          },
        };
      case "aborted":
      default:
        return {
          ok: false,
          error: {
            code: "aborted",
            message: "The question was aborted before the user answered.",
          },
        };
    }
  },
});

/** Trim and validate question fields; returns null when any field is invalid. */
function normalizeQuestions(raw: Array<{ question: string; context: string; options: string[] }>): PendingQuestion[] | null {
  const out: PendingQuestion[] = [];
  for (const item of raw) {
    const question = item.question.trim();
    const context = item.context.trim();
    const options = item.options
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    if (!question || !context || options.length === 0) return null;
    out.push({ question, context, options });
  }
  return out.length > 0 ? out : null;
}

/** Construct the answers payload exactly aligned with the questions the user answered. */
export function buildAnswers(
  questions: PendingQuestion[],
  rawAnswers: string[],
): QuestionAnswer[] {
  return questions.map((q, i) => ({
    question: q.question,
    answer: typeof rawAnswers[i] === "string" ? rawAnswers[i] : "",
  }));
}

/** Fallback id so questions can still be referenced when no tool-call id is available. */
function generateId(seed: string): string {
  return `question_${seed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}