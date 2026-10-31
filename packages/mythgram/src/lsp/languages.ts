import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { LspServerDefinition } from "./types.js";

/**
 * Built-in language-server catalog.
 *
 * Every entry lists candidate executables; the manager probes them in order and
 * uses the first one that is actually installed. A workspace can add or
 * override entries with `.mythgram/lsp.json` (see `manager.ts`).
 *
 * The list intentionally favours the standard, widely distributed server for
 * each language. Where a server is commonly shipped through npm and no global
 * binary exists, an `npx` fallback is included last so the feature still works
 * in a fresh checkout (at the cost of the first run downloading the package).
 */
export const LANGUAGE_SERVERS: readonly LspServerDefinition[] = [
  {
    id: "typescript",
    name: "TypeScript/JavaScript",
    extensions: {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".mts": "typescript",
      ".cts": "typescript",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript",
    },
    candidates: [
      { command: "typescript-language-server", args: ["--stdio"] },
      { command: "vtsls", args: ["--stdio"] },
      { command: "npx", args: ["--yes", "typescript-language-server", "--stdio"] },
    ],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
  },
  {
    id: "python",
    name: "Python",
    extensions: { ".py": "python", ".pyi": "python" },
    candidates: [
      { command: "pyright-langserver", args: ["--stdio"] },
      { command: "basedpyright-langserver", args: ["--stdio"] },
      { command: "pylsp", args: [] },
      { command: "npx", args: ["--yes", "pyright-langserver", "--stdio"] },
    ],
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", ".git"],
  },
  {
    id: "go",
    name: "Go",
    extensions: { ".go": "go" },
    candidates: [{ command: "gopls", args: [] }],
    rootMarkers: ["go.mod", "go.work", ".git"],
  },
  {
    id: "rust",
    name: "Rust",
    extensions: { ".rs": "rust" },
    candidates: [{ command: "rust-analyzer", args: [] }],
    rootMarkers: ["Cargo.toml", "Cargo.lock", ".git"],
  },
  {
    id: "clangd",
    name: "C/C++",
    extensions: {
      ".c": "c",
      ".h": "c",
      ".cc": "cpp",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".hpp": "cpp",
      ".hh": "cpp",
      ".hxx": "cpp",
      ".m": "objective-c",
      ".mm": "objective-cpp",
    },
    candidates: [{ command: "clangd", args: [] }],
    rootMarkers: ["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", ".git"],
  },
  {
    id: "java",
    name: "Java",
    extensions: { ".java": "java" },
    candidates: [{ command: "jdtls", args: [] }],
    rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", ".git"],
  },
  {
    id: "ruby",
    name: "Ruby",
    extensions: { ".rb": "ruby", ".rake": "ruby", ".gemspec": "ruby" },
    candidates: [
      { command: "solargraph", args: ["stdio"] },
      { command: "ruby-lsp", args: [] },
    ],
    rootMarkers: ["Gemfile", ".ruby-version", ".git"],
  },
  {
    id: "php",
    name: "PHP",
    extensions: { ".php": "php" },
    candidates: [
      { command: "intelephense", args: ["--stdio"] },
      { command: "phpactor", args: ["language-server"] },
    ],
    rootMarkers: ["composer.json", ".git"],
  },
  {
    id: "csharp",
    name: "C#",
    extensions: { ".cs": "csharp" },
    candidates: [
      { command: "csharp-ls", args: [] },
      { command: "omnisharp", args: ["--languageserver"] },
    ],
    rootMarkers: ["global.json", ".sln", ".csproj", ".git"],
  },
  {
    id: "lua",
    name: "Lua",
    extensions: { ".lua": "lua" },
    candidates: [{ command: "lua-language-server", args: [] }],
    rootMarkers: [".luarc.json", ".git"],
  },
  {
    id: "bash",
    name: "Shell",
    extensions: { ".sh": "shellscript", ".bash": "shellscript" },
    candidates: [{ command: "bash-language-server", args: ["start"] }],
    rootMarkers: [".git"],
  },
  {
    id: "json",
    name: "JSON",
    extensions: { ".json": "json", ".jsonc": "jsonc" },
    candidates: [{ command: "vscode-json-language-server", args: ["--stdio"] }],
    rootMarkers: ["package.json", ".git"],
  },
  {
    id: "css",
    name: "CSS",
    extensions: { ".css": "css", ".scss": "scss", ".less": "less" },
    candidates: [{ command: "vscode-css-language-server", args: ["--stdio"] }],
    rootMarkers: ["package.json", ".git"],
  },
  {
    id: "html",
    name: "HTML",
    extensions: { ".html": "html", ".htm": "html" },
    candidates: [{ command: "vscode-html-language-server", args: ["--stdio"] }],
    rootMarkers: ["package.json", ".git"],
  },
  {
    id: "yaml",
    name: "YAML",
    extensions: { ".yaml": "yaml", ".yml": "yaml" },
    candidates: [{ command: "yaml-language-server", args: ["--stdio"] }],
    rootMarkers: [".git"],
  },
  {
    id: "toml",
    name: "TOML",
    extensions: { ".toml": "toml" },
    candidates: [{ command: "taplo", args: ["lsp", "stdio"] }],
    rootMarkers: [".git"],
  },
  {
    id: "vue",
    name: "Vue",
    extensions: { ".vue": "vue" },
    candidates: [{ command: "vue-language-server", args: ["--stdio"] }],
    rootMarkers: ["package.json", ".git"],
  },
  {
    id: "svelte",
    name: "Svelte",
    extensions: { ".svelte": "svelte" },
    candidates: [{ command: "svelteserver", args: ["--stdio"] }],
    rootMarkers: ["package.json", ".git"],
  },
  {
    id: "dart",
    name: "Dart",
    extensions: { ".dart": "dart" },
    candidates: [{ command: "dart", args: ["language-server"] }],
    rootMarkers: ["pubspec.yaml", ".git"],
  },
  {
    id: "swift",
    name: "Swift",
    extensions: { ".swift": "swift" },
    candidates: [{ command: "sourcekit-lsp", args: [] }],
    rootMarkers: ["Package.swift", ".git"],
  },
  {
    id: "kotlin",
    name: "Kotlin",
    extensions: { ".kt": "kotlin", ".kts": "kotlin" },
    candidates: [{ command: "kotlin-language-server", args: [] }],
    rootMarkers: ["build.gradle", "build.gradle.kts", ".git"],
  },
  {
    id: "scala",
    name: "Scala",
    extensions: { ".scala": "scala", ".sc": "scala" },
    candidates: [{ command: "metals", args: [] }],
    rootMarkers: ["build.sbt", ".git"],
  },
  {
    id: "elixir",
    name: "Elixir",
    extensions: { ".ex": "elixir", ".exs": "elixir" },
    candidates: [{ command: "elixir-ls", args: [] }],
    rootMarkers: ["mix.exs", ".git"],
  },
  {
    id: "zig",
    name: "Zig",
    extensions: { ".zig": "zig" },
    candidates: [{ command: "zls", args: [] }],
    rootMarkers: ["build.zig", ".git"],
  },
];

