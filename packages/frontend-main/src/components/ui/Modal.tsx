import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  /** Optional left slot in the header (e.g. a back button). */
  lead?: ReactNode;
  /** Optional right slot in the header, before the close button. */
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Alignment: centered dialogs vs. top-anchored sheets. */
  align?: "center" | "top";
  className?: string;
}

const SIZES: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

/** The shared Haku modal shell: soft overlay, rounded card, quiet header/footer dividers. */
export function Modal({
  open,
  onClose,
  title,
  icon,
  lead,
  actions,
  footer,
  children,
  size = "md",
  align = "center",
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Rendered through a portal into document.body so the dialog is ALWAYS positioned relative to the
  // viewport — never relative to a transformed ancestor (e.g. a panel running the `panel-in`
  // animation), which would otherwise turn this fixed overlay into a containing-block-relative box and
  // push part of the dialog under the top header. The portal keeps every popup centered on screen.
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[80] flex justify-center overflow-y-auto overlay-in",
        align === "center" ? "items-center p-4" : "items-start p-4 pt-[8vh]",
      )}
      style={{ background: "rgba(28,28,25,0.28)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "flex max-h-[86vh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] pop-in",
          SIZES[size],
          className,
        )}
        style={{ boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || icon || lead || actions) && (
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div className="flex min-w-0 items-center gap-2.5">
              {lead}
              {icon && <span className="flex text-[var(--secondary)]">{icon}</span>}
              {title && <h2 className="truncate text-sm font-semibold text-[var(--fg)]">{title}</h2>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
