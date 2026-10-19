/**
 * The TTS engine: turns a user-chosen TTS configuration + text into a saved
 * audio file inside the user's workspace. It never renders speech itself —
 * it dispatches to the selected provider adapter (a pre-created local service
 * or a cloud API) and writes the returned bytes to disk.
 *
 * File location: `<workspace>/.gptloop/tts/speech_<timestamp>_<rand>.<ext>` —
 * inside the workspace so the existing /api/files preview + download routes
 * serve it to the browser directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getTtsProvider } from "./registry.js";
import type { TtsModelInfo, TtsProviderId, TtsRequestContext, TtsToolsConfig, TtsVoiceInfo } from "./types.js";

/** Workspace-relative folder where generated speech files are saved. */
export const TTS_OUTPUT_DIR = ".gptloop/tts";

/** Maximum text length per synthesis request (provider limits differ; this is a safety cap). */
export const TTS_MAX_TEXT_CHARS = 60_000;

export interface SavedSpeechFile {
  /** Absolute path on disk. */
  absolute_path: string;
  /** Workspace-relative path (what the frontend preview/download routes take). */
  path: string;
  /** File name only. */
  name: string;
  /** MIME type of the audio. */
  content_type: string;
  /** Size in bytes. */
  size: number;
  /** Provider that rendered the audio. */
  provider: TtsProviderId;
  /** Model used (when applicable). */
  model?: string;
  /** Voice used (when applicable). */
  voice?: string;
}

/**
 * Whether the user has connected a usable TTS provider. "Connected" means a
 * known provider id plus everything that provider requires (base URL for the
 * local/custom OpenAI-compatible providers, an API key for cloud providers).
 * Voice/model requirements are validated at synthesis time with clear errors.
 */
export function isTtsConfigured(config: TtsToolsConfig | undefined): config is TtsToolsConfig {
  if (!config?.provider) return false;
  const provider = getTtsProvider(config.provider);
  if (!provider) return false;
  return ttsMissingRequirements(config).length === 0;
}

/** Missing-provider prerequisites, for a precise error message. */
export function ttsMissingRequirements(config: TtsToolsConfig | undefined): string[] {
  const provider = getTtsProvider(config?.provider);
  if (!provider) {
    return config?.provider ? [`unknown provider "${config.provider}"`] : ["no provider selected"];
  }
  const missing: string[] = [];
  if (provider.requiresApiKey && !config?.apiKey?.trim()) missing.push("API key");
  if (provider.requiresBaseUrl && !config?.baseUrl?.trim()) missing.push("base URL");
  missing.push(...(provider.missingRequirements?.(config ?? {}) ?? []));
  return missing;
}

/** Build the clear error the model sees when it calls generate_speech without a connected TTS. */
export function ttsNotConfiguredResult(config: TtsToolsConfig | undefined): {
  code: string;
  message: string;
} {
  const missing = ttsMissingRequirements(config);
  return {
    code: "tts_not_configured",
    message:
      "No TTS provider is connected. The user must configure and connect a TTS provider in the " +
      "TTS panel first" +
      (missing.length > 0 ? ` (missing: ${missing.join(", ")})` : "") +
      ". Tell the user to open the TTS panel, pick a provider, complete its setup and connect it.",
  };
}

/** Unique output file name: speech_YYYYMMDD_HHMMSS_<6 rand>.<ext> */
function outputFileName(extension: string, now: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `speech_${stamp}_${rand}.${extension}`;
}

/**
 * Synthesize `text` through the configured provider and save the audio file in
 * the user's workspace. Throws a descriptive Error when TTS is not connected
 * or the provider call fails.
 */
export async function synthesizeSpeechFile(
  config: TtsToolsConfig,
  text: string,
  workspaceRoot: string,
  ctx?: TtsRequestContext,
): Promise<SavedSpeechFile> {
  if (!isTtsConfigured(config)) {
    const { message } = ttsNotConfiguredResult(config);
    throw new Error(message);
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("No speech text provided.");
  if (trimmed.length > TTS_MAX_TEXT_CHARS) {
    throw new Error(
      `Speech text is too long (${trimmed.length} characters; the limit is ${TTS_MAX_TEXT_CHARS}).`,
    );
  }

  const provider = getTtsProvider(config.provider)!;
  const result = await provider.synthesize(trimmed, config, ctx ?? {});

  const outputDir = path.join(workspaceRoot, TTS_OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });
  const absolutePath = path.join(outputDir, outputFileName(result.extension, new Date()));
  await fs.writeFile(absolutePath, result.audio);
  const stat = await fs.stat(absolutePath);

  return {
    absolute_path: absolutePath,
    path: `${TTS_OUTPUT_DIR}/${path.basename(absolutePath)}`,
    name: path.basename(absolutePath),
    content_type: result.contentType,
    size: stat.size,
    provider: result.provider,
    model: result.model,
    voice: result.voice,
  };
}

/** Live model catalog for a provider (empty when the provider has no listable models). */
export async function fetchTtsModels(
  config: TtsToolsConfig,
  ctx?: TtsRequestContext,
): Promise<TtsModelInfo[]> {
  const provider = getTtsProvider(config.provider);
  if (!provider?.fetchModels) return [];
  return provider.fetchModels(config, ctx ?? {});
}

/** Live voice catalog for a provider (empty when the provider has no listable voices). */
export async function fetchTtsVoices(
  config: TtsToolsConfig,
  ctx?: TtsRequestContext,
): Promise<TtsVoiceInfo[]> {
  const provider = getTtsProvider(config.provider);
  if (!provider?.fetchVoices) return [];
  return provider.fetchVoices(config, ctx ?? {});
}
