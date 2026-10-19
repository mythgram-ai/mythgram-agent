import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { synthesizeSpeechFile, ttsNotConfiguredResult } from "../../tts/engine.js";
import type { TtsToolsConfig } from "../../tts/types.js";

/**
 * generate_speech — the LLM-facing voice-generation tool.
 *
 * The text to speak is the ONLY model-supplied input: the voice, model,
 * provider and every other setting are entirely user-owned (chosen in the TTS
 * panel and carried per-turn in ctx.tts). When no TTS provider is connected
 * the tool returns a clear structured error instead of failing silently.
 *
 * The generated audio file is saved in the user's workspace and surfaced live
 * to the frontend via a `generate_speech` SSE event, which renders an inline
 * audio player in this tool's block.
 */
const schema = z
  .object({
    speech: z.string().min(1).describe("The text to be converted into speech."),
  })
  .strict();

export type GenerateSpeechArgs = z.infer<typeof schema>;

export const generateSpeechTool = defineTool({
  name: "generate_speech",
  description: "Generate spoken audio from the provided text.",
  schema,
  label: (args) => `Generate Speech: ${args.speech.trim().slice(0, 60)}${args.speech.trim().length > 60 ? "…" : ""}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const text = args.speech.trim();
    if (!text) {
      return {
        ok: false,
        error: { code: "missing_speech", message: "No speech text provided." },
      };
    }

    const config: TtsToolsConfig | undefined = ctx.tts;
    if (!config?.provider) {
      return { ok: false, error: ttsNotConfiguredResult(config) };
    }

    try {
      const file = await synthesizeSpeechFile(config, text, ctx.workspaceRoot, { signal: ctx.signal });

      // Surface the audio to the user immediately so the tool block shows a live
      // player (the same pattern the attach_files tool uses for its popup).
      ctx.emit?.("generate_speech", {
        file: {
          name: file.name,
          path: file.path,
          absolute_path: file.absolute_path,
          size: file.size,
          content_type: file.content_type,
        },
        provider: file.provider,
        model: file.model,
        voice: file.voice,
        chat_id: ctx.chatId,
        tool_call_id: ctx.toolCallId,
      });

      return {
        ok: true,
        data: {
          file: {
            name: file.name,
            path: file.path,
            absolute_path: file.absolute_path,
            size: file.size,
            content_type: file.content_type,
          },
          provider: file.provider,
          model: file.model,
          voice: file.voice,
          message:
            `Speech generated and saved to ${file.path} (provider: ${file.provider}` +
            `${file.model ? `, model: ${file.model}` : ""}${file.voice ? `, voice: ${file.voice}` : ""}). ` +
            "The audio is shown to the user in your tool block and can be played or downloaded there.",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "tts_failed",
          provider: config.provider,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
