# Agent prompts and workflows

Mythgram is a ReAct-style agent: it reasons, calls tools (files, shell, search,
web, memory, …), observes results, and continues until the task is done. Prompts
work best when they state a **goal**, any **constraints**, and the **definition of
done**. The examples below are starting points you can paste into the chat box.

---

## Explore an unfamiliar codebase

```
Give me an onboarding tour of this repository:
1. Identify the entry points and the main modules.
2. Draw the request flow for the backend (which files handle HTTP routes).
3. List the five files a new contributor should read first, with one line each.
Keep it to one screen and cite file paths.
```

## Make a focused code change

```
Add an npm script named `smoke` to the root package.json that runs
`node -e "console.log('ok')"`. Then run it with `npm run smoke` and show the output.
Only touch package.json.
```

## Fix a bug from a failing test

```
The test suite is failing somewhere under packages/mythgram/src/agents/tools.
Run `npm --prefix packages/mythgram test`, find the first real failure, fix the
root cause (not the test), and re-run just that test file until it passes.
```

## Research with citations

```
Research the current stable Node.js LTS release. Search the web, verify against at
least two independent sources, and write your findings to RESEARCH.md with a short
summary and a "Sources" section listing every URL you used.
```

## Compare options and decide

```
Compare SQLite WAL mode vs. shipping a separate Postgres for this project. Consider
local-first usage, single-user deployment, and backup simplicity. Produce a table of
trade-offs and a clear recommendation, then save it to docs/storage-decision.md.
```

## Plan before you act (plan approval)

Mythgram can submit a plan for your approval before making changes. Ask for one:

```
Draft a step-by-step plan to add rate limiting to the /api/chat routes (files,
approach, tests), then submit it for my approval before writing any code.
```

## Generate a document or slides

```
Create a 5-slide deck (slides) titled "Mythgram in 5 minutes": what it is, how it
runs on one port, providers, tools, and memory. Keep bullets short.
```

## Multi-agent (team) run

Teams have a coordinating head agent and specialist members. Create a team in the
console, enable it, then give a task that benefits from parallelism:

```
Assemble two researchers and one writer:
- Researcher A: summarize how providers and model fallback work in this repo.
- Researcher B: summarize the retry system and combo providers.
- Writer: turn both summaries into a single README section.
Coordinate the members, then merge their outputs into TEAMS.md.
```

## CEO-style orchestration

A CEO agent coordinates multiple teams toward one objective:

```
As CEO, plan a launch checklist for this project:
- Team 1 (backend): verify the API builds and the health endpoint responds.
- Team 2 (frontend): verify the console builds and typechecks.
- Team 3 (docs): ensure README and deploy docs match the current commands.
Report status per team and flag blockers.
```

## Use memory and knowledge

Persist durable facts so later runs start informed:

```
Remember (memory) that this project uses Tailwind v4, React 19, and Vite, and that
the backend serves the built console on one port. Then add our internal API
conventions to the knowledge base from https://example.com/api-style-guide.
```

## Schedule a recurring task

Schedules run in the backend while the app runs. In the console's **Schedules**
panel, create e.g. a daily job:

```
Every weekday at 09:00, scan the workspace for TODO/FIXME comments, group them by
file, and post a summary to the connected Slack channel.
```

---

## Prompting tips

- **Be concrete about done.** "Write tests" is vague; "add tests for `grep` edge
  cases and make `npm test` pass" is verifiable.
- **Scope the blast radius.** "Only edit files under `src/api/`" prevents surprise
  refactors.
- **Ask for the plan first** on large or risky changes, then review before edits.
- **Point at artifacts.** Ask it to write results to a file so you can diff and
  keep them.
- **Chain turns.** Use the **Continue** button after an interrupted turn, and use
  checkpoints to snapshot/restore workspace state.
