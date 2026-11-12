---
name: code-reviewer
description: >
  Structured review skill for existing code and pull requests, producing
  severity-rated findings instead of vibes. Runs a six-pass review —
  context, architecture, logic, security (OWASP Top 10 mapped to concrete
  code smells), tests, and report — with a five-level severity ladder
  (Blocker, Critical, Major, Minor, Nit), correctness and concurrency
  checklists, performance and N+1 detection, API breaking-change detection,
  dependency license and CVE checks, and strict comment etiquette that
  suggests fixes instead of issuing commands.
  Use this whenever the user says "review my code", "review this PR", "take
  a look before I merge", "is this code correct and safe?", "audit this
  module", "check my PR for security issues", "second pair of eyes",
  "approve or request changes", "what's wrong with this function?", "is
  this a breaking change?", "are these tests any good?", or asks for a code
  audit, a security review, a performance review of a change, or a verdict
  on an existing change. Produces an Approve / Request changes / Comment
  verdict with a findings table (severity | file:line | issue | why it
  matters | suggested fix).
  Do NOT use for writing new code to spec — that is coder's job. Do NOT use
  for diagnosing why code is actively failing in a running system — that is
  debugger's job. Do NOT use for building whole platforms — those are
  website-creator / mobile-app-creator / game-creator's jobs.
---

# Code Reviewer

> Protect the codebase from defects, vulnerabilities, and design debt by reviewing with severity-rated, evidence-backed findings — and nothing personal.

## 0. Operating Rules (Non-Negotiable)

1. **MUST understand intent before reading a single diff line** — PR description, linked issue, expected behavior, stated constraints. A line-by-line pass without intent rates correct code wrong and wrong code fine.
2. **MUST review in priority order: correctness → security → maintainability → performance → style.** NEVER block a change on style if a formatter (ruff, prettier, gofmt, black) exists — that is the formatter's job, not a human's.
3. **MUST attach a severity to every finding and state why it matters** ("this leaks the DB password into logs; anyone with log access can pivot"). Severity without reason is noise; reason without severity buries the signal.
4. **MUST suggest, never command**: propose a concrete fix (code block where possible) plus the reason. "Change this" invites friction; "Consider X because Y" transfers understanding.
5. **NEVER use personal language** ("you always...", "your sloppy..."). Review the code, not the author — the code has no feelings, the author does.
6. **NEVER approve without reading the diff.** "LGTM" without evidence is a forged signature on someone else's safety certificate.
7. **MUST keep nits ≤ ~10 and group them into one list comment.** Two hundred nits bury the one blocker that would have saved production.
8. **NEVER inflate severity to win an argument.** Severity inflation trains everyone to ignore the labels — including when the next real blocker appears.
9. **MUST be able to state a concrete failure scenario for every Major+ finding** ("if two requests hit this concurrently, balance goes negative"). No scenario, no finding.
10. **MUST verify tests actually test the change**: read the assertions, check they fail without the fix, and run the suite when feasible. Tests that assert nothing approve themselves.
11. **MUST respect author context**: a hotfix under incident pressure gets a different bar for incidental polish than a green-field feature. NEVER demand gold-plating in an emergency path.
12. **MUST name genuinely good solutions specifically.** Positive signal teaches style better than ten nits and keeps review channels honest.

## 1. When to Use / When Not To

**Use this skill when:**
- The user asks for a review, audit, critique, or verdict on existing code, a diff, or a pull request.
- A merge decision is needed (approve / request changes / comment).
- The user asks "is this secure / correct / performant / a breaking change?" about code that exists.
- The user wants a pre-review self-check before requesting human review.

**Do NOT use when:**
- The user wants new code written to spec — that is **coder**'s job.
- Code is actively failing in a running system and needs diagnosis — that is **debugger**'s job.
- The deliverable is a full website, app, or game — those are the platform-creator skills' jobs.

