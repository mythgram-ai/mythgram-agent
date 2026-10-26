import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  ChevronLeft,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { fetchCustomAgentTools, fetchMainAgentSystemPrompt, type CustomAgentToolMeta } from "@/lib/customAgentTools";
import { AVAILABLE_CONNECTORS, fetchConnectorTools } from "@/lib/connectors";
import { fetchMcpEditorTools, humanizeMcpToolName } from "@/lib/mcp";
import { MAIN_AGENT_ID, fetchCustomAgents } from "@/lib/customAgents";
import { ImportCustomAgentsModal } from "@/components/panels/ImportCustomAgentsModal";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, Field, PanelHeader, TextArea, TextInput, Toggle } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const NAME_MAX = 70;
const DESC_MAX = 300;

interface Draft {
  id: string | null;
  name: string;
  description: string;
  systemPrompt: string;
  selectedTools: string[];
}

const empty = (): Draft => ({ id: null, name: "", description: "", systemPrompt: "", selectedTools: [] });

/** Connected connector tools (best-effort — an empty list when none are connected). */
async function connectorTools(signal?: AbortSignal): Promise<CustomAgentToolMeta[]> {
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
async function mcpTools(signal?: AbortSignal): Promise<CustomAgentToolMeta[]> {
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

/** Append extra tools to the registry catalog (names can never collide). */
function mergeExtraTools(
  base: CustomAgentToolMeta[],
  extra: CustomAgentToolMeta[],
): CustomAgentToolMeta[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((t) => t.name));
  return [...base, ...extra.filter((t) => !seen.has(t.name))];
}

/**
 * Custom Agents panel.
 *
 * A Custom Agent is a TOP-LEVEL, user-created Main Agent — not a sub-agent, child agent, or team
 * member. The app has the built-in Main Agent plus any number of Custom Agents at the same level;
 * selecting one makes chat turns run as that independent agent (its own system prompt + tools).
 *
 * Creating an agent pre-fills the System Prompt from the Main Agent's own prompt (so it starts with
 * the same base capabilities) and auto-fetches the grantable tools from the live registry, with a
 * manual Refresh button too.
 */
export function CustomAgentsPanel() {
  const customAgents = useStore((s) => s.customAgents);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);
  const addCustomAgent = useStore((s) => s.addCustomAgent);
  const updateCustomAgent = useStore((s) => s.updateCustomAgent);
  const deleteCustomAgent = useStore((s) => s.deleteCustomAgent);
  const setActiveCustomAgent = useStore((s) => s.setActiveCustomAgent);
  const setCustomAgents = useStore((s) => s.setCustomAgents);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Backend is the source of truth (agents can be created/deleted by any agent
  // mid-turn via the create_agent / delete_agent tools). Refresh on open so the
  // panel converges immediately instead of showing a stale store copy.
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const reloadAgents = useCallback(
    async (signal?: AbortSignal) => {
      setAgentsLoading(true);
      try {
        const fresh = await fetchCustomAgents(signal);
        if (signal?.aborted) return;
        setCustomAgents(fresh);
        setAgentsError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setAgentsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!signal?.aborted) setAgentsLoading(false);
      }
    },
    [setCustomAgents],
  );

  useEffect(() => {
    const controller = new AbortController();
    void reloadAgents(controller.signal);
    return () => controller.abort();
  }, [reloadAgents]);

  // The grantable tool catalog, fetched live from the backend (multi-agent tools already excluded
  // server-side). Falls back to an empty list with an error hint if the backend is unreachable.
  const [tools, setTools] = useState<CustomAgentToolMeta[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  // System-prompt pre-fill status (only meaningful while creating a new agent).
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const loadTools = useCallback(
    async (signal?: AbortSignal, preselectAll = false) => {
      try {
        const fetched = await fetchCustomAgentTools(signal);
        if (signal?.aborted) return;
        // Connected connector + MCP tools join the catalog so a Custom Agent can select them
        // (names can never collide with registry tools).
        const extra = await connectorTools(signal);
        const mcpExtra = await mcpTools(signal);
        const merged = mergeExtraTools(mergeExtraTools(fetched, extra), mcpExtra);
        setTools(merged);
        setToolsError(null);
        // For a brand-new agent, start with the full main-agent tool surface selected so it begins
        // with the same base capabilities as the Main Agent; the user can then deselect any.
        if (preselectAll) {
          setDraft((d) => (d && d.id === null ? { ...d, selectedTools: merged.map((t) => t.name) } : d));
        }
      } catch {
        if (signal?.aborted) return;
        setToolsError("Couldn't load the tool list from the backend. Try Refresh.");
      } finally {
        if (!signal?.aborted) setToolsLoading(false);
      }
    },
    [],
  );

  // Auto-fetch tools (and, for a new agent, the pre-filled system prompt) whenever the editor opens.
  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    const isNew = draft.id === null;

    setToolsLoading(true);
    void loadTools(controller.signal, isNew);

    if (isNew) {
      setPromptLoading(true);
      setPromptError(null);
      fetchMainAgentSystemPrompt(controller.signal)
        .then((prompt) => {
          if (controller.signal.aborted) return;
          // Only pre-fill an untouched new draft (don't clobber text the user already typed).
          setDraft((d) => (d && d.id === null && d.systemPrompt.trim().length === 0 ? { ...d, systemPrompt: prompt } : d));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setPromptError("Couldn't load the Main Agent's system prompt to pre-fill. You can still write your own.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setPromptLoading(false);
        });
    }

    return () => controller.abort();
    // We only want this to run when the editor opens (identified by the draft's id), not on every
    // keystroke. `loadTools` is stable (useCallback []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft !== null]);

  const refreshTools = () => {
    setToolsLoading(true);
    void loadTools(undefined, false);
  };

  /**
   * Re-fetch the Main Agent's system prompt and load it into the draft (overwrites the field). Unlike
   * the one-time pre-fill on open, this lets the user re-pull the latest prompt as many times as they
   * want while creating a Custom Agent. Only available while creating a NEW agent.
   */
  const reloadPrompt = () => {
    setPromptLoading(true);
    setPromptError(null);
    fetchMainAgentSystemPrompt()
      .then((prompt) => setDraft((d) => (d ? { ...d, systemPrompt: prompt } : d)))
      .catch(() => setPromptError("Couldn't reload the Main Agent's system prompt."))
      .finally(() => setPromptLoading(false));
  };

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setError("An agent name is required.");
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (draft.description.length > DESC_MAX)
      return setError(`Description must be ${DESC_MAX} characters or fewer.`);
    if (!draft.systemPrompt.trim()) return setError("A system prompt is required.");
    const clash = customAgents.some(
      (a) => a.id !== draft.id && a.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) return setError(`A custom agent named "${name}" already exists.`);

    const payload = {
      name,
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt,
      selectedTools: draft.selectedTools,
    };
    if (draft.id) {
      updateCustomAgent(draft.id, payload);
    } else {
      const created = addCustomAgent(payload);
      // Activate a newly created agent so the user can chat with it right away.
      setActiveCustomAgent(created.id);
    }
    setDraft(null);
    setError(null);
  };

  const activeAgent = customAgents.find((a) => a.id === activeCustomAgentId) ?? null;
  const mainActive = !activeAgent;

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <div className="flex items-start justify-between gap-2">
        <PanelHeader kicker="Your own top-level agents" title="Custom agents" />
        <button
          type="button"
          onClick={() => void reloadAgents()}
          disabled={agentsLoading}
          className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] disabled:opacity-50"
          title="Refresh the custom agents from the backend"
        >
          <RefreshCw className={cn("h-3 w-3", agentsLoading && "animate-spin")} />
          Refresh
        </button>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        A Custom Agent is your own top-level agent — a full Main Agent with its own name, description,
        system prompt, and selected tools. It is not a sub-agent: it runs independently with the same
        capabilities as the built-in Main Agent. Select one to chat with it.
      </p>
      {agentsError && (
        <p className="mb-3 text-xs text-[var(--danger)]" role="alert">
          Couldn&apos;t refresh custom agents from the backend: {agentsError}
        </p>
      )}

      <div
        className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--muted)]"
        aria-live="polite"
      >
        <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--subtle)]" />
        <span>
          Active agent:{" "}
          <span className="font-medium text-[var(--fg)]">
            {activeAgent ? activeAgent.name : "Main Agent"}
          </span>{" "}
          — chat turns run as this agent.
        </span>
      </div>

      {/* Built-in Main Agent — always available as the top-level default. */}
      <article
        className={cn(
          "mb-3 flex flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]",
          mainActive && "ring-1 ring-[var(--secondary)]",
        )}
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0 text-[var(--secondary)]" />
            <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">Main Agent</h3>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">
              built-in
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle
              checked={mainActive}
              onChange={() => setActiveCustomAgent(MAIN_AGENT_ID)}
              label="Use the Main Agent"
            />
            <span className="text-xs text-[var(--muted)]">{mainActive ? "Active" : "Use"}</span>
          </div>
        </div>
        <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">
          The default Mythgram agent with the full tool set.
        </p>
      </article>

      {customAgents.length === 0 ? (
        <EmptyState icon={<Boxes className="h-8 w-8" />}>
          No custom agents yet. Create one to get your own independently-configured Main Agent.
        </EmptyState>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {customAgents.map((agent) => {
            const isActive = agent.id === activeCustomAgentId;
            return (
              <li key={agent.id}>
                <article
                  className={cn(
                    "flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]",
                    isActive && "ring-1 ring-[var(--secondary)]",
                  )}
                  style={{ boxShadow: "var(--shadow-chip)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">{agent.name}</h3>
                  </div>
                  <p className="line-clamp-2 m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {agent.description || "No description."}
                  </p>
                  {agent.selectedTools.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.selectedTools.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
                        >
                          <Wrench className="h-2.5 w-2.5" />
                          {t}
                        </span>
                      ))}
                      {agent.selectedTools.length > 4 && (
                        <span className="text-[10px] text-[var(--subtle)]">
                          +{agent.selectedTools.length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <Toggle
                      checked={isActive}
                      onChange={(v) => setActiveCustomAgent(v ? agent.id : null)}
                      label={isActive ? "Active agent" : "Use this agent"}
                    />
                    <span className="text-xs text-[var(--muted)]">{isActive ? "Active" : "Use"}</span>
                  </div>

                  <div className="mt-4 flex items-center gap-1.5 border-t border-[var(--border)] pt-3">
                    <Button
                      variant="ghost"
                      className="px-2"
                      onClick={() => {
                        setError(null);
                        setDraft({
                          id: agent.id,
                          name: agent.name,
                          description: agent.description,
                          systemPrompt: agent.systemPrompt,
                          selectedTools: [...agent.selectedTools],
                        });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 text-[var(--subtle)] hover:text-[var(--danger)]"
                      onClick={() => deleteCustomAgent(agent.id)}
                      title="Delete custom agent"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setError(null);
            setToolsError(null);
            setPromptError(null);
            setDraft(empty());
          }}
        >
          <Plus className="h-4 w-4" /> Create custom agent
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import custom agent
        </Button>
      </div>

      <ImportCustomAgentsModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        icon={<Boxes className="h-4 w-4" />}
        title={draft?.id ? "Edit custom agent" : "New custom agent"}
        size="lg"
        footer={
          <Button onClick={save}>
            <Check className="h-4 w-4" /> Save
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4 p-5">
            <Field
              label="Agent name"
              hint={`${draft.name.length}/${NAME_MAX}`}
              hintError={draft.name.length > NAME_MAX}
            >
              <TextInput
                value={draft.name}
                maxLength={NAME_MAX}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Research Agent"
              />
            </Field>
            <Field
              label="Short description"
              hint={`${draft.description.length}/${DESC_MAX}`}
              hintError={draft.description.length > DESC_MAX}
            >
              <TextArea
                rows={2}
                maxLength={DESC_MAX}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="A short summary of what this agent does."
              />
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  System prompt
                  {promptLoading && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--subtle)]">
                      <RefreshCw className="h-3 w-3 animate-spin" /> pre-filling from Main Agent…
                    </span>
                  )}
                </span>
              }
              hint="no limit"
            >
              {draft.id === null && (
                <div className="mb-1.5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={reloadPrompt}
                    disabled={promptLoading}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] disabled:opacity-50"
                    title="Reload the Main Agent's system prompt into the editor"
                  >
                    <RotateCcw className={cn("h-3 w-3", promptLoading && "animate-spin")} />
                    Reload prompt
                  </button>
                </div>
              )}
              <TextArea
                rows={10}
                value={draft.systemPrompt}
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                className="font-mono text-xs"
                placeholder="The agent's full system prompt (pre-filled from the Main Agent — edit freely)."
              />
              <p className="mt-1 text-[10px] text-[var(--subtle)]">
                Pre-filled with the Main Agent's system prompt so this agent starts with the same base
                capabilities. Edit, add, or remove instructions to fully customize it.
              </p>
              {promptError && <p className="mt-1 text-[10px] text-[var(--danger)]">{promptError}</p>}
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Tools <span className="text-[var(--subtle)]">({tools.length} available)</span>
                </span>
                <button
                  type="button"
                  onClick={refreshTools}
                  disabled={toolsLoading}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] disabled:opacity-50"
                  title="Refresh the available tools from the backend"
                >
                  <RefreshCw className={cn("h-3 w-3", toolsLoading && "animate-spin")} />
                  Refresh tools
                </button>
              </div>
              {toolsError && <p className="mb-1.5 text-[10px] text-[var(--danger)]">{toolsError}</p>}
              <ToolMultiSelect
                tools={tools}
                selected={draft.selectedTools}
                onChange={(t) => setDraft({ ...draft, selectedTools: t })}
              />
              <p className="mt-1 text-[10px] text-[var(--subtle)]">
                Select which tools this agent can use. Tool implementations are always resolved fresh
                from the backend, so your agent benefits from the latest versions.
              </p>
            </div>

            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ToolMultiSelect({
  tools,
  selected,
  onChange,
}: {
  tools: CustomAgentToolMeta[];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => `${t.name} ${t.label} ${t.description}`.toLowerCase().includes(q));
  }, [query, tools]);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  const allNames = tools.map((t) => t.name);
  const allSelected = allNames.length > 0 && allNames.every((n) => selected.includes(n));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--fg)] hover:border-[var(--secondary)]"
        >
          <span className="text-[var(--muted)]">
            {selected.length > 0 ? `${selected.length} tool(s) selected` : "Select tools…"}
          </span>
          <ChevronLeft className={cn("h-4 w-4 transition-transform", open ? "-rotate-90" : "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : allNames)}
          disabled={allNames.length === 0}
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] disabled:opacity-50"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg)]"
            >
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
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--subtle)]"
            />
          </div>
          <div className="max-h-52 space-y-0.5 overflow-auto">
            {filtered.map((t) => {
              const active = selected.includes(t.name);
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => toggle(t.name)}
                  className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--chip)]"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border",
                      active ? "border-[var(--secondary)] bg-[var(--secondary)] text-white" : "border-[var(--border)]",
                    )}
                  >
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
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-[var(--subtle)]">
                {tools.length === 0 ? "No tools loaded — try Refresh tools." : "No matching tools."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
