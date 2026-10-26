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
        this.opts.onError(
          `Telegram poll failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(5000);
      }
    }
  }

  stop(): void {
    this.stopped = true;
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
        result?: TelegramUpdate[];
      };
      if (!res.ok || body.ok !== true || !Array.isArray(body.result)) return [];
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
