---
name: documentation-writer
description: Create, revise, and maintain accurate, findable product and technical documentation, including API references, processes, tutorials, how-tos, and troubleshooting guides. Use when a user asks to write, restructure, review, or update documentation intended to help readers understand or complete a product or technical task.
---

# Documentation Writer

## Purpose and boundaries

- Create documentation that helps a defined reader find reliable answers and complete a task correctly.
- Cover product, technical, API, process, tutorial, how-to, reference, and troubleshooting documentation, whether standalone or part of a larger documentation set.
- Work within the requested repository, platform, format, audience, product version, and style conventions.
- Do not turn documentation work into general workplace correspondence, marketing copy, social-media writing, implementation work, or presentation creation. Route those requests to the relevant skill when appropriate.
- Do not present guesses as product behavior, silently change technical contracts, or claim that untested steps were verified.

## Reusable workflow

### 1. Define the documentation job

- Identify the reader, their starting knowledge, the task or question, desired outcome, publication location, and applicable product/version.
- Classify the primary document purpose:
  - **Concept/product overview:** explain what something is, why it matters, and its limits.
  - **Tutorial:** lead a beginner through a complete learning outcome using a coherent example.
  - **How-to:** help a reader accomplish a specific task, assuming relevant background.
  - **Reference:** provide precise, scannable facts such as parameters, fields, options, or behavior.
  - **Process/procedure:** define roles, prerequisites, sequence, decisions, and completion criteria.
  - **Troubleshooting:** map observable symptoms to likely causes, safe checks, and resolution or escalation.
- For a mixed request, choose the reader's primary job and split distinct purposes into linked pages when that improves findability.
- Confirm whether the task is to create new material, update existing material, audit quality, or reconcile a documentation set.

### 2. Resolve context and evidence

- Inspect the existing page, neighboring pages, navigation, naming, terminology, style, and repository or platform conventions before editing. Preserve established patterns unless asked to change them.
- Gather authoritative evidence before drafting. Prefer, in order, the current implementation or published product behavior; maintained API/schema/configuration specifications; current product-owner-approved requirements; and current documentation. Treat older or conflicting prose as a lead to investigate, not proof.
- For behavior that can change, confirm the relevant version, release, environment, permissions, and feature availability. Use authorized tools or reliable sources to verify; use web research when the answer depends on external or current facts.
- Check contradictions across sources. Do not pick a convenient interpretation or conceal a conflict. Seek clarification or label the affected details as unresolved.
- Distinguish verified facts, reasonable assumptions, and unknowns. Ask a focused question when missing information changes correctness, safety, audience, or the deliverable. If the work can proceed, state a narrow assumption and avoid embedding it as fact. Use clearly marked placeholders only when a draft is still useful and the user can supply the missing detail.
- Do not invent endpoints, field meanings, defaults, permissions, UI labels, command output, timelines, policies, or error causes.

### 3. Plan the information architecture

- Start with the reader's question or desired outcome; make the page title and opening accurately signal it.
- Put prerequisites, supported versions, permissions, and important limitations before steps that depend on them.
- Organize for scanning: descriptive headings, short sections, ordered steps for sequences, bullets for parallel items, and tables only for genuinely comparable data.
- Explain required terms at first use; use one canonical name for each concept and preserve exact product labels, code identifiers, and API casing.
- Link to an existing authoritative page for details already documented. Avoid duplicating content likely to drift; when duplication is necessary, identify a canonical source and keep copies synchronized.
- Add navigation, cross-links, aliases, or search terms when the publishing system supports them and readers need them. Use descriptive link text and ensure links point to the most specific useful destination.

### 4. Draft for the document type

