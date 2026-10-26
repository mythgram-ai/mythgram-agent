import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/** Supported image file extensions (lowercase, with a leading dot). */
export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
];

/** Maximum raw image bytes accepted — guards memory on huge local/remote images. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Timeout for fetching remote images over HTTP(S). */
const REMOTE_FETCH_TIMEOUT_MS = 60_000;
/** Virtual mount prefix the model may use to reference the workspace root. */
const WORKSPACE_MOUNT = "/workspace";

/** Field in the tool's `data` carrying the loaded image so the agent loop can inject it. */
export const IMAGE_ATTACHMENT_KEY = "image";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const schema = z.object({
  file_path: z
    .string()
    .trim()
    .min(1, "file_path must be a non-empty string")
    .describe(
      "Absolute path starting Example: project/src/image.png Or enter a live image url example: https://example.com/images/image.png",
    ),
});

const descriptionParameters = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description:
        "Absolute path starting Example: project/src/image.png Or enter a live image url example: https://example.com/images/image.png",
    },
  },
  required: ["file_path"],
};

const DESCRIPTION = `Read a image from local file system or read an image by its live url.

The loaded image is attached to the conversation as a vision input, so in your next step you can visually analyze it (describe the content, read text/OCR, inspect a UI screenshot, compare images, etc.).

Supported image formats: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}.

Usage:
- file_path must be an absolute workspace path (the workspace-relative path reported by file_list also works) OR a live hosted image URL such as https://example.com/images/image.png
- This tool only works with models that support image inputs.

${JSON.stringify(descriptionParameters, null, 2)}`;

/** Structured error raised by the tool with a machine readable code. */
class ReadImageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReadImageError";
  }
}

/** The image the tool hands back so the agent loop can feed it to the model as a vision input. */
export interface ReadImageAttachment {
  /** Base64 data URL ready to be used as an image_url content part. */
  data_url: string;
  /** MIME type of the image, e.g. image/png. */
  content_type: string;
  /** Workspace-relative path (local) or the URL the image was fetched from. */
  file_path: string;
  /** Where the image came from. */
  source: "workspace" | "url";
  /** Raw image size in bytes. */
  size_bytes: number;
}

interface LoadedImage {
  buffer: Buffer;
  contentType: string;
  filePath: string;
  source: "workspace" | "url";
  sizeBytes: number;
}

/** Pull the loaded image out of a tool result (returns null when absent). */
export function extractImageAttachment(result: ToolResult): ReadImageAttachment | null {
  if (!result?.data || typeof result.data !== "object") return null;
  const data = result.data as Record<string, unknown>;
  const attachment = data[IMAGE_ATTACHMENT_KEY];
  if (!attachment || typeof attachment !== "object") return null;
  const a = attachment as Record<string, unknown>;
  if (typeof a.data_url !== "string" || a.data_url.length === 0) return null;
  return {
    data_url: a.data_url,
    content_type: typeof a.content_type === "string" ? a.content_type : "",
    file_path: typeof a.file_path === "string" ? a.file_path : "",
    source: a.source === "url" ? "url" : "workspace",
    size_bytes: typeof a.size_bytes === "number" ? a.size_bytes : 0,
  };
}

/** Clone a tool result without the image attachment, keeping the model-visible payload small. */
export function withoutImageAttachment(result: ToolResult): ToolResult {
  if (!result?.data || typeof result.data !== "object") return result;
  const data = result.data as Record<string, unknown>;
  if (!(IMAGE_ATTACHMENT_KEY in data)) return result;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== IMAGE_ATTACHMENT_KEY) rest[key] = value;
  }
  return { ...result, data: rest };
}

/** Build a user message that carries the image as a vision content part for the model. */
export function buildImageMessage(attachment: ReadImageAttachment): {
  role: "user";
  content: Array<Record<string, unknown>>;
} {
  const source = attachment.file_path ? ` from "${attachment.file_path}"` : "";
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `The read_image tool loaded the following image${source} (${attachment.content_type || "unknown type"}). Analyze the image now.`,
      },
      { type: "image_url", image_url: { url: attachment.data_url } },
    ],
  };
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

/**
 * Resolve a model supplied path for reading. Accepts, in order:
 *  - a real absolute path already inside the workspace root,
 *  - a "/workspace/..." virtual mount (maps onto the workspace root),
 *  - a workspace-relative path (as reported by file_list).
 * Anything else absolute is rejected as escaping the workspace.
 */
