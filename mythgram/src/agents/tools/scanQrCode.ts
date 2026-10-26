import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/** Image extensions the QR scanner can decode (PNG + JPEG cover effectively all QR images). */
export const SUPPORTED_QR_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg"];

/** Maximum raw image bytes accepted — guards memory on huge images (mirrors read_image). */
export const MAX_QR_IMAGE_BYTES = 20 * 1024 * 1024;

const schema = z
  .object({
    image_path: z
      .string()
      .trim()
      .min(1, "image_path must be a non-empty string")
      .describe("Absolute or workspace-relative path to the image file containing the QR code."),
  })
  .strict();

/** Structured error raised by the tool with a machine readable code. */
class QrScanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "QrScanError";
  }
}

interface DecodedPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  format: "png" | "jpeg";
}

function isPngMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJpegMagic(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function decodePng(buffer: Buffer): DecodedPixels {
  let parsed: { width: number; height: number; data: Buffer };
  try {
    parsed = PNG.sync.read(buffer);
  } catch (error) {
    throw new QrScanError(
      "invalid_image_data",
      `The file does not contain valid PNG image data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed.width || !parsed.height || !parsed.data || parsed.data.length === 0) {
    throw new QrScanError("invalid_image_data", "The PNG image could not be decoded (empty pixel data).");
  }
  return {
    data: new Uint8ClampedArray(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength),
    width: parsed.width,
    height: parsed.height,
    format: "png",
  };
}

function decodeJpeg(buffer: Buffer): DecodedPixels {
  let parsed: { width: number; height: number; data: Uint8Array };
  try {
    parsed = jpeg.decode(buffer, { maxMemoryUsageInMB: 512 });
  } catch (error) {
    throw new QrScanError(
      "invalid_image_data",
      `The file does not contain valid JPEG image data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed.width || !parsed.height || !parsed.data || parsed.data.length === 0) {
    throw new QrScanError("invalid_image_data", "The JPEG image could not be decoded (empty pixel data).");
  }
  const bytes = Buffer.from(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength);
  return {
    data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    width: parsed.width,
    height: parsed.height,
    format: "jpeg",
  };
}

/**
 * Decode raw image bytes into RGBA pixels. Format is sniffed from magic bytes first so files
 * with a missing or wrong extension still decode; the extension is only used as a hint when
 * magic sniffing is inconclusive. Throws QrScanError when the bytes are not a decodable image.
 */
function decodePixels(buffer: Buffer, display: string): DecodedPixels {
  if (isPngMagic(buffer)) return decodePng(buffer);
  if (isJpegMagic(buffer)) return decodeJpeg(buffer);

  const ext = path.extname(display).toLowerCase();
  if (ext === ".png") return decodePng(buffer);
  if (ext === ".jpg" || ext === ".jpeg") return decodeJpeg(buffer);

  // Last resort: try PNG then JPEG so extensionless-but-valid images still work.
  try {
    return decodePng(buffer);
  } catch {
    // fall through to JPEG attempt below
  }
  try {
    return decodeJpeg(buffer);
  } catch {
    // fall through to the unsupported-type error below
  }
  throw new QrScanError(
    "unsupported_image_type",
    `Unsupported image type "${ext || "(none)"}". Supported formats for QR scanning: ${SUPPORTED_QR_EXTENSIONS.join(", ")}.`,
  );
}

export const scanQrCodeTool = defineTool({
  name: "scan_qr_code",
  description:
    "Scan and decode QR codes from an image file. Provide the path to the image containing the QR code. The tool returns the decoded QR code data.",
  schema,
  label: (args) => `Scan QR: ${args.image_path}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.signal?.aborted) {
      return { ok: false, error: { code: "aborted", message: "The QR scan was aborted." } };
    }

    const input = args.image_path.trim();
    if (input.length === 0) {
      return {
        ok: false,
        error: { code: "invalid_image_path", message: "image_path must be a non-empty string." },
      };
    }

    let absolute: string;
    try {
      absolute = safeResolve(ctx.workspaceRoot, input);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "invalid_image_path",
          message: error instanceof Error ? error.message : String(error),
          image_path: args.image_path,
        },
      };
    }
    const relative = toWorkspaceRelative(ctx.workspaceRoot, absolute);

    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException)?.code;
      if (errno === "ENOENT" || errno === "ENOTDIR") {
        return {
          ok: false,
          error: { code: "image_not_found", message: `Image does not exist: ${relative}`, image_path: relative },
        };
      }
      if (errno === "EACCES" || errno === "EPERM") {
        return {
          ok: false,
          error: { code: "permission_denied", message: `Permission denied while reading: ${relative}`, image_path: relative },
        };
      }
      return {
        ok: false,
        error: {
          code: "image_read_failed",
          message: `Could not stat "${relative}": ${error instanceof Error ? error.message : String(error)}`,
          image_path: relative,
        },
      };
    }

    if (stat.isDirectory()) {
      return {
        ok: false,
        error: { code: "is_directory", message: `Path is a directory, not an image file: ${relative}`, image_path: relative },
      };
    }
    if (!stat.isFile()) {
      return {
        ok: false,
        error: {
          code: "unsupported_file_type",
          message: `Path is not a regular file and cannot be scanned: ${relative}`,
          image_path: relative,
        },
      };
    }
    if (stat.size > MAX_QR_IMAGE_BYTES) {
      return {
        ok: false,
        error: {
          code: "image_too_large",
          message: `Image "${relative}" is ${stat.size} bytes, exceeding the ${MAX_QR_IMAGE_BYTES} byte limit.`,
          image_path: relative,
        },
      };
    }
    if (stat.size === 0) {
      return {
        ok: false,
        error: { code: "empty_image", message: `The image "${relative}" is empty.`, image_path: relative },
      };
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(absolute);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "image_read_failed",
          message: `Failed to read image "${relative}": ${error instanceof Error ? error.message : String(error)}`,
          image_path: relative,
        },
      };
    }

    if (ctx.signal?.aborted) {
      return { ok: false, error: { code: "aborted", message: "The QR scan was aborted." } };
    }

    let pixels: DecodedPixels;
    try {
      pixels = decodePixels(buffer, relative);
    } catch (error) {
      if (error instanceof QrScanError) {
        return { ok: false, error: { code: error.code, message: error.message, image_path: relative } };
      }
      return {
        ok: false,
        error: {
          code: "image_decode_failed",
          message: error instanceof Error ? error.message : String(error),
          image_path: relative,
        },
      };
    }

    // Scan the FULL image — jsQR locates the finder patterns itself, so the QR code is found
    // no matter where it sits in the frame (center, corner, edge, rotated, or small in a large
    // photo). Both normal and inverted (light-on-dark) codes are attempted.
    let decoded: { data: string; location: unknown } | null = null;
    try {
      decoded = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "qr_decode_failed",
          message: `Failed to scan the image for QR codes: ${error instanceof Error ? error.message : String(error)}`,
          image_path: relative,
        },
      };
    }

    if (!decoded || typeof decoded.data !== "string") {
      return {
        ok: false,
        error: {
          code: "qr_not_found",
          message: `No QR code was found in "${relative}". The image decoded (${pixels.width}x${pixels.height} ${pixels.format}) but contained no detectable QR code.`,
          image_path: relative,
        },
      };
    }

    return {
      ok: true,
      data: {
        image_path: relative,
        content: decoded.data,
        format: pixels.format,
        width: pixels.width,
        height: pixels.height,
        location: decoded.location ?? null,
        message: `Decoded QR code from "${relative}".`,
      },
    };
  },
});
