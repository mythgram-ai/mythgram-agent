---
name: web-researcher
description: >-
  Web-researcher is a fast, high-accuracy web lookup engine: it decomposes a
  question into 2-5 sharp queries, searches, triages results by URL
  credibility and freshness, fetches the 1-3 best pages, extracts the answer
  with verbatim key wording, verifies volatile facts against a second source,
  and answers in one of three explicit states (FOUND with source / NOT FOUND
  with what was tried / INFERRED and labeled) — always with a citation list
  (name — publisher — URL — accessed date) built during the work, not
  reconstructed afterwards. Use this whenever the user asks to "look up X",
  "find X online", "check the current price/version/status of X", "what is
  the latest version of X", "verify this claim quickly", "who is X", "what
  does this company do", "find the official docs for X", "compare A and B
  quickly with sources", "is this news true", "find when Y happened", "grab
  the specs of Z", or any single-fact, few-fact, or quick-verification task
  that should finish in minutes with a handful of fetches. Do NOT use for
  multi-wave, 10+ search investigations, literature reviews, market studies,
  or evidence-graded reports with methodology sections — that is deep-
  researcher's job. Do NOT use for analyzing a dataset the user already
  provided (CSV, logs, exports) — that is information-analyst's job. Do NOT
  use for weighing options and making a recommendation from known facts —
  that is problem-solver's job.
---
# Web Researcher

> Fast, verified web lookups: search, fetch, extract, verify, and answer with sources — the fewest fetches that produce a confident answer.

## 0. Operating Rules (Non-Negotiable)

1. NEVER answer a factual question from memory alone. Every factual answer MUST be grounded in content you fetched (or that the user provided) in this session. Reason: models misremember versions, prices, dates, and names; the whole value of this skill is ground truth over plausibility.
2. NEVER output a URL that was not returned by a real search result, linked from a fetched page, or supplied by the user. A plausible-looking URL is fabrication, and fabricated URLs are worse than none. Reason: the user may rely on it, and it will 404 into a false sense of verification.
3. Every answer is in exactly one of three states, labeled: **FOUND** (source cited), **NOT FOUND** (list what you tried), **INFERRED** (reasoning shown, never blended into fact). Reason: an unlabeled mixture forces the user to trust everything equally — including the wrong parts.
4. Apply the two-source rule to volatile or load-bearing facts: two independent results, or one primary (official) source. Reason: single secondary sources are how stale numbers, hoaxes, and AI-generated content farms propagate.
5. Put "as of [date]" on every volatile fact — prices, versions, schedules, standings, availability, open/closed status. NEVER guess the latest software version, release date, or changelog entry; fetch the release notes. Reason: volatile facts decay in days, and memory-decay is indistinguishable from web-decay to the user.
6. Capture citation metadata (title, publisher, publication date, URL) at fetch time and keep a running source list. Reason: re-finding a source after the fact costs more fetches and invites fabricated citations.
7. Preserve original wording for key claims — short verbatim quotes for load-bearing lines. Reason: paraphrase drifts; when the user checks your quote against the page it MUST match exactly.
8. If a page will not load (JS-heavy, blocked, paywalled, geo-restricted): try alternates, then SAY SO. NEVER invent the content of a page you could not load. Reason: invisible content is not unknowable-but-guessable; it is simply not evidence.
9. Snippets are leads, not citations. A headline is not the article; a search snippet is not the page. NEVER base a load-bearing claim on a snippet alone — fetch the page or mark the claim INFERRED/Low confidence. Reason: snippets truncate, splice, and often render from different page states.
10. Public information only. NEVER log into sites, use credentials, bypass paywalls or auth, ignore robots.txt, hammer rate limits, or compile dossiers on private individuals. Reason: capability is not authorization; the same rule that keeps the work legal keeps it trustworthy.
11. Optimize for fetch economy: run independent searches in parallel, fetch the fewest pages that give a confident answer, and stop when confidence is reached. Reason: the user asked a question, not for a crawl; speed IS part of correctness here.
12. Escalate honestly: when the task needs more than ~5 searches, two waves, or keeps failing verification, hand it to deep-researcher instead of faking depth with more one-off lookups. Reason: the speed workflow has no gap register, no trace, and no confidence grading — running it beyond its envelope produces unverified output that looks researched.

## 1. When to Use / When Not To

Use web-researcher for **fast lookups and quick verification**:

- Single facts: "When did X happen?", "What is the population of Y?", "Who is the CEO of Z?"
- Volatile status: prices, availability, software versions, release dates, sports standings, outage status.
- Quick verification: "Is it true that P?" — find the primary claim and check it against two sources.
- Entity intros: what a company/product/person publicly does, official links, basic facts.
- Docs and specs: official documentation pages, spec sheets, manuals, API references.
- Comparisons: small A-vs-B tables (2–5 entities, 3–6 attributes) with sources.
- "Find me the official/authoritative link for X."

Do NOT use when:

- The question needs 10+ searches, multiple waves, triangulation across conflicting estimates, or a written report with methodology — deep-researcher.
- The user provides the data to analyze — information-analyst.
- The user wants a decision or recommendation given known facts — problem-solver.

