---
description: Creates comprehensive, realistic, prioritized plans and
  actionable todo lists for user goals and tasks. Use when a user asks
  to plan, organize, break down, schedule, execute, or track a project,
  goal, assignment, event, workflow, or any multi-step task.
metadata:
  author: Mythgram AI
  version: 1.0
name: task-planner
---

# Task Planner

## Purpose

Turn the user's current task into a clear, complete, and executable
plan. Think like a practical project planner: clarify the desired
outcome, identify the work required, sequence it, expose dependencies
and risks, and give the user concrete next actions.

A good plan is not merely a list of ideas. It explains what needs to
happen, in what order, why the order matters, what "done" means, and how
progress can be checked.

## When to activate

Activate this skill when the user asks to:

-   Make a plan, roadmap, action plan, project plan, study plan, or
    execution strategy.
-   Break a goal or large task into smaller steps.
-   Generate todos, a checklist, milestones, or a timeline.
-   Organize work, prioritize tasks, or decide what to do next.
-   Plan a project, event, learning goal, personal goal, research task,
    or repeatable workflow.
-   Turn a vague idea or outcome into a practical sequence of actions.

Do not force a project plan onto a simple factual question or a one-step
request. For a tiny task, provide a compact checklist rather than an
elaborate framework.

## Core principles

1.  **Outcome first:** Plan around the result the user wants, not around
    generic productivity habits.
2.  **Use the available context:** Reuse details already supplied in the
    conversation. Do not ask the user to repeat them.
3.  **Clarify only what blocks progress:** If one missing detail
    materially changes the plan, ask one focused question. Otherwise
    state a reasonable assumption and continue.
4.  **Be comprehensive, not bloated:** Include all meaningful work, but
    do not invent tasks just to make the plan look extensive.
5.  **Make every todo actionable:** Start with a verb and describe a
    specific observable action.
6.  **Sequence intelligently:** Show dependencies, prerequisites, and
    the critical path where relevant.
7.  **Prioritize realistically:** Distinguish essential work from
    optional improvements.
8.  **Respect constraints:** Account for deadlines, available time,
    budget, skills, tools, access, and user preferences.
9.  **Make uncertainty visible:** Label estimates and assumptions; never
    present guesses as facts.
10. **Enable immediate progress:** End with a clear first action the
    user can take now.

## Planning workflow

Follow these steps in order. Adapt the depth to the size and complexity
of the task.

### 1. Understand the task

Extract or infer:

-   **Goal:** What outcome does the user want?
-   **Deliverable:** What must exist or be completed at the end?
-   **Definition of done:** What observable conditions prove completion?
-   **Deadline:** Is there a fixed date, target date, or no deadline?
-   **Scope:** What is included and excluded?
-   **Constraints:** Time, budget, people, skills, tools, location,
    policies, and other limitations.
-   **Resources:** Information, materials, people, or systems already
    available.
-   **Preferences:** Desired pace, level of detail, format, or working
    style.

Do not silently turn a broad aspiration into a specific commitment.
Distinguish user-stated facts from planning assumptions.

### 2. Decide whether to ask or assume

Ask a clarifying question only when the missing information would
significantly change the plan or make it unsafe, infeasible, or
misleading.

Examples of high-impact missing information: - A deadline when the user
explicitly needs a date-based schedule. - The intended audience or
required format when these determine the deliverable. - A key resource
or constraint without which the task cannot be scoped.

If the user has not provided enough information but a useful draft is
still possible: - State the assumptions briefly. - Build a flexible
plan. - Mark decisions that need confirmation. - Avoid blocking the
entire response with a long questionnaire.

Never ask for information already present in the conversation.

### 3. Define success

Write a concise outcome statement. Then define completion criteria that
are specific and verifiable.

Prefer criteria such as: - "Submit the final report in the required
format by the agreed date." - "Complete and review all required
sections." - "Obtain approval from the named stakeholder."

Avoid vague criteria such as "make good progress" or "do it well."

### 4. Decompose the work

Break the task into logical phases. Common phases include:

1.  Understand and scope.
2.  Prepare resources and prerequisites.
3.  Research or gather inputs.
4.  Create or execute the main work.
5.  Review, test, or validate.
6.  Finalize and deliver.
7.  Follow up, maintain, or evaluate (when relevant).

These are examples, not mandatory phases. Choose phases that match the
actual task.

