import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Gauge,
  Loader2,
  MessagesSquare,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type {
  ChannelChat,
  ChannelChatMessage,
  ChannelConnection,
  ChannelKind,
  ChannelStatus,
} from "@/types";
import {
  AVAILABLE_CHANNELS,
  WHATSAPP_PLACEHOLDER,
  channelMeta,
  createChannel,
  deleteChannel,
  fetchChannelChatMessages,
  fetchChannelChats,
  fetchChannels,
  setChannelAgent,
  setChannelChatAgent,
  startChannelChat,
  updateChannel,
  type ChannelMeta,
} from "@/lib/channels";
import { MAIN_AGENT_ID } from "@/lib/customAgents";
import { Modal } from "@/components/ui/Modal";
import {
  catalogContextLimit,
  contextPercent,
  formatTokenCompact,
  formatTokenCount,
  resolveContextLimit,
} from "@/lib/contextMeter";
import {
  fetchChannelRawContext,
  type ChannelRawContext,
} from "@/lib/rawContext";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  Select,
  TextInput,
} from "@/components/ui/primitives";
import { cn } from "@/utils/cn";
import { timeAgo } from "@/utils/format";

const POLL_MS = 5_000;

const STATUS_STYLE: Record<ChannelStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-emerald-500/15 text-emerald-600" },
  connecting: { label: "Connecting", cls: "bg-amber-500/15 text-amber-600" },
  error: { label: "Error", cls: "bg-red-500/15 text-red-500" },
  disabled: { label: "Disabled", cls: "bg-[var(--chip)] text-[var(--muted)]" },
};

const KIND_ICON: Record<ChannelKind, string> = {
  telegram: "✈",
  discord: "◈",
  slack: "▤",
};

/**
 * Channels page.
 *
 * Connect Telegram / Discord / Slack bots once — users then chat with the SAME
 * agent runtime (Default or Custom Agent) from the messaging app. WhatsApp is a
 * coming-soon placeholder pointing at Telegram. Each card shows live status, the
 * agent serving new chats (switchable), and a dashboard of per-user chats with
 * full history, per-chat agent switching, and fresh-chat creation.
 */
