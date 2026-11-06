import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  ExternalLink,
  FileText,
  Info,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldQuestion,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Button, Select, TextInput } from "@/components/ui/primitives";
import { AcpClientIcon } from "@/components/icons/NavIcons";
import { buildAcpChat, type AcpChatEntry } from "@/lib/acpChat";
import type {
  AcpClient,
  AcpElicitationRequest,
  AcpPermissionOption,
  AcpPlanEntry,
  AcpSession,
  AcpSessionConfigOption,
  AcpSessionModeState,
  AcpStoredEvent,
  AcpToolCall,
  AcpToolCallContent,
} from "@/lib/acpClient";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { cn } from "@/utils/cn";

/**
 * Beautiful, streaming chat surface for one connected ACP agent.
 *
 * It renders the protocol faithfully: streamed assistant text and reasoning,
 * tool calls with their live status/content, plans, notices, usage, modes and
 * config options, and inline permission/elicitation cards that answer the
 * agent's client-directed requests.
 */

export interface AcpChatProps {
  client: AcpClient;
  session: AcpSession | null;
  sessions: AcpSession[];
  events: AcpStoredEvent[];
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onModeChange: (modeId: string) => void;
  onConfigChange: (configId: string, value: string | boolean) => void;
  onPermission: (requestId: string, optionId: string | null) => void;
  onElicitation: (
    requestId: string,
    response: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
  ) => void;
}

export function AcpChat({
  client,
  session,
  sessions,
  events,
  sending,
  error,
  onSend,
  onStop,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onModeChange,
  onConfigChange,
  onPermission,
  onElicitation,
}: AcpChatProps) {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const entries = useMemo(() => buildAcpChat(events), [events]);
  const { ref: scrollRef, onScroll } = useAutoScroll<HTMLDivElement>(events.length + (sending ? 1 : 0));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const connected = client.status === "connected";
  const running = sending || session?.running === true;
  const modes = session?.meta.modes ?? null;
  const configOptions = session?.meta.configOptions ?? [];
  const usage = session?.meta.usage ?? null;

  const copySessionId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || !session || running || !connected) return;
    onSend(text);
    setInput("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)]",
            connected ? "bg-[var(--secondary)] text-[var(--secondary-fg)]" : "bg-[var(--chip)] text-[var(--muted)]",
          )}
          aria-hidden
        >
          <AcpClientIcon className="h-5 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="m-0 truncate text-sm font-semibold text-[var(--fg)]">{client.name}</h2>
            <StatusPill client={client} running={running} />
          </div>
          <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-[var(--subtle)]">
            {session ? `session ${session.id}` : "No session yet"}
            {client.agent?.version ? ` · agent v${client.agent.version}` : ""}
          </p>
        </div>

        {session && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void copySessionId()}
              title="Copy session id"
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2 text-[11px] text-[var(--muted)] hover:border-[var(--secondary)] hover:text-[var(--fg)]"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
              Session ID
            </button>
            <Button
              variant="ghost"
              className="h-8 px-2"
              onClick={() => setShowSettings((value) => !value)}
              title="Session controls"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Controls
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {sessions.length > 0 && (
            <Select
              value={session?.id ?? ""}
              onChange={(event) => onSelectSession(event.target.value)}
              className="h-8 w-40 py-0 text-xs"
              aria-label="Select session"
            >
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || item.id}
                </option>
              ))}
            </Select>
          )}
          <Button
            variant="outline"
            className="h-8 px-2.5 text-xs"
            onClick={onNewSession}
            disabled={!connected}
            title="New session"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
          {session && (
            <Button
              variant="ghost"
              className="h-8 px-2"
              onClick={() => onDeleteSession(session.id)}
              title="Delete session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      {showSettings && session && (
        <SessionControls
          modes={modes}
          configOptions={configOptions}
          usage={usage}
          onModeChange={onModeChange}
          onConfigChange={onConfigChange}
        />
      )}

      {!connected && (
        <div className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--warning-soft)] px-4 py-2.5 text-xs text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This agent is not connected. Use Connect in the agent list before creating a session
            or sending a prompt.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border-b border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] px-4 py-2.5 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!session ? (
          <EmptyChat client={client} onNewSession={onNewSession} />
        ) : entries.length === 0 && !running ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--chip)] text-[var(--muted)]">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div>
              <p className="m-0 text-sm font-medium text-[var(--fg)]">Start the conversation</p>
              <p className="m-0 mt-1 max-w-sm text-xs leading-relaxed text-[var(--muted)]">
                Messages, streamed reasoning, tool calls and permission requests from{" "}
                {client.name} appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => (
              <ChatEntryView
                key={entry.key}
                entry={entry}
                onPermission={onPermission}
                onElicitation={onElicitation}
                disabled={!connected}
              />
            ))}
            {running && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {client.name} is working…
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--border)] p-3">
        <div className="flex items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-2 focus-within:border-[var(--secondary)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={
              session
                ? connected
                  ? `Message ${client.name}…  (Enter to send, Shift+Enter for a new line)`
                  : "Connect the agent to send messages"
                : "Create a session to start chatting"
            }
            disabled={!session || !connected}
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] disabled:cursor-not-allowed"
          />
          {running ? (
            <Button variant="danger" onClick={onStop} className="h-9 px-3" title="Stop the running turn">
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!session || !connected || !input.trim()}
              className="h-9 px-3"
              title="Send"
            >
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-[var(--subtle)]">
          ACP · {client.command} {client.args.join(" ")}
          {session ? ` · status ${running ? "running" : session.status}` : ""}
        </p>
      </footer>
    </section>
  );
}

