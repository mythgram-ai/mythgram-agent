import { useRef, useState } from "react";
import { Check, FolderUp, Upload, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { fetchCustomAgentTools } from "@/lib/customAgentTools";
import {
  indexUploadedFiles,
  parseCustomAgentImport,
  partitionAgainstExisting,
  type CustomAgentImportError,
  type ImportedCustomAgentDraft,
} from "@/lib/importCustomAgents";
import { cn } from "@/utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportCustomAgentsModal({ open, onClose }: Props) {
  const customAgents = useStore((s) => s.customAgents);
  const addCustomAgent = useStore((s) => s.addCustomAgent);
  const setActiveCustomAgent = useStore((s) => s.setActiveCustomAgent);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ImportedCustomAgentDraft[]>([]);
  const [errors, setErrors] = useState<CustomAgentImportError[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [activeAgentEmpty, setActiveAgentEmpty] = useState(false);
  const [done, setDone] = useState<{
    imported: number;
    skipped: number;
    activated: string | null;
    activationWarning: string | null;
  } | null>(null);

  const reset = () => {
    setBusy(false);
    setDragOver(false);
    setGlobalError(null);
    setConfigPath(null);
    setDrafts([]);
    setErrors([]);
    setActiveAgent(null);
    setActiveAgentEmpty(false);
    setDone(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setGlobalError(null);
    setDone(null);
    try {
      const { filesByKey, configFile, configPath: found } = indexUploadedFiles(list);
      if (!configFile || !found) {
        setConfigPath(null);
        setDrafts([]);
        setErrors([]);
        setActiveAgent(null);
        setActiveAgentEmpty(false);
        setGlobalError(
          `No config.json found in the selection. Select your config.json file directly, or upload the whole folder containing it (e.g. my-agents/config.json).`,
        );
        return;
      }
      const text = await configFile.text();
      const result = await parseCustomAgentImport(text, found, filesByKey);
      setConfigPath(result.configPath);
      setDrafts(result.drafts);
      setErrors(result.errors);
      setActiveAgent(result.activeAgent);
      setActiveAgentEmpty(result.activeAgentEmpty);
      if (result.drafts.length === 0 && result.errors.length === 0) {
        setGlobalError("Nothing to import.");
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const { fresh, clashing } = partitionAgainstExisting(drafts, customAgents);

  // The requested active agent, resolved against the importable drafts.
  // Matching is case-insensitive so "Data_Analyst" still activates "data_analyst".
  const activeDraft =
    activeAgent !== null
      ? fresh.find((d) => d.name.toLowerCase() === activeAgent.toLowerCase()) ??
        drafts.find((d) => d.name.toLowerCase() === activeAgent.toLowerCase()) ??
        null
      : null;
  const activeWillClash =
    activeAgent !== null &&
    activeDraft !== null &&
    clashing.some((c) => c.name.toLowerCase() === activeDraft.name.toLowerCase());
  const activeMissing =
    activeAgent !== null &&
    !drafts.some((d) => d.name.toLowerCase() === activeAgent.toLowerCase());

  const doImport = async () => {
    if (fresh.length === 0) return;
    setBusy(true);
    setGlobalError(null);
    try {
      // Imported agents start with the full main-agent tool surface (same as a
      // newly created agent in the panel). Best-effort: when the backend is
      // unreachable the agents are still imported tool-less and can be edited.
      let toolNames: string[] = [];
      try {
        const tools = await fetchCustomAgentTools();
        toolNames = tools.map((t) => t.name);
      } catch {
        toolNames = [];
      }

      const createdIds = new Map<string, string>();
      for (const d of fresh) {
        const created = addCustomAgent({
          name: d.name,
          description: d.description,
          systemPrompt: d.systemPrompt,
          selectedTools: [...toolNames],
        });
        createdIds.set(d.name.toLowerCase(), created.id);
      }

      // Automatically activate the requested agent when it exists and loaded
      // successfully. A clashing (skipped) or missing name never activates —
      // the warning below tells the user exactly why.
      let activated: string | null = null;
      let activationWarning: string | null = null;
      if (activeAgent !== null) {
        const id = createdIds.get(activeAgent.toLowerCase());
        if (id) {
          setActiveCustomAgent(id);
          activated =
            fresh.find((d) => d.name.toLowerCase() === activeAgent.toLowerCase())?.name ??
            activeAgent;
        } else if (activeWillClash || activeMissing) {
          const reason = activeMissing
            ? `no imported agent is named "${activeAgent}"`
            : `"${activeAgent}" already exists and was skipped`;
          activationWarning =
            `Imported ${fresh.length} agent${fresh.length === 1 ? "" : "s"}, but could not activate "${activeAgent}" — ${reason}. ` +
            `Pick the agent to use from the Custom agents panel.`;
        }
      } else if (activeAgentEmpty) {
        activationWarning =
          `Imported ${fresh.length} agent${fresh.length === 1 ? "" : "s"}, but "active_agent" is empty — no agent was activated. ` +
          `Pick the agent to use from the Custom agents panel.`;
      }

      setDone({
        imported: fresh.length,
        skipped: clashing.length,
        activated,
        activationWarning,
      });
      setDrafts([]);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      icon={<Upload className="h-4 w-4" />}
      title="Import custom agents"
      size="lg"
      footer={
        drafts.length > 0 ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => void doImport()} disabled={fresh.length === 0 || busy}>
              <Check className="h-4 w-4" /> Import {fresh.length > 0 ? `${fresh.length} ` : ""}agent
              {fresh.length === 1 ? "" : "s"}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          Import custom agents you created locally. Select your{" "}
          <span className="font-mono">config.json</span> file directly, or upload the whole folder
          (recommended — system prompt files resolve against the folder).
        </p>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
          <div>my-agents/</div>
          <div>├── config.json</div>
          <div>└── custom_agents/</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;├── data_analyst/</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;└── system_prompt.md</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;└── project_planner/</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── system_prompt.md</div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
          <div>{"{"}</div>
          <div>&nbsp;&nbsp;&quot;active_agent&quot;: &quot;data_analyst&quot;,</div>
          <div>&nbsp;&nbsp;&quot;custom_agents&quot;: [</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;{"{"} &quot;name&quot;: &quot;data_analyst&quot;,</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&quot;description&quot;: &quot;Analyzes datasets…&quot;,</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&quot;system_prompt_path&quot;: &quot;./custom_agents/data_analyst/system_prompt.md&quot; {"}"}</div>
          <div>&nbsp;&nbsp;]</div>
          <div>{"}"}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" /> Choose config.json
          </Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()} disabled={busy}>
            <FolderUp className="h-4 w-4" /> Choose folder
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            // @ts-expect-error non-standard directory attributes
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center text-sm transition-colors",
            dragOver ? "border-[var(--secondary)] text-[var(--fg)]" : "border-[var(--border)] text-[var(--subtle)]",
          )}
        >
          {busy ? "Reading files…" : "Or drag & drop config.json (or the whole folder) here"}
        </div>

        {globalError && (
          <div
            className="rounded-[var(--radius-md)] border px-3 py-2 text-xs"
            style={{
              borderColor: "color-mix(in oklab, var(--danger) 35%, transparent)",
              background: "var(--danger-soft)",
              color: "var(--danger)",
            }}
          >
            {globalError}
          </div>
        )}

        {done && (
          <div
            className="rounded-[var(--radius-md)] border px-3 py-2 text-xs"
            style={{
              borderColor: "color-mix(in oklab, var(--success, #22c55e) 35%, transparent)",
              background: "color-mix(in oklab, var(--success, #22c55e) 12%, transparent)",
              color: "var(--fg)",
            }}
          >
            {done.activationWarning ? (
              <>{done.activationWarning}</>
            ) : (
              <>
                Imported {done.imported} agent{done.imported === 1 ? "" : "s"}
                {done.skipped > 0 ? ` (${done.skipped} skipped — name already exists).` : "."}
                {done.activated
                  ? ` "${done.activated}" is now the active agent.`
                  : " They now appear in the Custom agents panel like any other agent."}
              </>
            )}
          </div>
        )}

        {configPath && (drafts.length > 0 || errors.length > 0) && !done && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--subtle)]">
              From <span className="font-mono">{configPath}</span>: {drafts.length} valid,{" "}
              {errors.length} with problems.
              {activeAgent !== null && (
                <>
                  {" "}
                  Requested active agent: <span className="font-mono">{activeAgent}</span>
                  {activeMissing && (
                    <span className="text-[var(--danger)]"> (not found in this import)</span>
                  )}
                  {activeWillClash && (
                    <span className="text-[var(--warning, #d97706)]">
                      {" "}
                      (already exists — will not be re-imported or activated)
                    </span>
                  )}
                </>
              )}
              {activeAgentEmpty && (
                <> “active_agent” is empty — no agent will be auto-activated.</>
              )}
            </p>
            {drafts.length > 0 && (
              <ul className="max-h-52 space-y-1 overflow-auto">
                {drafts.map((d) => {
                  const clash = clashing.includes(d);
                  const willActivate =
                    activeAgent !== null && d.name.toLowerCase() === activeAgent.toLowerCase() && !clash;
                  return (
                    <li
                      key={d.name}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-xs"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success, #22c55e)]" />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono font-medium text-[var(--fg)]">{d.name}</span>
                        <span className="block truncate text-[var(--muted)]">{d.description}</span>
                        <span className="block truncate font-mono text-[10px] text-[var(--subtle)]">
                          {d.promptPath} · {d.systemPrompt.length} chars
                          {willActivate && " · will be activated"}
                        </span>
                        {clash && (
                          <span className="block text-[10px] text-[var(--warning, #d97706)]">
                            Name already exists — will be skipped.
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {errors.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-auto">
                {errors.map((e, i) => (
                  <li
                    key={`${e.index}-${e.name}-${i}`}
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs"
                    style={{
                      borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)",
                      color: "var(--danger)",
                    }}
                  >
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <span className="font-mono font-medium">{e.name || `Entry #${e.index + 1}`}</span>:{" "}
                      {e.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {clashing.length > 0 && (
              <p className="text-[11px] text-[var(--warning, #d97706)]">
                {clashing.length} name{clashing.length === 1 ? "" : "s"} already exist
                {clashing.length === 1 ? "s" : ""} and will be skipped:{" "}
                <span className="font-mono">{clashing.map((c) => c.name).join(", ")}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
