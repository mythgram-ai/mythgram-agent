export function ThinkingIndicator({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 fade-in">
      <div className="flex items-center gap-1">
        <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--secondary)]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--secondary)]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--secondary)]" />
      </div>
      <span className="shimmer-text text-sm font-medium">{label}…</span>
    </div>
  );
}
