import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

/**
 * Workspace client — the agent's workspace defaults to wherever mythgram is
 * started/running. The picker shows the current absolute path, lets the user
 * switch it (absolute or relative), and can create new folders (nested
 * `<folder>` or `<a>/<b>/<c>` supported). The ".mythgram" dir is initialized
 * where the workspace is set.
 */

export async function fetchWorkspace(signal?: AbortSignal): Promise<string> {
  const data = await requestJson<{ workspace?: string }>(
    routeUrl(API_ROUTES.workspaceGet),
    undefined,
    signal,
  );
  return typeof data.workspace === "string" ? data.workspace : "";
}

export async function setWorkspace(path: string): Promise<string> {
  const data = await requestJson<{ workspace?: string }>(routeUrl(API_ROUTES.workspaceSet), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!data.workspace) throw new Error("The backend did not return a workspace path.");
  return data.workspace;
}

export async function mkdirWorkspace(path: string): Promise<string> {
  const data = await requestJson<{ path?: string }>(routeUrl(API_ROUTES.workspaceMkdir), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return typeof data.path === "string" ? data.path : path;
}
