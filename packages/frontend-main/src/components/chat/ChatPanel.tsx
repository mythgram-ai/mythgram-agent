import { useMemo } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { useStore } from "@/store/useStore";
import { DEFAULT_PROFILE_ID } from "@/lib/userProfiles";
import { greeting, timeAgo } from "@/utils/format";
import { MessageList } from "./MessageList";

const PROMPTS = [
  "Draft a product narrative",
  "Structure a knowledge base",
  "Brief a sub-agent",
  "Capture this to memory",
];

export function ChatPanel({ onSend }: { onSend: (text: string) => void }) {
  const conversations = useStore((s) => s.conversations);
  const currentId = useStore((s) => s.currentId);
  const activeUserProfileId = useStore((s) => s.activeUserProfileId);
  const selectConversation = useStore((s) => s.selectConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);

  const messages = useMemo(
    () => conversations.find((c) => c.id === currentId)?.messages ?? [],
    [conversations, currentId],
  );

  const recents = useMemo(
    () =>
      conversations
        // Only this profile's chats — profiles are strictly isolated.
        .filter(
          (c) => (c.profileId ?? DEFAULT_PROFILE_ID) === (activeUserProfileId ?? DEFAULT_PROFILE_ID),
        )
        // Unloaded stubs from the database report their size via messageCount.
        .filter((c) => c.id !== currentId && Math.max(c.messages.length, c.messageCount ?? 0) > 0)
        .slice(0, 5),
    [conversations, currentId, activeUserProfileId],
  );

  if (messages.length > 0) {
    return <MessageList messages={messages} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center max-[640px]:px-4">
        <div className="stagger-in flex w-full max-w-xl flex-col items-center">
          <h1 className="font-serif-display m-0 text-5xl text-[var(--fg)] max-[640px]:text-4xl">
            {greeting()}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-[var(--muted)]">
            A quiet place to think — ask, remember, or hand work to a sub-agent.
          </p>
          <ul className="mt-8 flex flex-wrap justify-center gap-2">
            {PROMPTS.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => onSend(p)}
                  className="rounded-full bg-[var(--chip)] px-4 py-2.5 text-sm text-[var(--fg)] transition-colors hover:bg-[var(--chip-hover)] active:scale-[0.97]"
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {recents.length > 0 && (
          <div className="mt-10 w-full max-w-xl text-left">
            <p className="m-0 mb-2 px-1 text-xs font-medium uppercase tracking-[0.06em] text-[var(--subtle)]">
              Recent threads
            </p>
            <ul
              className="m-0 list-none overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] p-0"
              style={{ boxShadow: "var(--shadow-chip)" }}
            >
              {recents.map((c) => (
                <li
                  key={c.id}
                  className="group flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--chip)]"
                >
                  <button
                    type="button"
                    onClick={() => selectConversation(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-[var(--subtle)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--fg)]">
                        {c.title}
                      </span>
                      <span className="block text-xs text-[var(--subtle)]">
                        {Math.max(c.messages.length, c.messageCount ?? 0)} message
                        {Math.max(c.messages.length, c.messageCount ?? 0) === 1 ? "" : "s"} ·{" "}
                        {timeAgo(c.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConversation(c.id)}
                    title="Delete thread"
                    className="shrink-0 text-[var(--subtle)] opacity-0 transition hover:text-[var(--danger)] group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
