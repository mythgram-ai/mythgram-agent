---
name: coder
description: >
  Professional, language-agnostic software-craft skill for writing new code
  that is correct, tested, and maintainable on the first serious attempt.
  Covers requirement analysis and assumption surfacing, plan-before-typing
  with pseudocode and skeletons, incremental implementation with early
  execution, clean-code standards, data-structure and algorithm selection
  with Big-O reasoning, robust error handling, pytest testing discipline,
  language cheat cards for Python, JavaScript, TypeScript, Bash and SQL,
  design patterns, REST and CLI design, performance profiling, security
  fundamentals, refactoring, concurrency basics, and git discipline.
  Use this whenever the user says "write a function", "implement this",
  "build a script", "code this up", "add a feature", "create a module",
  "make a CLI", "write a class", "automate this task", "translate this
  pseudocode", "add validation", "write tests for new code", "which language
  should I use", "design an API endpoint", "make it faster", or any request
  whose deliverable is new source code in any mainstream language. Also use
  for green-field projects and for adding a well-scoped capability to an
  existing codebase.
  Do NOT use for diagnosing code that already exists but misbehaves — that
  is debugger's job. Do NOT use for reviewing, grading, or approving
  existing code or pull requests — that is code-reviewer's job. Do NOT use
  for building a complete website, mobile app, or game — those are
  website-creator, mobile-app-creator, and game-creator's jobs. Do NOT use
  for analyzing datasets or producing analytical reports — that is
  information-analyst's job.
---

# Coder

> Ship correct, tested, maintainable code on the first serious attempt — plan before typing, run early, review your own work.

## 0. Operating Rules (Non-Negotiable)

