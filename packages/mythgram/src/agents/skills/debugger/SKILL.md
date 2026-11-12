---
name: debugger
description: >
  Systematic fault-finding and fixing skill for code that exists but
  misbehaves. Runs a scientific debugging loop — reproduce, hypothesize,
  predict, test, refine — with a full toolchain: pdb and Python diagnostics,
  browser and Node DevTools, bash tracing, SQL EXPLAIN, gdb/valgrind/
  sanitizers, git bisect, bisection of inputs and code, stack-trace reading
  rituals, bug-class playbooks (off-by-one, races, stale state, encoding,
  timezones, floating point, heisenbugs, works-on-my-machine,
  only-fails-in-prod), network/API debugging with curl, database debugging,
  a 20+-entry error-message dictionary, and a strict fix protocol with
  failing tests first and blameless post-mortems.
  Use this whenever the user says "it doesn't work", "it crashes", "it
  throws this error", "why is this returning the wrong value", "it hangs",
  "fix this bug", "this test fails", "it worked yesterday", "works on my
  machine but not in prod", "intermittent failure", "random crash", "help
  me read this stack trace", "diagnose this 500 error", "find the memory
  leak", or pastes a stack trace, error message, or failing test output.
  Use it for ANY defect in existing code, configuration, queries, or
  pipelines, and for investigating flaky or intermittent behavior.
  Do NOT use for writing new features from scratch — that is coder's job.
  Do NOT use for reviewing or grading code that is not currently failing —
  that is code-reviewer's job. Do NOT use for broad business or process
  problems that are not a specific code fault — that is problem-solver's
  job. Do NOT use for pure "what does this API do" questions with no fault.
---

# Debugger

> Find and eliminate the true root cause of any failure using evidence, hypothesis testing, and bisection — never guesswork and never symptom-patching.

## 0. Operating Rules (Non-Negotiable)

1. **MUST reproduce the failure first, on demand, with an exact command.** An unreproducible bug cannot be verified as fixed. If reproduction is hard, that effort IS the debugging — invest in it before theorizing.
2. **MUST change ONE thing at a time between runs.** Multi-change shotgun debugging destroys causal information; when it "works" you will not know why.
3. **MUST read the FULL error message and stack trace top to bottom before acting, and copy the exact text** for searching. Half-read error messages cause half-wrong fixes.
4. **NEVER fix symptoms** (catching an exception to silence it, restarting to clear it, casting to bypass it) without explaining the underlying cause. Symptoms return at the worst possible time, usually multiplied.
5. **Assume the root cause is DEEPER (earlier) than the reported error line.** The error is where the program finally noticed; the defect is usually where the bad state was created.
6. **MUST record a hypothesis log**: each hypothesis with its prediction and the result of testing it. Memory + bias will otherwise convince you the theory you started with was right.
7. **MUST write a failing test BEFORE applying the fix**, watch it fail, apply the minimal root-cause fix, watch it pass, then run the FULL suite. "Fixed" without a test is "hopefully fixed".
8. **MUST preserve evidence before changing anything**: save the failing input, full logs, stack trace, and version numbers (`python --version`, commit SHA, config). Evidence destroyed by a re-run is evidence you needed.
9. **Time-box free exploration to ~30–45 minutes.** If not localized by then, switch to systematic bisection (§4.5). Staring harder is not a strategy.
10. **NEVER experiment directly on production.** Observe with read-only tooling (logs, metrics, `EXPLAIN`); take copies of data; every prod change must be reversible and logged.
11. **MUST verify the fix in the environment where it failed** (same data, config, timezone, locale where possible). A fix that only works on your machine is not a fix.
12. **MUST state the root cause in one plain sentence a non-expert could follow.** If you cannot, you have found a workaround, not the cause.

## 1. When to Use / When Not To

**Use this skill when:**
- Code that already exists throws, crashes, hangs, produces wrong output, or leaks resources.
- A test fails, a build breaks, a deployment misbehaves, or a query is slow enough to be called "broken".
- Failures are intermittent, environment-specific, or only visible in production.
- The user pastes a stack trace, error message, or failing test output.

**Do NOT use when:**
- The user wants new features or fresh code with no defect present — that is **coder**'s job.
- The user wants a general review of healthy code — that is **code-reviewer**'s job.
- The "problem" is a business/process/data-analysis question, not a specific fault — that is **problem-solver**'s or **information-analyst**'s job.

| Signal in the request | Route to | Reason |
|---|---|---|
| "Fix this crash / error / wrong output" | **debugger** | active fault in existing code |
| "Write me a function that does X" | **coder** | authoring, no fault present |
| "Review my PR before I merge" | **code-reviewer** | evaluation of non-failing code |
| "The server is slow" (performance fault) | **debugger** | perf-masquerading-as-bug is in scope |
| "Our churn spiked, figure out why" (business) | **problem-solver** | not a code fault |
| "Analyze this dataset" | **information-analyst** | analysis, not fault-finding |

## 2. Core Concepts & Mental Models

