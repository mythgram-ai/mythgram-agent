import { Check, Copy, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ToolActivity } from "@/types";
import { cn } from "@/utils/cn";

/**
 * Inline artifact preview rendered inside the show_artifact_to_user tool block.
 *
 * The artifact (metadata + raw file content) is attached to the tool activity, so the
 * preview stays visible and re-openable in the conversation after the tool has finished
 * and after the chat is reloaded from its stored snapshot. Raw content is shown as-is;
 * richer per-type rendering can be layered on later.
 */
export function ShowArtifactBlock({ tool }: { tool: ToolActivity }) {
  const artifact = tool.artifactShow;
  const [copied, setCopied] = useState(false);

  if (!artifact) {
    return (
      <div className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-xs text-[var(--muted)]">
        {tool.status === "running" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Preparing the artifact...
          </span>
        ) : tool.status === "error" ? (
          <span className="text-[var(--danger)]">The artifact could not be shown.</span>
        ) : (
          <span>No artifact data was returned.</span>
        )}
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (permissions); ignore.
    }
  };

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] fade-in">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <FileText className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
        <span className="min-w-0 truncate text-xs font-semibold text-[var(--fg)]">
          {artifact.title}
        </span>
        <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          {artifact.type.replace(/_/g, " ")}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--subtle)]">
          {formatBytes(artifact.sizeBytes)}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          title="Copy content"
          aria-label="Copy artifact content"
          className={cn(
            "ml-auto grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]",
            copied && "text-[var(--success)]",
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {artifact.description.trim().length > 0 && (
        <p className="border-b border-[var(--border)] px-3 py-2 text-xs leading-relaxed text-[var(--muted)]">
          {artifact.description}
        </p>
      )}

      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-relaxed text-[var(--fg)]">
        {artifact.content.length > 0 ? artifact.content : "(empty artifact)"}
      </pre>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