1. **MUST restate the requirement and list assumptions before writing any code.** Silent assumptions are the top cause of perfectly-built wrong things. If an assumption would change the design, surface it in your first message.
2. **MUST produce a plan (pseudocode, outline, or typed skeleton) before implementing anything non-trivial** — anything over ~50 lines, multiple functions, or multiple files. Code typed without a plan gets rewritten; a plan costs minutes.
3. **NEVER write more than ~100 lines without executing something.** Run the script, a test, or a REPL check at least that often; the error surface grows super-linearly with batch size.
4. **MUST handle failures at every boundary** (user input, files, network, subprocess, database) and **NEVER use a bare `except:` or `except Exception: pass`.** Swallowed errors convert small loud failures into silent data corruption.
5. **NEVER hardcode secrets, tokens, passwords, or environment-specific values in code.** Read them from environment variables or a secret manager; committed secrets live forever in git history.
6. **MUST validate every external input and treat it as hostile** — users, files, network payloads, CLI args. Allowlists beat blocklists.
7. **MUST use searchable, pronounceable names** (`elapsed_seconds`, not `es`). Future-you and teammates will grep these names; single letters beyond loop counters fail that test.
8. **MUST keep functions single-responsibility and short (guideline: ≤30 lines, ≤4 parameters).** Long functions hide bugs, resist testing, and force readers to simulate state in their heads.
9. **MUST test the edges, not just the happy path:** empty, one element, many, huge, unicode, negative, zero, boundary values, invalid input, and (when relevant) concurrent access.
10. **MUST prefer the standard library over a new dependency, and a proven library over hand-rolled code.** Every dependency adds security, license, and upgrade liability.
11. **MUST make atomic commits with conventional messages** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`), each passing tests alone, so history stays reviewable and bisectable.
12. **MUST self-review the complete diff against §7 before delivering.** You are the first reviewer; catching your own defect costs seconds, letting it escape costs trust.

## 1. When to Use / When Not To

**Use this skill when:**
- The deliverable is new source code: a function, module, class, script, endpoint, migration, or test suite.
- The user asks which language, library, or structure to use for a new build.
- The user provides pseudocode, a spec, or a ticket that must become working code.
- A codebase needs a new, well-scoped capability added end to end (code + tests + docs).

**Do NOT use when:**
- Existing code fails, throws, hangs, or returns wrong values — that is **debugger**'s job.
- The user wants critique, grading, or approval of code already written — that is **code-reviewer**'s job.
- The deliverable is a full website, mobile app, or game — those are **website-creator**, **mobile-app-creator**, and **game-creator**'s jobs.
- The task is analyzing datasets or writing analytical reports — that is **information-analyst**'s job.

| Signal in the request | Route to | Reason |
|---|---|---|
| "Write / implement / build X" (new code) | **coder** | authoring from scratch |
| "It crashes / hangs / returns the wrong value" | **debugger** | fault-finding in existing code |
| "Review my PR / is this code good?" | **code-reviewer** | evaluation, not authoring |
| "Build me a website / landing page" | **website-creator** | platform-specific full build |
| "Build an iOS/Android app" | **mobile-app-creator** | platform-specific full build |
| "Make me a game" | **game-creator** | platform-specific full build |
| "Analyze this CSV / dataset and report" | **information-analyst** | analysis, not a code deliverable |

## 2. Core Concepts & Mental Models

- **Code is communication first, instruction second.** Source is read ~10× more often than it is written; optimize for the reader and the machine will follow.
- **Make it work → make it right → make it fast, in that order.** Optimizing wrong code is waste; "right" means tested and clear.
- **Fast feedback is the engine.** Strong engineers are not faster typists; they shorten the write→run→observe loop to seconds or minutes.
- **Data structures before algorithms.** Choose the structure (hash map, heap, tree) and the algorithm usually writes itself; the wrong structure forces O(n²) heroics.
- **Complexity budget.** Every abstraction, layer, and dependency costs comprehension. Buy complexity only when it pays: ≥3 real usages, or isolation of genuinely volatile logic (KISS, YAGNI).
- **Correct → clear → fast.** Clever-but-wrong and clever-but-unclear are both defects.
- **Fail fast, fail loud.** Crash at startup on bad config rather than limping into undefined behavior at 2 a.m.
- **Boring technology wins.** Proven tools with known failure modes beat exciting tools with unknown ones, unless a hard requirement demands otherwise.
- **Every boundary is hostile.** Anything crossing a trust boundary (user, network, file) gets validated; everything inside may assume validated data.
- **Definition of Done includes tests, docs, and self-review** — never "it compiles".

## 3. Mandatory Workflow

1. **Understand the requirement.** Restate it in one sentence; identify inputs, outputs, edge cases, target language/version, OS, and performance constraints. MUST identify at minimum: what data comes in, what goes out, and what must happen on invalid input. NEVER start on a vague spec without stating what you will assume. Why: misunderstanding is the most expensive defect class — everything downstream is waste.
2. **State assumptions explicitly.** List 3–7 assumptions (data shape and scale, error semantics, single-user vs concurrent, deployment target). MUST flag any assumption that would change the design if wrong, and ask when asking is cheap. Why: this converts invisible disagreement into one correctable sentence.
3. **Plan before typing.** Write pseudocode or a skeleton (signatures, types, docstrings, no bodies). MUST choose data structures, error-handling strategy, and the test plan at this stage. NEVER skip planning for multi-file or >50-line work. Why: planning is where design wins are cheap and mistakes are free.
4. **Implement incrementally.** Create the skeleton with stubs, then implement one stub at a time. MUST execute something (test, script, REPL) at least every ~100 new lines, and MUST NOT ship stub bodies (`pass`, `...`) — fill every one in this step. Why: a bug found 10 lines from its cause costs minutes; 500 lines away, hours.
5. **Test the edges.** Happy path first to prove the wiring; then the edge catalog from rule 9, using `parametrize` where cases are data-driven. MUST actually run the tests and report results. NEVER claim "it should work".
6. **Self-review.** Read the full diff as a hostile stranger: correctness, naming, error paths, security, tests. MUST verify every item in §7. Why: the cheapest bug fix you will ever perform is the one you catch yourself.
7. **Document.** Every public function gets a docstring (purpose, args, returns, raises) plus one runnable usage example; add a README section for anything with setup steps. NEVER document the obvious "what" — document the why and the contract.
8. **Deliver with evidence.** Provide run commands and key output (test summary, example invocation). NEVER deliver without the command that proves it works. Why: evidence transfers confidence; assertions do not.

## 4. Deep Knowledge Library

### 4.1 Choosing the Language

Default to the language the surrounding project already uses — NEVER introduce a new language into an existing repo without a hard technical reason and the user's agreement. For green-field choices:

| Language | Sweet spot | Pick when | Avoid when |
|---|---|---|---|
| Python | Scripting, APIs, data, automation, glue | Dev speed, library ecosystem, and readability matter | Sub-millisecond latency, mobile apps, heavy parallel CPU (GIL) |
| JavaScript | Browser, Node services, tooling | The browser is the target or the team is JS-first | CPU-bound computation, numeric/SciPy-style work |
| TypeScript | Any JS project above toy size | More than one contributor or >1k lines | Throwaway one-off scripts (setup overhead) |
| Go | Network services, CLIs, workers | Single static binary, superb concurrency, fast cold starts | Heavy generics/abstraction needs, GUI toolkits |
| Rust | Systems, performance- and safety-critical | Memory safety without GC, predictable latency | Rapid prototyping, small scripts (compile-time cost) |
| Java | Enterprise backends, Android, big-team systems | JVM ecosystem, decades of libraries, large teams | Small scripts, quick iteration loops |
| C++ | Games, engines, HFT, embedded-adjacent | Ultimate control and performance | Anywhere GC pauses are acceptable |
| SQL | Set-based querying, aggregation, reporting | The question is "which rows / what aggregate" | Row-by-row procedural logic (move to app code) |
| Bash | Glue: files, processes, cron jobs | Orchestration ≤~100 lines chaining CLIs | Real data structures, complex error logic, >200 lines |

### 4.2 Clean Code Standards

| Entity | Rule | Bad | Good |
|---|---|---|---|
| Variable | Name carries unit and intent | `t`, `data2` | `elapsed_seconds`, `retry_count` |
| Function | Verb + object | `process()` | `extract_invoice_fields()` |
| Boolean | `is_/has_/can_` prefix | `flag`, `status` | `is_valid`, `has_dependencies` |
| Class | Specific noun, no grab-bags | `DataManager` | `InvoiceRepository` |
| Constant | SCREAMING_CASE, defined once | magic `86400` inline | `SECONDS_PER_DAY = 86_400` |

Function rules: single responsibility; guard clauses with early return instead of nested `if` pyramids; guideline ≤~30 lines and ≤4 parameters (bundle related params into a dataclass/object); NEVER use boolean flag parameters that switch behavior (`render(html=True)` → two functions); one level of abstraction per function; return values instead of output arguments.

DRY vs premature abstraction: duplication is cheaper than the WRONG abstraction. Tolerate two copies; extract on the third, and only when the copies change for the same reason.

SOLID in one line each: **S**ingle responsibility — one reason to change per module; **O**pen/closed — extend by adding code, not by editing working code; **L**iskov — subtypes must be substitutable without surprises; **I**nterface segregation — several small interfaces beat one god-interface; **D**ependency inversion — depend on abstractions (inject dependencies), not concrete implementations.

Comments explain WHY — constraints, issue links, rationale, non-obvious trade-offs — never narrate WHAT. Delete commented-out code; git remembers it better than the file does.

### 4.3 Data Structures & Algorithms

Big-O quick table (n = element count):

| Structure | Access | Search | Insert | Delete | Notes |
|---|---|---|---|---|---|
| Array / list | O(1) | O(n) | O(1) amortized at end | O(n) | Slices copy in Python; index math is your friend |
| Hash map / dict | — | O(1) avg, O(n) worst | O(1) avg | O(1) avg | Keys must be hashable; no ordering |
| Set | — | O(1) avg | O(1) avg | O(1) avg | Membership tests and dedupe |
| Balanced tree | O(log n) | O(log n) | O(log n) | O(log n) | Ordered iteration and range queries |
| Heap | — | O(1) peek min | O(log n) | O(log n) pop | Top-k, schedulers, priority queues |
| Stack / queue | — | O(1) at ends | O(1) | O(1) | LIFO vs FIFO; `collections.deque` for queues |
| Graph | — | O(V+E) traversal | — | — | BFS = shortest unweighted path; DFS = reachability |

Selection matrix:

| Need | Use | Watch out |
|---|---|---|
| Fast lookup by key | hash map | unhashable keys; worst-case O(n) |
| Deduplicate / membership | set | unordered; duplicates vanish by design |
| Top-k / priority scheduling | heap (`heapq`) | min-only (negate values for max); not fully sorted |
| Ordered storage + range scans | sorted structure / SQL index | insert cost O(log n) or O(n) |
| Sliding window / recent items | `deque` | random access is O(n) |
| Relationships and traversal | adjacency dict of sets | cycles → carry a `visited` set, ALWAYS |

Classic patterns, one breath each:
- **Two pointers** — sorted-array pair/target problems: move ends inward by comparison; O(n) replaces O(n²).
- **Sliding window** — longest/shortest/max contiguous subarray: extend the right edge, shrink the left while the constraint is violated; O(n).
- **Binary search on the answer** — "minimize the maximum": binary-search the answer space with a feasibility check per probe; O(log(range) × check).
- **BFS/DFS** — BFS for shortest unweighted path and level order; DFS for reachability, topological sort, backtracking. ALWAYS carry a visited set.
- **Dynamic programming** — overlapping subproblems + optimal substructure: define the state, the recurrence, the base case, and the evaluation order (memoized top-down or bottom-up table).
- **Greedy** — only with a proof sketch (exchange argument): swapping any optimal choice for the greedy one never hurts. Interval scheduling, Huffman.
- **Custom sort keys** — sort by tuples (`key=lambda r: (r.deadline, -r.priority)`); sorts are stable, so sort by secondary key first, primary second.

Python recursion depth defaults to ~1000 frames — convert deep recursion to iteration; NEVER raise `sys.setrecursionlimit` without proving inputs stay bounded.

### 4.4 Error Handling

Decision order: (1) prevent — validate at the boundary; (2) recover — retry transient failures, fall back gracefully; (3) fail loudly with context. Swallowing is FORBIDDEN because it converts loud, debuggable failures into silent corruption.

- **Exceptions for exceptional; results for expected outcomes.** Python: exceptions for contract violations and I/O problems. Go/Rust: return `error`/`Result` for expected domain outcomes; reserve panics for programmer error.
- **Validate at boundaries, trust inside.** Parse user/file/network input once, eagerly, with clear messages; internal functions may then assert invariants cheaply.
- **Custom exception hierarchies per module**: `class AppError(Exception)`, then `ValidationError(AppError)`, `NotFoundError(AppError)`, `ExternalServiceError(AppError)`. Callers catch the base; logs and metrics classify by type.
- **Cleanup MUST use language constructs**: Python `with` / `try..finally`, Go `defer`, Rust/C++ RAII. Manual `.close()` calls WILL be skipped on the error path — that is not a warning, it is statistics.
- **Catch narrow, log once, re-raise with context** (`raise NewError(...) from e` in Python). NEVER log-and-swallow at multiple layers — layered swallowing is how real causes vanish from every log.
- **Fail fast on configuration**: validate env vars and settings at startup, not on the first request at 3 a.m.

### 4.5 Testing Discipline

- Structure every test **AAA**: Arrange (fixtures/data), Act (one call), Assert (specific expectation). One behavior per test; the name is the sentence: `test_checkout_with_empty_cart_raises_empty_cart_error`.
- pytest essentials: `@pytest.fixture` for setup (function-scoped by default), `@pytest.mark.parametrize("inp,expected", [...])` for data-driven cases, `tmp_path` for files, `capsys` for stdout assertions, `monkeypatch.setenv`/`monkeypatch.setattr` for env and attribute stubs, `pytest.approx` for floats, `pytest.raises(ValueError, match="negative")` for errors.
- Edge catalog to consider for EVERY function: empty input; single element; many; huge (1e6+); unicode/emoji; negative and zero; boundary values (0, 1, MAX, MAX+1); malformed input; duplicates; concurrent access.
- Mock ONLY external and slow things: HTTP clients, the clock (`freezegun` or an injected `clock` callable), randomness (seed it), the filesystem in unit tests. NEVER mock the code under test.
- TDD (red → green → refactor) when the spec is crisp: the failing test proves the intended API before the implementation exists.
- Aim for meaningful branch and error-path coverage (rough target ≥80% on core logic); chasing 100% line coverage yields worthless assertions.
- Quarantine and fix flaky tests the same day — a red build nobody trusts is worse than no build.

### 4.6 Language Cheat Cards

**Python**
- Comprehensions for transforms: `{u.id: u for u in users}`; NEVER hide side effects inside them.
- `@dataclass(frozen=True)` for value objects; `pathlib.Path` over string paths; f-strings, including the debug form `f"{value=!r}"`; `with` for every resource; `enumerate(seq, start=1)` over manual counters; `dict.get(key, default)` when absence is normal.
- Entry-point guard `if __name__ == "__main__": main()`; virtual envs per project; tools: `ruff` (lint+format), `mypy` (types), `pytest`.

**JavaScript / TypeScript**
- `const` by default, `let` only on reassignment, `var` NEVER (function scoping bites in loops and closures).
- Always `===`; `async/await` over `.then` chains; wrap awaits in `try/catch` — an unhandled rejection is a silent crash.
- TypeScript strict: NO `any` — use `unknown` plus narrowing; discriminated unions for states (`{status:"ok", value} | {status:"err", error}`); `?.` optional chaining; `??` nullish default (NOT `||`, which eats `0` and `""`).
- Export a minimal surface; prefer named exports.

**Bash**
- Header `set -euo pipefail` and `IFS=$'\n\t'` — exit on error, undefined variable, and pipeline failure.
- Quote EVERY expansion: `"$var"`, `"${arr[@]}"`. Prefer `[[ ]]`; default with `${var:-default}`; temp files with `mktemp`; cleanup with `trap cleanup EXIT`.
- Exit codes: 0 success, 1 runtime failure, 2 usage error. stdout = data only, stderr = diagnostics.

**SQL**
- CTEs (`WITH`) for readable multi-step logic; window functions for per-group ranking and running totals; `EXPLAIN (ANALYZE, BUFFERS)` before optimizing anything.
- Parameterized placeholders only (`$1`, `%s`, `:name`); index `WHERE`/`JOIN`/`ORDER BY` columns with real selectivity; avoid `SELECT *` in application code; remember `NULL` three-valued logic (`col != 'x'` silently skips NULLs).

### 4.7 Design Patterns Catalog

| Pattern | One paragraph | Use when |
|---|---|---|
| Factory | Central function/class creates objects, hiding concrete classes and construction branching | The type is decided at runtime or construction has rules |
| Strategy | Interchangeable algorithms behind one interface, injected by the caller | Behavior varies by config/user: pricing, sorting, shipping rates |
| Observer | Subjects notify subscribed listeners of events | One event, many reactions; decouple producer from consumers |
| Adapter | Wrapper translating one interface into another | Integrating a third-party library behind your own interface |
| Decorator | Wraps an object, adding behavior with the same interface | Cross-cutting add-ons: logging, caching, retries, metrics |
| Repository | Data-access layer exposing a domain-shaped collection API | Isolate SQL/ORM from business logic; make persistence mockable |
| Singleton | One shared instance (module-level object or DI container) | RARELY: global mutable state hurts tests and parallelism — prefer dependency injection |

### 4.8 API & CLI Design

REST conventions: plural nouns (`/users/{id}/orders`), no verbs in paths; the method carries the action. Status codes:

| Operation | Success | Client error | Server error |
|---|---|---|---|
| GET collection | 200 + array | 400 bad params | 500 |
| GET item | 200 | 404 | 500 |
| POST create | 201 + `Location` header | 400 validation, 409 duplicate | 500 |
| PUT replace | 200 or 204 | 400, 404 | 500 |
| PATCH update | 200 | 400, 404, 409 conflict | 500 |
| DELETE | 204 | 404 | 500 |
| Auth failures | — | 401 unauthenticated, 403 unauthorized | — |
| Overload / rate limit | — | 429 + `Retry-After` | 503 |

Pagination: cursor-based (`?limit=50&cursor=...`) for scale; `limit`/`offset` for admin screens; ALWAYS cap `limit` (e.g. max 100). Idempotency: GET/PUT/DELETE are idempotent by definition; make POST retry-safe with an `Idempotency-Key` header. Versioning: `/v1/` prefix; additive changes only within a version. Error body contract: `{"error":{"code":"order_not_found","message":"...","details":{...}}}`.

CLI: `--help` always works; long+short flags (`--output/-o`); exit 0 success, 1 failure, 2 usage; `--json` machine mode; stdout = data only, stderr = logs; read stdin when piped; NEVER prompt interactively without `--yes` for automation.

### 4.9 Performance Engineering

MUST measure before optimizing: Python `python -m cProfile -s cumtime app.py` (or `pstats`), micro-timing via `timeit.repeat(number=...)`, wall clock via `time.perf_counter()`; Node `node --cpu-prof`; native `perf` plus flamegraphs. Intuition about hot spots is wrong more often than right.

Order of attack: (1) algorithm/complexity, (2) I/O reduction (batch, cache, fewer round trips), (3) data volume (stream, paginate, select only needed columns), (4) micro-optimizations LAST.

| Trap | Symptom | Fix |
|---|---|---|
| String concatenation in a loop | O(n²) time | accumulate in a list, `"".join(parts)` |
| N+1 queries | page of 50 → 51+ queries | JOIN, or batch `WHERE id IN (...)` |
| `in` over a list inside a loop | O(n²) membership | build a `set` once |
| Whole file/DB loaded into memory | OOM on large input | stream / iterate / cursor + `LIMIT` |
| Repeated expensive computation | same args, same result | `functools.lru_cache(maxsize=1024)` |
| Sync call inside async | event loop stalls | `asyncio.to_thread` / executor |

Caching rules: define the key, the invalidation, and the TTL BEFORE adding the cache; an unbounded in-process cache is a memory leak with a fancy name.

### 4.10 Security Fundamentals

- Validate ALL input at the boundary with allowlists: types, lengths, ranges, formats.
- SQL: parameterized queries ONLY. NEVER build SQL with f-strings, `.format`, or `+`. Shell: `subprocess.run(["git", "log", ref], check=True)` list args; NEVER `shell=True` with user data; `shlex.quote` if unavoidable.
- Secrets: environment variables or a secret manager; NEVER in code, logs, error messages, or URLs. Rotate anything that might have leaked — assume it did.
- Least privilege: DB users with only required grants; containers without root; API tokens narrowly scoped.
- Escape output per context: HTML (`html.escape`, autoescaping templates), URLs, shell, SQL. XSS = unescaped user content reaching HTML.
- Passwords: `bcrypt`/`argon2` ONLY — never MD5/SHA-1/plain. Tokens: `secrets.token_urlsafe(32)`, never `random`.
- Dependencies: pin versions, commit lockfiles, run `pip-audit` / `npm audit` / `osv-scanner` in CI.
- Crypto: never invent it — use `cryptography`; authenticated modes (AES-GCM); NEVER ECB.

### 4.11 Refactoring

Code smells to hunt: long function; duplicated logic; feature envy (a function obsessed with another class's data); primitive obsession (raw strings/ints where domain types belong — `UserId`, `Money`); shotgun surgery (one change touches ten files); data clumps (the same three parameters traveling together everywhere); long parameter lists; comments apologizing for bad names.

Safe sequence: (1) tests around the behavior first — characterization tests if none exist; (2) smallest step (rename → extract function → move module); (3) run tests; (4) commit. NEVER mix behavior changes with refactoring in one commit — it makes both unverifiable.

Strangler fig for rewrites: route a slice of traffic to the new implementation behind an interface, grow coverage of real cases, verify outputs match (shadow reads/dual writes), then retire the old path. NEVER big-bang swap a live system.

### 4.12 Concurrency Basics

| Workload | Model | Why |
|---|---|---|
| CPU-bound (parsing, math, image processing) | processes (`multiprocessing`, worker pools) | threads don't parallelize pure-Python CPU (GIL) |
| I/O-bound, tens to hundreds of tasks | threads or `asyncio` | waiting, not computing, is the bottleneck |
| Thousands of sockets / high fan-out | `asyncio` | cheap cooperative tasks; no preemption between awaits |
| Shell orchestration | processes + `concurrent.futures` | simple isolation of failures |

Race conditions appear when two steps interleave: check-then-act (`if key not in cache: cache[key] = load(key)`) and read-modify-write (`count += 1`). Fixes, in preference order: single-writer design; message queues; atomic primitives; locks around the WHOLE operation (not just the read). In distributed systems, replace locks with idempotent operations plus unique constraints — every retried write MUST be safe to run twice.

### 4.13 Version Control Discipline

Atomic commit = one logical change that builds and passes tests alone. Conventional Commits: `feat(cart): merge quantity when item re-added`, `fix(api): return 404 for unknown user ids`, plus `test:`, `refactor:`, `docs:`, `chore:`. Branches: `feat/short-desc` or `fix/ticket-123-short-desc`. Self-review `git diff --staged` before every commit. NEVER commit `.env`, secrets, build artifacts, or large binaries; NEVER rewrite history on shared branches — revert instead.

## 5. Code & Tool Templates

### 5.1 Module + pytest suite (Python)

```python
# cart.py — module under test
from pathlib import Path
import json