- **Debugging is the scientific method under time pressure**: reproduce → hypothesize → predict → test → refine. A hypothesis without a falsifiable prediction is a guess, not a hypothesis.
- **The stack trace is evidence, not truth.** It tells you where execution noticed a problem, not necessarily where the problem was created. Expect a fault chain: bad input → bad state → wrong branch → crash.
- **You are searching, not thinking.** The bug lives in a space of code × input × state × environment. Every experiment should HALVE that space; experiments that don't shrink it are entertainment.
- **Determinism is the whole game.** A reliably reproducible bug is already 80% solved. Converting flaky → deterministic (freeze time, seed randomness, single-thread, fixed dataset) is usually the highest-value move.
- **Logs are a recording of the past; a debugger is a lab.** Use logs for production and history; use a debugger for controlled experiments where you can poke variables.
- **Bug taxonomy directs tooling** (§4.1): a syntax error and a race condition need completely different weapons; misclassifying the bug wastes an hour before you start.
- **"It works on my machine" is data, not an insult.** Environment differences (versions, env vars, locale, timezone, data volume, clock) are a finite, checkable list (§4.6 playbooks).
- **The fix is the smallest change that removes the cause.** Everything larger is scope creep that ships new bugs; everything smaller leaves the cause alive.

## 3. Mandatory Workflow

1. **Reproduce reliably.** Build the shortest exact command + input + environment that fails every time. MUST record: command, input file, versions, config flags. If flaky, first make it deterministic (seed randomness, freeze time, reduce concurrency to 1, shrink the dataset). Why: everything after this step depends on a stable oracle.
2. **Capture evidence.** Copy the exact error message, full stack trace, last ~50 log lines, and relevant versions into your notes BEFORE touching anything. Why: changing state destroys the crime scene.
3. **Classify the bug** using the taxonomy in §4.1 (syntax / runtime / logic / environment / data / concurrency / integration / performance). MUST pick a class and name its signature symptom. Why: the class selects the toolchain and playbook.
4. **Read the stack trace properly** (§4.2): top-down, own frames first, then walk backwards to where the bad value was born. Why: the error line is the scene of discovery, not the scene of the crime.
5. **Form hypotheses and log them.** Write 2–5 hypotheses in a table: hypothesis | prediction if true | test. MUST make each prediction concrete and falsifiable (e.g. "if the token expired, the response header `X-Auth-Error` will say `token_expired`"). Why: predictions force you to risk being wrong, which is how you get right.
6. **Test predictions one at a time**, cheapest first (read logs → inspect state in a debugger → add one diagnostic print → bisect). MUST change one variable per experiment and record the result. NEVER run five fixes "and see".
7. **Bisect to localize** if the hypothesis loop stalls (§4.5): git history bisect, input halving, or code halving. Why: bisection finds any deterministic defect in O(log n) steps, including ones no one can reason their way to.
8. **Write the failing test FIRST** at the lowest level possible (unit > integration > manual). Watch it fail for the RIGHT reason. Why: this proves the test detects the bug and prevents regression forever.
9. **Fix the root cause minimally.** MUST NOT smuggle refactors, formatting, or feature changes into the fix commit. Why: reviewable, revertible, bisectable.
10. **Verify completely.** New test passes; FULL suite passes; the original reproduction command now succeeds; run in an environment matching the failure's. Why: fixes fail most often at the seams between tests.
11. **Document and prevent.** Commit/PR description states root cause in one sentence plus the fix rationale; for recurring or high-impact classes add a prevention layer (assertion, type hint, linter rule, CI check, monitoring alert). Why: the same bug class should never need a second post-mortem.

## 4. Deep Knowledge Library

### 4.1 Error Taxonomy (classify FIRST)

| Class | Definition | Signature symptom | First move |
|---|---|---|---|
| Syntax | Code does not parse/compile | Fails before doing any work; caret/parse error | Read the line and the one above it; run linter |
| Runtime | Crashes during execution | Traceback/exception with stack | Stack-trace ritual §4.2 |
| Logic | Runs fine, wrong result | No error; tests/manual checks disagree | Reduce to smallest failing input; assert intermediate values |
| Environment/dependency | Version, path, config, permissions | "Works on my machine"; import/loader errors | Diff environments: versions, env vars, config |
| Data-driven | Only certain inputs fail | Passes on samples, fails in prod | Stratify inputs; find the discriminating record |
| Concurrency | Timing-dependent | Flaky, unreproducible, passes with prints/logging added | Make deterministic: single thread, seeds, then re-add (§9.1) |
| Integration | Boundary between systems | Other service's 4xx/5xx, schema mismatch | curl the other service directly; diff payloads (§4.7) |
| Performance-as-bug | "Slow" reported as "broken" | Latency, timeouts, OOM | Measure first: profile, EXPLAIN, flamegraph |

### 4.2 Stack Trace Ritual

1. **Copy the exact message** (searchable text beats memory) and note the exception type.
2. **Python**: `Traceback (most recent call last):` means the BOTTOM frame is where the error occurred; frames above it are the call chain. **JS/Node**: the TOP of the stack is the error site; lines below are callers.
3. **Own frames first**: skip library/interpreter frames until you reach a frame from the project. The defect is usually in code someone here wrote.
4. **Walk backwards to the birth of the bad value**: ask "where did this `None`/empty string/wrong type come from?" — the answer is one frame up the data-flow, not in the error line.
5. **If the trace has `...`/truncation or "During handling of the above exception"** (Python chaining), read BOTH traces — the first exception is often the true cause.

### 4.3 Toolchain per Environment

