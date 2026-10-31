import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  AudioLines,
  Bot,
  Blocks,
  Braces,
  Brain,
  Check,
  ChevronDown,
  ClipboardList,
  CornerDownLeft,
  Download,
  ExternalLink,
  Eye,
  FileDiff,
  FileEdit,
  FilePlus2,
  FileText,
  FolderTree,
  Globe,
  Hash,
  History,
  Image as ImageIcon,
  Library,
  Link2,
  List,
  ListTodo,
  ListTree,
  Loader2,
  MessagesSquare,
  PackagePlus,
  Paperclip,
  Presentation,
  LayoutTemplate,
  Pencil,
  PencilLine,
  Plug,
  QrCode,
  Repeat2,
  Save,
  Search,
  Send,
  Server,
  ShieldCheck,
  PlugZap,
  Unplug,
  Activity,
  Terminal,
  Timer,
  Trash2,
  UserMinus,
  UserPlus,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import type {
  AttachedFile,
  SubAgentRun,
  ToolActivity,
  ToolActivityStatus,
} from "@/types";
import { cn } from "@/utils/cn";
import { formatBytes } from "@/utils/format";
import { useStore } from "@/store/useStore";
import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { fetchMcpServers, startMcpOAuth, pollMcpConnected } from "@/lib/mcp";
import { AVAILABLE_CHANNELS, createChannel, fetchChannels } from "@/lib/channels";
import {
  fetchConnectorsOverview,
  pollConnectorActive,
  startConnectorConnect,
} from "@/lib/connectors";

const MEMORY_TOOLS = new Set([
  "memory_list",
  "memory_read",
  "memory_write",
  "memory_edit",
  "memory_delete",
]);
const KNOWLEDGE_TOOLS = new Set([
  "knowledge_list",
  "knowledge_read",
  "knowledge_create",
  "knowledge_edit",
  "knowledge_delete",
]);

const PROVIDER_LABELS: Record<string, string> = {
  tavily: "Tavily",
  exa: "Exa",
  serpapi: "SerpAPI",
  duckduckgo: "DuckDuckGo",
  builtin: "Built-in scraper",
  firecrawl: "Firecrawl",
};

const ICONS: Record<string, typeof Terminal> = {
  file_write: FilePlus2,
  file_read: FileText,
  file_list: FolderTree,
  grep: Search,
  astgrep: Braces,
  glob: FolderTree,
  lsp: Braces,
  str_replace: Pencil,
  apply_multiple_edits: PencilLine,
  apply_patch: FileDiff,
  shall_tool: Terminal,
  shell_view: Eye,
  bash_write_to_process: CornerDownLeft,
  web_search: Globe,
  fatch_web_urls: Globe,
  read_image: ImageIcon,
  scan_qr_code: QrCode,
  image_search: ImageIcon,
  generate_speech: AudioLines,
  call_sub_agent: Bot,
  call_multiple_sub_agents: Bot,
  list_sub_agents: ListTree,
  list_skills: Blocks,
  skill_initialize: PackagePlus,
  list_available_prompts_in_prompt_library: List,
  save_prompt_in_prompt_library: Save,
  delete_prompt_from_prompt_library: Trash2,
  create_sub_agent: UserPlus,
  create_skill: Wand2,
  delete_sub_agent: UserMinus,
  delete_skill: Trash2,
  list_sub_agent_sessions: History,
  reuse_same_sub_agent_session: Repeat2,
  connect_remote_mcp: Server,
  connect_local_mcp_server: Server,
  list_available_mcp_servers: List,
  delete_mcp_server: Trash2,
  on_off_mcp_server: Plug,
  get_mcp_server_status: Activity,
  list_available_application_connectors: List,
  connect_applications_connectors: PlugZap,
  disconnect_application_connector: Unplug,
  get_application_connector_status: Activity,
  wait: Timer,
  TodoWrite: ListTodo,
  read_todos: ClipboardList,
  memory_search: Search,
  knowledge_search: Search,
  embed_url: Link2,
  attach_files: Paperclip,
  organize_slides: LayoutTemplate,
  get_available_slides_template: LayoutTemplate,
  read_slides_template: LayoutTemplate,
  present_slides: Presentation,
  manage_slides: LayoutTemplate,
  save_slides_as_template: Presentation,
  sliding_window_truncated: History,
};

/* ------------------------------------------------------------------ shared UI */

function StatusIcon({ status }: { status: ToolActivityStatus }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--secondary)]" />;
  if (status === "ok") return <Check className="h-3.5 w-3.5 text-[var(--success)]" />;
  return <X className="h-3.5 w-3.5 text-[var(--danger)]" />;
}

function chipClasses(status: ToolActivityStatus, clickable: boolean): string {
  return cn(
    "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
    status === "error"
      ? "border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : "border-[var(--border)] bg-[var(--chip)] text-[var(--fg)]",
    clickable && "hover:bg-[var(--chip-hover)]",
    !clickable && "cursor-default",
  );
}

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "off" | "accent" | "danger" | "warn" }) {
  const tones: Record<string, string> = {
    default: "border-[var(--border)] text-[var(--muted)]",
    off: "border-dashed border-[var(--border)] text-[var(--subtle)]",
    accent: "border-[var(--secondary)] text-[var(--secondary)]",
    danger: "border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] text-[var(--danger)]",
    warn: "border-[color:color-mix(in_oklab,var(--warning)_35%,transparent)] text-[var(--warning)]",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]", tones[tone])}>
      {children}
    </span>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1.5 w-full space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3 text-xs fade-in">
      {children}
    </div>
  );
}

function Pre({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--chip)] p-2 font-mono text-[11px] leading-relaxed text-[var(--fg)]",
        className,
      )}
    >
      {children}
    </pre>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">{children}</div>;
}

/** Reusable expandable chip shell. `panel` is only invoked when expanded (perf). */
function Shell({
  icon,
  label,
  pills,
  status,
  expandable,
  panel,
  defaultOpen,
}: {
  icon: ReactNode;
  label: ReactNode;
  pills?: ReactNode;
  status: ToolActivityStatus;
  expandable: boolean;
  panel?: () => ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen === true);
  return (
    <div className="w-full max-w-full">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={chipClasses(status, expandable)}
      >
        <span className="shrink-0 opacity-80">{icon}</span>
        <span className="max-w-[280px] truncate font-medium">{label}</span>
        {pills}
        {expandable && (
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-70 transition-transform", open && "rotate-180")} />
        )}
        <StatusIcon status={status} />
      </button>
      {expandable && open && panel && <Panel>{panel()}</Panel>}
    </div>
  );
}

/* ------------------------------------------------------------------ dispatcher */

type Result = { ok?: boolean; data?: Record<string, any>; error?: Record<string, any> } | undefined;

function parts(tool: ToolActivity) {
  const result = tool.result as Result;
  const hasResult = tool.status !== "running" && Boolean(result);
  const data = result?.ok ? result?.data : undefined;
  const error = result && !result.ok ? result.error : undefined;
  const args = (tool.args ?? {}) as Record<string, any>;
  return { result, hasResult, data, error, args, icon: (ICONS[tool.name] ?? Terminal) };
}

export function ToolChip({ tool }: { tool: ToolActivity }) {
  if (tool.name === "call_sub_agent" && tool.subAgent) return <SubAgentChip tool={tool} run={tool.subAgent} />;
  if (tool.name === "call_multiple_sub_agents") return <MultiSubAgentChip tool={tool} />;
  if (tool.name === "shall_tool") return <ShellChip tool={tool} />;
  if (tool.name === "shell_view") return <ShellViewChip tool={tool} />;
  if (tool.name === "bash_write_to_process") return <BashWriteChip tool={tool} />;
  if (tool.name === "file_read") return <FileReadChip tool={tool} />;
  if (tool.name === "grep") return <GrepChip tool={tool} />;
  if (tool.name === "astgrep") return <AstGrepChip tool={tool} />;
  if (tool.name === "glob") return <GlobChip tool={tool} />;
  if (tool.name === "lsp") return <LspChip tool={tool} />;
  if (tool.name === "str_replace") return <StrReplaceChip tool={tool} />;
  if (tool.name === "apply_multiple_edits") return <ApplyEditsChip tool={tool} />;
  if (tool.name === "apply_patch") return <ApplyPatchChip tool={tool} />;
  if (tool.name === "read_image") return <ReadImageChip tool={tool} />;
  if (tool.name === "scan_qr_code") return <ScanQrCodeChip tool={tool} />;
  if (tool.name === "image_search") return <ImageSearchChip tool={tool} />;
  if (tool.name === "generate_speech") return <GenerateSpeechChip tool={tool} />;
  if (tool.name === "fatch_web_urls") return <FetchChip tool={tool} />;
  if (tool.name === "web_search") return <WebSearchChip tool={tool} />;
  if (tool.name === "TodoWrite" || tool.name === "read_todos") return <TodoChip tool={tool} />;
  if (tool.name === "memory_search" || tool.name === "knowledge_search") return <SearchLocatorChip tool={tool} />;
  if (MEMORY_TOOLS.has(tool.name)) return <MemoryChip tool={tool} kind="memory" />;
  if (KNOWLEDGE_TOOLS.has(tool.name)) return <MemoryChip tool={tool} kind="knowledge" />;
  if (PROMPT_LIBRARY_TOOLS.has(tool.name)) return <PromptLibraryChip tool={tool} />;
  if (tool.name === "embed_url") return <EmbedUrlChip tool={tool} />;
  if (tool.name === "attach_files") return <AttachFilesChip tool={tool} />;
  if (tool.name === "list_sub_agents") return <ListSubAgentsChip tool={tool} />;
  if (tool.name === "list_skills") return <ListSkillsChip tool={tool} />;
  if (tool.name === "skill_initialize") return <SkillInitChip tool={tool} />;
  if (tool.name === "create_sub_agent") return <CreateSubAgentChip tool={tool} />;
  if (tool.name === "delete_sub_agent") return <DeleteSubAgentChip tool={tool} />;
  if (tool.name === "create_skill") return <CreateSkillChip tool={tool} />;
  if (tool.name === "delete_skill") return <DeleteSkillChip tool={tool} />;
  if (tool.name === "list_sub_agent_sessions") return <ListSubAgentSessionsChip tool={tool} />;
  if (tool.name === "reuse_same_sub_agent_session") return <ReuseSessionChip tool={tool} />;
  if (tool.name === "wait") return <WaitChip tool={tool} />;
  if (tool.name === "connect_remote_mcp") return <ConnectRemoteMcpChip tool={tool} />;
  if (tool.name === "connect_local_mcp_server") return <ConnectLocalMcpChip tool={tool} />;
  if (tool.name === "list_available_mcp_servers") return <ListMcpServersChip tool={tool} />;
  if (tool.name === "delete_mcp_server") return <DeleteMcpServerChip tool={tool} />;
  if (tool.name === "on_off_mcp_server") return <ToggleMcpServerChip tool={tool} />;
  if (tool.name === "get_mcp_server_status") return <McpStatusChip tool={tool} />;
  if (tool.name === "list_available_application_connectors") return <ListAppConnectorsChip tool={tool} />;
  if (tool.name === "connect_applications_connectors") return <ConnectAppConnectorChip tool={tool} />;
  if (tool.name === "disconnect_application_connector") return <DisconnectAppConnectorChip tool={tool} />;
  if (tool.name === "get_application_connector_status") return <AppConnectorStatusChip tool={tool} />;
  if (tool.name === "create_checkpoint") return <CreateCheckpointChip tool={tool} />;
  if (tool.name === "list_checkpoints") return <ListCheckpointsChip tool={tool} />;
  if (tool.name === "delete_checkpoint") return <DeleteCheckpointChip tool={tool} />;
  if (tool.name === "restore_checkpoint") return <RestoreCheckpointChip tool={tool} />;
  if (tool.name === "list_available_channels") return <ListChannelsChip tool={tool} />;
  if (tool.name === "request_channel_connection_to_user") return <RequestChannelChip tool={tool} />;
  if (tool.name === "disconnect_channels") return <DisconnectChannelChip tool={tool} />;
  if (tool.name === "get_channel_status") return <ChannelStatusChip tool={tool} />;
  if (tool.name === "send_message_to_communication_channel") return <SendChannelMessageChip tool={tool} />;
  if (tool.name === "sliding_window_truncated") return <SlidingWindowChip tool={tool} />;
  if (isConnectorTool(tool.name)) return <ConnectorChip tool={tool} />;
  if (isMcpTool(tool.name)) return <McpChip tool={tool} />;
  return <GenericChip tool={tool} />;
}

