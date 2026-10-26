import WebSocket from "ws";
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
 * Discord channel transport over the Gateway WebSocket + REST API.
 *
 * Setup for the user: create an application + bot in the Discord developer portal,
 * enable the MESSAGE CONTENT privileged intent, invite the bot, then paste the bot
 * token. In servers the bot only answers when @mentioned; in DMs every message is
 * answered. Outbound text is chunked at 2000 chars; files go out as message
 * attachments (multipart).
 */

const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const REST = "https://discord.com/api/v10";
const MESSAGE_LIMIT = 2000;

// Gateway intents: GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT.
const INTENTS = 1 | (1 << 9) | (1 << 12) | (1 << 15);

export interface DiscordVerifyResult {
  botId: string;
  botName: string;
}

/** Validate a bot token via GET /users/@me (used when a connection is created/edited). */
export async function verifyDiscordToken(token: string): Promise<DiscordVerifyResult> {
  const res = await fetch(`${REST}/users/@me`, {
    headers: { Authorization: `Bot ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    username?: string;
    message?: string;
  };
  if (!res.ok || !body.id) {
    throw new Error(
      typeof body.message === "string" && body.message
        ? `Discord rejected the token: ${body.message}`
        : "Discord rejected the bot token. Check it and try again.",
    );
  }
  return { botId: body.id, botName: body.username ?? "Bot" };
}

export interface DiscordProviderOptions {
  token: string;
  workspaceRoot: string;
  onMessage: (incoming: ChannelIncoming) => void;
  onError: (message: string) => void;
}

interface GatewayHello {
  op: 10;
  d: { heartbeat_interval: number };
}

export class DiscordProvider implements ChannelSender {
  private socket: WebSocket | null = null;
  private stopped = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private selfId = "";
  private selfName = "Bot";

  constructor(private readonly opts: DiscordProviderOptions) {}

  /** Connect + run the gateway loop until stopped. Never throws. */
  async start(): Promise<void> {
    try {
      const me = await verifyDiscordToken(this.opts.token);
      this.selfId = me.botId;
      this.selfName = me.botName;
    } catch (error) {
      this.opts.onError(error instanceof Error ? error.message : String(error));
      return;
    }
    let backoff = 1000;
    while (!this.stopped) {
      try {
        await this.connectOnce();
        // A clean run ended only via stop(); any other return is a drop → reconnect.
        backoff = 1000;
      } catch (error) {
        if (this.stopped) break;
        this.opts.onError(
          `Discord gateway error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (this.stopped) break;
      const aborted = await sleep(Math.min(backoff, 30_000));
      if (aborted) break;
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    try {
      this.socket?.close(1000, "shutdown");
    } catch {
      // ignore
    }
    this.socket = null;
  }

  get botId(): string {
    return this.selfId;
  }

  get botName(): string {
    return this.selfName;
  }

  async sendMessage(target: ChannelTarget, text: string): Promise<void> {
    for (const chunk of chunkText(text, MESSAGE_LIMIT)) {
      await this.postMessage(target.chatId, { content: chunk });
    }
  }

  async sendFile(
    target: ChannelTarget,
    file: { absolutePath: string; filename: string; contentType: string },
  ): Promise<void> {
    const fs = await import("node:fs/promises");
    const data = await fs.readFile(file.absolutePath);
    const form = new FormData();
    form.set("payload_json", JSON.stringify({}));
    form.set(
      "files[0]",
      new File([data], file.filename, { type: file.contentType }),
    );
    const res = await fetch(`${REST}/channels/${encodeURIComponent(target.chatId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.opts.token}` },
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        typeof body.message === "string" && body.message
          ? `Discord file send failed: ${body.message}`
          : `Discord file send failed with HTTP ${res.status}.`,
      );
    }
  }

  private async postMessage(channelId: string, payload: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${REST}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        typeof body.message === "string" && body.message
          ? `Discord send failed: ${body.message}`
          : `Discord send failed with HTTP ${res.status}.`,
      );
    }
  }

  /** One gateway connection: resolves when the socket closes (reconnect handled by start). */
  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = this.resumeUrl ?? GATEWAY;
      const socket = new WebSocket(url);
      this.socket = socket;
      let helloReceived = false;
      let settled = false;

      const done = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        this.clearHeartbeat();
        if (this.socket === socket) this.socket = null;
        try {
          socket.removeAllListeners();
        } catch {
          // ignore
        }
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve();
      };

      socket.on("open", () => {
        // Wait for HELLO before identifying (or resuming).
        const timer = setTimeout(() => {
          if (!helloReceived) {
            try {
              socket.close(4000, "no hello");
            } catch {
              // ignore
            }
            done(new Error("Discord gateway did not send HELLO."));
          }
        }, 15_000);
        timer.unref?.();
        socket.once("message", () => clearTimeout(timer));
      });

      socket.on("message", (raw: WebSocket.RawData) => {
        let packet: { op: number; d?: unknown; s?: number | null; t?: string | null };
        try {
          packet = JSON.parse(raw.toString()) as typeof packet;
        } catch {
          return;
        }
        if (typeof packet.s === "number") this.seq = packet.s;
        switch (packet.op) {
          case 10: {
            helloReceived = true;
            const hello = packet as unknown as GatewayHello;
            this.startHeartbeat(socket, hello.d.heartbeat_interval);
            if (this.sessionId) this.resume(socket);
            else this.identify(socket);
            break;
          }
          case 11:
            break; // heartbeat ACK
          case 0:
            this.handleDispatch(packet.t ?? undefined, packet.d);
            break;
          case 7:
            // Reconnect requested: close without clearing the session so we resume.
            try {
              socket.close(4900, "reconnect requested");
            } catch {
              // ignore
            }
            break;
          case 9:
            // Invalid session: drop resume state and identify fresh on next connect.
            this.sessionId = null;
            this.resumeUrl = null;
            this.seq = null;
            try {
              socket.close(4901, "invalid session");
            } catch {
              // ignore
            }
            break;
          default:
            break;
        }
      });

      socket.on("close", () => done());
      socket.on("error", (error) => done(error));
    });
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    socket.send(JSON.stringify(payload));
  }

  private identify(socket: WebSocket): void {
    this.send(socket, {
      op: 2,
      d: {
        token: this.opts.token,
        intents: INTENTS,
        properties: { os: "linux", browser: "mythgram", device: "mythgram" },
      },
    });
  }

  private resume(socket: WebSocket): void {
    this.send(socket, {
      op: 6,
      d: { token: this.opts.token, session_id: this.sessionId, seq: this.seq },
    });
  }

  private startHeartbeat(socket: WebSocket, intervalMs: number): void {
    this.clearHeartbeat();
    const beat = (): void => {
      try {
        this.send(socket, { op: 1, d: this.seq });
      } catch {
        // the socket error/close handlers drive the reconnect
      }
    };
    beat();
    this.heartbeatTimer = setInterval(beat, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleDispatch(type: string | undefined, data: unknown): void {
    if (type === "READY") {
      const ready = data as {
        session_id?: string;
        resume_gateway_url?: string;
        user?: { id?: string; username?: string };
      };
      this.sessionId = ready.session_id ?? null;
      if (ready.resume_gateway_url) this.resumeUrl = ready.resume_gateway_url;
      if (ready.user?.id) this.selfId = ready.user.id;
      if (ready.user?.username) this.selfName = ready.user.username;
      return;
    }
    if (type !== "MESSAGE_CREATE") return;
    void this.handleMessageCreate(data as Record<string, unknown>);
  }

  private async handleMessageCreate(data: Record<string, unknown>): Promise<void> {
    try {
      const author = (data.author ?? {}) as { id?: string; bot?: boolean; username?: string };
      // Ignore our own messages, other bots, and webhook posts (prevents loops).
      if (!author.id || author.id === this.selfId || author.bot === true) return;
      if (typeof data.webhook_id === "string") return;
      const channelId = data.channel_id;
      const guildId = data.guild_id;
      if (typeof channelId !== "string") return;
      const content = typeof data.content === "string" ? data.content : "";

      const attachments: ChannelAttachment[] = [];
      const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
      for (const raw of rawAttachments) {
        const item = raw as { url?: string; filename?: string; size?: number };
        if (typeof item.url !== "string" || !item.url) continue;
        try {
          const bytes = await downloadUrl(item.url);
          const saved = await saveUpload(
            this.opts.workspaceRoot,
            item.filename ?? "attachment",
            bytes,
          );
          attachments.push({
            filename: item.filename ?? "attachment",
            absolutePath: saved.absolutePath,
            size: saved.size,
            contentType: mimeOf(item.filename ?? ""),
          });
        } catch (error) {
          this.opts.onError(
            `Discord attachment download failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (!content.trim() && attachments.length === 0) return;
      const username =
        typeof author.username === "string" && author.username ? author.username : "Discord user";
      this.opts.onMessage({
        userKey: `dc:${author.id}`,
        userLabel: username,
        target: { kind: "discord", chatId: channelId },
        text: content,
        attachments,
        // Server messages need an @mention; DMs (no guild) never do.
        needsMention: typeof guildId === "string" && guildId.length > 0,
      });
    } catch (error) {
      this.opts.onError(
        `Discord message handling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