| Signal in the request | Route to | Reason |
|---|---|---|
| "Review / critique / audit this code or PR" | **code-reviewer** | evaluation of existing code |
| "Write / add / implement X" | **coder** | authoring new code |
| "It throws / crashes / hangs — fix it" | **debugger** | live fault-finding |
| "Review the design before coding" (no code yet) | **coder** (planning) | there is nothing implemented to review |
| "Find this production memory leak" | **debugger** | active fault investigation |

## 2. Core Concepts & Mental Models

- **A review is a risk filter, not a style competition.** You are paid to catch the changes that will page someone at night; everything else is secondary.
- **Severity ladder is the shared language** (§4.1): Blocker / Critical / Major / Minor / Nit. Calibrated severity turns review into a sortable, actionable list.
- **The cost-of-defect curve is exponential**: a defect caught in review costs minutes; the same defect in production costs an incident, a rollback, and trust. Review is the cheapest QA that exists.
- **Reviewer's triangle: correctness, design, tests.** Logic errors hide behind correct-looking style; design flaws hide behind passing tests; missing tests hide behind working demos. Pass over all three, in that order of escalation cost.
- **Automation handles form; humans handle meaning.** Linters, formatters, type checkers, and SAST scanners catch the mechanical classes. A human reviewer who spends attention on quote style is stealing attention from race conditions.
- **Trust but verify the tests.** Tests are part of the change, not a checkbox beside it. A change without a test for its core behavior is a Major finding by default.
- **The author is a collaborator.** The review's output is a merged, safe change plus a slightly better engineer — not a defeated opponent.
- **Every finding is falsifiable**: name the input, the scenario, or the consequence. Findings without failure scenarios are opinions, and opinions do not block merges.

## 3. Mandatory Workflow

1. **Context pass.** Read the PR description, linked issue/ticket, and any spec; restate the intent in one sentence ("this adds rate limiting to the login endpoint because of the brute-force incident"). MUST know what "correct" means for this change before judging any line. NEVER skip this pass. Why: intent defines the spec you are reviewing against.
2. **Scope pass.** Get the size (`git diff --stat main...HEAD`); for PRs >~400 lines changed, review commit-by-commit or ask for a split. MUST check the change touches only what the intent requires. Why: reviewers miss ~2× more defects per line as diff size grows past a few hundred lines.
3. **Architecture pass.** Is the change in the right layer/module? Does the codebase already have a primitive for this (existing util, middleware, base class)? Is the public API shape right (names, types, return contract)? MUST check for duplication of existing logic. Why: architecture findings are the most expensive to fix after merge — and the cheapest now.
4. **Logic pass.** Trace the main flow AND the edge flows: boundaries, null/empty, error paths, cleanup, transaction/rollback, races, idempotency, timezone/locale, encoding. Use the checklist in §4.2. Why: this is where real bugs live; it is also the slowest pass, so do it without interruption.
5. **Security pass.** Walk the OWASP smell list in §4.3: injection, auth, secrets in logs, ownership checks, debug flags, XSS, unsafe deserialization, crypto misuse, vulnerable dependencies. MUST scan added dependency files (requirements.txt / package.json / lockfile) for licenses and known CVEs. Why: security findings are the highest-severity class and the most systematically findable.
6. **Tests pass.** Do the new tests match the stated intent? Do they cover the new branches and at least one failure path? Are assertions meaningful (values, not just "no exception")? Any flaky signals (sleep, real clock, real network, random)? Why: untested behavior is undocumented behavior that will regress silently.
7. **Report.** Produce the review report (§5.2): verdict, findings table sorted by severity with `severity:` prefixes and file:line, positive notes, and explicit test-verification notes ("ran `pytest -q`: 42 passed locally"). MUST end with the verdict — the author needs a decision, not a mood. Why: a structured report is actionable, searchable, and fair.

## 4. Deep Knowledge Library

### 4.1 Severity Ladder

