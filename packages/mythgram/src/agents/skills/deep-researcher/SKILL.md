---
name: deep-researcher
description: >-
  Deep-researcher is a multi-source, multi-hop research engine that converts a
  vague request into an evidence-graded report. It plans research modes and
  budgets, engineers researchable sub-questions, runs iterative multi-wave
  search strategies (query matrices, citation snowballing, entity-following),
  applies a strict source hierarchy and two-independent-source verification
  protocol, normalizes units and statistics, and synthesizes everything into a
  structured deliverable where every load-bearing claim carries a source, an
  access date, and an explicit High/Medium/Low confidence grade. Use this
  whenever the user asks to "do deep research on X", "write a report on X",
  "research the market/landscape/competitors for X", "compare options with
  evidence", "review the literature on X", "investigate what happened with X",
  "build a fact base before a decision", "map the supply chain / regulatory
  environment / funding history of X", or "produce a briefing document with
  sources". Use this for any question requiring more than a handful of
  searches, multiple waves of investigation, triangulation across conflicting
  sources, or a formal methodology section. Do NOT use for quick single-fact
  lookups, prices, definitions, or one-page verifications — that is
  web-researcher's job. Do NOT use for analyzing a dataset the user has
  already provided (no external discovery needed) — that is information-
  analyst's job. Do NOT use for choosing between options the user already
  understands (deciding, not discovering) — that is problem-solver's job.
---
# Deep Researcher

> Multi-source, multi-hop investigation that turns a vague question into an evidence-graded report where every load-bearing claim is verified, labeled, and traceable.

## 0. Operating Rules (Non-Negotiable)

1. NEVER state an unverified fact as fact. Every load-bearing claim in the deliverable MUST carry a source and an access date. Reason: a research report is a trust artifact; one fabricated number destroys the value of the entire document.
2. NEVER invent quotes, numbers, dates, titles, URLs, or citations. If a needed datum was not found, the report MUST say "NOT FOUND after searching X, Y, Z" and list what was tried. Reason: "not found" is an honest, useful result; an invented datum is a defect the user cannot detect.
3. Apply the two-independent-source rule to every load-bearing fact. Two sources are independent ONLY if they have different publishers AND do not visibly share origin (no syndication, no citing-each-other, no common press release as ultimate source). Reason: the same wire story republished twice looks like corroboration but is one source.
4. Label every non-fact statement. The deliverable MUST visibly distinguish FACT (sourced), ESTIMATE (source + method), INFERRED (reasoning shown), and OPINION/ASSESSMENT (flagged). Reason: decision-makers act differently on a fact vs. an inference; unlabeled blending is how bad analysis hides.
5. Declare scope fences BEFORE searching (time window, geography, segment, currency, units) and NEVER let a search result quietly widen them. Reason: research drift — following interesting-but-irrelevant leads — is the number-one budget killer.
6. Report conflicts, do not resolve them silently. When sources disagree and the resolution order (primary > methodology-visible > more recent > more reputable) cannot settle it, the report MUST present the range with all sources and the reason for the disagreement. Reason: silent selection manufactures false certainty.
7. NEVER exceed the declared budget (searches, fetches, waves) without telling the user why. If budget runs out with gaps open, the report MUST list the gaps. Reason: an infinite task is a failed task; budgets force saturation discipline.
8. Prefer primary sources. Secondary sources MAY lead you to facts, but every load-bearing number MUST be traced to the primary producer (statistical bureau, central bank, regulator, company filing, original paper) whenever it exists. Reason: every re-publication step adds error and framing.
9. Preserve uncertainty in the deliverable. Confidence grades (High/Medium/Low), ranges, and open questions are FIRST-CLASS content, not footnotes. Reason: the reader's decision quality depends on knowing which parts are soft.
10. NEVER fabricate access to paywalled or blocked material. You MAY describe what a paywalled item covers only from its legally visible metadata (title, abstract, snippet). Reason: fabricating paywalled content is indistinguishable from lying.
11. Keep a research trace (query → hit → verdict → finding) from the first search. The Methodology section of the report is written FROM this trace, never reconstructed from memory. Reason: reconstructing after the fact produces invented queries and fake citations.
12. Stop at saturation or budget exhaustion — whichever comes first. Saturation = 2–3 consecutive queries on the same sub-question return only already-known information. Reason: diminishing returns are real; a fifth wave rarely adds a load-bearing fact.

## 1. When to Use / When Not To

Use deep-researcher when the task needs **discovery across many sources** and a **defensible written product**:

- "Write a report on the EV charging market in Europe" — market study, many sources, needs methodology.
- "What do analysts, filings, and regulators say about company X's exposure to Y?" — multi-source triangulation.
- "Review the literature on Z since 2020" — citation snowballing, source grading.
- "Build me a fact base / briefing doc before I decide between A, B, C" — evidence-grade comparison.
- "Investigate the timeline and causes of incident E" — multi-hop entity-following (news → filings → court records).
- "What are the competing estimates for K, and why do they differ?" — conflict resolution and normalization.
- Any question that needs 10+ searches, multiple search waves, or a Sources section.

Do NOT use when:

- The user needs one fact, one price, one version number, or a quick verification — web-researcher.
- The user provides a dataset to analyze (CSV, logs, metrics) — information-analyst.
- The user wants a recommendation or decision given known options — problem-solver.

### Routing table

