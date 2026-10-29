import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import Tesseract from "tesseract.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/**
 * Extract text from an image with Tesseract.js (OCR). The image may be a publicly reachable
 * HTTP/HTTPS URL or a local file inside the workspace. Unlike read_image — which attaches the
 * image to the model's vision input and requires a vision-capable model — this tool runs OCR on
 * the bytes locally and returns the recognized TEXT, so it works with any model.
 */

/** Language(s) loaded by default. "eng" ships first and keeps first-run downloads small. */
const DEFAULT_LANGUAGES = "eng";

/** Maximum raw image bytes accepted — guards memory on huge local/remote images. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Timeout for fetching remote images over HTTP(S). */
const REMOTE_FETCH_TIMEOUT_MS = 60_000;
/** Hard ceiling on a single OCR run so a stuck worker can never hang the turn forever. */
const OCR_TIMEOUT_MS = 120_000;
/** Virtual mount prefix the model may use to reference the workspace root. */
const WORKSPACE_MOUNT = "/workspace";

const schema = z
  .object({
    image_source: z
      .string()
      .trim()
      .min(1, "image_source must be a non-empty string")
      .describe(
        "The image to process. Provide either a publicly accessible HTTP/HTTPS image URL or an absolute local file path.",
      ),
  })
  .strict();

/** Structured error raised by the tool with a machine readable code. */
class FetchTextError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FetchTextError";
  }
}