/** MCP namespaced tools use `mcp_<server>_<tool>` names (never a built-in name). */
function isMcpTool(name: string): boolean {
  return /^mcp_[a-z0-9]+_.+$/i.test((name ?? "").trim());
}

/** Composio connector tools use SCREAMING_SNAKE_CASE slugs (never a built-in name). */
function isConnectorTool(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test((name ?? "").trim());
}

/** Connector display name derived from the `{TOOLKIT}_{ACTION}` slug prefix. */
function connectorNameOf(slug: string): string {
  const prefix = slug.split("_")[0] ?? "";
  const pretty = prefix.charAt(0) + prefix.slice(1).toLowerCase();
  return pretty || "App";
}

/* ------------------------------------------------------------------ sub-agent */

/** The expandable body of a single sub-agent run — shared by the single and batch chips. */
function SubAgentRunView({ run }: { run: SubAgentRun }) {
  const [showReasoning, setShowReasoning] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
          <Bot className="h-3.5 w-3.5 text-[var(--secondary)]" />
          {run.agent}
        </span>
        {run.background && <Pill>background</Pill>}
        {run.sentContext && <Pill>context shared</Pill>}
      </div>
      {run.background && run.outputFile && (
        <div>
          <Label>Output file</Label>
          <div className="mt-1 break-all font-mono text-[var(--muted)]">{run.outputFile}</div>
        </div>
      )}
      {run.task && (
        <div>
          <Label>Task</Label>
          <div className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{run.task}</div>
        </div>
      )}
      {run.reasoning.trim().length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", showReasoning && "rotate-180")} />
            Reasoning
          </button>
          {showReasoning && (
            <div className="whitespace-pre-wrap px-2 pb-2 text-[var(--muted)]">{run.reasoning}</div>
          )}
        </div>
      )}
      {run.tools.length > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          {run.tools.map((t) => (
            <ToolChip key={t.id} tool={t} />
          ))}
        </div>
      )}
      <div>
        <Label>Output</Label>
        {run.output ? (
          <div className={cn("mt-1 whitespace-pre-wrap break-words text-[var(--fg)]", run.status === "running" && "caret")}>
            {run.output}
          </div>
        ) : run.status === "running" ? (
          <div className="mt-1 flex items-center gap-2 text-[var(--muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
          </div>
        ) : (
          <div className="mt-1 text-[var(--muted)]">No output.</div>
        )}
      </div>
      {run.error && <div className="text-[var(--danger)]">⚠️ {run.error}</div>}
    </>
  );
}

/** A single sub-agent run rendered as its own expandable chip (the call_sub_agent block). */
function SubAgentRunChip({ run }: { run: SubAgentRun }) {
  const label = `Sub-Agent: ${run.agent || "sub-agent"}${run.background ? " · background" : ""}`;
  return (
    <Shell
      icon={<Bot className="h-3.5 w-3.5" />}
      label={label}
      status={run.status}
      expandable
      panel={() => <SubAgentRunView run={run} />}
    />
  );
}

function SubAgentChip({ tool, run }: { tool: ToolActivity; run: SubAgentRun }) {
  void tool;
  return <SubAgentRunChip run={run} />;
}

/** Aggregate status for the batch block: running if any child is still running, else error if any
 * child failed, else ok. */
function aggregateStatus(runs: SubAgentRun[]): ToolActivityStatus {
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "error")) return "error";
  return "ok";
}

/**
 * The call_multiple_sub_agents block. It reuses the single call_sub_agent block for each child,
 * nested inside one extra "batch" block that identifies this tool and groups every sub-agent.
 */
function MultiSubAgentChip({ tool }: { tool: ToolActivity }) {
  const order = tool.multiOrder ?? Object.keys(tool.multiRuns ?? {});
  const runs = order.map((id) => tool.multiRuns?.[id]).filter((r): r is SubAgentRun => Boolean(r));
  // Prefer the live aggregate of the child runs; fall back to the tool's own status before any
  // child has registered (e.g. a brand-new batch whose start event hasn't arrived yet).
  const status = runs.length > 0 ? aggregateStatus(runs) : tool.status;
  const done = runs.filter((r) => r.status !== "running").length;
  return (
    <Shell
      icon={<Bot className="h-3.5 w-3.5" />}
      label={tool.label || `Sub-Agents (${runs.length})`}
      status={status}
      expandable={runs.length > 0}
      pills={
        runs.length > 0 ? (
          <Pill>
            {done}/{runs.length} done
          </Pill>
        ) : undefined
      }
      panel={() => (
        <>
          <div className="text-[var(--muted)]">
            {runs.length} sub-agent(s) called in parallel. Each runs independently below.
          </div>
          <div className="flex flex-col items-stretch gap-1.5">
            {runs.map((run, i) => (
              <SubAgentRunChip key={order[i]} run={run} />
            ))}
          </div>
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ shell */

function ShellChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const command = data?.command ?? args.command ?? tool.label;
  const stdout = data?.stdout ?? error?.stdout ?? "";
  const stderr = data?.stderr ?? error?.stderr ?? "";
  const exitCode = data?.exit_code;
  const timedOut = data?.timed_out ?? error?.code === "shell_timeout";
  const timeout = error?.timeout_seconds ?? args.timeout ?? 60;
  return (
    <Shell
      icon={<Terminal className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || Boolean(args.command)}
      pills={
        <>
          <Pill>
            <Timer className="h-2.5 w-2.5" />
            {timeout}s
          </Pill>
        </>
      }
      panel={() => (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill>
              <Terminal className="h-2.5 w-2.5" />
              <span className="font-mono">{String(command)}</span>
            </Pill>
            {exitCode != null && <Pill tone={exitCode === 0 ? "default" : "danger"}>exit: {exitCode}</Pill>}
            {timedOut && <Pill tone="warn">timed out</Pill>}
            {(data?.truncated || error?.truncated) && <Pill tone="warn">truncated</Pill>}
          </div>
          {error?.message && <div className="text-[var(--danger)]">Command failed: {error.message}</div>}
          {stdout ? (
            <div>
              <Label>stdout</Label>
              <Pre className="mt-1">{stdout}</Pre>
            </div>
          ) : null}
          {stderr ? (
            <div>
              <Label>stderr</Label>
              <Pre className="mt-1 text-[var(--danger)]">{stderr}</Pre>
            </div>
          ) : null}
          {!stdout && !stderr && <div className="text-[var(--muted)]">No output.</div>}
        </>
      )}
    />
  );
}

function ShellViewChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const sessions: any[] = (data?.sessions as any[]) ?? (error?.sessions as any[]) ?? [];
  return (
    <Shell
      icon={<Eye className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={sessions.length > 0 ? <Pill>{sessions.length} session(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {sessions.map((s, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-mono text-[var(--fg)]">
                  <Eye className="h-3 w-3" />
                  {s.session_name}
                </span>
                {s.status && <Pill>{s.status}</Pill>}
                {s.pid != null && <Pill>pid: {s.pid}</Pill>}
                {s.exit_code != null && <Pill tone={s.exit_code === 0 ? "default" : "danger"}>exit: {s.exit_code}</Pill>}
              </div>
              <Pre className="mt-1.5">{s.output || "(no output yet)"}</Pre>
            </div>
          ))}
          {sessions.length === 0 && !error && <div className="text-[var(--muted)]">No sessions.</div>}
        </>
      )}
    />
  );
}

function BashWriteChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  return (
    <Shell
      icon={<CornerDownLeft className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Write failed: {error.message}</div>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.session_name && <Pill>{data.session_name}</Pill>}
                <Pill tone={data.press_enter ? "default" : "off"}>press_enter: {String(Boolean(data.press_enter))}</Pill>
                {data.bytes_written != null && <Pill>{data.bytes_written} bytes</Pill>}
              </div>
              {data.written != null && (
                <div>
                  <Label>Written to stdin</Label>
                  <Pre className="mt-1">{String(data.written)}</Pre>
                </div>
              )}
            </>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ files */

function FileReadChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  return (
    <Shell
      icon={<FileText className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Read failed: {error.message}</div>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>
                  <span className="font-mono">{data.file_path ?? tool.filePath}</span>
                </Pill>
                <Pill tone={args.offset != null ? "default" : "off"}>offset: {args.offset ?? "—"}</Pill>
                <Pill tone={args.limit != null ? "default" : "off"}>limit: {args.limit ?? "—"}</Pill>
                {data.truncated && <Pill tone="warn">truncated</Pill>}
              </div>
              <Pre>{data.content || "(empty file)"}</Pre>
              {data.line_count != null && (
                <div className="text-[var(--muted)]">
                  {data.line_count} of {data.total_lines} lines · lines {data.first_line}–{data.last_line}
                </div>
              )}
            </>
          )}
        </>
      )}
    />
  );
}

function GrepChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const matches: Array<{ path?: string; line_number?: number; content?: string }> =
    (data?.matches as Array<{ path?: string; line_number?: number; content?: string }>) ?? [];
  return (
    <Shell
      icon={<Search className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={matches.length > 0 ? <Pill>{matches.length} match(es)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Search failed: {error.message}</div>}
          {data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill>
                <span className="font-mono">/{String(data.pattern ?? args.pattern ?? "")}</span>
              </Pill>
              {typeof data.path === "string" && data.path && <Pill>{data.path}</Pill>}
              {typeof data.include === "string" && data.include && <Pill>{data.include}</Pill>}
              {data.truncated && <Pill tone="warn">capped at 50</Pill>}
            </div>
          )}
          {matches.length === 0 && !error && (
            <div className="text-[var(--muted)]">No matches found.</div>
          )}
          {matches.map((m, i) => (
            <div key={i} className="flex items-start gap-1.5 font-mono text-[11px]">
              <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
                <FileText className="h-2.5 w-2.5" />
                {m.path}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
                <Hash className="h-2.5 w-2.5" />
                {m.line_number}
              </span>
              {m.content != null && (
                <span className="whitespace-pre-wrap break-all text-[var(--fg)]">{m.content}</span>
              )}
            </div>
          ))}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

function AstGrepChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const matches: Array<{
    path?: string;
    line_number?: number;
    content?: string;
    language?: string;
    captures?: Record<string, string>;
  }> = (data?.matches as Array<{
    path?: string;
    line_number?: number;
    content?: string;
    language?: string;
    captures?: Record<string, string>;
  }>) ?? [];
  return (
    <Shell
      icon={<Braces className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={matches.length > 0 ? <Pill>{matches.length} match(es)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">AST search failed: {error.message}</div>}
          {data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill>
                <span className="font-mono">{String(data.pattern ?? args.pattern ?? "")}</span>
              </Pill>
              {typeof data.path === "string" && data.path && <Pill>{data.path}</Pill>}
              {typeof data.include === "string" && data.include && <Pill>{data.include}</Pill>}
              {typeof data.language === "string" && data.language && (
                <Pill tone="accent">{data.language}</Pill>
              )}
              {data.truncated && <Pill tone="warn">capped at 50</Pill>}
            </div>
          )}
          {matches.length === 0 && !error && (
            <div className="text-[var(--muted)]">No structural matches found.</div>
          )}
          {matches.map((m, i) => {
            const captures = m.captures && typeof m.captures === "object" ? Object.entries(m.captures) : [];
            return (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-[var(--muted)]">
                    <FileText className="h-2.5 w-2.5" />
                    {m.path}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-[var(--muted)]">
                    <Hash className="h-2.5 w-2.5" />
                    {m.line_number}
                  </span>
                  {m.language && <Pill tone="accent">{m.language}</Pill>}
                </div>
                {m.content != null && (
                  <Pre className="mt-1.5">{m.content}</Pre>
                )}
                {captures.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {captures.map(([name, value]) => (
                      <Pill key={name}>
                        <span className="font-mono">
                          ${name} = {String(value).slice(0, 80)}
                          {String(value).length > 80 ? "…" : ""}
                        </span>
                      </Pill>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

function GlobChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const matches: string[] = Array.isArray(data?.matches) ? (data.matches as string[]) : [];
  return (
    <Shell
      icon={<FolderTree className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={matches.length > 0 ? <Pill>{matches.length} match(es)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Glob failed: {error.message}</div>}
          {data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill>
                <span className="font-mono">/{String(data.pattern ?? args.pattern ?? "")}</span>
              </Pill>
              {typeof data.path === "string" && data.path && <Pill>{data.path}</Pill>}
              {data.truncated && <Pill tone="warn">capped at 100</Pill>}
            </div>
          )}
          {matches.length === 0 && !error && (
            <div className="text-[var(--muted)]">No files matched.</div>
          )}
          {matches.map((m, i) => (
            <div key={i} className="flex items-start gap-1.5 font-mono text-[11px]">
              <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
                <FileText className="h-2.5 w-2.5" />
              </span>
              <span className="whitespace-pre-wrap break-all text-[var(--fg)]">{m}</span>
            </div>
          ))}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ lsp */

const LSP_OPERATION_LABELS: Record<string, string> = {
  goToDefinition: "Go to definition",
  findReferences: "Find references",
  hover: "Hover",
  documentSymbol: "Document symbols",
  workspaceSymbol: "Workspace symbols",
  goToImplementation: "Go to implementation",
  prepareCallHierarchy: "Call hierarchy",
  incomingCalls: "Incoming calls",
  outgoingCalls: "Outgoing calls",
};

function LspLocationRow({ location }: { location: any }) {
  return (
    <div className="flex items-start gap-1.5 font-mono text-[11px]">
      <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
        <FileText className="h-2.5 w-2.5" />
        {location.path}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
        <Hash className="h-2.5 w-2.5" />
        {location.line}:{location.character}
      </span>
      {location.preview != null && (
        <span className="whitespace-pre-wrap break-all text-[var(--fg)]">{location.preview}</span>
      )}
    </div>
  );
}

function LspSymbolRow({ symbol }: { symbol: any }) {
  return (
    <div
      className="flex items-start gap-1.5 font-mono text-[11px]"
      style={{ paddingLeft: `${(symbol.depth ?? 0) * 12}px` }}
    >
      <Pill tone="accent">{symbol.kind}</Pill>
      <span className="font-medium text-[var(--fg)]">{symbol.name}</span>
      {symbol.detail && <span className="text-[var(--muted)]">— {symbol.detail}</span>}
      {symbol.path && (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
          <FileText className="h-2.5 w-2.5" />
          {symbol.path}:{symbol.line}:{symbol.character}
        </span>
      )}
    </div>
  );
}

function LspHierarchyRow({ item }: { item: any }) {
  return (
    <div className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-1.5 font-mono text-[11px]">
      <Pill tone="accent">{item.kind}</Pill>
      <span className="font-medium text-[var(--fg)]">{item.name}</span>
      {item.detail && <span className="text-[var(--muted)]">— {item.detail}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
        <FileText className="h-2.5 w-2.5" />
        {item.path}:{item.line}:{item.character}
      </span>
    </div>
  );
}

function LspCallRow({ call }: { call: any }) {
  return (
    <div className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-1.5 font-mono text-[11px]">
      <Pill tone={call.direction === "incoming" ? "accent" : "default"}>{call.direction}</Pill>
      <Pill>{call.kind}</Pill>
      <span className="font-medium text-[var(--fg)]">{call.name}</span>
      {call.detail && <span className="text-[var(--muted)]">— {call.detail}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
        <FileText className="h-2.5 w-2.5" />
        {call.path}:{call.line}:{call.character}
      </span>
    </div>
  );
}

function LspChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const operation: string = data?.operation ?? args.operation ?? "lsp";
  const filePath: string = data?.file_path ?? args.filePath ?? tool.filePath ?? "";
  const line = data?.line ?? args.line;
  const character = data?.character ?? args.character;
  const server = (data?.server ?? {}) as { id?: string; name?: string; command?: string };
  const languageId = typeof data?.language_id === "string" ? data.language_id : "";
  const query = typeof data?.query === "string" ? data.query : "";
  const locations: any[] = Array.isArray(data?.locations) ? data.locations : [];
  const symbols: any[] = Array.isArray(data?.symbols) ? data.symbols : [];
  const hierarchy: any[] = Array.isArray(data?.hierarchy) ? data.hierarchy : [];
  const calls: any[] = Array.isArray(data?.calls) ? data.calls : [];
  const contents = typeof data?.contents === "string" ? data.contents : "";
  const count =
    typeof data?.count === "number"
      ? data.count
      : locations.length + symbols.length + hierarchy.length + calls.length;
  const position = line != null && character != null ? `${line}:${character}` : "";

  return (
    <Shell
      icon={<Braces className="h-3.5 w-3.5" />}
      label={tool.label || `LSP ${operation}`}
      status={tool.status}
      expandable={hasResult || Boolean(args.operation)}
      pills={
        <>
          <Pill tone="accent">{LSP_OPERATION_LABELS[operation] ?? operation}</Pill>
          {count > 0 && <Pill>{count} result(s)</Pill>}
          {data?.truncated && <Pill tone="warn">truncated</Pill>}
        </>
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">LSP failed: {error.message}</div>}
          <div className="flex flex-wrap items-center gap-1.5">
            {filePath && (
              <Pill>
                <FileText className="h-2.5 w-2.5" />
                <span className="font-mono">{filePath}</span>
              </Pill>
            )}
            {position && <Pill>line {position}</Pill>}
            {query && (
              <Pill>
                query: <span className="font-mono">{query}</span>
              </Pill>
            )}
            {server.name && <Pill tone="accent">{server.name}</Pill>}
            {languageId && <Pill tone="off">{languageId}</Pill>}
          </div>
          {contents && (
            <div>
              <Label>Hover</Label>
              <Pre className="mt-1">{contents}</Pre>
            </div>
          )}
          {locations.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Locations</Label>
              {locations.map((loc, i) => (
                <LspLocationRow key={i} location={loc} />
              ))}
            </div>
          )}
          {symbols.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Symbols</Label>
              {symbols.map((symbol, i) => (
                <LspSymbolRow key={i} symbol={symbol} />
              ))}
            </div>
          )}
          {hierarchy.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Call hierarchy</Label>
              {hierarchy.map((item, i) => (
                <LspHierarchyRow key={i} item={item} />
              ))}
            </div>
          )}
          {calls.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Calls</Label>
              {calls.map((call, i) => (
                <LspCallRow key={i} call={call} />
              ))}
            </div>
          )}
          {!error &&
            !contents &&
            locations.length === 0 &&
            symbols.length === 0 &&
            hierarchy.length === 0 &&
            calls.length === 0 && (
              <div className="text-[var(--muted)]">
                {hasResult ? "No results." : "Querying the language server..."}
              </div>
            )}
        </>
      )}
    />
  );
}

function StrReplaceChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  return (
    <Shell
      icon={<Pencil className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || args.old_string !== undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Edit failed: {error.message}</div>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill>
              <FileText className="h-2.5 w-2.5" />
              <span className="font-mono">{data?.file_path ?? tool.filePath}</span>
            </Pill>
            <Pill tone={args.replace_all ? "accent" : "off"}>replace_all: {String(Boolean(args.replace_all))}</Pill>
            {data?.replaced != null && <Pill>replaced: {data.replaced}</Pill>}
          </div>
          <div>
            <Label>Old string</Label>
            <Pre className="mt-1">{args.old_string || "(empty)"}</Pre>
          </div>
          <div>
            <Label>New string</Label>
            <Pre className="mt-1">{args.new_string || "(empty)"}</Pre>
          </div>
        </>
      )}
    />
  );
}

function ApplyEditsChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const edits: any[] = Array.isArray(args.edits) ? args.edits : [];
  return (
    <Shell
      icon={<PencilLine className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || edits.length > 0}
      pills={edits.length > 0 ? <Pill>{edits.length} edit(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Edit failed: {error.message}</div>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill>
              <span className="font-mono">{data?.file_path ?? tool.filePath}</span>
            </Pill>
            {data?.edits_applied != null && <Pill>applied: {data.edits_applied}</Pill>}
          </div>
          {edits.map((e, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <Label>Edit #{i + 1}</Label>
              <Pre className="mt-1">{e.old_text || "(empty)"}</Pre>
              <Pre className="mt-1">{e.new_text || "(empty — deletes matched text)"}</Pre>
            </div>
          ))}
        </>
      )}
    />
  );
}

/** Colorised view of a raw apply_patch envelope: +add lines green, -remove lines red, headers bold. */
function PatchDiff({ input }: { input: string }) {
  const lines = String(input ?? "").split("\n");
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--chip)] p-2 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => {
        const isHeader = line.startsWith("*** ") || line.startsWith("@@");
        const isAdd = !isHeader && line.startsWith("+");
        const isDel = !isHeader && line.startsWith("-");
        return (
          <div
            key={i}
            className={cn(
              isHeader && "font-semibold text-[var(--secondary)]",
              isAdd && "bg-[var(--success-soft)] text-[var(--success)]",
              isDel && "bg-[var(--danger-soft)] text-[var(--danger)]",
              !isHeader && !isAdd && !isDel && "text-[var(--fg)]",
            )}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

const PATCH_OP_META: Record<string, { label: string; tone: "accent" | "default" | "danger" }> = {
  add: { label: "add", tone: "accent" },
  update: { label: "update", tone: "default" },
  delete: { label: "delete", tone: "danger" },
};

/** apply_patch — shows the raw structured patch (colorised) plus the per-file operations applied. */
function ApplyPatchChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const input: string = (args.input as string) ?? "";
  const operations: any[] = (data?.operations as any[]) ?? [];
  return (
    <Shell
      icon={<FileDiff className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || input.length > 0}
      pills={
        data?.files_changed != null ? (
          <Pill>{data.files_changed} file(s)</Pill>
        ) : input.length > 0 ? (
          <Pill tone="accent">patch</Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && (
            <div className="text-[var(--danger)]">
              Patch failed: {error.message}
              {error.line != null && <span className="ml-1 opacity-70">(line {error.line})</span>}
            </div>
          )}
          {operations.length > 0 && (
            <div className="flex flex-col gap-1">
              {operations.map((op, i) => {
                const meta = PATCH_OP_META[op.type] ?? { label: op.type, tone: "default" as const };
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-1.5">
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                    <span className="font-mono text-[var(--fg)]">{op.file_path}</span>
                    {op.moved_to && (
                      <span className="flex items-center gap-1 text-[var(--muted)]">
                        <CornerDownLeft className="h-2.5 w-2.5" />
                        <span className="font-mono">{op.moved_to}</span>
                      </span>
                    )}
                    {op.lines_added != null && op.lines_added > 0 && <Pill tone="accent">+{op.lines_added}</Pill>}
                    {op.lines_removed != null && op.lines_removed > 0 && <Pill tone="danger">-{op.lines_removed}</Pill>}
                  </div>
                );
              })}
            </div>
          )}
          {data?.summary && <div className="text-[var(--muted)]">{String(data.summary)}</div>}
          {input.length > 0 && (
            <div>
              <Label>Patch</Label>
              <div className="mt-1">
                <PatchDiff input={input} />
              </div>
            </div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ images */

function ReadImageChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const filePath: string = data?.file_path ?? "";
  const isUrl = data?.source === "url" || /^https?:\/\//i.test(filePath);
  return (
    <Shell
      icon={<ImageIcon className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Read failed: {error.message}</div>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>
                  {isUrl ? <Link2 className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                  <span className="font-mono">{filePath}</span>
                </Pill>
                <Pill>source: {isUrl ? "URL" : "workspace"}</Pill>
                {data.content_type && <Pill>{data.content_type}</Pill>}
                {data.size_bytes != null && <Pill>{formatBytes(data.size_bytes)}</Pill>}
              </div>
              {isUrl && (
                <img src={filePath} alt="Read image" className="max-h-64 rounded-[var(--radius-sm)] border border-[var(--border)]" referrerPolicy="no-referrer" />
              )}
              <div className="text-[var(--muted)]">The image was attached to the model's vision input for analysis.</div>
            </>
          )}
        </>
      )}
    />
  );
}

function ScanQrCodeChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const imagePath: string = (data?.image_path as string) ?? (args.image_path as string) ?? "";
  const content: string = (data?.content as string) ?? "";
  return (
    <Shell
      icon={<QrCode className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={
        data?.content ? (
          <Pill tone="accent">decoded</Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Scan failed: {error.message}</div>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>
                  <QrCode className="h-2.5 w-2.5" />
                  <span className="font-mono">{imagePath}</span>
                </Pill>
                {data.format && <Pill>{String(data.format)}</Pill>}
                {data.width != null && data.height != null && (
                  <Pill>
                    {String(data.width)}×{String(data.height)}
                  </Pill>
                )}
              </div>
              {content ? (
                <div>
                  <Label>Decoded QR content</Label>
                  <Pre className="mt-1">{content}</Pre>
                </div>
              ) : (
                !error && <div className="text-[var(--muted)]">No QR content decoded.</div>
              )}
            </>
          )}
        </>
      )}
    />
  );
}

function ImageSearchChip({ tool }: { tool: ToolActivity }) {
  const { data, hasResult } = parts(tool);
  const results: any[] = (data?.results as any[]) ?? [];
  return (
    <Shell
      icon={<ImageIcon className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={results.length > 0 ? <Pill>{results.length} image(s)</Pill> : undefined}
      panel={() => (
        <>
          <div className="text-[var(--muted)]">
            {results.length} image(s) · {PROVIDER_LABELS[data?.provider] ?? data?.provider} · "{data?.query}"
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {results.map((r, i) => (
              <a
                key={i}
                href={r.source_url ?? r.image_url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]"
              >
                <img
                  src={r.image_url}
                  alt={r.title ?? "Image result"}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-square w-full object-cover"
                  onError={(e) => (e.currentTarget.style.opacity = "0.2")}
                />
                <div className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-[var(--muted)]">
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{r.title || "Image result"}</span>
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ speech */

function GenerateSpeechChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const speech: string = (data?.speech as string) ?? (args.speech as string) ?? "";
  const outputDirectory: string =
    (data?.output_directory as string) ?? (args.output_directory as string) ?? "";
  const filePath: string = (data?.file_path as string) ?? "";
  const autoPlaySetting = useStore((s) => s.settings.autoPlayGeneratedSpeech);
  const autoPlay = autoPlaySetting !== "no";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef(false);

  const src = filePath
    ? routeUrl(API_ROUTES.filesPreview, { query: { path: filePath } })
    : "";

  // A new result (new file) is a fresh playback candidate.
  useEffect(() => {
    playedRef.current = false;
  }, [src]);

  // Auto-play once the generated audio has been saved and loaded, unless the user disabled it.
  useEffect(() => {
    if (!autoPlay || !src || playedRef.current) return;
    const el = audioRef.current;
    if (!el) return;
    playedRef.current = true;
    const attempt = el.play();
    // Browsers may block autoplay without prior interaction; the manual controls remain.
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => undefined);
  }, [autoPlay, src]);

  return (
    <Shell
      icon={<AudioLines className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable
      defaultOpen
      pills={data?.provider ? <Pill tone="accent">{String(data.provider)}</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && (
            <div className="text-[var(--danger)]">Speech generation failed: {error.message}</div>
          )}
          {speech && (
            <div>
              <Label>Speech</Label>
              <Pre className="mt-1 max-h-40">{speech}</Pre>
            </div>
          )}
          {src && !error && (
            <div className="space-y-2">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio ref={audioRef} controls preload="auto" src={src} className="w-full" />
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>
                  <AudioLines className="h-2.5 w-2.5" />
                  <span className="font-mono">{filePath}</span>
                </Pill>
                {data?.format && <Pill>{String(data.format)}</Pill>}
                {data?.bytes != null && <Pill>{formatBytes(Number(data.bytes))}</Pill>}
                {data?.voice && <Pill>voice: {String(data.voice)}</Pill>}
                {data?.model && <Pill>{String(data.model)}</Pill>}
              </div>
              <div className="flex justify-end">
                <a
                  href={routeUrl(API_ROUTES.filesDownload, { query: { path: filePath } })}
                  download={data?.filename ? String(data.filename) : undefined}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] transition hover:border-[var(--secondary)] hover:text-[var(--fg)]"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            </div>
          )}
          {!src && !error && !hasResult && <div className="text-[var(--muted)]">Generating speech...</div>}
          {!src && !error && hasResult && outputDirectory && (
            <div className="text-[var(--muted)]">Saved to {outputDirectory}.</div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ web */

function WebSearchChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const results: any[] = (data?.results as any[]) ?? [];
  return (
    <Shell
      icon={<Globe className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={results.length > 0 ? <Pill>{results.length} result(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Search failed: {error.message}</div>}
          {results.length === 0 && !error && <div className="text-[var(--muted)]">No results found.</div>}
          {results.length > 0 && (
            <div className="text-[var(--muted)]">
              {results.length} result(s) · {PROVIDER_LABELS[data?.provider] ?? data?.provider} · "{data?.query}"
            </div>
          )}
          {results.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noreferrer" className="block rounded-[var(--radius-sm)] border border-[var(--border)] p-2 hover:bg-[var(--chip)]">
              <div className="flex items-center gap-1 font-medium text-[var(--secondary)]">
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{r.title || r.url}</span>
              </div>
              <div className="truncate text-[10px] text-[var(--subtle)]">{r.url}</div>
              {(r.Description || r.description) && (
                <div className="line-clamp-2 mt-0.5 text-[var(--muted)]">{r.Description || r.description}</div>
              )}
            </a>
          ))}
        </>
      )}
    />
  );
}

function FetchChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const isCrawl = Boolean(data && (data.mode === "crawl" || Array.isArray(data.pages)));
  const pages: any[] = (data?.pages as any[]) ?? [];
  return (
    <Shell
      icon={<Globe className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.provider ? <Pill>{PROVIDER_LABELS[data.provider] ?? data.provider}</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Fetch failed: {error.message}</div>}
          {isCrawl ? (
            pages.map((p, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3 w-3" />
                  <span className="truncate font-medium">{p.title || p.url}</span>
                  {p.status != null && <Pill>{p.status}</Pill>}
                </div>
                <a href={p.url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-[var(--secondary)]">
                  {p.url}
                </a>
                {p.content && <Pre className="mt-1">{p.content}</Pre>}
              </div>
            ))
          ) : (
            data && (
              <>
                {data.url && data.title && (
                  <a href={data.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-[var(--secondary)]">
                    <ExternalLink className="h-3 w-3" /> {data.title}
                  </a>
                )}
                {data.description && <div className="text-[var(--muted)]">{data.description}</div>}
                {data.content ? <Pre>{data.content}</Pre> : <div className="text-[var(--muted)]">No content returned.</div>}
              </>
            )
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ todos */

const TODO_STATUS: Record<string, string> = { pending: "off", in_progress: "accent", completed: "default" };

function TodoChip({ tool }: { tool: ToolActivity }) {
  const { data, args, hasResult } = parts(tool);
  const todos: any[] = (data?.todos as any[]) ?? (args.todos as any[]) ?? [];
  return (
    <Shell
      icon={tool.name === "read_todos" ? <ClipboardList className="h-3.5 w-3.5" /> : <ListTodo className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || todos.length > 0}
      defaultOpen
      pills={<Pill>{data?.count ?? todos.length} todo(s)</Pill>}
      panel={() =>
        todos.length === 0 ? (
          <div className="text-[var(--muted)]">Todo list is empty.</div>
        ) : (
          <ul className="space-y-1.5">
            {todos.map((t) => (
              <li key={t.id} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    t.status === "completed" ? "border-[var(--success)] bg-[var(--success)] text-white" : "border-[var(--border)]",
                  )}
                >
                  {t.status === "completed" && <Check className="h-2.5 w-2.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={cn("text-[var(--fg)]", t.status === "completed" && "text-[var(--muted)] line-through")}>{t.content}</span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <Pill tone={(TODO_STATUS[t.status] as any) ?? "default"}>{String(t.status).replace("_", " ")}</Pill>
                    <Pill>{t.priority}</Pill>
                    <Pill>#{t.id}</Pill>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

/* ------------------------------------------------------------------ search locator */

function SearchLocatorChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const results: any[] = (data?.results as any[]) ?? [];
  return (
    <Shell
      icon={<Search className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={results.length > 0 ? <Pill>{results.length} file(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill>"{data.query}"</Pill>
              <Pill>{data.match_count} line(s)</Pill>
            </div>
          )}
          {results.map((r, i) => {
            const matches: { line?: number; content?: string }[] = Array.isArray(r.matches)
              ? r.matches
              : ((r.lines as number[] | undefined) ?? []).map((ln) => ({ line: ln }));
            return (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
                <span className="flex items-center gap-1 font-mono text-[var(--fg)]">
                  <FileText className="h-3 w-3" />
                  {r.path}
                </span>
                <div className="mt-1 flex flex-col gap-1">
                  {matches.map((m, li) => (
                    <div key={li} className="flex items-start gap-1.5 font-mono text-[11px]">
                      <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]">
                        <Hash className="h-2.5 w-2.5" />
                        {m.line}
                      </span>
                      {m.content != null && (
                        <span className="whitespace-pre-wrap break-all text-[var(--fg)]">
                          {m.content}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ prompt library */

const PROMPT_LIBRARY_TOOLS = new Set([
  "save_prompt_in_prompt_library",
  "delete_prompt_from_prompt_library",
  "list_available_prompts_in_prompt_library",
]);

const PROMPT_LIBRARY_META: Record<string, { label: string; Icon: typeof List }> = {
  save_prompt_in_prompt_library: { label: "Save prompt", Icon: Save },
  delete_prompt_from_prompt_library: { label: "Delete prompt", Icon: Trash2 },
  list_available_prompts_in_prompt_library: { label: "List prompts", Icon: List },
};

/** Chip for the agent-driven prompt-library tools (save / delete / list). */
function PromptLibraryChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const meta = PROMPT_LIBRARY_META[tool.name] ?? { label: tool.label, Icon: Library };
  const prompts: any[] = Array.isArray(data?.prompts) ? (data!.prompts as any[]) : [];
  const saved: { id?: string; title?: string; description?: string } | undefined = data?.prompt;
  const promptText = typeof args.prompt === "string" ? args.prompt : "";
  const isList = tool.name === "list_available_prompts_in_prompt_library";
  const deletedId = typeof data?.prompt_id === "string" ? data.prompt_id : "";
  return (
    <Shell
      icon={<meta.Icon className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={isList && data?.count != null ? <Pill>{data.count} prompt(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && (
            <div className="text-[var(--danger)]">
              {error.message}
              {Array.isArray(error.available_prompts) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {error.available_prompts.map((p: { id?: string }, i: number) => (
                    <Pill key={i}>{p?.id ?? "unknown"}</Pill>
                  ))}
                </div>
              )}
            </div>
          )}
          {data && (
            <>
              <div className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <meta.Icon className="h-3 w-3" />
                {meta.label}
              </div>
              {isList ? (
                prompts.length === 0 ? (
                  <div className="text-[var(--muted)]">The prompt library is empty.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {prompts.map((p, i) => (
                      <li
                        key={p?.id ?? i}
                        className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2"
                      >
                        <div className="font-medium text-[var(--fg)]">{p?.title || "(untitled)"}</div>
                        {p?.description && <div className="text-[var(--muted)]">{p.description}</div>}
                        {p?.id && (
                          <div className="mt-1 flex">
                            <Pill>#{p.id}</Pill>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {saved?.title && <Pill>{saved.title}</Pill>}
                    {(saved?.id || deletedId) && <Pill>#{saved?.id ?? deletedId}</Pill>}
                    {typeof data.count === "number" && <Pill>{data.count} prompt(s)</Pill>}
                  </div>
                  {promptText && (
                    <div>
                      <Label>Prompt</Label>
                      <Pre>{promptText}</Pre>
                    </div>
                  )}
                  {typeof data.message === "string" && (
                    <div className="text-[var(--muted)]">{data.message}</div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ memory / knowledge */

const MEM_META: Record<string, { label: string; Icon: typeof List }> = {
  memory_list: { label: "List memory", Icon: List },
  memory_read: { label: "Read memory", Icon: FileText },
  memory_write: { label: "Write memory", Icon: FilePlus2 },
  memory_edit: { label: "Edit memory", Icon: FileEdit },
  memory_delete: { label: "Delete memory", Icon: Trash2 },
  knowledge_list: { label: "List knowledge", Icon: List },
  knowledge_read: { label: "Read knowledge", Icon: FileText },
  knowledge_create: { label: "Create knowledge", Icon: FilePlus2 },
  knowledge_edit: { label: "Edit knowledge", Icon: FileEdit },
  knowledge_delete: { label: "Delete knowledge", Icon: Trash2 },
};

function MemoryChip({ tool, kind }: { tool: ToolActivity; kind: "memory" | "knowledge" }) {
  const { data, error, args, hasResult } = parts(tool);
  const meta = MEM_META[tool.name] ?? { label: tool.label, Icon: kind === "memory" ? Brain : Library };
  const root = kind === "memory" ? "memory/" : "knowledge/";
  const path = (data?.path ?? args.path ?? args.knowledge_path ?? "").replace(new RegExp(`^${root}`, "i"), "");
  const files: any[] = (data?.files as any[]) ?? [];
  const isList = tool.name.endsWith("_list");
  return (
    <Shell
      icon={kind === "memory" ? <Brain className="h-3.5 w-3.5" /> : <Library className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={isList && data?.count != null ? <Pill>{data.count} file(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && (
            <div className="text-[var(--danger)]">
              {error.message}
              {Array.isArray(error.available_paths) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {error.available_paths.map((p: string, i: number) => (
                    <Pill key={i}>{p}</Pill>
                  ))}
                </div>
              )}
            </div>
          )}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                  <meta.Icon className="h-3 w-3" />
                  {meta.label}
                </span>
                {path && <Pill><span className="font-mono">{root}{path}</span></Pill>}
                {data.preadded && <Pill tone="accent">core</Pill>}
                {data.chars != null && (
                  <Pill>
                    {data.chars}
                    {data.char_limit != null ? `/${data.char_limit}` : ""} chars
                  </Pill>
                )}
              </div>
              {isList && (
                <>
                  {data.tree && <Pre>{data.tree}</Pre>}
                  <ul className="space-y-1">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3 text-[var(--muted)]" />
                        <span className="font-mono">{f.path}</span>
                        {f.preadded && <Pill tone="accent">core</Pill>}
                        <Pill>{f.chars} chars</Pill>
                      </li>
                    ))}
                  </ul>
                  {files.length === 0 && !data.tree && <div className="text-[var(--muted)]">No files.</div>}
                </>
              )}
              {tool.name.endsWith("_read") && <Pre>{data.content || "(empty file)"}</Pre>}
              {(tool.name.endsWith("_write") || tool.name.endsWith("_create")) && args.content != null && (
                <div>
                  <Label>Saved content</Label>
                  <Pre className="mt-1">{String(args.content)}</Pre>
                </div>
              )}
              {tool.name.endsWith("_edit") && (
                <>
                  <div>
                    <Label>Old string</Label>
                    <Pre className="mt-1">{args.old_str || "(empty)"}</Pre>
                  </div>
                  <div>
                    <Label>New string</Label>
                    <Pre className="mt-1">{args.new_str || "(empty — deletes matched text)"}</Pre>
                  </div>
                </>
              )}
              {data.message && <div className="text-[var(--muted)]">{data.message}</div>}
            </>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ embed / attach */

function EmbedUrlChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const url: string = data?.url ?? args.url ?? "";
  const setPreview = useStore((s) => s.setPreview);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  return (
    <Shell
      icon={<Link2 className="h-3.5 w-3.5" />}
      label={url || tool.label}
      status={tool.status}
      expandable={hasResult || Boolean(url)}
      pills={<Pill tone="accent">preview</Pill>}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">Embed failed: {error.message}</div>}
          {url && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setPreview(url);
                  setPreviewOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--secondary)] px-3 py-1.5 text-[var(--secondary-fg)]"
              >
                <Eye className="h-3.5 w-3.5" /> Open browser preview
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[var(--fg)] hover:bg-[var(--chip)]"
              >
                <ExternalLink className="h-3.5 w-3.5" /> New tab
              </a>
            </div>
          )}
        </>
      )}
    />
  );
}

function AttachFilesChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const files: AttachedFile[] = (data?.files as AttachedFile[]) ?? [];
  const errors: any[] = (data?.errors as any[]) ?? (error?.errors as any[]) ?? [];
  const setPreview = useStore((s) => s.setPreview);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  return (
    <Shell
      icon={<Paperclip className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={<Pill>{data?.file_count ?? files.length} file(s)</Pill>}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[var(--fg)]">{f.name}</div>
                <div className="truncate text-[10px] text-[var(--subtle)]">
                  {f.path} · {f.size_label ?? formatBytes(f.size)}
                </div>
              </div>
              <button
                onClick={() => {
                  setPreview(routeUrl(API_ROUTES.filesPreview, { query: { path: f.path } }));
                  setPreviewOpen(true);
                }}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] hover:bg-[var(--chip)]"
              >
                <Eye className="inline h-3 w-3" /> Preview
              </button>
              <a
                href={routeUrl(API_ROUTES.filesDownload, { query: { path: f.path } })}
                download={f.name}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] hover:bg-[var(--chip)]"
              >
                <Download className="inline h-3 w-3" />
              </a>
            </div>
          ))}
          {errors.length > 0 && (
            <div className="space-y-1">
              {errors.map((e, i) => (
                <div key={i} className="text-[var(--danger)]">
                  {e.path} — {e.error}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ lists / creates */

function ListSubAgentsChip({ tool }: { tool: ToolActivity }) {
  const { data, hasResult } = parts(tool);
  const agents: any[] = (data?.available_sub_agents as any[]) ?? [];
  return (
    <Shell
      icon={<ListTree className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={agents.length > 0 ? <Pill>{agents.length}</Pill> : undefined}
      panel={() =>
        agents.length === 0 ? (
          <div className="text-[var(--muted)]">No sub-agents available.</div>
        ) : (
          agents.map((a, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <div className="flex items-center gap-1.5 font-medium text-[var(--secondary)]">
                <Bot className="h-3 w-3" />
                {a.name}
              </div>
              <div className="text-[var(--muted)]">{a.description}</div>
            </div>
          ))
        )
      }
    />
  );
}

function ListSkillsChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const skills: any[] = (data?.skills as any[]) ?? [];
  return (
    <Shell
      icon={<Blocks className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={skills.length > 0 ? <Pill>{skills.length}</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">List skills failed: {error.message}</div>}
          {skills.map((sk, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <div className="flex items-center gap-1.5 font-mono font-medium text-[var(--secondary)]">
                <Blocks className="h-3 w-3" />
                {sk.name}
              </div>
              <div className="text-[var(--muted)]">{sk.description}</div>
              {sk.tree && <Pre className="mt-1">{sk.tree}</Pre>}
            </div>
          ))}
        </>
      )}
    />
  );
}

function SkillInitChip({ tool }: { tool: ToolActivity }) {
  const { data, hasResult } = parts(tool);
  const initialized: any[] = (data?.initialized as any[]) ?? [];
  const failed: any[] = (data?.failed as any[]) ?? [];
  return (
    <Shell
      icon={<PackagePlus className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={
        <>
          {initialized.length > 0 && <Pill>{initialized.length} ok</Pill>}
          {failed.length > 0 && <Pill tone="danger">{failed.length} failed</Pill>}
        </>
      }
      panel={() => (
        <>
          {initialized.map((s, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <div className="flex items-center gap-1.5 text-[var(--success)]">
                <FolderTree className="h-3 w-3" />
                {s.skill_name}
              </div>
              <div className="font-mono text-[10px] text-[var(--muted)]">{s.path}</div>
            </div>
          ))}
          {failed.map((f, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] p-2 text-[var(--danger)]">
              {f.skill_name} — {f.error}
            </div>
          ))}
          {initialized.length === 0 && failed.length === 0 && <div className="text-[var(--muted)]">No skills initialized.</div>}
        </>
      )}
    />
  );
}

function CreateSubAgentChip({ tool }: { tool: ToolActivity }) {
  const { data, hasResult } = parts(tool);
  const created = data?.created_sub_agent as any;
  return (
    <Shell
      icon={<UserPlus className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={created ? <Pill tone="accent">saved</Pill> : undefined}
      panel={() =>
        created ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <UserPlus className="h-3 w-3" />
                {created.name}
              </span>
              <Pill>{(created.tools ?? []).length} tool(s)</Pill>
            </div>
            <div className="text-[var(--muted)]">{created.description}</div>
            <div>
              <Label>System prompt</Label>
              <Pre className="mt-1">{created.system_prompt}</Pre>
            </div>
            <div className="flex flex-wrap gap-1">
              {(created.tools ?? []).map((t: string, i: number) => (
                <Pill key={i}>
                  <Wrench className="h-2.5 w-2.5" />
                  {t}
                </Pill>
              ))}
            </div>
          </>
        ) : (
          <div className="text-[var(--muted)]">No data.</div>
        )
      }
    />
  );
}

function DeleteSubAgentChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.deleted_sub_agent as string) ?? (args.name as string) ?? "";
  return (
    <Shell
      icon={<UserMinus className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.deleted_sub_agent ? <Pill tone="danger">deleted</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data?.deleted_sub_agent && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                  <UserMinus className="h-3 w-3" />
                  {name}
                </span>
              </div>
              {data.message && <div className="text-[var(--muted)]">{String(data.message)}</div>}
            </>
          )}
          {!data && !error && <div className="text-[var(--muted)]">No data.</div>}
        </>
      )}
    />
  );
}

function WaitChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const seconds = (data?.waited_seconds as number) ?? (args.seconds as number) ?? 0;
  return (
    <Shell
      icon={<Timer className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={<Pill><Timer className="h-2.5 w-2.5" />{seconds}s</Pill>}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data ? (
            <div className="text-[var(--muted)]">
              {data.message ? String(data.message) : `Waited ${seconds} second(s).`}
            </div>
          ) : (
            !error && <div className="text-[var(--muted)]">Waiting {seconds} second(s)…</div>
          )}
        </>
      )}
    />
  );
}

function CreateSkillChip({ tool }: { tool: ToolActivity }) {
  const { data, hasResult } = parts(tool);
  const created = data?.created_skill as any;
  const files: any[] = created?.files ?? [];
  return (
    <Shell
      icon={<Wand2 className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={created ? <Pill tone="accent">saved</Pill> : undefined}
      panel={() =>
        created ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <Wand2 className="h-3 w-3" />
                {created.name}
              </span>
              <Pill>{data?.file_count ?? files.length} file(s)</Pill>
              <Pill tone="accent">{created.skill_file || "SKILL.md"}</Pill>
            </div>
            <div className="text-[var(--muted)]">{created.description}</div>
            <div className="flex flex-wrap gap-1">
              {files.map((f: any, i: number) => (
                <Pill key={i}>
                  <FileText className="h-2.5 w-2.5" />
                  {f.path}
                </Pill>
              ))}
            </div>
          </>
        ) : (
          <div className="text-[var(--muted)]">No data.</div>
        )
      }
    />
  );
}

/* ---------------------------------------------------- sub-agent sessions / delete skill */

/** delete_skill — mirrors the delete_sub_agent chip. */
function DeleteSkillChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.deleted_skill as string) ?? (args.skill_name as string) ?? "";
  return (
    <Shell
      icon={<Trash2 className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.deleted_skill ? <Pill tone="danger">deleted</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data?.deleted_skill && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                  <Blocks className="h-3 w-3" />
                  {name}
                </span>
              </div>
              {data.message && <div className="text-[var(--muted)]">{String(data.message)}</div>}
            </>
          )}
          {!data && !error && <div className="text-[var(--muted)]">No data.</div>}
        </>
      )}
    />
  );
}

/** list_sub_agent_sessions — the list of every sub-agent session created this chat, in a dropdown. */
function ListSubAgentSessionsChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const sessions: any[] = (data?.sessions as any[]) ?? [];
  return (
    <Shell
      icon={<History className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={sessions.length > 0 ? <Pill>{sessions.length}</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {sessions.length === 0 && !error && (
            <div className="text-[var(--muted)]">No sub-agent sessions yet.</div>
          )}
          {sessions.map((s, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-2"
            >
              <span className="flex items-center gap-1 font-medium text-[var(--secondary)]">
                <Bot className="h-3 w-3" />
                {s.agent || "sub-agent"}
              </span>
              <Pill>
                <Hash className="h-2.5 w-2.5" />
                <span className="font-mono">{s.session_id}</span>
              </Pill>
              {s.status && <Pill tone={s.status === "completed" ? "default" : s.status === "running" ? "accent" : "danger"}>{s.status}</Pill>}
            </div>
          ))}
        </>
      )}
    />
  );
}

/**
 * reuse_same_sub_agent_session — a dropdown that reveals the reused sub-agent's live streaming run
 * (its output, reasoning, and nested tool calls), exactly like the call_sub_agent block.
 */
function ReuseSessionChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const run = tool.subAgent;
  const sessionId: string = (data?.session_id as string) ?? (args.session_id as string) ?? "";
  const status = run ? run.status : tool.status;
  return (
    <Shell
      icon={<Repeat2 className="h-3.5 w-3.5" />}
      label={tool.label || `Reuse Sub-Agent Session: ${sessionId}`}
      status={status}
      expandable={Boolean(run) || hasResult}
      pills={
        sessionId ? (
          <Pill>
            <Hash className="h-2.5 w-2.5" />
            <span className="font-mono">{sessionId}</span>
          </Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {run ? (
            <SubAgentRunView run={run} />
          ) : data ? (
            <div className="text-[var(--muted)]">{String(data.message ?? "Session reused.")}</div>
          ) : (
            !error && <div className="text-[var(--muted)]">Continuing the sub-agent session…</div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ fallback */

/** A connected-app (Composio) tool call — args in, structured app data out. */
function ConnectorChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const entries = Object.entries(args ?? {});
  return (
    <Shell
      icon={<Plug className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || entries.length > 0}
      pills={<Pill tone="accent">{connectorNameOf(tool.name)}</Pill>}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {entries.length > 0 && (
            <div>
              <Label>Arguments</Label>
              <div className="mt-1 space-y-1">
                {entries.map(([key, value]) => (
                  <div key={key} className="flex items-start gap-1.5">
                    <span className="shrink-0 font-mono text-[var(--muted)]">{key}:</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[var(--fg)]">
                      {typeof value === "string" ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data !== undefined && (
            <div>
              <Label>Result</Label>
              <Pre className="mt-1">
                {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
              </Pre>
            </div>
          )}
          {!data && !error && <div className="text-[var(--muted)]">No result yet.</div>}
        </>
      )}
    />
  );
}

/** An MCP server tool call — args in, structured server data out. */
function McpChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const entries = Object.entries(args ?? {});
  return (
    <Shell
      icon={<Server className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult || entries.length > 0}
      pills={<Pill tone="accent">MCP</Pill>}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {entries.length > 0 && (
            <div>
              <Label>Arguments</Label>
              <div className="mt-1 space-y-1">
                {entries.map(([key, value]) => (
                  <div key={key} className="flex items-start gap-1.5">
                    <span className="shrink-0 font-mono text-[var(--muted)]">{key}:</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[var(--fg)]">
                      {typeof value === "string" ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data !== undefined && (
            <div>
              <Label>Result</Label>
              <Pre className="mt-1">
                {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
              </Pre>
            </div>
          )}
          {!data && !error && <div className="text-[var(--muted)]">No result yet.</div>}
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------ checkpoints */

/** create_checkpoint — the saved backup name, file, and size. */
function CreateCheckpointChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.name as string) ?? (args.name as string) ?? "";
  return (
    <Shell
      icon={<Save className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.name ? <Pill tone="accent">saved</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                  <Archive className="h-3 w-3" />
                  {name}
                </span>
                {typeof data.file_count === "number" && <Pill>{data.file_count} file(s)</Pill>}
                {typeof data.size_bytes === "number" && <Pill>{formatBytes(data.size_bytes)}</Pill>}
              </div>
              {typeof data.file === "string" && (
                <div className="break-all font-mono text-[var(--muted)]">{data.file}</div>
              )}
              {data.message && <div className="text-[var(--muted)]">{String(data.message)}</div>}
            </>
          ) : (
            !error && <div className="text-[var(--muted)]">Creating checkpoint…</div>
          )}
        </>
      )}
    />
  );
}

/** list_checkpoints — every checkpoint name + description, in a dropdown. */
function ListCheckpointsChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const checkpoints: any[] = (data?.checkpoints as any[]) ?? [];
  return (
    <Shell
      icon={<List className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={checkpoints.length > 0 ? <Pill>{checkpoints.length}</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {checkpoints.length === 0 && !error && (
            <div className="text-[var(--muted)]">No checkpoints yet.</div>
          )}
          {checkpoints.map((c, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5"
            >
              <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <Archive className="h-3 w-3" />
                {String(c.name ?? "")}
              </span>
              {typeof c.file_count === "number" && <Pill>{c.file_count} file(s)</Pill>}
              <span className="w-full text-[var(--muted)]">{String(c.description ?? "")}</span>
            </div>
          ))}
        </>
      )}
    />
  );
}

/** delete_checkpoint — mirrors the delete_sub_agent chip. */
function DeleteCheckpointChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.name as string) ?? (args.name as string) ?? "";
  return (
    <Shell
      icon={<Trash2 className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.deleted ? <Pill tone="danger">deleted</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data?.deleted && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                  <Archive className="h-3 w-3" />
                  {name}
                </span>
              </div>
              {data.message && <div className="text-[var(--muted)]">{String(data.message)}</div>}
            </>
          )}
          {!data && !error && <div className="text-[var(--muted)]">No data.</div>}
        </>
      )}
    />
  );
}

/** restore_checkpoint — the restored checkpoint plus its automatic safety backup. */
function RestoreCheckpointChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.name as string) ?? (args.name as string) ?? "";
  return (
    <Shell
      icon={<ArchiveRestore className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.name ? <Pill tone="accent">restored</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                  <ArchiveRestore className="h-3 w-3" />
                  {name}
                </span>
                {typeof data.restored_files === "number" && <Pill>{data.restored_files} file(s)</Pill>}
              </div>
              {typeof data.safety_backup === "string" && (
                <div>
                  <Label>Safety backup</Label>
                  <div className="mt-1 break-all font-mono text-[var(--muted)]">
                    {data.safety_backup}
                  </div>
                </div>
              )}
              {data.message && <div className="text-[var(--muted)]">{String(data.message)}</div>}
            </>
          ) : (
            !error && <div className="text-[var(--muted)]">Restoring checkpoint…</div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------------- MCP management tools */

function McpServerPills({ data }: { data: Record<string, unknown> | undefined }) {
  if (!data) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {typeof data.status === "string" && data.status && (
        <Pill tone={data.status === "connected" || data.status === "on" ? "accent" : data.status === "error" || data.status === "off" ? "danger" : "default"}>
          {String(data.status)}
        </Pill>
      )}
      {typeof data.tool_count === "number" && <Pill>{data.tool_count} tool(s)</Pill>}
      {typeof data.enabled === "boolean" && (
        <Pill tone={data.enabled ? "accent" : "off"}>{data.enabled ? "enabled" : "disabled"}</Pill>
      )}
    </div>
  );
}

function McpToolsList({ tools }: { tools: unknown }) {
  const list = Array.isArray(tools) ? (tools as Array<{ name?: string; description?: string }>) : [];
  if (list.length === 0) return null;
  return (
    <div>
      <Label>Native tools now available</Label>
      <div className="mt-1 flex flex-wrap gap-1">
        {list.slice(0, 12).map((t, i) => (
          <Pill key={i}>
            <Wrench className="h-2.5 w-2.5" />
            {String(t.name ?? "")}
          </Pill>
        ))}
        {list.length > 12 && <Pill>+{list.length - 12} more</Pill>}
      </div>
    </div>
  );
}

function ConnectRemoteMcpChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const authType =
    (args.auth_type as string) ?? (data?.auth_type as string) ?? "";
  const serverName =
    (args.mcp_server_name as string) ?? (data?.server_name as string) ?? "";
  const needsOAuth =
    authType === "oauth" ||
    (data as Record<string, unknown> | undefined)?.oauth_pending === true;
  const pending =
    (data as Record<string, unknown> | undefined)?.oauth_pending === true ||
    (tool.status === "running" && authType === "oauth");

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const servers = await fetchMcpServers();
      const match = servers.find(
        (s) => s.name.trim().toLowerCase() === serverName.trim().toLowerCase(),
      );
      if (!match) {
        setConnectError(
          `MCP server "${serverName}" was not found. It may still be connecting — wait a moment and try again.`,
        );
        return;
      }
      const frontendUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const started = await startMcpOAuth(match.id, { frontendUrl });
      window.open(started.auth_url, "_blank", "noopener,noreferrer");
      const final = await pollMcpConnected(match.id, 72, 2500);
      if (final !== "connected") {
        setConnectError(
          final === "auth_required"
            ? "Authorization did not complete — the server still needs OAuth. Press Connect again to retry."
            : "The server did not connect. Check its status on the MCP page.",
        );
        return;
      }
      const refreshed = await fetchMcpServers();
      useStore.getState().setMcpServers(refreshed);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Shell
      icon={<Server className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable
      pills={
        <>
          {authType && <Pill tone={authType === "oauth" ? "accent" : "default"}>{authType}</Pill>}
          {typeof data?.tool_count === "number" && <Pill>{data.tool_count} tool(s)</Pill>}
          {pending && <Pill tone="warn">awaiting OAuth</Pill>}
        </>
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          <div className="flex flex-wrap items-center gap-1.5">
            {serverName && (
              <Pill>
                <Server className="h-2.5 w-2.5" />
                <span className="font-mono">{serverName}</span>
              </Pill>
            )}
            {typeof args.url === "string" && args.url && (
              <Pill>
                <span className="max-w-[16rem] truncate font-mono">{String(args.url)}</span>
              </Pill>
            )}
          </div>
          {needsOAuth && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--chip)] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
                <span className="flex-1 text-[var(--fg)]">
                  This server needs OAuth — press Connect to authorize in your browser. The agent
                  waits up to 3 minutes, then continues.
                </span>
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={connecting}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--secondary)] px-3 py-1.5 text-[var(--secondary-fg)] disabled:opacity-50"
                >
                  {connecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" />
                  )}
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              </div>
              {connectError && <div className="mt-1.5 text-[var(--danger)]">{connectError}</div>}
            </div>
          )}
          <McpServerPills data={data as Record<string, unknown> | undefined} />
          <McpToolsList tools={(data as Record<string, unknown> | undefined)?.tools} />
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!hasResult && !error && (
            <div className="text-[var(--muted)]">
              {pending ? "Waiting for OAuth — press Connect above." : "Connecting to the MCP server…"}
            </div>
          )}
        </>
      )}
    />
  );
}

function ConnectLocalMcpChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const serverName =
    (args.mcp_server_name as string) ?? (data?.server_name as string) ?? "";
  return (
    <Shell
      icon={<Server className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable
      pills={
        typeof data?.tool_count === "number" ? <Pill>{data.tool_count} tool(s)</Pill> : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {serverName && (
            <Pill>
              <Server className="h-2.5 w-2.5" />
              <span className="font-mono">{String(serverName)}</span>
            </Pill>
          )}
          <McpServerPills data={data as Record<string, unknown> | undefined} />
          <McpToolsList tools={(data as Record<string, unknown> | undefined)?.tools} />
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!hasResult && !error && <div className="text-[var(--muted)]">Connecting to the local MCP server…</div>}
        </>
      )}
    />
  );
}

function ListMcpServersChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const servers: Array<{ name?: string; description?: string; status?: string; enabled?: boolean; tool_count?: number }> =
    (data?.servers as Array<{ name?: string; description?: string; status?: string; enabled?: boolean; tool_count?: number }>) ?? [];
  return (
    <Shell
      icon={<List className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={servers.length > 0 ? <Pill>{servers.length} server(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {servers.length === 0 && !error && (
            <div className="text-[var(--muted)]">No MCP servers available.</div>
          )}
          {servers.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <Server className="h-3 w-3" />
                {String(s.name ?? "")}
              </span>
              {s.status && (
                <Pill tone={s.status === "connected" ? "accent" : s.status === "error" ? "danger" : "default"}>
                  {String(s.status)}
                </Pill>
              )}
              {typeof s.enabled === "boolean" && (
                <Pill tone={s.enabled ? "accent" : "off"}>{s.enabled ? "on" : "off"}</Pill>
              )}
              {typeof s.tool_count === "number" && <Pill>{s.tool_count} tool(s)</Pill>}
              {s.description && <span className="w-full text-[var(--muted)]">{String(s.description)}</span>}
            </div>
          ))}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

function DeleteMcpServerChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string =
    (data?.server_name as string) ?? (args.mcp_server_name as string) ?? "";
  return (
    <Shell
      icon={<Trash2 className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.deleted ? <Pill tone="danger">deleted</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {name && (
            <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
              <Server className="h-3 w-3" />
              {name}
            </span>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!data && !error && <div className="text-[var(--muted)]">Deleting the MCP server…</div>}
        </>
      )}
    />
  );
}

function ToggleMcpServerChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string =
    (data?.server_name as string) ?? (args.mcp_server_name as string) ?? "";
  const status = (data?.status as string) ?? (args.status as string) ?? "";
  return (
    <Shell
      icon={<Plug className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={status ? <Pill tone={status === "on" ? "accent" : "off"}>{status}</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {name && (
            <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
              {status === "on" ? <PlugZap className="h-3 w-3" /> : <Unplug className="h-3 w-3" />}
              {name}
            </span>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!hasResult && !error && <div className="text-[var(--muted)]">Updating the MCP server…</div>}
        </>
      )}
    />
  );
}

function McpStatusChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string =
    (data?.server_name as string) ?? (args.mcp_server_name as string) ?? "";
  return (
    <Shell
      icon={<Activity className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={
        typeof data?.status === "string" && data.status ? (
          <Pill tone={data.status === "connected" ? "accent" : data.status === "error" ? "danger" : "default"}>
            {String(data.status)}
          </Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {name && (
            <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
              <Server className="h-3 w-3" />
              {name}
            </span>
          )}
          <McpServerPills data={data as Record<string, unknown> | undefined} />
          <McpToolsList tools={(data as Record<string, unknown> | undefined)?.tools} />
          {typeof (data as Record<string, unknown> | undefined)?.last_error === "string" &&
            (data as Record<string, unknown>).last_error && (
              <div className="text-[var(--danger)]">
                Last error: {String((data as Record<string, unknown>).last_error)}
              </div>
            )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------ application connectors */

/** One catalog row as list_available_application_connectors returns it. */
type AppConnectorRow = {
  connector_name?: string;
  label?: string;
  description?: string;
  homepage?: string;
  status?: string;
  connected?: boolean;
  requires_user_action?: boolean;
  account_label?: string;
};

/** Badge coloring for the connector lifecycle status. */
function connectorStatusPill(status: string) {
  if (status === "connected") return <Pill tone="accent">{status}</Pill>;
  if (status === "failed") return <Pill tone="danger">{status}</Pill>;
  if (status === "requires_user_action") return <Pill tone="warn">needs action</Pill>;
  return <Pill tone="off">{status || "disconnected"}</Pill>;
}

/** The connector's display name, preferring the catalog label over the id. */
function appConnectorLabel(
  data: Record<string, any> | undefined,
  args: Record<string, any>,
): string {
  return String(data?.label ?? data?.connector_label ?? args.connector_name ?? "");
}

/**
 * connect_applications_connectors — the inline Connect button.
 *
 * The backend already opened the Composio OAuth session and sent us its redirect URL,
 * so pressing Connect only has to open it and then poll until the provider activates
 * the account. When no URL made it through (e.g. the user reopened an old run), we fall
 * back to starting a fresh session from this connector id.
 */
function ConnectAppConnectorChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const connectorName = String(data?.connector_name ?? args.connector_name ?? "");
  const label = appConnectorLabel(data, args) || connectorName;
  const redirectUrl = String(data?.redirect_url ?? "");
  const connectedAccountId = String(data?.connected_account_id ?? "");
  const pending =
    data?.connector_connect_pending === true ||
    (tool.status === "running" && !data?.connected);
  const connected = data?.connected === true;

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      let url = redirectUrl;
      let accountId = connectedAccountId;
      if (!url) {
        // No in-flight session on this block — open a fresh one for the same connector.
        const started = await startConnectorConnect(connectorName);
        url = started.redirect_url;
        accountId = started.connected_account_id;
      }
      if (!url) {
        setConnectError("Could not start the connection. Open the Connectors page and try again.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      if (!accountId) {
        setConnectError(
          "Authorization started. Finish it in the browser tab, then check the Connectors page.",
        );
        return;
      }
      const final = await pollConnectorActive(accountId, 72, 2500);
      if (final !== "active") {
        setConnectError(
          final === "failed"
            ? "The app refused the authorization. Press Connect to try again."
            : "Authorization has not finished yet. Finish it in the browser tab, then press Connect again.",
        );
        return;
      }
      // Mirror the backend truth so the connectors page and the next turn agree.
      const overview = await fetchConnectorsOverview();
      const match = overview.connectors.find((c) => c.id === connectorName);
      if (match) {
        useStore.getState().setConnector({
          connectorId: match.id,
          connectedAccountId: match.connected_account_id ?? accountId,
          status: match.status,
          accountLabel: match.account_label ?? "",
          updatedAt: match.updated_at ?? Date.now(),
        });
      }
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Shell
      icon={<PlugZap className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable
      defaultOpen={pending}
      pills={
        <>
          {connected && <Pill tone="accent">connected</Pill>}
          {data?.already_connected === true && <Pill tone="default">already</Pill>}
          {typeof data?.tool_count === "number" && <Pill>{data.tool_count} app tool(s)</Pill>}
          {pending && <Pill tone="warn">awaiting authorization</Pill>}
        </>
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {label && (
            <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
              <PlugZap className="h-3.5 w-3.5 text-[var(--secondary)]" />
              {label}
            </span>
          )}
          {typeof data?.description === "string" && data.description && (
            <div className="text-[var(--muted)]">{data.description}</div>
          )}
          {!connected && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--chip)] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
                <span className="flex-1 text-[var(--fg)]">
                  Authorize {label || "this app"} in your browser — the agent waits up to 3 minutes,
                  then continues. Once authorized, this app&apos;s tools are usable immediately.
                </span>
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={connecting}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--secondary)] px-3 py-1.5 text-[var(--secondary-fg)] disabled:opacity-50"
                >
                  {connecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" />
                  )}
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              </div>
              {connectError && <div className="mt-1.5 text-[var(--danger)]">{connectError}</div>}
            </div>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!hasResult && !error && !data && (
            <div className="text-[var(--muted)]">Preparing the connection…</div>
          )}
        </>
      )}
    />
  );
}

function ListAppConnectorsChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const connectors: AppConnectorRow[] = Array.isArray(data?.connectors)
    ? (data.connectors as AppConnectorRow[])
    : [];
  const connectedCount =
    typeof data?.connected_count === "number" ? data.connected_count : 0;
  return (
    <Shell
      icon={<List className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={
        connectors.length > 0 ? (
          <Pill>
            {connectedCount}/{connectors.length} connected
          </Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {connectors.length === 0 && !error && (
            <div className="text-[var(--muted)]">No application connectors available.</div>
          )}
          {connectors.map((c, i) => (
            <div
              key={String(c.connector_name ?? i)}
              className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-2"
            >
              <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <Plug className="h-3 w-3" />
                {String(c.label ?? c.connector_name ?? "")}
              </span>
              <Pill>
                <span className="font-mono">{String(c.connector_name ?? "")}</span>
              </Pill>
              {c.status && connectorStatusPill(String(c.status))}
              {c.account_label && <Pill>{String(c.account_label)}</Pill>}
              {c.description && <span className="w-full text-[var(--muted)]">{String(c.description)}</span>}
            </div>
          ))}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

function DisconnectAppConnectorChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const connectorName = String(data?.connector_name ?? args.connector_name ?? "");
  const label = appConnectorLabel(data, args) || connectorName;
  return (
    <Shell
      icon={<Unplug className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={data?.disconnected === true ? <Pill tone="danger">disconnected</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {connectorName && (
            <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
              <Unplug className="h-3.5 w-3.5" />
              {label}
            </span>
          )}
          {typeof data?.removed_tools === "number" && data.removed_tools > 0 && (
            <div className="text-[var(--muted)]">
              {data.removed_tools} app tool(s) removed from this conversation.
            </div>
          )}
          {data?.remote_cleanup_failed === true && (
            <div className="text-[var(--warning)]">
              The provider-side authorization could not be revoked automatically.
            </div>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!hasResult && !error && <div className="text-[var(--muted)]">Disconnecting the app…</div>}
        </>
      )}
    />
  );
}

function AppConnectorStatusChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const connectorName = String(data?.connector_name ?? args.connector_name ?? "");
  const label = appConnectorLabel(data, args) || connectorName;
  const status = String(data?.status ?? "");
  return (
    <Shell
      icon={<Activity className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={status ? connectorStatusPill(status) : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {label && (
            <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
              <Activity className="h-3.5 w-3.5" />
              {label}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {data?.connected === true && <Pill tone="accent">tools usable</Pill>}
            {data?.requires_user_action === true && <Pill tone="warn">needs authorization</Pill>}
            {data?.disabled === true && <Pill tone="danger">disabled</Pill>}
          </div>
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

/* ------------------------------------------ communication channels */

function ChannelPills({ data }: { data: Record<string, unknown> | undefined }) {
  if (!data) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {typeof data.channel_label === "string" && data.channel_label && (
        <Pill tone="accent">{String(data.channel_label)}</Pill>
      )}
      {typeof data.status === "string" && data.status && (
        <Pill tone={data.status === "connected" ? "accent" : data.status === "error" ? "danger" : "default"}>
          {String(data.status)}
        </Pill>
      )}
      {typeof data.connected === "boolean" && (
        <Pill tone={data.connected ? "accent" : "off"}>{data.connected ? "connected" : "not connected"}</Pill>
      )}
    </div>
  );
}

/** list_available_channels — every connectable channel with its description. */
function ListChannelsChip({ tool }: { tool: ToolActivity }) {
  const { data, error, hasResult } = parts(tool);
  const channels: Array<{ channel_name?: string; label?: string; description?: string; connected?: number; connection_count?: number }> =
    (data?.channels as Array<{ channel_name?: string; label?: string; description?: string; connected?: number; connection_count?: number }>) ?? [];
  return (
    <Shell
      icon={<MessagesSquare className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={channels.length > 0 ? <Pill>{channels.length} channel(s)</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {channels.length === 0 && !error && (
            <div className="text-[var(--muted)]">No communication channels available.</div>
          )}
          {channels.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
              <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
                <MessagesSquare className="h-3 w-3" />
                {String(c.label ?? c.channel_name ?? "")}
              </span>
              {typeof c.connected === "number" && <Pill tone={c.connected > 0 ? "accent" : "off"}>{c.connected} connected</Pill>}
              {c.description && <span className="w-full text-[var(--muted)]">{String(c.description)}</span>}
            </div>
          ))}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

/**
 * request_channel_connection_to_user — the inline channel configuration form.
 *
 * Shows ALL of the channel's configuration (connection name + bot token fields),
 * the step-by-step setup guide, and a Connect button. The agent blocks up to
 * 3 minutes waiting for the user; creating the connection here resolves it.
 */
function RequestChannelChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const channelName: string =
    (data?.channel_name as string) ?? (args.channel_name as string) ?? "";
  const channelLabel: string =
    (data?.channel_label as string) ?? channelName;
  const description: string = (data?.description as string) ?? "";
  const setupGuide: string = (data?.setup_guide as string) ?? "";
  const addressing: string = (data?.addressing as string) ?? "";
  const pending =
    (data as Record<string, unknown> | undefined)?.channel_connection_pending === true ||
    (tool.status === "running" && !hasResult);
  const timedOut = (data as Record<string, unknown> | undefined)?.timed_out === true;
  const alreadyConnected = (data as Record<string, unknown> | undefined)?.already_connected === true;

  const meta = AVAILABLE_CHANNELS.find((c) => c.id === channelName.trim().toLowerCase());
  const guide = setupGuide || meta?.setup || "";
  const howToAddress = addressing || meta?.addressing || "";
  const about = description || meta?.description || "";

  const connect = async () => {
    if (!channelName.trim()) {
      setConnectError("Unknown channel — pick one from list_available_channels first.");
      return;
    }
    if (!token.trim()) {
      setConnectError("Paste the bot token first (see the setup guide below).");
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      await createChannel({
        kind: channelName.trim().toLowerCase() as "telegram" | "discord" | "slack",
        name: name.trim() || undefined,
        token: token.trim(),
      });
      const refreshed = await fetchChannels();
      useStore.getState().setChannelConnections(refreshed);
      setConnected(true);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Shell
      icon={<MessagesSquare className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable
      pills={
        <>
          {channelLabel && <Pill tone="accent">{channelLabel}</Pill>}
          {pending && !timedOut && !alreadyConnected && <Pill tone="warn">awaiting setup</Pill>}
          {timedOut && <Pill tone="warn">timed out</Pill>}
          {alreadyConnected && <Pill>already connected</Pill>}
          {connected && <Pill tone="accent">connected</Pill>}
        </>
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {about && <div className="text-[var(--muted)]">{about}</div>}
          {guide && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--chip)] p-2.5">
              <Label>Setup guide</Label>
              <div className="mt-1 whitespace-pre-wrap text-[var(--fg)]">{guide}</div>
              {howToAddress && (
                <div className="mt-1.5 text-[var(--muted)]">Commands: {howToAddress}</div>
              )}
            </div>
          )}
          {!alreadyConnected && !timedOut && (
            <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border)] p-2.5">
              <Label>Connect {channelLabel || channelName || "channel"}</Label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Connection name (optional, e.g. My ${channelLabel || "bot"})`}
                aria-label="Connection name"
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--secondary)]"
              />
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={channelName.toLowerCase() === "slack" ? "Bot User OAuth Token (xoxb-…)" : "Bot token"}
                aria-label="Bot token"
                className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--secondary)]"
              />
              <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting || connected}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--secondary)] px-3 py-1.5 text-xs text-[var(--secondary-fg)] disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlugZap className="h-3.5 w-3.5" />
                )}
                {connected ? "Connected" : connecting ? "Connecting…" : "Connect"}
              </button>
              {connectError && <div className="text-[var(--danger)]">{connectError}</div>}
              {connected && (
                <div className="text-[var(--success)]">Connected — the waiting agent continues automatically.</div>
              )}
              <div className="text-[var(--subtle)]">The token is stored server-side only. The agent waits up to 3 minutes, then continues.</div>
            </div>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!hasResult && !error && !pending && (
            <div className="text-[var(--muted)]">Requesting the channel connection…</div>
          )}
        </>
      )}
    />
  );
}

/** disconnect_channels — which connections were removed. */
function DisconnectChannelChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.channel_name as string) ?? (args.channel_name as string) ?? "";
  const disconnected: Array<{ id?: string; name?: string }> =
    (data?.disconnected as Array<{ id?: string; name?: string }>) ?? [];
  return (
    <Shell
      icon={<Unplug className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={typeof data?.disconnected_count === "number" ? <Pill tone="danger">{data.disconnected_count} removed</Pill> : undefined}
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {name && (
            <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
              <MessagesSquare className="h-3 w-3" />
              {name}
            </span>
          )}
          {disconnected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {disconnected.map((d, i) => (
                <Pill key={i}>{String(d.name ?? d.id ?? "")}</Pill>
              ))}
            </div>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!data && !error && <div className="text-[var(--muted)]">Disconnecting the channel…</div>}
        </>
      )}
    />
  );
}

/** get_channel_status — configured/connected state plus per-connection rows. */
function ChannelStatusChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const name: string = (data?.channel_name as string) ?? (args.channel_name as string) ?? "";
  const connections: Array<{ id?: string; name?: string; status?: string; enabled?: boolean; bot_name?: string; chat_count?: number }> =
    (data?.connections as Array<{ id?: string; name?: string; status?: string; enabled?: boolean; bot_name?: string; chat_count?: number }>) ?? [];
  return (
    <Shell
      icon={<Activity className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={
        typeof data?.connected === "boolean" ? (
          <Pill tone={data.connected ? "accent" : "off"}>{data.connected ? "connected" : "not connected"}</Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {name && (
            <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
              <MessagesSquare className="h-3 w-3" />
              {String((data?.channel_label as string) ?? name)}
            </span>
          )}
          <ChannelPills data={data as Record<string, unknown> | undefined} />
          {connections.length > 0 && (
            <div className="space-y-1">
              {connections.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
                  <span className="font-medium text-[var(--fg)]">{String(c.name ?? c.id ?? "")}</span>
                  {c.status && (
                    <Pill tone={c.status === "connected" ? "accent" : c.status === "error" ? "danger" : "default"}>
                      {String(c.status)}
                    </Pill>
                  )}
                  {typeof c.enabled === "boolean" && (
                    <Pill tone={c.enabled ? "accent" : "off"}>{c.enabled ? "on" : "off"}</Pill>
                  )}
                  {c.bot_name && <span className="font-mono text-[var(--muted)]">@{String(c.bot_name)}</span>}
                </div>
              ))}
            </div>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
        </>
      )}
    />
  );
}

/** send_message_to_communication_channel — delivery receipt. */
function SendChannelMessageChip({ tool }: { tool: ToolActivity }) {
  const { data, error, args, hasResult } = parts(tool);
  const channelName: string = (data?.channel_name as string) ?? (args.channel_name as string) ?? "";
  const targets: string[] = Array.isArray(data?.targets) ? (data.targets as string[]) : [];
  return (
    <Shell
      icon={<Send className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={hasResult}
      pills={
        typeof data?.delivered === "number" ? (
          <Pill tone={data.delivered > 0 ? "accent" : "danger"}>{data.delivered} sent</Pill>
        ) : undefined
      }
      panel={() => (
        <>
          {error?.message && <div className="text-[var(--danger)]">{error.message}</div>}
          {channelName && (
            <span className="flex items-center gap-1 font-medium text-[var(--fg)]">
              <MessagesSquare className="h-3 w-3" />
              {String((data?.channel_label as string) ?? channelName)}
            </span>
          )}
          {typeof args.message === "string" && args.message && (
            <div>
              <Label>Message</Label>
              <Pre className="mt-1">{String(args.message)}</Pre>
            </div>
          )}
          {targets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {targets.slice(0, 8).map((t, i) => (
                <Pill key={i}>{t}</Pill>
              ))}
              {targets.length > 8 && <Pill>+{targets.length - 8} more</Pill>}
            </div>
          )}
          {typeof data?.message === "string" && data.message && (
            <div className="text-[var(--muted)]">{data.message}</div>
          )}
          {!data && !error && <div className="text-[var(--muted)]">Sending the message…</div>}
        </>
      )}
    />
  );
}

function SlidingWindowChip({ tool }: { tool: ToolActivity }) {
  const { data } = parts(tool);
  const removed =
    typeof data?.removed_messages === "number" ? data.removed_messages : null;
  const freed =
    typeof data?.freed_tokens_estimate === "number" ? data.freed_tokens_estimate : null;
  const percent =
    typeof data?.truncate_percent === "number" ? Math.round(data.truncate_percent * 100) : null;
  const preview = Array.isArray(data?.preview) ? (data.preview as unknown[]) : [];
  const lines = preview.filter((p): p is string => typeof p === "string").slice(0, 30);
  return (
    <Shell
      icon={<History className="h-3.5 w-3.5" />}
      label={tool.label || "Sliding window: removed old context"}
      status={tool.status}
      expandable
      panel={() => (
        <div className="flex flex-col gap-2">
          <div className="text-[var(--fg)]">
            The oldest context was deleted first (newest preserved) so the agent can keep
            working. System prompt, memory, knowledge, and latest user input were preserved.
            {removed !== null && freed !== null && (
              <>
                {" "}Removed {removed} message(s) (~{freed.toLocaleString("en-US")} tokens
                {percent !== null ? `, target ${percent}%` : ""}).
              </>
            )}
          </div>
          {lines.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--subtle)]">
                Deleted tokens ({lines.length}{preview.length > lines.length ? "+" : ""})
              </div>
              <Pre>
                {lines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </Pre>
            </div>
          ) : (
            <div className="text-[var(--muted)]">Deleted content preview unavailable.</div>
          )}
        </div>
      )}
    />
  );
}

function GenericChip({ tool }: { tool: ToolActivity }) {
  const { hasResult, icon: Icon } = parts(tool);
  const expandable = hasResult && Boolean(tool.result);
  return (
    <Shell
      icon={<Icon className="h-3.5 w-3.5" />}
      label={tool.label}
      status={tool.status}
      expandable={expandable}
      panel={() => (
        <div className="flex items-start gap-1.5">
          <Braces className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted)]" />
          <Pre>{JSON.stringify(tool.result, null, 2)}</Pre>
        </div>
      )}
    />
  );
}