**Python**
- `breakpoint()` (Python 3.7+) drops into **pdb**. Command table: `n` next line, `s` step into, `c` continue, `p expr` print, `pp expr` pretty-print, `l` list code, `w` where (stack), `b file:line` breakpoint, `q` quit.
- `python -m pdb script.py` to start under pdb; `python -i script.py` to keep a REPL after a crash; post-mortem: `import pdb; pdb.pm()` right after the traceback.
- `faulthandler.enable()` (or `python -X faulthandler`) prints Python tracebacks on hard crashes/hangs; `faulthandler.dump_traceback_later(30, exit=True)` kills hangs with a traceback.
- `py-spy dump --pid <PID>` — stack of a RUNNING process, no code changes; `py-spy top --pid <PID>` — live hot spots.
- Logging config that earns its keep: timestamps, module, level:
  `logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s %(name)s %(message)s")`

**JavaScript / Node / Browser**
- Node: `node --inspect-brk script.js`, open `chrome://inspect`, or use VS Code's JS debugger. `debugger;` statement = breakpoint in code.
- Browser DevTools: **Console** (errors first, then logs), **Sources** (breakpoints, watch, call stack, scopes), **Network** (status, size, timing, initiator), **Application** (storage/cookies).
- Source maps must load for stacks to point at real source lines; if stacks show minified gibberish, fix source maps before debugging anything else.

**Bash**
- `bash -n script.sh` — syntax check without running.
- `bash -x script.sh` — trace every command; upgrade with `PS4='+ $LINENO: '` for line numbers.
- `shellcheck -x script.sh` — static analysis; fixes the top 20 bash footguns before you debug by hand.
- Insert `set -x` / `set +x` around a suspect region for targeted tracing.

**SQL**
- `EXPLAIN ANALYZE SELECT ...` (PostgreSQL) — real timings, row estimates vs actuals, scan types, sorts. A Seq Scan on a large table with a selective WHERE = missing index. Estimates off by >10× = stale statistics (`ANALYZE table`).
- Enable/inspect the slow query log (`pg_stat_statements`, MySQL `slow_query_log`) to rank what to fix first.

**C/C++**
- gdb: `gdb ./prog`, `run`, `bt` (backtrace), `bt full`, `print var`, `break file:line`, `continue`. On a core dump: `gdb ./prog core` then `bt`.
- `valgrind --leak-check=full --track-origins=yes ./prog` — leaks and uninitialized reads.
- Compile with sanitizers during development: `-fsanitize=address,undefined -g -O1` (AddressSanitizer/UBSan), `-fsanitize=thread` for data races. They convert silent corruption into loud, located errors.

**git bisect** — exact sequence:
```bash
git bisect start
git bisect bad                 # current commit is broken
git bisect good v2.3.0         # last known-good ref
# git checks out midpoint; test, then: git bisect good | git bisect bad
git bisect reset               # when done
```

### 4.4 print vs logging vs debugger + Diagnostic Print Anatomy

| Situation | Tool | Why |
|---|---|---|
| Quick state check, will delete in minutes | print (temporary) | zero setup, zero risk |
| Anything that must survive the session | logging (levels DEBUG/INFO/WARNING/ERROR) | filterable, timestamped, redirectable |
| Need to inspect AND change state mid-run | debugger (pdb/DevTools) | experiment instead of re-run |
| Flaky/timing-sensitive | logging or offline dump (py-spy) | a debugger stops time and destroys the race |
| Production | logs + metrics/traces, NEVER prints | stdout noise, no levels, no context |

Diagnostic print anatomy — a print you cannot grep later is waste. Include name, value, type, and context:
```python
print(f"DEBUG parse_order: order_id={order_id!r} type={type(order_id).__name__} items={len(items) if items else 'EMPTY'} at line {inspect.currentframe().f_lineno}")
```
Rules: prefix with a unique tag (`DEBUG parse_order:`) so you can find and delete every one; use `!r` to expose whitespace/invisible chars; log the LENGTH of collections, not their bodies; remove all of them before merging (search your tag).

### 4.5 Bisection Methods

1. **git bisect (history)** — when it worked before: the sequence in §4.3; automate with `git bisect run ./test_crash.sh` where the script exits 0 on good, 1 (or 125 = skip) on bad. Finds the introducing commit in ~log2(n) steps: 1000 commits ≈ 10 tests.
2. **Input halving (data)** — when only certain inputs fail: cut the input file/dataset in half; test both halves; keep the failing half; repeat. A discriminating record emerges in ~log2(n) steps. Works on logs, JSON, user lists, request payloads.
3. **Code halving (comment-out binary search)** — no VCS state to bisect: disable half the suspect code (stub the functions, skip the module import); if the failure disappears, the cause is in the disabled half, else in the kept half; recurse. NEVER delete — comment/stub so the halves reassemble.
4. **Delta debugging concept (ddmin)** — formalized input halving: minimize the failing input to the smallest subset that still fails; the minimal failing input usually names the cause ("crashes whenever a 2-byte UTF-8 surrogate pair is present").

### 4.6 Bug-Class Playbooks

Quick table (symptom → likely causes in order → checks):