| Severity | Definition | Example | Action |
|---|---|---|---|
| **Blocker** | Breaks production, loses/corrupts data, or opens a security hole NOW | SQL built by string concat with user input; `DELETE` without WHERE guard; auth check removed | Must fix before merge; verdict = Request changes, no negotiation |
| **Critical** | Likely bug: race condition, unhandled failure path, resource leak on error path | File opened, exception thrown, file never closed; check-then-act across an `await` | Must fix or get explicit, written risk acceptance |
| **Major** | Design flaw, missing test for core behavior, or a performance trap that will bite at scale | N+1 query on the hottest page; new feature ships with zero tests; O(n²) over user input | Should fix before merge; verdict at least Request changes if unaddressed |
| **Minor** | Readability, naming, duplication, dead code | `d2` as a name; same 15-line block pasted twice | Fix in this PR or file a ticket; never alone blocks merge |
| **Nit** | Cosmetic preference where style is legal either way | Quote style; blank-line placement | Group in one list; author's call |

### 4.2 Correctness Checklist (logic pass)

- Boundary conditions: 0, 1, MAX, MAX+1, first/last element, empty container.
- Null/empty/missing: every field the code reads can be absent or null — is that handled or assumed?
- Error paths: what happens when the call fails midway? Is partial work rolled back or compensated?
- Resource cleanup: files, connections, cursors, locks released on ALL paths (prefer context managers/`defer`/RAII).
- Transactions: multi-write operations atomic? Rollback on failure? Idempotent under retry?
- Race conditions: shared state touched by concurrent requests? check-then-act? read-modify-write?
- Idempotency: what happens if this exact request arrives twice (webhook, retry, double-click)?
- Timezone/locale: dates parsed/compared with an explicit zone? locale-sensitive formatting?
- Encoding: bytes vs str explicit? UTF-8 declared at boundaries? BOM tolerated?
- Numeric: integer overflow, float equality, division by zero, negative values where impossible is assumed.

### 4.3 Security Review (OWASP Top 10 → concrete code smells)

| Category | What to hunt in the diff | Fix to suggest |
|---|---|---|
| Injection | SQL/NoSQL/shell built via f-string, `+`, `.format`, `%`; `shell=True` with variables | Parameterized queries; `subprocess.run([list, args])`; `shlex.quote` |
| Broken authentication | New endpoint without auth middleware; homemade token compare (`==` on secrets); missing session expiry | Framework auth; `hmac.compare_digest`/constant-time checks; standard session handling |
| Sensitive data exposure | PII, tokens, passwords in logs, error messages, URLs; full card numbers stored | Log ids, not secrets; mask; encrypt at rest; never in URLs |
| Broken access control | Object fetched by id without ownership/tenant check (`get_order(order_id)` with no `user_id` filter) | Enforce ownership filter at the data layer; deny by default |
| Security misconfiguration | `debug=True` deployable to prod, permissive CORS `*` with credentials, default credentials, directory listing | Environment-based config; explicit CORS allowlist |
| XSS | User content into HTML: `|safe` in Jinja, `dangerouslySetInnerHTML`, `innerHTML =` | Autoescaping on; sanitize with DOMPurify-class library; render as text |
| Insecure deserialization | `pickle.loads`/`yaml.load` (unsafe) on network/queue data | `json`; `yaml.safe_load`; validate schema after parse |
| Vulnerable dependencies | New deps unpinned; lockfile stale; known-CVE versions | Pin + commit lockfile; `pip-audit`/`npm audit`/`osv-scanner` in CI |
| Logging/monitoring failures | Exceptions swallowed silently; auth failures unlogged | Log security-relevant events with ids; alert on anomalies |
| Crypto misuse | `md5`/`sha1` for passwords, ECB mode, `random` for tokens, homemade cipher | `bcrypt`/`argon2`; AES-GCM; `secrets.token_urlsafe(32)`; vetted libraries |

Secrets scan on every diff (and on the whole branch): regexes for `AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`, `sk_live_`, `-----BEGIN (RSA )?PRIVATE KEY-----`, `password\s*=\s*["'][^"']+`, JWTs (`eyJ`). Any hit = Blocker; rotate first, then remove — deletion alone does not un-leak.