class EmptyCartError(Exception):
    """Raised when checkout is attempted with no items."""

class Cart:
    def __init__(self) -> None:
        self._items: dict[str, dict] = {}

    def add(self, name: str, price: float, qty: int = 1) -> None:
        if qty < 0:
            raise ValueError(f"qty must be >= 0, got {qty}")
        if price < 0:
            raise ValueError(f"price must be >= 0, got {price}")
        item = self._items.setdefault(name, {"price": price, "qty": 0})
        item["qty"] += qty

    def item_count(self) -> int:
        return sum(i["qty"] for i in self._items.values())

    def total(self) -> float:
        return sum(i["price"] * i["qty"] for i in self._items.values())

    def checkout(self, out=print) -> float:
        if not self._items:
            raise EmptyCartError("cannot checkout an empty cart")
        for name, i in self._items.items():
            out(f"{name} x{i['qty']} = ${i['price'] * i['qty']:.2f}")
        total = self.total()
        out(f"TOTAL = ${total:.2f}")
        return total

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(self._items))

    @classmethod
    def load(cls, path: Path) -> "Cart":
        cart = cls()
        cart._items = json.loads(path.read_text())
        return cart
```

```python
# test_cart.py — run: pytest test_cart.py -v
import pytest
from pathlib import Path
from cart import Cart, EmptyCartError

