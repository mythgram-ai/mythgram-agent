import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

const schema = z
  .object({
    speech: z.string().describe("The text to convert into speech."),
    output_directory: z
      .string()
      .describe("The directory where the generated audio file will be saved."),
  })
  .strict();

type GenerateSpeechArgs = z.infer<typeof schema>;

/** Cap the input the same way the TTS engine does, so the error is caught before any network call. */
const MAX_SPEECH_CHARS = 40_000;

/** Pick a non-colliding target path for `filename` inside `dirAbs` (never overwrites). */
async function uniqueTarget(dirAbs: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext) || "speech";
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

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

/**
 * generate_speech — convert text into spoken audio and persist it to disk. The provider is
 * selected automatically (cloud → custom → local) from the user's TTS configuration, so the LLM
 * only supplies the text and the target directory. The audio file is written inside the workspace
 * and its workspace-relative path is returned for playback.
 */
export const generateSpeechTool = defineTool({
  name: "generate_speech",
  description:
    "Generate spoken audio from text and save the generated audio file to the specified output directory.",
  schema,
  label: (args: GenerateSpeechArgs) => {
    const dir = typeof args.output_directory === "string" ? args.output_directory.trim() : "";
    return dir ? `Generate speech: ${dir}` : "Generate speech";
  },
  async execute(args: GenerateSpeechArgs, ctx: ToolContext): Promise<ToolResult> {
    const speech = typeof args.speech === "string" ? args.speech.trim() : "";
    if (!speech) {
      return failure("empty_speech", "The speech text must not be empty.");
    }
    if (speech.length > MAX_SPEECH_CHARS) {
      return failure(
        "speech_too_long",
        `The speech text is too long (max ${MAX_SPEECH_CHARS} characters).`,
      );
    }
    if (!ctx.speech) {
      return failure(
        "speech_unavailable",
        "Speech generation is unavailable: no text-to-speech engine is configured on the backend.",
      );
    }

    let dirAbs: string;
    try {
      dirAbs = safeResolve(ctx.workspaceRoot, args.output_directory);
    } catch (error) {
      return failure(
        "invalid_output_directory",
        `Invalid output directory "${args.output_directory}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await fs.mkdir(dirAbs, { recursive: true });
      const stat = await fs.stat(dirAbs);
      if (!stat.isDirectory()) {
        return failure(
          "invalid_output_directory",
          `The output path "${args.output_directory}" is not a directory.`,
        );
      }
    } catch (error) {
      return failure(
        "invalid_output_directory",
        `Could not use the output directory "${args.output_directory}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let audio;
    try {
      audio = await ctx.speech.synthesize({ text: speech, signal: ctx.signal });
    } catch (error) {
      return failure(
        "speech_generation_failed",
        `Speech generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const buffer = Buffer.from(audio.base64, "base64");
    if (buffer.length === 0) {
      return failure("speech_generation_failed", "The TTS provider returned empty audio.");
    }

    let targetAbs: string;
    try {
      targetAbs = await uniqueTarget(dirAbs, audio.filename || `speech.${audio.format || "mp3"}`);
      await fs.writeFile(targetAbs, buffer);
    } catch (error) {
      return failure(
        "speech_save_failed",
        `Could not save the generated audio: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      ok: true,
      data: {
        speech,
        file_path: toWorkspaceRelative(ctx.workspaceRoot, targetAbs),
        output_directory: toWorkspaceRelative(ctx.workspaceRoot, dirAbs),
        filename: path.basename(targetAbs),
        bytes: buffer.length,
        format: audio.format,
        mime: audio.mime,
        provider: audio.providerName,
        provider_id: audio.providerId,
        model: audio.model,
        voice: audio.voice,
      },
    };
  },
});
