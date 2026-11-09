import fs from "node:fs/promises";
import path from "node:path";
import { AcpClientManager } from "../acp-client/manager.js";
import type { AcpClientPublic, AcpSessionPublic } from "../acp-client/types.js";
import { safeResolve } from "../utils/paths.js";
import type {
  AcpAgentsCallParam,
  AcpAgentsConnectInput,
  AcpAgentsRuntime,
  ToolContext,
  ToolResult,
} from "./tools/types.js";

/**
 * Build the AcpAgentsRuntime for a turn that may drive external ACP-compatible agents.
 *
 * The runtime is a thin bridge over the SAME in-app AcpClientManager the console's ACP panel and the
 * `/api/acp-client` REST surface use, so an agent the LLM connects (or deletes) is visible everywhere
 * immediately, and a session the LLM starts is the very same session the panel would show.
 *
 * Session model: the tools bind ONE app-owned ACP session per (Mythgram chat, ACP agent) pair. The
 * first call in a chat auto-creates it; later calls reuse it so the external agent keeps its
 * conversation context. `start_new_acp_agent_session` forces a fresh one.
 *
 * Output model: a `wait_for_output: true` call returns the agent's final message inline; a
 * `wait_for_output: false` call is launched detached and its final message is written to a
 * `.mythgram/acp/<agent>-output-<id>.md` file the LLM can read later.
 */

/** Directory (relative to the fixed .mythgram data root) where background ACP outputs are written. */
export const ACP_AGENT_OUTPUT_DIR = ".mythgram/acp";

/** How long interrupt waits for the cancelled turn to release the session before sending the prompt. */
const INTERRUPT_RELEASE_TIMEOUT_MS = 20_000;
const INTERRUPT_POLL_MS = 100;

export function createAcpAgentsRuntime(
  manager: AcpClientManager,
  workspaceRoot: string,
): AcpAgentsRuntime {
  const runtime = new AcpAgentRuntimeBridge(manager, workspaceRoot);
  return {
    list: () => runtime.list(),
    connect: (input, ctx) => runtime.connect(input, ctx),
    remove: (agentId, ctx) => runtime.remove(agentId, ctx),
    call: (input, ctx) => runtime.call(input, ctx),
    interrupt: (agentId, prompt, ctx) => runtime.interrupt(agentId, prompt, ctx),
    startNewSession: (agentId, ctx) => runtime.startNewSession(agentId, ctx),
  };
}

interface PromptOutcome {
  ok: boolean;
  output: string;
  error?: string;
}

/** Result of preparing a background run: a relative output path the model can read. */
interface BackgroundStart {
  ok: boolean;
  outputFile?: string;
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Turn an agent name into a filesystem-safe slug for the background output file name. */
function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "acp-agent";
}

