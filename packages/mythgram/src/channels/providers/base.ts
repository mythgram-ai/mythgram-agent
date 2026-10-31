import fs from "node:fs/promises";
import path from "node:path";
import { mimeTypeFromPath } from "../../utils/mime.js";

/** Upload folder (inside the workspace) where channel attachments are stored. */
export const CHANNEL_UPLOADS_DIR = "uploads";

/** Per-file attachment limit: 300 MB (mirrors the /api/files/upload limit). */
export const MAX_ATTACHMENT_BYTES = 300 * 1024 * 1024;

/** Strip directories/traversal from a client filename and keep it filesystem-safe. */
export function sanitizeUploadName(raw: string): string {
  const base = path.basename(String(raw ?? "")).trim().replace(/\\/g, "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
  return cleaned || `upload_${Date.now()}`;
}

/** Unique absolute target inside <workspace>/uploads for a sanitized name (no overwrite). */
export async function uniqueUploadTarget(uploadsAbs: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext) || "upload";
  let candidate = path.join(uploadsAbs, `${stem}${ext}`);
  for (let i = 1; i < 1000; i += 1) {
    try {
      await fs.access(candidate);
      candidate = path.join(uploadsAbs, `${stem}_${i}${ext}`);
    } catch {
      return candidate;
    }
  }
  return path.join(uploadsAbs, `${stem}_${Date.now()}${ext}`);
}

/** Save downloaded bytes as a workspace upload; returns the absolute path + size. */
export async function saveUpload(
  workspaceRoot: string,
  filename: string,
  data: Buffer,
): Promise<{ absolutePath: string; size: number }> {
  const uploadsAbs = path.join(workspaceRoot, CHANNEL_UPLOADS_DIR);
  await fs.mkdir(uploadsAbs, { recursive: true });
  const target = await uniqueUploadTarget(uploadsAbs, sanitizeUploadName(filename));
  await fs.writeFile(target, data);
  const stat = await fs.stat(target);
  return { absolutePath: target, size: stat.size };
}

/** Best-effort MIME type for a file name (never throws). */
export function mimeOf(filename: string): string {
  try {
    return mimeTypeFromPath(filename);
  } catch {
    return "application/octet-stream";
  }
}

/** Download a URL into memory with a timeout + size cap. Throws on failure. */
export async function downloadUrl(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> },
): Promise<Buffer> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const maxBytes = opts?.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: opts?.headers, signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed with HTTP ${res.status}.`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`Download exceeds the ${MAX_ATTACHMENT_BYTES} byte limit.`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

/** Split outbound text into provider-safe chunks (never splits an empty message). */
export function chunkText(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Prefer a newline boundary so code blocks / lists stay readable.
    let cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0) out.push(rest);
  return out.length > 0 ? out : [text];
}

/** Sleep that resolves early when the abort signal fires (true = aborted). */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