function resolveWorkspaceImage(workspaceRoot: string, input: string): { absPath: string; relPath: string } {
  const trimmed = input.trim();
  const root = path.resolve(workspaceRoot);

  if (path.isAbsolute(trimmed) && (trimmed === root || trimmed.startsWith(root + path.sep))) {
    const abs = safeResolve(workspaceRoot, trimmed);
    return { absPath: abs, relPath: toWorkspaceRelative(workspaceRoot, abs) };
  }

  if (trimmed === WORKSPACE_MOUNT) {
    return { absPath: root, relPath: "." };
  }
  if (trimmed.startsWith(WORKSPACE_MOUNT + "/")) {
    const remainder = trimmed.slice(WORKSPACE_MOUNT.length).replace(/^[/\\]+/, "");
    const abs = safeResolve(workspaceRoot, remainder);
    return { absPath: abs, relPath: toWorkspaceRelative(workspaceRoot, abs) };
  }

  if (path.isAbsolute(trimmed)) {
    throw new ReadImageError(
      "invalid_file_path",
      `Absolute path "${trimmed}" is outside the workspace root (${root}).`,
    );
  }

  const abs = safeResolve(workspaceRoot, trimmed);
  return { absPath: abs, relPath: toWorkspaceRelative(workspaceRoot, abs) };
}

async function loadLocalImage(
  absPath: string,
  relPath: string,
  signal?: AbortSignal,
): Promise<LoadedImage> {
  if (signal?.aborted) throw new ReadImageError("aborted", "The image read was aborted.");

  let stat;
  try {
    stat = await fs.promises.stat(absPath);
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException)?.code;
    if (errno === "ENOENT" || errno === "ENOTDIR") {
      throw new ReadImageError("image_not_found", `Image does not exist: ${relPath}`);
    }
    if (errno === "EACCES" || errno === "EPERM") {
      throw new ReadImageError("permission_denied", `Permission denied while reading: ${relPath}`);
    }
    throw new ReadImageError(
      "image_read_failed",
      `Could not stat "${relPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (stat.isDirectory()) {
    throw new ReadImageError("is_directory", `Path is a directory, not an image file: ${relPath}`);
  }
  if (!stat.isFile()) {
    throw new ReadImageError(
      "unsupported_file_type",
      `Path is not a regular file and cannot be read as an image: ${relPath}`,
    );
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new ReadImageError(
      "image_too_large",
      `Image "${relPath}" is ${stat.size} bytes, exceeding the ${MAX_IMAGE_BYTES} byte limit.`,
    );
  }

  const extension = path.extname(absPath).toLowerCase();
  const contentType = MIME_BY_EXT[extension];
  if (!contentType) {
    throw new ReadImageError(
      "unsupported_image_type",
      `Unsupported image type "${extension || "(none)"}". Supported formats: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}.`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(absPath);
  } catch (error) {
    throw new ReadImageError(
      "image_read_failed",
      `Failed to read image "${relPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  validateSignature(contentType, buffer, relPath);
  return { buffer, contentType, filePath: relPath, source: "workspace", sizeBytes: buffer.length };
}

