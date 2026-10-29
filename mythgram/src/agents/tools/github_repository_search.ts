import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Search GitHub for repositories through the official GitHub REST search API
 * (https://api.github.com/search/repositories). No browser or scraping engine is involved —
 * the tool calls the public JSON API directly with native fetch.
 *
 * Authentication is optional: GitHub allows a limited number of unauthenticated search
 * requests per minute. When a server-side GITHUB_TOKEN is configured it is sent as a bearer
 * token, which raises the rate limit and returns the caller's accessible private repositories.
 */

/** GitHub caps repository search results at 100 per page; the tool returns at most 30. */
const MAX_RESULTS = 30;
const REQUEST_TIMEOUT_MS = 30_000;
const GITHUB_API_URL = "https://api.github.com/search/repositories";

const schema = z
  .object({
    query: z.string().trim().min(1, "query must be a non-empty string").describe("The query to search."),
  })
  .strict();

interface GitHubRepoItem {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  topics?: string[];
  updated_at?: string;
  pushed_at?: string;
  archived?: boolean;
  fork?: boolean;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  owner?: { login?: string } | null;
}

interface GitHubSearchResponse {
  total_count?: number;
  incomplete_results?: boolean;
  items?: GitHubRepoItem[];
  message?: string;
  documentation_url?: string;
}

/** Optional server-side token; raises the API rate limit and enables private-repo results. */
function resolveToken(): string | undefined {
  const token = (process.env.GITHUB_TOKEN ?? process.env.GITHUB_API_TOKEN ?? "").trim();
  return token.length > 0 ? token : undefined;
}

/** Normalize one raw search item into the compact shape returned to the model. */
function normalizeRepo(item: GitHubRepoItem): Record<string, unknown> {
  const license =
    item.license && (item.license.spdx_id || item.license.name)
      ? item.license.spdx_id && item.license.spdx_id !== "NOASSERTION"
        ? item.license.spdx_id
        : item.license.name ?? null
      : null;

  return {
    full_name: item.full_name ?? "",
    url: item.html_url ?? "",
    description: item.description ?? "",
    owner: item.owner?.login ?? "",
    language: item.language ?? null,
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    open_issues: item.open_issues_count ?? 0,
    license,
    topics: item.topics ?? [],
    archived: item.archived === true,
    fork: item.fork === true,
    updated_at: item.updated_at ?? null,
    pushed_at: item.pushed_at ?? null,
  };
}

export const githubRepositorySearchTool = defineTool({
  name: "github_repository_search",
  description:
    "Search GitHub for repositories matching a given query. Returns relevant repositories based " +
    "on keywords, project names, programming languages, or topics to help users discover " +
    "open-source projects and explore related codebases.",
  schema,
  label: (args) => `GitHub Repository Search: ${args.query}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const query = args.query.trim();
    if (query.length === 0) {
      return {
        ok: false,
        error: { code: "missing_query", message: "No search query provided." },
      };
    }

    if (ctx.signal?.aborted) {
      return {
        ok: false,
        error: { code: "aborted", message: "The GitHub repository search was aborted." },
      };
    }

    const url = new URL(GITHUB_API_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(MAX_RESULTS));

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MythgramAI/1.0",
    };
    const token = resolveToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    // Bound the request by the turn's abort signal and a hard timeout.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      const rawText = await response.text();
      let payload: GitHubSearchResponse = {};
      try {
        payload = rawText ? (JSON.parse(rawText) as GitHubSearchResponse) : {};
      } catch {
        payload = { message: rawText.slice(0, 300) };
      }

      if (!response.ok) {
        const apiMessage = payload.message ?? response.statusText;
        const rateLimited =
          (response.status === 403 || response.status === 429) && /rate limit/i.test(apiMessage);
        return {
          ok: false,
          error: {
            code: rateLimited ? "github_rate_limited" : "github_search_failed",
            status: response.status,
            message: rateLimited
              ? "GitHub API rate limit exceeded. Try again shortly or configure a GITHUB_TOKEN on the server to raise the limit."
              : `GitHub search failed (HTTP ${response.status}): ${apiMessage}`,
            ...(payload.documentation_url ? { documentation_url: payload.documentation_url } : {}),
          },
        };
      }

      const items = Array.isArray(payload.items) ? payload.items.slice(0, MAX_RESULTS) : [];
      const results = items.map(normalizeRepo);

      return {
        ok: true,
        data: {
          query,
          result_count: results.length,
          total_count: typeof payload.total_count === "number" ? payload.total_count : results.length,
          incomplete_results: payload.incomplete_results === true,
          results,
        },
      };
    } catch (error) {
      if (ctx.signal?.aborted) {
        return {
          ok: false,
          error: { code: "aborted", message: "The GitHub repository search was aborted." },
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = controller.signal.aborted;
      return {
        ok: false,
        error: {
          code: timedOut ? "github_search_timeout" : "github_search_failed",
          message: timedOut
            ? `GitHub search timed out after ${REQUEST_TIMEOUT_MS} ms.`
            : `GitHub repository search failed: ${message}`,
        },
      };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  },
});
