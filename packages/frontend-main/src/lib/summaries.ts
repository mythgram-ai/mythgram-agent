import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

export interface SummaryHistoryItem {
  handoff_id: string;
  chat_id: string;
  /** Top-level agent that triggered the run ("main" for older records without a tag). */
  agent?: "main" | "custom";
  custom_agent_id?: string | null;
  custom_agent_name?: string | null;
  state: string;
  summary: string | null;
  summary_chars: number | null;
  latest_user_input: string | null;
  code: string | null;
  error: string | null;
  created_at: number;
  finished_at: number;
}

export interface SubAgentSummaryHistoryItem {
  handoff_id: string;
  chat_id: string;
  sub_session_id: string;
  sub_agent: string;
  state: string;
  summary: string | null;
  summary_chars: number | null;
  latest_user_input: string | null;
  code: string | null;
  error: string | null;
  created_at: number;
  finished_at: number;
}

/** Past summarization runs for a chat session, oldest first (bounded backend-side). */
export async function fetchSummaryHistory(chatId: string): Promise<SummaryHistoryItem[]> {
  const data = await requestJson<{ history?: SummaryHistoryItem[] }>(
    routeUrl(API_ROUTES.summariesHistory, { params: { chatId } }),
  );
  return Array.isArray(data.history) ? data.history : [];
}

/** Past custom-agent summarization runs for a chat session, oldest first (bounded backend-side). */
export async function fetchCustomSummaryHistory(chatId: string): Promise<SummaryHistoryItem[]> {
  const data = await requestJson<{ history?: SummaryHistoryItem[] }>(
    routeUrl(API_ROUTES.customSummariesHistory, { params: { chatId } }),
  );
  return Array.isArray(data.history) ? data.history : [];
}

/** Past sub-agent summarization runs for a chat session, oldest first (bounded backend-side). */
export async function fetchSubAgentSummaryHistory(chatId: string): Promise<SubAgentSummaryHistoryItem[]> {
  const data = await requestJson<{ history?: SubAgentSummaryHistoryItem[] }>(
    routeUrl(API_ROUTES.subAgentSummariesHistory, { params: { chatId } }),
  );
  return Array.isArray(data.history) ? data.history : [];
}