interface LoadedImage {
  buffer: Buffer;
  /** Human-facing source path (workspace-relative for local files, the URL otherwise). */
  display: string;
  source: "workspace" | "url";
  sizeBytes: number;
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

/**
 * Resolve a model supplied local path for reading. Accepts, in order: a real absolute path inside
 * the workspace root, a "/workspace/..." virtual mount, or a workspace-relative path. Any other
 * absolute path is rejected as escaping the workspace (mirrors read_image).
 */
function resolveWorkspaceImage(
  workspaceRoot: string,
  input: string,
): { absPath: string; relPath: string } {
  const trimmed = input.trim();
  const root = path.resolve(workspaceRoot);

  const resolveSafely = (value: string): string => {
    try {
      return safeResolve(workspaceRoot, value);
    } catch (error) {
      throw new FetchTextError(
        "invalid_file_path",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  if (path.isAbsolute(trimmed) && (trimmed === root || trimmed.startsWith(root + path.sep))) {
    const abs = resolveSafely(trimmed);
    return { absPath: abs, relPath: toWorkspaceRelative(workspaceRoot, abs) };
  }

  if (trimmed === WORKSPACE_MOUNT) {
    return { absPath: root, relPath: "." };
  }
  if (trimmed.startsWith(WORKSPACE_MOUNT + "/")) {
    const remainder = trimmed.slice(WORKSPACE_MOUNT.length).replace(/^[/\\]+/, "");
    const abs = resolveSafely(remainder);
    return { absPath: abs, relPath: toWorkspaceRelative(workspaceRoot, abs) };
  }

  if (path.isAbsolute(trimmed)) {
    throw new FetchTextError(
      "invalid_file_path",
      `Absolute path "${trimmed}" is outside the workspace root (${root}).`,
    );
  }

  const abs = resolveSafely(trimmed);
  return { absPath: abs, relPath: toWorkspaceRelative(workspaceRoot, abs) };
}

async function loadLocalImage(
  absPath: string,
  relPath: string,
  signal?: AbortSignal,
): Promise<LoadedImage> {
  if (signal?.aborted) throw new FetchTextError("aborted", "The image read was aborted.");

  let stat;
  try {
    stat = await fs.promises.stat(absPath);
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException)?.code;
    if (errno === "ENOENT" || errno === "ENOTDIR") {
      throw new FetchTextError("image_not_found", `Image does not exist: ${relPath}`);
    }
    if (errno === "EACCES" || errno === "EPERM") {
      throw new FetchTextError("permission_denied", `Permission denied while reading: ${relPath}`);
    }
    throw new FetchTextError(
      "image_read_failed",
      `Could not stat "${relPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (stat.isDirectory()) {
    throw new FetchTextError("is_directory", `Path is a directory, not an image file: ${relPath}`);
  }
  if (!stat.isFile()) {
    throw new FetchTextError(
      "unsupported_file_type",
      `Path is not a regular file and cannot be read as an image: ${relPath}`,
    );
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new FetchTextError(
      "image_too_large",
      `Image "${relPath}" is ${stat.size} bytes, exceeding the ${MAX_IMAGE_BYTES} byte limit.`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(absPath);
  } catch (error) {
    throw new FetchTextError(
      "image_read_failed",
      `Failed to read image "${relPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  assertImageBytes(buffer, relPath);
  return { buffer, display: relPath, source: "workspace", sizeBytes: buffer.length };
}

async function loadRemoteImage(url: string, signal?: AbortSignal): Promise<LoadedImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchTextError("invalid_url", `Invalid URL: "${url}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FetchTextError(
      "invalid_url",
      `Only http/https image URLs are supported. Received: "${parsed.protocol}"`,
    );
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  signal?.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw new FetchTextError("aborted", "The image fetch was aborted.");
    throw new FetchTextError(
      "fetch_failed",
      `Could not fetch image URL "${url}": ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    throw new FetchTextError("fetch_failed", `Image URL returned HTTP ${response.status}: ${url}`);
  }

  // Tolerate hosts that report a generic content type for image files, but reject clearly
  // non-image payloads (e.g. HTML error pages) before running OCR on them.
  const declared = (response.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
  if (declared && declared !== "application/octet-stream" && !declared.startsWith("image/")) {
    throw new FetchTextError(
      "not_an_image",
      `The URL did not return an image (Content-Type: "${declared}"). URL: ${url}`,
    );
  }

  if (!response.body) {
    throw new FetchTextError("fetch_failed", `No response body from URL: ${url}`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        throw new FetchTextError(
          "image_too_large",
          `Image URL exceeds the ${MAX_IMAGE_BYTES} byte limit: ${url}`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks);
  assertImageBytes(buffer, url);
  return { buffer, display: url, source: "url", sizeBytes: buffer.length };
}

/**
 * Light magic-byte sniff so OCR is only attempted on real image data. Recognizes the formats
 * Tesseract's Leptonica backend can read: PNG, JPEG, GIF, BMP, TIFF and PNM.
 */
function isSupportedImageBytes(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  // PNG
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // GIF ("GIF87a" / "GIF89a")
  if (buffer.length >= 6) {
    const header = buffer.toString("latin1", 0, 6);
    if (header === "GIF87a" || header === "GIF89a") return true;
  }
  // BMP ("BM")
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return true;
  // TIFF (little-endian "II*\0" or big-endian "MM\0*")
  if (buffer.length >= 4) {
    const isLittle = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
    const isBig = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
    if (isLittle || isBig) return true;
  }
  // PNM (PBM/PGM/PPM: "P1".."P6")
  if (buffer[0] === 0x50 && buffer[1] >= 0x31 && buffer[1] <= 0x36) return true;
  return false;
}

function assertImageBytes(buffer: Buffer, display: string): void {
  if (buffer.length === 0) {
    throw new FetchTextError("empty_image", `The image "${display}" is empty.`);
  }
  if (!isSupportedImageBytes(buffer)) {
    throw new FetchTextError(
      "unsupported_image_type",
      `The file "${display}" does not contain a supported image format (PNG, JPEG, GIF, BMP, TIFF or PNM).`,
    );
  }
}

interface OcrOutcome {
  text: string;
  confidence: number;
}

/**
 * Directory Tesseract caches its downloaded language data in. Prefers "<workspace>/.mythgram/tesseract"
 * (persistent per workspace and already gitignored) and falls back to the OS temp directory when the
 * workspace is not writable, so a first OCR run never litters the package/working directory.
 */
function resolveCachePath(workspaceRoot: string): string {
  const preferred = path.join(workspaceRoot, ".mythgram", "tesseract");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), "mythgram-tesseract");
    try {
      fs.mkdirSync(fallback, { recursive: true });
    } catch {
      // Last resort: let Tesseract use its own default (the current working directory).
      return "";
    }
    return fallback;
  }
}

/** Run Tesseract OCR on the image bytes, honoring the turn's abort signal and a hard timeout. */
async function runOcr(
  buffer: Buffer,
  languages: string,
  signal: AbortSignal | undefined,
  cachePath: string,
): Promise<OcrOutcome> {
  if (signal?.aborted) throw new FetchTextError("aborted", "The OCR run was aborted.");

  let worker: Tesseract.Worker | null = null;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;

  // Guard the whole operation so a slow/hung worker never blocks the turn indefinitely.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new FetchTextError("ocr_timeout", `OCR exceeded the ${OCR_TIMEOUT_MS} ms time limit.`)),
      OCR_TIMEOUT_MS,
    );
  });

  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () =>
      reject(new FetchTextError("aborted", "The OCR run was aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const work = (async (): Promise<OcrOutcome> => {
      worker = await Tesseract.createWorker(languages, undefined, {
        // Silence Tesseract's progress logging; the agent loop owns user-facing events.
        logger: () => {},
        errorHandler: () => {},
        ...(cachePath ? { cachePath } : {}),
      });
      const { data } = await worker.recognize(buffer);
      return {
        text: typeof data.text === "string" ? data.text : "",
        confidence: typeof data.confidence === "number" ? data.confidence : 0,
      };
    })();

    return await Promise.race([work, timeout, aborted]);
  } catch (error) {
    if (error instanceof FetchTextError) throw error;
    throw new FetchTextError(
      "ocr_failed",
      `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    const activeWorker = worker as Tesseract.Worker | null;
    if (activeWorker) {
      // Terminating releases the WASM core + in-flight job; never let it mask the real result.
      try {
        await activeWorker.terminate();
      } catch {
        // ignore termination errors
      }
    }
  }
}

export const fetchTextFromImageTool = defineTool({
  name: "fetch_text_from_image",
  description:
    "Use this tool whenever you need to extract, read, or analyze text contained in an image. " +
    "Provide the image source as either a publicly accessible HTTP/HTTPS image URL or an absolute " +
    "local file path. Use this tool when a task requires reading screenshots, scanned documents, " +
    "photographs, receipts, signs, handwritten notes, or other images containing text. Pass the " +
    "image source in the image_source parameter. Ensure that local file paths are absolute and that " +
    "remote image URLs are accessible. After receiving the result, use the extracted text to " +
    "continue the user's task.",
  schema,
  label: (args) => `Fetch Text From Image: ${args.image_source}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const input = args.image_source.trim();
    if (input.length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid_image_source",
          message: "image_source must be a non-empty string.",
          image_source: args.image_source,
        },
      };
    }