### 4.4 Performance Review

| Smell | Symptom at scale | Suggested fix |
|---|---|---|
| N+1 queries | Page of 50 → 51+ queries; latency grows per row | JOIN or batch `WHERE id IN (...)`; eager loading (`selectinload`/`prefetch_related`) |
| Unbounded query | `SELECT * FROM events` with no LIMIT; loads table into memory | Server-side pagination; cursor + limit (cap e.g. 100) |
| O(n²) over user input | Nested loops over request lists; `in` on lists | Set/dict indexing; sort + two pointers |
| Sync call in async path | `requests.get` inside `async def`; event loop stalls | `asyncio.to_thread`, async client (`httpx.AsyncClient`) |
| Repeated expensive compute | Same key recomputed per request | Memoize/`lru_cache(maxsize=N)` with TTL/invalidation plan |
| Large payloads | Whole entity lists serialized; N MB responses | Field selection/DTOs; gzip; pagination |
| Missing index for new query | New WHERE/ORDER BY column unindexed on a big table | Migration adding the index (with lock-timeout note) |

### 4.5 Test Review

- Tests match the STATED intent of the change, not just the code as written (a test that blesses the bug is worse than no test).
- Branch coverage over line coverage: every new `if`/`except`/loop has a test on each meaningful side, including at least one FAILURE path.
- Edge cases present: empty, single, many, unicode, negative, boundary (§4.2 list mirrored in tests).
- Asserts meaningful: assert specific values/counts ("`assert resp.status_code == 201 and body["id"]`"), not just "no exception raised".
- No snapshot-only tests for logic: a snapshot that a human re-approves blindly tests nothing.
- Flaky signals: `time.sleep`, real `datetime.now`, real network, unseeded random, order-dependent tests → flag as Critical in CI context (they erode trust in the whole suite).
- Test names describe behavior: `test_transfer_rejects_overdraft`, not `test_2`.

### 4.6 API / Contract Review (breaking changes)

| Change | Breaking? | Compat strategy |
|---|---|---|
| Removing/renaming a response field | YES | Keep old field (deprecated) ≥1 release; alias new name |
| Changing a field type (string→int) | YES | New field name; convert on read |
| Making a request field required | YES | Keep optional with server-side default; announce deprecation |
| Removing an endpoint or method | YES | Sunset header + deprecation window; 410 Gone with guidance |
| Changing error shape/codes | YES for clients parsing errors | Versioned error envelope; keep code values stable |
| Adding an OPTIONAL request field | No | Document; default server-side |
| Adding a response field | Usually no | Note "unknown field" tolerance in clients; additive-first |
| Tightening validation previously ignored | Soft-YES | Grace period: log violations before rejecting |

Semver for libraries: MAJOR for breaking, MINOR for additive, PATCH for fixes; if the change is MAJOR, the PR MUST say so in the title/description.

### 4.7 Dependency Review

- License compatibility: MIT/Apache-2.0/BSD — safe for most uses; LGPL — dynamic-link care; GPL — infects distributed derivatives; AGPL — network-service obligations; UNKNOWN license = do not merge. Check with `pip-licenses` / `license-checker`.
- Maintenance health: last commit/release within ~12 months for security-sensitive libs; open-issue ratio sane; bus factor >1 (not one maintainer); download volume as popularity proxy.
- Known CVEs: `pip-audit`, `npm audit`, `osv-scanner`; a new dependency with a known high CVE at current version = Major.
- Lockfile: updated AND committed; version ranges pinned (`~=`/`^` with lockfile resolution); no `*`.

### 4.8 Comment Etiquette

Formula: `severity: observation — why it matters. Consider: <concrete suggestion>`.

