import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronLeft, Pencil, Plus, RefreshCw, Search, Trash2, Upload, Wrench, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import { ImportSubAgentsModal } from "@/components/panels/ImportSubAgentsModal";

import { SUB_AGENT_TOOLS, fetchSubAgentTools, type SubAgentToolMeta } from "@/lib/subAgentTools";
import { AVAILABLE_CONNECTORS, fetchConnectorTools } from "@/lib/connectors";
import { fetchMcpEditorTools, humanizeMcpToolName } from "@/lib/mcp";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, PanelHeader, TextArea, TextInput, Toggle } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const NAME_MAX = 70;
const DESC_MAX = 300;
/** A valid sub-agent name: lowercase, no spaces/tabs, only lowercase letters/digits and single -/_. */
const NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Sanitize a typed sub-agent name: force lowercase and drop anything that is not [a-z0-9_-]. */
function sanitizeSubAgentName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/** Built-in defaults have ids prefixed with "default-" and can never be deleted. */
function isDefaultSubAgent(id: string): boolean {
  return id.startsWith("default-");
}

/** Connected connector tools (best-effort — an empty list when none are connected). */
async function connectorTools(signal?: AbortSignal): Promise<SubAgentToolMeta[]> {
  try {
    const tools = await fetchConnectorTools(signal);
    const byId = new Map(AVAILABLE_CONNECTORS.map((c) => [c.id, c.name]));
    return tools.map((t) => ({
      name: t.name,
      label: t.display || t.name,
      description: `[${byId.get(t.connector_id) ?? t.connector_id}] ${t.description || t.display || t.name}`,
    }));
  } catch {
    return [];
  }
}

/** Connected MCP server tools (best-effort — an empty list when none are connected). */
async function mcpTools(signal?: AbortSignal): Promise<SubAgentToolMeta[]> {
  try {
    const tools = await fetchMcpEditorTools(signal);
    return tools.map((t) => ({
      name: t.name,
      label: t.display || humanizeMcpToolName(t.name),
      description: `[MCP ${t.server_name}] ${t.description || t.display || t.name}`,
    }));
  } catch {
    return [];
  }
}

/** Append extra tools to the registry list (names can never collide). */
function mergeExtraTools(
  base: SubAgentToolMeta[],
  extra: SubAgentToolMeta[],
): SubAgentToolMeta[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((t) => t.name));
  return [...base, ...extra.filter((t) => !seen.has(t.name))];
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  enabled: boolean;
}

const empty = (): Draft => ({ id: null, name: "", description: "", systemPrompt: "", tools: [], enabled: true });