| Bug class | Signature | Likely causes (ordered) | First checks |
|---|---|---|---|
| Off-by-one | Fails at edges only: first/last element, empty | `<=` vs `<`, 0- vs 1-based, `range(n)` vs `range(n+1)`, slice bounds | Print indices at both edges; test len 0/1/2 |
| Null/undefined | `NoneType`/`undefined`/NPE errors | Unhandled missing data path, default not set, optional field assumed present | Find where the value was born; check every assignment |
| Mutation-in-place surprise | Data changed "by itself" elsewhere | Shared mutable default arg, aliasing (list passed and stored), shallow copy of nested structures | `id()` both references; deep-copy at boundaries |
| Async race | Flaky; passes with prints/sleeps | Shared state without lock, check-then-act across awaits, fire-and-forget tasks | Single-thread it (§9.1); log thread/task ids at every read/write |
| Stale cache/state | Old value returns; fixed by restart | Missing invalidation, TTL too long, memo keyed without a changing input | Reproduce the staleness; log cache key + age |
| Encoding (mojibake) | `æ\x9c¬`, `?`, `UnicodeDecodeError` | Wrong codec at a boundary; bytes vs str mixing; BOM; Windows cp1252 | `chardet`/`file -i`; decode/encode round-trip with explicit `encoding="utf-8"` everywhere |
| Timezone/DST | Off-by-hours; happens only some dates | Naive datetimes, server local time, DST transitions, date-only boundaries | Store UTC; compare in one explicit zone (`zoneinfo.ZoneInfo`); test DST days |
| Floating point | `0.30000000000000004`, equality fails | Binary float representation, accumulation error, equality on floats | `math.isclose(a, b, rel_tol=1e-9)`; `decimal.Decimal` for money |
| Path / working directory | File not found only in some contexts | Relative paths + different CWD (cron, service, IDE), case sensitivity, missing `Path.resolve()` | Log `os.getcwd()` and the absolute path at failure |
| Permissions | Works as user, fails as service | Different UID, umask, SELinux/AppArmor, read-only mount | `ls -la`, run as the service user, check mounts |
| CORS | Browser-only fetch failure, works in curl | Missing/incorrect `Access-Control-Allow-Origin`, preflight `OPTIONS` not handled, credentials mode | Read the exact console message; curl -X OPTIONS with `Origin` header |
| Infinite loop / hang | 100% CPU or silent stall | Loop var not updated, recursive call without base case, awaiting something that never resolves | py-spy dump / debugger pause; inspect the loop variable each iteration |
| Memory leak | RSS grows over hours/days | Unbounded caches, event listeners never removed, closures retaining objects, cursors not closed | Trend RSS; snapshot-diff heap (§9.4) |
| Heisenbug | Vanishes when observed | Time dependence, randomness, address/hash-order dependence, race | Determinize (§9.1): freeze time, seed RNG, fix hash seed, single thread |
| Works-on-my-machine | Env-dependent failure | Version drift, env vars, locale/TZ, path separators, line endings | Diff `pip freeze`/`node --version`/env between machines |
| Only-fails-in-prod | Data/config divergence | Real-scale data shape, config differences, permissions, traffic concurrency | Diff config; copy a failing prod input to a staging repro |

Deep dives on the four most slippery classes:

**Async race condition.** Signature: failure probability changes with load or with added logging. Checks: inventory ALL shared state touched by concurrent tasks; verify every cross-task read/write is behind a lock/queue/atomic; check for `await` between check and act ("check-then-act across an await is two operations"). Fix preference: single-writer → queue → lock. NEVER fix by adding `sleep` — that is scheduling luck, not synchronization.

**Only-fails-in-prod.** Produce the diff: config (env vars, feature flags), data (volume, skew, special characters, ancient records), scale (timeout math changes), permissions (service user), clock/timezone (UTC vs local). Then copy one failing prod input (sanitized) into a local repro — most "prod-only" bugs die the moment a real input runs on a laptop.

**Timezone/DST.** Rule: store UTC, convert at the edge, and make every datetime "aware". Checks: is the timestamp naive (`tzinfo is None`)? which zone does the server assume (`date`? `timedatectl`)? does the bug involve 23/25-hour days or month ends? Test with `datetime(2024, 3, 10, 2, 30, tzinfo=ZoneInfo("America/New_York"))` (a time that does not exist in US DST spring-forward).

**Floating point.** NEVER compare floats with `==`; use `math.isclose`. Money: integer cents or `decimal.Decimal`, never float. Accumulations: `math.fsum` for sums; sort by absolute magnitude first when adding wildly different scales.

### 4.7 Network / API Debugging

`curl -v` anatomy — read in this order: `* Trying`/`Connected to` (DNS + TCP + TLS worked?), `>` request lines (method, path, headers you actually sent), `<` response lines (status, headers the server actually returned), then the body. The gap between "headers I thought I sent" and "headers actually sent" explains a huge share of API bugs.

| Code | Meaning | Debug action |
|---|---|---|
| 400 | Request malformed | Print the exact payload sent; validate against the schema |
| 401 | Not authenticated | Check credential header present, fresh, correctly encoded (`Bearer ` prefix) |
| 403 | Authenticated, not allowed | Check scopes/roles/IP allowlist — not the token itself |
| 404 | No such resource/route | Path typo? trailing slash? wrong version prefix? |
| 409 | Conflict with current state | Duplicate create; version/stale-write conflict |
| 422 | Semantically invalid | Field-level errors in body usually name the culprit |
| 429 | Rate limited | Honor `Retry-After`; check quota headers; add backoff |
| 500 | Server-side crash | Server logs own the cause; your payload may still be the trigger |
| 502 | Upstream returned garbage/crashed | Check the upstream service, not this proxy |
| 503 | Overloaded/down | Retry with backoff; check health endpoints |
| 504 | Upstream timed out | Latency problem: find the slow dependency (§4.9) |

Failure mode disambiguation: **connection refused** = nothing listening on that host:port (service down, wrong port); **timeout** = listening but not answering (overload, packet drop, wrong route); **DNS failure (NXDOMAIN)** = name wrong or resolver broken. Each has a different owner — do not debug code when the answer is a DNS entry.

