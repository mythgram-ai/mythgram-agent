import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import type { AskRequestItem, AskRequestValue } from "../../services/askRequestStore.js";

const itemSchema = z
  .object({
    request: z
      .string()
      .describe(
        "Explain what information the user needs to provide and why it is needed.",
      ),
    placeholder: z
      .string()
      .describe(
        "Placeholder text displayed inside this item's input field. Example: 'Enter your API key...'.",
      ),
  })
  .strict()
  .describe("One piece of information to request from the user.");

const schema = z
  .object({
    items: z
      .array(itemSchema)
      .min(1)
      .describe(
        "List of all information requests to display to the user in a single form. Include as many items as necessary.",
      ),
  })
  .strict();

/**
 * Result strings returned to the model, one per possible outcome. Kept in one place so the tool's
 * behaviour is easy to read and the tests can assert exact wording.
 */
export const ASK_FOR_SOMETHING_SUBMITTED =
  "the user provided the requested information; continue your task using these values";
export const ASK_FOR_SOMETHING_REJECTED =
  "the user rejected the request and provided no information; continue without it or explain what is needed";
export const ASK_FOR_SOMETHING_TIMEOUT =
  "the user did not provide the requested information in time; continue your task without it";

/**
 * Message returned to the model when ask_for_something is called on a messaging-channel turn
 * (Telegram / Discord / Slack). Channels have no interactive form UI, so the tool can never collect
 * values there — the agent must ask the user directly with send_responses and wait for the next
 * message instead.
 */
export const ASK_FOR_SOMETHING_CHANNEL_UNAVAILABLE =
  "The ask_for_something tool is not available in messaging channels (Telegram, Discord, Slack): " +
  "channels have no interactive form UI, so no values can be collected this way. If you need " +
  "information from the user, ask for it directly with the send_responses tool — clearly list every " +
  "item you need — then end your turn without further tool calls and wait for the user's next " +
  "message before continuing. Do not call ask_for_something again on this channel turn.";

/** Default wait for the user's values when the runtime does not provide one (ms) — 2 minutes. */
export const DEFAULT_ASK_FOR_SOMETHING_TIMEOUT_MS = 120_000;

export const askForSomethingTool = defineTool({
  name: "ask_for_something",
  description:
    "Ask the user to provide one or more pieces of information in a single tool call. Use this tool " +
    "whenever you need user input before continuing a task, such as API keys, access tokens, " +
    "usernames, email addresses, URLs, database connection strings, server addresses, project IDs, " +
    "configuration values, or other required information. You can request unlimited items in one " +
    "call by providing multiple entries in the items array. Each item displays its own input field " +
    "with a request description and placeholder. Clearly explain what information is needed, provide " +
    "helpful placeholders, and only request information relevant to the task. The user may submit the " +
    "values, reject individual items, or reject the whole request; the tool waits for the user's " +
    "response before returning.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.items) ? args.items.length : 0;
    return `Ask for ${count} item${count === 1 ? "" : "s"}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const normalized = normalizeItems(args.items);
    if (!normalized) {
      return {
        ok: false,
        error: {
          code: "invalid_items",
          message:
            "Every item must have a non-empty request and a non-empty placeholder.",
        },
      };
    }

    // Messaging channels have no interactive form UI: the tool cannot collect values there. Report
    // this as a successful observation (not an error, so the agent does not retry) telling the agent
    // to ask the user directly with send_responses instead.
    if (ctx.channel) {
      return {
        ok: true,
        data: {
          tool: "ask_for_something",
          items: normalized,
          decision: "channel_unavailable",
          message: ASK_FOR_SOMETHING_CHANNEL_UNAVAILABLE,
        },
      };
    }

    const store = ctx.askForSomething;
    if (!store) {
      return {
        ok: false,
        error: {
          code: "no_ask_runtime",
          message:
            "ask_for_something cannot run without an information-request runtime. It is available " +
            "on the main agent, custom agents, and multi-agent team/CEO agents, but not inside a " +
            "sub-agent.",
        },
      };
    }

    const chatId = ctx.chatId ?? ctx.toolCallId ?? "unknown";
    const toolCallId = ctx.toolCallId ?? generateId(chatId);

    // Surface the request to the frontend so it can render the form BEFORE we block on the answer.
    ctx.emit?.("ask_for_something", {
      id: toolCallId,
      chat_id: chatId,
      items: normalized,
    });

    const result = await store.create({
      chatId,
      toolCallId,
      items: normalized,
      timeoutMs: ctx.askForSomethingTimeoutMs ?? DEFAULT_ASK_FOR_SOMETHING_TIMEOUT_MS,
      signal: ctx.signal,
    });

    switch (result.decision) {
      case "submitted":
        return {
          ok: true,
          data: {
            tool: "ask_for_something",
            items: normalized,
            values: result.values ?? [],
            decision: "submitted",
            message: ASK_FOR_SOMETHING_SUBMITTED,
          },
        };
      case "rejected":
        return {
          ok: true,
          data: {
            tool: "ask_for_something",
            items: normalized,
            decision: "rejected",
            message: ASK_FOR_SOMETHING_REJECTED,
            rejected: true,
          },
        };
      case "timeout":
        return {
          ok: true,
          data: {
            tool: "ask_for_something",
            items: normalized,
            decision: "timeout",
            message: ASK_FOR_SOMETHING_TIMEOUT,
            timed_out: true,
          },
        };
      case "aborted":
      default:
        return {
          ok: false,
          error: {
            code: "aborted",
            message: "The information request was aborted before the user responded.",
          },
        };
    }
  },
});

/** Trim and validate item fields; returns null when any field is invalid. */
function normalizeItems(raw: Array<{ request: string; placeholder: string }>): AskRequestItem[] | null {
  const out: AskRequestItem[] = [];
  for (const item of raw) {
    const request = item.request.trim();
    const placeholder = item.placeholder.trim();
    if (!request || !placeholder) return null;
    out.push({ request, placeholder });
  }
  return out.length > 0 ? out : null;
}

/**
 * Build the values payload aligned with the items the user answered, ensuring every request has an
 * entry. Missing/rejected values become empty strings marked as rejected.
 */
export function buildValues(
  items: AskRequestItem[],
  rawValues: Array<{ value?: string; rejected?: boolean }>,
): AskRequestValue[] {
  return items.map((item, i) => {
    const raw = rawValues[i];
    const rejected = raw?.rejected === true;
    const value = rejected ? "" : typeof raw?.value === "string" ? raw.value : "";
    return { request: item.request, value, rejected };
  });
}

/** Fallback id so a request can still be referenced when no tool-call id is available. */
function generateId(seed: string): string {
  return `ask_${seed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