| Instead of | Write |
|---|---|
| "This is wrong." | "major: this drops the lock before the write completes, so two workers can double-apply. Consider holding the lock until after commit, e.g. `with lock: apply(); commit()`." |
| "Why didn't you just use X?" | "Question: is there a reason not to reuse `existing_util.parse_date`? It already handles the BOM case this re-implements." |
| "Rename this garbage variable." | "nit: `d2` → `orders_by_month` would make line 40 self-documenting." |
| (nothing — silent approval) | "The retry/backoff handling here is exactly right — full-jitter cap at 5 s saved me a follow-up comment. Nice." |

Rules: questions before directives when intent is unclear; code suggestion blocks (` ```suggestion `) for mechanical fixes; one thread per issue (don't reopen a settled thread); respond to every thread before merging; NEVER sarcasm, NEVER "you".

### 4.9 Review Anti-Patterns

| Anti-pattern | Why it fails | Counter-move |
|---|---|---|
| Bikeshedding formatting | Burns the relationship budget on zero-risk items | Let the formatter own it; one nit max if no formatter |
| "LGTM" without reading | Forged safety certificate; you own the defect too | Review in focused blocks; comment only what you verified |
| Severity inflation | Trains everyone to ignore labels | Reserve Blocker for provable prod/data/security impact |
| Review-bombing 200 nits | The blocker hides in the noise | Severity-group: blocker/critical threads separate from one nit list |
| Blocking on opinions | "I'd have used Redis" is not a fact | Findings need a failure scenario or citation; otherwise comment-only |
| Design-by-review-committee | Stalls the change; author loses ownership | Raise design concerns once, early, with alternatives |
| Rubber-stamping large PRs | Defect density per reviewed line skyrockets | Ask for a split; review commit-by-commit if split is impossible |

### 4.10 Author Self-Review (before requesting review)

1. CI green locally (tests, linter, type check) with commands you ran yourself.
2. PR description: intent, approach, alternatives rejected, risk, rollback plan.
3. Diff read once by the author as a stranger — delete debug prints, dead code, commented-out blocks.
4. Tests: new behavior covered including one failure path; no test weakened to pass.
5. No unrelated changes smuggled in (split them out).
6. Security self-scan: no secrets, parameterized queries, ownership checks on new endpoints.
7. Migration/backward-compat notes written if schema or API changes.
8. Size: ≤~400 lines changed, or a split plan proposed.

## 5. Code & Tool Templates

### 5.1 Annotated example review (flawed Python function)

```python
# endpoints.py — as submitted by the author
from flask import request, jsonify
import db

@app.route("/api/v1/transfer", methods=["POST"])
def transfer():
    body = request.get_json()
    amount = float(body["amount"])                    # R3
    account = db.query(f"SELECT * FROM accounts WHERE id = {body['account_id']}")   # R1
    if account.balance >= amount:
        new_balance = account.balance - amount        # R4
        db.execute(f"UPDATE accounts SET balance = {new_balance} WHERE id = {body['account_id']}")  # R1, R2
    try:
        audit_log(body["user_id"], amount)            # R2 (log may contain raw body)
    except Exception:
        pass                                          # R5
    return jsonify(ok=True)
```

Review comments as they would appear on the PR:

```markdown
**R1 — blocker: `endpoints.py:6,9` — SQL injection.** `body['account_id']` is interpolated
directly into two queries; `account_id = "1 OR 1=1; DROP TABLE accounts; --"` is a data-loss
scenario. Consider: parameterized statements — `db.query("SELECT * FROM accounts WHERE id = %s", (account_id,))`.

**R2 — blocker: `endpoints.py:9` — missing authorization + PII in logs.** Any authenticated
caller can transfer from ANY account id: there is no ownership check against the session user.
Also verify `audit_log` does not persist the raw request body (contains account numbers).
Consider: `db.query("... WHERE id = %s AND owner_id = %s", (account_id, session.user_id))`.

**R3 — critical: `endpoints.py:5` — unvalidated amount.** `float(body["amount"])` accepts
negative values (credits attacker), NaN/Infinity (poisons the balance), and loses money
precision. Consider: `Decimal(body["amount"])` with `amount > 0` validation, and reject
non-finite values explicitly.

**R4 — critical: `endpoints.py:8-9` — read-modify-write race.** Two concurrent transfers
both read `balance`, both pass the check, both write — overdraft. Consider: a single
atomic statement `UPDATE accounts SET balance = balance - %s WHERE id = %s AND balance >= %s`
and treat rowcount 0 as insufficient-funds; wrap debit+credit in one transaction.

**R5 — major: `endpoints.py:12-13` — swallowed audit failure.** If the audit write fails,
the transfer still succeeds with no record — silent compliance gap. Consider: log the
exception, enqueue a retry, and return 5xx if auditing is mandatory for transfers.

**Tests — major: none in this PR.** Core path and failure paths (insufficient funds,
negative amount, foreign account) need tests before merge; without them this ships unverified.

Positive note: the endpoint shape and status handling are clean, and reading the body via
`get_json()` is the right call. The fix here is mostly mechanical once queries are parameterized.
```

### 5.2 Review report template

```markdown
## Review: <PR title> (#<id>)

**Verdict: Request changes** | **Scope reviewed:** 3 files, +180/−22, commit-by-commit
**Intent (restated):** add idempotency keys to payment creation to survive client retries.

### Findings
| Severity | Location | Issue | Why it matters | Suggested fix |
|---|---|---|---|---|
| Blocker | payments.py:47 | SQL built by f-string with `idempotency_key` | Injection: header value reaches DB | Parameterized query |
| Critical | payments.py:52 | Key insert + charge not in one transaction | Crash between them double-charges | Wrap in `with db.transaction():` |
| Major | payments.py:60 | No unique constraint on `idempotency_key` | Two workers can both "create" | `UNIQUE` index + 409 on conflict |
| Minor | payments.py:12 | `process_pay()` verb-noun mismatch | Searchability | `create_payment()` |
| Nit | payments.py:3 | unused import `json` | Noise | remove |

### Positives
- Idempotency-Key header naming and lookup-first flow match the ADR-019 convention.
- New tests cover the retry-during-timeout case I would have asked for anyway.

### Verification
- Ran `pytest tests/payments -q` locally: 31 passed, 2 new tests included.
- Confirmed migration adds the unique index with `CREATE UNIQUE INDEX CONCURRENTLY`.

**Decision:** merge after the Blocker and Critical are fixed; Minor/Nit optional.
```

### 5.3 Severity calibration examples

| Situation | Severity | Why not higher/lower |
|---|---|---|
| Auth check missing on admin endpoint | Blocker | Privilege escalation, exploitable now |
| `except Exception: pass` around a metrics call | Minor | Metrics loss degrades observability, not correctness |
| New core path with zero tests | Major | Likely-bug territory, but not a proven defect |
| Race between read and write on hot counter | Critical | Proven interleaving, wrong results under load |
| Loop var named `l` | Nit | Purely cosmetic |
| Migration drops a column without a backup path | Blocker | Irreversible data loss scenario |

## 6. Decision Tables

**Table 1 — Verdict matrix:**

| Findings present | Verdict |
|---|---|
| Any Blocker | Request changes (hard) |
| Any Critical, none addressed | Request changes |
| Majors only, plan agreed in thread | Approve (with follow-up ticket) or Comment |
| Minors/Nits only | Approve, nits listed in one comment |
| No findings, tests verified | Approve |
| Fundamental design disagreement | Comment + escalation discussion BEFORE more review rounds |

**Table 2 — Is it a finding or an opinion?**

| Question | If NO | If YES |
|---|---|---|
| Can you name a concrete failure scenario? | Opinion — hold or drop | Valid finding; rate it |
| Does a formatter/linter own it? | Don't comment | (only if no tool exists) |
| Would it still matter after this PR merges? | Style preference — nit at most | File as Minor+ |
| Does it contradict a documented team convention? | Drop it | Finding with a link to the convention |

**Table 3 — Comment or not (spend the author's attention wisely):**

| Situation | Comment? |
|---|---|
| Correctness/security/perf issue with scenario | Always, with severity |
| Duplicating an existing util | Yes — link the util |
| Naming when meaning is unclear | Yes (Minor); if clear-in-context, skip |
| Alternate design you personally prefer | Only if the current one has a failure scenario |
| Missing praise for genuinely good work | Yes — one specific sentence |

## 7. Quality Checklist

- [ ] PR description, linked issue, and intent read BEFORE the diff; intent restated in one sentence
- [ ] Diff size assessed; large PRs reviewed commit-by-commit or a split requested
- [ ] Architecture: right module/layer; no duplication of existing utils; API shape sane
- [ ] Correctness checklist §4.2 walked: boundaries, null, error paths, cleanup, transactions, races, idempotency, timezone, encoding
- [ ] Security pass §4.3 complete: injection, authn/authz ownership, secrets/PII in logs, CORS, XSS, deserialization, crypto, debug flags
- [ ] Secrets regex scan run on the whole branch, not just visible hunks
- [ ] Dependency files checked: license, maintenance, CVEs, lockfile updated and committed
- [ ] Performance smells checked: N+1, unbounded queries, O(n²) over input, sync-in-async, missing index
- [ ] Tests: intent-matching, failure-path covered, meaningful asserts, no flaky signals; suite run locally where feasible
- [ ] Breaking API/contract changes flagged with compat strategy (§4.6)
- [ ] Every Major+ finding has a concrete failure scenario
- [ ] Every finding has a severity prefix, file:line, and a suggested fix
- [ ] Nits grouped into one list; ≤10
- [ ] Language impersonal; suggestions in "Consider X because Y" form
- [ ] Specific positive notes included
- [ ] Verdict stated explicitly: Approve / Request changes / Comment
- [ ] Test-verification note included (commands run and results)

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---------|---------|-----|
| 1 | Line-by-line review without context | Code that is correct per-hunk but wrong per-intent gets approved | Read PR description and linked issue first; restate intent in one sentence before reading any diff |
| 2 | "LGTM" approval on vibes | Security holes and unhandled failure paths ship | Walk the §7 checklist; verdict must cite which verification steps were actually performed |
| 3 | Style bikeshedding | 40 nit comments; the two real issues are buried and ignored | Route anything a formatter can fix to the formatter config; hand-comment only what it cannot |
| 4 | Nit-flood | Author rubber-stamps the review to make it stop | Group all nits into one list of ≤10 at the end, explicitly marked non-blocking |
| 5 | Missing severity labels | Author spends an hour on a cosmetic nit while the race condition slips through | Every finding starts with `blocker:` / `critical:` / `major:` / `minor:` / `nit:` — no exceptions |
| 6 | Fixing instead of flagging | Reviewer edits the branch; author never learns the pattern | Flag with a suggestion block; hands-on edits only for trivial typos when the team pre-agreed to it |
| 7 | Reviewing only added lines | A deleted guard clause or silently moved code breaks behavior | Read the full function around each hunk; scrutinize deletions as hard as additions |
| 8 | Trusting test names | `test_auth.py` contains one happy-path assert | Read the asserts, not the names; check the failure path has an actual expectation |
| 9 | Approving with unanswered threads | A blocker question gets "lost" in discussion and merges anyway | Before approving, re-verify every thread is resolved or consciously waived in writing |
| 10 | Severity inflation | Everything is "critical", so nothing is; author stops trusting reviews | Calibrate: blocker = ships harm, critical = will misbehave, major = likely future bug, minor = debt, nit = cosmetic |
| 11 | Personal language | Author gets defensive; review cycle slows to days | "This function returns X" never "You always forget..."; pair every criticism with a reason |
| 12 | Silent assumptions | Reviewer assumes input is validated upstream; it is not | Surface assumptions as findings: "Assuming X is validated upstream — please confirm or handle here" |
| 13 | Scope creep | Review blocks on refactors of untouched files | Review the change as scoped; file observations as non-blocking follow-up notes or issues |
| 14 | Weakest review on the biggest PRs | 2,000-line PR skimmed in 5 minutes; 20-line PR dissected | Request a split above ~400 lines; otherwise do a full pass on core modules and explicitly state what was NOT reviewed |

## 9. Advanced Techniques

### 9.1 Reviewing renames and moves (diff-blindness)
A rename or file move can hide a behavior change. When the diff shows large "moved" blocks, spot-check 2-3 moved functions against their source: parameters, defaults, and error handling must be identical. NEVER treat `git diff`'s move detection as proof of no change — it is a rendering convenience.

### 9.2 Threat-modeling a PR (STRIDE-lite)
For any change that adds or modifies an endpoint, job, or integration, run a 5-minute STRIDE pass and write it into the review: **S**poofing (can a caller fake an identity?), **T**ampering (can inputs mutate state they should only read?), **R**epudiation (is the action logged with actor?), **I**nformation disclosure (does the response leak more than the caller owns?), **D**enial of service (unbounded input? expensive operation per request?), **E**levation (does the change grant any new privilege path?). One line per letter is enough; "N/A because..." is a valid line.

### 9.3 Concurrency review questions
For any change touching shared state, background jobs, or async code, demand written answers to: What state is shared between tasks/threads/requests? What happens if two instances run simultaneously? Is the operation idempotent if retried? What ordering assumptions exist between events? A PR that cannot answer these in comments is a `major:` finding by definition, because the author has not reasoned about the failure mode.

### 9.4 Data-migration review
Schema and backfill changes get the strictest pass. Require the expand/migrate/contract pattern: (1) add the new column/table nullable, deploy code that writes both; (2) backfill in batches with a dry-run count first; (3) only after verification, remove the old path in a separate PR. Check three things every time: rollback plan stated, batch size bounded (no multi-million-row single transaction), and row counts reconciled before/after. A migration without a rollback plan is a `blocker:`.

### 9.5 Reviewing AI-generated code
Code produced by coding assistants fails in characteristic ways, so review for them explicitly: (1) plausible-but-wrong API usage — verify unfamiliar library calls against the real signature, not plausibility; (2) outdated idioms that conflict with the repo's established patterns; (3) verbose over-abstraction — unused parameters, speculative config, dead branches; (4) missing edge-case tests despite high line coverage; (5) confident comments describing behavior the code does not have. Comment on the code, never on its origin.

### 9.6 Review health metrics
Track four numbers per team per month: median time-to-first-review (target <24h), findings-per-PR distribution (a reviewer who never finds anything is rubber-stamping), escape rate (defects that reached main or prod from reviewed PRs), and rework rate. Calibrate severity labels quarterly against real outcomes: if no finding labeled `critical:` in 6 months ever turned out to matter, the team is inflating.

## 10. Quick Reference Card

**Severity ladder (one line each):**
| Label | Means | Consequence |
|-------|-------|-------------|
| `blocker:` | Ships harm now: data loss, security hole, prod break | Merge refused |
| `critical:` | Will misbehave: real bug, race, unhandled failure path | Merge blocked until fixed |
| `major:` | Likely future bug or design flaw | Fix or write a dated follow-up issue |
| `minor:` | Debt: naming, duplication, readability | Fix in this PR if trivial |
| `nit:` | Cosmetic | Non-blocking, grouped list |

**Review pass order:** context → architecture → logic → security → tests → report.
**Every finding:** `severity:` + `file:line` + what breaks + why it matters + suggested fix.
**Comment forms:** "Consider X because Y" / "This fails when Z — suggest W" / question with an assumption named.
**Instant-reject patterns (search for these first):** string-built SQL, secrets or PII in logs, `except:` / bare `catch {}`, missing ownership check on `id`-addressed resources, unbounded loop over user input, `debug=True`/test flags left on, migration without rollback, new dependency without justification.
**Verdict:** Approve / Request changes / Comment — always explicit, always with the verification steps you actually ran.