Payload diffing: `diff <(curl -s 'good-url' | jq -S .) <(curl -s 'bad-url' | jq -S .)` — normalized JSON diff beats eyeballing. Retry safety: only retry idempotent operations, or attach an `Idempotency-Key`; retrying a non-idempotent POST can double-charge.

### 4.8 Frontend Debugging

- Console API beyond `log`: `console.table(rows)` (array of objects as a table), `console.dir(obj)` (object properties instead of DOM tree), `console.time("x")/timeEnd("x")` (cheap timing), `console.trace()` (who called this), `console.assert(cond, msg)` (conditional noise).
- Conditional breakpoints: right-click a line breakpoint → edit condition (`items.length > 100`) — stops only for the failing case. **Logpoints** print without stopping — essential for races.
- Sources panel workflow: set breakpoint → interact → inspect Scope (local/closure), Watch expressions, Call Stack (click frames to jump).
- Network tab: filter to Fetch/XHR; check status (failed/CORS show here), size (0 bytes = blocked), timing (TTFB vs download), initiator (which code made the call).
- React DevTools: inspect live props/state per component, see re-render reasons in Profiler; a component re-rendering on every keystroke usually means unstable identities (inline objects/functions) in props.

### 4.9 Database Debugging

- Read `EXPLAIN (ANALYZE, BUFFERS)` in this order: scan type (Seq on big table = missing index), join type (nested loop over large sets = missing index), `rows` estimate vs actual (off by >10× = stale stats), sort/spill to disk (`external merge` = work_mem).
- Missing-index symptom: latency grows with table size; query plan shows Seq Scan + Filter on a selective column. Verify with the index catalog (`\d table` in psql, `SHOW INDEX FROM t` in MySQL) before creating one.
- N+1 detection: enable query logging and count statements per page/request; ORMs hide loops of queries — fix with JOIN, `selectinload`/`prefetch_related`, or batched `IN` queries.
- Lock waits: `SELECT * FROM pg_locks WHERE NOT granted;` plus `pg_stat_activity` to find the blocking PID; long-open transactions hold locks — check for transaction-per-request leaks and idle-in-transaction sessions.

### 4.10 Error Message Dictionary

| Message (fragment) | What it really means | First action |
|---|---|---|
| `Segmentation fault (core dumped)` | Native code touched invalid memory | Rebuild with `-g -fsanitize=address`; run under gdb, `bt` on crash |
| `undefined is not a function` / `x is not a function` | Called something that isn't callable (typo, wrong import shape) | Log the object's actual shape: `console.dir(x)` |
| `Cannot read properties of undefined (reading 'x')` | Navigated into undefined before reading `.x` | Find the earliest access chain step that is undefined |
| `ModuleNotFoundError: No module named 'X'` | Wrong interpreter/env, or package not installed | `which python` vs venv; `pip list | grep X` |
| `ERR_MODULE_NOT_FOUND` (Node) | Import path/extension wrong for module system (ESM vs CJS) | Check `package.json` `type`, add `./` and `.js` for ESM relative imports |
| `ImportError: cannot import name 'Y' from 'X'` | Version drift: symbol doesn't exist in installed version | Compare installed vs expected versions; pin properly |
| `ConnectionRefusedError` / `ECONNREFUSED` | Nothing listening on host:port | Is the service up? correct port/host? docker network? |
| `EADDRINUSE` / `Address already in use` | Port already bound by another (possibly zombie) process | `lsof -i :PORT` or `ss -ltnp`; kill the stale process |
| `EPIPE` / `Broken pipe` | Wrote to a closed socket/pipe (peer gone) | Handle/ignore SIGPIPE; check consumer liveness |
| `ETIMEDOUT` / `ReadTimeout` | Peer accepted but never answered | Check upstream health/latency; add explicit timeout + retry policy |
| `JSONDecodeError: Expecting value` | Body isn't JSON: empty, HTML error page, wrong content-type | Print the RAW body before parsing |
| `KeyError: 'k'` | Dict missing expected key | Log `data.keys()`; decide default vs error at the boundary |
| `IndexError: list index out of range` | Index ≥ len (often empty list or off-by-one) | Print `len()` at access site; check loop bounds |
| `'NoneType' object is not subscriptable` / `has no attribute` | A function returned None and you used it | Find the function; why did it return None (early return path?) |
| `RecursionError: maximum recursion depth exceeded` | Missing/wrong base case, or cyclic data | Print depth+args at entry; convert to iteration |
| `ValueError: could not convert string to float` | Data isn't in the assumed format | Print the raw value with `!r` — whitespace/commas/units |
| `PermissionError: [Errno 13]` | OS denied access (user/mode/path) | `ls -la` the path; run as the failing user |
| `FileNotFoundError: [Errno 2]` | Path wrong or CWD different | Log absolute path + `os.getcwd()` |
| CORS error (browser console) | Server response lacks correct `Access-Control-Allow-*` | curl -X OPTIONS with `Origin` + `Access-Control-Request-Method` |
| `502 Bad Gateway` | Proxy's upstream crashed/returned invalid response | Investigate upstream, not the proxy |
| `504 Gateway Timeout` | Upstream too slow | Profile upstream latency; raise/fix timeouts |
| `OutOfMemoryError` / `heap out of memory` | Live set exceeds limit (leak or genuinely large) | Heap snapshot diff; check for unbounded caches |
| `ssl.SSLCertVerificationError` / `SELF_SIGNED_CERT_IN_CHAIN` | Chain/trust store problem, or TLS-intercepting proxy | NEVER disable verification as the fix; fix CA bundle (`certifi.where()`) |
| `git merge conflict` markers in output (`<<<<<<<`) | Unresolved conflict committed | Search repo for `<<<<<<< HEAD` and resolve properly |