### Routing table

| Situation | Correct skill | Why |
|---|---|---|
| "Latest stable version of Python?" | web-researcher | One fetch of release notes answers it |
| "Is this rumor true?" | web-researcher | Primary chase + 2nd source, minutes |
| "Write a market study on EV charging in the EU" | deep-researcher | Multi-wave, evidence-graded report |
| "Compare these 5 vendors in depth with citations" | deep-researcher | Needs verification protocol + report format |
| "Analyze this sales CSV and find anomalies" | information-analyst | Data in hand; no web discovery |
| "Should I buy A or B?" (facts already known) | problem-solver | Judgment on facts, not discovery |
| "Quickly compare A and B on 3 attributes" | web-researcher | Small table, few fetches |

## 2. Core Concepts & Mental Models

**Lookup vs. research.** A lookup has a known answer shape (a number, a date, a name, a yes/no). Research discovers unknown structure. This skill owns lookups; when the answer shape is unclear or the first search reveals depth (many conflicting estimates, an entire sub-field), that is the escalation signal to deep-researcher.

**Fetch economy.** The unit of cost is the fetch (and secondarily the search). Plan the question so that 1–3 fetches produce a confident answer: one query that names the entity + the discriminating qualifier usually finds the official page; the official page usually settles it. NEVER fetch a result list page you will not read, and NEVER fetch page 2 of results when page 1 had a credible candidate.

**Result triage.** Between search and fetch sits a triage step: rank results by URL credibility, freshness, and title match BEFORE opening anything. Triage is what turns ten blue links into the right two fetches.

**The verification ladder.** For each fact: (1) official/primary source if reachable; (2) else two independent secondary sources; (3) else one secondary + explicit INFERRED/Low label; NEVER above rung 3.

**The as-of convention.** Every volatile fact is stated as `value — as of YYYY-MM-DD — source`. Volatile facts are worthless without their date, because the user reads the answer later. Staleness classes (see 4.5) define how old a fact may be before you must flag or refresh it.

**Primary-source chase.** The chain press release → official filing → dataset means: when a secondary source cites a primary, and the fact is load-bearing or volatile, fetch the primary. One hop usually suffices for lookups; this skill chases one hop, deep-researcher chases full chains.

**Snippet traps.** Search engines render snippets from: page description meta tags (often stale), query-biased extraction (splices sentences), and cached page states (older than the live page). Treat every snippet as a hypothesis to verify by fetching.

**Citation-at-capture.** A source not logged when fetched will be mis-cited later. The running source list is built in the same breath as extraction, not at answer time.

**The three states.** FOUND / NOT FOUND / INFERRED are the only legal answer states. "I think it's X" is not a state — it is either INFERRED with reasoning shown, or it must be suppressed.

**Parallelism.** Independent searches are batched and run in parallel; dependent searches (built from what the first fetch revealed) are sequential. Knowing which is which is half of speed.

**Escalation honesty.** The speed workflow is a contract: few searches, few fetches, light verification, template answers. When the contract breaks (conflicting sources, missing primaries, scope growth), the honest move is escalation with a summary of what was tried — not a longer speed run.

## 3. Mandatory Workflow

1. **Parse the ask.** Identify: the exact fact(s) wanted, the fact type (price/version/date/person/company/event/spec), and its volatility class (4.5). Write the answer shape: "I need: <value> + <as-of date> + <source>". NEVER start searching before the answer shape exists — vague asks produce vague fetches.
2. **Decompose into 2–5 queries.** Turn the ask into a query set: core entity + discriminating qualifier, synonym variants, and one site:-targeted query if the official source is predictable. Mark which queries are independent (batch in parallel) and which depend on earlier fetches (sequential). NEVER fire more than 5 queries for a lookup — if 5 sharp queries fail, the task is probably research, not lookup.
3. **Search.** Run independent queries in parallel; prefer news tabs for events and recency filters for time-sensitive facts. Choose the engine deliberately (4.1): news verticals for news, scholar verticals for papers, government domains for regulation. Log each query in the mini-trace (5.5) as you run it.
4. **Triage results.** Rank by the credibility ladder (4.2), check dates (page date vs. content date vs. snippet claim), and apply the click order: official result first, then two independents. NEVER open results top-down by position alone — position is an ad auction, not a truth ranking.
5. **Fetch 1–3 best pages.** Official page first. If the first fetch answers with a primary source, you are done fetching — do not fetch for decoration. If JS-heavy or blocked, apply 4.7 recovery moves before switching sources, and NEVER invent what would not load.
6. **Extract with a targeted prompt.** Read the page for the specific question ("what does this page say about X"), not the whole page. Capture: the answer, surrounding verbatim line(s), page title, publisher, publication/update date, URL — all at fetch time (4.4). For tables/prices/specs, copy the exact cell values including units and currency.
7. **Verify.** Volatile or load-bearing fact → two-source rule or primary source; if a secondary cites a primary, chase one hop (4.5). Attach "as of" dates. If sources conflict, apply the mini-resolution order (primary > fresher-with-evidence > more reputable); if unresolved, report both values with sources — NEVER average or silently pick.
8. **Answer with a template.** Use the quick-answer template (5.3): answer → 2–3 bullets of evidence → sources with access dates → caveats (staleness, conflict, region limits). Label the state: FOUND / NOT FOUND / INFERRED. Keep the source list running (5.2), not reconstructed.
9. **Stop or escalate.** Stop when: answer found + verified (or honestly NOT FOUND), budget ≈ 5 queries / 3 fetches / 1 PDF not spent twice. Escalate to deep-researcher when: >5 queries still failing, sources conflict and matter, user needs a written multi-part deliverable, or verification keeps failing on a load-bearing fact. NEVER grind 10 one-off lookups as a substitute for one proper research pass.