- Use direct, task-oriented language. Give each instruction one clear action, identify the object or location, and state the expected result where it helps confirm progress.
- Keep conditions next to the steps they affect. Mark optional, destructive, irreversible, privileged, billable, or environment-specific actions explicitly and provide a safe check or recovery path when known.
- **For tutorials:** establish a realistic starting point, keep the example internally consistent, show checkpoints, and finish with the stated learning outcome. Do not turn a tutorial into a disconnected catalog of options.
- **For how-tos:** state the goal and prerequisites, present the shortest supported path, describe meaningful alternatives only when relevant, and show how to verify success.
- **For API/reference pages:** preserve exact names, types, requiredness, defaults, units, constraints, enum values, authentication, pagination, error behavior, and versioning from the source contract. Separate request and response examples; ensure examples are syntactically valid, internally consistent, and free of real credentials or personal data. Document only supported behavior.
- **For processes:** identify the owner or actor for each action, inputs, decision points, handoffs, completion criteria, exceptions, and escalation path. Do not imply policy approval that has not been supplied.
- **For troubleshooting:** describe recognizable symptoms; give low-risk checks first; connect causes to evidence rather than certainty; distinguish diagnosis from resolution; and state when to stop and escalate. Do not recommend unsafe workarounds.
- **For product documentation:** distinguish availability, prerequisites, limitations, and platform or plan differences. Use current UI labels and state when behavior varies by version, role, or configuration.

### 5. Verify and maintain

- Recheck every factual claim that affects user action against the strongest available source. Ensure examples, names, links, versions, units, and cross-references agree throughout the page and with related pages.
- When tools or an environment are available and authorized, run commands, API examples, or procedures safely in an appropriate test context. Never run destructive or production-impacting instructions merely to validate documentation. If unable to test, say so and identify what remains unverified.
- Review edits as a reader: confirm the requested task is achievable from the stated prerequisites without undocumented assumptions or missing steps.
- For updates, compare old and new behavior, retain still-valid content, remove stale claims, and note downstream pages or examples that may need revision. Preserve version history or change-log conventions where required.
- Report material conflicts, assumptions, unverified procedures, and follow-up needs separately from reader-facing prose unless the publication itself needs a caveat.

## Decision points for incomplete or conflicting context

- **Audience or goal unclear:** ask who the page serves or what successful completion means if that changes content materially; otherwise make the narrowest reasonable assumption explicit.
- **Product/version unspecified:** ask when behavior differs across versions; otherwise target the current supported version and name that scope.
- **Source of truth inaccessible:** draft only the portions supported by available evidence and mark the exact verification needed. Do not fill gaps from intuition.
- **Authoritative sources conflict:** pause claims affected by the conflict, identify the competing sources and practical consequence, and request a decision from the owner. Continue only with unaffected content.
- **Requested detail risks exposing secrets, personal data, security controls, or private internal information:** redact or generalize it, and ask for an approved safe example if needed.
- **Request implies a guarantee, legal/compliance commitment, security assurance, or policy interpretation:** document only approved language and verified procedure; route unresolved approval to the responsible owner.
- **Desired format or destination unavailable:** provide the closest usable editable format and clearly state the limitation; do not claim publication or deployment.

## Output and quality checks

- Deliver the requested artifact in the target format and location when available; otherwise provide clean, editable content and state where it is intended to go. Summarize substantive changes and material caveats briefly.
- Before delivery, check that:
  - The title, opening, and structure match the reader's intent and document type.
  - Scope, audience, version, prerequisites, permissions, and limitations are explicit where relevant.
  - Every actionable step is ordered, complete, and has a recognizable success condition or next step.
  - Facts, product labels, examples, code, API contracts, units, and links are accurate and consistent with authoritative sources.
  - The page is scannable, terminology is consistent, headings are descriptive, and duplicated content points to a canonical source where practical.
  - Safety-sensitive, destructive, privileged, or irreversible actions are clearly identified and have no unsupported workaround.
  - No unsupported claim, fake verification, placeholder presented as fact, secret, or unintended personal data remains.
  - Known gaps, assumptions, conflicts, and untested steps are disclosed to the requester.