## 5. Code & Tool Templates

### 5.1 Python diagnostic logging setup (drop-in)

```python
# debugkit.py — import and call setup() at program start
import logging, sys

def setup(level: int = logging.DEBUG) -> logging.Logger:
    logging.basicConfig(
        level=level,
        stream=sys.stderr,
        format="%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d | %(message)s",
        datefmt="%H:%M:%S",
    )
    return logging.getLogger("app")

def trace(fn):
    """Decorator: logs entry, exit, and exceptions of a suspect function."""
    log = logging.getLogger(fn.__module__)
    import functools
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        log.debug("-> %s args=%r kwargs=%r", fn.__name__, args, kwargs)
        try:
            result = fn(*args, **kwargs)
        except Exception:
            log.exception("!! %s crashed", fn.__name__)
            raise
        log.debug("<- %s returned=%r", fn.__name__, result)
        return result
    return wrapper
```

### 5.2 pdb session pattern (annotated)

```python
# Reproduce under the debugger:
#   python -m pdb process_orders.py --input failing.json
# Inside pdb:
#   b process_orders.py:42   <- set breakpoint at suspect line
#   c                        <- run to it
#   p order_id, type(order_id)   <- inspect live values
#   pp items[:3]             <- pretty-print structure
#   w                        <- where: full call stack
#   u / d                    <- up/down frames to find where the bad value was born
#   n / s / c / q            <- next / step-into / continue / quit
# Post-mortem after any crash in a REPL: import pdb; pdb.pm()
```

### 5.3 Failing-test-first regression template (pytest)

```python
# test_regression_issue_412.py — write BEFORE the fix; watch it fail for the right reason.
import json
from orders import parse_order          # module under repair

def test_order_with_missing_currency_defaults_to_usd():
    # Minimal input that triggered the prod bug: 'currency' key absent.
    raw = json.loads('{"id": "A1", "total": 1999}')
    order = parse_order(raw)
    assert order.currency == "USD"       # currently raises KeyError -> test RED
    assert order.total == 1999

def test_order_currency_none_is_rejected():
    raw = {"id": "A2", "total": 100, "currency": None}
    try:
        parse_order(raw)
    except ValueError as e:
        assert "currency" in str(e)      # explicit, typed rejection path
    else:
        raise AssertionError("None currency must be rejected, not defaulted")
```

### 5.4 git bisect automation script

```bash
#!/usr/bin/env bash
# bisect_test.sh — exit 0 = good, 1 = bad, 125 = cannot test (skip commit)
set -uo pipefail
python -m venv .bisect-venv >/dev/null 2>&1 || exit 125
# shellcheck disable=SC1091
source .bisect-venv/bin/activate
pip install -q -r requirements.txt >/dev/null 2>&1 || exit 125
if python -m pytest tests/test_repro_412.py -q >/dev/null 2>&1; then
  exit 0    # test passes => commit is GOOD
else
  exit 1    # test fails  => commit is BAD
fi
# Usage:  git bisect start HEAD v2.3.0 && git bisect run ./bisect_test.sh && git bisect reset
```

### 5.5 curl diagnostic pack

```bash
# 1) Full timeline: DNS, TCP, TLS, request headers sent, response headers received
curl -sv 'https://api.example.com/v1/orders?limit=5' -o /dev/null 2>&1 | sed -n '/> /p;/< /p'

# 2) Reproduce CORS preflight exactly as the browser does
curl -s -i -X OPTIONS 'https://api.example.com/v1/orders' \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization'

# 3) Timing breakdown (name the slow phase: DNS vs connect vs TTFB vs download)
curl -s -o /dev/null -w 'dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} http=%{http_code}\n' \
  'https://api.example.com/v1/orders'

# 4) Normalized payload diff between two environments
diff <(curl -s 'https://staging.example.com/api/user/42' | jq -S .) \
     <(curl -s 'https://api.example.com/api/user/42' | jq -S .)
```

### 5.6 Process-level probes

```bash
# Stack of a HUNG python process without touching its code:
py-spy dump --pid 12345
# Live CPU hot spots:
py-spy top --pid 12345
# Traceback on hang/kill after 30s (add at program start):
#   import faulthandler; faulthandler.dump_traceback_later(30, exit=True)
# Memory trend (sample RSS every 5s):
while true; do ps -o rss= -p 12345 | tr -d ' '; sleep 5; done | tee rss_trend.log
```

## 6. Decision Tables

**Table 1 — Observation tool chooser:**

| Need | Tool | Reason |
|---|---|---|
| See a value right now, will delete in minutes | diagnostic print | zero setup |
| Persistent, filterable history | logging with levels/timestamps | greppable, levelable |
| Inspect AND modify live state | debugger (pdb/DevTools) | experiments beat re-runs |
| Hang or crash in prod, no code changes allowed | py-spy dump / faulthandler / core dump | observation without deployment |
| "When did it break?" | git bisect | log2(n) history search |
| "Which input fails?" | input halving / ddmin | log2(n) data search |

