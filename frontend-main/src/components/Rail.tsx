import { useRef, useState } from "react";
import { MessageCircle, Brain, Library, Bot, Sparkles, Users, Boxes, FileText, Crown, ListChecks, CalendarClock, Plug, Server, MessagesSquare, Search, ChevronsLeft, ChevronsRight, Bookmark, WandSparkles, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { useStore, type Section } from "@/store/useStore";
import { findActiveProfile, isUsableAvatar, profileInitials } from "@/lib/userProfiles";
import { cn } from "@/utils/cn";

const NAV: Array<{ id: Section; label: string; Icon: typeof MessageCircle }> = [
  { id: "chat", label: "Chat history", Icon: MessageCircle },
  { id: "customagents", label: "Custom agents", Icon: Boxes },
  { id: "systemprompts", label: "Custom system prompts", Icon: FileText },
  { id: "taskmodes", label: "Task modes", Icon: ListChecks },
  { id: "prompts", label: "Prompt library", Icon: Bookmark },
  { id: "promptagent", label: "Prompt agent", Icon: WandSparkles },
  { id: "schedules", label: "Schedules", Icon: CalendarClock },
  { id: "memory", label: "Memory", Icon: Brain },
  { id: "knowledge", label: "Knowledge base", Icon: Library },
  { id: "agents", label: "Sub-agents", Icon: Bot },
  { id: "skills", label: "Skills", Icon: Sparkles },
  { id: "teams", label: "Agent teams", Icon: Users },
  { id: "ceo", label: "CEO agents", Icon: Crown },
  { id: "connectors", label: "Connectors", Icon: Plug },
  { id: "mcp", label: "MCP servers", Icon: Server },
  { id: "channels", label: "Channels", Icon: MessagesSquare },
  { id: "tts", label: "Text to speech", Icon: Volume2 },
];

const EXPANDED_WIDTH = "13.5rem";

export function Rail() {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const agentMode = useStore((s) => s.agentMode);
  const setAgentMode = useStore((s) => s.setAgentMode);
  const userProfiles = useStore((s) => s.userProfiles);
  const activeUserProfileId = useStore((s) => s.activeUserProfileId);
  const activeProfile = findActiveProfile(userProfiles, activeUserProfileId);
  const showAvatar = isUsableAvatar(activeProfile.avatar);
  const profilesActive = section === "profiles";
  const [expanded, setExpanded] = useState(false);
  const touchX = useRef<number | null>(null);

  const open = () => setExpanded(true);
  const toggle = () => setExpanded((v) => !v);

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--rail)] transition-[width] duration-200"
      style={{ width: expanded ? EXPANDED_WIDTH : "var(--rail-w)" }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null) return;
        const end = e.changedTouches[0]?.clientX ?? start;
        const dx = end - start;
        if (!expanded && dx > 40) open();
        else if (expanded && dx < -40) setExpanded(false);
      }}
    >
      <div className={cn("flex flex-col pt-4", expanded ? "items-stretch px-2" : "items-center")}>
        <div
          className={cn("flex items-center gap-2", expanded ? "px-1" : "justify-center")}
          aria-hidden
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          {expanded && (
            <span className="truncate text-sm font-semibold text-[var(--fg)]">Haku</span>
          )}
        </div>

        <div className="mt-3 w-full">
          <div
            className={cn(
              "gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-1",
              expanded ? "flex flex-row" : "flex flex-col",
            )}
            role="group"
            aria-label="Conversation mode"
          >
            <ModeButton
              active={agentMode === "chat"}
              onClick={() => setAgentMode("chat")}
              title="Chat mode — talk to the LLM (memory, knowledge, web only)"
              label="Chat"
              expanded={expanded}
            >
              <MessageCircle className="h-4 w-4" strokeWidth={1.9} />
            </ModeButton>
            <ModeButton
              active={agentMode === "agent"}
              onClick={() => setAgentMode("agent")}
              title="Agent mode — full tools (files, shell, sub-agents, …)"
              label="Agent"
              expanded={expanded}
            >
              <Bot className="h-4 w-4" strokeWidth={1.9} />
            </ModeButton>
          </div>
        </div>

        <div className="mt-3 flex w-full justify-center">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Search everything (Ctrl+K)"
            aria-label="Search everything"
            className={cn(
              "group relative transition-all duration-150 active:scale-95",
              expanded
                ? "flex h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-[var(--muted)] hover:bg-[color:color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)]"
                : "grid h-11 w-11 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[color:color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)]",
            )}
          >
            <Search className="h-5 w-5 shrink-0" strokeWidth={1.7} />
            {expanded ? (
              <span className="truncate text-sm text-[var(--muted)]">Search everything</span>
            ) : (
              <>
                <span className="sr-only">Search everything</span>
                <span
                  className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 z-40 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--secondary-fg)] opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 max-[640px]:hidden"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  Search everything
                </span>
              </>
            )}
          </button>
        </div>

        <nav
          aria-label="Workspace"
          className={cn("mt-3 flex flex-col gap-1", expanded ? "w-full items-stretch" : "items-center")}
        >
          {NAV.map(({ id, label, Icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={active ? "page" : undefined}
                title={label}
                className={cn(
                  "group relative transition-all duration-150 active:scale-95",
                  expanded
                    ? "flex h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3"
                    : "grid h-11 w-11 place-items-center rounded-[var(--radius-md)]",
                  active
                    ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
                    : "text-[var(--muted)] hover:bg-[color:color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)]",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.7} />
                {expanded ? (
                  <span className="truncate text-sm font-medium">{label}</span>
                ) : (
                  <>
                    <span className="sr-only">{label}</span>
                    <span
                      className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 z-40 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--secondary-fg)] opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 max-[640px]:hidden"
                      style={{ boxShadow: "var(--shadow-card)" }}
                    >
                      {label}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Empty flexible area: clicking / tapping / tabbing here opens the full sidebar. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        onClick={(e) => {
          if (e.target === e.currentTarget) toggle();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            toggle();
          }
        }}
        className="min-h-6 w-full flex-1 cursor-pointer outline-none focus-visible:bg-[color:color-mix(in_oklab,var(--fg)_4%,transparent)]"
      />

      <div className={cn("flex flex-col pb-4", expanded ? "items-stretch px-2" : "items-center")}>
        <button
          type="button"
          onClick={toggle}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
          className={cn(
            "mb-2 grid h-9 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-all duration-150 hover:bg-[color:color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)] active:scale-95",
            expanded ? "w-full grid-cols-none" : "w-9",
          )}
        >
          {expanded ? (
            <span className="flex w-full items-center gap-2 px-2 text-xs font-medium">
              <ChevronsLeft className="h-4 w-4 shrink-0" />
              Collapse
            </span>
          ) : (
            <ChevronsRight className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setSection("profiles")}
          aria-current={profilesActive ? "page" : undefined}
          title={activeProfile.name ? `Profiles — ${activeProfile.name}` : "Profiles"}
          aria-label="Profiles"
          className={cn(
            "group relative overflow-hidden transition-all duration-150 active:scale-95",
            expanded
              ? "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] bg-[var(--chip)] px-2 py-2 text-left hover:text-[var(--fg)]"
              : "grid h-10 w-10 place-items-center rounded-full bg-[var(--chip)] text-[var(--muted)] hover:text-[var(--fg)]",
            profilesActive && (expanded ? "bg-[var(--secondary)] text-[var(--secondary-fg)]" : "bg-[var(--secondary)] text-[var(--secondary-fg)]"),
          )}
          style={{ boxShadow: "var(--shadow-chip)" }}
        >
          {showAvatar ? (
            <img
              src={activeProfile.avatar}
              alt={activeProfile.name}
              className={cn("object-cover", expanded ? "h-8 w-8 rounded-full" : "h-full w-full")}
            />
          ) : activeProfile.name ? (
            <span
              className={cn(
                "grid shrink-0 place-items-center rounded-full bg-[var(--chip)] text-[var(--muted)]",
                expanded ? "h-8 w-8 text-xs font-semibold uppercase" : "h-full w-full text-xs font-semibold uppercase",
              )}
            >
              {profileInitials(activeProfile.name)}
            </span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M6.5 19c.8-2.8 2.8-4.2 5.5-4.2s4.7 1.4 5.5 4.2"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          )}
          {expanded ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">
                {activeProfile.name || "Profiles"}
              </span>
              <span className="block truncate text-[10px] opacity-70">Profiles</span>
            </span>
          ) : (
            <span className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 z-40 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--secondary-fg)] opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 max-[640px]:hidden" style={{ boxShadow: "var(--shadow-card)" }}>
              {activeProfile.name ? `Profiles — ${activeProfile.name}` : "Profiles"}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  label,
  expanded,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      aria-label={label}
      className={cn(
        "flex flex-1 items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-1.5 transition-all duration-150 active:scale-95",
        expanded ? "flex-row justify-center" : "w-full flex-col gap-0.5",
        active
          ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
          : "text-[var(--muted)] hover:text-[var(--fg)]",
      )}
    >
      {children}
      <span className="text-[9px] font-semibold uppercase leading-none tracking-wide">{label}</span>
    </button>
  );
}
