import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { resilientFetch } from "@/lib/net";
import type {
  FileNode,
  ModelInfo,
  ProviderMeta,
  ScrapeResult,
  StreamRequest,
} from "@/types";

/**
 * Client API — every call targets this app's own `/api/*` routes (see `app/api/routes.ts`),
 * which Vite proxies to the mythgram backend. The browser never talks to the backend directly,
 * so `localhost` stays server-side and streaming/CORS keep working through a proxy URL.
 */

/** Custom header pair the user can attach to a URL knowledge fetch. */
export interface ScrapeHeader {
  key: string;
  value: string;
}

/** Options for a URL → knowledge fetch (all optional beyond the URL, or a pasted curl command). */
export interface ScrapeUrlOptions {
  url?: string;
  format?: "markdown" | "text" | "json" | "autodetect";
  headers?: ScrapeHeader[];
  apiKey?: string;
  curl?: string;
}

/** Shared JSON request helper (also used by the SQLite state client in `backendState.ts`). */
export async function requestJson<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await resilientFetch(url, { cache: "no-store", ...init }, { signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchProviders(signal?: AbortSignal): Promise<ProviderMeta[]> {
  const data = await requestJson<{ providers?: ProviderMeta[] } | ProviderMeta[]>(
    routeUrl(API_ROUTES.providersList),
    undefined,
    signal,
  );
  return Array.isArray(data) ? data : (data.providers ?? []);
}

export async function fetchModels(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ModelInfo[]> {
  const data = await requestJson<{ models?: ModelInfo[] }>(routeUrl(API_ROUTES.providersModels), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl || undefined }),
  });
  return data.models ?? [];
}

export async function fetchFileTree(path?: string): Promise<FileNode[]> {
  const data = await requestJson<{ tree?: FileNode[] }>(
    routeUrl(API_ROUTES.filesTree, { query: { path } }),
  );
  return data.tree ?? [];
}

export async function fetchFileContent(path: string): Promise<string> {
  const data = await requestJson<{ content?: string }>(
    routeUrl(API_ROUTES.filesRead, { query: { path } }),
  );
  return data.content ?? "";
}

export async function abortChat(chatId: string): Promise<void> {
  // Best-effort. This is the ONLY thing that stops a running agent — a disconnect never does.
  await resilientFetch(
    routeUrl(API_ROUTES.chatAbort, { params: { chatId } }),
    { method: "POST" },
    { retries: 1 },
  ).catch(() => {});
}

export type PlanDecision = "approved" | "canceled" | "edited";

export interface QuestionAnswerPayload {
  question: string;
  answer: string;
}

/**
 * Submit the user's answers to a pending ask_question_to_user request. Returns false when the
 * backend reports the request is no longer pending (already answered, timed out, or unknown).
 */
export async function submitAnswers(
  chatId: string,
  toolCallId: string,
  answers: QuestionAnswerPayload[],
): Promise<boolean> {
  try {
    const data = await requestJson<{ ok?: boolean }>(
      routeUrl(API_ROUTES.chatQuestionAnswer, { params: { chatId, toolCallId } }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      },
    );
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Submit the user's decision for a submitted plan. Returns false when the backend reports the
 * plan is no longer pending (already decided, timed out, or unknown).
 */
export async function decidePlan(
  chatId: string,
  toolCallId: string,
  decision: PlanDecision,
  plan?: string,
): Promise<boolean> {
  try {
    const data = await requestJson<{ ok?: boolean }>(
      routeUrl(API_ROUTES.chatPlanDecision, { params: { chatId, toolCallId } }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, plan: decision === "edited" ? plan : undefined }),
      },
    );
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Fetch a URL's content through the backend's built-in scraper so the user can review it and
 * save it as a knowledge file. Supports optional custom headers, an API key (bearer), and a
 * pasted curl command (URL/headers parsed server-side). Throws on failure.
 */
export async function scrapeUrl(
  options: ScrapeUrlOptions,
  signal?: AbortSignal,
): Promise<ScrapeResult> {
  return requestJson<ScrapeResult>(
    routeUrl(API_ROUTES.scrapeUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: options.url,
        format: options.format,
        headers: options.headers?.filter((h) => h.key.trim().length > 0),
        apiKey: options.apiKey,
        curl: options.curl,
      }),
    },
    signal,
  );
}

/**
 * Open a chat stream. This is a bare fetch (no timeout) — the reconnect/resilience loop lives in
 * `lib/chatStream.ts`. `signal` is wired to explicit user cancellation only.
 */
export async function openChatStream(body: StreamRequest, signal: AbortSignal): Promise<Response> {
  return fetch(routeUrl(API_ROUTES.chatStream), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
}