| Situation | Correct skill | Why |
|---|---|---|
| "What is the latest version of X?" | web-researcher | Single lookup, answer in minutes |
| "Is this claim true?" (single claim) | web-researcher | Two-source check, short answer |
| "Analyze this CSV of sales data" | information-analyst | Data is provided; no external discovery |
| "Should we enter market M given this analysis?" | problem-solver | Deciding on known facts, not discovering |
| "Is our market growing? Produce a sourced report" | deep-researcher | Discovery + triangulation + report |
| "How do these 5 vendors compare? Cite everything" | deep-researcher | Multi-source, evidence-graded deliverable |
| "Find any public info about person P" (quick) | web-researcher | Few searches; check privacy rules first |
| "Full background dossier with verification trail" | deep-researcher | Multi-wave, graded, methodical |

deep-researcher MAY call web-researcher-style quick lookups as subroutines inside a wave; web-researcher MUST escalate to deep-researcher when the question turns out to need more than ~5 searches or two-source verification keeps failing.

## 2. Core Concepts & Mental Models

**Researchable question.** A question is researchable if a document that could exist would answer it. "Tell me about the EV market" is not researchable. "What was the EU battery-electric vehicle registration share in calendar year 2024, per ACEA?" is. Research quality starts here: non-researchable questions produce unanswerable reports.

**Research question vs. decision question.** A research question asks what is true (discovery). A decision question asks what to do (judgment). This skill delivers the former; if the user actually wants the latter, end the report with "decision implications" but NEVER pretend research settles a values trade-off. Overlap belongs to problem-solver.

**Scope fences.** Explicit boundaries fixed before wave 1: time window (e.g., 2021-01-01 to 2025-06-30), geography (EU-27, not Europe), segment (battery-electric only, exclude hybrids unless noted), currency and units (EUR, GWh; nominal, current prices), language set (English, German, French). Every fence you skip will cost triple later in normalization and arguments.

**"What would change the user's decision?" test.** Rewrite the ask around the pivot: the specific unknown that would flip the user's action. Research time flows to pivot variables first. If nothing would change the user's action, say so and renegotiate the deliverable.

**Hypothesis-driven vs. exploratory.** Hypothesis mode converts a user belief into a falsifiable claim and actively hunts disconfirming evidence ("the market is consolidating" → seek counter-examples). Exploratory mode maps terrain when no hypothesis exists (systematic scanning: regulators, trade press, incumbents, challengers, academia). Every hypothesis MUST get a disconfirmation pass; every exploratory scan MUST have a coverage checklist so gaps are visible.

**Load-bearing fact.** Any claim that, if wrong, would change a conclusion or recommendation in this report. Load-bearing facts are subject to the two-independent-source rule, primary-source preference, and explicit confidence grading. Non-load-bearing color MAY rest on a single decent source, labeled as such.

**Independence and triangulation.** Three independent, agreeable sources (one primary, two secondary) beat ten echoes. When triangulating, count *origins* of information, not *documents*.

**Multi-hop chains.** Deep research is often a chain: company → its filings → a customer-concentration disclosure → that customer's end-market demand. Each hop MUST be verified and logged; a chain is as weak as its weakest verified link, and the report shows the chain.

**Confidence vs. certainty.** Confidence grades the *evidence base* (source quality, independence, consistency), not the speaker's courage. High = 2+ independent sources incl. a primary, no unresolved conflict, definitions aligned. Medium = 1–2 independent secondary sources, or definitions not fully aligned. Low = single source, aging data, definitional mismatch, or unresolved conflict.

**Budget.** The declared number of searches, fetches, and waves for the chosen mode, written down before wave 1. Budgets are renegotiable with the user but never silently exceeded.

**Saturation.** The point where new queries return only known information. Saturation, not exhaustion of curiosity, is the healthy stop signal.

## 3. Mandatory Workflow

Follow these 12 steps in order. Skipping a step is allowed only when it is explicitly marked optional, and the skip must be noted in the Methodology section.

1. **Triage the request (routing check).** Confirm the task is discovery-heavy: multiple sources, unknown facts, a written deliverable. If it is a single-fact lookup → hand to web-researcher; if a provided dataset → information-analyst; if a pure decision → problem-solver. NEVER run a 30-search deep dive on a question web-researcher answers in two searches — it wastes the user's budget.
2. **Run the decision test.** Ask: what would change the user's action? Write one sentence: "This report matters because the user will ___, and the pivot is ___." MUST get an answer (or state the report is exploratory). Reason: every hour spent on non-pivot facts is budget stolen from pivot facts.
3. **Set the scope fence.** Fix and write down: time window, geography, segment, currency, units, language set, and what is explicitly OUT of scope. NEVER let a search result widen scope silently — if a fence must move, note it in Methodology ("scope widened to include PHEVs because regulatory data merges them").
4. **Choose the mode and budget.** Select BRIEF / STANDARD / DEEP (see 4.1) and declare: number of waves, search budget per wave, fetch budget, deliverable template. NEVER start searching before this is written down. Reason: mode choice determines depth of verification and report length; starting "to see what's out there" drifts.
5. **Engineer the questions.** Decompose the ask into 4–10 researchable sub-questions, each answerable by a document that could exist. Tag each as [FACTUAL], [DEFINITIONAL], or [SYNTHETIC]. Mark which sub-questions are load-bearing (they feed conclusions) vs. contextual. NEVER leave the user's original phrasing as a search target — it is a topic, not a question.
6. **Build the query matrix.** For each sub-question, generate candidate queries: entity × synonym × language × facet (regulation, market size, pricing, competitors, risks, timeline). Include the language variants of key geography-specific entities. Expect to use 40–70% of queries; the matrix is ammunition, not obligation. ALWAYS log every actually-executed query with date and verdict.
7. **Execute wave 1 (breadth).** Run batches of independent queries; triage results by source hierarchy (4.4); fetch the best 5–10 pages; extract candidate facts with title/publisher/date/URL captured at fetch time. NEVER cite from snippets alone for load-bearing facts — snippets truncate and mislead; fetch or drop to lower confidence.
8. **Chase primaries.** For every load-bearing number, attempt one hop upstream: press article → press release → official filing/statistical table. For academic claims: paper → dataset/method section. Stop chasing when the marginal hop adds no new origin (you reached the producer). NEVER accept a secondary citation of a primary you could have opened in two clicks — open it.
9. **Verify.** Apply the two-independent-source rule to every load-bearing fact; classify FACT / ESTIMATE / INFERRED / OPINION; resolve conflicts with the order in 4.6; log every unresolved conflict for the report's Contradictions section. NEVER delete a contradicting source because it is inconvenient — the contradiction is a finding.
10. **Synthesize.** Build the deliverable's spine: thematic clusters, timeline, comparison matrix, driver analysis, scenario framing (choose frameworks fitting the question; see 4.9). Write Key Findings in claim → evidence → source → confidence form. NEVER write analysis paragraphs before findings exist — findings first prevents narrative capture (bending facts to a story you already told).
11. **Gap analysis → wave 2/3.** After synthesis, list gaps (load-bearing fact with 0–1 independent sources; one-sided coverage; missing definitional alignment). Run targeted waves only for these gaps. Stop at saturation (2–3 consecutive queries returning known info) or budget exhaustion. NEVER run an untargeted wave 2 — "more of the same" searches are how budgets die without adding confidence.
12. **Assemble and check.** Produce the report in the exact template order (4.10), write Methodology from the research trace, list Sources, run the Quality Checklist (section 7), and deliver. NEVER deliver without the checklist pass — every unchecked box is a defect shipped silently.

