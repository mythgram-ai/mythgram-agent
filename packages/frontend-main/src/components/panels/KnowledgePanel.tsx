import { useRef, useState } from "react";
import {
  Check,
  Download,
  FilePlus2,
  FileText,
  FolderUp,
  Globe,
  Library,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { KnowledgeSource, ScrapeResult } from "@/types";
import { normalizeKnowledgePath } from "@/lib/defaultKnowledge";
import { scrapeUrl, type ScrapeHeader } from "@/lib/api";
import { fileBadge } from "@/utils/format";
import { Modal } from "@/components/ui/Modal";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const TEXT_EXTENSIONS = new Set(
  "md markdown txt text rst adoc json jsonl yaml yml toml ini env csv tsv js jsx ts tsx mjs cjs py rb go rs java kt c h cpp hpp cs php swift sh bash zsh html htm css scss less xml svg sql graphql gql vue svelte astro log conf cfg properties gitignore dockerfile".split(
    " ",
  ),
);
const MAX_UPLOAD_BYTES = 1_000_000;

type View =
  | { kind: "none" }
  | { kind: "editor"; original: string; path: string; content: string; isNew: boolean }
  | { kind: "upload" }
  | { kind: "url"; editingPath?: string };

export function KnowledgePanel() {
  const knowledge = useStore((s) => s.knowledge);
  const knowledgeSources = useStore((s) => s.knowledgeSources);
  const deleteKnowledgeFile = useStore((s) => s.deleteKnowledgeFile);
  const [view, setView] = useState<View>({ kind: "none" });

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Sources Haku can read" title="Knowledge base" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Reference material the agent can read and maintain. Add files manually, upload a file or
        folder, or fetch a URL — everything is stored locally in your browser.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <MethodButton icon={<FilePlus2 className="h-5 w-5" />} label="New file" hint="Create manually" onClick={() => setView({ kind: "editor", original: "", path: "", content: "", isNew: true })} />
        <MethodButton icon={<Upload className="h-5 w-5" />} label="Upload" hint="Files or folder" onClick={() => setView({ kind: "upload" })} />
        <MethodButton icon={<Globe className="h-5 w-5" />} label="URL" hint="Fetch & save" onClick={() => setView({ kind: "url" })} />
      </div>

      {knowledge.length === 0 ? (
        <EmptyState icon={<Library className="h-8 w-8" />}>
          No knowledge files yet. Add some with the options above.
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {knowledge.map((f) => {
            const source = knowledgeSources[f.path];
            return (
              <li
                key={f.path}
                className="group flex items-center gap-4 rounded-[var(--radius-xl)] bg-[var(--bg)] px-4 py-3.5 transition-colors hover:bg-[var(--chip)]"
                style={{ boxShadow: "var(--shadow-chip)" }}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-xs font-semibold tracking-[0.06em] text-[var(--secondary-fg)]">
                  {source ? "URL" : fileBadge(f.path)}
                </span>
                <button onClick={() => setView({ kind: "editor", original: f.path, path: f.path, content: f.content, isNew: false })} className="min-w-0 flex-1 text-left">
                  <p className="m-0 truncate text-sm font-medium text-[var(--fg)]">
                    <span className="font-mono">knowledge/{f.path}</span>
                  </p>
                  <p className="line-clamp-2 m-0 mt-0.5 text-sm text-[var(--muted)]">
                    {f.content.trim().slice(0, 160) || "(empty)"} · {f.content.length} chars
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {source && (
                    <button onClick={() => setView({ kind: "url", editingPath: f.path })} title="Refetch" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip-hover)] hover:text-[var(--fg)]">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => setView({ kind: "editor", original: f.path, path: f.path, content: f.content, isNew: false })} title="Edit" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip-hover)] hover:text-[var(--fg)]">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => deleteKnowledgeFile(f.path)} title="Delete" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <KnowledgeModal view={view} onClose={() => setView({ kind: "none" })} />
    </div>
  );
}

function MethodButton({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-3 text-left transition-colors hover:border-[var(--secondary)] hover:bg-[var(--chip)]"
    >
      <span className="text-[var(--secondary)]">{icon}</span>
      <span className="text-xs font-medium text-[var(--fg)]">{label}</span>
      <span className="text-[10px] text-[var(--subtle)]">{hint}</span>
    </button>
  );
}

function KnowledgeModal({ view, onClose }: { view: View; onClose: () => void }) {
  const title =
    view.kind === "editor"
      ? view.isNew
        ? "New knowledge file"
        : "Edit knowledge file"
      : view.kind === "upload"
        ? "Upload files or folder"
        : view.kind === "url"
          ? view.editingPath
            ? "Refetch from URL"
            : "Fetch from URL"
          : "";

  return (
    <Modal open={view.kind !== "none"} onClose={onClose} icon={<Library className="h-4 w-4" />} title={title} size="lg">
      {view.kind === "editor" && <EditorView view={view} onClose={onClose} />}
      {view.kind === "upload" && <UploadView onClose={onClose} />}
      {view.kind === "url" && <UrlView editingPath={view.editingPath} onClose={onClose} />}
    </Modal>
  );
}

function EditorView({ view, onClose }: { view: Extract<View, { kind: "editor" }>; onClose: () => void }) {
  const saveKnowledgeFile = useStore((s) => s.saveKnowledgeFile);
  const [path, setPath] = useState(view.path);
  const [content, setContent] = useState(view.content);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const clean = normalizeKnowledgePath(path);
    if (!clean) return setError("A file path is required.");
    const err = saveKnowledgeFile(clean, content, view.isNew ? undefined : view.original);
    if (err) return setError(err);
    onClose();
  };

  return (
    <div className="space-y-4 p-5">
      <Field label="File path">
        <TextInput value={path} onChange={(e) => setPath(e.target.value)} placeholder="e.g. docs.md or api/reference.md" className="font-mono" />
      </Field>
      <Field label="Content" hint={`${content.length} chars`}>
        <TextArea rows={16} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Durable reference knowledge the agent can read…" />
      </Field>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={save}>
          <Check className="h-4 w-4" /> Save
        </Button>
      </div>
    </div>
  );
}

function UploadView({ onClose }: { onClose: () => void }) {
  const saveKnowledgeFile = useStore((s) => s.saveKnowledgeFile);
  const [parsed, setParsed] = useState<Array<{ path: string; content: string }>>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const handle = async (list: FileList | null) => {
    if (!list) return;
    setBusy(true);
    const nextSkipped: string[] = [];
    const map = new Map(parsed.map((p) => [p.path.toLowerCase(), p]));
    for (const file of Array.from(list)) {
      const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const path = normalizeKnowledgePath(raw);
      if (!path) continue;
      const ext = (path.split(".").pop() ?? "").toLowerCase();
      const isText = TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/");
      if (!isText) {
        nextSkipped.push(`${path} (unsupported type)`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        nextSkipped.push(`${path} (too large)`);
        continue;
      }
      try {
        map.set(path.toLowerCase(), { path, content: await file.text() });
      } catch {
        nextSkipped.push(`${path} (unreadable)`);
      }
    }
    setParsed([...map.values()].sort((a, b) => a.path.localeCompare(b.path)));
    setSkipped((s) => [...s, ...nextSkipped]);
    setBusy(false);
  };

  const saveAll = () => {
    const existing = new Set(useStore.getState().knowledge.map((f) => f.path.toLowerCase()));
    for (const f of parsed) {
      saveKnowledgeFile(f.path, f.content, existing.has(f.path.toLowerCase()) ? f.path : undefined);
    }
    onClose();
  };

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-[var(--muted)]">Upload individual files or a whole folder. Only text-based files under 1 MB are accepted.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <Upload className="h-4 w-4" /> Choose files
        </Button>
        <Button variant="outline" onClick={() => folderInput.current?.click()}>
          <FolderUp className="h-4 w-4" /> Choose folder
        </Button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { handle(e.target.files); e.target.value = ""; }} />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          // @ts-expect-error non-standard directory attributes
          webkitdirectory=""
          directory=""
          onChange={(e) => { handle(e.target.files); e.target.value = ""; }}
        />
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading files…
        </div>
      )}

      {parsed.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-auto">
          {parsed.map((f) => (
            <li key={f.path} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 text-[var(--muted)]" />
              <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
              <span className="text-[var(--subtle)]">{f.content.length} chars</span>
              <button onClick={() => setParsed((p) => p.filter((x) => x.path !== f.path))} className="text-[var(--subtle)] hover:text-[var(--danger)]">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <div className="rounded-[var(--radius-md)] border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, var(--warning) 32%, transparent)", background: "var(--warning-soft)", color: "var(--warning)" }}>
          Skipped: {skipped.join(", ")}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={saveAll} disabled={parsed.length === 0}>
          <Check className="h-4 w-4" /> Add {parsed.length} to knowledge
        </Button>
      </div>
    </div>
  );
}

function suggestPathFromUrl(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!p) p = u.hostname.replace(/^www\./, "");
    p = normalizeKnowledgePath(p);
    if (!p) return "docs/docs.md";
    return `${p}.md`;
  } catch {
    return "docs/docs.md";
  }
}

function UrlView({ editingPath, onClose }: { editingPath?: string; onClose: () => void }) {
  const saveKnowledgeFile = useStore((s) => s.saveKnowledgeFile);
  const setKnowledgeSource = useStore((s) => s.setKnowledgeSource);
  const existing = useStore((s) => (editingPath ? s.knowledgeSources[editingPath] : undefined));

  const [method, setMethod] = useState<"get" | "curl">(existing?.curl ? "curl" : "get");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [format, setFormat] = useState<KnowledgeSource["format"]>(existing?.format ?? "markdown");
  const [headers, setHeaders] = useState<ScrapeHeader[]>(existing?.headers ?? []);
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");
  const [curl, setCurl] = useState(existing?.curl ?? "");
  const [showOptions, setShowOptions] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [savePath, setSavePath] = useState(editingPath ?? "");
  const [error, setError] = useState<string | null>(null);

  const canFetch = method === "get" ? url.trim().length > 0 : curl.trim().length > 0;

  const doFetch = async () => {
    setError(null);
    setResult(null);
    setFetching(true);
    try {
      const res = await scrapeUrl({
        url: method === "get" ? url.trim() : undefined,
        curl: method === "curl" ? curl.trim() : undefined,
        format,
        headers: method === "get" ? headers : undefined,
        apiKey: method === "get" ? apiKey.trim() || undefined : undefined,
      });
      setResult(res);
      if (!editingPath && !savePath) setSavePath(suggestPathFromUrl(res.url || url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const save = () => {
    if (!result) return;
    const path = normalizeKnowledgePath(savePath);
    if (!path) return setError("A file name is required to save.");
    const exists = useStore.getState().knowledge.some((f) => f.path.toLowerCase() === path.toLowerCase());
    const err = saveKnowledgeFile(path, result.content, exists ? path : undefined);
    if (err) return setError(err);
    setKnowledgeSource(path, {
      url: method === "get" ? url.trim() : "",
      format,
      headers: method === "get" && headers.length > 0 ? headers : undefined,
      apiKey: method === "get" ? apiKey.trim() || undefined : undefined,
      curl: method === "curl" ? curl.trim() : undefined,
      fetchedAt: Date.now(),
    });
    onClose();
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
        {(["get", "curl"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={cn("flex-1 px-3 py-2 text-sm font-medium transition-colors", method === m ? "bg-[var(--secondary)] text-[var(--secondary-fg)]" : "text-[var(--muted)] hover:bg-[var(--chip)]")}
          >
            {m === "get" ? "GET request" : "Paste cURL"}
          </button>
        ))}
      </div>

      {method === "get" ? (
        <>
          <Field label="URL">
            <TextInput type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.example.com/api" />
          </Field>
          <button onClick={() => setShowOptions((v) => !v)} className="text-xs font-medium text-[var(--secondary)] hover:underline">
            {showOptions ? "Hide" : "Show"} advanced options (headers, API key)
          </button>
          {showOptions && (
            <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <Field label="API key (optional)" hint="sent as Bearer">
                <TextInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
              </Field>
              <div>
                <div className="mb-1.5 text-xs font-medium text-[var(--muted)]">Custom headers</div>
                <div className="space-y-2">
                  {headers.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <TextInput value={h.key} onChange={(e) => setHeaders((hs) => hs.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)))} placeholder="Header" />
                      <TextInput value={h.value} onChange={(e) => setHeaders((hs) => hs.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))} placeholder="Value" />
                      <button onClick={() => setHeaders((hs) => hs.filter((_, xi) => xi !== i))} className="shrink-0 text-[var(--subtle)] hover:text-[var(--danger)]">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <Button variant="ghost" onClick={() => setHeaders((hs) => [...hs, { key: "", value: "" }])}>
                    <Plus className="h-3.5 w-3.5" /> Add header
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <Field label="cURL command" hint="URL & -H headers are parsed">
          <TextArea rows={5} value={curl} onChange={(e) => setCurl(e.target.value)} placeholder={"curl https://api.example.com/docs \\\n  -H 'Authorization: Bearer …'"} className="font-mono text-xs" />
        </Field>
      )}

      <Field label="Output format">
        <Select value={format} onChange={(e) => setFormat(e.target.value as KnowledgeSource["format"])}>
          <option value="markdown">Markdown</option>
          <option value="text">Plain text</option>
          <option value="json">JSON</option>
          <option value="autodetect">Auto-detect</option>
        </Select>
      </Field>

      <Button onClick={doFetch} disabled={!canFetch || fetching} className="w-full">
        {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : editingPath ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        {fetching ? "Fetching…" : editingPath ? "Refetch" : "Fetch"}
      </Button>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      {result && (
        <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[var(--success)]">
              <Check className="h-2.5 w-2.5" /> Fetched
            </span>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">{result.status}</span>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">{result.format}</span>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">{result.content.length} chars</span>
          </div>
          {result.title && <div className="text-sm font-medium">{result.title}</div>}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--chip)] p-2 font-mono text-[11px] text-[var(--fg)]">
            {result.content.slice(0, 4000) || "(empty response)"}
            {result.content.length > 4000 ? "\n… (truncated preview)" : ""}
          </pre>
          <Field label="Save as" hint="under knowledge/">
            <TextInput value={savePath} onChange={(e) => setSavePath(e.target.value)} placeholder="docs/docs.md" className="font-mono" />
          </Field>
          <div className="flex justify-end">
            <Button onClick={save}>
              <Check className="h-4 w-4" /> Save to knowledge
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