**Table 2 — Error class → first tool:**

| Class | First tool | Second tool |
|---|---|---|
| Syntax | linter / `bash -n` | compile output line |
| Runtime exception | stack-trace ritual + debugger | tracebacks with `faulthandler` |
| Logic (wrong result) | reduce input + assert intermediates | property check vs reference impl |
| Environment | version/env diff (`pip freeze`, `node -v`, env) | clean-container repro |
| Data-driven | stratify inputs, input halving | minimal failing record (ddmin) |
| Concurrency | single-thread determinization | thread-id logging, TSan |
| Integration | `curl -v` the peer directly | payload diff (jq -S) |
| Performance | profiler / EXPLAIN ANALYZE | flamegraph, slow query log |

**Table 3 — Bisection method chooser:**

| Situation | Method |
|---|---|
| Worked at some past commit | `git bisect run ./bisect_test.sh` |
| Fails only on some inputs | input halving → minimal failing input |
| No VCS anchor, suspect a region | code halving (stub half, recurse) |
| Flaky under load | determinize first (§9.1), THEN bisect |

**Table 4 — Fix acceptance gate:**

| Question | Pass condition |
|---|---|
| Does a test fail before the fix? | Yes, and it fails for the diagnosed reason |
| Does the minimal fix make it pass? | Yes, root-cause change only |
| Full suite green? | Yes — run it, all of it |
| Does the original repro succeed? | Yes, in the failing environment |
| Root cause stated in one sentence? | Yes, in the commit/PR |

## 7. Quality Checklist

- [ ] Failure reproduced on demand with an exact command, input, and environment
- [ ] Exact error text + full stack trace copied into notes BEFORE any change
- [ ] Bug classified into one of the 8 taxonomy classes
- [ ] Stack trace read fully; own frames identified; data-flow walked backwards to the bad value's birth
- [ ] Hypothesis log kept: ≥2 hypotheses, each with prediction and test result
- [ ] Only ONE variable changed between runs; results recorded
- [ ] Search space halved systematically (bisect) when not localized within the time-box
- [ ] Root cause identified and stated in one plain sentence
- [ ] Failing test written BEFORE the fix and watched to fail for the right reason
- [ ] Minimal root-cause fix applied; no unrelated changes smuggled in
- [ ] FULL test suite run and green after the fix
- [ ] Original reproduction command verified to succeed in the failing environment
- [ ] No symptom-hiding constructs added (no catch-all except, no sleep, no silenced assert)
- [ ] Evidence (input, logs, versions) preserved/archived for the report
- [ ] Prevention layer added for recurring classes (assertion, type hint, linter, CI, alert)
- [ ] Temporary debug prints/logging removed (search for the debug tag)

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Reading only the error line | Wrong fix; bug returns | Full stack trace ritual (§4.2); find where the bad value was born |
| 2 | Silencing symptoms (`except: pass`, sleep, restart) | Bug multiplies and returns at 3 a.m. | Root-cause fix + regression test, ALWAYS |
| 3 | Changing five things between runs | "It works" but nobody knows why | One change per run; record each result |
| 4 | Declaring "fixed" without a failing test | Regression ships silently | Failing test FIRST, watch red, fix, watch green, full suite |
| 5 | Guessing instead of reproducing | Hours of theory, zero progress | Reproduce on demand first; unreproducible = not yet understood |
| 6 | Debugging without version numbers | Chasing bugs already fixed (or introduced) upstream | Capture `python --version`, commit SHA, dependency list first |
| 7 | Leaving debug prints in the merge | Log spam; secrets in logs | Unique `DEBUG tag:` prefix; grep-and-delete before merging |
| 8 | "Fixed by clearing the cache" | Cause untouched; returns next week | Explain WHY the cache went stale; fix invalidation |
| 9 | Editing the wrong file / stale process | Changes have no effect; confusion spiral | Verify with an intentional marker change; confirm reload actually happens |
| 10 | Assuming prod == dev | Fix works locally, fails in prod | Diff config/data/permissions/scale (§4.6 only-fails-in-prod playbook) |
| 11 | Fixating on the first hypothesis (confirmation bias) | Sunk hour, tunnel vision | Actively seek disconfirming evidence; log ≥2 hypotheses and test the OTHER one |
| 12 | Ignoring the SECOND error after fixing the first | Cascade masked the real failure | Re-run and read fresh logs top to bottom after every fix |
| 13 | Debugging code when DNS/infra is the cause | Hours wasted on correct code | Check the layer below: DNS, TCP, TLS, permissions (curl -v timeline) |
| 14 | Trusting a green test suite that doesn't run the new test | False confidence | Run the specific test with `-k`/`-v` and see its name pass |

## 9. Advanced Techniques

### 9.1 Determinizing Heisenbugs

Make the system boring until the bug is caught, in this order: (1) single-thread the reproduction (set worker count to 1; races often vanish — then re-add concurrency with logging of thread/task ids at every shared read/write); (2) freeze time (`freezegun.freeze_time("2024-03-10T02:30:00-05:00")` in tests, or inject a fake clock); (3) seed ALL randomness (`random.seed(42)`, `numpy.random.seed(42)`, `PYTHONHASHSEED=0` to pin dict/set iteration order across runs); (4) record inputs (capture the exact payload/bytes to a file and replay); (5) fix hash-order dependence by sorting before iterating. A bug that reproduces 100% of the time is now bisectable — apply §4.5.