/** Lower-case extension including the leading dot ("" when there is none). */
export function fileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

const availabilityCache = new Map<string, boolean>();

/** True when `command` resolves to an executable on PATH (or an explicit file). */
export function commandExists(command: string): boolean {
  const key = command.trim();
  if (!key) return false;
  const cached = availabilityCache.get(key);
  if (cached !== undefined) return cached;
  const resolved = resolveExecutable(key) !== null;
  availabilityCache.set(key, resolved);
  return resolved;
}

/** Clear the executable-availability cache (used by tests). */
export function resetCommandAvailabilityCache(): void {
  availabilityCache.clear();
}

function resolveExecutable(command: string): string | null {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  const hasSeparator = command.includes("/") || command.includes("\\");
  if (hasSeparator) {
    const base = path.isAbsolute(command) ? command : path.resolve(command);
    if (isExecutableFile(base)) return base;
    for (const ext of exts) {
      if (isExecutableFile(`${base}${ext}`)) return `${base}${ext}`;
    }
    return null;
  }

  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const direct = path.join(dir, command);
    if (isExecutableFile(direct)) return direct;
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutableFile(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk from `startDir` up to `workspaceRoot` looking for any of `markers`.
 * Returns the closest directory containing a marker, or the workspace root when
 * none is found. Never walks above the workspace root.
 */
export async function findProjectRoot(
  startDir: string,
  markers: readonly string[],
  workspaceRoot: string,
): Promise<string> {
  const root = path.resolve(workspaceRoot);
  let dir = path.resolve(startDir);
  if (markers.length === 0) return root;

  while (true) {
    if (await hasAnyMarker(dir, markers)) return dir;
    if (dir === root) break;
    const parent = path.dirname(dir);
    const rel = path.relative(root, parent);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) break;
    dir = parent;
  }
  return root;
}

async function hasAnyMarker(dir: string, markers: readonly string[]): Promise<boolean> {
  for (const marker of markers) {
    try {
      await fsp.access(path.join(dir, marker));
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}