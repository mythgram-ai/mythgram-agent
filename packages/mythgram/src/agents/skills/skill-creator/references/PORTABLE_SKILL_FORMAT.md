# Portable Agent Skill Format

## Purpose

This reference describes a conservative, portable folder convention for reusable agent skills. A target platform's official specification takes precedence whenever it differs.

## Minimal layout

```text
skill-name/
└── SKILL.md
```

## Expanded layout

```text
skill-name/
├── SKILL.md
├── references/
├── templates/
├── scripts/
└── assets/
```

Only include directories that contain files required by the skill.

## Frontmatter

```yaml
---
name: example-skill
description: Performs a defined task. Use when the user asks for that task or a closely related workflow.
---
```

Use lowercase kebab-case for the directory and `name`. Keep the description concise but specific: capability plus activation conditions.

## Main instruction file

`SKILL.md` contains the workflow the agent needs at activation time. Put essential instructions in it. Move lengthy domain references into `references/` and tell the agent exactly when to read them.

## Portability cautions

- Platforms may impose different metadata fields, limits, or directory conventions.
- Do not add unsupported frontmatter keys.
- Do not assume that scripts, network access, shell access, or integrations exist.
- Preserve relative paths when packaging.
- Do not include secrets, credentials, private user data, or unnecessary binaries.
- Validate using the target platform's official validator when one exists.
