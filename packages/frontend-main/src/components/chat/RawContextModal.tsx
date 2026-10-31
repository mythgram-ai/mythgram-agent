import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, Copy, Check, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import {
  MAIN_RAW_CONTEXT_AGENT,
  fetchMainRawContext,
  formatRawContextPayload,
  rawContextAgentLabel,
  type MainRawContext,
  type RawContextAgent,
} from "@/lib/rawContext";

interface RawContextModalProps {
  open: boolean;
  onClose: () => void;
  /** Session whose context to display. Null = no thread selected. */
  sessionId: string | null;
  /**
   * Agent scope to inspect. Kept as a prop so the same modal serves every agent
   * (main/custom/chat/sub_agent/team/ceo).
   */
  agent?: RawContextAgent;
  /** Sub-agent session id (required when agent is sub_agent). */
  subSessionId?: string;
  /** Team agent name (required when agent is team). */
  teamAgent?: string;
  /** CEO-system agent name (required when agent is ceo). */
  ceoAgent?: string;
  /** Stored custom agent id (optional when agent is custom). */
  customAgentId?: string;
}

/**
 * Secondary modal showing one agent's current context in raw form.
 *
 * Mounted from the Context Meter popup (all scopes). Fetches the exact
 * provider-format inputs via `GET /api/sessions/:id/context` and renders them as
 * unformatted JSON in a scrollable `<pre>` — no markdown, no trimming, no
 * redaction — so the original content is preserved as accurately as possible.
 * Loading / error / empty states never close the parent meter popup.
 */
export function RawContextModal({
  open,
  onClose,
  sessionId,
  agent = MAIN_RAW_CONTEXT_AGENT,
  subSessionId,
  teamAgent,
  ceoAgent,
  customAgentId,
}: RawContextModalProps) {
  const [data, setData] = useState<MainRawContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const label = rawContextAgentLabel(agent);

  const load = useCallback(
    async (id: string, scope: RawContextAgent, signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      setCopied(false);
      try {
        const ctx = await fetchMainRawContext(id, {
          agent: scope,
          signal,
          subSessionId,
          teamAgent,
          ceoAgent,
          customAgentId,
        });
        if (signal.aborted) return;
        setData(ctx);
      } catch (e) {
        if (signal.aborted) return;
        setData(null);
        setError(e instanceof Error ? e.message : "Could not load the raw context.");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [subSessionId, teamAgent, ceoAgent, customAgentId],
  );

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    if (!sessionId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    void load(sessionId, agent, controller.signal);
    return () => controller.abort();
  }, [open, sessionId, agent, subSessionId, teamAgent, ceoAgent, customAgentId, attempt, load]);

  const rawText = useMemo(() => (data ? formatRawContextPayload(data) : ""), [data]);

  const copy = useCallback(async () => {
    if (!rawText) return;
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — select fallback below still works.
      setCopied(false);
    }
  }, [rawText]);

  const isEmpty = !loading && !error && data !== null && data.messageCount === 0 && !data.systemPrompt;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${label} raw context`}
      icon={<Braces className="h-4 w-4" strokeWidth={1.8} />}
      size="lg"
      actions={
        data && !loading && !error ? (
          <button
            type="button"
            onClick={() => void copy()}
            title="Copy raw context JSON"
            aria-label="Copy raw context JSON"
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        ) : undefined
      }
      footer={
        <>
          {data && !loading && !error && (
            <Button variant="outline" onClick={() => void copy()}>
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy raw JSON
                </>
              )}
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-3 p-5">
        {!sessionId ? (
          <p className="m-0 text-sm leading-relaxed text-[var(--muted)]">
            No thread selected — open a chat thread to inspect the {label.toLowerCase()}&rsquo;s
            context.
          </p>
        ) : loading ? (
          <p className="m-0 text-sm leading-relaxed text-[var(--muted)]">
            Loading the {label.toLowerCase()}&rsquo;s current context…
          </p>
        ) : error ? (
          <div className="space-y-2">
            <p className="m-0 text-sm leading-relaxed text-[var(--danger)]">{error}</p>
            <div>
              <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </div>
          </div>
        ) : data ? (
          isEmpty ? (
            <div className="space-y-2">
              <p className="m-0 text-sm leading-relaxed text-[var(--muted)]">
                No context yet — the {label.toLowerCase()} has no transcript or system prompt
                stored for this thread.
              </p>
              <p className="m-0 text-xs leading-relaxed text-[var(--subtle)]">
                Context appears after the {label.toLowerCase()}&rsquo;s first turn. Branched
                threads start fresh with no past context by design.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <MetaChip label={`Source: ${data.source}`} />
                <MetaChip label={`${data.messageCount} message${data.messageCount === 1 ? "" : "s"}`} />
                <MetaChip
                  label={`System prompt: ${data.systemPromptSource === "custom" ? "custom" : "built-in"}`}
                />
                {data.systemPrompt != null && (
                  <MetaChip label={`${data.systemPrompt.length.toLocaleString("en-US")} chars prompt`} />
                )}
              </div>
              <pre
                aria-label={`${label} raw context JSON`}
                className="max-h-[52vh] overflow-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--fg)]"
              >
                {rawText}
              </pre>
              <p className="m-0 text-[11px] leading-relaxed text-[var(--subtle)]">
                Raw provider-format inputs (system prompt + transcript + latest usage), shown
                exactly as stored. Scope: {label.toLowerCase()} · this thread.
              </p>
            </>
          )
        ) : null}
      </div>
    </Modal>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--chip)] px-2.5 py-0.5 font-medium text-[var(--muted)]">
      {label}
    </span>
  );
}
