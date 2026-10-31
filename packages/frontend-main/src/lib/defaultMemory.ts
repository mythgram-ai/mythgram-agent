import type { MemoryFile } from "@/types";

/**
 * The four permanent, pre-added memory files. These — and only these — are auto-loaded into the
 * agent's context on the FIRST message of every chat, and they can never be deleted. Their order
 * here is the canonical display order.
 */
export const PREADDED_MEMORY_FILES = [
  "MEMORY.md",
  "SOUL.md",
  "USER.md",
  "session-memory.md",
] as const;

/** Per-file character limits. Pre-added files are capped; custom files are uncapped. */
export const MEMORY_CHAR_LIMITS: Readonly<Record<string, number>> = {
  "MEMORY.md": 8000,
  "SOUL.md": 2000,
  "USER.md": 2000,
  "session-memory.md": 5000,
};

/** Virtual root every memory file lives under (used only for display). */
export const MEMORY_ROOT = "memory/";

/** Skeleton content shipped with each pre-added file so the agent has a scaffold to grow into. */
const DEFAULT_MEMORY_CONTENT: Record<(typeof PREADDED_MEMORY_FILES)[number], string> = {
  "MEMORY.md": `# Memory

Durable facts and knowledge worth remembering across sessions — the user's stack, environment,
recurring tasks, important project facts, and conventions to follow. Keep this tight and
high-signal (max 8000 characters); it is auto-loaded at the start of every chat.

`,
  "SOUL.md": `# Soul

Your evolving identity: the principles, tone, and working style that make you a better fit for
this user over time. Refine this as you learn how best to help them (max 2000 characters).

`,
  "USER.md": `# User

Who the user is: their name, role, goals, preferences, constraints, and how they like to
communicate. Update this as you learn more about them (max 2000 characters).

`,
  "session-memory.md": `# Session Memory

Short-term memory of the current working session — what was worked on, key decisions, current
state, and open threads. A background memory agent rebuilds this automatically after every
completed turn, and it resets for each new day/chat session (max 5000 characters).

`,
};

/** The canonical set of pre-added memory files, with their starter content. */
export const DEFAULT_MEMORY_FILES: readonly MemoryFile[] = PREADDED_MEMORY_FILES.map((path) => ({
  path,
  content: DEFAULT_MEMORY_CONTENT[path],
}));

/** True when a path (any case) is one of the three permanent pre-added files. */
export function isPreaddedMemory(path: string): boolean {
  const key = path.trim().toLowerCase();
  return PREADDED_MEMORY_FILES.some((name) => name.toLowerCase() === key);
}

/** Canonicalize the case of pre-added file names (e.g. "memory.md" -> "MEMORY.md"). */
export function canonicalMemoryPath(path: string): string {
  const trimmed = path.trim();
  const match = PREADDED_MEMORY_FILES.find((name) => name.toLowerCase() === trimmed.toLowerCase());
  return match ?? trimmed;
}

/** The character limit for a path, or undefined when the file is uncapped (custom files). */
export function memoryCharLimit(path: string): number | undefined {
  return MEMORY_CHAR_LIMITS[canonicalMemoryPath(path)];
}

/**
 * Merge the persisted (user/agent-maintained) memory files with the defaults so the three
 * pre-added files always exist. A persisted pre-added file keeps its content (case-canonicalized);
 * a missing one is seeded from the default. Custom files are preserved as-is. Invalid entries are
 * dropped. Never throws.
 */
export function mergeMemoryWithDefaults(userFiles: MemoryFile[]): MemoryFile[] {
  const seen = new Set<string>();
  const result: MemoryFile[] = [];

  if (Array.isArray(userFiles)) {
    for (const file of userFiles) {
      if (!file || typeof file !== "object") continue;
      const rawPath = typeof file.path === "string" ? file.path.trim() : "";
      if (!rawPath) continue;
      const path = canonicalMemoryPath(rawPath);
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ path, content: typeof file.content === "string" ? file.content : "" });
    }
  }

  // Pre-add any of the three permanent files that are not already present.
  for (const file of DEFAULT_MEMORY_FILES) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...file });
  }

  // Keep the three core files first, in canonical order, then everything else.
  const preadded: MemoryFile[] = [];
  const custom: MemoryFile[] = [];
  for (const file of result) {
    (isPreaddedMemory(file.path) ? preadded : custom).push(file);
  }
  preadded.sort(
    (a, b) =>
      PREADDED_MEMORY_FILES.indexOf(a.path as (typeof PREADDED_MEMORY_FILES)[number]) -
      PREADDED_MEMORY_FILES.indexOf(b.path as (typeof PREADDED_MEMORY_FILES)[number]),
  );
  return [...preadded, ...custom];
}
