import crypto from "node:crypto";

/**
 * ID generation for the persistence layer.
 *
 * - Chat sessions use 20-character IDs.
 * - Sub-agent runs use 10-character IDs.
 *
 * Both alphabets use ALL the digits (0-9) and ALL the letters (a-z, A-Z), giving
 * 62^20 (~7e35) and 62^10 (~8e17) possible values respectively — collision-safe
 * for a local application while staying short, copyable, and URL-safe.
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Chat sessions carry a 20-character alphanumeric ID. */
export const CHAT_SESSION_ID_LENGTH = 20;

/** Sub-agent runs carry a 10-character alphanumeric ID. */
export const SUB_AGENT_SESSION_ID_LENGTH = 10;

/** Custom agents carry a 16-character alphanumeric ID. */
export const CUSTOM_AGENT_ID_LENGTH = 16;

/** Custom TTS providers carry a 12-character alphanumeric ID. */
export const TTS_PROVIDER_ID_LENGTH = 12;

/** User profiles carry a 16-character alphanumeric ID (`"default"` for the built-in profile). */
export const USER_PROFILE_ID_LENGTH = 16;

/** Main-agent custom system prompts carry a 16-character alphanumeric ID. */
export const MAIN_AGENT_PROMPT_ID_LENGTH = 16;

/** Schedules carry a 16-character alphanumeric ID. */
export const SCHEDULE_ID_LENGTH = 16;

/** Prompt-library entries carry a 20-character alphanumeric ID. */
export const PROMPT_LIBRARY_ID_LENGTH = 20;

/** Custom system prompts carry a 20-digit numeric ID (`^[0-9]{20}$`). */
export const CUSTOM_SYSTEM_PROMPT_ID_LENGTH = 20;

/** Schedule runs carry a 12-character alphanumeric ID. */
export const SCHEDULE_RUN_ID_LENGTH = 12;

/** Generate a cryptographically random ID of `length` characters from the 62-char alphabet. */
export function randomId(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Create a new 20-character chat session ID (all numbers + all letters). */
export function createChatSessionId(): string {
  return randomId(CHAT_SESSION_ID_LENGTH);
}

/** Create a new 10-character sub-agent session ID (all numbers + all letters). */
export function createSubAgentSessionId(): string {
  return randomId(SUB_AGENT_SESSION_ID_LENGTH);
}

/**
 * Create a new 16-character custom-agent ID (all numbers + all letters). A Custom Agent is a
 * user-created, independently-configured top-level Main Agent; each one carries its own id.
 */
export function createCustomAgentId(): string {
  return randomId(CUSTOM_AGENT_ID_LENGTH);
}

/**
 * Create a 12-character id for a user-added TTS provider. Built-in providers
 * use their kind as the id; only custom providers mint an id here.
 */
export function createTtsProviderId(): string {
  return randomId(TTS_PROVIDER_ID_LENGTH);
}

/**
 * Create a new 16-character main-agent prompt ID (all numbers + all letters). Each custom system
 * prompt the user creates for the built-in Main Agent carries its own id.
 */
export function createMainAgentPromptId(): string {
  return randomId(MAIN_AGENT_PROMPT_ID_LENGTH);
}

/**
 * Create a new 16-character user-profile ID (all numbers + all letters). Never returns the
 * reserved `"default"` id used by the built-in profile.
 */
export function createUserProfileId(): string {
  let id = randomId(USER_PROFILE_ID_LENGTH);
  while (id === "default") id = randomId(USER_PROFILE_ID_LENGTH);
  return id;
}

/**
 * Create a new 16-character schedule ID (all numbers + all letters). Each
 * user-created schedule carries its own id.
 */
export function createScheduleId(): string {
  return randomId(SCHEDULE_ID_LENGTH);
}

/**
 * Create a new 12-character schedule-run ID (all numbers + all letters). Each
 * execution of a schedule (automatic or manual) carries its own id.
 */
export function createScheduleRunId(): string {
  return randomId(SCHEDULE_RUN_ID_LENGTH);
}

/**
 * Create a new 20-character prompt-library ID (all numbers + all letters). Each
 * user-saved prompt in the prompt library carries its own id.
 */
export function createPromptLibraryId(): string {
  return randomId(PROMPT_LIBRARY_ID_LENGTH);
}

/**
 * Create a new 20-digit custom-system-prompt ID (`^[0-9]{20}$`, 10^20 combinations).
 * Each user-saved custom system prompt carries its own id. Digits only by design so the
 * model can copy the id verbatim and the delete tool can validate it with a strict pattern.
 */
export function createCustomSystemPromptId(): string {
  const bytes = crypto.randomBytes(CUSTOM_SYSTEM_PROMPT_ID_LENGTH);
  let out = "";
  for (let i = 0; i < CUSTOM_SYSTEM_PROMPT_ID_LENGTH; i += 1) {
    out += String(bytes[i]! % 10);
  }
  return out;
}

/** True when `value` is an exact 20-digit custom-system-prompt ID. */
export function isCustomSystemPromptId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{20}$/.test(value);
}

/** True when `value` looks like a usable session id (bounded, printable, path-safe). */
export function isSafeSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[0-9A-Za-z_.-]+$/.test(value)
  );
}
