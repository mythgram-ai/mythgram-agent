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
 * Slack channel transport over the Web API with polling (no extra dependencies).
 *
 * Setup for the user: create a Slack app + bot, add it to the workspace, then paste
 * the bot OAuth token (xoxb-…). Inbound traffic arrives by polling `conversations.list`
 * + `conversations.history` (only messages newer than the last seen timestamp are
 * processed). In channels the bot only answers when @mentioned; in DMs every message
 * is answered. Outbound text is chunked; files use the files.getUploadURLExternal →
 * upload → files.completeUploadExternal flow.
 *
 * Required bot scopes (set in the Slack app config): channels:history, groups:history,
 * im:history, mpim:history, channels:read, groups:read, im:read, mpim:read, chat:write,
 * files:write, users:read, auth.test is scope-free.
 */

const API = "https://slack.com/api";
const POLL_MS = 5000;
const CONVO_REFRESH_MS = 60_000;
const MESSAGE_LIMIT = 3500;

export interface SlackVerifyResult {
  botId: string;
  botName: string;
  teamId: string;
}

/** Validate a bot token via auth.test (used when a connection is created/edited). */
export async function verifySlackToken(token: string): Promise<SlackVerifyResult> {
  const res = await fetch(`${API}/auth.test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    user_id?: string;
    user?: string;
    team_id?: string;
  };
  if (!res.ok || body.ok !== true || !body.user_id) {
    throw new Error(
      typeof body.error === "string" && body.error
        ? `Slack rejected the token: ${body.error}`
        : "Slack rejected the bot token. Check it and try again.",
    );
  }
  return {
    botId: body.user_id,
    botName: body.user ?? "Bot",
    teamId: body.team_id ?? "",
  };
}

export interface SlackProviderOptions {
  token: string;
  workspaceRoot: string;
  onMessage: (incoming: ChannelIncoming) => void;
  onError: (message: string) => void;
}

interface SlackConvo {
  id: string;
  /** Conversation type: channel | group | im | mpim. */
  type: string;
}

export class SlackProvider implements ChannelSender {
  private stopped = false;
  private botUserId = "";
  private botName = "Bot";
  private teamId = "";
  /** Last processed message ts per conversation id. */
  private readonly lastTs = new Map<string, string>();
  private lastConvoRefresh = 0;
  private convos: SlackConvo[] = [];
  private readonly userLabels = new Map<string, string>();

  constructor(private readonly opts: SlackProviderOptions) {}

  /** Poll conversations until stopped. Never throws (errors go to onError). */
  async start(): Promise<void> {
    try {
      const me = await verifySlackToken(this.opts.token);
      this.botUserId = me.botId;
      this.botName = me.botName;
      this.teamId = me.teamId;
    } catch (error) {
      this.opts.onError(error instanceof Error ? error.message : String(error));
      return;
    }
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (error) {
        if (this.stopped) break;
        this.opts.onError(
          `Slack poll failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (this.stopped) break;
      const aborted = await sleep(POLL_MS);
      if (aborted) break;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  get userId(): string {
    return this.botUserId;
  }

  get displayName(): string {
    return this.botName;
  }

  async sendMessage(target: ChannelTarget, text: string): Promise<void> {
    for (const chunk of chunkText(text, MESSAGE_LIMIT)) {
      const body: Record<string, unknown> = { channel: target.chatId, text: chunk };
      if (target.threadId) body.thread_ts = target.threadId;
      const res = await this.call("chat.postMessage", body);
      if (res.ok !== true) {
        throw new Error(
          typeof res.error === "string" && res.error
            ? `Slack send failed: ${res.error}`
            : "Slack send failed.",
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
    // Step 1: reserve an upload URL.
    const reserved = await this.call("files.getUploadURLExternal", {
      filename: file.filename,
      length: data.length,
    });
    if (reserved.ok !== true || typeof reserved.upload_url !== "string" || typeof reserved.file_id !== "string") {
      throw new Error(
        typeof reserved.error === "string" && reserved.error
          ? `Slack file upload failed: ${reserved.error}`
          : "Slack file upload reservation failed.",
      );
    }
    // Step 2: PUT the bytes to the external URL.
    const put = await fetch(reserved.upload_url as string, {
      method: "POST",
      headers: { "Content-Type": file.contentType },
      body: data,
    });
    if (!put.ok) {
      throw new Error(`Slack file upload failed with HTTP ${put.status}.`);
    }
    // Step 3: complete the upload into the channel (threaded when applicable).
    const doneBody: Record<string, unknown> = {
      files: [{ id: reserved.file_id as string, title: file.filename }],
      channel_id: target.chatId,
    };
    if (target.threadId) doneBody.thread_ts = target.threadId;
    const done = await this.call("files.completeUploadExternal", doneBody);
    if (done.ok !== true) {
      throw new Error(
        typeof done.error === "string" && done.error
          ? `Slack file upload failed: ${done.error}`
          : "Slack file upload completion failed.",
      );
    }
  }

  private async call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastConvoRefresh > CONVO_REFRESH_MS || this.convos.length === 0) {
      await this.refreshConvos();
      this.lastConvoRefresh = now;
    }
    for (const convo of this.convos) {
      if (this.stopped) break;
      await this.pollConvo(convo);
    }
  }

  private async refreshConvos(): Promise<void> {
    const res = await this.call("conversations.list", {
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: true,
      limit: 200,
    });
    if (res.ok !== true || !Array.isArray(res.channels)) {
      if (typeof res.error === "string" && res.error) {
        throw new Error(`conversations.list failed: ${res.error}`);
      }
      return;
    }
    const next: SlackConvo[] = [];
    for (const raw of res.channels as Array<{ id?: unknown; is_im?: unknown }>) {
      if (typeof raw.id !== "string" || !raw.id) continue;
      next.push({ id: raw.id, type: raw.is_im === true ? "im" : "channel" });
      // Seed the cursor at "now" for unseen conversations so historic backlog is skipped.
      if (!this.lastTs.has(raw.id)) {
        this.lastTs.set(raw.id, `${Math.floor(Date.now() / 1000)}.000000`);
      }
    }
    this.convos = next;
  }

  private async pollConvo(convo: SlackConvo): Promise<void> {
    const oldest = this.lastTs.get(convo.id);
    const res = await this.call("conversations.history", {
      channel: convo.id,
      oldest,
      limit: 50,
      inclusive: false,
    });
    if (res.ok !== true || !Array.isArray(res.messages)) return;
    const messages = (res.messages as Array<Record<string, unknown>>)
      .filter((m) => typeof m.ts === "string")
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    for (const message of messages) {
      const ts = String(message.ts);
      this.lastTs.set(convo.id, ts);
      await this.handleMessage(convo, message);
    }
  }

  private async handleMessage(convo: SlackConvo, message: Record<string, unknown>): Promise<void> {
    const subtype = message.subtype;
    // Skip bot posts (including our own), edits, joins, and tombstones.
    if (subtype === "bot_message" || subtype === "message_changed" || subtype === "channel_join") return;
    if (typeof message.bot_id === "string") return;
    const user = message.user;
    if (typeof user !== "string" || !user || user === this.botUserId) return;
    const text = typeof message.text === "string" ? message.text : "";
    if (!text.trim()) return;

    const attachments: ChannelAttachment[] = [];
    const files = Array.isArray(message.files) ? message.files : [];
    for (const raw of files) {
      const item = raw as {
        url_private?: string;
        name?: string;
        mimetype?: string;
        size?: number;
      };
      if (typeof item.url_private !== "string" || !item.url_private) continue;
      try {
        const data = await downloadUrl(item.url_private, {
          headers: { Authorization: `Bearer ${this.opts.token}` },
        });
        const saved = await saveUpload(this.opts.workspaceRoot, item.name ?? "attachment", data);
        attachments.push({
          filename: item.name ?? "attachment",
          absolutePath: saved.absolutePath,
          size: saved.size,
          contentType: item.mimetype ?? mimeOf(item.name ?? ""),
        });
      } catch (error) {
        this.opts.onError(
          `Slack attachment download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const label = await this.userLabel(user);
    this.opts.onMessage({
      userKey: `sl:${this.teamId || "team"}:${user}`,
      userLabel: label,
      target: {
        kind: "slack",
        chatId: convo.id,
        // Reply inside the thread the user wrote in (or start one on their message).
        threadId:
          typeof message.thread_ts === "string"
            ? message.thread_ts
            : typeof message.ts === "string"
              ? message.ts
              : undefined,
      },
      text,
      attachments,
      // DMs (im) never need a mention; channels do.
      needsMention: convo.type !== "im",
    });
  }

  private async userLabel(userId: string): Promise<string> {
    const cached = this.userLabels.get(userId);
    if (cached) return cached;
    try {
      const res = await this.call("users.info", { user: userId });
      const profile = (res.user ?? {}) as {
        real_name?: unknown;
        name?: unknown;
      };
      const label =
        (typeof profile.real_name === "string" && profile.real_name) ||
        (typeof profile.name === "string" && profile.name) ||
        userId;
      this.userLabels.set(userId, label);
      return label;
    } catch {
      return userId;
    }
  }
}
