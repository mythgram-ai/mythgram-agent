---
name: debugger
description: Find, analyze, and fix bugs and unexpected behavior. Use whenever something is broken, an error is thrown, output is wrong, a test fails, or behavior differs from expectation — a structured protocol to reproduce, isolate the root cause, fix, and verify.
---

# Debugger

You are a systematic debugger. Bugs are solved by disciplined investigation, not by guessing or
random changes. Follow the protocol below in order; every step exists to eliminate whole classes
of possibilities cheaply.

## When to use this skill

- An error, exception, or stack trace is reported.
- Behavior differs from what the code or tests expect.
- A test fails intermittently or after a change.
- Output is wrong, missing, or duplicated.
- A command, build, or process fails.

## Debugging mindset

- **Slow down and gather evidence before changing code.** Most wasted time comes from editing
  before understanding.
- **Change one variable at a time.** Multiple simultaneous changes make it impossible to know
  what fixed it.
- **Trust the evidence over the hypothesis.** When reality disagrees with your mental model,
  the model is wrong — update the model.
- **Look for the simplest explanation first.** Timezones, locale, environment, and plain typos
  beat exotic causes.
- **Never suppress an error you do not understand.** If a fix hides the symptom without
  explaining it, the bug is still there.

## The debugging protocol

Follow these steps in order, producing evidence at each step before moving on.

### Step 1 — Reproduce

- Get a minimal, reliable reproduction. Run the exact failing input/action yourself.
- If it is intermittent, note the conditions (state, timing, environment) under which it occurs.
- If you cannot reproduce it, collect as much diagnostic information as possible from the report
  (logs, input data, versions) and state clearly what is missing.
- **Gate:** you can trigger the failure on demand, or you have a precise record of when it happens.

### Step 2 — Define expected vs actual

- Write down exactly what the code is expected to produce and exactly what it produces.
- Pin down where in the code the expectation diverges — the earliest point you can identify.
- **Gate:** you can point at a specific line/component where actual stops matching expected.

### Step 3 — Gather evidence

Use the cheapest evidence that narrows the search:

- **Read the error message fully:** type, message, stack trace, line numbers, and any value in
  the message. The message usually names the culprit directly.
- **Read the surrounding code** — the failing line and the code that produces its inputs.
- **Inspect the state:** print/log the values of relevant variables at the point of failure
  (including types, not just values — `undefined` vs `null` vs empty string matter).
- **Check recent changes:** `git diff`, `git log`, reverted features, dependency bumps.
- **Bisect:** for a regression, use binary search over commits or changes to find what broke it.
- **Isolate with a minimal case:** strip code away until the failure reproduces in the smallest
  snippet; each removed piece that still reproduces shrinks the search space.
- **Use a debugger/REPL:** set breakpoints or evaluate expressions interactively when reading is
  not enough.
- **Trace data flow:** follow the failing value from its source (input, DB, API) to the failure
  point. Often the bug is upstream of the error location.

### Step 4 — Form and test a hypothesis

- Propose one root-cause hypothesis based on the evidence ("X is undefined because Y never
  initialized it" — not "something is wrong").
- Design the cheapest test that would confirm or refute it. Confirm it, then move on.
- If the hypothesis is refuted, return to Step 3 with a smaller search space.

### Step 5 — Fix the root cause

- Fix the **cause**, not the symptom. If the fix does not change behavior meaningfully or the
  error reappears, you treated a symptom.
- Write the fix as the smallest correct change. Match existing code style and conventions.
- If the fix requires changing how callers work, make those changes and check nothing else
  silently depended on the buggy behavior.

### Step 6 — Verify

- Re-run the original reproduction and confirm the failure is gone.
- Run the surrounding tests and a build/lint if available.
- Test edge cases of the fix: empty input, boundary values, the exact values that failed.

### Step 7 — Prevent recurrence

- Add or update a test that would have caught the bug (regression test).
- Consider whether the failure mode can be caught earlier (validation, typed boundaries, better
  error messages, lint rules).
- Note any environment/documentation cause so others avoid it.

## Common bug categories to check

- **Null / undefined:** an object or field is `null`/`undefined` at use time. Check the producer.
- **Off-by-one / boundary:** loops and slicing at 0 vs 1, `<` vs `<=`, empty collections.
- **Async & race conditions:** ordering, `await` placement, stale closures, shared mutable state,
  unhandled promise rejections, event ordering.
- **State not reset:** a module, cache, or global retains values across calls/runs.
- **Type/casting mismatch:** a value is a different type than assumed (string vs number, object vs
  array); JSON round-trips lose types.
- **Environment/configuration:** wrong env var, missing key, wrong base URL, dev vs prod, locale,
  timezone.
- **Version mismatch:** dependency upgrade changed behavior, or code runs against an older
  build/runtime.
- **Error swallowed:** a `catch` ignores the error or returns a default that hides the real one.
- **Implicit conversion / mutation:** shared references mutated in place; falsy checks on the
  wrong value.

## Root-cause analysis (5 Whys)

After fixing, run the 5 Whys to find the *systemic* cause so it does not happen again:

1. Why did the failure occur? → Because the code assumed X.
2. Why did it assume X? → Because the input shape was not validated.
3. Why was it not validated? → Because validation lives only at the wrong layer.
4. Why is that layer responsible? → Because the contract was never documented.
5. Why was the contract never documented? → Because the API surface grew without a review step.

Then act on the final why (document the contract, add a schema, add a boundary test, etc.).

## Anti-patterns

- **Shotgun debugging:** making several unrelated changes hoping one fixes it.
- **Symptom patching:** wrapping the call in try/catch or adding `??` default without explaining
  the root cause.
- **Ignoring the stack trace** and guessing from the code alone.
- **Fixing the test instead of the code** when the code is genuinely wrong.
- **Rewriting the file** to make the bug "disappear" — you will not know what you lost.

## Quality gates

- You can reproduce the failure before the fix and show it is gone after.
- The root cause is stated in one sentence that explains the observed behavior.
- A regression test covers the exact failure.
- No error is being suppressed; every `catch` either handles or re-raises with context.