function StatusPill({ client, running }: { client: AcpClient; running: boolean }) {
  const status = running ? "streaming" : client.status === "connected" ? "connected" : client.status;
  const style =
    status === "connected" || status === "streaming"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : status === "error"
        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
        : status === "connecting"
          ? "bg-[var(--warning-soft)] text-[var(--warning)]"
          : "bg-[var(--chip)] text-[var(--muted)]";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", style)}>
      {(status === "connecting" || status === "streaming") && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status === "connected" && <CheckCircle2 className="h-2.5 w-2.5" />}
      {status === "error" && <AlertTriangle className="h-2.5 w-2.5" />}
      {status}
    </span>
  );
}

function EmptyChat({ client, onNewSession }: { client: AcpClient; onNewSession: () => void }) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center gap-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)]">
        <AcpClientIcon className="h-7 w-12" />
      </span>
      <div>
        <p className="m-0 text-base font-semibold text-[var(--fg)]">Chat with {client.name}</p>
        <p className="m-0 mt-1 max-w-md text-xs leading-relaxed text-[var(--muted)]">
          Create a session to begin. Every session gets a 20-digit id generated by Mythgram — the
          connected agent&apos;s internal id is never exposed.
        </p>
      </div>
      <Button onClick={onNewSession} disabled={client.status !== "connected"}>
        <Plus className="h-4 w-4" /> New session
      </Button>
      {client.status !== "connected" && (
        <p className="m-0 text-[11px] text-[var(--warning)]">Connect this agent first.</p>
      )}
    </div>
  );
}