export function AgentsPanel() {
  const subAgents = useStore((s) => s.subAgents);
  const addSubAgent = useStore((s) => s.addSubAgent);
  const updateSubAgent = useStore((s) => s.updateSubAgent);
  const deleteSubAgent = useStore((s) => s.deleteSubAgent);
  const toggleSubAgent = useStore((s) => s.toggleSubAgent);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // The catalog of grantable tools, fetched live from the backend (restricted tools already
  // excluded server-side). Falls back to the bundled list if the backend is unreachable.
  const [tools, setTools] = useState<SubAgentToolMeta[]>([...SUB_AGENT_TOOLS]);
  // Start in the loading state: the mount effect fetches immediately. Keeping the flag's initial
  // value true means no state is set synchronously inside the effect.
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);

  // Every state update happens after the awaited fetch (or in catch/finally), never synchronously.
  const loadTools = useCallback(async (signal?: AbortSignal) => {
    try {
      const fetched = await fetchSubAgentTools(signal);
      if (signal?.aborted) return;
      if (fetched.length > 0) setTools(mergeExtraTools(mergeExtraTools(fetched, await connectorTools(signal)), await mcpTools(signal)));
      setToolsError(null);
    } catch {
      if (signal?.aborted) return;
      // Keep whatever list we already have (bundled fallback) and surface a hint.
      setToolsError("Couldn't load the live tool list — showing the bundled set. Try refetch.");
    } finally {
      if (!signal?.aborted) setToolsLoading(false);
    }
  }, []);

  // Fetch once on mount so the popup always reflects the backend's real tool registry. State is
  // only updated from the promise callbacks (never synchronously in the effect body).
  useEffect(() => {
    const controller = new AbortController();
    fetchSubAgentTools(controller.signal)
      .then(async (fetched) => {
        if (controller.signal.aborted) return;
        if (fetched.length > 0) {
          setTools(mergeExtraTools(mergeExtraTools(fetched, await connectorTools(controller.signal)), await mcpTools(controller.signal)));
        } else {
          // Registry fetch came back empty — still offer the connector tools, if any.
          const extra = await connectorTools(controller.signal);
          const mcpExtra = await mcpTools(controller.signal);
          if (!controller.signal.aborted && (extra.length > 0 || mcpExtra.length > 0)) {
            setTools((prev) => mergeExtraTools(mergeExtraTools(prev, extra), mcpExtra));
          }
        }
        setToolsError(null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setToolsError("Couldn't load the live tool list — showing the bundled set. Try refetch.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setToolsLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Manual refetch from the popup — set the spinner in the event handler (not in an effect).
  const refetchTools = () => {
    setToolsLoading(true);
    void loadTools();
  };

  const save = () => {
    if (!draft) return;
    const name = sanitizeSubAgentName(draft.name.trim());
    if (!name) return setError("A name is required.");
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (!NAME_PATTERN.test(name))
      return setError("Name must be lowercase with no spaces — use letters, digits and single -/_ (e.g. deepexplorer).");
    if (draft.description.length > DESC_MAX) return setError(`Description must be ${DESC_MAX} characters or fewer.`);
    if (!draft.systemPrompt.trim()) return setError("A system prompt is required.");
    const clash = subAgents.some((a) => a.id !== draft.id && a.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) return setError(`A sub-agent named "${name}" already exists.`);
    const payload = {
      name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      tools: draft.tools,
      enabled: draft.enabled,
    };
    if (draft.id) updateSubAgent(draft.id, payload);
    else addSubAgent(payload);
    setDraft(null);
    setError(null);
  };

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Hands that work in parallel" title="Sub-agents" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Specialized agents the main agent can delegate focused tasks to. Each has its own prompt and
        a scoped set of tools.
      </p>

      {subAgents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] py-12 text-center">
          <Bot className="h-8 w-8 text-[var(--subtle)]" />
          <p className="text-sm text-[var(--muted)]">No sub-agents yet.</p>
        </div>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {subAgents.map((agent) => {
            const isDefault = isDefaultSubAgent(agent.id);
            return (
            <li key={agent.id}>
              <article className="flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]" style={{ boxShadow: "var(--shadow-chip)" }}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">{agent.name}</h3>
                  <div className="flex items-center gap-1.5">
                    {isDefault && <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">default</span>}
                    <Toggle checked={agent.enabled} onChange={() => toggleSubAgent(agent.id)} label="Enabled" />
                  </div>
                </div>
                <p className="line-clamp-2 m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">{agent.description}</p>
                {agent.tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {agent.tools.slice(0, 4).map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                        <Wrench className="h-2.5 w-2.5" />
                        {t}
                      </span>
                    ))}
                    {agent.tools.length > 4 && <span className="text-[10px] text-[var(--subtle)]">+{agent.tools.length - 4}</span>}
                  </div>
                )}
                <div className="mt-4 flex items-center gap-1.5 border-t border-[var(--border)] pt-3">
                  <Button variant="ghost" className="px-2" onClick={() => { setError(null); setDraft({ id: agent.id, name: agent.name, description: agent.description, systemPrompt: agent.systemPrompt, tools: [...agent.tools], enabled: agent.enabled }); }}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {/* Only user- or LLM-created sub-agents can be deleted; built-in defaults cannot. */}
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      className="px-2 text-[var(--subtle)] hover:text-[var(--danger)]"
                      onClick={() => deleteSubAgent(agent.id)}
                      title="Delete sub-agent"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                </div>
              </article>
            </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => { setError(null); setDraft(empty()); }}>
          <Plus className="h-4 w-4" /> New sub-agent
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import sub-agent
        </Button>
      </div>

      <ImportSubAgentsModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        icon={<Bot className="h-4 w-4" />}
        title={draft?.id ? "Edit sub-agent" : "New sub-agent"}
        size="lg"
        footer={
          <Button onClick={save}>
            <Check className="h-4 w-4" /> Save
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4 p-5">
            <Field label="Sub-agent name" hint={`${draft.name.length}/${NAME_MAX}`} hintError={draft.name.length > NAME_MAX}>
              <TextInput
                value={draft.name}
                maxLength={NAME_MAX}
                onChange={(e) => setDraft({ ...draft, name: sanitizeSubAgentName(e.target.value) })}
                placeholder="e.g. deepexplorer"
                className="font-mono"
              />
              <p className="mt-1 text-[10px] text-[var(--subtle)]">Lowercase only, no spaces or tabs (letters, digits, and single -/_).</p>
            </Field>
            <Field label="Short description" hint={`${draft.description.length}/${DESC_MAX}`} hintError={draft.description.length > DESC_MAX}>
              <TextArea rows={2} maxLength={DESC_MAX} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <Field label="System prompt" hint="no limit">
              <TextArea rows={7} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} className="font-mono text-xs" />
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Allowed tools <span className="text-[var(--subtle)]">({tools.length} available)</span>
                </span>
                <button
                  type="button"
                  onClick={refetchTools}
                  disabled={toolsLoading}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] disabled:opacity-50"
                  title="Refetch the available tools from the backend"
                >
                  <RefreshCw className={cn("h-3 w-3", toolsLoading && "animate-spin")} />
                  Refetch
                </button>
              </div>
              {toolsError && <p className="mb-1.5 text-[10px] text-[var(--subtle)]">{toolsError}</p>}
              <ToolMultiSelect tools={tools} selected={draft.tools} onChange={(t) => setDraft({ ...draft, tools: t })} />
            </div>
            <div className="flex items-center gap-2">
              <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
              <span className="text-sm text-[var(--muted)]">Enabled</span>
            </div>
            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ToolMultiSelect({ tools, selected, onChange }: { tools: SubAgentToolMeta[]; selected: string[]; onChange: (tools: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => `${t.name} ${t.label} ${t.description}`.toLowerCase().includes(q));
  }, [query, tools]);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--fg)] hover:border-[var(--secondary)]">
        <span className="text-[var(--muted)]">{selected.length > 0 ? `${selected.length} tool(s) selected` : "Select tools…"}</span>
        <ChevronLeft className={cn("h-4 w-4 transition-transform", open ? "-rotate-90" : "rotate-90")} />
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg)]">
              <Wrench className="h-2.5 w-2.5" />
              {name}
              <button onClick={() => toggle(name)} className="text-[var(--subtle)] hover:text-[var(--danger)]">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-2">
          <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-[var(--subtle)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools…" className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--subtle)]" />
          </div>
          <div className="max-h-52 space-y-0.5 overflow-auto">
            {filtered.map((t) => {
              const active = selected.includes(t.name);
              return (
                <button key={t.name} type="button" onClick={() => toggle(t.name)} className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--chip)]">
                  <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border", active ? "border-[var(--secondary)] bg-[var(--secondary)] text-white" : "border-[var(--border)]")}>
                    {active && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="text-xs font-medium text-[var(--fg)]">{t.label}</span>
                    <span className="block text-[10px] text-[var(--subtle)]">
                      {t.name} — {t.description}
                    </span>
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-[var(--subtle)]">No matching tools.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