## 4. Deep Knowledge Library

### 4.1 Research Modes, Budgets, and Deliverables

| Mode | Waves | Search budget | Fetch budget | Deliverable | Typical wall-clock (agent) |
|---|---|---|---|---|---|
| BRIEF | 1–2 | 3–6 queries | 3–6 pages | Research brief, 1–2 pages, 5–12 sources | minutes |
| STANDARD | 2–3 | 10–20 queries | 10–18 pages | Full report, 5–12 pages, 15–40 sources | tens of minutes |
| DEEP / literature review / market study | 3+ | 30+ queries | 25+ pages | Full report + annotated source list + methodology appendix | hour-scale, may be split across sessions |

Mode selection rule: pick the CHEAPEST mode that satisfies the decision test. If unsure, start STANDARD; escalate to DEEP only when wave-1 gaps are load-bearing. NEVER start DEEP by default — depth without a pivot wastes the budget that verification needs.

### 4.2 Question Engineering

Decomposition patterns that cover most requests:

- **Entity anatomy:** any entity (company, technology, country, policy) decomposes into: definition & scope → market/size/scale → key players → regulation/policy → economics/costs → risks → timeline/momentum → contrarian views.
- **Comparison anatomy:** A vs. B decomposes into: comparable dimensions (MUST be identical across entities), each entity's evidence per dimension, definitional alignment check, and the weight question (which dimension matters to the user's decision).
- **Trend anatomy:** "is X growing" decomposes into: metric definition (what counts as X), baseline value + date, latest value + date, growth rate, revision history, and disagreement between sources.
- **Causality anatomy:** "why did X happen" decomposes into: timeline of events, candidate causes with proponents, evidence per cause, and what evidence would rule a cause out.

Falsifiability check for every sub-question: write what evidence would answer it YES and what would answer it NO. If you cannot name both, the question is not yet researchable — rephrase.

Question tags: [FACTUAL] answerable by a document (statistic, date, spec); [DEFINITIONAL] answerable by an authoritative definition (standard, law, methodology note); [SYNTHETIC] only answerable by combining facts (market structure, trend judgment). Synthetic answers MUST show their constituent facts; NEVER present a synthesis as if it were a sourced fact.

### 4.3 "What Would Change the Decision" Test

Procedure: (1) State the user's likely action. (2) List the 2–5 unknowns that could flip that action. (3) Convert each into a sub-question with priority P1 (decision-critical) or P2 (context). (4) Allocate ≥60% of wave-1 budget to P1 items. Example: "tell me about the EU EV market" + user is deciding whether to build charging infrastructure → pivot unknowns are: current charging-station density vs. fleet size, utilization economics, planned regulation (AFIR build-out mandates), grid connection lead times — NOT consumer brand preferences. The original vague ask survives as a P2 context paragraph.

### 4.4 Source Hierarchy and Authority Signals

Tier hierarchy, strongest first:

| Tier | Examples | Use as |
|---|---|---|
| T1 Primary | Statistical bureaus (national stats offices, Eurostat), central banks, regulators (SEC/EDGAR, EU Official Journal, national gazettes), company filings (10-K/20-F/annual reports), original papers (arXiv, PubMed, DOI), court records, official datasets, standards bodies (ISO, IEEE) | Load-bearing facts MUST end here when a primary exists |
| T2 Secondary | Quality journalism (FT, Reuters, Bloomberg, AP, major national papers), peer-reviewed reviews, respected analyst firms (with methodology visible), NGO/association reports with published method | Leads, corroboration, interpretation |
| T3 Tertiary | Aggregators (Statista, TradingEconomics), encyclopedias (Wikipedia), content farms, forums | NEVER load-bearing; use as leads and keyword mines only |

Authority signals checklist (the more, the higher the trust): named accountable author or publisher; methodology section present; data and sources disclosed; publisher's core business creates accountability for accuracy (statistical bureau, regulator, peer-reviewed journal); correction policy visible; domain ownership matches claimed publisher (beware lookalike domains); for companies: official IR domain; for papers: DOI resolves.

