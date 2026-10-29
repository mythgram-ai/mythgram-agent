import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Eye,
  LayoutTemplate,
  Loader2,
  Plus,
  Presentation,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  deleteSlideProject,
  deleteSlideTemplate,
  fetchSlideProject,
  fetchSlideProjects,
  fetchSlideTemplate,
  fetchSlideTemplates,
  saveSlideProjectAsTemplate,
  type SlideProjectSummary,
  type SlideTemplateSummary,
} from "@/lib/slides";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";

/**
 * Slides panel — manage slide templates and preview the slide projects the agent
 * created. Built-in templates are read-only; user templates and projects can be
 * previewed, deleted, or converted into reusable templates.
 */
export function SlidesPanel() {
  const setPresentation = useStore((s) => s.setSlidesPresentation);
  const [templates, setTemplates] = useState<SlideTemplateSummary[]>([]);
  const [projects, setProjects] = useState<SlideProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextTemplates, nextProjects] = await Promise.all([
        fetchSlideTemplates(),
        fetchSlideProjects(),
      ]);
      setTemplates(nextTemplates);
      setProjects(nextProjects);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch; every state update happens after the awaited network I/O.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const previewTemplate = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const template = await fetchSlideTemplate(id);
      setPresentation([template], id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const previewProject = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const project = await fetchSlideProject(id);
      setPresentation([project], id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const removeTemplate = async (template: SlideTemplateSummary) => {
    if (template.builtin) return;
    if (!window.confirm(`Delete the slide template "${template.name}"?`)) return;
    setBusyId(template.id);
    setError(null);
    try {
      setTemplates(await deleteSlideTemplate(template.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const removeProject = async (project: SlideProjectSummary) => {
    if (!window.confirm(`Delete the slide project "${project.name}"?`)) return;
    setBusyId(project.id);
    setError(null);
    try {
      setProjects(await deleteSlideProject(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const saveProjectAsTemplate = async (project: SlideProjectSummary) => {
    setBusyId(project.id);
    setError(null);
    try {
      const result = await saveSlideProjectAsTemplate(project.id);
      setTemplates(result.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Presentation className="h-5 w-5 text-[var(--secondary)]" />
            <h1 className="text-lg font-semibold text-[var(--fg)]">Slides</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Manage reusable slide templates and preview the HTML slide projects your agent creates.
            Every slide is rendered on a true 16:9 canvas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--chip-hover)] disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Slide templates</h2>
          <span className="text-xs text-[var(--muted)]">{templates.length} available</span>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)]"
              />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <EmptyState text="No slide templates are available." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <article
                key={template.id}
                className="group flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)]"
              >
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-[linear-gradient(135deg,color-mix(in_oklab,var(--secondary)_28%,var(--bg)),var(--bg))]">
                  <LayoutTemplate className="h-9 w-9 text-[var(--secondary)] opacity-70" />
                  <span className="absolute left-2 top-2 rounded-full bg-[color:color-mix(in_oklab,black_55%,transparent)] px-2 py-0.5 text-[10px] font-medium text-white">
                    {template.slide_count} slide{template.slide_count === 1 ? "" : "s"}
                  </span>
                  {template.builtin && (
                    <span className="absolute right-2 top-2 rounded-full bg-[color:color-mix(in_oklab,black_55%,transparent)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">
                      Built-in
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div>
                    <h3 className="truncate text-sm font-semibold text-[var(--fg)]">
                      {template.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
                      {template.description || "A reusable HTML slide deck."}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void previewTemplate(template.id)}
                      disabled={busyId === template.id}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--secondary-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {busyId === template.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      Preview
                    </button>
                    {!template.builtin && (
                      <button
                        type="button"
                        onClick={() => void removeTemplate(template)}
                        disabled={busyId === template.id}
                        title="Delete template"
                        aria-label="Delete template"
                        className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Slide projects</h2>
          <span className="text-xs text-[var(--muted)]">{projects.length} available</span>
        </div>

        {projects.length === 0 ? (
          <EmptyState text="No slide projects yet. Ask the agent to build a presentation and it will appear here." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <article
                key={project.id}
                className={cn(
                  "flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[var(--fg)]">
                      {project.name}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {project.slide_count} slide{project.slide_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Presentation className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void previewProject(project.id)}
                    disabled={busyId === project.id}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--secondary-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {busyId === project.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveProjectAsTemplate(project)}
                    disabled={busyId === project.id}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--chip)] disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Save as template
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeProject(project)}
                    disabled={busyId === project.id}
                    title="Delete project"
                    aria-label="Delete project"
                    className="ml-auto grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--chip)] px-4 py-8 text-center text-sm text-[var(--muted)]">
      {text}
    </div>
  );
}