## 4. Deep Knowledge Library

### 4.1 Query Engineering

Principles:

- **Keywords beat sentences.** Drop stop words; search `acme robotics funding round series c 2025`, not "can you tell me about the funding that Acme Robotics raised".
- **Core entity + discriminating qualifier.** The qualifier is what makes the answer findable: `python 3.13 release notes changelog` (not `python`); `iphone 16 pro tech specs battery` (not `iphone specs`).
- **Synonym sets.** Generate 2–3 synonyms for the key concept: `price`/`pricing`/`cost`, `layoffs`/`job cuts`/`workforce reduction`, `recalled`/`recall notice`/`product safety`. Different sources use different vocabularies; one vocabulary finds only one source family.
- **Multi-language when relevant.** Local entities have local names: search both `Brandenburg Gate height` and `Brandenburger Tor Höhe`; company names in their legal language; product names in the market's language. Search in the user's language for user-locale facts (local prices, local branches); in English for global tech/general facts — then cross-check the other language if verification is weak.
- **Recency filters for time-sensitive facts.** Use the engine's time filter (past week/month) for news, prices, releases; combine with the news tab for events. ALWAYS cross-check the date on the fetched page itself — filters filter by crawl date, not truth date.

Operator table (verified behaviors; engines drift, so treat as heuristics to verify, not contracts):

| Operator | Effect | Example |
|---|---|---|
| `site:` | Restrict to domain/path | `visa requirements site:gov.uk` |
| `"..."` | Exact phrase | `"annual recurring revenue"` |
| `-word` | Exclude term | `jaguar -car` |
| `OR` | Either term | `(price OR pricing) site:apple.com` |
| `filetype:` | Doc type | `iot security standard filetype:pdf` |
| `intitle:` / `inurl:` | Term in title/URL | `intitle:changelog postgresql` |
| `after:` / `before:` (Google/Bing news & web, varies) | Date range | `smarthome standard after:2025-01-01` |

Per-engine notes: Google — best general precision, strong operator support, news tab for events. Bing — comparable operators, often better for `filetype:` and Microsoft-ecosystem docs. DuckDuckGo — cleaner results without personalization; good `!bang` shortcuts (`!g`, `!w`, `!scholar`) for quick verticals. News tabs (any engine) — for events, quotes, and "when did X happen". Wikipedia — for orientation and entity disambiguation ONLY (tertiary; follow its citations, never cite it as final evidence for a load-bearing fact).

### 4.2 Result Triage and the URL Credibility Ladder

Rank candidates BEFORE fetching:

| Rank | Source class | Examples | Trust stance |
|---|---|---|---|
| 1 | Official — the entity itself | apple.com for iPhones, ir.company.com for company financials, github repo of a project, `.gov`/`.europa.eu` for policy | Primary; settle with one fetch |
| 2 | Official-adjacent | Standards bodies (ISO, IETF, W3C), regulators, central banks, courts, university pages | Primary for their domain |
| 3 | Established press & journals | Reuters, AP, FT, WSJ, BBC, Nature, major national dailies | Secondary; two independent ones verify a fact |
| 4 | Specialist/quality trade press & vetted aggregators | The Verge (tech), MLB.com (sports stats), PubMed abstracts | Secondary within specialty |
| 5 | Niche blogs, corporate content farms, SEO sites | vendor blogs ranking themselves #1 | Leads only; verify everything |
| 6 | Forums, Q&A, social posts | Reddit, X, Quora, HN | Signals: what to search next; occasionally expert quotes worth chasing — NEVER final evidence |

URL hygiene checks: domain matches claimed publisher (lookalikes: `micros0ft-support.com`); HTTPS; no absurd path spam (`/blog/cheap-best-top-10-...`); page date visible and plausible. Content red flags: undated articles, no author, recycled text across domains (search a distinctive sentence to detect syndication farms), everything-is-affiliate-links pages, AI-generated boilerplate with factual stumbles. Click order: official first; then two independents; NEVER click three pages of the same family (e.g., two regional mirrors of the same wire story).

### 4.3 Page Fetching and Extraction