function SessionControls({
  modes,
  configOptions,
  usage,
  onModeChange,
  onConfigChange,
}: {
  modes: AcpSessionModeState | null;
  configOptions: AcpSessionConfigOption[];
  usage: { used: number; size: number; cost?: { amount: number; currency: string } } | null;
  onModeChange: (modeId: string) => void;
  onConfigChange: (configId: string, value: string | boolean) => void;
}) {
  const hasControls = Boolean(modes?.availableModes?.length) || configOptions.length > 0 || usage;
  if (!hasControls) {
    return (
      <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] text-[var(--subtle)]">
        This agent does not expose session modes, config options or usage.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-[var(--border)] bg-[var(--chip)] px-4 py-2.5">
      {modes?.availableModes?.length ? (
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--subtle)]">
          Mode
          <Select
            value={modes.currentModeId}
            onChange={(event) => onModeChange(event.target.value)}
            className="h-8 py-0 text-xs"
          >
            {modes.availableModes.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {configOptions.map((option) => (
        <ConfigOptionControl key={option.id} option={option} onChange={onConfigChange} />
      ))}
      {usage && usage.size > 0 ? (
        <div className="min-w-40 flex-1">
          <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--subtle)]">
            <span className="uppercase tracking-wide">Context</span>
            <span className="tabular-nums">
              {Math.round((usage.used / usage.size) * 100)}% · {formatNumber(usage.used)}/
              {formatNumber(usage.size)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--secondary)]"
              style={{ width: `${Math.min(100, Math.round((usage.used / usage.size) * 100))}%` }}
            />
          </div>
          {usage.cost ? (
            <p className="m-0 mt-1 text-[10px] text-[var(--subtle)]">
              Cost {usage.cost.amount} {usage.cost.currency}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConfigOptionControl({
  option,
  onChange,
}: {
  option: AcpSessionConfigOption;
  onChange: (configId: string, value: string | boolean) => void;
}) {
  if (option.type === "boolean") {
    return (
      <label className="flex min-w-36 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--subtle)]">
        {option.name}
        <button
          type="button"
          role="switch"
          aria-checked={option.currentValue === true}
          onClick={() => onChange(option.id, option.currentValue !== true)}
          className={cn(
            "inline-flex h-8 w-14 items-center rounded-full border border-[var(--border)] px-1 transition-colors",
            option.currentValue === true ? "bg-[var(--secondary)]" : "bg-[var(--bg)]",
          )}
          title={option.description}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
              option.currentValue === true ? "translate-x-7" : "translate-x-0",
            )}
          />
        </button>
      </label>
    );
  }
  const values = flattenConfigOptions(option);
  if (values.length === 0) return null;
  return (
    <label className="flex min-w-40 flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--subtle)]">
      {option.name}
      <Select
        value={String(option.currentValue)}
        onChange={(event) => onChange(option.id, event.target.value)}
        className="h-8 py-0 text-xs"
        title={option.description}
      >
        {values.map((value) => (
          <option key={value.value} value={value.value}>
            {value.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function flattenConfigOptions(option: AcpSessionConfigOption): Array<{ value: string; name: string }> {
  const out: Array<{ value: string; name: string }> = [];
  for (const item of option.options ?? []) {
    if ("group" in item) {
      for (const child of item.options) out.push({ value: child.value, name: child.name });
    } else {
      out.push({ value: item.value, name: item.name });
    }
  }
  return out;
}

function ChatEntryView({
  entry,
  onPermission,
  onElicitation,
  disabled,
}: {
  entry: AcpChatEntry;
  onPermission: (requestId: string, optionId: string | null) => void;
  onElicitation: (
    requestId: string,
    response: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
  ) => void;
  disabled: boolean;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex justify-end fade-in">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius-lg)] rounded-br-md bg-[var(--secondary)] px-4 py-2.5 text-sm leading-relaxed text-[var(--secondary-fg)]">
            {entry.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="flex gap-3 fade-in">
          <BotAvatar />
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-[var(--radius-lg)] rounded-tl-md bg-[var(--chip)] px-4 py-2.5 text-sm leading-relaxed text-[var(--fg)]">
            {entry.text}
          </div>
        </div>
      );
    case "thought":
      return (
        <div className="flex gap-3 fade-in">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--chip)] text-[var(--subtle)]">
            <Brain className="h-3.5 w-3.5" />
          </span>
          <details className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--chip)]">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--muted)]">
              Reasoning
            </summary>
            <div className="whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-[var(--muted)]">
              {entry.text}
            </div>
          </details>
        </div>
      );
    case "tool":
      return <ToolCallCard toolCall={entry.toolCall} />;
    case "plan":
      return <PlanCard entries={entry.entries} />;
    case "notice":
      return <NoticeCard title={entry.title} description={entry.description} severity={entry.severity} />;
    case "error":
      return (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-xs text-[var(--danger)] fade-in">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{entry.text}</span>
        </div>
      );
    case "permission":
      return (
        <PermissionCard
          entry={entry}
          disabled={disabled}
          onRespond={(optionId) => onPermission(entry.requestId, optionId)}
        />
      );
    case "elicitation":
      return (
        <ElicitationCard
          requestId={entry.requestId}
          request={entry.request}
          resolved={entry.resolved}
          disabled={disabled}
          onRespond={(response) => onElicitation(entry.requestId, response)}
        />
      );
    default:
      return null;
  }
}

function BotAvatar() {
  return (
    <span
      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)]"
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.9" />
      </svg>
    </span>
  );
}

function ToolCallCard({ toolCall }: { toolCall: AcpToolCall }) {
  const [open, setOpen] = useState(false);
  const status = toolCall.status || "pending";
  const Icon = status === "completed" ? CheckCircle2 : status === "failed" ? X : Wrench;
  const color =
    status === "completed"
      ? "text-[var(--success)]"
      : status === "failed"
        ? "text-[var(--danger)]"
        : "text-[var(--warning)]";
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] fade-in">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--chip)]", color)}>
          {status === "pending" || status === "in_progress" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[var(--fg)]">
            {toolCall.title || toolCall.name || "Tool call"}
          </span>
          <span className="block truncate text-[10px] text-[var(--subtle)]">
            {toolCall.kind ? `${toolCall.kind} · ` : ""}
            {status.replaceAll("_", " ")}
            {toolCall.locations?.length ? ` · ${toolCall.locations[0]?.path}` : ""}
          </span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-[var(--border)] px-3 py-2.5">
          {toolCall.locations?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {toolCall.locations.map((location) => (
                <span
                  key={`${location.path}:${location.line ?? 0}`}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--chip)] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)]"
                >
                  <FileText className="h-2.5 w-2.5" />
                  {location.path}
                  {location.line ? `:${location.line}` : ""}
                </span>
              ))}
            </div>
          ) : null}
          {toolCall.content?.length ? (
            <div className="space-y-2">
              {toolCall.content.map((content, index) => (
                <ToolContent key={index} content={content} />
              ))}
            </div>
          ) : null}
          {toolCall.rawInput !== undefined && toolCall.rawInput !== null ? (
            <JsonDetails label="Input" value={toolCall.rawInput} />
          ) : null}
          {toolCall.rawOutput !== undefined && toolCall.rawOutput !== null ? (
            <JsonDetails label="Output" value={toolCall.rawOutput} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ToolContent({ content }: { content: AcpToolCallContent }) {
  if (content.type === "content" && content.content) {
    return (
      <div className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--chip)] px-3 py-2 text-xs leading-relaxed text-[var(--fg)]">
        {toolContentText(content.content)}
      </div>
    );
  }
  if (content.type === "diff" && content.path) {
    return (
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
        <div className="border-b border-[var(--border)] bg-[var(--chip)] px-3 py-1.5 font-mono text-[10px] text-[var(--muted)]">
          {content.path}
        </div>
        {content.oldText ? (
          <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-[color:color-mix(in_oklab,var(--danger)_5%,transparent)] px-3 py-2 text-[11px] text-[var(--danger)]">
            {content.oldText}
          </pre>
        ) : null}
        <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words bg-[color:color-mix(in_oklab,var(--success)_6%,transparent)] px-3 py-2 text-[11px] text-[var(--fg)]">
          {content.newText}
        </pre>
      </div>
    );
  }
  if (content.type === "terminal" && content.terminalId) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--chip)] px-3 py-2 font-mono text-[11px] text-[var(--muted)]">
        <Terminal className="h-3.5 w-3.5" />
        {content.terminalId}
      </div>
    );
  }
  return <JsonDetails label="Content" value={content} defaultOpen />;
}

function toolContentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: string; text?: string; resource?: { text?: string; uri?: string } };
  if (block.type === "text") return block.text ?? "";
  if (block.type === "resource") return block.resource?.text ?? block.resource?.uri ?? "[resource]";
  return block.type ? `[${block.type}]` : JSON.stringify(content, null, 2);
}

function JsonDetails({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const text = useMemo(() => {
    try {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <details open={defaultOpen} className="rounded-[var(--radius-md)] bg-[var(--chip)]">
      <summary className="cursor-pointer px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--subtle)]">
        {label}
      </summary>
      <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 pb-2 text-[11px] leading-relaxed text-[var(--muted)]">
        {text}
      </pre>
    </details>
  );
}

function PlanCard({ entries }: { entries: AcpPlanEntry[] }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 fade-in">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
        <ListChecks className="h-3.5 w-3.5" /> Plan
      </div>
      <ul className="m-0 space-y-1.5 p-0">
        {entries.map((entry, index) => {
          const status = entry.status || "pending";
          return (
            <li key={`${index}:${entry.content}`} className="flex items-start gap-2 text-xs text-[var(--fg)]">
              <span className="mt-0.5 shrink-0">
                {status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
                ) : status === "in_progress" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--warning)]" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[var(--subtle)]" />
                )}
              </span>
              <span className={cn("leading-relaxed", status === "completed" && "text-[var(--muted)] line-through")}>
                {entry.content}
              </span>
              {entry.priority ? (
                <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-[var(--subtle)]">
                  {entry.priority}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NoticeCard({
  title,
  description,
  severity,
}: {
  title: string;
  description?: string;
  severity: string;
}) {
  const style =
    severity === "error"
      ? "border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] text-[var(--danger)]"
      : severity === "warning"
        ? "border-[color:color-mix(in_oklab,var(--warning)_35%,var(--border))] bg-[var(--warning-soft)] text-[var(--warning)]"
        : "border-[var(--border)] bg-[var(--chip)] text-[var(--muted)]";
  return (
    <div className={cn("flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-xs fade-in", style)}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <p className="m-0 font-semibold">{title}</p>
        {description ? <p className="m-0 mt-0.5 leading-relaxed opacity-90">{description}</p> : null}
      </div>
    </div>
  );
}

function PermissionCard({
  entry,
  disabled,
  onRespond,
}: {
  entry: Extract<AcpChatEntry, { kind: "permission" }>;
  disabled: boolean;
  onRespond: (optionId: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const respond = async (optionId: string | null) => {
    setBusy(true);
    try {
      onRespond(optionId);
    } finally {
      setBusy(false);
    }
  };
  if (entry.resolved) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--muted)] fade-in">
        <ShieldQuestion className="h-3.5 w-3.5" />
        Permission request answered — {entry.toolCall.title || entry.toolCall.name || "tool call"}
      </div>
    );
  }
  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklab,var(--warning)_45%,var(--border))] bg-[var(--warning-soft)] px-3 py-3 fade-in">
      <div className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold text-[var(--fg)]">
            Permission required: {entry.toolCall.title || entry.toolCall.name || "tool call"}
          </p>
          <p className="m-0 mt-0.5 text-[11px] text-[var(--warning)]">
            {entry.toolCall.kind ? `${entry.toolCall.kind} · ` : ""}
            {entry.toolCall.locations?.map((location) => location.path).join(", ") || "Review the options below."}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.options.map((option) => (
              <PermissionButton
                key={option.optionId}
                option={option}
                disabled={disabled || busy}
                onClick={() => void respond(option.optionId)}
              />
            ))}
            <Button
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              disabled={disabled || busy}
              onClick={() => void respond(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionButton({
  option,
  disabled,
  onClick,
}: {
  option: AcpPermissionOption;
  disabled: boolean;
  onClick: () => void;
}) {
  const allow = option.kind.startsWith("allow");
  return (
    <Button
      variant={allow ? "primary" : "outline"}
      className={cn("h-7 px-2 text-[11px]", !allow && "border-[color:color-mix(in_oklab,var(--danger)_30%,var(--border))]")}
      disabled={disabled}
      onClick={onClick}
      title={option.kind}
    >
      {allow ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {option.name}
    </Button>
  );
}

function ElicitationCard({
  requestId,
  request,
  resolved,
  disabled,
  onRespond,
}: {
  requestId: string;
  request: AcpElicitationRequest;
  resolved: boolean;
  disabled: boolean;
  onRespond: (response: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => defaultsFor(request));
  const [busy, setBusy] = useState(false);
  const mode = request.mode === "url" ? "url" : "form";

  if (resolved) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--muted)] fade-in">
        <Info className="h-3.5 w-3.5" /> Input request answered
      </div>
    );
  }

  const submit = (action: "accept" | "decline" | "cancel") => {
    setBusy(true);
    try {
      if (action === "accept") {
        onRespond({ action, content: coerceValues(values, request) });
      } else {
        onRespond({ action });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] px-3 py-3 fade-in">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--secondary)]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 whitespace-pre-wrap text-xs font-medium text-[var(--fg)]">{request.message}</p>
          {mode === "url" && request.url ? (
            <div className="mt-2 space-y-2">
              <p className="m-0 break-all rounded-[var(--radius-md)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[10px] text-[var(--muted)]">
                {request.url}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => window.open(request.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-3 w-3" /> Open link
                </Button>
                <Button className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => submit("accept")}>
                  <Check className="h-3 w-3" /> I&apos;ve completed this
                </Button>
                <Button variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => submit("decline")}>
                  Decline
                </Button>
                <Button variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => submit("cancel")}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <ElicitationFormFields
              request={request}
              values={values}
              onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
            />
          )}
          {mode !== "url" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button className="h-7 px-2 text-[11px]" disabled={disabled || busy} onClick={() => submit("accept")}>
                <Check className="h-3 w-3" /> Submit
              </Button>
              <Button variant="ghost" className="h-7 px-2 text-[11px]" disabled={disabled || busy} onClick={() => submit("decline")}>
                Decline
              </Button>
              <Button variant="ghost" className="h-7 px-2 text-[11px]" disabled={disabled || busy} onClick={() => submit("cancel")}>
                Cancel
              </Button>
            </div>
          )}
          <p className="m-0 mt-1.5 text-[9px] text-[var(--subtle)]">Request {requestId}</p>
        </div>
      </div>
    </div>
  );
}