For each phase: - State its purpose and expected output. - Break it into
small, independently actionable todos. - Include setup and coordination
work that is easy to overlook. - Include review and quality checks. -
Avoid duplicating the same action in multiple phases.

A todo should usually be small enough to complete in one focused work
session. Split tasks that contain multiple unrelated verbs or
deliverables.

### 5. Identify dependencies and order

Determine which tasks: - Must happen before other tasks. - Can happen in
parallel. - Require a decision, approval, input, or external response. -
Are likely to block the overall outcome.

Represent dependencies clearly, for example: "Complete the outline
before drafting the report."

When useful, identify the **critical path**: the chain of dependent
tasks that determines the earliest possible completion date.

Do not claim tasks can run in parallel if they depend on the same
unavailable resource or decision.

### 6. Prioritize

Use these priority levels consistently:

-   **P0 --- Critical:** Required to achieve the goal or prevent a major
    blocker.
-   **P1 --- High:** Important and time-sensitive; should be completed
    soon.
-   **P2 --- Normal:** Necessary, but can follow higher-priority work.
-   **P3 --- Optional:** Useful enhancement that can be skipped without
    invalidating the outcome.

Prioritize by impact, urgency, dependency, and risk---not by which task
sounds easiest.

Identify the smallest useful next action. If the user is overwhelmed,
reduce the immediate workload to one to three high-value actions while
retaining the full plan.

### 7. Estimate effort and schedule

When enough information exists, estimate task duration and propose a
timeline.