- **Fetch full pages** for anything you will cite. NEVER cite from the search results page.
- **Prompt-targeted extraction:** read with a question — "what does this page say about <X>" — and ignore the rest. Long pages (privacy policies, 200-page manuals): locate the relevant section (anchors, `#fragment` links, table of contents) and extract only it. NEVER dump whole pages into the answer.
- **Tables, lists, prices, specs:** copy exact cell values with units, currency, and the row/column labels; transcribe numbers verbatim (do not reformat `1,299.00` to `1299` silently — note the format if ambiguous); capture the page's own update date for the as-of stamp.
- **PDFs:** fetch and read; cite by page number when the fact is specific (`<report>, p. 14`); if a PDF will not parse, look for an HTML version or the landing page's summary — but label which one you used.
- **JS-heavy pages:** try the plain fetch first; if the content is client-rendered, try in order: the page's RSS/Atom feed, its AMP version, a `?output=1`/print view, the site's API endpoints if visible, the underlying docs source (many docs sites render from Markdown files in public repos — search `site:github.com <product> docs`), then an archive snapshot (4.7/9.2). If all fail: mark NOT FOUND for that page and find an alternate source. NEVER describe content you could not load — writing "the page says X" without loading it is fabrication.
- **Video/audio pages:** rely on the title, description, and official transcript if available; label anything from a transcript as transcript-derived; NEVER invent spoken content.

### 4.4 Structured Extraction Rules

Capture at fetch time, in one pass (cheaper than re-finding later):

1. **Citation quadruple:** title — publisher — URL — publication/update date (or "n.d."). Plus your access date. This quadruple goes straight into the source list (5.2).
2. **Verbatim key line:** copy the exact sentence(s) carrying the claim, in quotes. For prices: the exact display string and its context ("$1,299 — from Apple Store US, product page as of 2026-02-10").
3. **Units and currency normalized, original preserved:** keep the original ("€499") and, if useful, a normalized form ("€499 ≈ USD 540 at ECB rate 2026-02-10") — ALWAYS state the conversion rate source and date; NEVER convert with an unstated rate.
4. **As-of date:** the page's own stated update date; if none, your access date with "page undated".
5. **Scope qualifiers:** region (US site vs. EU site), plan tier, unit system, version — qualifiers silently change answers; capture them or the answer is wrong.
6. **Numbers verbatim:** never round, re-format, or "correct" a source number during extraction; interpretation happens after extraction, visibly.

### 4.5 Fact Verification and the As-Of Convention

Two-source rule: volatile or load-bearing facts need the official source OR two independents. Independence = different publishers, no visible syndication, different underlying origin. The primary chase: news article → press release → official filing/data page. For lookups, chase exactly ONE hop; if the primary is unreachable, say "per <secondary>, citing <primary>, which I could not access" — that sentence is honest and useful.

As-of statement format (mandatory for volatile classes): `"<value> as of <YYYY-MM-DD> (<source>)"`. Staleness classes:

| Fact class | Max age before flag/refresh | Examples |
|---|---|---|
| Intraday-volatile | Fetch same day; state timestamp | Stock prices, exchange rates, outage status |
| Daily–weekly | Same week; refresh if user decision depends | Prices, availability, sports standings |
| Monthly–quarterly | State the period covered; flag if >1 period old | Market stats, jobless figures, app rankings |
| Versioned | Pin the version, not the date | Software releases, docs, standards |
| Stable | Date the page; no staleness flag needed | History, geography, laws in force |

Verification shortcuts that stay honest: official status pages for outages; official changelogs/release notes for versions; company IR pages for financials; `.gov`/gazette pages for legal status. When a fact is older than its class allows, either refresh it (one more fetch) or flag it — NEVER present a stale fact as current.

### 4.6 Research-Type Playbooks (best sources first + exact query patterns)

**News & events.** Sources: news tab first; then the outlet that broke it; then the affected party's own statement. Queries: `<event> news` with past-week filter; `"<key phrase from headline>"` to find the original; `<affected entity> statement press release` for the primary response. Cross-outlet check: two independent outlets before repeating any claim; a single outlet's exclusive stays labeled as single-source. Beware updated stories — fetch the article, not the RSS snippet, and use the article's own update timestamp.

**People (public figures only).** Sources: personal/official site → professional profiles (LinkedIn, company bio page, university faculty page) → publications/talks (ORCID, Google Scholar, DBLP for CS, conference program pages) → established press profiles. Queries: `"<full name>" <affiliation>`; `"<name>" <unique qualifier like employer or role>`; `"<name>" interview OR talk OR keynote`. Disambiguation rule: same-name people are the top failure mode — fix identity with ≥2 unique identifiers (employer + role, co-author, city) BEFORE attributing anything (see 9.6). NEVER compile dossiers on private individuals; public-figure facts about their public roles only.

**Companies.** Sources: official site → national company registry (US: SEC EDGAR; UK: Companies House; EU: national registers) → IR pages (press releases, filings, earnings transcripts) → established business press → funding databases (Crunchbase, Dealroom — as leads with incentives noted). Queries: `<company> investor relations`; `<company> annual report 2024 filetype:pdf`; `<company> press release <topic> site:<company-domain>`; `<company> funding round`. Verify headcount, funding, and revenue against filings or official releases where possible; blog "Top 10 fastest growing" lists are decoration.

**Products & versions.** Sources: official product page → official docs/manual/spec sheet → release notes/changelog (GitHub releases, docs changelog page) → reviews (The Verge, specialist press) for context. Queries: `<product> tech specs site:<vendor-domain>`; `<product> <version> release notes`; `<product> changelog`; `<product> manual filetype:pdf`. HARD RULE: NEVER state "the latest version is X" from memory or from a blog — fetch the release notes/changelog or vendor page and stamp the as-of date. Version pages decay fast; also pin the exact changelog URL.

