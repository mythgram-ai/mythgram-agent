import { useState, type ReactNode } from "react";
import { ChevronDown, Compass, ExternalLink } from "lucide-react";
import {
  resourceHost,
  resourceLogoUrls,
  type ResourceDirectoryLink,
} from "@/lib/resourceDirectories";
import { cn } from "@/utils/cn";

/**
 * Discover section shared by the MCP and Skills panels.
 *
 * A collapsible card that lists external directories/marketplaces where the
 * user can find servers or skills worth adding. Every entry is a tappable card
 * that opens the site in a new tab; the logo is the site's own favicon fetched
 * from its URL, with a graceful initial fallback when the image cannot load.
 */
export function ResourceDirectorySection({
  title,
  notice,
  description,
  links,
  icon,
  defaultOpen = true,
}: {
  title: string;
  notice: string;
  description: string;
  links: readonly ResourceDirectoryLink[];
  icon?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mb-5 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--chip)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--chip-hover)]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
          {icon ?? <Compass className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--fg)]">{title}</span>
          <span className="block text-xs text-[var(--muted)]">{notice}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--subtle)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-4">
          <p className="m-0 mb-3 text-xs leading-relaxed text-[var(--muted)]">{description}</p>
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
            {links.map((link) => (
              <ResourceCard key={link.url} link={link} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One external directory link, rendered as a full-card anchor. */
function ResourceCard({ link }: { link: ResourceDirectoryLink }) {
  const logos = resourceLogoUrls(link.url);
  const [logoIndex, setLogoIndex] = useState(0);
  const [logoFailed, setLogoFailed] = useState(logos.length === 0);

  return (
    <li>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="group flex h-full items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-3 transition-colors hover:border-[var(--secondary)] hover:bg-[var(--chip-hover)]"
      >
        {logoFailed ? (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-sm font-semibold text-[var(--secondary-fg)]">
            {link.name.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <img
            key={logos[logoIndex]}
            src={logos[logoIndex]}
            alt={`${link.name} logo`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() =>
              logoIndex < logos.length - 1 ? setLogoIndex((i) => i + 1) : setLogoFailed(true)
            }
            className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-white object-contain p-1.5"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[13px] font-semibold text-[var(--fg)]">
            <span className="truncate">{link.name}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-[var(--subtle)] transition-colors group-hover:text-[var(--secondary)]" />
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--subtle)]">
            {resourceHost(link.url)}
          </span>
          <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {link.description}
          </span>
        </span>
      </a>
    </li>
  );
}
