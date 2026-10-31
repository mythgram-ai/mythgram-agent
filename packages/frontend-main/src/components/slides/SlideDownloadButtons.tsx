import { useState } from "react";
import { Download, FileDown, FileText, Images, Loader2 } from "lucide-react";
import type { SlideProject } from "@/lib/slides";
import { exportSlideProject, type SlideExportFormat } from "@/lib/slideExport";
import { cn } from "@/utils/cn";

const FORMATS: Array<{
  id: SlideExportFormat;
  label: string;
  title: string;
  Icon: typeof FileText;
}> = [
  {
    id: "pptx",
    label: "PPTX",
    title: "Download all slides as a single PowerPoint file (.pptx)",
    Icon: FileText,
  },
  {
    id: "pdf",
    label: "PDF",
    title: "Download all slides as a single PDF file",
    Icon: FileDown,
  },
  {
    id: "png",
    label: "PNG",
    title: "Download every slide as a PNG image inside one ZIP file",
    Icon: Images,
  },
];

/**
 * Download controls for one slide project. Exports run in the browser and can be
 * started from either the inline present_slides block or the full-screen viewer.
 */
export function SlideDownloadButtons({
  project,
  className,
}: {
  project: SlideProject;
  className?: string;
}) {
  const [busy, setBusy] = useState<SlideExportFormat | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: SlideExportFormat) => {
    if (busy) return;
    setBusy(format);
    setProgress(null);
    setError(null);
    try {
      await exportSlideProject(project, format, (next) => setProgress(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
        <Download className="h-3 w-3" />
        Download
      </span>
      {FORMATS.map(({ id, label, title, Icon }) => {
        const active = busy === id;
        return (
          <button
            key={id}
            type="button"
            title={title}
            aria-label={title}
            onClick={() => void run(id)}
            disabled={busy !== null}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--chip)] px-2 py-1 text-[11px] font-medium text-[var(--fg)] transition-colors",
              "hover:bg-[var(--chip-hover)] disabled:cursor-default disabled:opacity-55",
              active && "border-[var(--secondary)]",
            )}
          >
            {active ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Icon className="h-3 w-3" />
            )}
            {active && progress ? `${label} ${progress.completed}/${progress.total}` : label}
          </button>
        );
      })}
      {error && (
        <span className="text-[10px] text-[var(--danger)]" title={error}>
          Export failed
        </span>
      )}
    </div>
  );
}