@pytest.fixture
def cart() -> Cart:
    return Cart()  # fresh state per test: tests MUST stay independent

def test_add_single_item(cart):
    cart.add("apple", price=1.50, qty=1)
    assert cart.total() == pytest.approx(1.50)

def test_add_same_item_merges_quantity(cart):
    cart.add("apple", price=1.50, qty=1)
    cart.add("apple", price=1.50, qty=2)
    assert cart.item_count() == 3

def test_empty_cart_raises_on_checkout(cart):
    with pytest.raises(EmptyCartError):
        cart.checkout()

@pytest.mark.parametrize("qty,expected", [(0, 0.0), (1, 1.50), (10, 15.00)])
def test_total_matches_qty(cart, qty, expected):
    cart.add("apple", price=1.50, qty=qty)
    assert cart.total() == pytest.approx(expected)

def test_negative_qty_rejected(cart):
    with pytest.raises(ValueError, match="qty"):
        cart.add("apple", price=1.50, qty=-1)

def test_unicode_product_name(cart):
    cart.add("美麗的蘋果 🍏", price=2.0, qty=1)
    assert cart.total() == pytest.approx(2.0)

def test_cart_file_roundtrip(cart, tmp_path: Path):
    path = tmp_path / "cart.json"          # tmp_path: pytest-managed temp dir
    cart.add("apple", price=1.5, qty=2)
    cart.save(path)
    assert Cart.load(path).total() == pytest.approx(3.0)