export function ChannelsPanel() {
  const channelConnections = useStore((s) => s.channelConnections);
  const setChannelConnections = useStore((s) => s.setChannelConnections);
  const upsertChannelConnection = useStore((s) => s.upsertChannelConnection);
  const removeChannelConnection = useStore((s) => s.removeChannelConnection);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChannelConnection | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await fetchChannels();
      setChannelConnections(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setChannelConnections]);

  useEffect(() => {
    const controller = new AbortController();
    fetchChannels(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setChannelConnections(list);
        setError(null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError("Couldn't load channels.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const timer = setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [reload, setChannelConnections]);

  const toggle = async (channel: ChannelConnection) => {
    setBusyId(channel.id);
    try {
      const updated = await updateChannel(channel.id, { enabled: !channel.enabled });
      upsertChannelConnection(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await deleteChannel(id);
      removeChannelConnection(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return channelConnections;
    return channelConnections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.kind.includes(q) ||
        c.botName.toLowerCase().includes(q),
    );
  })();

  const connectedCount = channelConnections.filter((c) => c.status === "connected").length;

  return (
    <div className="mx-auto w-full max-w-3xl panel-in">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Chat from messaging apps" title="Channels" />
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" /> Connect channel
        </Button>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Connect a Telegram, Discord, or Slack bot once — users then chat with the same agent
        (Default or Custom) straight from the messaging app, with plans, files, and memory
        working exactly like the web app.
      </p>

      {/* WhatsApp placeholder */}
      <article
        className="mb-3 flex flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 opacity-90"
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--chip)] text-lg">
            ✆
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-base font-semibold text-[var(--fg)]">
                {WHATSAPP_PLACEHOLDER.name}
              </h3>
              <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">
                {WHATSAPP_PLACEHOLDER.headline}
              </span>
            </div>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
              {WHATSAPP_PLACEHOLDER.description}
            </p>
            <p className="m-0 mt-2 text-[13px] text-[var(--muted)]">
              {WHATSAPP_PLACEHOLDER.alternative}:{" "}
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="font-medium text-[var(--secondary)] hover:underline"
              >
                {WHATSAPP_PLACEHOLDER.alternativeLabel}
              </button>
            </p>
          </div>
        </div>
      </article>

      <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-[var(--subtle)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels…"
          aria-label="Search channels"
          className="w-full bg-transparent text-sm text-[var(--fg)] outline-none placeholder:text-[var(--subtle)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="text-[var(--subtle)] hover:text-[var(--fg)]"
          >
            ✕
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading channels…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<MessagesSquare className="h-8 w-8" />}>
          {channelConnections.length === 0
            ? "No channels connected yet. Connect a Telegram, Discord, or Slack bot to chat from messaging apps."
            : `No channels match “${query}”.`}
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0">
          {filtered.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              busy={busyId === channel.id}
              onToggle={() => void toggle(channel)}
              onEdit={() => setEditing(channel)}
              onDelete={() => setConfirmId(channel.id)}
            />
          ))}
        </ul>
      )}

      {!loading && (
        <p className="mt-4 text-xs text-[var(--subtle)]">
          {connectedCount} of {channelConnections.length} connected
          {connectedCount > 0 && " — connected channels serve the agent right now"}.
        </p>
      )}

      {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

      {formOpen && (
        <ChannelCreateModal
          onClose={() => setFormOpen(false)}
          onSaved={(channel) => {
            upsertChannelConnection(channel);
            setFormOpen(false);
          }}
        />
      )}

      {editing && (
        <ChannelEditModal
          channel={editing}
          onClose={() => setEditing(null)}
          onSaved={(channel) => {
            upsertChannelConnection(channel);
            setEditing(null);
          }}
        />
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Delete channel?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmId && void remove(confirmId)}
              disabled={busyId !== null}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          The connection, its per-user chats, and their transcripts are removed permanently.
          The bot stops responding immediately.
        </p>
      </Modal>
    </div>
  );
}

function ChannelCard({
  channel,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  channel: ChannelConnection;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const upsertChannelConnection = useStore((s) => s.upsertChannelConnection);
  const customAgents = useStore((s) => s.customAgents);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const style = STATUS_STYLE[channel.status];
  const connected = channel.status === "connected";
  const meta = channelMeta(channel.kind);

  const changeAgent = async (agentId: string | null) => {
    setAgentBusy(true);
    try {
      const updated = await setChannelAgent(channel.id, agentId);
      upsertChannelConnection(updated);
    } catch {
      // the poll refresh heals the select shortly
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    <li>
      <article
        className={cn(
          "flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5",
          connected && "ring-1 ring-[var(--secondary)]",
        )}
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-lg text-[var(--secondary-fg)]">
            {KIND_ICON[channel.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-base font-semibold text-[var(--fg)]">
              {channel.name}
            </h3>
            <p className="m-0 mt-0.5 text-[11px] text-[var(--subtle)]">
              {meta.name}
              {channel.botName ? ` · @${channel.botName}` : ""}
              {channel.chatCount > 0 &&
                ` · ${channel.chatCount} chat${channel.chatCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              style.cls,
            )}
          >
            {(channel.status === "connecting" || busy) && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {connected && <Check className="h-3 w-3" />}
            {style.label}
          </span>
        </div>

        {channel.lastError && (
          <p className="m-0 mt-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
            {channel.lastError}
          </p>
        )}

        {/* Agent serving new chats */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2">
          <span className="text-xs font-medium text-[var(--muted)]">Agent for new chats:</span>
          <select
            value={channel.activeAgentId ?? MAIN_AGENT_ID}
            disabled={agentBusy}
            onChange={(e) => {
              const v = e.target.value;
              void changeAgent(v === MAIN_AGENT_ID ? null : v);
            }}
            aria-label="Agent for new chats"
            className="min-w-0 flex-1 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--fg)] outline-none focus:border-[var(--secondary)] disabled:opacity-50"
          >
            <option value={MAIN_AGENT_ID}>Main Agent (default)</option>
            {customAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={channel.enabled}
            aria-label={channel.enabled ? "Disable channel" : "Enable channel"}
            onClick={onToggle}
            disabled={busy}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              channel.enabled ? "bg-[var(--secondary)]" : "bg-[var(--border)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                channel.enabled ? "translate-x-[18px]" : "translate-x-[3px]",
              )}
            />
          </button>
          <span className="text-xs text-[var(--muted)]">
            {channel.enabled ? "Enabled" : "Disabled"}
          </span>

          <span className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              onClick={() => setDashboardOpen((v) => !v)}
              className="px-3 py-1.5 text-xs"
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              {dashboardOpen ? "Hide chats" : "Chats"}
              {channel.chatCount > 0 ? ` (${channel.chatCount})` : ""}
            </Button>
            <button
              onClick={onEdit}
              title="Edit"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        </div>

        {dashboardOpen && <ChannelDashboard channelId={channel.id} />}
      </article>
    </li>
  );
}

/** Per-channel dashboard: per-user chats, history, agent switching, fresh chats. */
function ChannelDashboard({ channelId }: { channelId: string }) {
  const customAgents = useStore((s) => s.customAgents);
  const [chats, setChats] = useState<ChannelChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setChats(await fetchChannelChats(channelId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchChannelChats(channelId, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setChats(list);
        setError(null);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [channelId]);

  const switchChatAgent = async (chat: ChannelChat, agentId: string | null) => {
    try {
      await setChannelChatAgent(channelId, chat.chat_id, agentId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const newChat = async (userKey: string) => {
    try {
      await startChannelChat(channelId, userKey);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chats…
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <p className="m-0 mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3 text-center text-xs text-[var(--muted)]">
        No chats yet — users appear here once they message the bot.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2">
      <p className="m-0 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
        Chats · {chats.length} — currently active agent per chat, switchable below
      </p>
      {error && <p className="m-0 px-1 text-[11px] text-[var(--danger)]">{error}</p>}
      {chats.map((chat) => {
        const open = openChatId === chat.chat_id;
        return (
          <div
            key={chat.chat_id}
            className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]"
          >
            <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                onClick={() => setOpenChatId(open ? null : chat.chat_id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--fg)]">
                    {chat.user_label || chat.user_key}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--subtle)]">
                    {chat.title || "No title yet"} · {timeAgo(chat.updated_at)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-[var(--chip)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                  {chat.agent_name}
                </span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 text-[var(--muted)] transition-transform", open && "rotate-180")}
                />
              </button>
              <select
                value={chat.agent_id ?? MAIN_AGENT_ID}
                onChange={(e) => {
                  const v = e.target.value;
                  void switchChatAgent(chat, v === MAIN_AGENT_ID ? null : v);
                }}
                title="Agent serving this chat"
                aria-label={`Agent for ${chat.user_label || chat.user_key}`}
                className="max-w-[10rem] cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[10px] text-[var(--fg)] outline-none focus:border-[var(--secondary)]"
              >
                <option value={MAIN_AGENT_ID}>Main Agent</option>
                {customAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void newChat(chat.user_key)}
                title={`Start a fresh chat for ${chat.user_label || chat.user_key}`}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] hover:text-[var(--fg)]"
              >
                <Play className="h-2.5 w-2.5" /> New
              </button>
            </div>
            {open && <ChatHistory key={chat.chat_id} channelId={channelId} chat={chat} />}
          </div>
        );
      })}
    </div>
  );
}

/** Transcript view of one channel chat (user/assistant bubbles, tool traffic noted). */
function ChatHistory({ channelId, chat }: { channelId: string; chat: ChannelChat }) {
  const [messages, setMessages] = useState<ChannelChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchChannelChatMessages(channelId, chat.chat_id)
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, chat.chat_id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--chip)] px-3 py-3 text-[11px] text-[var(--muted)]">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
      </div>
    );
  }

  const visible = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && (m.text.trim() || m.has_tools),
  );

  return (
    <div className="border-t border-[var(--border)] bg-[var(--chip)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
          History · {visible.length} message{visible.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setContextOpen(true)}
          title="View this chat's context limit and raw context"
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-1 text-[10px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          <Gauge className="h-3 w-3" /> Context
        </button>
      </div>
      {contextOpen && (
        <ChannelContextModal channelId={channelId} chat={chat} onClose={() => setContextOpen(false)} />
      )}
      {visible.length === 0 ? (
        <p className="m-0 px-3 py-3 text-[11px] text-[var(--muted)]">No messages yet.</p>
      ) : (
        <ul className="m-0 max-h-72 list-none space-y-2 overflow-y-auto p-2.5 pt-0">
          {visible.map((m) => (
            <li
              key={m.seq}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap break-words rounded-[var(--radius-md)] px-2.5 py-1.5 text-[11px] leading-relaxed",
                  m.role === "user"
                    ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
                    : "border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)]",
                )}
              >
                {m.text.trim() || (m.has_tools ? "(tool activity)" : "…")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Channel chat context popup: limit (provider catalog wins, else the custom
 * user-added manual limit) + latest usage tokens + raw transcript/system prompt.
 * Usage is null until a turn reports (provider silent or no run yet) — the raw
 * transcript stays viewable regardless.
 */
function ChannelContextModal({
  channelId,
  chat,
  onClose,
}: {
  channelId: string;
  chat: ChannelChat;
  onClose: () => void;
}) {
  const models = useStore((s) => s.models);
  const modelsLoading = useStore((s) => s.modelsLoading);
  const settings = useStore((s) => s.settings);
  const [data, setData] = useState<ChannelRawContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChannelRawContext(channelId, chat.chat_id)
      .then((ctx) => {
        if (!cancelled) setData(ctx);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, chat.chat_id]);

  return (
    <Modal open onClose={onClose} title={`Context — ${chat.user_label || chat.user_key}`} size="lg">
      <ChannelContextBody
        data={data}
        loading={loading}
        error={error}
        copied={copied}
        setCopied={setCopied}
        models={models}
        modelsLoading={modelsLoading}
        settings={settings}
      />
    </Modal>
  );
}

function ChannelContextBody({
  data,
  loading,
  error,
  copied,
  setCopied,
  models,
  modelsLoading,
  settings,
}: {
  data: ChannelRawContext | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  setCopied: (v: boolean) => void;
  models: { provider: string; id: string; context_window?: number | null }[];
  modelsLoading: boolean;
  settings: { provider: string; model: string; manualContextLimits?: Record<string, number> };
}) {
  const { limit, source } = resolveContextLimit(
    models,
    settings.provider,
    settings.model,
    settings.manualContextLimits,
  );
  const catalogLimit = catalogContextLimit(models, settings.provider, settings.model);
  const needsManual =
    settings.model.trim().length > 0 && !modelsLoading && catalogLimit === null;

  const promptTokens = useMemo(() => {
    try {
      const u = data?.usage as Record<string, unknown> | null | undefined;
      const n = typeof u?.prompt_tokens === "number" ? u.prompt_tokens : Number(u?.prompt_tokens);
      return Number.isFinite(n) && (n as number) >= 0 ? Math.floor(n as number) : null;
    } catch {
      return null;
    }
  }, [data]);

  const pct = promptTokens !== null ? contextPercent(promptTokens, limit) : null;
  const rawText = useMemo(() => {
    if (!data) return "";
    try {
      return JSON.stringify(
        {
          chatId: data.chatId,
          channelId: data.channelId,
          agent: data.agentName,
          source: data.source,
          systemPromptSource: data.systemPromptSource,
          systemPrompt: data.systemPrompt,
          messageCount: data.messageCount,
          messages: data.messages,
          usage: data.usage ?? null,
        },
        null,
        2,
      );
    } catch {
      return "{}";
    }
  }, [data]);

  const copy = async () => {
    if (!rawText) return;
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return <p className="m-0 p-5 text-sm text-[var(--muted)]">Loading this chat's context…</p>;
  }
  if (error) {
    return <p className="m-0 p-5 text-sm text-[var(--danger)]">{error}</p>;
  }
  if (!data) {
    return <p className="m-0 p-5 text-sm text-[var(--muted)]">No context available.</p>;
  }
  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-[var(--secondary)]" />
        <h3 className="m-0 text-sm font-semibold">Context usage</h3>
        <span className="ml-auto max-w-[10rem] truncate rounded-full bg-[var(--chip)] px-2.5 py-0.5 text-[10px] text-[var(--muted)]">
          {data.agentName}
        </span>
      </div>
      {promptTokens !== null ? (
        <>
          <p className="m-0 text-2xl font-semibold tabular-nums">
            {formatTokenCount(promptTokens)} <span className="text-sm font-normal text-[var(--muted)]">tokens</span>
          </p>
          {pct !== null && limit != null ? (
            <>
              <p className="m-0 text-xs tabular-nums text-[var(--muted)]">
                of {formatTokenCount(limit)} ({pct}%){source === "manual" ? " · manual" : ""}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]">
                <div
                  className={cn(
                    "h-full rounded-full",
                    pct >= 90 ? "bg-[var(--danger)]" : pct >= 70 ? "bg-[var(--warning)]" : "bg-[var(--secondary)]",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
            </>
          ) : needsManual ? (
            <p className="m-0 text-xs text-[var(--warning)]">
              No context limit published for this model — enter it in Settings to show a percentage.
            </p>
          ) : (
            <p className="m-0 text-xs text-[var(--subtle)]">
              {formatTokenCompact(promptTokens)} tokens · limit unknown — showing tokens only.
            </p>
          )}
        </>
      ) : (
        <p className="m-0 text-xs leading-relaxed text-[var(--muted)]">
          No usage reported yet — it appears after this chat's next reply. The raw transcript below
          is still viewable.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full bg-[var(--chip)] px-2.5 py-0.5 text-[var(--muted)]">Source: {data.source}</span>
        <span className="rounded-full bg-[var(--chip)] px-2.5 py-0.5 text-[var(--muted)]">
          {data.messageCount} message{data.messageCount === 1 ? "" : "s"}
        </span>
        <span className="rounded-full bg-[var(--chip)] px-2.5 py-0.5 text-[var(--muted)]">
          System prompt: {data.systemPromptSource}
        </span>
      </div>
      <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[11px] leading-relaxed">
        {rawText}
      </pre>
      <div className="flex justify-end gap-2">
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
      </div>
      <p className="m-0 text-[11px] text-[var(--subtle)]">
        Raw provider-format inputs (system prompt + transcript + latest usage), exactly as stored.
      </p>
    </div>
  );
}

function ChannelCreateModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (channel: ChannelConnection) => void;
}) {
  const [kind, setKind] = useState<ChannelKind>("telegram");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta: ChannelMeta = channelMeta(kind);

  const save = async () => {
    if (!token.trim()) {
      setError("A bot token is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const channel = await createChannel({
        kind,
        name: name.trim() || undefined,
        token: token.trim(),
      });
      onSaved(channel);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={<MessagesSquare className="h-4 w-4" />}
      title="Connect channel"
      size="md"
      footer={
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Verifying…" : "Connect"}
        </Button>
      }
    >
      <div className="space-y-4 p-5">
        <Field label="Channel">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ChannelKind)}>
            {AVAILABLE_CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.description}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 text-xs leading-relaxed text-[var(--muted)]">
          <p className="m-0 font-medium text-[var(--fg)]">Setup: {meta.name}</p>
          <p className="m-0 mt-1">{meta.setup}</p>
          <p className="m-0 mt-1 text-[var(--subtle)]">{meta.addressing}</p>
        </div>
        <Field label="Connection name (optional)">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. My ${meta.name} bot`}
          />
        </Field>
        <Field
          label={kind === "slack" ? "Bot User OAuth Token (xoxb-…)" : "Bot token"}
          hint="stored server-side only"
        >
          <TextInput
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={kind === "slack" ? "xoxb-…" : "Paste the bot token"}
            className="font-mono text-xs"
          />
        </Field>
        {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

function ChannelEditModal({
  channel,
  onClose,
  onSaved,
}: {
  channel: ChannelConnection;
  onClose: () => void;
  onSaved: (channel: ChannelConnection) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateChannel(channel.id, {
        name: name.trim() || undefined,
        token: token.trim() || undefined,
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={<Pencil className="h-4 w-4" />}
      title={`Edit — ${channel.name}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <Field label="Connection name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Replace bot token (optional)" hint="leave empty to keep the stored token">
          <TextInput
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste a new token to replace the stored one"
            className="font-mono text-xs"
          />
        </Field>
        {channel.botName && (
          <p className="m-0 text-xs text-[var(--muted)]">
            Bot: <span className="font-mono">@{channel.botName}</span>
            {channel.botId ? ` (${channel.botId})` : ""}
          </p>
        )}
        {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}
