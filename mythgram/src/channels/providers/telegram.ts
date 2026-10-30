import type {
  ChannelAttachment,
  ChannelIncoming,
  ChannelSender,
  ChannelTarget,
} from "../types.js";
import {
  chunkText,
  downloadUrl,
  mimeOf,
  saveUpload,
  sleep,
} from "./base.js";

/**
 * Telegram channel transport over the Bot HTTP API (no extra dependencies).
 *
 * Setup for the user: create a bot with @BotFather, paste the bot token, then open
 * the bot and start chatting. Inbound traffic arrives via `getUpdates` long-polling;
 * outbound traffic uses `sendMessage` (text, chunked at 4096 chars) and `sendDocument`
 * (files). Photos arrive with their caption as the message text.
 */

const API = "https://api.telegram.org";
const FILE_API = "https://api.telegram.org/file";
const MESSAGE_LIMIT = 4096;
const POLL_BACKOFF_MS = 5000;

/**
 * A non-OK answer from Telegram's `getUpdates`. `retryAfterMs` mirrors the server's
 * `parameters.retry_after` (rate limiting); `fatal` marks a rejected token (HTTP 401),
 * which no amount of retrying can recover from.
 */
export class TelegramPollError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
    readonly fatal = false,
  ) {
    super(message);
    this.name = "TelegramPollError";
  }
}

export interface TelegramVerifyResult {
  botId: string;
  botName: string;
}

/** Validate a bot token (used by the API when a connection is created/edited). */
export async function verifyTelegramToken(token: string): Promise<TelegramVerifyResult> {
  const res = await fetch(`${API}/bot${token}/getMe`);
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { id?: number; username?: string; first_name?: string };
  };
  if (!res.ok || body.ok !== true || !body.result?.id) {
    throw new Error(
      typeof body.description === "string" && body.description
        ? `Telegram rejected the token: ${body.description}`
        : "Telegram rejected the bot token. Check it and try again.",
    );
  }
  return {
    botId: String(body.result.id),
    botName: body.result.username ?? body.result.first_name ?? "Bot",
  };
}

export interface TelegramProviderOptions {
  token: string;
  workspaceRoot: string;
  onMessage: (incoming: ChannelIncoming) => void;
  onError: (message: string) => void;
  /**
   * Called when polling fails fatally (a rejected token). Retrying cannot help, so
   * the provider stops and the channel is marked down immediately.
   */
  onFatalError?: (message: string) => void;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    caption?: string;
    document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
    photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>;
    video?: { file_id?: string; file_name?: string; mime_type?: string };
  };
}

export class TelegramProvider implements ChannelSender {
  private stopped = false;
  private offset = 0;
  private botUsername = "";
  /** Aborted by stop() so an in-flight backoff sleep ends promptly. */
  private readonly stopController = new AbortController();

  constructor(private readonly opts: TelegramProviderOptions) {}