def test_checkout_prints_receipt(cart, capsys):
    cart.add("apple", price=1.5, qty=1)
    cart.checkout()
    out = capsys.readouterr().out
    assert "apple" in out and "1.50" in out
```

### 5.2 REST endpoint with validation and errors (Python + Flask)

```python
# app.py — pip install flask; run: python app.py
# then: curl -i http://127.0.0.1:5000/users/1
#       curl -i -X POST http://127.0.0.1:5000/users \
#            -H 'Content-Type: application/json' -d '{"name":"Ada","email":"ada@example.com"}'
from flask import Flask, jsonify, request

app = Flask(__name__)

class APIError(Exception):
    """Carries an HTTP status, machine code, message, and optional details."""
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.details = details or {}

@app.errorhandler(APIError)
def on_api_error(err: APIError):
    body = {"error": {"code": err.code, "message": err.message, "details": err.details}}
    return jsonify(body), err.status

USERS: dict[int, dict] = {1: {"id": 1, "name": "Ada", "email": "ada@example.com"}}
NEXT_ID = 2

def validate_user_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise APIError(400, "invalid_json", "body must be a JSON object")
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip()
    if not name:
        raise APIError(400, "missing_name", "name is required")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise APIError(400, "invalid_email", f"email is not valid: {email!r}")
    return {"name": name, "email": email}