-   Use ranges when precision is not justified (for example, "30--60
    minutes").
-   Distinguish active work time from waiting time.
-   Include review, rework, handoffs, and buffer time.
-   Respect the user's stated availability.
-   Schedule prerequisite work before dependent work.
-   Avoid filling every available hour; leave realistic room for
    interruptions.
-   Use calendar dates only when the date context is known.
-   If the deadline is impossible or highly risky, say so plainly and
    propose scope reductions or a revised sequence.

If there is no deadline or availability information, provide relative
sequencing (Phase 1, next, later) rather than inventing dates.

### 8. Anticipate risks and contingencies

For meaningful projects, identify likely risks, blockers, and
dependencies. For each important risk, state: - What could go wrong. -
Its likely impact. - A practical prevention or mitigation. - A fallback
action if it occurs.

Focus on realistic risks. Do not overwhelm a simple task with a formal
risk register.

### 9. Add quality gates

Define checkpoints that verify the work before it moves forward.
Examples: - Scope confirmed before execution. - Required inputs
collected before drafting. - Work reviewed against acceptance
criteria. - Final deliverable checked for completeness and
correctness. - Delivery confirmed with the intended recipient or system.

For technical or operational work, include appropriate testing and
rollback or recovery considerations where relevant.

### 10. Produce the plan and todos

Use the output format below as the default. Scale sections down for
simple tasks and expand them for complex projects.

## Default output format

# \[Clear task or project title\]

## 1. Goal

One or two sentences describing the intended outcome.

## 2. Definition of done

A short checklist of measurable completion criteria.

## 3. Assumptions and constraints

List only relevant assumptions, known constraints, and unresolved
decisions. If none are material, say so briefly.

## 4. Plan overview

Show the phases in order, with each phase's purpose and expected output.

## 5. Detailed todo list

Group todos under their phase. Use this structure for each item:

-   [ ] **\[Action-oriented task title\]** --- Specific instructions and
    expected result.
    -   Priority: P0 / P1 / P2 / P3
    -   Effort: estimate or "Not estimated"
    -   Depends on: prerequisite task(s), or "None"
    -   Completion check: observable condition that marks the task done

Use stable task IDs (T1, T2, T3...) when there are enough tasks to
benefit from tracking. Keep IDs consistent when referring to
dependencies.

## 6. Timeline and milestones

Provide a realistic sequence, milestone outcomes, and dates or relative
timing when supported by the available information. Mark estimates
clearly.

## 7. Dependencies and critical path

Summarize the most important ordering constraints and any tasks that can
safely happen in parallel.

## 8. Risks and contingency plan

Include only the most relevant risks, their impact, and mitigation or
fallback actions.

## 9. Final review checklist

List the checks required before the user considers the task complete or
delivers the result.

## 10. Start here

Name the single best next action. Make it concrete and small enough to
begin immediately.

## Output rules

-   Put the most useful information first; do not bury the action plan
    under lengthy explanation.
-   Use clear headings, concise language, and checkboxes for todos.
-   Use tables only when they improve comparison or tracking. Prefer
    grouped checklists for execution.
-   Do not give every task the same priority.
-   Do not assign arbitrary dates, durations, budgets, owners, or
    completion percentages.
-   If an estimate cannot be made responsibly, say "Not estimated" and
    explain what information is needed.
-   Separate required tasks from optional enhancements.
-   Keep the plan self-contained so the user can act without needing to
    infer missing steps.
-   If the plan is long, provide a short summary of the first milestones
    and immediate next action.
-   Do not claim to have created calendar events, reminders, documents,
    or external tasks unless the relevant tool actually completed that
    action.

## Adaptation by task size

### Small task

For a task that can be completed in a few steps: - Give a short ordered
checklist. - Include only essential dependencies and a completion
check. - Skip formal risk analysis and milestone planning unless needed.

### Medium task

For a task with several workstreams or a meaningful deadline: - Use
phases, prioritized todos, effort estimates, dependencies, and
milestones. - Include a brief risk and final-review section.

### Large or complex project

For a multi-week, multi-person, or high-consequence project: - Define
scope and acceptance criteria carefully. - Break work into workstreams
and phases. - Identify owners only when the user has supplied them or
asks for role suggestions. - Include dependencies, critical path,
milestones, decision points, risk mitigations, buffers, and quality
gates. - Separate MVP/essential scope from optional scope. - Recommend
periodic progress reviews and a change-control approach when scope may
evolve.

## Handling progress updates and changes

When the user returns with progress: 1. Compare reported progress with
the existing plan. 2. Mark only explicitly completed tasks as complete.
3. Preserve task IDs where possible. 4. Identify newly revealed work,
blockers, and changed assumptions. 5. Reprioritize remaining tasks based
on the current situation. 6. Update the timeline only when new
information supports the change. 7. Return the revised remaining todos
and the next action.

When the user changes the goal or constraints: - Explain which parts of
the old plan are affected. - Remove or revise obsolete tasks. - Add
newly required tasks. - Re-check dependencies, priorities, risks, and
timeline. - Do not preserve outdated work merely for consistency.

When the user asks "What should I do next?": - Inspect the current plan
and progress first. - Recommend the highest-priority unblocked task. -
Give one concrete next action, its expected result, and any
prerequisite.

## Special considerations

-   **Learning and study plans:** Include learning objectives, topics in
    prerequisite order, practice, retrieval or review sessions, and a
    way to assess understanding. Avoid unrealistic workloads.
-   **Writing and research:** Include question definition, source
    gathering, evidence evaluation, outline, drafting, revision,
    fact-checking, and final formatting as appropriate.
-   **Events:** Include venue or platform, participants, budget
    constraints, logistics, communications, contingency arrangements,
    and post-event follow-up where relevant.
-   **Product or software projects:** Include requirements, design,
    implementation, tests, security/privacy checks where appropriate,
    release, monitoring, and rollback planning where relevant.
-   **Personal goals:** Keep actions practical and sustainable. Do not
    impose extreme routines or treat productivity as more important than
    wellbeing.
-   **Team projects:** Distinguish task owner, contributor, reviewer,
    and approver only when roles are known or the user wants role
    recommendations.

## Safety, privacy, and feasibility

-   Do not create plans that facilitate harm, wrongdoing, evasion, or
    dangerous activities. Redirect toward safe, lawful alternatives.
-   For medical, legal, financial, or other high-stakes decisions, keep
    planning organizational and informational; do not present the plan
    as a substitute for qualified professional advice.
-   Do not request or expose passwords, authentication codes, or
    unnecessary sensitive personal information.
-   Do not assume the agent has permission to contact people, spend
    money, publish content, modify systems, or create external records.
    Ask for authorization when an action requires it.
-   Be honest about tool limitations and external dependencies.

## Final self-check

Before responding, verify:

-   [ ] The plan directly addresses the user's stated goal.
-   [ ] The definition of done is clear.
-   [ ] Major phases and necessary todos are included.
-   [ ] Todos are concrete, non-duplicative, and actionable.
-   [ ] Priorities reflect impact and urgency.
-   [ ] Dependencies and blockers are visible.
-   [ ] Estimates and dates are grounded or clearly labeled as unknown.
-   [ ] Risks and quality checks are appropriate to the task size.
-   [ ] The plan respects the user's constraints and context.
-   [ ] The user knows exactly what to do first.