### 9.2 Time-Travel and Post-Mortem Tooling

- **rr (record & replay)**: `rr record ./prog` then `rr replay` — reverse-continue (`rc`), reverse-watchpoints; the answer to "how did this pointer become NULL".
- **Core dumps**: `ulimit -c unlimited`, reproduce, then `gdb ./prog core` + `bt full`; set `/proc/sys/kernel/core_pattern` to control dump location.
- **Python post-mortem**: run under `python -m pdb script.py`, and on crash use `pdb.pm()`; or wrap entry points with `sys.excepthook = lambda *a: pdb.post_mortem(a[2])` for interactive prod-like triage.
- **memray** (`memray run script.py` + `memray flamegraph`) and `tracemalloc`: allocation timelines for leaks.

### 9.3 Sanitizer Arsenal (C/C++/Rust-FFI)

Compile dev builds with `-fsanitize=address,undefined -g -O1` (ASan + UBSan) to catch use-after-free, buffer overflows, and signed overflow at the exact line, with stacks. Add `-fsanitize=thread` (TSan) for data-race detection — run the concurrent test suite under it. Memory budget: ASan uses ~2–3× memory; that is the price of turning silent corruption into a located, named error. Rust FFI boundaries: run the C side under ASan even when the Rust side is safe.

### 9.4 Memory-Leak Hunting

(1) Confirm with a trend, not a hunch: sample RSS over hours (`ps -o rss= -p PID`) — a leak is a persistent slope, not a bump. (2) Python: `tracemalloc.take_snapshot()` at T0 and T1, `snapshot1.compare_to(snapshot2, "lineno")` — top growing lines named precisely. (3) `objgraph.growth()` for object-type growth; `objgraph.show_backrefs([suspect])` to find who retains it. (4) Browser/Node: heap snapshots in DevTools, compare two snapshots after repeating the suspected action 3×. (5) Usual suspects: unbounded `lru_cache(maxsize=None)`, global registries, listeners/callbacks never removed, session/context objects closed on the happy path only.

### 9.5 Delta Debugging, Formalized

ddmin guarantees a 1-minimal failing subset: repeatedly split the input into chunks (start with 2, then 4, 8…), test each reduction, keep any that still fails, restart splitting on the reduced input. ~n log n tests worst case. Practical shortcut: the failure usually keys on ONE structural element (a field, a length, a byte sequence) — grep the minimized input for the unusual element first; the minimal input will contain it and little else.

### 9.6 Hypothesis Log & Post-Mortem Templates

Hypothesis log (keep beside you during the hunt):

```markdown
| # | Hypothesis | Prediction if true | Test | Result |
|---|---|---|---|---|
| 1 | Auth token expired after 24h | Response header X-Auth-Error: token_expired | curl -v with old token | CONFIRMED |
| 2 | Clock skew on worker 3 | worker3 timestamps 90s ahead of LB | compare logs | rejected |
```

Post-mortem (blameless, within 48h of a significant incident):

```markdown
## Post-mortem: checkout 500s under Black-Friday load
**Impact**: 18 minutes degraded, ~4,300 failed checkouts, ~$62k GMV at risk.
**Timeline**: 09:14 deploy #8821 → 09:31 first alert → 09:37 rollback → 09:49 recovered.
**Root cause**: Deploy added a per-request DB call inside a loop (N+1), tripling
checkout query volume; connection pool (size 20) exhausted.
**Why it wasn't caught**: no load test in CI; pool-exhaustion alert threshold set at 95% for 15m (too slow).
**Fix**: batched lookup query (PR #8829); pool alert now 80% for 1m.
**Prevention**: k6 load test with prod-shaped payload in CI; N+1 detection query-count budget per request.
```

## 10. Quick Reference Card

- **Loop**: reproduce → capture evidence → classify → hypothesize (log it) → predict → test ONE variable → bisect if stuck → failing test first → minimal fix → full suite → explain root cause.
- **Stack traces**: Python bottom frame = error site; JS top frame = error site; own frames first; cause is deeper than the error line.
- **pdb**: `b file:line`, `c`, `n`, `s`, `p expr`, `pp expr`, `w`, `u`/`d`, `q`; post-mortem `pdb.pm()`.
- **Bash**: `bash -n` (syntax), `bash -x` (trace), `PS4='+ $LINENO: '`, `shellcheck -x`.
- **Bisect**: `git bisect start HEAD <last-good>` → `git bisect run ./test.sh` → `git bisect reset`; input halving for data bugs; code halving when no VCS anchor.
- **curl -v order**: connect lines (`*`) → request (`>`) → response (`<`) → body. refused = nothing listening; timeout = listening, not answering; NXDOMAIN = DNS.
- **Status trio**: 401 no identity, 403 no permission, 404 no resource; 502 upstream broke, 504 upstream slow.
- **Diagnostic print**: `print(f"DEBUG <tag>: x={x!r} type={type(x).__name__} n={len(x) if x else 0}")` — tag it, then delete every one.
- **Floats**: never `==` — `math.isclose(a, b, rel_tol=1e-9)`; money = `Decimal`/integer cents.
- **Time**: store UTC, `zoneinfo.ZoneInfo` at edges, test DST spring-forward days explicitly.
- **Determinism kit**: seed RNG, `PYTHONHASHSEED=0`, freeze clock, single thread, recorded input.
- **Never**: bare `except: pass`, sleep-as-synchronization, debugger in prod code paths, experimenting on prod data, declaring victory without a test.


