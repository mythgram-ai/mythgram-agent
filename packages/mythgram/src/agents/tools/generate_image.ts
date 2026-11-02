import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import { IMAGE_ASPECT_RATIOS, isImageAspectRatio } from "../../image-gen/types.js";

const schema = z
  .object({
    prompt: z.string().min(1).describe("Detailed description of the image to generate."),
    output_path: z
      .string()
      .min(1)
      .describe(
        "File path where the generated image will be saved (relative to the workspace). " +
          "The parent directory is created on demand; an existing file is never overwritten.",
      ),
    aspect_ratio: z
      .enum(IMAGE_ASPECT_RATIOS)
      .optional()
      .describe("Optional aspect ratio. Defaults to 1:1."),
    wait_for_output: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "If true, wait until image generation finishes and return the result. If false, start " +
          "generation in the background and return immediately without waiting for completion.",
      ),
  })
  .strict();

type GenerateImageArgs = z.infer<typeof schema>;

/** Cap the prompt the same way the engine does, so the error is caught before any network call. */
const MAX_PROMPT_CHARS = 4000;

/**
 * In-flight background generations, keyed by the absolute output path. A background
 * generation resolves to the saved result (or an error message) once it settles; the
 * `generate_image` tool with `wait_for_output: false` returns a handle immediately.
 */
const backgroundJobs = new Map<string, Promise<{ ok: true; data: unknown } | { ok: false; message: string }>>();

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

/** Ensure a unique file path inside `dirAbs` (never overwrites an existing file). */
async function uniqueTarget(dirAbs: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext) || "image";
  let candidate = path.join(dirAbs, `${stem}${ext}`);
  for (let i = 1; i < 1000; i += 1) {
    try {
      await fs.access(candidate);
      candidate = path.join(dirAbs, `${stem}_${i}${ext}`);
    } catch {
      return candidate;
    }
  }
  return path.join(dirAbs, `${stem}_${Date.now()}${ext}`);
}

/**
 * generate_image — turn a text prompt into an image and persist it to disk. The provider is
 * selected automatically (keyed built-ins → keyless Pollinations → custom) from the user's image
 * configuration, so the LLM only supplies the prompt and the target path. The image file is
 * written inside the workspace and its workspace-relative path is returned for display.
 */
export const generateImageTool = defineTool({
  name: "generate_image",
  description:
    "Generate an image from a text prompt and save it to the specified output path.",
  schema,
  label: (args: GenerateImageArgs) => {
    const target = typeof args.output_path === "string" ? args.output_path.trim() : "";
    return target ? `Generate image: ${target}` : "Generate image";
  },
  async execute(args: GenerateImageArgs, ctx: ToolContext): Promise<ToolResult> {
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) {
      return failure("empty_prompt", "The image prompt must not be empty.");
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return failure(
        "prompt_too_long",
        `The image prompt is too long (max ${MAX_PROMPT_CHARS} characters).`,
      );
    }
    if (!ctx.image) {
      return failure(
        "image_unavailable",
        "Image generation is unavailable: no image provider is configured on the backend.",
      );
    }

    const requestedAspect = typeof args.aspect_ratio === "string" ? args.aspect_ratio : "";
    const aspectRatio = isImageAspectRatio(requestedAspect)
      ? requestedAspect
      : ctx.image.defaultAspectRatio();

    let targetAbs: string;
    try {
      targetAbs = safeResolve(ctx.workspaceRoot, args.output_path);
    } catch (error) {
      return failure(
        "invalid_output_path",
        `Invalid output path "${args.output_path}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // A path ending in a separator is treated as a directory: the generated file keeps
    // its generated name inside it. Everything else is a file path; when it has no
    // extension the provider's format extension is appended after generation.
    const endsWithSeparator = /[\\/]$/.test(args.output_path);
    let dirAbs = targetAbs;
    let explicitFilename: string | null = null;
    if (!endsWithSeparator) {
      explicitFilename = path.basename(targetAbs);
      dirAbs = path.dirname(targetAbs);
    }

    try {
      await fs.mkdir(dirAbs, { recursive: true });
      const stat = await fs.stat(dirAbs);
      if (!stat.isDirectory()) {
        return failure(
          "invalid_output_path",
          `The output path "${args.output_path}" is not a valid file or directory.`,
        );
      }
    } catch (error) {
      return failure(
        "invalid_output_path",
        `Could not use the output path "${args.output_path}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const saveGeneration = async (): Promise<ToolResult> => {
      let image;
      try {
        image = await ctx.image!.generate({ prompt, aspectRatio, signal: ctx.signal });
      } catch (error) {
        return failure(
          "image_generation_failed",
          `Image generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const buffer = Buffer.from(image.base64, "base64");
      if (buffer.length === 0) {
        return failure("image_generation_failed", "The image provider returned empty data.");
      }

      try {
        const format = image.format || "png";
        const fallback = `image-${Date.now()}.${format}`;
        // Append the format extension when the requested file name has none.
        const provided =
          explicitFilename && path.extname(explicitFilename) === ""
            ? `${explicitFilename}.${format}`
            : explicitFilename;
        const finalAbs = await uniqueTarget(dirAbs, provided || image.filename || fallback);
        await fs.writeFile(finalAbs, buffer);
        return {
          ok: true,
          data: {
            prompt,
            file_path: toWorkspaceRelative(ctx.workspaceRoot, finalAbs),
            output_directory: toWorkspaceRelative(ctx.workspaceRoot, dirAbs),
            filename: path.basename(finalAbs),
            bytes: buffer.length,
            format: image.format,
            mime: image.mime,
            aspect_ratio: image.aspectRatio,
            provider: image.providerName,
            provider_id: image.providerId,
            model: image.model,
          },
        };
      } catch (error) {
        return failure(
          "image_save_failed",
          `Could not save the generated image: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    // Background mode: kick off the generation, return a handle immediately. The job is
    // remembered so a later attempt can observe its outcome (best-effort).
    if (args.wait_for_output === false) {
      const job = saveGeneration().then((result) => {
        if (result.ok) return { ok: true as const, data: result.data };
        const message = result.error?.message ?? "Image generation failed.";
        return { ok: false as const, message };
      });
      backgroundJobs.set(dirAbs, job);
      void job.finally(() => {
        // Keep the settled entry briefly so a poll can read it, then drop it.
        setTimeout(() => backgroundJobs.delete(dirAbs), 60_000).unref?.();
      });
      return {
        ok: true,
        data: {
          status: "started",
          prompt,
          output_path: toWorkspaceRelative(
            ctx.workspaceRoot,
            path.join(dirAbs, explicitFilename || ""),
          ),
          output_directory: toWorkspaceRelative(ctx.workspaceRoot, dirAbs),
          aspect_ratio: aspectRatio,
          message:
            "Image generation started in the background. The file will be saved to the output path when ready.",
        },
      };
    }

    return saveGeneration();
  },
});