@app.post("/users")
def create_user():
    global NEXT_ID
    data = validate_user_payload(request.get_json(silent=True) or {})
    if any(u["email"] == data["email"] for u in USERS.values()):
        raise APIError(409, "duplicate_email", f"{data['email']} is already registered")
    user = {"id": NEXT_ID, **data}
    USERS[NEXT_ID] = user
    NEXT_ID += 1
    return jsonify(user), 201, {"Location": f"/users/{user['id']}"}

@app.get("/users/<int:user_id>")
def get_user(user_id: int):
    if user_id not in USERS:
        raise APIError(404, "user_not_found", f"no user with id {user_id}")
    return jsonify(USERS[user_id])

@app.get("/users")
def list_users():
    try:
        limit = int(request.args.get("limit", "20"))
    except ValueError:
        raise APIError(400, "invalid_limit", "limit must be an integer")
    if not 1 <= limit <= 100:
        raise APIError(400, "limit_out_of_range", "limit must be between 1 and 100")
    return jsonify(list(USERS.values())[:limit])

if __name__ == "__main__":
    app.run(debug=True)  # dev ONLY — NEVER deploy with debug=True
```

### 5.3 Typed retry utility (TypeScript)

```typescript
// retry.ts — run: npx tsx retry.ts
export interface RetryOptions {
  attempts?: number;                    // total tries, default 3
  baseDelayMs?: number;                 // first backoff delay, default 200
  maxDelayMs?: number;                  // backoff ceiling, default 5000
  retryOn?: (err: unknown) => boolean;  // MUST return true only for transient errors
}

