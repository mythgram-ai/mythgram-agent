import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { parseSSEStream } from "@/lib/sse";
import type { SSEEventData } from "@/types";

export type PromptAgentMode = "create" | "enhance";

export interface PromptAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export interface PromptAgentStreamBody {
  chat_id: string;
  user_message: string;
  mode: PromptAgentMode;
  existing_prompt?: string;
  history?: Array<{ role: string; content: string }>;
  provider: string;
  model: string;
  api_key: string;
  base_url?: string;
  custom_provider?: unknown;
  temperature?: number;
  effort?: string;
  tavily_api_key?: string;
  exa_api_key?: string;
  serpapi_api_key?: string;
  search_provider?: string;
  fetch_provider?: string;
  firecrawl_api_key?: string;
  skills?: unknown[];
  since_event_id?: number;
}

export function newPromptAgentChatId(): string {
  const bytes = new Uint8Array(20);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 20; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 20; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export async function openPromptAgentStream(
  body: PromptAgentStreamBody,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(routeUrl(API_ROUTES.promptAgentStream), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
}

export async function abortPromptAgent(chatId: string): Promise<void> {
  await fetch(routeUrl(API_ROUTES.promptAgentAbort, { params: { chatId } }), {
    method: "POST",
  }).catch(() => {});
}

export async function runPromptAgentStream(opts: {
  body: PromptAgentStreamBody;
  signal: AbortSignal;
  onEvent: (event: string, data: SSEEventData) => void;
}): Promise<"done" | "aborted" | "error"> {
  const { body, signal, onEvent } = opts;
  let res: Response;
  try {
    res = await openPromptAgentStream({ ...body, since_event_id: -1 }, signal);
  } catch (e) {
    if (signal.aborted) return "aborted";
    onEvent("error", { message: e instanceof Error ? e.message : String(e) });
    return "error";
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    onEvent("error", { message: text || `Request failed (${res.status})` });
    return "error";
  }
  let sawDone = false;
  try {
    await parseSSEStream(
      res,
      ({ event, data }) => {
        if (event === "done") sawDone = true;
        onEvent(event, data);
      },
      signal,
    );
  } catch {
    if (signal.aborted) return "aborted";
  }
  if (signal.aborted) return "aborted";
  return sawDone ? "done" : "done";
}

/** Minimal Markdown -> HTML renderer (no new dependency). Escapes first, then
 * renders code fences, headings, bold/italic/code, lists, links, blockquotes. */
export function renderMarkdownToHtml(source: string): string {
  const escaped = source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeLang = "";
  let inList = false;

  const inline = (text: string): string =>
    text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  for (const raw of lines) {
    const fence = raw.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] ?? "";
        html.push(`<pre data-lang="${codeLang}"><code>`);
      } else {
        inCode = false;
        html.push("</code></pre>");
      }
      continue;
    }
    if (inCode) {
      html.push(`${raw}\n`);
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    if (/^&gt;\s?/.test(trimmed) || /^>\s?/.test(raw.trim())) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<blockquote>${inline(trimmed.replace(/^&gt;\s?/, ""))}</blockquote>`);
      continue;
    }
    const listItem = trimmed.match(/^([-*+]|\d+\.)\s+(.*)$/);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(listItem[2]!)}</li>`);
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push("<hr />");
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    html.push(`<p>${inline(trimmed)}</p>`);
  }
  if (inList) html.push("</ul>");
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}
