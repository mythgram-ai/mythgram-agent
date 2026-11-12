import type { ChatMessage } from "@/types";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useStore } from "@/store/useStore";
import { MessageItem } from "./MessageItem";

export function MessageList({
  messages,
  onContinue,
}: {
  messages: ChatMessage[];
  onContinue?: () => void;
}) {
  // Per-session: another chat streaming in the background never hides Continue here.
  const streaming = useStore((s) => (s.currentId ? Boolean(s.streamingChats[s.currentId]) : false));
  // A cheap streaming signal: message count + the tail message's size. Avoids scanning the
  // whole conversation on every token.
  const last = messages[messages.length - 1];
  const signal = `${messages.length}:${last?.content.length ?? 0}:${last?.reasoning?.length ?? 0}:${last?.tools?.length ?? 0}:${last?.interrupted ? 1 : 0}`;
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>(signal);

  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6 max-[640px]:px-4">
        {messages.map((m) => {
          // Only the latest turn can be continued, and only while nothing else is running.
          const canContinue = m === last && !streaming && Boolean(onContinue);
          return (
            <MessageItem
              key={m.id}
              message={m}
              canContinue={canContinue}
              onContinue={canContinue ? onContinue : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