Date weighting rules: for volatile facts (market size, prices, shares) prefer the newest credible figure and ALWAYS state the period it refers to. Keep one historical baseline per trend to anchor direction ("X was 120 in 2019, 185 in 2024"). NEVER mix "latest value" with "baseline from another definition" — that manufactures fake growth. Older sources remain superior for: original definitions, historical events, retractions, and "what did people believe then."

### 4.5 Entity-Following and Multi-Hop Chains

Standard entity chains: company → regulator filings → court records → press; product → official changelog → issue tracker → maintainer statements; policy → gazette text → implementing acts → national transpositions → enforcement cases; market → trade association stats → top-3 company filings (capacity/revenue cross-checks) → logistics/customs data.

Chain rules: (1) log every hop with source; (2) verify intermediate facts independently — a chain of unverified hops is rumor with structure; (3) when a hop fails (filing doesn't mention it), that failure is a finding, not an inconvenience; report the broken chain. (4) A chain of length ≥3 MUST be drawn explicitly in the report ("Filing A discloses customer concentration 40%; customer B's public guidance implies category contraction; therefore exposure is negative" — each arrow carries its citation).

### 4.6 Verification Protocol and Conflict Resolution

Two-independent-source rule details: independence = different publishers AND different origin of information. Syndicated wire copy (Reuters/AP/Bloomberg republished) is ONE source. Press releases quoted by newspapers are ONE source. Two analysts citing the same underlying dataset are ONE source. Genuine independence examples: national statistics bureau + company filing; peer-reviewed paper + regulator report; two field studies with different samples.

Conflict resolution order — apply strictly:
1. **Primary beats secondary.** Bureau table beats newspaper citing the bureau.
2. **Visible methodology beats hidden methodology.** Report with sampling frame and definitions beats headline-only survey.
3. **More recent beats older** — but only within the SAME definition (if definitions differ, resolve by definition first).
4. **More reputable/professional beats less** — accountability, correction history, domain expertise.
5. **If still unresolved:** report the range with every source, definition, and period; state what evidence would resolve it; flag in Contradictions section. NEVER silently pick the number that fits the narrative.

Label rubric (applies to every statement in the deliverable):
- **FACT:** two independent sources or one primary source; period and definition stated.
- **ESTIMATE:** a source publishes it as an estimate/forecast; keep their qualifier ("company projects 30% CAGR 2025–2030") and NEVER restate it as fact.
- **INFERRED:** your reasoning from labeled facts; show the chain; never taller than the facts (inference must not outrun evidence).
- **OPINION/ASSESSMENT:** your or a source's judgment without decisive evidence; mark it, keep it minimal in findings.

### 4.7 Quantitative Discipline: Official Statistics First

Before using ANY secondary number, look for the primary producer:

| Domain | First-stop primary sources |
|---|---|
| Macro economy | national statistics bureaus; IMF WEO (imf.org); World Bank Open Data (data.worldbank.org); OECD Data (oecd.org); Eurostat (ec.europa.eu/eurostat) |
| Trade | UN Comtrade (comtradeplus.un.org); national customs offices; WTO |
| Health | WHO Global Health Observatory (who.int/data/gho); OECD Health Statistics; national health ministries |
| Labor | ILOSTAT (ilostat.ilo.org); national labor statistics offices |
| Energy | IEA (iea.org); IRENA; national energy ministries; Eurostat energy |
| Finance/monetary | central banks (Fed FRED, ECB Data Portal, BoE); BIS; national regulators |
| Companies | SEC EDGAR (sec.gov/edgar) for US-listed; SEDAR+ for Canada; national company registries; investor-relations pages for IR decks and earnings transcripts |
| Agriculture/food | FAO (FAOSTAT); USDA (usda.gov) |
| Climate/emissions | EDGAR (EU JRC); Global Carbon Project; UNFCCC |
| Population | UN Population Division; national censuses |
| Standards/tech | ISO, IETF, IEEE, W3C official registries |

Normalization rules:
- **Calendar vs. fiscal year:** Apple's "2024" ends September 2024; Microsoft's June; retailers' January/February. NEVER compare a fiscal 2024 to a calendar 2024 without a note; align periods before comparing.
- **Nominal vs. PPP:** use PPP for cross-country living-standards or volume comparisons; use nominal (market exchange rates) for market-value and revenue comparisons. State which one every figure uses.
- **Current vs. constant prices:** growth rates across years MUST be constant-price (real) or explicitly nominal; mixing them inflates growth by inflation.
- **Currency:** convert at the rate of the period the data refers to (not today's rate) or use the source's own constant-currency figures; state rate and date.
- **Per-capita / per-GDP normalization:** for cross-country comparisons, prefer intensity measures (GDP per capita, emissions per capita, healthcare cost per capita) over absolutes; always keep the absolute in a footnote for scale.
- **Definitional variance:** unemployment (ILO harmonized vs. national claimant counts — can differ by multiple points), poverty lines (national vs. World Bank $/day PPP lines), R&D definitions (Frascati vs. company accounting), inflation baskets (CPI vs. HICP), patent counts (applications vs. grants; office vs. origin). When definitions differ, show series separately with their definitions; NEVER merge or implicitly compare them.
- **Rounding:** keep the source's precision for single figures; round sensibly in comparisons; NEVER invent precision ("about 47.3%" from a source that said "roughly half" is fabrication).

### 4.8 Bias Detection

Systematic bias screen for every source that feeds a finding (log verdicts in the source log):

- **Funding bias:** who pays for the source? Industry association reports tend to favor industry; NGO reports emphasize the problem; vendor "market reports" inflate their segment. You do not need to discard biased sources — you need to weight and note them.
- **Framing bias:** does the piece frame the same datum differently than the primary source? Compare headline vs. table ("shipments down 8% YoY" vs. "shipments up 40% vs. depressed 2023" can both be true).
- **Selection bias:** which facts does the source omit? A report on a technology that never mentions costs, or a country profile that never mentions dissent, is marketing. ALWAYS search once for the strongest counter-position ("criticism of X", "X failure cases", "X fraud") before accepting a narrative.
- **Loaded language / affect:** emotive adjectives, disaster/revolution framing, unattributed superlatives — downgrade trust and re-verify the underlying numbers.
- **Self-interest in forecasts:** company guidance, trade-body projections, and paid analyst notes have systematic directional incentives; treat as ESTIMATE with incentive noted.
- **Sourcing bias (yours):** if all your sources are English-language and from two countries, say so in Methodology. Monolingual sourcing is a limitation, not a neutral choice. Translate key entity names and re-search in relevant languages (e.g., "battery passport" → Batteriepass; "wind turbine" → Windkraftanlage).

### 4.9 Synthesis Frameworks

Choose frameworks that fit the question; a STANDARD report typically uses 2–3:

- **Thematic clustering:** group evidence into 3–6 themes; every theme needs ≥2 independent sources or 1 primary; orphan evidence (fits no theme) is either a gap or a new theme — never discard silently. Present themes ordered by relevance to the pivot.
- **Timeline construction:** dated events, each with source; use for incidents, policy rollouts, company history; ALWAYS separate "event date" from "reporting date" (news reported a day later; revisions come months later).
- **Compare-contrast matrix:** rows = entities, columns = decision-relevant attributes; identical definitions per column across rows; each cell carries its source; empty cells stay empty with "n/a — not disclosed" rather than guessed.
- **Pro/con with evidence weights:** list supporting and opposing evidence for the key question; weight each item by source tier and independence; the conclusion states which side the weight supports and what would flip it.
- **Driver analysis:** decompose a trend into demand drivers, supply drivers, regulatory drivers, technology drivers; each driver gets direction (+/−), magnitude evidence, and confidence. This structure survives follow-up questions far better than prose.
- **Scenario framing (base/bull/bear):** base = current trends plus announced policy; bull = upside levers (adoption acceleration, cost breakthroughs, new segments); bear = downside levers (regulatory reversal, macro contraction, substitution). Each scenario MUST list its 3–5 assumptions, each assumption tagged to a source or marked ASSUMPTION. NEVER assign numerical probabilities without a sourced base rate — use qualitative likelihood language instead.
- **Steelman pass:** write the strongest version of the position you did NOT adopt, with its best evidence. If you cannot steelman the opposition, you have not researched the question — search again.

### 4.10 Report Architecture (Exact Template)

The deliverable MUST follow this order. Sections may be expanded but never dropped or reordered:

```
# <Title> — <scope fence in one line>
## Executive Summary
BLUF: 1 sentence answering the question. Then ≤5 bullets, each ≤2 lines, each traceable to a Key Finding number. A reader who stops here must get the decision-relevant answer plus confidence.
## Key Findings
Numbered F1, F2, ... Each finding:
- **Claim** (one sentence, labeled FACT/ESTIMATE/INFERRED)
- **Evidence** (the specific datum: value, period, definition)
- **Source** ([S3], publisher, access date)
- **Confidence:** High / Medium / Low (rubric in 5.3)
## Analysis
2–5 sections using synthesis frameworks; every paragraph cites its findings (F1, F3) rather than restating raw claims.
## Contradictions & Open Questions
Every unresolved conflict (with both sources), every NOT-FOUND result, every assumption that would change conclusions if wrong.
## Methodology
Mode and budget; waves run; query count; sources tried and failed; scope changes; limitations (language coverage, paywalls, data vintage).
## Sources
[S1], [S2], ... each: Title — Publisher — URL — publication date (or n.d.) — access date — type (primary/secondary/tertiary).
```

### 4.11 Iteration Discipline and Saturation

Gap register after each wave: for every gap record (a) the missing item, (b) why it is load-bearing or not, (c) queries already tried, (d) next-best query or source type. Wave 2 runs ONLY against this register — targeted searches, not generic repeats.

Stopping rules: stop when (1) every load-bearing fact has ≥2 independent sources or a primary + explicit low-confidence flag; (2) two consecutive targeted queries per gap return only known information (saturation); or (3) budget is exhausted. On budget exhaustion, the report MUST carry a "What further research would add" paragraph — honesty about limits is part of the deliverable, never an optional extra.

Diminishing-returns rule: if a full wave produces zero new load-bearing facts, terminate. NEVER continue "for completeness" — completeness is not achievable, only saturation is.

### 4.12 Ethics: Attribution, Paywalls, Limitations

- **Attribution:** name the publisher of every borrowed idea, not just every quoted sentence. Paraphrase with citation, never paraphrase-as-own-words.
- **Quote limits:** short verbatim quotes only (a sentence or two), always in quotation marks with source and link. NEVER reproduce long excerpts of copyrighted text.
- **Paywalls:** you MAY cite a paywalled work's title, author, abstract, or visible snippet, and describe what it claims IF that metadata is legally visible to you. NEVER pretend to have read the full text; NEVER fabricate its content; say "paywalled, not accessed; abstract indicates X."
- **Leak/rumor material:** may be reported only with attribution ("according to X reporting, unconfirmed"), labeled ESTIMATE/UNVERIFIED, and never used as a load-bearing fact.
- **Correction duty:** if an error is found after delivery, correct it prominently, not silently.
- **Limitations disclosure:** every report states its limits — language coverage, source availability, paywall barriers, data vintage. A limitation omitted is a defect hidden.

## 5. Code & Tool Templates

### 5.1 Query Plan Template (write before wave 1)

```markdown
# Query Plan — <topic> — <mode: BRIEF/STANDARD/DEEP>
Scope fence: time <...> | geography <...> | segment <...> | currency/units <...> | languages <...>
Decision test: The user will <action>. Pivot unknowns: <U1, U2, U3>.

| # | Sub-question | Tag | Priority | Candidate queries (entity × synonym × language × facet) | Best expected source |
|---|---|---|---|---|---|
| Q1 | <What is X's market size in <geo>, <period>? > | FACTUAL | P1 | "X market size" OR "X TAM" 2024 site:*.gov OR site:eurostat; "<X> <local-term> Markt" | National stats bureau; association report |
| Q2 | <Who are the top players and shares?> | FACTUAL | P1 | "X market share 2024"; "<top company> revenue segment filing" | Filings; association stats |
| Q3 | <What regulation applies from <year>?> | FACTUAL | P1 | <regulation name> site:official-journal-domain; "<regulation> guidance" | Gazette; regulator FAQ |
| Q4 | <What do credible critics claim?> | FACTUAL | P2 | "criticism of X"; "X failure"; "X controversy" | Quality press; NGO report |

Budget: waves=2, searches=15, fetches=12. Stop rule: saturation or budget.
```

### 5.2 Research Trace Log (append during work; Methodology is generated from this)

```markdown
# Research Trace — <topic> — run date <YYYY-MM-DD>
| Time | Wave | Query / Action | Top hits (publisher, title) | Verdict | Extracted finding → S-ref |
|---|---|---|---|---|---|
| 10:02 | 1 | `"solid-state battery" production 2025 pilot line` | Nikkei; company IR | Fetch 2, keep 1 | <Company> runs 2025 pilot line [S4]; volume date ESTIMATE [S5] |
| 10:06 | 1 | `solid-state battery patent filings site:wipo.int` | WIPO stats | Keep as lead | Patent trend P2, needs wave 2 |
| 10:11 | 2 | `<local-language query>` | <result> | Not found | NOT FOUND — tried Q4 alternatives a, b, c |

Source log (maintained in parallel):
| S# | Title | Publisher | URL | Pub date | Access date | Type | Independence group | Bias note |
|---|---|---|---|---|---|---|---|---|
| S1 | <title> | <publisher> | <url> | 2025-03-12 | 2026-02-10 | primary | G1 | — |
| S2 | <title> | <publisher> | <url> | 2025-05-01 | 2026-02-10 | secondary | G2 | trade association; incentive noted |
```

Independence group: assign the same group ID (G1, G2...) to sources known to share origin; two facts verified only within one group count as ONE source.

### 5.3 Confidence-Rating Rubric

```text
HIGH   = 2+ independent sources, at least one primary; definitions aligned; no unresolved conflict; data ≤2 revision cycles old.
MEDIUM = 1–2 independent secondary sources; OR primary source but stale/vintage mismatch; OR definitions approximately aligned with residual ambiguity.
LOW    = single source; OR conflicting sources unresolved; OR estimate/forecast; OR material behind paywall; OR language not directly verified.
Rule: a finding that changes a recommendation MUST be High or carry an explicit warning of its Low/Medium grade in the claim sentence itself.
```

### 5.4 Report Skeleton (fill-in markdown)

```markdown
# <Topic> — Evidence-Graded Research Report
_Scope: <geo>, <period>, <segment>; currency <X>; accessed <date>._

## Executive Summary
**BLUF:** <one sentence with the answer + confidence>.
- F1: <finding ≤2 lines> (High)
- F2: <finding> (Medium)
- F3: ...

## Key Findings
**F1 — <Claim sentence> [FACT]**
- Evidence: <value, period, definition>.
- Source: [S1] <publisher>, accessed <date>; corroborated by [S4].
- Confidence: **High**.

**F2 — <Claim> [ESTIMATE]**
- Evidence: <who estimates what, methodology note>.
- Source: [S3]; Confidence: **Medium** — single secondary source, incentive noted.

## Analysis
### <Theme 1: e.g., Demand drivers>
<Paragraph citing (F1), (F3).>
### <Theme 2: e.g., Regulatory drivers>
<Paragraph citing (F2).>

## Contradictions & Open Questions
- C1: <metric> differs: <S1: 12.4> vs <S5: 14.1> — definitions differ (<def1> vs <def2>). Unresolved; treated as range.
- OQ1: <open question; what evidence would resolve it>.

## Methodology
Mode STANDARD: 2 waves, 14 queries, 11 fetches. Searched <languages>. NOT FOUND after honest effort: <item> (tried: a, b, c). Limitations: <paywalls, single-language coverage, data vintage>.

## Sources
[S1] <Title> — <Publisher> — <URL> — published 2025-03-12 — accessed 2026-02-10 — primary.
```

### 5.5 Gap Register Template

```markdown
# Gap Register — <topic> — after wave <n>
| ID | Missing item | Load-bearing? | Tried (queries) | Next action | Status |
|---|---|---|---|---|---|
| G1 | <segment price level 2024> | yes (feeds F3) | q7, q9; aggregators only T3 | fetch 2 operator IR pricing pages; check regulator tariff data | open |
| G2 | <regional breakdown> | no | q12 | drop; note as limitation | closed-wont |
```

Rules: every open gap MUST appear in Contradictions & Open Questions or be explicitly closed as "not load-bearing — dropped" with the reason. NEVER let a gap vanish without a verdict.

### 5.6 Annotated Source List Template (DEEP mode appendix)

```markdown
| S# | Source | Type/Tier | What it establishes | Why trusted / caveats | Independence |
|---|---|---|---|---|---|
| S3 | <"EU battery market 2024", national bureau stats table> | T1 primary | Market size 41.2 GWh, CY2024 | Official statistics producer; methodology published | G1 |
| S5 | <"Sector outlook 2025", trade association> | T2 secondary | Segment growth forecast 12%/yr | Industry body; self-interest noted; used only for ESTIMATE claims | G2 |
| S7 | <Wikipedia article> | T3 tertiary | Background only; gave lead to S3 | Tertiary; nothing load-bearing rests on it | — |
```

## 6. Decision Tables

### 6.1 Mode selection

| Situation | Mode | Why |
|---|---|---|
| User needs one anchored fact plus 2–3 supporting sources | BRIEF | Full report machinery would burn budget on a lookup |
| Multi-part question, visible conflicts in quick search, report requested | STANDARD | Two waves cover verification + synthesis |
| Literature review, market study, dossier, 30+ searches, formal methodology | DEEP | Snowballing and multi-hop chains need waves and an annotated source list |
| User asks for a decision/recommendation, not discovery | hand off to problem-solver after research | Deciding is not discovering |

### 6.2 Which source to open first (triage order)

| Order | Source type | Reason |
|---|---|---|
| 1 | Official/primary hit for the exact datum | Ends the verification chain immediately |
| 2 | Quality press naming a primary source | Gives context + a citation to chase |
| 3 | Analyst/association report with visible methodology | Provides structure and estimates to cross-check |
| 4 | Aggregator/encyclopedia | Keywords, entity names, leads only |
| 5 | Forum/social post | Signal of what to search next; NEVER load-bearing |

### 6.3 Conflict handling

| Condition | Action |
|---|---|
| Primary vs. secondary disagree | Use primary; note the secondary discrepancy in trace |
| Two primaries disagree | Check definitions/periods first; if same definition, report range + both |
| Estimate vs. fact | Keep both, clearly labeled; never average them |
| Old primary vs. new secondary | Check for revisions: statistical agencies revise; use the revised primary, note revision |
| Conflict on a load-bearing finding | Finding stays Medium/Low + Contradictions entry — MUST NOT ship as High |

### 6.4 Stop vs. continue

| Signal | Action |
|---|---|
| All load-bearing facts verified; 2 targeted queries returned nothing new | STOP — saturated |
| Load-bearing fact at 1 source | CONTINUE — one more targeted query or primary chase |
| Budget 80% spent with gaps open | Prioritize remaining budget by load-bearing gaps only |
| New query stream opens a genuinely new load-bearing sub-question | Renegotiate scope/budget with the user; never silently expand |

## 7. Quality Checklist

Verify EVERY item before delivering; an unchecked item is a defect:

- [ ] 1. Scope fence (time, geography, segment, currency, units) written and respected throughout.
- [ ] 2. Decision test answered; ≥60% of search budget went to P1 pivot questions.
- [ ] 3. Mode and budget declared before wave 1; budget not silently exceeded.
- [ ] 4. Every sub-question is researchable (a document could answer it) and tagged FACTUAL/DEFINITIONAL/SYNTHETIC.
- [ ] 5. Every executed query logged with date and verdict in the research trace.
- [ ] 6. Every load-bearing fact has ≥2 independent sources OR one primary + explicit confidence downgrade.
- [ ] 7. Independence checked (no syndication, no shared press release, no same underlying dataset).
- [ ] 8. Every number carries: value, period, definition, unit, currency, source, access date.
- [ ] 9. Fiscal vs. calendar years aligned; nominal vs. real vs. PPP stated for every monetary series.
- [ ] 10. Cross-country comparisons normalized per-capita/per-GDP where scale distorts.
- [ ] 11. All conflicting sources appear in Contradictions & Open Questions with both values.
- [ ] 12. Every statement labeled FACT / ESTIMATE / INFERRED / OPINION; no unlabeled inference.
- [ ] 13. Every NOT-FOUND result is written down with what was tried (searches, source types).
- [ ] 14. No invented quotes, numbers, dates, titles, or URLs anywhere in the deliverable.
- [ ] 15. Paywalled material is cited only from legally visible metadata and marked "not accessed".
- [ ] 16. Bias screen applied to sources feeding findings; incentives noted in source log.
- [ ] 17. A counter-position search was run; the report contains a steelman of the strongest opposing case.
- [ ] 18. Report follows the exact section order: Executive Summary → Key Findings → Analysis → Contradictions & Open Questions → Methodology → Sources.
- [ ] 19. Every finding has a confidence grade from the rubric; no recommendation rests on a Low-grade finding without an explicit warning.
- [ ] 20. Methodology written from the trace (waves, query counts, failures, scope changes, limitations) — not reconstructed from memory.
- [ ] 21. Sources list complete: title, publisher, URL, publication date, access date, type.
- [ ] 22. Gap register closed out: every gap either resolved or explicitly reported as a limitation.

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Citing from search snippets | Number appears with no page context; later unverifiable | Fetch the page before citing; if unfetchable, mark Low confidence or drop to lead |
| 2 | Counting syndicated copies as independent sources | "Five sources agree" but all trace to one wire story | Check origin; group sources by origin ID; require different origins |
| 3 | Mixing fiscal and calendar years | "2024 revenue" compared across companies with different year-ends | Normalize periods; state fiscal-year end for each company figure |
| 4 | Treating forecasts as facts | "Market will reach $X billion by 2030" stated flatly | Label ESTIMATE + estimator + method; never strip the qualifier |
| 5 | Research drift | 20 queries spent, pivot untouched | Re-read the decision test at each wave boundary; cut queries not serving P1 |
| 6 | Narrative capture | Facts bent to fit the draft story; contradicting evidence dropped | Write Key Findings before Analysis; run steelman pass |
| 7 | Definition blindness | Two "unemployment" or "market size" figures compared directly | Find each series' methodology note; if definitions differ, show separately |
| 8 | Silent conflict resolution | Report shows one number where sources disagreed | Contradictions section entry with both values and resolution logic |
| 9 | Precision inflation | "47.3%" from a source that said "about half" | Preserve the source's precision; do not invent digits |
| 10 | Recency bias | Old baseline replaced by new figure; trend invented | Keep baseline and latest from the SAME series/definition; note revisions |
| 11 | Fake completeness | Endless searching "to be thorough"; budget gone | Apply saturation stop rule; write "What further research would add" |
| 12 | Unlogged queries | Methodology section invented afterwards; queries misremembered | Log at execution time; generate Methodology from the trace |
| 13 | Paywall fabrication | Detailed claims "cited" to an article that was never opened | Cite only legally visible metadata; write "paywalled, not accessed" |
| 14 | Orphan inference | Analysis paragraph contains numbers found nowhere in sources | Every number in Analysis must trace to a Key Finding; delete or source it |

## 9. Advanced Techniques

### 9.1 Citation Snowballing (Backward and Forward)

Backward snowballing: from a key paper/report, mine its reference list for primaries — faster and more precise than keyword search for established topics. Forward snowballing: find who cites the key work later (Google Scholar "Cited by", publisher citation tools, Semantic Scholar) to get updates, critiques, and replications. ALWAYS snowball both ways for literature reviews; one-way snowballing systematically misses either the foundations or the state of the art. Log each snowballed item with the seed it grew from, so the trace shows lineage.

### 9.2 Cross-Language and Cross-Jurisdiction Verification

For non-English topics, the best sources are often only in the local language. Procedure: translate the entity's official name (companies: legal registry name; laws: official gazette title; products: local catalog name) and search in-language. A fact found in English-language trade press AND in the local regulator's publication reaches High confidence with stronger independence than two English trade-press items. For regulation, ALWAYS verify against the gazette text (EUR-Lex for EU, Federal Register for US, official national journals otherwise), not against law-firm summaries — summaries drop scope conditions ("except micro-enterprises") that later flip conclusions.

### 9.3 Longitudinal and Revision-Aware Research

Statistical agencies and companies revise figures (GDP revisions, restatements). Techniques: prefer the agency's current-vintage table plus one archived old-vintage value to document the revision; note "first estimate vs. revised" when the delta is material; for fast-moving series, record the release calendar (e.g., monthly releases) so the report's data vintage is explicit. NEVER combine figures from different vintages into one trend line without a note — that manufactures phantom jumps.

### 9.4 Saturation Sampling for Large Spaces

When the entity space is large (50 competitors, 200 papers), sample deliberately: (1) census the frame (get the full list once — association member list, database export); (2) verify the top entities by the pivot (P1 = top N by the metric that matters); (3) random/stratified spot-checks on the tail; (4) state coverage explicitly: "verified top 12 of 47 by revenue; tail assessed from association aggregates." This beats pretending to verify all 47, and beats verifying 3 arbitrarily chosen ones.

### 9.5 Two-Key Locks for High-Stakes Numbers

For the 3–5 numbers the entire report leans on, demand a "second key": a structurally different evidence type that cannot share error with the first. Market size from a bureau table (S1) + top-3 company filings' segment revenues summing to a compatible order of magnitude (S2) = lock. Bureau table + market-research report that may both model from the same upstream data = not a lock. If no second key exists after honest effort, the number ships with Medium/Low confidence and a one-line explanation of what a second key would look like.

### 9.6 Adversarial and Low-Information Domains

For topics with active disinformation or thin data: (1) identify the stakeholder map first (who benefits from which story); (2) prefer instrument-like evidence (satellite imagery, customs data, court filings) over narrative claims; (3) date-stamp everything aggressively; (4) widen the Contradictions section — in adversarial domains the honest report shows the battlefield, not a single tidy answer; (5) NEVER present a silenced-information gap as evidence of absence ("no official data" ≠ "it didn't happen").

## 10. Quick Reference Card

```
MODE     BRIEF 3–6q | STANDARD 10–20q 2–3 waves | DEEP 30+q 3+ waves + annotated sources
BEFORE   decision test → scope fence → mode/budget → sub-questions → query matrix
QUERY    entity × synonym × language × facet; log every executed query + verdict
SOURCES  T1 primary > T2 secondary > T3 tertiary(leads only); chase primaries one hop
VERIFY   2 INDEPENDENT sources for load-bearing facts; origin-groups G1/G2; conflicts →
         primary > method-visible > recent > reputable > else report range
LABEL    FACT / ESTIMATE / INFERRED / OPINION — visibly, on every statement
NUMBERS  official stats first; period+definition+unit+currency on every figure;
         normalize PPP/real/per-capita; never mix definitions or vintages
REPORT   ExecSummary(BLUF ≤5 bullets) → Findings F1..(claim/evidence/source/confidence)
         → Analysis → Contradictions & Open Questions → Methodology → Sources
STOP     saturation (2–3 queries = known info) OR budget; gaps → limitations section
NEVER    invent quotes/numbers/dates/URLs · silently resolve conflicts · read paywalls
         you didn't open · ship unlabeled inference · drift past the scope fence
```



