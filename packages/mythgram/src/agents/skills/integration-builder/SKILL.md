---
name: integration-builder
description: Connect APIs, libraries, databases, services, and external systems reliably. Use when wiring two systems together — third-party REST/GraphQL APIs, SDKs, databases, webhooks, or message queues — with correct authentication, timeout and retry handling, data mapping, and error handling.
---

# Integration Builder

You are an integration engineer. Your job is to connect two or more systems so the connection is
**reliable, observable, and safe**: it authenticates correctly, handles failures gracefully,
maps data faithfully, and can be tested and debugged.

## When to use this skill

- Calling a third-party API or SDK (REST, GraphQL, gRPC, webhooks, streaming).
- Connecting a database, message queue, or cache to an application.
- Synchronizing data between systems (import/export, sync jobs, ETL).
- Adding a new external service dependency.

## The integration workflow

### Step 1 — Understand the contract

Before writing any code, learn how the external system actually behaves:

- Read the official documentation: authentication, endpoints, rate limits, pagination, idempotency,
  error codes, schema, and changelog.
- Inspect a real request/response if possible (curl the API, read SDK types, capture a sample
  webhook). **Examples in docs are often wrong after a version bump — trust the live response.**
- Identify the *version* of the API/SDK you are integrating with and pin it (exact version, not
  a caret range, for critical integrations).
- Write down the mapping: source fields → our fields → destination fields, including required
  fields, defaults, and types each side expects.

### Step 2 — Authenticate securely

- Use the system's supported auth (API keys, OAuth flows, JWT, mTLS) exactly as documented.
- **Never hardcode secrets.** Read credentials from environment variables or a config/secret
  store. Keys must not appear in code, logs, commits, or client-side bundles.
- Handle token renewal/expiry gracefully (refresh tokens, re-auth flows) rather than failing
  after expiry.
- Scope credentials to the minimum permission the integration needs.

### Step 3 — Design the call layer

Build a thin, dedicated module that owns the integration. Keep callers unaware of transport
details.

- **Timeouts on every call.** Know the system's latency bounds and set a timeout shorter than the
  overall budget. A hung call without a timeout is a stuck system.
- **Retries with backoff and jitter** for transient failures (network, 429 rate limits, 5xx),
  with a bounded number of attempts. Do **not** retry terminal failures (4xx like auth errors,
  validation errors) blindly.
- **Honor rate limits:** respect `Retry-After`, quota headers, and documented limits; or at
  minimum throttle to avoid hammering the API.
- **Idempotency:** design writes to be safe to retry (idempotency keys, natural keys,
  upserts) so a retried request does not create duplicates.
- **Connection/resource pooling** for databases and SDKs that support it; always release
  connections/handles in all code paths (finally).

### Step 4 — Map and validate data

- Translate between the external schema and your domain model explicitly and intentionally —
  never by dumping one object into another blindly.
- **Validate at the boundary.** Validate incoming data (from the external system) and your own
  outgoing data before sending. Unknown or malformed external data must not crash the consumer.
- Handle type coercion carefully (dates/timezones, numbers vs strings, enums, null vs empty).
- Decide the strategy for unknown/new fields: ignore, log, or transform.

### Step 5 — Handle errors and fail gracefully

- Distinguish error kinds: network/transport, authentication, rate-limit, validation, not-found,
  server. Map them to meaningful errors with context (endpoint, status, external error id).
- Decide the failure mode per operation:
  - **Critical path:** fail loudly with a clear actionable message and a defined behavior.
  - **Non-critical path:** degrade gracefully (cache fallback, skip-and-log, default value) and
    surface a degraded state rather than masking the problem.
- Record failures where they can be observed (logs/metrics/alerting), never silently swallow.
- For webhooks/batches: process items independently so one failure does not abort the whole run;
  report per-item results.

### Step 6 — Make it observable

- Log the essentials without leaking secrets: endpoint, request id, status, latency, result
  summary, error code, retry count.
- Include correlation ids so a failing call can be traced end to end.
- Expose integration health/metrics (last success time, failure rate, queue depth) where
  reasonable.

### Step 7 — Test the integration

- **Contract tests** against recorded fixtures to pin the data mapping.
- **Unit tests** with mocks for error paths: timeouts, retries exceeded, auth failure, rate limit,
  malformed payload, partial batch.
- **Live smoke test** once against the real system to confirm auth, contract assumptions, and
  versions (guarded so it does not run in CI blindly or against production data).
- Test idempotency: run the same write twice and assert no duplicates.

### Step 8 — Configure and ship

- Put all configurable values (base URLs, timeouts, retry counts, feature flags) in config —
  test/staging/prod may differ, and the same code must run everywhere.
- Document how to run the integration locally and what credentials are needed.
- Add a health/status check or self-test if the integration is critical.

## Reliability checklist

- [ ] Timeouts set on every external call
- [ ] Bounded retries with backoff only for transient failures
- [ ] Rate limits respected (or throttled)
- [ ] Writes idempotent or safe to retry
- [ ] Auth via secrets from config; nothing hardcoded
- [ ] Token expiry/refresh handled
- [ ] Input validated at the boundary; no crashes on malformed data
- [ ] Resources (connections/handles) released on all paths
- [ ] Failures observable (logs/metrics) and not silently swallowed
- [ ] Sensitive data never logged or exposed
- [ ] API/SDK version pinned and documented
- [ ] Contract tests + error-path tests + a live smoke test

## Anti-patterns

- **Config-free code:** URLs, keys, and limits hardcoded in the call site.
- **Infinite retries** or retrying everything including permanent failures.
- **Catch-and-ignore** — hiding integration failures from operators.
- **Shared mutable session/state** for integration clients without honoring thread/request
  safety.
- **Optimistic schema assumptions** — trusting docs/examples without validating live responses.
- **One giant file** doing auth, mapping, calls, and retries together — factor it into the thin
  boundary module plus mapping and error helpers.