  /** Long-poll getUpdates until stopped. Never throws (errors go to onError). */
  async start(): Promise<void> {
    try {
      const me = await verifyTelegramToken(this.opts.token);
      this.botUsername = me.botName;
    } catch (error) {
      this.opts.onError(error instanceof Error ? error.message : String(error));
      return;
    }
    while (!this.stopped) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          if (this.stopped) break;
          await this.handleUpdate(update);
        }
      } catch (error) {
        if (this.stopped) break;
        const message = error instanceof Error ? error.message : String(error);
        const fatal = error instanceof TelegramPollError && error.fatal;
        // A rejected token cannot be fixed by retrying — report it now (marks the
        // channel down via onFatalError when wired) and stop the poll loop.
        if (fatal && this.opts.onFatalError) {
          this.opts.onFatalError(`Telegram poll failed: ${message}`);
        } else {
          this.opts.onError(`Telegram poll failed: ${message}`);
        }
        if (fatal) {
          this.stopped = true;
          break;
        }
        // Honour the server's rate-limit hint, otherwise fall back to a short backoff.
        const delayMs =
          error instanceof TelegramPollError && error.retryAfterMs !== null
            ? error.retryAfterMs
            : POLL_BACKOFF_MS;
        await sleep(delayMs, this.stopController.signal);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.stopController.abort();
  }

  async sendMessage(target: ChannelTarget, text: string): Promise<void> {
    for (const chunk of chunkText(text, MESSAGE_LIMIT)) {
      const res = await fetch(`${API}/bot${this.opts.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: target.chatId, text: chunk }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { description?: string };
        throw new Error(
          typeof body.description === "string" && body.description
            ? `Telegram send failed: ${body.description}`
            : `Telegram send failed with HTTP ${res.status}.`,
        );
      }
    }
  }

  async sendFile(
    target: ChannelTarget,
    file: { absolutePath: string; filename: string; contentType: string },
  ): Promise<void> {
    const fs = await import("node:fs/promises");
    const data = await fs.readFile(file.absolutePath);
    const form = new FormData();
    form.set("chat_id", target.chatId);
    form.set("document", new File([data], file.filename, { type: file.contentType }));
    const res = await fetch(`${API}/bot${this.opts.token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      throw new Error(
        typeof body.description === "string" && body.description
          ? `Telegram file send failed: ${body.description}`
          : `Telegram file send failed with HTTP ${res.status}.`,
      );
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const controller = new AbortController();
    // Long-poll (30s server hold) + a client-side ceiling so stop() is honored promptly.
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const res = await fetch(
        `${API}/bot${this.opts.token}/getUpdates?offset=${this.offset}&timeout=30&allowed_updates=${encodeURIComponent(JSON.stringify(["message"]))}`,
        { signal: controller.signal },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: TelegramUpdate[];
        parameters?: { retry_after?: number };
      };
      if (!res.ok || body.ok !== true || !Array.isArray(body.result)) {
        const detail =
          typeof body.description === "string" && body.description.trim()
            ? body.description.trim()
            : `HTTP ${res.status}`;
        const retryAfter = body.parameters?.retry_after;
        throw new TelegramPollError(
          detail,
          typeof retryAfter === "number" && retryAfter > 0 ? retryAfter * 1000 : null,
          res.status === 401,
        );
      }
      return body.result;
    } catch (error) {
      if (this.stopped) return [];
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    this.offset = Math.max(this.offset, (update.update_id ?? -1) + 1);
    const message = update.message;
    const chatId = message?.chat?.id;
    const from = message?.from;
    if (message === undefined || chatId === undefined || from?.id === undefined) return;

    const text = (message.text ?? message.caption ?? "").trim();
    // In groups the bot stays quiet unless addressed: a /@command or an @mention.
    // DMs (private chats) always come through.
    const chatType = message.chat?.type ?? "private";
    if (chatType !== "private" && !this.addressed(text)) return;
    const attachments: ChannelAttachment[] = [];
    try {
      const doc = message.document;
      if (doc?.file_id) {
        const fetched = await this.downloadFile(
          doc.file_id,
          doc.file_name ?? `document_${doc.file_id.slice(0, 8)}`,
        );
        if (fetched) attachments.push(fetched);
      }
      const photos = message.photo;
      if (photos && photos.length > 0) {
        // The last size is the largest rendition.
        const best = photos[photos.length - 1];
        if (best?.file_id) {
          const fetched = await this.downloadFile(best.file_id, `photo_${best.file_id.slice(0, 8)}.jpg`);
          if (fetched) attachments.push(fetched);
        }
      }
      const video = message.video;
      if (video?.file_id) {
        const fetched = await this.downloadFile(
          video.file_id,
          video.file_name ?? `video_${video.file_id.slice(0, 8)}.mp4`,
        );
        if (fetched) attachments.push(fetched);
      }
    } catch (error) {
      this.opts.onError(
        `Telegram attachment download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!text && attachments.length === 0) return;
    const label = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
    this.opts.onMessage({
      userKey: `tg:${from.id}`,
      userLabel: from.username ? `${label} (@${from.username})`.trim() : label || `Telegram user ${from.id}`,
      target: { kind: "telegram", chatId: String(chatId) },
      text,
      attachments,
      // Telegram users chat with the bot directly — no mention ever needed.
      needsMention: false,
    });
  }

  /** True when group chatter addresses the bot (a /@command or an @mention). */
  private addressed(text: string): boolean {
    if (text.includes("/@")) return true;
    const name = this.botUsername.trim().replace(/^@/, "");
    if (name && new RegExp(`@${escapeRegExp(name)}\\b`, "i").test(text)) return true;
    return false;
  }

  private async downloadFile(fileId: string, filename: string): Promise<ChannelAttachment | null> {    const infoRes = await fetch(`${API}/bot${this.opts.token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = (await infoRes.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    const filePath = info.result?.file_path;
    if (!infoRes.ok || info.ok !== true || !filePath) return null;
    const data = await downloadUrl(`${FILE_API}/bot${this.opts.token}/${filePath}`);
    const saved = await saveUpload(this.opts.workspaceRoot, filename, data);
    return {
      filename,
      absolutePath: saved.absolutePath,
      size: saved.size,
      contentType: mimeOf(filename),
    };
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
