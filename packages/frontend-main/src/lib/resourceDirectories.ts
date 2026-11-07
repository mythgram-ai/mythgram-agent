/**
 * External discovery directories surfaced on the MCP and Skills panels.
 *
 * These are third-party sites that collect, review, and rank MCP servers and
 * agent skills. The panels link out to them so users can find something worth
 * adding, then register it locally (remote endpoint / local JSON for MCP,
 * create / import for skills). Nothing here talks to the backend — the entries
 * are static metadata and every card opens the site in a new tab.
 */

/** One external directory/marketplace link shown in a panel's discover section. */
export interface ResourceDirectoryLink {
  /** Display name of the site (or repository). */
  name: string;
  /** Absolute homepage / directory URL, always with an explicit protocol. */
  url: string;
  /** One-line description of what the user finds there. */
  description: string;
}

/** Curated places to find remote, local, and hosted MCP servers. */
export const MCP_DIRECTORIES: readonly ResourceDirectoryLink[] = [
  {
    name: "Zapier MCP",
    url: "https://zapier.com/mcp",
    description: "Expose thousands of Zapier app actions to your agent over MCP.",
  },
  {
    name: "Awesome Remote MCP Servers",
    url: "https://github.com/punkpeye/awesome-remote-mcp-servers",
    description: "A curated list of remote MCP servers you can connect in one step.",
  },
  {
    name: "Awesome MCP Servers",
    url: "https://github.com/punkpeye/awesome-mcp-servers",
    description: "A community list of local and remote MCP servers across categories.",
  },
  {
    name: "Glama",
    url: "https://glama.ai/",
    description: "Browse, compare, and deploy MCP servers from a hosted marketplace.",
  },
  {
    name: "SafeMCP",
    url: "https://safemcp.info/",
    description: "Discover MCP servers with a focus on security and vetting.",
  },
  {
    name: "mcp.so",
    url: "https://mcp.so/",
    description: "A large directory of MCP servers, clients, and integrations.",
  },
  {
    name: "MCPServers.org",
    url: "https://mcpservers.org/",
    description: "A curated collection of the best MCP servers to start with.",
  },
];

/** Curated places to find reusable agent skills and skill collections. */
export const SKILL_DIRECTORIES: readonly ResourceDirectoryLink[] = [
  {
    name: "skills.sh",
    url: "https://skills.sh",
    description: "A directory of installable agent skills with one-command setup.",
  },
  {
    name: "Skills Directory",
    url: "https://www.skillsdirectory.com/skills",
    description: "Browse a broad directory of agent skills across providers.",
  },
  {
    name: "Agentic Skills",
    url: "https://agenticskills.io/skills",
    description: "Discover reusable agentic skills for common workflows.",
  },
  {
    name: "HackerRank Skills Directory",
    url: "https://www.hackerrank.com/skills-directory",
    description: "Explore skills and roles across technologies and certifications.",
  },
  {
    name: "Open Agent Skill",
    url: "https://www.openagentskill.com/skills",
    description: "An open, community-driven directory of agent skills.",
  },
  {
    name: "TypingMind Skills",
    url: "https://www.typingmind.com/skills",
    description: "Ready-to-use skills for TypingMind and compatible agents.",
  },
  {
    name: "Awesome Claude Skills",
    url: "https://github.com/ComposioHQ/awesome-claude-skills",
    description: "A curated list of awesome Claude and agent skills.",
  },
  {
    name: "Agentic Awesome Skills",
    url: "https://github.com/sickn33/agentic-awesome-skills",
    description: "A community collection of practical agentic skills.",
  },
];

/** The bare host of a URL (e.g. "github.com"), tolerant of a missing protocol. */
export function resourceHost(url: string): string {
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return normalized
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
}

/**
 * Ordered logo URLs for a directory, most-preferred first. The logos are the
 * site's own favicon pulled from its URL via public favicon services, so a
 * brand-correct mark renders without shipping any asset. Callers fall through
 * the list on error and finally fall back to the name's initial.
 */
export function resourceLogoUrls(url: string): string[] {
  const host = resourceHost(url);
  if (!host) return [];
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
  ];
}
