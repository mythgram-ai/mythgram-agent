import type {
  KnowledgeFile,
  McpServer,
  MemoryFile,
  Skill,
  SubAgent,
} from "@/types";

/**
 * Prompt fragments appended to a user's message when a capability is attached via the composer's
 * "/" picker (skills, connectors, sub-agents, MCP servers, knowledge, memory). Every fragment here
 * is "hidden" context: it reaches the model (and is retained in history) but is stripped from the
 * chat UI by `visiblePromptText`, mirroring the workflow/role attachment builders.
 *
 * The attached capability is already present in the turn payload the frontend sends (skills,
 * connected connectors, enabled sub-agents, enabled MCP servers, knowledge, memory), so these
 * fragments are explicit instructions telling the model that the user wants that capability used
 * for the current request.
 */

/** Connector attached from the composer: display metadata resolved from the live catalog. */
export interface AttachedConnector {
  /** Composio toolkit slug (connector id). */
  id: string;
  /** Official app name, e.g. "GitHub". */
  name: string;
  /** Optional account label (login/email/workspace) for the connected account. */
  accountLabel?: string;
}

function joinBlocks(header: string, intro: string, blocks: string[]): string {
  return [header, intro, "", blocks.join("\n\n")].join("\n");
}

/**
 * Skills: include each skill's name, description, and the entry file (SKILL.md by default) plus any
 * additional files, then instruct the model to read and follow the skill precisely.
 */
export function buildAttachedSkillsPrompt(skills: readonly Skill[]): string {
  const active = skills.filter((s) => s.name.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((skill) => {
    const entry = skill.skillFile.trim() || "SKILL.md";
    const description = skill.description.trim();
    const files = [
      `### ${entry}`,
      skill.skillContent.trim(),
      ...skill.files
        .filter((f) => f.path.trim().length > 0)
        .map((f) => `### ${f.path.trim()}\n${f.content.trim()}`),
    ].join("\n\n");
    return [
      `## Attached skill: ${skill.name.trim()}`,
      `The user has attached the skill "${skill.name.trim()}". Read it carefully and follow its instructions exactly.`,
      description ? `Description: ${description}` : "",
      "",
      files,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  });

  return joinBlocks(
    "# Attached skills",
    "The user has attached one or more skills to this request. Read each attached skill carefully and carry out the request according to its instructions.",
    blocks,
  );
}

/** Connected app connectors: instruct the model to use the attached connector tools. */
export function buildAttachedConnectorsPrompt(connectors: readonly AttachedConnector[]): string {
  const active = connectors.filter((c) => c.id.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((c) => {
    const label = c.accountLabel?.trim();
    return [
      `## Attached connector: ${c.name.trim() || c.id.trim()}`,
      `The user has attached the connected app "${c.name.trim() || c.id.trim()}" (id: ${c.id.trim()}).`,
      label ? `Connected account: ${label}` : "",
      `Use this connector's tools directly to carry out the request.`,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  });

  return joinBlocks(
    "# Attached connectors",
    "The user has attached one or more connected apps to this request. Prefer these connectors' tools when the request involves their service, and use them directly.",
    blocks,
  );
}

/** Sub-agents: instruct the model to delegate to the attached sub-agents. */
export function buildAttachedSubAgentsPrompt(subAgents: readonly SubAgent[]): string {
  const active = subAgents.filter((a) => a.name.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((agent) => {
    const description = agent.description.trim();
    return [
      `## Attached sub-agent: ${agent.name.trim()}`,
      `The user has attached the sub-agent "${agent.name.trim()}". Delegate the appropriate parts of this request to it via call_sub_agent.`,
      description ? `Description: ${description}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  });

  return joinBlocks(
    "# Attached sub-agents",
    "The user has attached one or more sub-agents to this request. Use them for the work they are best suited for by delegating with call_sub_agent.",
    blocks,
  );
}

/** MCP servers: instruct the model to use the attached servers' tools. */
export function buildAttachedMcpPrompt(servers: readonly McpServer[]): string {
  const active = servers.filter((s) => s.name.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((server) => {
    const description = server.description.trim();
    const tools = server.cachedTools
      .map((t) => t.name.trim())
      .filter((name) => name.length > 0);
    return [
      `## Attached MCP server: ${server.name.trim()}`,
      `The user has attached the MCP server "${server.name.trim()}". Use its tools to carry out the request.`,
      description ? `Description: ${description}` : "",
      tools.length > 0 ? `Available tools: ${tools.join(", ")}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  });

  return joinBlocks(
    "# Attached MCP servers",
    "The user has attached one or more MCP servers to this request. Use these servers' tools directly when the request calls for them.",
    blocks,
  );
}

/** Knowledge files: append each file's full content and instruct the model to use it. */
export function buildAttachedKnowledgePrompt(files: readonly KnowledgeFile[]): string {
  const active = files.filter((f) => f.path.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((file) => {
    return [
      `## Attached knowledge file: ${file.path.trim()}`,
      `The user has attached the knowledge file "${file.path.trim()}". Use its content as authoritative context for this request.`,
      "",
      file.content.trim(),
    ].join("\n");
  });

  return joinBlocks(
    "# Attached knowledge files",
    "The user has attached one or more knowledge files to this request. Treat their content as authoritative reference material while answering.",
    blocks,
  );
}

/** Memory files: append each file's full content and instruct the model to use it. */
export function buildAttachedMemoryPrompt(files: readonly MemoryFile[]): string {
  const active = files.filter((f) => f.path.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((file) => {
    return [
      `## Attached memory file: ${file.path.trim()}`,
      `The user has attached the memory file "${file.path.trim()}". Use its content as remembered context about the user for this request.`,
      "",
      file.content.trim(),
    ].join("\n");
  });

  return joinBlocks(
    "# Attached memory files",
    "The user has attached one or more memory files to this request. Treat their content as remembered context about the user and apply it while answering.",
    blocks,
  );
}