    try {
      // A value carrying a non-http(s) URL scheme (e.g. "ftp://...") is rejected up front rather
      // than being mistaken for a workspace-relative file path.
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) && !isHttpUrl(input)) {
        throw new FetchTextError(
          "invalid_url",
          `Only http/https image URLs are supported. Received: "${input}".`,
        );
      }

      const loaded = isHttpUrl(input)
        ? await loadRemoteImage(input, ctx.signal)
        : await (async () => {
            const { absPath, relPath } = resolveWorkspaceImage(ctx.workspaceRoot, input);
            return loadLocalImage(absPath, relPath, ctx.signal);
          })();

      const outcome = await runOcr(loaded.buffer, DEFAULT_LANGUAGES, ctx.signal, resolveCachePath(ctx.workspaceRoot));
      const text = outcome.text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

      return {
        ok: true,
        data: {
          image_source: loaded.display,
          source: loaded.source,
          size_bytes: loaded.sizeBytes,
          language: DEFAULT_LANGUAGES,
          text,
          character_count: text.length,
          confidence: outcome.confidence,
        },
      };
    } catch (error) {
      if (error instanceof FetchTextError) {
        return {
          ok: false,
          error: { code: error.code, message: error.message, image_source: input },
        };
      }
      return {
        ok: false,
        error: {
          code: "fetch_text_from_image_failed",
          message: error instanceof Error ? error.message : String(error),
          image_source: input,
        },
      };
    }
  },
});
