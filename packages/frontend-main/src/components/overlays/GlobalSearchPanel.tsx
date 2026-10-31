import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { TextInput } from "@/components/ui/primitives";
import { useStore } from "@/store/useStore";
import { searchEverything, type SearchResultItem } from "@/lib/globalSearch";
import { cn } from "@/utils/cn";

export function GlobalSearchPanel() {
  const open = useStore((s) => s.searchOpen);
  const setOpen = useStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open ]);

  const results = useMemo(() => {
    const s = useStore.getState();
    return searchEverything(query, {
      conversations: s.conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
      })),
      memory: s.memory,
      knowledge: s.knowledge,
      subAgents: s.subAgents,
      skills: s.skills,
      agentTeams: s.agentTeams,
      ceoAgents: s.ceoAgents,
      customAgents: s.customAgents,
      mainAgentPrompts: s.mainAgentPrompts,
      taskModes: s.taskModes,
      planModePrompt: s.planModePrompt,
      promptLibrary: s.promptLibrary,
      schedules: s.schedules.map((sc) => ({
        id: sc.id,
        name: sc.name,
        prompt: sc.prompt,
        kind: sc.kind,
        status: sc.status,
      })),
      connectors: s.connectors,
      mcpServers: s.mcpServers,
      providers: s.providers,
      models: s.models,
      customProviders: s.customProviders,
      settings: s.settings as unknown as Record<string, unknown>,
      userProfiles: s.userProfiles,
      todos: s.todos,
    });
  }, [query, open ]);

  useEffect(() => {
    setActive(0);
  }, [query ]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResultItem[]>();
    for (const r of results) {
      const list = map.get(r.group) ?? [];
      list.push(r);
      map.set(r.group, list);
    }
    return Array.from(map.entries());
  }, [results ]);

  const flat = results;

  const go = (item: SearchResultItem) => {
    const s = useStore.getState();
    const t = item.target;
    switch (t.kind) {
      case "section":
        s.setSection(t.section);
        break;
      case "conversation":
        s.setSection("chat");
        s.selectConversation(t.conversationId);
        break;
      case "settings":
        s.setSettingsOpen(true);
        break;
      case "provider":
        s.setSettings({ provider: t.providerId, model: "" });
        s.setSettingsOpen(true);
        break;
      case "model":
        s.setSettings({ provider: t.providerId, model: t.modelId });
        s.setModelsLoading(false);
        s.setSettingsOpen(true);
        break;
      case "memory":
        s.setSection("memory");
        break;
      case "knowledge":
        s.setSection("knowledge");
        break;
      case "subagent":
        s.setSection("agents");
        break;
      case "skill":
        s.setSection("skills");
        break;
      case "team":
        s.setSection("teams");
        break;
      case "ceo":
        s.setSection("ceo");
        break;
      case "customagent":
        s.setSection("customagents");
        break;
      case "systemprompt":
        s.setSection("systemprompts");
        break;
      case "taskmode":
        s.setSection("taskmodes");
        break;
      case "prompt":
        s.setSection("prompts");
        break;
      case "schedule":
        s.setSection("schedules");
        break;
      case "connector":
        s.setSection("connectors");
        break;
      case "mcp":
        s.setSection("mcp");
        break;
      case "profile":
        s.setSection("profiles");
        break;
      case "todo":
        s.setSection("chat");
        break;
      default:
        break;
    }
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) go(item);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active ]);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Search everything"
      icon={<Search className="h-4 w-4" />}
      size="lg"
      align="top"
    >
      <div className="p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--subtle)]" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search chats, memory, knowledge, agents, skills, teams, models, providers, connectors, MCP, settings…"
            className="pl-9 pr-9"
            aria-label="Global search"
            autoFocus={open}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="m-0 mt-2 text-[11px] text-[var(--subtle)]">
          Type to search the whole workspace — press Enter to jump to the highlighted result. Try a
          model name, provider, connector, file path, or any text.
        </p>

        <div ref={listRef} className="mt-3 max-h-[52vh] overflow-y-auto pr-1">
          {query.trim().length === 0 ? (
            <p className="m-0 py-8 text-center text-sm text-[var(--muted)]">
              Start typing to search everything in the app.
            </p>
          ) : flat.length === 0 ? (
            <p className="m-0 py-8 text-center text-sm text-[var(--muted)]">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-4">
                <p className="m-0 mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--subtle)]">
                  {group} · {items.length}
                </p>
                <ul className="m-0 list-none overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] p-0">
                  {items.map((item) => {
                    const idx = flat.indexOf(item);
                    const isActive = idx === active;
                    return (
                      <li key={item.id} data-index={idx}>
                        <button
                          type="button"
                          onClick={() => go(item)}
                          onMouseEnter={() => setActive(idx)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                            isActive ? "bg-[var(--chip)]" : "bg-[var(--bg)] hover:bg-[var(--chip)]",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[var(--fg)]">
                              {item.title}
                            </span>
                            {item.snippet && (
                              <span className="block truncate text-xs text-[var(--muted)]">
                                {item.snippet}
                              </span>
                            )}
                          </span>
                          {item.hint && (
                            <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[var(--subtle)] sm:inline-flex">
                              {isActive && <CornerDownLeft className="h-3 w-3" />}
                              {item.hint}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
