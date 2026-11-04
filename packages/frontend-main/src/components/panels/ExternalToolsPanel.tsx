import type { ComponentType, ReactNode } from "react";
import { ArrowRight, Plug, Server } from "lucide-react";
import { useStore } from "@/store/useStore";
import { PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

/**
 * Shared shell for capability panels that are fulfilled externally rather than by a
 * built-in provider (currently Video generation and Music generation).
 *
 * Both panels present the same message — the capability is provided through MCP servers
 * and Connectors — plus two actions that jump straight to those panels. The exact copy
 * and icon are supplied by the thin wrappers (`VideoGenPanel`, `MusicGenPanel`).
 */
export function ExternalToolsPanel({
  kicker,
  title,
  intro,
  Icon,
  calloutTitle,
  calloutBody,
  mcpDescription,
  connectorDescription,
}: {
  kicker: string;
  title: string;
  intro: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  calloutTitle: string;
  calloutBody: ReactNode;
  mcpDescription?: string;
  connectorDescription?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl panel-in">
      <PanelHeader kicker={kicker} title={title} />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{intro}</p>

      <ExternalToolsNotice
        Icon={Icon}
        title={calloutTitle}
        body={calloutBody}
        mcpDescription={mcpDescription}
        connectorDescription={connectorDescription}
      />
    </div>
  );
}

/**
 * Highlighted callout telling the user a capability is provided through MCP servers and
 * Connectors, with two cards that jump to those panels. Reused by the dedicated
 * capability panels and as a top notice inside the built-in provider panels.
 */
export function ExternalToolsNotice({
  Icon,
  title,
  body,
  mcpDescription = "Add a capable MCP server the agent can call.",
  connectorDescription = "Connect a third-party app that provides this capability.",
  className,
}: {
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: ReactNode;
  mcpDescription?: string;
  connectorDescription?: string;
  className?: string;
}) {
  const setSection = useStore((s) => s.setSection);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--chip)] p-5 sm:p-6",
        className,
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[color:color-mix(in_oklab,var(--secondary)_12%,transparent)] blur-3xl"
      />

      <div className="relative flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
          <Icon className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug text-[var(--fg)]">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
        </div>
      </div>

      <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
        <RedirectCard
          Icon={Server}
          title="MCP servers"
          description={mcpDescription}
          onClick={() => setSection("mcp")}
        />
        <RedirectCard
          Icon={Plug}
          title="Connectors"
          description={connectorDescription}
          onClick={() => setSection("connectors")}
        />
      </div>
    </section>
  );
}

/** Inline highlight used to emphasise the key phrase inside the callout copy. */
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-[var(--radius-sm)] bg-[color:color-mix(in_oklab,var(--secondary)_16%,transparent)] px-1.5 py-0.5 font-medium text-[var(--fg)]">
      {children}
    </mark>
  );
}

/** Tappable card that jumps to another workspace section. */
function RedirectCard({
  Icon,
  title,
  description,
  onClick,
}: {
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-4 text-left transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-[var(--secondary)] hover:bg-[var(--chip)] active:scale-[0.99]",
      )}
      style={{ boxShadow: "var(--shadow-chip)" }}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--fg)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">
          {description}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--subtle)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--fg)]" />
    </button>
  );
}