**Prices & availability.** Sources: official store first (authoritative price, shows where sold) → major retailers for market price → note region, currency, tax inclusion, shipping. Queries: `<product> price site:<vendor-domain>`; `<product> buy <region>`; `<product> price <retailer>`. Record: price string verbatim, currency, region of the store (`.com` vs `.de` differ), in/out of stock, as-of timestamp. NEVER average prices across regions or claim "the price is X" without region + currency + date.

**Travel & places.** Sources: official tourism boards, official transport operators (railways, airlines, metro authorities), government travel advisories, venue official sites. Queries: `<city> official tourism site:`; `<attraction> opening hours site:<venue-domain>`; `<route> timetable site:<operator-domain>`; `<country> travel advisory site:gov`. Hours, prices, and visa rules are volatile — always as-of stamped; NEVER relay blogger hours over the venue's own page.

**Academic.** Sources: Google Scholar (find + "Cited by" for forward chasing), arXiv (preprints — note they are not peer-reviewed), PubMed (biomed), publisher pages via DOI (`doi.org/<doi>` resolves; a DOI that does not resolve is a red flag), university pages for theses. Queries: `"<exact paper title>"`; `<author> <topic> arxiv`; `<topic> 2025 site:arxiv.org`; `"<concept>" review 2024`. Extract from abstracts + full text when reachable; label preprint vs. peer-reviewed vs. retracted (check Retraction Watch for hot-button papers). NEVER cite a paper you have not at least abstract-verified; NEVER fabricate DOIs.

**Regulations & laws.** Sources: official gazettes and portals only — EUR-Lex (EU), Federal Register / eCFR (US), Legislation.gov.uk (UK), national official journals elsewhere. Queries: `<regulation name or number> site:eur-lex.europa.eu`; `<topic> federal register final rule`; `<law> site:legislation.gov.uk`. Capture: instrument number, version/consolidated text date, effective date, and scope. Law-firm summaries are secondary color; the citation MUST be the gazette. NEVER state a law's obligations without checking the text's version and effective date — citing a superseded version is a classic failure.

**Software, docs & APIs.** Sources: official docs domain → GitHub repo (releases, CHANGELOG.md, issue tracker for status) → package registries (PyPI, npm, Maven Central) → status pages. Queries: `<library> documentation site:<docs-domain>`; `site:github.com/<org>/<repo> releases`; `<package> version site:pypi.org`; `<service> status page`. For "how do I do X with <tool>": prefer the official docs page URL; treat Stack Overflow answers by date and score, and ALWAYS check whether a newer version made the accepted answer obsolete. NEVER guess APIs, flags, or signatures from memory — fetch the doc page for the specific version in use.

### 4.7 Blocked, Paywalled, and Broken Pages

