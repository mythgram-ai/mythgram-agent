import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/** A labelled form field with an optional right-aligned hint. */
export function Field({
  label,
  hint,
  hintError,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  hintError?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        {hint != null && (
          <span
            className={cn(
              "text-[10px] tabular-nums",
              hintError ? "text-[var(--danger)]" : "text-[var(--subtle)]",
            )}
          >
            {hint}
          </span>
        )}
      </div>
      {children}
    </label>
  );
}

const inputBase =
  "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--subtle)] focus:border-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-60";

export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputBase, className)} />;
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputBase, "resize-y leading-relaxed", className)} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(inputBase, "cursor-pointer appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

/** Primary (dark) button in the Haku secondary color. */
export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
}) {
  const styles: Record<string, string> = {
    primary:
      "bg-[var(--secondary)] text-[var(--secondary-fg)] hover:brightness-110 disabled:opacity-50",
    ghost: "text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]",
    outline:
      "border border-[var(--border)] text-[var(--fg)] hover:border-[var(--secondary)] hover:bg-[var(--chip)]",
    danger:
      "border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)] hover:brightness-95 disabled:opacity-50",
  };
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3.5 py-2 text-sm font-medium transition-colors active:scale-[0.98]",
        styles[variant],
        className,
      )}
    />
  );
}

/** A small square icon button. */
export function IconButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)] disabled:opacity-40",
        className,
      )}
    />
  );
}

/** Accessible on/off switch. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-[var(--secondary)]" : "bg-[var(--border)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

/** Section header used at the top of each workspace panel. */
export function PanelHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <header className="mb-2">
      <p className="m-0 text-xs font-medium uppercase tracking-[0.06em] text-[var(--subtle)]">
        {kicker}
      </p>
      <h1 className="font-serif-display mt-1 text-[2.25rem] leading-tight text-[var(--fg)]">
        {title}
      </h1>
    </header>
  );
}

/** Empty-state block. */
export function EmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] py-12 text-center">
      <span className="text-[var(--subtle)]">{icon}</span>
      <p className="max-w-sm text-sm text-[var(--muted)]">{children}</p>
    </div>
  );
}