function ElicitationFormFields({
  request,
  values,
  onChange,
}: {
  request: AcpElicitationRequest;
  values: Record<string, string | boolean>;
  onChange: (name: string, value: string | boolean) => void;
}) {
  const properties = getSchemaProperties(request);
  if (properties.length === 0) {
    return <p className="m-0 mt-2 text-[11px] text-[var(--muted)]">No fields were requested.</p>;
  }
  return (
    <div className="mt-2 space-y-2">
      {properties.map((property) => (
        <label key={property.name} className="block">
          <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-[var(--muted)]">
            {property.title || property.name}
            {property.required ? <span className="text-[var(--danger)]">*</span> : null}
          </span>
          {property.type === "boolean" ? (
            <input
              type="checkbox"
              checked={values[property.name] === true}
              onChange={(event) => onChange(property.name, event.target.checked)}
              className="h-4 w-4 accent-[var(--secondary)]"
            />
          ) : property.enumValues.length > 0 ? (
            <Select
              value={String(values[property.name] ?? "")}
              onChange={(event) => onChange(property.name, event.target.value)}
              className="h-8 py-0 text-xs"
            >
              <option value="">Select…</option>
              {property.enumValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          ) : (
            <TextInput
              type={property.type === "number" || property.type === "integer" ? "number" : "text"}
              value={String(values[property.name] ?? "")}
              onChange={(event) => onChange(property.name, event.target.value)}
              placeholder={property.description}
              className="h-8 py-0 text-xs"
            />
          )}
          {property.description && property.type !== "string" ? (
            <span className="mt-0.5 block text-[9px] text-[var(--subtle)]">{property.description}</span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

interface SchemaProperty {
  name: string;
  type: string;
  title?: string;
  description?: string;
  required: boolean;
  enumValues: string[];
  default?: unknown;
}

function getSchemaProperties(request: AcpElicitationRequest): SchemaProperty[] {
  const schema = request.requestedSchema;
  if (!schema || typeof schema !== "object") return [];
  const properties = (schema as { properties?: unknown }).properties;
  const required = new Set(
    Array.isArray((schema as { required?: unknown }).required)
      ? ((schema as { required: unknown[] }).required.filter((v): v is string => typeof v === "string"))
      : [],
  );
  if (!properties || typeof properties !== "object") return [];
  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
    const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      name,
      type: typeof rec.type === "string" ? rec.type : "string",
      title: typeof rec.title === "string" ? rec.title : undefined,
      description: typeof rec.description === "string" ? rec.description : undefined,
      required: required.has(name),
      enumValues: Array.isArray(rec.enum) ? rec.enum.filter((v): v is string => typeof v === "string") : [],
      default: rec.default,
    };
  });
}

function defaultsFor(request: AcpElicitationRequest): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const property of getSchemaProperties(request)) {
    if (typeof property.default === "boolean") out[property.name] = property.default;
    else if (property.default !== undefined && property.default !== null) out[property.name] = String(property.default);
    else if (property.type === "boolean") out[property.name] = false;
    else out[property.name] = "";
  }
  return out;
}

function coerceValues(
  values: Record<string, string | boolean>,
  request: AcpElicitationRequest,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const property of getSchemaProperties(request)) {
    const value = values[property.name];
    if (value === "" || value === undefined) continue;
    if (property.type === "number" || property.type === "integer") {
      const n = Number(value);
      if (Number.isFinite(n)) out[property.name] = property.type === "integer" ? Math.floor(n) : n;
    } else {
      out[property.name] = value;
    }
  }
  return out;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}
