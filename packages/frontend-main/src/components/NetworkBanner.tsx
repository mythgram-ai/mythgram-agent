import { Loader2, WifiOff } from "lucide-react";
import { useStore } from "@/store/useStore";

/**
 * A quiet, non-blocking status pill shown only when the connection is genuinely degraded.
 * A slow network is NOT degraded — it never appears here. The agent keeps running on the
 * backend the whole time; this only communicates that the client is re-attaching.
 */
export function NetworkBanner() {
  const connection = useStore((s) => s.connection);
  const streaming = useStore((s) => s.streaming);
  if (connection === "online") return null;

  const offline = connection === "offline";
  const label = offline
    ? streaming
      ? "You're offline — the agent keeps running. Reconnecting when your connection returns…"
      : "You're offline. We'll reconnect automatically."
    : "Reconnecting to your running agent…";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex justify-center px-4">
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--bg)] px-3.5 py-2 text-xs font-medium text-[var(--fg)] fade-in"
        style={{ boxShadow: "var(--shadow-pop)" }}
        role="status"
        aria-live="polite"
      >
        {offline ? (
          <WifiOff className="h-3.5 w-3.5 text-[var(--warning)]" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--secondary)]" />
        )}
        <span className="max-w-[70vw] truncate">{label}</span>
      </div>
    </div>
  );
}
