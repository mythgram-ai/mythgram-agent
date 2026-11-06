import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  MessageSquare,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react";
import { Button, EmptyState, PanelHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { AcpChat } from "@/components/acp-client/AcpChat";
import { AcpConfigModal } from "@/components/acp-client/AcpConfigModal";
import { AcpClientIcon } from "@/components/icons/NavIcons";
import {
  authenticateAcpClient,
  cancelAcpSession,
  connectAcpClient,
  createAcpSession,
  deleteAcpClient,
  deleteAcpSession,
  disconnectAcpClient,
  fetchAcpClients,
  fetchAcpSession,
  fetchAcpSessions,
  openAcpPrompt,
  parseAcpSse,
  respondAcpElicitation,
  respondAcpPermission,
  setAcpSessionConfig,
  setAcpSessionMode,
  type AcpClient,
  type AcpClientStatus,
  type AcpSession,
  type AcpSessionDetail,
  type AcpSessionUpdate,
  type AcpStoredEvent,
} from "@/lib/acpClient";
import { metaFromUpdate } from "@/lib/acpChat";
import { cn } from "@/utils/cn";

/**
 * ACP client panel — configure and chat with external ACP-compatible agents.
 *
 * Each configured agent gets its own 20-digit numeric id. Each chat session also
 * gets a 20-digit numeric id minted by Mythgram; the connected agent's internal
 * session id stays private. The panel streams assistant text, reasoning, tool
 * calls, plans, usage, modes/config options, and inline permission/elicitation
 * requests from the agent.
 */
export function AcpClientPanel() {
  const [clients, setClients] = useState<AcpClient[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AcpSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<AcpSessionDetail | null>(null);
  const [events, setEvents] = useState<AcpStoredEvent[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AcpClient | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [confirmClient, setConfirmClient] = useState<AcpClient | null>(null);
  const [confirmSession, setConfirmSession] = useState<AcpSession | null>(null);

  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;

  const upsertClient = useCallback((next: AcpClient) => {
    setClients((prev) => {
      const index = prev.findIndex((client) => client.id === next.id);
      if (index === -1) return [...prev, next];
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });
  }, []);

  const reloadClients = useCallback(async () => {
    try {
      const payload = await fetchAcpClients();
      setClients(payload.clients);
      setWorkspace(payload.workspace);
      setError(null);
      setSelectedClientId((current) => {
        if (current && payload.clients.some((client) => client.id === current)) return current;
        return payload.clients[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void reloadClients();
  }, [reloadClients]);

  const loadSession = useCallback(async (clientId: string, sessionId: string) => {
    setSessionsLoading(true);
    setChatError(null);
    try {
      const detail = await fetchAcpSession(clientId, sessionId);
      setSession(detail);
      setEvents(detail.events);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
      setSession(null);
      setEvents([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(
    async (clientId: string) => {
      try {
        const list = await fetchAcpSessions(clientId);
        setSessions(list);
        return list;
      } catch (e) {
        setChatError(e instanceof Error ? e.message : String(e));
        return [];
      }
    },
    [],
  );

  // Selecting an agent loads its sessions and opens the most recent one.
  useEffect(() => {
    if (!selectedClientId) {
      // oxlint-disable-next-line react/set-state-in-effect
      setSessions([]);
      setSelectedSessionId(null);
      setSession(null);
      setEvents([]);
      return;
    }
    let active = true;
    setSessionsLoading(true);
    void (async () => {
      try {
        const list = await fetchAcpSessions(selectedClientId);
        if (!active) return;
        setSessions(list);
        const next = list[0] ?? null;
        setSelectedSessionId(next?.id ?? null);
        if (next) {
          const detail = await fetchAcpSession(selectedClientId, next.id);
          if (!active) return;
          setSession(detail);
          setEvents(detail.events);
        } else {
          setSession(null);
          setEvents([]);
        }
      } catch (e) {
        if (active) setChatError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setSessionsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedClientId]);

  const selectClient = (id: string) => {
    if (id === selectedClientId) return;
    if (sending) return;
    setSelectedClientId(id);
    setQuery("");
  };

  const selectSession = (sessionId: string) => {
    if (!selectedClientId || sessionId === selectedSessionId) return;
    if (sending) return;
    setSelectedSessionId(sessionId);
    void loadSession(selectedClientId, sessionId);
  };

  const connectAgent = async (client: AcpClient) => {
    setBusyId(client.id);
    setError(null);
    try {
      const connected = await connectAcpClient(client.id);
      upsertClient(connected);
      if (connected.error) setError(connected.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void reloadClients();
    } finally {
      setBusyId(null);
    }
  };

  const disconnectAgent = async (client: AcpClient) => {
    setBusyId(client.id);
    setError(null);
    try {
      const disconnected = await disconnectAcpClient(client.id);
      upsertClient(disconnected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const authenticateAgent = async (client: AcpClient, methodId: string) => {
    setBusyId(client.id);
    setError(null);
    try {
      const next = await authenticateAcpClient(client.id, methodId);
      upsertClient(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const newSession = async () => {
    if (!selectedClient) return;
    setBusyId(selectedClient.id);
    setChatError(null);
    try {
      const created = await createAcpSession(selectedClient.id);
      setSessions((prev) => [created, ...prev]);
      setSelectedSessionId(created.id);
      setSession({ ...created, events: [] });
      setEvents([]);
      upsertClient({ ...selectedClient, sessions: selectedClient.sessions + 1 });
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const removeSession = async () => {
    if (!selectedClient || !confirmSession) return;
    const target = confirmSession;
    setConfirmSession(null);
    setBusyId(selectedClient.id);
    try {
      await deleteAcpSession(selectedClient.id, target.id);
      const remaining = sessions.filter((item) => item.id !== target.id);
      setSessions(remaining);
      if (selectedSessionId === target.id) {
        const next = remaining[0] ?? null;
        setSelectedSessionId(next?.id ?? null);
        if (next) void loadSession(selectedClient.id, next.id);
        else {
          setSession(null);
          setEvents([]);
        }
      }
      upsertClient({ ...selectedClient, sessions: Math.max(0, selectedClient.sessions - 1) });
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const removeAgent = async () => {
    if (!confirmClient) return;
    const target = confirmClient;
    setConfirmClient(null);
    setBusyId(target.id);
    try {
      await deleteAcpClient(target.id);
      const remaining = clients.filter((item) => item.id !== target.id);
      setClients(remaining);
      if (selectedClientId === target.id) {
        setSelectedClientId(remaining[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onSaved = async (saved: AcpClient) => {
    upsertClient(saved);
    setSelectedClientId(saved.id);
    setFormOpen(false);
    setEditing(null);
    setError(null);
    if (!saved.enabled) return;
    // Auto-connect after saving so the user immediately sees status/capabilities.
    try {
      const connected = await connectAcpClient(saved.id);
      upsertClient(connected);
      if (connected.error) setError(connected.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const appendEvent = useCallback((event: string, data: Record<string, unknown>) => {
    setEvents((prev) => [
      ...prev,
      {
        seq: prev.length,
        event,
        data,
        createdAt: Date.now(),
      },
    ]);
  }, []);

  const applySessionEvent = useCallback((event: string, data: Record<string, unknown>) => {
    if (event === "update") {
      const update = data.update as AcpSessionUpdate | undefined;
      if (!update) return;
      setSession((prev) => {
        if (!prev) return prev;
        const known = metaFromUpdate(update, {
          title: prev.title,
          currentModeId: prev.meta.modes?.currentModeId,
          configOptions: prev.meta.configOptions,
          usage: prev.meta.usage,
          commands: prev.meta.commands,
        });
        return {
          ...prev,
          title: known.title ?? prev.title,
          running: true,
          status: "running",
          meta: {
            ...prev.meta,
            modes:
              known.currentModeId && prev.meta.modes
                ? { ...prev.meta.modes, currentModeId: known.currentModeId }
                : prev.meta.modes,
            configOptions:
              (known.configOptions as typeof prev.meta.configOptions) ?? prev.meta.configOptions,
            usage: (known.usage as typeof prev.meta.usage) ?? prev.meta.usage,
            commands: (known.commands as typeof prev.meta.commands) ?? prev.meta.commands,
          },
        };
      });
      return;
    }
    if (event === "user") {
      setSession((prev) => (prev ? { ...prev, running: true, status: "running" } : prev));
      return;
    }
    if (event === "status") {
      const status = typeof data.status === "string" ? data.status : "active";
      setSession((prev) => (prev ? { ...prev, status, running: status === "running" } : prev));
      return;
    }
    if (event === "done") {
      setSession((prev) => (prev ? { ...prev, running: false, status: "active" } : prev));
      return;
    }
    if (event === "error") {
      setSession((prev) => (prev ? { ...prev, running: false, status: "error" } : prev));
      return;
    }
    if (event === "permission_request" || event === "elicitation_request") {
      setSession((prev) => (prev ? { ...prev, running: true, status: "running" } : prev));
    }
  }, []);

  const send = async (text: string) => {
    if (!selectedClient || !selectedSessionId || sending) return;
    setSending(true);
    setChatError(null);
    setSession((prev) => (prev ? { ...prev, running: true, status: "running" } : prev));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await openAcpPrompt(selectedClient.id, selectedSessionId, text, controller.signal);
      await parseAcpSse(
        response,
        (event, data) => {
          appendEvent(event, data);
          applySessionEvent(event, data);
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setChatError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      setSession((prev) => (prev ? { ...prev, running: false, status: prev.status === "error" ? "error" : "active" } : prev));
      const list = await refreshSessions(selectedClient.id);
      if (list.length > 0) {
        setSessions(list);
        const current = list.find((item) => item.id === selectedSessionId);
        if (current) {
          setSession((prev) => (prev ? { ...prev, title: current.title, updatedAt: current.updatedAt } : prev));
        }
      }
    }
  };

  const stop = () => {
    if (!selectedClient || !selectedSessionId) return;
    abortRef.current?.abort();
    void cancelAcpSession(selectedClient.id, selectedSessionId).catch(() => undefined);
    setSending(false);
    setSession((prev) => (prev ? { ...prev, running: false } : prev));
  };

  const changeMode = async (modeId: string) => {
    if (!selectedClient || !selectedSessionId) return;
    try {
      const next = await setAcpSessionMode(selectedClient.id, selectedSessionId, modeId);
      setSession((prev) => (prev ? { ...prev, meta: next.meta } : prev));
      setSessions((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    }
  };

  const changeConfig = async (configId: string, value: string | boolean) => {
    if (!selectedClient || !selectedSessionId) return;
    try {
      const next = await setAcpSessionConfig(selectedClient.id, selectedSessionId, configId, value);
      setSession((prev) => (prev ? { ...prev, meta: next.meta } : prev));
      setSessions((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    }
  };

  const respondPermission = async (requestId: string, optionId: string | null) => {
    if (!selectedClient || !selectedSessionId) return;
    try {
      await respondAcpPermission(selectedClient.id, selectedSessionId, requestId, optionId);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    }
  };

  const respondElicitation = async (
    requestId: string,
    response: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
  ) => {
    if (!selectedClient || !selectedSessionId) return;
    try {
      await respondAcpElicitation(selectedClient.id, selectedSessionId, requestId, response);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(q) ||
        client.id.includes(q) ||
        client.command.toLowerCase().includes(q),
    );
  }, [clients, query]);

  const connectedCount = clients.filter((client) => client.status === "connected").length;

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.5rem)] min-h-[580px] w-full max-w-[1500px] flex-col gap-4 panel-in max-lg:h-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <PanelHeader kicker="External agents" title="ACP client" />
          <p className="mb-0 mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Connect any Agent Client Protocol agent — Claude Agent, Codex, Gemini CLI, OpenCode,
            Goose and more — then chat with it here. Each connected agent gets its own 20-digit id.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setGuideOpen(true)}>
            <BookOpen className="h-4 w-4" /> Guide
          </Button>
          <Button
            variant="outline"
            onClick={() => void reloadClients()}
            disabled={loading}
            title="Refresh agents"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add ACP agent
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
              <AcpClientIcon className="h-4 w-6" />
              {clients.length} agent{clients.length === 1 ? "" : "s"} · {connectedCount} connected
            </div>
            {clients.length > 3 && (
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search…"
                className="w-28 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--secondary)]"
              />
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
            {loading && clients.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] py-10 text-xs text-[var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agents…
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<AcpClientIcon className="h-8 w-16" />}>
                {clients.length === 0
                  ? "No ACP agents yet. Add one and enter its command + args."
                  : `No agents match “${query}”.`}
              </EmptyState>
            ) : (
              filtered.map((client) => (
                <AgentCard
                  key={client.id}
                  client={client}
                  selected={client.id === selectedClientId}
                  busy={busyId === client.id}
                  onSelect={() => selectClient(client.id)}
                  onConnect={() => void connectAgent(client)}
                  onDisconnect={() => void disconnectAgent(client)}
                  onAuthenticate={(methodId) => void authenticateAgent(client, methodId)}
                  onEdit={() => {
                    setEditing(client);
                    setFormOpen(true);
                  }}
                  onDelete={() => setConfirmClient(client)}
                />
              ))
            )}
          </div>

          <CompactGuide
            onOpenGuide={() => setGuideOpen(true)}
            onAdd={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          {selectedClient ? (
            sessionsLoading && !session ? (
              <div className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading session…
              </div>
            ) : (
              <AcpChat
                client={selectedClient}
                session={session}
                sessions={sessions}
                events={events}
                sending={sending}
                error={chatError}
                onSend={(text) => void send(text)}
                onStop={stop}
                onNewSession={() => void newSession()}
                onSelectSession={selectSession}
                onDeleteSession={(sessionId) => {
                  const target = sessions.find((item) => item.id === sessionId);
                  if (target) setConfirmSession(target);
                }}
                onModeChange={(modeId) => void changeMode(modeId)}
                onConfigChange={(configId, value) => void changeConfig(configId, value)}
                onPermission={(requestId, optionId) => void respondPermission(requestId, optionId)}
                onElicitation={(requestId, response) => void respondElicitation(requestId, response)}
              />
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] bg-[var(--bg)] px-6 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--chip)] text-[var(--muted)]">
                <MessageSquare className="h-7 w-7" />
              </span>
              <div>
                <p className="m-0 text-base font-semibold text-[var(--fg)]">Connect an ACP agent</p>
                <p className="m-0 mt-1 max-w-md text-sm leading-relaxed text-[var(--muted)]">
                  Add a compatible agent with its launch command and args. Mythgram starts it,
                  negotiates ACP capabilities and gives you a streaming chat with permissions.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add agent
                </Button>
                <Button variant="outline" onClick={() => setGuideOpen(true)}>
                  <BookOpen className="h-4 w-4" /> Read the guide
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AcpConfigModal
        open={formOpen}
        client={editing}
        workspace={workspace}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={(saved) => void onSaved(saved)}
      />

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        icon={<BookOpen className="h-4 w-4" />}
        title="Connect an ACP-compatible agent"
        size="lg"
        align="top"
        footer={
          <Button onClick={() => setGuideOpen(false)}>
            <Check className="h-4 w-4" /> Got it
          </Button>
        }
      >
        <GuideContent />
      </Modal>

      <Modal
        open={confirmClient !== null}
        onClose={() => setConfirmClient(null)}
        icon={<Unplug className="h-4 w-4" />}
        title="Delete ACP agent?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClient(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void removeAgent()} disabled={busyId !== null}>
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          The agent process is stopped and its saved configuration and chat sessions are deleted.
          You can add it again later.
        </p>
      </Modal>

      <Modal
        open={confirmSession !== null}
        onClose={() => setConfirmSession(null)}
        icon={<Trash2 className="h-4 w-4" />}
        title="Delete session?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSession(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void removeSession()} disabled={busyId !== null}>
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          This deletes the saved transcript and asks the agent to close the session when supported.
        </p>
      </Modal>
    </div>
  );
}

function AgentCard({
  client,
  selected,
  busy,
  onSelect,
  onConnect,
  onDisconnect,
  onAuthenticate,
  onEdit,
  onDelete,
}: {
  client: AcpClient;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAuthenticate: (methodId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const connected = client.status === "connected";
  const connecting = client.status === "connecting" || busy;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(client.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <article
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--bg)] p-3 transition-colors",
        selected
          ? "border-[var(--secondary)] ring-1 ring-[var(--secondary)]"
          : "border-[var(--border)] hover:border-[color:color-mix(in_oklab,var(--secondary)_45%,var(--border))]",
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2 text-left">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)]",
            connected ? "bg-[var(--secondary)] text-[var(--secondary-fg)]" : "bg-[var(--chip)] text-[var(--muted)]",
          )}
        >
          <AcpClientIcon className="h-5 w-8" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-[var(--fg)]">{client.name}</span>
            <StatusDot status={client.status} />
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--subtle)]">
            <span className="font-mono">{client.id}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                void copyId();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  void copyId();
                }
              }}
              className="rounded p-0.5 hover:bg-[var(--chip)] hover:text-[var(--fg)]"
              title="Copy agent id"
            >
              {copied ? <Check className="h-2.5 w-2.5 text-[var(--success)]" /> : <Copy className="h-2.5 w-2.5" />}
            </span>
          </span>
          <span className="mt-1 block truncate font-mono text-[10px] text-[var(--muted)]">
            {client.command} {client.args.join(" ")}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--subtle)]">
            <span className={cn("rounded-full px-1.5 py-0.5", statusClass(client.status))}>
              {connecting ? "connecting" : client.status}
            </span>
            <span>{client.sessions} session{client.sessions === 1 ? "" : "s"}</span>
            {client.agent ? (
              <span className="truncate">{client.agent.title || client.agent.name} v{client.agent.version}</span>
            ) : null}
          </span>
        </span>
      </button>

      {client.error && (
        <p className="m-0 mt-2 line-clamp-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--danger)]">
          {client.error}
        </p>
      )}

      {showLogs && client.stderr.length > 0 && (
        <pre className="m-0 mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--chip)] p-2 font-mono text-[9px] leading-relaxed text-[var(--muted)]">
          {client.stderr.slice(-10).join("\n")}
        </pre>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {connected ? (
          <Button variant="outline" className="h-7 px-2 text-[11px]" onClick={onDisconnect} disabled={busy}>
            <Unplug className="h-3 w-3" /> Disconnect
          </Button>
        ) : (
          <Button className="h-7 px-2 text-[11px]" onClick={onConnect} disabled={busy}>
            {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
            Connect
          </Button>
        )}
        <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={onEdit} disabled={busy}>
          <Pencil className="h-3 w-3" /> Edit
        </Button>
        <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={onDelete} disabled={busy}>
          <Trash2 className="h-3 w-3" />
        </Button>
        {client.authMethods.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
          >
            <KeyRound className="h-3 w-3" /> Auth
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", showDetails && "rotate-180")} />
          </button>
        )}
        {client.stderr.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLogs((value) => !value)}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
          >
            <Terminal className="h-3 w-3" /> Logs
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", showLogs && "rotate-180")} />
          </button>
        )}
      </div>

      {showDetails && client.authMethods.length > 0 && (
        <div className="mt-2 space-y-1 rounded-[var(--radius-md)] border border-[var(--border)] p-2">
          <p className="m-0 px-1 text-[10px] uppercase tracking-wide text-[var(--subtle)]">
            Authentication methods
          </p>
          {client.authMethods.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => onAuthenticate(method.id)}
              disabled={busy}
              className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left hover:bg-[var(--chip)] disabled:opacity-50"
              title={method.description}
            >
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted)]" />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-[var(--fg)]">{method.name}</span>
                <span className="block truncate text-[9px] text-[var(--subtle)]">
                  {method.type === "terminal" ? "terminal login · run it in your terminal first" : method.description || "agent login"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function StatusDot({ status }: { status: AcpClientStatus }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "connected"
          ? "bg-[var(--success)]"
          : status === "connecting"
            ? "animate-pulse bg-[var(--warning)]"
            : status === "error"
              ? "bg-[var(--danger)]"
              : "bg-[var(--subtle)]",
      )}
      title={status}
    />
  );
}

function statusClass(status: AcpClientStatus): string {
  return status === "connected"
    ? "bg-[var(--success-soft)] text-[var(--success)]"
    : status === "connecting"
      ? "bg-[var(--warning-soft)] text-[var(--warning)]"
      : status === "error"
        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
        : "bg-[var(--chip)] text-[var(--muted)]";
}

function CompactGuide({ onOpenGuide, onAdd }: { onOpenGuide: () => void; onAdd: () => void }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fg)]">
        <BookOpen className="h-3.5 w-3.5" /> Quick start
      </div>
      <ol className="m-0 mt-2 space-y-1.5 p-0 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">
        <li>Add an agent with its name, command and args.</li>
        <li>Install the agent CLI or adapter it needs first.</li>
        <li>Connect, create a session, and start chatting.</li>
        <li>Approve tool permissions inline when asked.</li>
      </ol>
      <div className="mt-2 flex gap-1.5">
        <Button variant="outline" className="h-7 px-2 text-[11px]" onClick={onOpenGuide}>
          Full guide
        </Button>
        <Button className="h-7 px-2 text-[11px]" onClick={onAdd}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
    </section>
  );
}

function GuideContent() {
  return (
    <div className="space-y-4 p-5 text-sm leading-relaxed text-[var(--muted)]">
      <ol className="m-0 space-y-3 p-0 pl-5">
        <li>
          <span className="font-semibold text-[var(--fg)]">Install an ACP-compatible agent.</span>{" "}
          Most agents ship as an npm adapter or a binary. Mythgram does not install them for you.
        </li>
        <li>
          <span className="font-semibold text-[var(--fg)]">Add it here.</span> Open{" "}
          <span className="text-[var(--fg)]">Add ACP agent</span>, pick a preset or enter a custom
          name, command and args (one argument per line), then optionally test it.
        </li>
        <li>
          <span className="font-semibold text-[var(--fg)]">Connect.</span> Mythgram spawns the
          process over stdio, performs the ACP <code>initialize</code> handshake, and shows the
          negotiated protocol version, capabilities and auth methods.
        </li>
        <li>
          <span className="font-semibold text-[var(--fg)]">Create a session.</span> The session id
          you see is generated by Mythgram (20 digits). The agent&apos;s own session id is kept
          private.
        </li>
        <li>
          <span className="font-semibold text-[var(--fg)]">Chat and approve.</span> Streaming text,
          reasoning, tool calls, plans, permission prompts and forms appear in the chat. Use Stop to
          cancel; the client sends <code>session/cancel</code>.
        </li>
      </ol>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3">
        <p className="m-0 text-xs font-semibold text-[var(--fg)]">Example launch commands</p>
        <div className="mt-2 space-y-1.5 font-mono text-[11px] text-[var(--muted)]">
          <p className="m-0">npx -y @agentclientprotocol/claude-agent-acp</p>
          <p className="m-0">npx -y @agentclientprotocol/codex-acp</p>
          <p className="m-0">npx -y @google/gemini-cli --acp</p>
          <p className="m-0">opencode acp</p>
          <p className="m-0">goose acp</p>
        </div>
        <p className="m-0 mt-2 text-[10px] text-[var(--subtle)]">
          Any agent that speaks ACP v1 over stdio works — the command is not limited to this list.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <InfoBox title="Authentication">
          Agent-handled auth methods appear on the agent card. Terminal auth must be completed by
          running the agent&apos;s login command in an interactive terminal, then reconnecting.
        </InfoBox>
        <InfoBox title="Workspace & safety">
          File and terminal requests are restricted to the agent&apos;s working directory and the
          Mythgram workspace. Agents still ask for permission before sensitive tool calls.
        </InfoBox>
        <InfoBox title="Protocol support">
          The client implements ACP v1 initialization, sessions, prompts, cancellation, file system
          access, terminals, permissions, elicitation, modes and config options.
        </InfoBox>
        <InfoBox title="Troubleshooting">
          If connect fails, open the agent card to see stderr. Common causes: the CLI is not
          installed, the command needs a different args order, or the agent requires login first.
        </InfoBox>
      </div>
    </div>
  );
}

function InfoBox({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3">
      <p className="m-0 text-xs font-semibold text-[var(--fg)]">{title}</p>
      <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{children}</p>
    </div>
  );
}