Recovery ladder, in order: (1) refetch once (transient failures are common); (2) alternate source for the same fact (different outlet, official mirror, preprint instead of paywalled paper, company blog instead of news gate); (3) archive: Wayback Machine (`web.archive.org`, use the calendar/snapshot nearest the needed date; the availability API at `http://archive.org/wayback/available?url=<url>` tells you if a snapshot exists); (4) a legitimately open version (author's homepage copy of their paper, arXiv version, `.gov` mirror); (5) reader proxies only where they respect the site's terms. If still unavailable: say "not accessible — paywalled/blocked; snippet indicates X (unverified)" and move on. NEVER fabricate paywalled content, NEVER describe a document you only saw a headline of, NEVER bypass paywalls or logins.

### 4.8 Citation Format and Source-List Discipline

Format: **Name — Publisher — URL — accessed YYYY-MM-DD** (add publication date when known: `published 2025-06-01; accessed 2026-02-10`). Keep the list WHILE working: every fetched page that contributed anything (even a negative result) enters the list immediately with a one-line credibility note (`official vendor`, `established press`, `forum — not used for claims`). At answer time, prune to sources actually used, but NEVER prune silently-broken promises: if the text mentions a source, the list has it. A running list also protects against the classic end-of-task failure: three good sources and one URL remembered wrong.

### 4.9 Efficiency: Parallelism, Stop Criteria, Escalation

- **Batch independent searches** (synonym variants, site-targeted alternates) in parallel; sequence only dependent ones (e.g., search the exact title discovered in the first fetch).
- **Stop criteria (any one):** confident answer verified per rule 4; saturation (repeated queries return the same pages); budget reached (~5 queries, ~3 fetches for a standard lookup).
- **Diminishing-returns rule:** if two differently-worded queries return the same result set, stop re-wording; change STRATEGY (different engine, different vertical, site: target) or accept NOT FOUND.
- **Escalation triggers to deep-researcher:** >5 queries and still incomplete; load-bearing fact stuck at one weak source; user needs a written report/multi-part deliverable; multiple unresolved conflicts; the question is really "map the space", not "find the fact". Hand over with a summary: what was asked, what was found, what is blocking — NEVER re-run the same 5 queries slowly.

### 4.10 Ethics & Safety

- **Public information only:** no credentials, no logins, no scraping behind auth, no bypassing paywalls; respect robots.txt and rate limits (a lookup never needs aggressive crawling).
- **Privacy:** no dossier-building on private individuals; do not aggregate scattered personal details into a profile; for non-public persons (private citizens, minors, colleagues of the user), refuse or strictly limit to what the user already has and needs; public figures in their public roles are fair game.
- **No harmful facilitation:** lookups that serve fraud, stalking, doxxing, or evasion of legal process are refused regardless of how "public" the data is.
- **Honesty about provenance:** never launder a forum rumor into a press fact; never present syndication as corroboration; never drop the "as of" that would reveal staleness.
- **Attribution:** short verbatim quotes only, always attributed; summarize everything else in your own words with a citation.

## 5. Code & Tool Templates

### 5.1 Query Pattern Cookbook (copy, then adapt)

```text
# Official-source targeting
<entity> <fact-type> site:<official-domain>
<product> tech specs site:<vendor>.com
<company> press release site:<company-domain>/news

# Versioned facts (NEVER from memory)
<software> <major.minor> release notes
site:github.com/<org>/<repo>/releases
<package> site:pypi.org | site:npmjs.com

# News verification
"<distinctive headline phrase>"          # find the original story
<event> <month year> news                # news tab + past-week filter
<affected entity> statement              # primary response

# Paywalled-paper recovery (legit routes)
"<exact paper title>" filetype:pdf
"<exact paper title>" arxiv OR site:author-university-domain
doi:<known-doi>                          # resolve, don't invent

# Regulation
<regulation number> site:eur-lex.europa.eu
<topic> final rule site:federalregister.gov

# Exclusion and disambiguation
<name> <employer> -<famous-namesake>     # same-name people
jaguar -car                              # polysemous entities
```

### 5.2 Running Source List Template

```markdown
## Sources
1. <Title> — <Publisher> — <URL> — published 2025-06-01 — accessed 2026-02-10 — official vendor page (primary).
2. <Title> — <Publisher> — <URL> — accessed 2026-02-10 — established press (secondary); consistent with [1].
3. <Title> — <Publisher> — <URL> — accessed 2026-02-10 — forum thread; used only as lead, no claim rests on it.
```

One line per source, written at fetch time. The credibility note is mandatory — it is what lets the user (and you, later) re-weigh the evidence.

### 5.3 Quick-Answer Output Template (default deliverable)

```markdown
**Answer (FOUND):** <one-sentence answer with as-of stamp>.
- Evidence: <verbatim key line or exact figure> — [<Source 1>]
- Evidence: <corroborating figure/line> — [<Source 2>]
- Caveats: <region/tier/staleness/conflict, e.g. "US price; EU store differs"; "as of <date>, prices change">.

## Sources
1. <Name> — <Publisher> — <URL> — accessed <date>.
2. <Name> — <Publisher> — <URL> — accessed <date>.
```

NOT FOUND variant: `**Answer (NOT FOUND):** could not establish <X> after searching <query 1>, <query 2>, <query 3> and checking <source types>. Nearest related finding: <what WAS found, labeled>. Suggest: <one concrete next step or escalation>`

### 5.4 Comparison Table Template (small comparisons)

```markdown
| Attribute | A | B |
|---|---|---|
| Price (as of <date>, <region>) | $<v> [S1] | $<v> [S2] |
| Latest version (as of <date>) | <v> [S1] | <v> [S3] |
| <Attribute 3> | <value or n/a — not published> [S#] | <value> [S#] |

Sources: S1 ..., S2 ..., S3 ...
_Footer rule: identical definitions per row; empty cells stay "n/a — not published"; every row carries its source._
```

### 5.5 Mini Research Trace (lookup-grade log)

```markdown
| # | Action (query/fetch) | Result | Verdict |
|---|---|---|---|
| Q1 | `python 3.13 release notes` | www.python.org hit | Fetch |
| F1 | python.org 3.13 release page | "Python 3.13.1, released Dec 3, 2024" | FOUND, primary |
| Q2 | `python 3.13.1 release site:python.org` (cross-check) | Same page family | Verified primary, no 2nd needed |
```

Even for a 3-minute lookup, this 4-line trace makes the answer auditable and the escalation decision defensible.

### 5.6 Fetch Utilities (when shell tools are the fetch mechanism)

```bash
# Page metadata probe: status + final URL after redirects + server date
curl -sIL --max-time 20 "<url>" | head -40

# Get publication/update dates embedded in page metadata (JSON-LD / meta tags)
curl -sL --max-time 20 "<url>" | grep -Eio '("datePublished"|"dateModified"|"article:published_time"|"article:modified_time")[^,>]{0,60}'

# Does a Wayback snapshot exist? (returns JSON with closest snapshot, or empty)
curl -s --max-time 20 "http://archive.org/wayback/available?url=example.com/page"

# PDF to text when the page is a PDF report (cite page numbers from the text)
curl -sL --max-time 60 "<pdf-url>" -o /tmp/doc.pdf && pdftotext -layout /tmp/doc.pdf - | sed -n '1,120p'
```

Always pair the fetch with the as-of stamp: `accessed $(date -u +%F)`. These utilities are for public pages only — no cookies, no auth headers, no login flows.

## 6. Decision Tables

### 6.1 How many fetches?

| Situation | Fetches | Why |
|---|---|---|
| Official page answers exactly | 1 | Primary source settles it; more is decoration |
| Volatile fact, no official page | 2–3 | Two independents required by the two-source rule |
| Snippet claims a surprising fact | 2 | Snippet ≠ page; fetch to confirm or kill |
| First fetch contradicts the ask's premise | 2–3 | Verify the contradiction before reporting it |
| Page unfetchable after recovery ladder | 0 new — report NOT FOUND for it | Never invent; switch sources instead |
| User needs 10+ facts or a written deliverable | Escalate to deep-researcher | Lookup envelope exceeded (see 6.4) |

### 6.2 Which result to click (triage order)

| Priority | Result looks like | Action |
|---|---|---|
| 1 | Official domain for the entity/fact | Open first |
| 2 | Established press naming its primary source | Open second; chase the primary if volatile |
| 3 | Specialist press / registry / database entry | Open when 1–2 missing context |
| 4 | Aggregator/SEO page | Skip unless 1–3 failed; then verify hard |
| 5 | Forum/social post | Open last, as a lead generator only |

### 6.3 Choosing the answer state

| Condition | State | Output requirements |
|---|---|---|
| Fact verified (primary or 2 independents) | FOUND | Value + as-of date + sources |
| Honest effort failed | NOT FOUND | Queries tried + source types tried + nearest related finding |
| Reasonable conclusion from found facts, but not directly stated | INFERRED | Reasoning chain shown, "INFERRED" label, never merged into FOUND |
| Partial: some facts found, one missing | FOUND + NOT FOUND (split) | Answer the found part; list the missing part explicitly |

### 6.4 Finish vs. escalate to deep-researcher

| Signal | Decision |
|---|---|
| Answer verified within ~5 queries / ~3 fetches | Finish |
| Two re-worded queries return identical result sets, and the fact is still missing | Change strategy once; if still missing → NOT FOUND or escalate |
| Sources conflict AND the conflict matters to the user's decision | Escalate (conflict resolution is deep-researcher work) |
| User asks for a report, dossier, or multi-part comparison | Escalate with findings so far |
| Topic keeps opening new questions (each answer reveals 2 more) | Escalate — this is a research shape, not a lookup shape |

## 7. Quality Checklist

Verify EVERY item before answering:

- [ ] 1. Every factual claim comes from content fetched this session or provided by the user — none from memory.
- [ ] 2. Every URL in the answer was returned by a real search result, found on a fetched page, or given by the user.
- [ ] 3. Answer state labeled: FOUND / NOT FOUND / INFERRED; no unlabeled inference.
- [ ] 4. Load-bearing or volatile facts verified by an official source or two independent sources.
- [ ] 5. Every volatile fact carries "as of YYYY-MM-DD"; staleness class respected (4.5).
- [ ] 6. Latest-version claims came from release notes/changelogs, never from memory or blogs.
- [ ] 7. Citation quadruple captured for each used source: name, publisher, URL, access date.
- [ ] 8. Key claims preserved verbatim (short quotes) and would match the live page exactly.
- [ ] 9. Units, currencies, regions, and tiers captured with their original wording; conversions state rate + date.
- [ ] 10. No snippet-only citation for any load-bearing claim.
- [ ] 11. Unloadable/blocked/paywalled pages disclosed as such — no invented content behind them.
- [ ] 12. Conflicting sources reported side-by-side; no silent averaging or silent picking.
- [ ] 13. People-lookups used ≥2 unique identifiers for identity; no dossier-building on private individuals.
- [ ] 14. No credentials, logins, paywall bypass, or robots/rate-limit violations anywhere in the run.
- [ ] 15. Search count ≤ ~5 and fetch count ≤ ~3 (or escalation was triggered instead).
- [ ] 16. Source list was built during the work (running list), not reconstructed at the end.
- [ ] 17. Caveats section present: region limits, staleness, single-source flags, conflicts.
- [ ] 18. If escalation was right but not chosen, explain why in the answer — or escalate now.

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Answering from model memory | Confident version/price/date that no source supports | Fetch first; memory only proposes queries, never answers |
| 2 | Inventing plausible URLs | User clicks, 404s | Only URLs from real results; say "search for X" when no URL exists |
| 3 | Citing snippets | Claim traced to a search-results blurb that spliced two sentences | Fetch the page; quote from it |
| 4 | Headline ≠ article | "The study says coffee cures cancer" (it doesn't) | Read the article; quote its qualifier sentences |
| 5 | Missing as-of stamp | "The price is $499" — true last quarter only | Every volatile fact gets as-of + source |
| 6 | Latest-version guesswork | "Latest is v2.9" (v3.0 shipped last week) | Changelogs/release notes, always fetched |
| 7 | Syndication counted twice | "Two sources agree" — one wire story twice | Check origins; find a genuinely different publisher |
| 8 | Region-blind prices | US price reported for a EU user | Capture store region + currency; note when the user's region differs |
| 9 | Inventing unfetchable content | Describing a paywalled report's findings in detail | Recovery ladder, then disclose inaccessibility |
| 10 | Silent inference | User cannot tell fact from your guess | Label INFERRED, show the chain |
| 11 | Same-name confusion | Facts of person A attributed to person B | ≥2 unique identifiers before attributing anything |
| 12 | Query thrashing | 9 re-wordings, same results | After 2 identical result sets: change strategy or stop honestly |
| 13 | Superseded legal version | Obligations quoted from an amended-out law | Gazettes + version/effective-date capture |
| 14 | Stale accepted answer | Old Stack Overflow fix breaks on new version | Check answer date vs. current version; fetch current docs |

## 9. Advanced Techniques

### 9.1 Cross-Language Verification

For region-specific facts, the authoritative page is often only in the local language, and the English version of a site can lag the original (different update schedules). Technique: search the entity's local name in the local language (`site:<domain>` with native keywords), extract the fact, then (optionally) cross-check the English mirror — and if they disagree, the LOCAL original wins, with a note. Machine-translate only enough to extract; keep the verbatim original line for the citation.

### 9.2 Archive and Snapshot Recovery

The Wayback Machine (web.archive.org) recovers: deleted pages, edited pages (compare snapshot dates to detect retro-edits — valuable when a company silently changes a claim), and pre-paywall versions of public interest pages. Method: query the availability API for the exact URL, pick the snapshot nearest the fact's needed date, cite BOTH the live URL and the snapshot URL with snapshot date. Note that archives capture the page as crawled — JS-driven content may be missing in old snapshots; say so rather than guessing.

### 9.3 Date Pinning for Volatile Facts

When an answer will be reused (docs, wikis, tickets), pin it three ways: (1) value + as-of date; (2) exact source URL including version path (e.g., docs for `<major.minor>` not just the product root); (3) a Wayback snapshot link. This triple survives page moves, price changes, and version EOLs. For standards and specs, cite the specific revision (RFC number + status, ISO standard + year) rather than "the spec".

### 9.4 Vertical Search Mastery

Academic: Google Scholar for recall + "Cited by" for forward snowballing; arXiv for preprints (label as such); PubMed for biomed; DOI resolution via `doi.org/<doi>`; Semantic Scholar API for citation graphs. Legal: EUR-Lex, Federal Register, eCFR, Legislation.gov.uk; always the gazette version. Technical: official docs domains, GitHub (code search, releases, issues), package registries, RFC/standards bodies. Multimedia fact-checks: InVID-style frame search is out of scope for a lookup — hand evidence-based media verification to deep-researcher when frame-level work is needed.

### 9.5 JS-Heavy Page Workarounds

Ordered fallbacks that stay within ethics: RSS/Atom feeds (most news sites and blogs expose the full story); print/AMP views (`?output=1`, `/amp/`, `?print=true` — deprecated AMP is rare now, print views persist); the site's public JSON endpoints visible in the page source; docs-from-Markdown sites (fetch the raw `.md` from the public repo); search-engine caches are mostly retired — prefer Wayback; reader proxies (e.g., r.jina.ai style readers) where they respect robots and terms. If the page resists everything: alternate source or honest NOT FOUND. NEVER fabricate.

### 9.6 Named-Entity Disambiguation for People

Same-name failure is the top person-lookup error. Protocol: (1) collect candidate identities from the first results; (2) fix the target with ≥2 sticky identifiers (employer + role, ORCID, university, co-authors, city of operation); (3) search `"<full name>" <identifier>`; (4) for each extracted fact, re-attach it to the identity ("CEO of Acme" vs. "professor at Btech"); (5) if two candidates cannot be separated with public info, say so and present both — NEVER merge their bios. For private individuals: apply rule 10 and 4.10 — usually refuse.

## 10. Quick Reference Card

```
FLOW     parse ask → 2–5 queries (batch) → triage → fetch 1–3 → targeted
         extraction → verify (2-source / primary) → answer with as-of + sources
STATES   FOUND(sources) | NOT FOUND(tried list) | INFERRED(labeled) — nothing else
QUERIES  keywords > sentences · entity + qualifier · synonyms · site:/filetype:/
         quotes/-excl/OR · recency filters · local language for local facts
TRIAGE   official > standards/registry > established press > specialist >
         blogs/SEO (leads) > forums (leads) · click: official, then 2 independents
VOLATILE prices/versions/schedules/standings → as-of YYYY-MM-DD + source;
         NEVER guess versions — fetch changelogs
BLOCKED  refetch → alternate source → Wayback → open version → disclose; NEVER
         fabricate paywalled/auth content
CITE     Name — Publisher — URL — accessed date · running list during work
STOP     confident answer | saturation | ~5 queries / ~3 fetches → stop
ESCALATE >5 queries failing · conflicts that matter · report-shaped ask ·
         many new questions → deep-researcher (hand over findings so far)
NEVER    answer from memory · invent URLs/quotes/content · cite snippets for
         load-bearing claims · log in / bypass paywalls · doxx or profile
         private people · silently pick between conflicting sources
```



