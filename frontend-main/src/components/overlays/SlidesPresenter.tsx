import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Presentation, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";
import { SlideFrame } from "@/components/slides/SlideFrame";
import { SlideDownloadButtons } from "@/components/slides/SlideDownloadButtons";

/**
 * Full-screen slide deck viewer opened by present_slides (and by the Slides panel's
 * Preview buttons). Shows one 16:9 slide at a time with project tabs, thumbnails, and
 * keyboard navigation.
 */
export function SlidesPresenter() {
  const presentation = useStore((s) => s.slidesPresentation);
  const close = useStore((s) => s.closeSlidesPresentation);
  const setSlide = useStore((s) => s.setSlidesPresentationSlide);
  const setProject = useStore((s) => s.setSlidesPresentationProject);

  const active =
    presentation.projects.find((project) => project.id === presentation.activeProjectId) ??
    presentation.projects[0];
  const slides = active?.slides ?? [];
  const index = Math.min(presentation.slideIndex, Math.max(0, slides.length - 1));
  const slide = slides[index];
  const open = presentation.open && Boolean(active) && Boolean(slide);

  const prev = () => setSlide(index - 1);
  const next = () => setSlide(index + 1);

  useEffect(() => {
    if (!presentation.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        setSlide(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        setSlide(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation.open, index, close, setSlide]);

  if (!open || !active || !slide) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-[color:color-mix(in_oklab,black_82%,transparent)] p-4 backdrop-blur-sm max-[640px]:p-2"
      role="dialog"
      aria-modal="true"
      aria-label="Slide presentation"
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--fg)]">
          <Presentation className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-semibold">{active.name}</span>
          <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
            {index + 1} / {slides.length}
          </span>
          <SlideDownloadButtons project={active} className="ml-2" />
        </div>
        <button
          type="button"
          onClick={close}
          title="Close presentation"
          aria-label="Close presentation"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)] transition-transform active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {presentation.projects.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {presentation.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setProject(project.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
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

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          title="Previous slide"
          aria-label="Previous slide"
          className="absolute left-0 z-10 grid h-10 w-10 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)] opacity-90 transition-opacity hover:opacity-100 disabled:opacity-25 max-[640px]:hidden"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          className="w-full overflow-hidden rounded-[var(--radius-md)] shadow-2xl"
          style={{ maxWidth: "min(100%, calc((100dvh - 12rem) * 1.7778))" }}
        >
          <SlideFrame html={slide.html} title={slide.title ?? active.name} />
        </div>

        <button
          type="button"
          onClick={next}
          disabled={index >= slides.length - 1}
          title="Next slide"
          aria-label="Next slide"
          className="absolute right-0 z-10 grid h-10 w-10 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)] opacity-90 transition-opacity hover:opacity-100 disabled:opacity-25 max-[640px]:hidden"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex justify-center gap-2 overflow-x-auto pt-3">
        {slides.map((item, slideIndex) => (
          <button
            key={`${active.id}-${item.slide_number}`}
            type="button"
            onClick={() => setSlide(slideIndex)}
            title={`Slide ${slideIndex + 1}`}
            aria-label={`Go to slide ${slideIndex + 1}`}
            className={cn(
              "shrink-0 overflow-hidden rounded-[var(--radius-sm)] border-2 transition-all",
              slideIndex === index
                ? "border-[var(--secondary)] opacity-100"
                : "border-transparent opacity-55 hover:opacity-90",
            )}
            style={{ width: 92 }}
          >
            <SlideFrame html={item.html} title={item.title ?? `Slide ${slideIndex + 1}`} />
          </button>
        ))}
      </div>
    </div>
  );
}