async function loadRemoteImage(url: string, signal?: AbortSignal): Promise<LoadedImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ReadImageError("invalid_url", `Invalid URL: "${url}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ReadImageError(
      "invalid_url",
      `Only http/https image URLs are supported. Received: "${parsed.protocol}"`,
    );
  }

  const extension = path.extname(parsed.pathname).toLowerCase();
  const contentType = MIME_BY_EXT[extension];
  if (!contentType) {
    throw new ReadImageError(
      "unsupported_image_type",
      `Unsupported image type "${extension || "(none)"}" in URL. Supported formats: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}.`,
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
    if (signal?.aborted) throw new ReadImageError("aborted", "The image fetch was aborted.");
    throw new ReadImageError(
      "fetch_failed",
      `Could not fetch image URL "${url}": ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    throw new ReadImageError("fetch_failed", `Image URL returned HTTP ${response.status}: ${url}`);
  }

  // Guard against URLs that clearly do not serve images, while tolerating hosts
  // that report generic octet-stream content types for image files.
  const declared = (response.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
  if (
    declared &&
    declared !== "application/octet-stream" &&
    !declared.startsWith("image/")
  ) {
    throw new ReadImageError(
      "not_an_image",
      `The URL did not return an image (Content-Type: "${declared}"). URL: ${url}`,
    );
  }

  if (!response.body) {
    throw new ReadImageError("fetch_failed", `No response body from URL: ${url}`);
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
        throw new ReadImageError(
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
  validateSignature(contentType, buffer, url);
  return { buffer, contentType, filePath: url, source: "url", sizeBytes: buffer.length };
}

function imageResult(loaded: LoadedImage): ToolResult {
  const attachment: ReadImageAttachment = {
    data_url: `data:${loaded.contentType};base64,${loaded.buffer.toString("base64")}`,
    content_type: loaded.contentType,
    file_path: loaded.filePath,
    source: loaded.source,
    size_bytes: loaded.sizeBytes,
  };
  return {
    ok: true,
    data: {
      file_path: loaded.filePath,
      source: loaded.source,
      content_type: loaded.contentType,
      size_bytes: loaded.sizeBytes,
      [IMAGE_ATTACHMENT_KEY]: attachment,
    },
  };
}

/** Light magic-byte validation for the supported formats; catches non-image data early. */
function validateSignature(contentType: string, buffer: Buffer, display: string): void {
  if (buffer.length === 0) {
    throw new ReadImageError("empty_image", `The image "${display}" is empty.`);
  }
  const check = SIGNATURE_CHECKERS[contentType];
  if (!check) return;
  if (!check(buffer)) {
    throw new ReadImageError(
      "invalid_image_data",
      `The file "${display}" does not contain valid ${contentType} image data.`,
    );
  }
}

const SIGNATURE_CHECKERS: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a,
  "image/gif": (b) =>
    b.length >= 6 &&
    (b.toString("latin1", 0, 6) === "GIF87a" || b.toString("latin1", 0, 6) === "GIF89a"),
  "image/webp": (b) =>
    b.length >= 12 &&
    b.toString("latin1", 0, 4) === "RIFF" &&
    b.toString("latin1", 8, 12) === "WEBP",
  "image/heic": isIsoBmff,
  "image/heif": isIsoBmff,
};

const HEIF_BRANDS: readonly string[] = [
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heif",
  "mif1",
  "msf1",
  "hevm",
  "heim",
  "avis",
];

/** HEIC/HEIF are ISO BMFF files: bytes 4..8 are "ftyp", bytes 8..12 the major brand. */
function isIsoBmff(b: Buffer): boolean {
  if (b.length < 12) return false;
  if (b.toString("latin1", 4, 8) !== "ftyp") return false;
  return HEIF_BRANDS.includes(b.toString("latin1", 8, 12));
}

export const readImageTool = defineTool({
  name: "read_image",
  description: DESCRIPTION,
  schema,
  label: (args) => `Read Image: ${args.file_path}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const input = args.file_path.trim();

    // Vision capability guard: reading an image is only possible when the selected
    // model accepts image inputs. Check before doing any network/disk work.
    if (ctx.visionCapable === false) {
      return {
        ok: false,
        error: {
          code: "model_not_vision_capable",
          message:
            `The selected model${ctx.model ? ` "${ctx.model}"` : ""} does not support image inputs, so read_image cannot be used. ` +
            "Switch to a vision-capable model (e.g. GPT-4o, Claude, Gemini) to read images.",
          model: ctx.model ?? null,
        },
      };
    }

    if (input.length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid_file_path",
          message: "file_path must be a non-empty string.",
          file_path: args.file_path,
        },
      };
    }

    try {
      if (isHttpUrl(input)) {
        return imageResult(await loadRemoteImage(input, ctx.signal));
      }
      const { absPath, relPath } = resolveWorkspaceImage(ctx.workspaceRoot, input);
      return imageResult(await loadLocalImage(absPath, relPath, ctx.signal));
    } catch (error) {
      if (error instanceof ReadImageError) {
        return { ok: false, error: { code: error.code, message: error.message, file_path: input } };
      }
      return {
        ok: false,
        error: {
          code: "image_read_failed",
          message: error instanceof Error ? error.message : String(error),
          file_path: input,
        },
      };
    }
  },
});