export class NonRetryableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NonRetryableError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 200;
  const max = opts.maxDelayMs ?? 5000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = opts.retryOn ? opts.retryOn(err) : true;
      if (!retryable || attempt === attempts) break;
      const delay = Math.min(max, base * 2 ** (attempt - 1)) + Math.random() * 100; // capped + jitter
      console.error(`attempt ${attempt} failed (${String(err)}); retrying in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Example usage:
let calls = 0;
const result = await withRetry(
  async () => {
    calls += 1;
    if (calls < 3) throw new Error("transient network blip");
    return { ok: true as const, calls };
  },
  { attempts: 5, retryOn: (e) => !(e instanceof NonRetryableError) }
);
console.log(result); // { ok: true, calls: 3 }
```

### 5.4 Robust script template (Bash)

```bash
#!/usr/bin/env bash
# error_report.sh — count ERROR lines per *.log file in a directory
set -euo pipefail
IFS=$'\n\t'

usage() {
  cat <<USAGE
Usage: $(basename "$0") -i INPUT_DIR [-o OUTPUT_FILE] [-v]
  -i  directory containing *.log files (required)
  -o  output file (default: ./report.txt)
  -v  verbose logging to stderr
USAGE
  exit 2   # 2 = usage error, by convention
}

die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

INPUT_DIR=""; OUTPUT="report.txt"; VERBOSE=0
while getopts ":i:o:vh" opt; do
  case "$opt" in
    i) INPUT_DIR="$OPTARG" ;;
    o) OUTPUT="$OPTARG" ;;
    v) VERBOSE=1 ;;
    h) usage ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))

[ -n "$INPUT_DIR" ] || usage
[ -d "$INPUT_DIR" ] || die "input dir not found: $INPUT_DIR"
mkdir -p "$(dirname "$OUTPUT")" || die "cannot create output dir"

cleanup() { [ -n "${TMP:-}" ] && rm -f "$TMP"; }
trap cleanup EXIT
TMP="$(mktemp)" || die "mktemp failed"

count=0
while IFS= read -r -d '' f; do
  [ -r "$f" ] || { log "skipping unreadable file: $f"; continue; }
  grep -c "ERROR" "$f" >> "$TMP" || true   # grep exits 1 on zero matches — do not let -e kill us
  count=$((count + 1))
done < <(find "$INPUT_DIR" -maxdepth 1 -name '*.log' -print0)

printf 'processed %d files\n' "$count" > "$OUTPUT"
[ "$VERBOSE" -eq 1 ] && log "wrote $OUTPUT"
exit 0
```

### 5.5 CTE + window function (SQL, PostgreSQL dialect)

```sql
-- Top-3 products per category by revenue over the last 90 days.
WITH recent_orders AS (          -- CTE 1: filter once, reuse below
    SELECT order_id, product_id, quantity, unit_price
    FROM orders
    WHERE ordered_at >= CURRENT_DATE - INTERVAL '90 days'
      AND status = 'completed'
),
product_revenue AS (             -- CTE 2: aggregate
    SELECT product_id,
           SUM(quantity * unit_price) AS revenue
    FROM recent_orders
    GROUP BY product_id
),
ranked AS (                      -- CTE 3: rank within each category
    SELECT p.category,
           p.name,
           pr.revenue,
           ROW_NUMBER() OVER (
               PARTITION BY p.category
               ORDER BY pr.revenue DESC
           ) AS rank_in_category
    FROM product_revenue pr
    JOIN products p ON p.id = pr.product_id
)
SELECT category, name, revenue, rank_in_category
FROM ranked
WHERE rank_in_category <= 3
ORDER BY category, rank_in_category;
```

## 6. Decision Tables

**Table 1 — Error-handling strategy:**

| Situation | Strategy | Why |
|---|---|---|
| Invalid user input | Reject at boundary with specific message / 4xx | Caller can fix it; never let bad data flow inward |
| Missing/failed resource (file, DB) | Raise a specific exception; let the caller decide | Different callers recover differently |
| Transient network/service failure | Retry with exponential backoff + jitter, capped attempts (e.g. 3–5) | Retries fix transients; jitter prevents thundering herds |
| Broken invariant (programmer error) | Assert / crash loudly | Silent corruption is worse than downtime |
| Resource in scope | `with` / `try..finally` / `defer` / RAII | Error paths skip manual cleanup |

**Table 2 — Concurrency model choice:** see §4.12 table (CPU → processes; I/O tens–hundreds → threads; thousands of sockets → asyncio; orchestration → processes).

**Table 3 — Tests to write per change type:**

| Change | Minimum tests |
|---|---|
| Pure function | Unit + parametrized edge catalog |
| New endpoint | Validation unit tests + happy/error integration |
| Bug fix | Regression test reproducing the bug FIRST |
| Performance change | Benchmark before/after with numbers |
| Parser/validator | Table-driven hostile-input cases |
| Concurrency code | Test with N threads + repeat runs (e.g. `pytest -n` loop) |

**Table 4 — Abstract now or later?**

| Condition | Action |
|---|---|
| Duplicated twice | Leave it (rule of three) |
| Duplicated three times, same reason to change | Extract function/module |
| Complexity isolated and stable | Inline, keep simple |
| Varies by config/product today | Parameterize or Strategy NOW |

## 7. Quality Checklist

- [ ] Requirement restated in one sentence; assumptions listed explicitly
- [ ] Plan (pseudocode/skeleton) existed before implementation began
- [ ] Something was executed at least every ~100 new lines
- [ ] All names searchable and pronounceable; no single-letter names beyond loop counters
- [ ] Functions ≤~30 lines, ≤4 params, single responsibility
- [ ] No bare `except:` / swallowed errors; every boundary validated
- [ ] No hardcoded secrets or environment-specific values
- [ ] Edge cases tested: empty, one, many, huge, unicode, negative, zero, boundary, malformed
- [ ] Tests written, run, and passing; external calls (network/time/random) mocked or seeded
- [ ] Resource cleanup via `with`/`finally`/`defer`/RAII — no manual `.close()` on error paths
- [ ] SQL parameterized; output escaped per context; no `shell=True` with user data
- [ ] No new dependency without justification (standard library tried first); lockfile updated
- [ ] Performance claims measured; no obvious O(n²) over user-controlled input
- [ ] Public functions documented (purpose, args, returns, raises) + one runnable example
- [ ] Full diff self-reviewed; commits atomic with conventional-commit messages
- [ ] Delivery includes the exact run commands and their output as evidence

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Coding before understanding the requirement | Perfectly built wrong thing; rewrite from zero | Restate requirement + list assumptions; confirm before building |
| 2 | Writing 500+ lines before first run | Cascade of syntax/import/name errors, lost context | Skeleton with stubs; run every ≤100 lines |
| 3 | Bare `except:` or `except Exception: pass` | "Works" but silently corrupts data; errors vanish from logs | Catch specific exceptions; log with context; re-raise (`raise ... from e`) |
| 4 | Mutable default argument (`def f(x, acc=[])`) | State leaks between calls; intermittent wrong results | Default `None`, create inside: `if acc is None: acc = []` |
| 5 | String concatenation in a loop | O(n²); report takes minutes at scale | Accumulate in a list; `"".join(parts)` |
| 6 | Float equality (`0.1 + 0.2 == 0.3`) | False; flaky money math | `math.isclose(a, b, rel_tol=1e-9)`; `decimal.Decimal` for currency |
| 7 | Testing only the happy path | Edge crash discovered by users | Parametrize the edge catalog (empty/one/many/huge/unicode/negative/boundary) |
| 8 | Premature abstraction | Wrong abstraction costs more than the duplication did | Rule of three; extract only when change reasons align |
| 9 | Secrets committed to git | Leak in history; expensive rotation | Env vars / secret manager; rotate + purge history if committed |
| 10 | Skipping input validation ("it's internal") | Injection, crash on first hostile payload | Validate at every trust boundary with allowlists |
| 11 | Timezone-naive datetimes | Off-by-hours bugs; DST-only failures | Store UTC, use `zoneinfo`-aware datetimes, convert at the edge |
| 12 | Blocking call inside `async` | Entire event loop freezes under load | `asyncio.to_thread()` / executor for blocking I/O |
| 13 | Copy-paste code without understanding | Subtle behavioral drift; license risk | Read, retype, adapt, test; attribute per license |
| 14 | Unbounded cache "for speed" | Memory grows until OOM | Bounded `lru_cache(maxsize=N)` or TTL cache with invalidation |

## 9. Advanced Techniques

### 9.1 Property-Based Testing (Hypothesis)

Example-based tests check inputs you thought of; property-based tests generate hundreds you didn't. Install `pip install hypothesis`, then assert invariants — properties that must hold for ALL inputs:

```python
# test_cart_props.py — run: pytest test_cart_props.py
from hypothesis import given, strategies as st
from cart import Cart

ITEMS = st.text(min_size=1, max_size=20)
MONEY = st.decimals(min_value=0, max_value=10_000, places=2)
QTY = st.integers(min_value=0, max_value=1_000)

@given(ITEMS, MONEY, QTY, ITEMS, MONEY, QTY)
def test_total_is_order_independent(n1, p1, q1, n2, p2, q2):
    c1, c2 = Cart(), Cart()
    c1.add(n1, p1, q1); c1.add(n2, p2, q2)   # property: addition order never changes the total
    c2.add(n2, p2, q2); c2.add(n1, p1, q1)
    assert c1.total() == c2.total()

@given(ITEMS, MONEY, QTY)
def test_total_is_sum_of_parts(name, price, qty):
    c = Cart()
    c.add(name, price, qty)
    assert c.total() == price * qty          # property: total equals the definition
```

Use for parsers (round-trip: `parse(encode(x)) == x`), math, state machines; keep ONE example-based test per reported bug so regressions have a named guardian.

### 9.2 Profiling-Driven Optimization

Workflow: (1) write a benchmark that mimics production shape (`bench.py` with `time.perf_counter()` around the hot region, N=1000); (2) `python -m cProfile -o out.prof bench.py`; (3) inspect: `python -m pstats out.prof` then `sort cumtime`, `stats 20`; (4) fix the top cumulative-time entry ONLY if it exceeds ~20% — below that, gains are noise; (5) re-run the benchmark and record before/after numbers in the commit message. NEVER optimize without this loop: micro-benchmarks routinely disprove intuition (`timeit.repeat("f()", globals=globals(), number=1_000_000, repeat=5)`).

### 9.3 Seams and Dependency Injection

A seam is a place where behavior can change without editing code — the foundation of testable design. Inject the things you are tempted to hardcode:

```python
from datetime import datetime, timezone

class SubscriptionService:
    def __init__(self, clock=lambda: datetime.now(timezone.utc), repo=None, mailer=None):
        self._clock, self._repo, self._mailer = clock, repo, mailer

    def is_expired(self, sub) -> bool:
        return sub.ends_at < self._clock()   # tests inject a frozen clock — no sleeps, no flakes
```

Rule: anything you would have to monkey-patch to test (clock, random, HTTP client, queue) is a dependency you should inject. Design the constructor so defaults are production-real and tests can override each independently.

### 9.4 Race-Condition Hunt (reproduce → fix → prove)

```python
# race_demo.py — run repeatedly: for i in $(seq 1 20); do python race_demo.py; done
import threading

counter = 0
def worker():
    global counter
    for _ in range(100_000):
        counter += 1        # NOT atomic: read-modify-write; typical final value < 2_000_000

threads = [threading.Thread(target=worker) for _ in range(2)]
for t in threads: t.start()
for t in threads: t.join()
print(counter)
```

Fix with a lock around the WHOLE operation (not just the read): `with lock: counter += 1`. Better designs in preference order: eliminate shared state, funnel writes through one thread/queue, use atomic primitives, then lock. Prove the fix: 20 consecutive runs all print exactly `2000000`.

### 9.5 Strangler-Fig Migration in Practice

(1) Introduce an interface both implementations satisfy; (2) route 1% of traffic (or one endpoint) to the new implementation with feature-flag off-switch; (3) shadow-write or dual-read to compare outputs, alerting on divergence; (4) grow the slice while metrics stay clean; (5) delete the old path with a deprecation window, never a same-day cutover. Each step is reversible — that is the entire safety argument.

## 10. Quick Reference Card

- **Workflow**: restate → assumptions → plan/skeleton → incremental + run often → edge tests → self-review → document → deliver with evidence.
- **Edge catalog**: empty, one, many, huge, unicode, negative, zero, boundary, malformed, duplicates, concurrent.
- **pytest**: `pytest -q` (quiet), `pytest -k expression` (select), `pytest -x` (stop at first), `pytest --lf` (last failed); fixtures, `parametrize`, `tmp_path`, `capsys`, `monkeypatch`, `approx`, `raises(match=)`.
- **Big-O targets**: hash/set lookup O(1); sort O(n log n); binary search O(log n); BFS/DFS O(V+E); nested loops over user input = smell.
- **HTTP status**: 200 ok, 201 created, 204 deleted, 400 malformed, 401 no creds, 403 no rights, 404 missing, 409 conflict, 422 semantic, 429 rate-limited, 500/502/503/504 server-side.
- **CLI exit codes**: 0 success, 1 failure, 2 usage.
- **Bash header**: `set -euo pipefail; IFS=$'\n\t'`; quote everything; `trap cleanup EXIT`; `mktemp`.
- **Python one-liners**: `f"{value=}"`, `pathlib.Path`, `enumerate(x, 1)`, `dict.get(k, d)`, `@dataclass(frozen=True)`, `functools.lru_cache(maxsize=1024)`, `math.isclose`.
- **TypeScript**: strict on, no `any` (`unknown` + narrowing), `?.`/`??`, discriminated unions, `const` first.
- **git**: `feat:/fix:/refactor:/test:/docs:`; atomic commits; `git diff --staged` before commit; revert, never force-push shared branches.
- **Security**: parameterized SQL only; allowlist validation; secrets in env; bcrypt/argon2; `secrets.token_urlsafe(32)`; escape output per context; audit deps in CI.
- **When stuck**: shrink the problem (smallest failing input), then bisect, then time-box and ask — in that order.


