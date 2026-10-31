import { useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw, X } from "lucide-react";
import { useStore } from "@/store/useStore";

/** Full-screen browser preview driven by the embed_url tool and attached-file previews. */
export function PreviewPanel() {
  const preview = useStore((s) => s.preview);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);

  if (!preview.open) return null;
  const url = preview.url.trim();

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 overlay-in" style={{ background: "rgba(28,28,25,0.4)", backdropFilter: "blur(3px)" }} onClick={() => setPreviewOpen(false)}>
      <div className="flex h-[90vh] w-[min(1100px,92vw)] flex-col overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] pop-in" style={{ boxShadow: "var(--shadow-pop)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
            <h2 className="shrink-0 text-sm font-semibold">Browser preview</h2>
            <div className="min-w-0 flex-1 truncate rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-2 py-1 text-[11px] text-[var(--muted)]">{url || "No URL"}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={() => { setLoading(true); setKey((k) => k + 1); }} title="Reload" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]">
              <RefreshCw className="h-4 w-4" />
            </button>
            <a href={url} target="_blank" rel="noreferrer" title="Open in new tab" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]">
              <ExternalLink className="h-4 w-4" />
            </a>
            <button onClick={() => setPreviewOpen(false)} title="Close" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-[var(--bg)]">
          {url ? (
            <>
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-[var(--muted)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--secondary)]" />
                  <span className="text-xs">Loading preview…</span>
                </div>
              )}
              <iframe key={key} src={url} title="Browser preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals" referrerPolicy="no-referrer" onLoad={() => setLoading(false)} onError={() => setLoading(false)} className="h-full w-full border-0" />
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">No URL to preview.</div>
          )}
        </div>
        <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--subtle)]">
          Some sites block embedding; if the preview stays blank, open it in a new tab with the external-link button.
        </div>
      </div>
    </div>
  );
}
