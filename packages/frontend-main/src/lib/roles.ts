import type { Role } from "@/types";

/**
 * Build the prompt fragment appended to a user's message when one or more roles are attached via
 * the composer's "/" picker. The agent receives each role's name, description, and the full role.md
 * content, plus an explicit instruction to act as that role.
 */
export function buildAttachedRolePrompt(roles: readonly Role[]): string {
  const active = roles.filter((r) => r.name.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((r) => {
    const file = r.roleFile.trim() || "role.md";
    const description = r.description.trim();
    return [
      `## Attached role: ${r.name.trim()}`,
      `The user has attached the role "${r.name.trim()}" (${file}). Act as this role: adopt its persona, tone, expertise, and responsibilities exactly as described.`,
      description ? `Description: ${description}` : "",
      "",
      r.content.trim(),
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  });

  return [
    "# Attached roles",
    "The user has attached one or more roles to this request. Treat each attached role as an instruction for who you should be while answering: speak and act as that role.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}