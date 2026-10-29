import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Presentation } from "lucide-react";
import type { ToolActivity } from "@/types";
import { cn } from "@/utils/cn";
import { SlideFrame } from "@/components/slides/SlideFrame";
import { SlideDownloadButtons } from "@/components/slides/SlideDownloadButtons";

/**
 * Inline slide deck rendered inside the present_slides tool block.
 *
 * The deck is attached to the tool activity (not a one-time modal), so it stays
 * visible and re-openable in the conversation after the tool has finished and
 * after the chat is reloaded from its stored snapshot.
 */
export function PresentSlidesBlock({ tool }: { tool: ToolActivity }) {
  const projects = tool.slidesPresent ?? [];
  const [activeProjectId, setActiveProjectId] = useState<string>(projects[0]?.id ?? "");
  const [slideIndex, setSlideIndex] = useState(0);

  const active =
    projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;

  if (projects.length === 0 || !active) {
    return (
      <div className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-xs text-[var(--muted)]">
        {tool.status === "running" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Preparing the slide deck…
          </span>
        ) : tool.status === "error" ? (
          <span className="text-[var(--danger)]">The slide deck could not be presented.</span>
        ) : (
          <span>No slide data was returned.</span>
        )}
      </div>
    );
  }

  const slides = active.slides;
  const index = Math.min(slideIndex, Math.max(0, slides.length - 1));
  const slide = slides[index];
  if (!slide) return null;

  const selectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setSlideIndex(0);
  };

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] fade-in">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Presentation className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
        <span className="min-w-0 truncate text-xs font-semibold text-[var(--fg)]">
          {active.name}
        </span>
        <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {index + 1} / {slides.length}
        </span>
        <SlideDownloadButtons project={active} className="ml-auto" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSlideIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            title="Previous slide"
            aria-label="Previous slide"
            className="grid h-7 w-7 place-items-center rounded-full border border-[var(--border)] text-[var(--fg)] transition-colors hover:bg-[var(--chip)] disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setSlideIndex(Math.min(slides.length - 1, index + 1))}
            disabled={index >= slides.length - 1}
            title="Next slide"
            aria-label="Next slide"
            className="grid h-7 w-7 place-items-center rounded-full border border-[var(--border)] text-[var(--fg)] transition-colors hover:bg-[var(--chip)] disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {projects.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-3 py-2">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => selectProject(project.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                project.id === active.id
                  ? "border-[var(--secondary)] bg-[var(--secondary)] text-[var(--secondary-fg)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              {project.name}
            </button>
          ))}
        </div>
      )}

      <div className="p-0">
        <SlideFrame html={slide.html} title={slide.title ?? active.name} />
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {slides.map((item, itemIndex) => (
          <button
            key={`${active.id}-${item.slide_number}`}
            type="button"
            onClick={() => setSlideIndex(itemIndex)}
            title={`Slide ${itemIndex + 1}`}
            aria-label={`Go to slide ${itemIndex + 1}`}
            className={cn(
              "shrink-0 overflow-hidden rounded-[var(--radius-sm)] border-2 transition-all",
              itemIndex === index
                ? "border-[var(--secondary)] opacity-100"
                : "border-transparent opacity-55 hover:opacity-90",
            )}
            style={{ width: 74 }}
          >
            <SlideFrame html={item.html} title={item.title ?? `Slide ${itemIndex + 1}`} />
          </button>
        ))}
      </div>
    </div>
  );
}