/** A random 5-digit id (10000–99999) used to keep background output file names unique. */
function random5(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

/**
 * Choose the permission option to auto-approve for a delegated ACP agent. Delegated agents run
 * autonomously (there is no UI attached to answer their permission prompts), so the least-privileged
 * "allow" option is selected; when the agent offers no allow option the request is cancelled.
 */
function pickPermissionOption(options: unknown): string | null {
  if (!Array.isArray(options)) return null;
  const entries = options.map(asRecord);
  const byKind = (kind: string): string | null => {
    const match = entries.find((option) => option.kind === kind);
    return typeof match?.optionId === "string" ? match.optionId : null;
  };
  const chosen =
    byKind("allow_once") ??
    byKind("allow_always") ??
    (() => {
      const match = entries.find(
        (option) => typeof option.kind === "string" && option.kind.startsWith("allow"),
      );
      return typeof match?.optionId === "string" ? match.optionId : null;
    })();
  return chosen;
}

class AcpAgentRuntimeBridge {
  /** In-flight chat-session resolutions, keyed by `${clientId}:${chatId}`, so a batch never races. */
  private readonly sessionPromises = new Map<string, Promise<AcpSessionPublic>>();

  constructor(
    private readonly manager: AcpClientManager,
    private readonly workspaceRoot: string,
  ) {}

  list(): ToolResult {
    try {
      const clients = this.manager.listClients();
      return {
        ok: true,
        data: {
          count: clients.length,
          agents: clients.map((client) => this.toPublicAgent(client)),
          message:
            clients.length === 0
              ? "No ACP agents are connected. Use connect_acp_agents to connect one."
              : "Use the exact acp_agent_id with call_connected_acp_agents, delete_acp_agents, Interrupt_acp_agent, or start_new_acp_agent_session.",
        },
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  async connect(input: AcpAgentsConnectInput, ctx: ToolContext): Promise<ToolResult> {
    const name = (input.name ?? "").trim();
    const command = (input.command ?? "").trim();
    const args = Array.isArray(input.args)
      ? input.args.filter((arg): arg is string => typeof arg === "string")
      : [];

    if (!name) {
      return {
        ok: false,
        error: { code: "acp_agent_name_required", message: "A non-empty acp_agent_name is required." },
      };
    }
    if (!command) {
      return {
        ok: false,
        error: {
          code: "acp_agent_command_required",
          message:
            "A non-empty acp_agent_command is required (the executable only — put its arguments in acp_agent_args).",
        },
      };
    }

    let created: AcpClientPublic;
    try {
      created = this.manager.createClient({ name, command, args, env: {}, cwd: "" });
    } catch (error) {
      return this.failure(error);
    }

    try {
      const connected = await this.manager.connect(created.id);
      this.emitUpdated(ctx);
      return {
        ok: true,
        data: {
          created: true,
          connected: connected.status === "connected",
          acp_agent_id: connected.id,
          name: connected.name,
          status: connected.status,
          agent_name: connected.agent?.name ?? null,
          protocol_version: connected.protocolVersion,
          message:
            `Connected ACP agent "${connected.name}" (id ${connected.id}). ` +
            `Use call_connected_acp_agents to send it a task.`,
        },
      };
    } catch (error) {
      // Roll back the half-created connection so the agent list stays clean.
      await this.manager.deleteClient(created.id).catch(() => undefined);
      this.emitUpdated(ctx);
      return {
        ok: false,
        error: {
          code: "acp_connect_failed",
          message:
            `Failed to connect the ACP agent "${name}": ${messageOf(error)}. ` +
            "Check the command and arguments, then try connect_acp_agents again.",
          command,
          args,
        },
      };
    }
  }

  async remove(agentId: string, ctx: ToolContext): Promise<ToolResult> {
    const id = (agentId ?? "").trim();
    if (!id) {
      return {
        ok: false,
        error: {
          code: "acp_agent_id_required",
          message: "A non-empty acp_agent_id is required. Use list_available_acp_agents to find it.",
        },
      };
    }
    try {
      const client = this.manager.getClient(id);
      await this.manager.deleteClient(id);
      this.emitUpdated(ctx);
      return {
        ok: true,
        data: {
          deleted: true,
          acp_agent_id: id,
          name: client.name,
          message: `Disconnected and removed ACP agent "${client.name}" (id ${id}).`,
        },
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  async call(
    input: { agents: AcpAgentsCallParam[] },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const chatId = (ctx.chatId ?? "").trim();
    if (!chatId) {
      return {
        ok: false,
        error: {
          code: "acp_chat_id_required",
          message: "ACP agents can only be called within a chat session (no chat id in context).",
        },
      };
    }
    const specs = Array.isArray(input.agents) ? input.agents : [];
    if (specs.length === 0) {
      return {
        ok: false,
        error: {
          code: "no_acp_agents",
          message: "Provide at least one ACP agent to call in the 'agents' array.",
        },
      };
    }

    const settled = await Promise.all(
      specs.map((spec, index) => this.runOne(spec, ctx, chatId, index)),
    );

    const waitedFor = settled.filter((entry) => entry.wait_for_output && entry.ok);
    const background = settled.filter((entry) => !entry.wait_for_output && entry.ok);
    const failures = settled.filter((entry) => !entry.ok);

    return {
      ok: true,
      data: {
        count: settled.length,
        waited_for: waitedFor.length,
        running_in_background: background.length,
        failed: failures.length,
        agents: settled,
        message: buildCallSummary(waitedFor.length, background.length, failures.length),
      },
    };
  }

  async interrupt(agentId: string, prompt: string, ctx: ToolContext): Promise<ToolResult> {
    const id = (agentId ?? "").trim();
    const text = (prompt ?? "").trim();
    if (!id) {
      return {
        ok: false,
        error: {
          code: "acp_agent_id_required",
          message: "A non-empty acp_agent_id is required. Use list_available_acp_agents to find it.",
        },
      };
    }
    if (!text) {
      return {
        ok: false,
        error: {
          code: "acp_prompt_required",
          message: "A non-empty interruption prompt is required.",
        },
      };
    }
    const chatId = (ctx.chatId ?? "").trim();
    if (!chatId) {
      return {
        ok: false,
        error: { code: "acp_chat_id_required", message: "ACP agents can only be driven within a chat session." },
      };
    }

    let client: AcpClientPublic;
    try {
      client = this.manager.getClient(id);
    } catch (error) {
      return this.unknownAgent(id, error);
    }

    let session: AcpSessionPublic;
    try {
      session = await this.ensureSession(id, chatId, client.name);
    } catch (error) {
      return this.failure(error);
    }

    if (this.manager.isSessionRunning(session.id)) {
      await this.manager.cancel(id, session.id).catch(() => undefined);
      await this.waitForIdle(session.id);
    }

    const outcome = await this.runPrompt(id, session.id, text, ctx.signal);
    if (!outcome.ok) {
      return {
        ok: false,
        error: { code: "acp_prompt_failed", message: outcome.error ?? "The ACP agent failed.", output: outcome.output },
      };
    }
    return {
      ok: true,
      data: {
        interrupted: true,
        acp_agent_id: id,
        name: client.name,
        session_id: session.id,
        output: outcome.output,
        message: `Interrupted "${client.name}" and sent the new prompt; its final output is included above.`,
      },
    };
  }

  async startNewSession(agentId: string, ctx: ToolContext): Promise<ToolResult> {
    const id = (agentId ?? "").trim();
    if (!id) {
      return {
        ok: false,
        error: {
          code: "acp_agent_id_required",
          message: "A non-empty acp_agent_id is required. Use list_available_acp_agents to find it.",
        },
      };
    }
    const chatId = (ctx.chatId ?? "").trim();
    if (!chatId) {
      return {
        ok: false,
        error: { code: "acp_chat_id_required", message: "ACP sessions can only be started within a chat session." },
      };
    }

    let client: AcpClientPublic;
    try {
      client = this.manager.getClient(id);
    } catch (error) {
      return this.unknownAgent(id, error);
    }

    try {
      const session = await this.manager.ensureChatSession(id, chatId, {
        forceNew: true,
        title: client.name,
      });
      this.emitUpdated(ctx);
      return {
        ok: true,
        data: {
          started: true,
          acp_agent_id: id,
          name: client.name,
          session_id: session.id,
          session_title: session.title,
          message:
            `Started a fresh session for "${client.name}". Subsequent call_connected_acp_agents ` +
            "calls in this chat will use it (the previous session is no longer reused).",
        },
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Internal                                                            */
  /* ------------------------------------------------------------------ */

  private async runOne(
    spec: AcpAgentsCallParam,
    ctx: ToolContext,
    chatId: string,
    index: number,
  ): Promise<Record<string, unknown> & { wait_for_output: boolean; ok: boolean }> {
    const agentId = (spec.acp_agent_id ?? "").trim();
    const prompt = (spec.prompt ?? "").trim();
    const waitForOutput = spec.wait_for_output !== false;

    if (!agentId) {
      return this.entryError(index, "", waitForOutput, "A non-empty acp_agent_id is required for each agent.");
    }
    if (!prompt) {
      return this.entryError(index, agentId, waitForOutput, "A non-empty prompt is required for each agent.");
    }

    let client: AcpClientPublic;
    try {
      client = this.manager.getClient(agentId);
    } catch (error) {
      return this.entryError(index, agentId, waitForOutput, this.unknownAgentMessage(agentId, error));
    }

    let session: AcpSessionPublic;
    try {
      session = await this.ensureSession(agentId, chatId, client.name);
    } catch (error) {
      return this.entryError(index, agentId, waitForOutput, messageOf(error));
    }

    if (waitForOutput) {
      const outcome = await this.runPrompt(agentId, session.id, prompt, ctx.signal);
      if (!outcome.ok) {
        return {
          index,
          acp_agent_id: agentId,
          name: client.name,
          session_id: session.id,
          wait_for_output: true,
          background: false,
          ok: false,
          error: outcome.error ?? "The ACP agent failed.",
        };
      }
      return {
        index,
        acp_agent_id: agentId,
        name: client.name,
        session_id: session.id,
        wait_for_output: true,
        background: false,
        ok: true,
        output: outcome.output,
      };
    }

    const started = await this.startBackground(agentId, session, client.name, prompt, ctx);
    if (!started.ok) {
      return {
        index,
        acp_agent_id: agentId,
        name: client.name,
        session_id: session.id,
        wait_for_output: false,
        background: true,
        ok: false,
        error: started.error ?? "The background ACP run could not be started.",
      };
    }
    return {
      index,
      acp_agent_id: agentId,
      name: client.name,
      session_id: session.id,
      wait_for_output: false,
      background: true,
      ok: true,
      output_file: started.outputFile,
      message:
        `ACP agent "${client.name}" is running in the background. Read its output file ` +
        `"${started.outputFile}" with file_read when you need the result.`,
    };
  }

  private entryError(
    index: number,
    agentId: string,
    waitForOutput: boolean,
    message: string,
  ): Record<string, unknown> & { wait_for_output: boolean; ok: boolean } {
    return {
      index,
      acp_agent_id: agentId,
      wait_for_output: waitForOutput,
      ok: false,
      error: message,
    };
  }

  /**
   * Resolve the chat-bound session for one agent, de-duplicating concurrent resolutions so a batch
   * that targets the same agent never creates two sessions.
   */
  private async ensureSession(
    clientId: string,
    chatId: string,
    agentName: string,
  ): Promise<AcpSessionPublic> {
    const key = `${clientId}:${chatId}`;
    const inflight = this.sessionPromises.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      try {
        return await this.manager.ensureChatSession(clientId, chatId, { title: agentName });
      } finally {
        this.sessionPromises.delete(key);
      }
    })();
    this.sessionPromises.set(key, promise);
    return promise;
  }

  /**
   * Run one prompt turn and collect the agent's final assistant message. No UI is attached to a
   * delegated run, so permission prompts are auto-approved (least-privileged allow option) and
   * elicitation requests are declined — otherwise the agent would stall.
   */
  private async runPrompt(
    clientId: string,
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<PromptOutcome> {
    const chunks: string[] = [];
    let failure: string | null = null;

    const emit = (event: string, data: unknown): void => {
      const record = asRecord(data);
      if (event === "update") {
        const update = asRecord(record.update);
        if (update.sessionUpdate === "agent_message_chunk") {
          const content = asRecord(update.content);
          if (content.type === "text" && typeof content.text === "string") chunks.push(content.text);
        }
      } else if (event === "error") {
        failure = typeof record.message === "string" ? record.message : "The ACP agent reported an error.";
      } else if (event === "permission_request") {
        const requestId = String(record.requestId ?? "");
        if (requestId) {
          const optionId = pickPermissionOption(record.options);
          queueMicrotask(() => {
            try {
              this.manager.resolvePermission(clientId, sessionId, requestId, optionId);
            } catch {
              // The request may have timed out or the session closed; nothing to do.
            }
          });
        }
      } else if (event === "elicitation_request") {
        const requestId = String(record.requestId ?? "");
        if (requestId) {
          queueMicrotask(() => {
            try {
              this.manager.resolveElicitation(clientId, sessionId, requestId, { action: "decline" });
            } catch {
              // Ignore: the request may no longer be pending.
            }
          });
        }
      }
    };

    try {
      await this.manager.prompt({ clientId, sessionId, text, emit, signal });
    } catch (error) {
      return { ok: false, output: chunks.join("").trim(), error: messageOf(error) };
    }
    if (failure) {
      return { ok: false, output: chunks.join("").trim(), error: failure };
    }
    return { ok: true, output: chunks.join("").trim() };
  }

  /**
   * Launch a prompt turn detached from the calling turn and record its final message to a
   * `.mythgram/acp` file. A "running" placeholder is written first so the model can read the file
   * immediately; it is replaced with the complete report once the agent finishes.
   */
  private async startBackground(
    clientId: string,
    session: AcpSessionPublic,
    agentName: string,
    prompt: string,
    ctx: ToolContext,
  ): Promise<BackgroundStart> {
    if (this.manager.isSessionRunning(session.id)) {
      return {
        ok: false,
        error: `A prompt is already running on session ${session.id} for "${agentName}".`,
      };
    }

    const fileName = `${slugifyName(agentName)}-output-${random5()}.md`;
    const relPath = `${ACP_AGENT_OUTPUT_DIR}/${fileName}`;
    let outputAbs: string;
    try {
      outputAbs = safeResolve(ctx.workspaceRoot || this.workspaceRoot, relPath);
    } catch (error) {
      return {
        ok: false,
        error: `Could not resolve the background output file path: ${messageOf(error)}`,
      };
    }

    const header: OutputFile = {
      agentName,
      agentId: clientId,
      sessionId: session.id,
      prompt,
      status: "running",
      output: "",
    };
    try {
      await fs.mkdir(path.dirname(outputAbs), { recursive: true });
      await fs.writeFile(outputAbs, renderOutputFile(header), "utf8");
    } catch (error) {
      return {
        ok: false,
        error: `Could not create the background output file "${relPath}": ${messageOf(error)}`,
      };
    }

    void this.runPrompt(clientId, session.id, prompt)
      .then((outcome) =>
        writeOutputFile(outputAbs, {
          ...header,
          status: outcome.ok ? "completed" : "failed",
          output: outcome.output,
          error: outcome.error,
        }),
      )
      .catch((error) =>
        writeOutputFile(outputAbs, {
          ...header,
          status: "failed",
          output: "",
          error: messageOf(error),
        }),
      );

    return { ok: true, outputFile: relPath };
  }

  private async waitForIdle(sessionId: string): Promise<void> {
    const deadline = Date.now() + INTERRUPT_RELEASE_TIMEOUT_MS;
    while (this.manager.isSessionRunning(sessionId) && Date.now() < deadline) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, INTERRUPT_POLL_MS);
        timer.unref?.();
      });
    }
  }

  private unknownAgent(agentId: string, error: unknown): ToolResult {
    return {
      ok: false,
      error: {
        code: "acp_agent_not_found",
        message: this.unknownAgentMessage(agentId, error),
      },
    };
  }

  private unknownAgentMessage(agentId: string, error: unknown): string {
    const detail = messageOf(error);
    return (
      `No connected ACP agent with id "${agentId}" was found (${detail}). ` +
      "Use list_available_acp_agents to get the exact acp_agent_id, or connect_acp_agents to add one."
    );
  }

  private failure(error: unknown): ToolResult {
    return {
      ok: false,
      error: {
        code: "acp_agent_operation_failed",
        message: `ACP agent operation failed: ${messageOf(error)}`,
      },
    };
  }

  private toPublicAgent(client: AcpClientPublic): Record<string, unknown> {
    return {
      acp_agent_id: client.id,
      name: client.name,
      command: client.command,
      args: client.args,
      enabled: client.enabled,
      status: client.status,
      connected: client.status === "connected",
      agent_name: client.agent?.name ?? null,
      protocol_version: client.protocolVersion,
      sessions: client.sessions,
      error: client.error,
      auth_required: client.authMethods.length > 0,
    };
  }

  private emitUpdated(ctx: ToolContext): void {
    try {
      ctx.emit?.("acp_agents_updated", {
        agents: this.manager.listClients().map((client) => this.toPublicAgent(client)),
      });
    } catch {
      // The mutation already succeeded and is persisted; the panel refetches on open anyway.
    }
  }
}

/** Human/model-facing summary line for a completed call_connected_acp_agents batch. */
function buildCallSummary(waitedFor: number, background: number, failures: number): string {
  const parts: string[] = [];
  if (waitedFor > 0) {
    parts.push(`Waited for ${waitedFor} ACP agent(s); their final outputs are included above.`);
  }
  if (background > 0) {
    parts.push(
      `${background} ACP agent(s) are running in the background — read their output files with ` +
        "file_read when you need the results.",
    );
  }
  if (failures > 0) {
    parts.push(`${failures} ACP agent(s) could not be reached or failed; see their 'error' fields.`);
  }
  return parts.length > 0 ? parts.join(" ") : "No ACP agents were called.";
}

/** Terminal states a background ACP output file can record. */
type AcpOutputStatus = "running" | "completed" | "failed";

interface OutputFile {
  agentName: string;
  agentId: string;
  sessionId: string;
  prompt: string;
  status: AcpOutputStatus;
  output: string;
  error?: string;
}

/** Render the markdown body of a background ACP agent's output file. */
function renderOutputFile(file: OutputFile): string {
  const lines: string[] = [
    `# ACP agent: ${file.agentName}`,
    "",
    `- Status: ${file.status}`,
    `- ACP agent id: ${file.agentId}`,
    `- Session id: ${file.sessionId}`,
    "",
    "## Task",
    "",
    file.prompt.trim() || "(no task provided)",
    "",
    "## Output",
    "",
  ];
  if (file.status === "running") {
    lines.push("_The ACP agent is still working. Re-read this file later for the final report._");
  } else if (file.output.trim().length > 0) {
    lines.push(file.output.trim());
  } else {
    lines.push("_(the ACP agent produced no textual output)_");
  }
  if (file.error) {
    lines.push("", "## Error", "", file.error.trim());
  }
  return `${lines.join("\n")}\n`;
}

/** Best-effort write of a background ACP output file; failures are swallowed. */
async function writeOutputFile(absPath: string, file: OutputFile): Promise<void> {
  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, renderOutputFile(file), "utf8");
  } catch {
    // Best-effort: the background run has already completed.
  }
}
