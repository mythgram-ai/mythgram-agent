---
name: problem-solver
description: >
  General systematic problem-solving skill for technical, business, and
  everyday problems, built on a universal nine-stage loop: DEFINE,
  DECOMPOSE, DIAGNOSE, GENERATE, DECIDE, PLAN, EXECUTE, VERIFY, LEARN.
  Includes problem-statement and 5W2H templates, MECE issue trees, 5 Whys
  with its pitfalls, fishbone 6M categories, stratification, SCAMPER and
  first-principles idea generation, weighted decision matrices with a
  runnable Python calculator, reversibility (one-way/two-way doors),
  pre-mortems, second-order thinking, risk registers, PDCA/OODA execution,
  counter-metrics and kill criteria, blameless retrospectives, a framework
  catalog (SWOT, RICE, Eisenhower, JTBD, Cynefin, Pareto, Occam), cognitive
  bias counters, and three end-to-end worked examples.
  Use this whenever the user says "help me figure out", "we have a problem
  with", "why is our X getting worse", "what are our options for", "help me
  decide between A and B", "make a plan to", "this keeps happening over and
  over", "find the root cause of our churn/outages/overruns", "brainstorm
  solutions for", "prioritize these options", "should we do X or Y", or any
  request to analyze a situation, generate and compare options, make a
  decision, or build an action plan — technical, business, or personal.
  Do NOT use for a specific fault in specific code — that is debugger's
  job. Do NOT use for analyzing a dataset and producing a report — that is
  information-analyst's job. Do NOT use for writing the code of a chosen
  solution — that is coder's job (but DO use this skill to choose the
  solution and structure the plan first).
---

# Problem Solver

> Solve the RIGHT problem with the best available option by running a disciplined loop — define, decompose, diagnose, generate, decide, plan, execute, verify, learn — instead of jumping at the first idea.

## 0. Operating Rules (Non-Negotiable)

1. **MUST define the problem before generating any solution.** Solution-jumping feels productive and produces confident fixes to the wrong problem. The first stated problem is usually a symptom or a solution in disguise.
2. **MUST separate problem, cause, and constraint.** "We only have a $10k budget" is a constraint, not a problem; solving constraints like problems wastes the loop. Constraints shape options; they are never the target.
3. **MUST demand evidence for every current-state claim** — a number, an artifact, a reproducible observation. "Everyone says checkout is slow" is a rumor; "checkout p95 is 4.2 s vs 1.5 s last quarter" is a problem.
4. **MUST decompose MECE (mutually exclusive, collectively exhaustive) before prioritizing.** Overlapping buckets double-count causes; missing buckets hide them.
5. **MUST generate ≥10 distinct options before evaluating any of them.** The first three ideas are always the obvious ones everyone already tried; quantity precedes quality (diverge, then converge).
6. **MUST write measurable success criteria BEFORE deciding.** "Improve retention" is not a criterion; "30-day retention ≥ 42% within 8 weeks, with support tickets not rising >5%" is.
7. **MUST apply the reversibility test before choosing how much analysis to do**: two-way door (reversible) → decide fast with ~70% confidence; one-way door (irreversible) → analyze hard, pre-mortem, and get sign-off.
8. **MUST run a pre-mortem on any plan containing irreversible or expensive steps** ("it is 6 months later and this failed — why?"). Plans that skip pre-mortem rediscover known failure modes expensively.
9. **MUST define leading indicators, counter-metrics, and kill criteria before executing.** Without counter-metrics you will "succeed" while breaking something adjacent; without kill criteria, sunk cost decides for you.
10. **MUST close the loop with a retrospective** (keep / drop / try) and record the lesson where future work will see it. Unrecorded lessons are re-purchased at full price.
11. **NEVER confuse activity with progress.** Track leading indicators that predict the outcome, not effort counts ("lines written", "meetings held").
12. **MUST name cognitive traps when detected** (anchoring, sunk cost, confirmation bias, survivorship…) and apply the counter-move from §4.10 out loud.

## 1. When to Use / When Not To

**Use this skill when:**
- The situation is a problem to understand, options to generate, a decision to make, or a plan to build — at any scale (a crashing habit, a churn spike, an architecture choice, a personal time problem).
- The user says "help me figure out", "what are our options", "should we do A or B", "why does this keep happening", "make a plan".
- A decision is high-stakes, contested, or stuck, and needs structure (criteria, weights, pre-mortem).
- A recurring failure needs root-cause work beyond a single code bug (process, org, product).

**Do NOT use when:**
- There is a specific fault in specific code to find and fix — that is **debugger**'s job.
- The request is to analyze data and produce findings/reports — that is **information-analyst**'s job.
- The chosen solution needs new code written — hand the implementation to **coder** once the decision and plan exist.

| Signal in the request | Route to | Reason |
|---|---|---|
| "Figure out why churn spiked / deadlines slip" | **problem-solver** | systemic problem, not one code fault |
| "This function returns wrong values" | **debugger** | specific code fault |
| "Analyze this dataset for patterns" | **information-analyst** | data analysis deliverable |
| "Which of these 3 architectures should we pick?" | **problem-solver** | decision with criteria |
| "Then implement the chosen option" | **coder** | authoring after deciding |
| "Why does the API 500 in prod?" | **debugger** | live fault |

## 2. Core Concepts & Mental Models

- **The universal loop**: DEFINE → DECOMPOSE → DIAGNOSE → GENERATE → DECIDE → PLAN → EXECUTE → VERIFY → LEARN. It is circular on purpose: VERIFY and LEARN feed back into DEFINE. Small problems may pass through stages in minutes; the sequence itself never changes.
- **Problem vs symptom vs cause vs constraint.** Symptom = what you observe ("users complain"); cause = mechanism producing it ("retry storm after 30 s timeouts"); problem = the gap between current and desired; constraint = fixed boundary (budget, law, headcount). MUST classify each statement you encounter into one of these four before acting on it.
- **MECE (Mutually Exclusive, Collectively Exhaustive).** Split any system into buckets that do not overlap and miss nothing: causes, segments, options. MECE splits make prioritization arithmetic instead of vibes.
- **Hypothesis-driven work.** Treat every diagnosis as an experiment: state the hypothesis, the prediction, and the cheapest test that could disprove it — identical in spirit to scientific debugging, applied to systems and organizations.
- **Smallest solvable slice.** Every big problem contains a version small enough to solve this week that still teaches you whether the direction is right. Find it before planning quarters.
- **One-way vs two-way doors.** Reversible decisions (new landing page) deserve speed; irreversible ones (delete the database, sign a 3-year contract) deserve analysis and pre-mortem. Most decision paralysis is treating two-way doors as one-way.
- **Leading vs lagging indicators.** Lagging (revenue, churn) tells you what happened; leading (activation rate, support response time) predicts it. Plans steered only by lagging indicators are rear-view driving.
- **Cynefin changes method, not just effort**: obvious → sense-categorize-respond (checklist); complicated → analyze-expertise (hire/consult/model); complex → probe-sense-respond (safe-to-fail experiments); chaotic → act-stabilize (stop the bleeding first). Applying analysis to chaos wastes the window; applying probes to obvious wastes money.
- **Occam then Pareto.** Prefer the simplest sufficient explanation; then find the ~20% of causes driving ~80% of the gap and attack those first.

## 3. Mandatory Workflow

1. **DEFINE.** Write the problem statement with the template in §4.1: current state (with evidence) vs desired state, the gap, constraints, and why-now. MUST include at least one number. MUST pass the "problem or solution dressed as problem?" test ("we need to add a chatbot" → what need does it serve?). Why: a problem well stated is half solved; an unstated one is unsolvable.
2. **DECOMPOSE.** Break the problem into sub-questions with a why-tree (causes) and how-tree (solution areas); enforce MECE; prioritize sub-questions by impact × uncertainty (§4.2). MUST identify the smallest solvable slice. Why: un-decomposed problems stay abstract, and abstraction cannot be executed.
3. **DIAGNOSE.** For the top sub-questions, find root causes with 5 Whys (§4.3), fishbone 6M, stratification, or fault trees. MUST distinguish root cause from proximate symptom and verify the causal chain with evidence at each link ("if this is the cause, segment X should show it 3× more than segment Y — and it does"). Why: solutions aimed at symptoms fail and demoralize.
4. **GENERATE.** Produce ≥10 distinct options using brainstorming rules, SCAMPER, first principles, and inversion (§4.4). MUST quantity-first, no judgment during divergence. Why: the best option is almost never in the first three; evaluation during generation kills the weird-but-right ideas.
5. **DECIDE.** Build a weighted decision matrix (§4.5) for serious choices; apply the reversibility test; pre-mortem the favorite; check second-order effects (10-10-10: how will this feel in 10 minutes / 10 months / 10 years). MUST record the decision with criteria and scores. Why: written criteria survive politics and hindsight bias.
6. **PLAN.** Work backward from the deadline; map dependencies; sequence smallest-testable-step-first; fill a risk register (likelihood × impact × mitigation × owner); set check-in cadence (§4.6). MUST name ONE owner per workstream. Why: plans without owners are wishes; risks without mitigations are surprises on schedule.
7. **EXECUTE.** Run PDCA (plan-do-check-act) or OODA cycles at the chosen cadence; track leading indicators; watch counter-metrics (§4.7). MUST surface blockers at the first check-in where they exist. Why: early course-correction is cheap; late is not.
8. **VERIFY.** Compare outcomes against the success criteria from stage 1, using the same measures. MUST apply pre-agreed kill criteria without renegotiation. Why: criteria written after results are rationalizations.
9. **LEARN.** Run the retrospective (keep / drop / try) and, for incidents, the blameless post-mortem (§4.8). MUST record lessons where the next project will encounter them. Then re-enter the loop if the problem persists at a smaller magnitude. Why: the loop's compounding return is the entire skill.

## 4. Deep Knowledge Library

### 4.1 DEFINE — the problem statement

Template (fill ALL five, in this order):

```markdown
1. Current state (with evidence): <what is happening, with a number or artifact>
2. Desired state: <what should be happening, measurable>
3. Gap: <one sentence: "X is Y instead of Z">
4. Constraints: <budget, time, law, headcount, tech stack — facts, not wishes>
5. Why now: <the cost of not solving, and the trigger>
```

Worked example: "Checkout conversion is 1.9% (42,000 sessions, last 30 days, GA4) vs 3.1% two quarters ago; desired ≥3.0% within 8 weeks. Constraints: 2 engineers, no re-platforming, PCI scope frozen. Why now: gap costs ~$180k/month in lost GMV."

- **5W2H** to widen the frame: What exactly is wrong? Where does it occur (all segments or one)? When did it start (what changed then)? Who is affected (all users or a cohort)? Why does it matter (quantified)? How does the failure manifest step by step? How big is the gap?
- **Problem-vs-solution test**: if the statement contains an implementation ("we need to add caching"), ask "what problem would that solve?" and restate at that level. A solution dressed as a problem locks the option space before GENERATE begins.
- **Success criteria BEFORE solutions**: metric, target, deadline, counter-metric. Example: "checkout p95 < 2.0 s within 4 weeks; error rate must not rise above 0.5%."

### 4.2 DECOMPOSE — MECE issue trees

- **Why-tree** (causes): "conversion dropped" → split by funnel stage (MECE: views → product → cart → checkout → payment) → then by segment within the worst stage (device, geography, cohort, traffic source). Each level must be mutually exclusive and collectively exhaustive.
- **How-tree** (solutions): "improve checkout" → split into levers: reduce steps / increase trust / remove friction / recover abandoners. Levers must not overlap, or you will double-count impact.
- **Prioritize sub-questions by impact × uncertainty**: highest impact AND highest uncertainty gets diagnosis first — that is where learning buys the most. Low impact = ignore regardless of certainty; high certainty + high impact = skip to GENERATE with that fact as a constraint.
- **Smallest solvable slice**: one segment, one page, one cohort. Example slice: "recover cart abandoners via email on mobile Safari users" — provable in 2 weeks, and the result informs the bigger plan.

### 4.3 DIAGNOSE — root cause

- **5 Whys**, done right: "Server crashed" → "OOM" → "log worker leaked memory" → "error path never closed the file handle" → "close was added only on the happy path" → ROOT: "code review has no error-path checklist". Pitfall 1 — stop at a PROCESS layer, not a person ("tester missed it" is blame, not cause). Pitfall 2 — plural causality: real systems have ≥2 concurrent causes; run the chain per independent branch.
- **Fishbone (Ishikawa) 6M**: brainstorm causes per bucket — **Machine** (infrastructure, hardware), **Method** (process, algorithm), **Material** (data, inputs, dependencies), **Manpower** (skills, staffing), **Measurement** (monitoring, metrics, observability), **Environment** (external: market, weather, upstream vendors). The value is MECE coverage forcing you out of your favorite bucket.
- **Fault tree**: start from the undesired event, connect causes with AND/OR gates (OR = either alone suffices; AND = both required). Quantify roughly: if two OR-ed causes each have 10% probability, the event is ~19%, not 10% — redundancy math prevents false confidence.
- **Stratification**: split the data by every plausible segment (cohort, device, region, time-of-day) until one slice shows a 3–10× concentration. A cause that does not concentrate anywhere is probably not the cause.
- **Symptom vs cause vs constraint** (classify every statement): "checkout times out" = symptom; "connection pool exhausted by N+1 queries" = cause; "cannot change DB this quarter" = constraint. Solutions aim at causes, work around constraints, and merely monitor symptoms.

### 4.4 GENERATE — options before judgment

Brainstorming rules: quantity first (target ≥10); no judgment during divergence (a "stupid" idea often carries the seed of the real one); build on others ("yes, and…"); record everything visibly. Only after the list is complete, converge.

**SCAMPER** with an example (problem: long support response times):
| Letter | Prompt | Example option |
|---|---|---|
| Substitute | What component could be swapped? | Swap human triage for an LLM draft responder |
| Combine | What could merge? | Merge chat + email queues into one prioritized stream |
| Adapt | What works elsewhere? | Adapt the airline "severe weather" triage tiers to ticket severity |
| Modify / Magnify | What if scaled or shrunk? | Double the on-call rotation; or shrink SLA to 1h and see what breaks |
| Put to other use | Any hidden asset? | Use resolved-ticket corpus as self-serve docs |
| Eliminate | What can be removed? | Kill the mandatory screenshot requirement that adds a round-trip |
| Rearrange | What if sequenced differently? | Route VIP tickets directly to engineers, skip tier 1 |

Other generators: **first principles** (strip to physics/economics: "what does support actually cost per ticket, and which step adds zero value?"); **inversion** ("how would we guarantee slow support? — hide tickets, unclear ownership, no batching limits → now prevent each"); **analogy transfer** (how do hospitals triage? how do cloud on-calls page?); **TRIZ contradiction resolution** (§9.1); **constraints as catalysts** ("if we had zero budget but one week, what would we do?" — that option is often 80% as good and ships now).

### 4.5 DECIDE — structured choice

Weighted decision matrix (use for ≥3 real options, one-way-door, or contested decisions):

| Criterion (weight) | Option A: hire 2 agents | Option B: LLM triage bot | Option C: self-serve docs push |
|---|---|---|---|
| Response-time impact (30%) | 3 | 4 | 2 |
| Cost (25%) | 2 | 4 | 5 |
| Time to live (20%) | 2 | 3 | 5 |
| Risk of regression (15%) | 5 | 2 | 4 |
| Reversibility (10%) | 2 | 4 | 5 |
| **Weighted total** | **2.65** | **3.45** | **3.95** |

Rules: criteria BEFORE options; weights sum to 100%; score 1–5 with a written anchor for what a 5 means; sensitivity-check the winner (does it flip if one weight changes 10 points? if yes, the decision is not stable — gather more evidence or pick the robust runner-up).

- **Reversibility test**: two-way door → decide with ~70% confidence NOW (speed is the edge); one-way door → full matrix + pre-mortem + second opinion.
- **Pre-mortem**: "It is 6 months later and this failed — why?" Generate ≥5 failure stories, convert the top 3 into plan mitigations.
- **Second-order thinking (10-10-10)**: how will this look in 10 minutes (pain), 10 months (benefit), 10 years (strategy)? Option C looks painful today and best in a year — the matrix alone does not capture that.
- **Expected value (quick math)**: EV = p(success) × value − p(fail) × cost. A 20% shot at $1M beats a 90% shot at $50k ($200k vs $45k) — but ONLY when the loss is survivable; otherwise maximize probability.
- **Satisficing**: for two-way doors and small stakes, pick the first option clearing the bar and spend the saved attention elsewhere. Perfectionism is a tax.
- **Delegate or decide**: if a team member has context + capacity, delegate with criteria, not instructions ("keep p95 under 2 s; don't touch PCI scope; report Friday").

### 4.6 PLAN — from decision to calendar

- **Work-back schedule**: start at the deadline, decompose into milestones with dates, then order tasks by dependency (not by ease). Anything on the critical path (delay moves the deadline) gets buffer (~20%).
- **Dependency mapping**: what must be true before step 1 (data, access, approval, other team)? External dependencies get a date AND an owner AND a fallback.
- **Smallest testable step first**: schedule the cheapest step that produces real-world evidence (a landing page before the product; one city before the rollout).
- **Risk register** (fill every column, review weekly):

| Risk | Likelihood (L/M/H) | Impact (L/M/H) | Mitigation | Owner | Trigger/early signal |
|---|---|---|---|---|---|
| LLM triage misroutes urgent tickets | M | H | Human review first 2 weeks; confidence threshold | Kim | >2 misroutes/week in QA sample |
| Doc migration slips behind feature work | H | M | Reserve Wed for docs; ship FAQ v1 first | Ana | Week-1 milestone missed |

- **Owners and cadence**: ONE name per workstream (committees are not owners); check-in cadence matched to risk (weekly for H/M risks, biweekly otherwise); every check-in reviews the register and the leading indicators.

### 4.7 EXECUTE & VERIFY

- **PDCA**: Plan (from stage 6) → Do (the slice) → Check (leading indicators vs target) → Act (scale what works, fix or kill what doesn't). Cycle weekly or per-slice, not per-quarter.
- **OODA** for fast-changing/hostile environments: Observe (raw signals), Orient (update the mental model — the decisive step), Decide, Act; then re-observe. When losing, accelerate the loop, not the effort.
- **Leading vs lagging**: lagging = revenue, churn, NPS (truth, but late); leading = activation rate, ticket response time, doc coverage (actionable now). Every lagging goal MUST get ≥1 leading proxy to steer by.
- **Counter-metrics**: for each success metric, name the metric that must NOT degrade (add self-serve docs → watch ticket quality/CSAT, not just ticket volume; add caching → watch data freshness complaints). A success that breaks a counter-metric is a failure caught early.
- **Kill criteria** (decide them in advance, in writing): "if activation < 15% by week 4, stop and re-diagnose"; "if misroute rate >5% after 2 weeks of tuning, revert to human triage". Without pre-agreed kills, sunk cost will steer.

### 4.8 LEARN — institutionalize the lesson

- **Retrospective (keep / drop / try)**, 30 minutes, every project/sprint:
  - KEEP: what worked and we must repeat (with evidence).
  - DROP: what wasted time or harmed output (remove the step, not the person's dignity).
  - TRY: one bounded experiment for next cycle (owner + measure).
- **Blameless post-mortem** (for incidents): timeline → impact in numbers → root cause (process layer) → what made it possible → fixes with owners and dates. Rule: names describe actions, not culprits ("the deploy lacked a canary", never "Dave skipped the canary"). Blame stops reporting; stopped reporting stops learning.

### 4.9 Framework Catalog

| Framework | Core question | Use when |
|---|---|---|
| SWOT | Strengths/Weaknesses (internal) vs Opportunities/Threats (external) | Positioning, strategy kickoff |
| RICE | (Reach × Impact × Confidence) / Effort | Ranking a backlog of features/options |
| Eisenhower | Urgent × Important quadrants | Personal/team triage of many demands |
| JTBD | What job is the user hiring the product for? | Requirements, positioning, churn interviews |
| Cynefin | Which domain is this: obvious / complicated / complex / chaotic? | Choosing METHOD (checklist vs analysis vs probes vs act) |
| 5 Whys | Causal chain to process root cause | Any recurring failure |
| Fishbone 6M | MECE cause brainstorm across 6 buckets | Group diagnosis, quality problems |
| Occam's razor | Simplest sufficient explanation | Competing hypotheses with equal evidence |
| Pareto (80/20) | Which ~20% of causes drive ~80% of effect? | Prioritizing after stratification |
| Pre-mortem | "It failed — why?" before starting | Any plan with irreversible steps |
| Expected value | p × value − (1−p) × cost | Comparable bets, survivable downside |
| Reference class | What happened to similar past efforts? | Calibrating forecasts away from optimism |

### 4.10 Cognitive Traps & Debiasing

| Trap | What it does | Tell-tale sign | Counter-move |
|---|---|---|---|
| Anchoring | First number drags all estimates | "we need at least the $50k we discussed" before any analysis | Generate estimates independently BEFORE sharing any number |
| Confirmation bias | You find only what you expect | Every new fact conveniently fits | Assign a red team: argue the OPPOSITE hypothesis with evidence |
| Sunk cost | Past spend justifies future spend | "we've already invested 3 months" | Ask: "knowing what I know now, would I start this today?" |
| Framing effect | "90% survival" ≠ "10% mortality" changes choices | Decision flips with rewording | Restate every option in loss AND gain frames |
| Survivorship bias | You study winners only | "successful startups all pivoted" | Ask about the invisible failures with the same trait |
| Overconfidence | 90%-sure events happen ~60–75% of the time | Dates and estimates never padded by history | Reference-class: what did similar efforts actually take? |
| Solution-jumping | First idea executed, alternatives unseen | Options appear after the decision | Enforce §0 rule 5: ≥10 options before evaluation |
| Recency bias | Last event outweighs the base rate | "this week's dip proves the trend" | Plot the full series; compute the base rate |

## 5. Code & Tool Templates

### 5.1 Problem statement worksheet (fill-in, with the quality bar)

```markdown
**Problem:** Checkout conversion fell to 1.9% (GA4, 42,000 sessions, Oct 1–30)
from 3.1% in Q2. Target ≥3.0% within 8 weeks.
**Constraints:** 2 engineers; no re-platform; PCI scope frozen; support team of 4.
**Why now:** ~$180k/month GMV gap; holiday traffic starts in 10 weeks.
**Out of scope (constraints, not problems):** re-platforming, new payment provider.
**Success criteria:** conversion ≥3.0% by Dec 15 AND payment error rate ≤0.5%
AND support tickets ≤ +5%.
```

### 5.2 Weighted decision matrix + Python calculator

```python
# decide.py — run: python decide.py
# Weighted decision matrix with a stability (sensitivity) check.
CRITERIA = {                      # criterion: weight (must sum to 1.0)
    "impact": 0.30, "cost": 0.25, "time_to_live": 0.20, "risk": 0.15, "reversibility": 0.10,
}
SCORES = {                        # option: {criterion: 1..5}
    "hire agents":      {"impact": 3, "cost": 2, "time_to_live": 2, "risk": 5, "reversibility": 2},
    "llm triage bot":   {"impact": 4, "cost": 4, "time_to_live": 3, "risk": 2, "reversibility": 4},
    "self-serve docs":  {"impact": 2, "cost": 5, "time_to_live": 5, "risk": 4, "reversibility": 5},
}

def rank(scores: dict, weights: dict) -> list[tuple[str, float]]:
    totals = {opt: sum(w * s[opt][c] for c, w in weights.items()) for opt in scores}
    return sorted(totals.items(), key=lambda kv: kv[1], reverse=True)

if __name__ == "__main__":
    for option, total in rank(SCORES, CRITERIA):
        print(f"{option:20s} {total:.2f}")
    # Sensitivity: drop each weight by 10 points, give it to the top criterion,
    # and re-rank. If the winner changes, the decision is NOT stable -> gather evidence.
```

### 5.3 Risk register (markdown, fill every column)

```markdown
| # | Risk | L | I | Score | Mitigation | Contingency | Owner | Early signal |
|---|---|---|---|---|---|---|---|---|
| 1 | Bot misroutes urgent tickets | M | H | 6 | 2-week human review; threshold 0.9 | Auto-fallback to tier-1 queue | Kim | >2 QA misroutes/wk |
| 2 | Docs push starved by feature work | H | M | 6 | Wednesday doc-block, calendar-enforced | Freelance writer sprint | Ana | Week-1 milestone missed |
| 3 | Vendor API rate limit hit at peak | L | H | 5 | Queue + backoff negotiated in contract | Second provider integration | Mo | 429 rate >0.1% |
```

### 5.4 Pre-mortem facilitation script (45 minutes)

```markdown
1. (5 min) Frame: "It is 6 months from now. We shipped X and it FAILED badly."
2. (10 min) Silent individual writing: every person lists failure reasons. NO discussion yet.
3. (15 min) Round-robin capture; cluster into themes; mark likelihood × impact.
4. (10 min) For the top 3: convert each into a mitigation with owner + trigger.
5. (5 min) Assign: mitigations enter the plan (§4.6 register) or the option is revised.
Rule: no rebuttals during step 3 — the point is to surface what people are afraid to say.
```

### 5.5 5-Whys worksheet (with the anti-pitfall column)

```markdown
| Level | Statement | Is this cause or blame? | Evidence? |
|---|---|---|---|
| Symptom | Checkout 500s at peak | symptom | 312 errors 19:00–19:20 |
| Why 1 | Connection pool exhausted | cause | pool metrics: 20/20 in use |
| Why 2 | 3 queries per request instead of 1 | cause | query log sample |
| Why 3 | Cart loader called in a loop | cause | code path review |
| Why 4 | No eager-loading convention in the ORM guide | PROCESS ROOT CAUSE | guide lacks section |
| Fix | Batch query + add guide section + CI query-count budget | (fix the process, not the person) | PR + doc |
```

### 5.6 Solution presentation template (BLUF + pyramid — the output format for this skill)

```markdown
**BLUF (one sentence, first line always):** Ship self-serve docs + LLM triage;
it recovers ~80% of the response-time gap in 6 weeks at ~15% of the cost of hiring.

**Recommendation** (what to do, owner, date):
Adopt option C+B hybrid. Owner: Ana. Pilot complete by <date>. Cost ≤ $8k.

**Why** (top 3 evidence-backed reasons — pyramid: each reason is one line, then support):
1. Stratification shows 62% of tickets are 12 repeated questions (log analysis, n=9,400).
2. Docs push scored highest on the decision matrix (3.95/5) and is fully reversible.
3. Triage bot pilot misroute rate was 2.1% in staging vs 5% kill threshold (§ kill criteria).

**Options considered** (one line each + why rejected):
- Hire 2 agents: slowest to live (12 wks), $210k/yr, dropped on time-to-live.
- LLM bot alone: regression risk above threshold until docs corpus exists.

**Risks & mitigations** (top 2 from the register) …

**Decision needed from you** (one specific ask, with deadline):
Approve the $8k pilot budget and Ana's 30% time allocation by Friday.
```

Communication rules: BLUF first — the answer in the first sentence, support after (busy readers never reach paragraph three); pyramid structure — recommendation → 3 reasons → evidence per reason; recommendation-first is the professional norm, history-first is how updates get skimmed and decisions get deferred.

## 6. Decision Tables

**Table 1 — Cynefin routing (choose the METHOD, not just the effort):**

| Domain | Signature | Method | Example |
|---|---|---|---|
| Obvious | Known cause-effect, repeatable | Sense → categorize → respond: checklist/SOP | Password reset flow |
| Complicated | Knowable via analysis | Analyze → expert/model → respond | Capacity planning, cost model |
| Complex | Cause-effect only visible in hindsight | Probe → sense → respond: safe-to-fail experiments | Churn recovery tactics |
| Chaotic | No usable cause-effect, crisis | Act → stabilize → then sense | Data breach, outage night |

**Table 2 — How much analysis does this decision deserve?**

| Situation | Method |
|---|---|
| Reversible + low stakes | Satisfice: first option clearing the bar; decide in minutes |
| Reversible + contested | Quick matrix (3 criteria); cap at 1 hour |
| Irreversible + high stakes | Full weighted matrix + pre-mortem + second opinion + sign-off |
| Data cheaply obtainable | Buy the information first (A/B test, pilot, sample) before deciding |
| Stuck between near-equal options | Set a decision deadline; pick one; schedule a review checkpoint instead of looping |

**Table 3 — Generate vs decide mode:**

| Phase | Mode | Forbidden |
|---|---|---|
| DEFINE/DECOMPOSE | Curious, evidence-hungry | Solution talk |
| GENERATE | Wild, additive, no judgment | "that won't work because…" |
| DECIDE | Cold, criteria-driven | New options sneaking in |
| PLAN/EXECUTE | Concrete, owner-mapped | Re-opening the decision without new evidence |

## 7. Quality Checklist

- [ ] Problem statement written with current state (with a number), desired state, gap, constraints, why-now
- [ ] Problem-vs-solution test passed — no implementation disguised as the problem
- [ ] Decomposition is MECE; buckets neither overlap nor leave gaps
- [ ] Sub-questions prioritized by impact × uncertainty; smallest solvable slice identified
- [ ] Root-cause analysis distinguishes symptom, cause, and constraint
- [ ] Causal chain verified with evidence at each link (stratification or data, not plausibility)
- [ ] 5 Whys stopped at a process layer, not a person; plural causes considered
- [ ] ≥10 distinct options generated before ANY evaluation
- [ ] Success criteria defined BEFORE the decision, with metric + target + deadline + counter-metric
- [ ] Decision made with a written method (matrix, reversibility test, EV) and recorded
- [ ] Reversibility test applied; one-way doors got pre-mortem + second opinion
- [ ] Sensitivity check on the decision: winner stable under ±10-point weight shifts
- [ ] Plan is work-back scheduled with dependencies and a smallest-testable first step
- [ ] Risk register filled: likelihood, impact, mitigation, contingency, owner, early signal
- [ ] Exactly one named owner per workstream; check-in cadence set
- [ ] Leading indicators + counter-metrics + kill criteria agreed BEFORE execution
- [ ] Verification compares results against the ORIGINAL success criteria
- [ ] Retrospective held; lessons recorded where the next project will find them

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---------|---------|-----|
| 1 | Solution-jumping | An elegant fix to the wrong problem, enthusiastically executed | Write the problem statement and success criteria BEFORE any solution talk; ask "what would success look like?" first |
| 2 | Symptom-patching | The issue returns in two weeks, slightly different shape | Run 5 Whys to a process layer; verify the fix with a counter-metric, not just the absence of the symptom |
| 3 | Fake MECE decomposition | Overlapping branches double-count; two workstreams fix the same thing | Test every item fits exactly one branch, no orphans, no gaps; merge or split until it holds |
| 4 | 5 Whys stops at "human error" | "Bob made a mistake" is unfixable; the error recurs | Keep asking why until you reach a system layer: "why did the process ALLOW the error and not catch it?" |
| 5 | Brainstorm-judging | Three ideas, anchored on the first one spoken | Separate generate (no judgment) from evaluate (written criteria); enforce the ≥10-options rule |
| 6 | Decision theater | A weighted matrix with invented weights, then the gut call anyway | Agree weights with stakeholders BEFORE scoring options; run a ±10-point sensitivity check |
| 7 | Sunk-cost continuation | "We've already invested three months" | Zero-based question: "knowing what we know now, would we start this today?" Answer as if the past spend does not exist |
| 8 | One-way-door speed | Irreversible choice made casually in a meeting | Run the reversibility test FIRST; one-way doors get a pre-mortem and a second opinion |
| 9 | No kill criteria | Zombie projects that consume quarters | Define leading indicators + a kill threshold at planning time, in writing, with an owner |
| 10 | Planning fallacy | Deadlines missed at roughly the historical rate | Build a work-back schedule; check the reference class (how long did similar work take?); buffer the critical path only |
| 11 | Verification theater | "We shipped it, therefore it worked" | Compare results against the ORIGINAL success criteria plus counter-metrics; state what number moved and by how much |
| 12 | Blame retrospectives | Lessons are never recorded because people defend themselves | Blameless format: system causes, not people; output is keep/drop/try, filed where the next project will look |
| 13 | Problem-too-big paralysis | Analysis for weeks, nothing starts | Cut the smallest testable slice and timebox exploration (e.g., 2 days, then decide) |
| 14 | Anchoring on the first solution heard | The discussion narrows to evaluate-once-defend-forever | Generate alternatives before evaluating ANY option; ban evaluating option #1 until #10 exists |

## 9. Advanced Techniques

### 9.1 Cynefin routing
Diagnose the domain BEFORE choosing a method, because methods that work in one domain fail in another: **Obvious** (known cause-effect, e.g., password reset) → sense, categorize, respond with a checklist; do not over-analyze. **Complicated** (cause-effect discoverable by experts, e.g., server sizing, most engineering bugs) → analyze with experts, evaluate options, respond with good practice. **Complex** (cause-effect only visible in retrospect, e.g., user adoption, culture, viral growth) → probe with safe-to-fail experiments, sense which amplify, respond by scaling winners; NEVER attempt a fixed plan. **Chaotic** (no usable cause-effect, e.g., outage, PR crisis) → act to stabilize first, then move the problem to Complex. Most failed problem-solving is a method-domain mismatch: running a six-sigma analysis on a complex adoption problem, or "move fast" on a safety-critical obvious problem.

### 9.2 Constraint theory for process problems
When the problem is throughput (orders, tickets, deployments, hiring), find THE bottleneck step — the one with a queue in front of it — and apply the five focusing steps in order: identify the constraint, exploit it (get full utilization with zero waste), subordinate everything else to it (never starve it), elevate it (add capacity), and repeat. Local optimizations elsewhere are provably worthless: an hour saved on a non-bottleneck saves the system zero hours. Verify the constraint moved before optimizing the next one.

### 9.3 Contradiction resolution (TRIZ-style)
When requirements conflict ("fast AND stable", "cheap AND high-quality"), do not average — separate. Separation in TIME: full checks at release, fast checks per commit. Separation in SPACE: aggressive caching at the edge, strict consistency at the ledger. Separation in CONDITION: strict mode for new users, legacy mode for old data until migrated. Inventive solutions dissolve the trade-off instead of trading it off; if you cannot state the underlying contradiction in one sentence, you are not solving the real problem yet.

### 9.4 Systems thinking: loops, delays, second-order effects
Map the feedback loops around the problem before intervening: reinforcing loops (growth spirals, doom loops) and balancing loops (what pushes back when you push). Ask "and then what happens?" twice for every intervention — the second answer is where unintended consequences live (example: add a bonus for tickets closed → tickets get closed without resolution). Watch for policy resistance: systems push back against change through the balancing loops you did not map. Prefer interventions that change the loop structure (incentives, information flow) over ones that push harder against it.

### 9.5 Decision hygiene
Structure beats willpower for high-stakes decisions: collect independent estimates BEFORE group discussion (discussion anchors everyone to the first speaker); assign a red team to argue the losing option seriously; run the pre-mortem before the decision, not after; demand base rates ("how often do projects like this finish on time?" — use the historical rate, not the plan); and record the decision with its reasoning and expected outcome so future-you can distinguish a bad decision from a bad outcome.

### 9.6 Deciding under uncertainty
When outcomes are probabilistic: build 2-3 scenarios (base/bull/bear) with explicit assumptions, estimate rough impact per scenario, and compute a simple expected value — but ALWAYS check the worst-case floor first: if the bear case is unrecoverable (bankruptcy, data loss, legal exposure), expected value is irrelevant; cap the downside before optimizing the upside. For large irreversible bets, prefer real options: stage the investment (pilot → expand → scale) so each stage buys information that decides the next, and never commit the full budget to an unvalidated assumption.

## 10. Quick Reference Card

**The 9-stage loop (one line each):**
| Stage | Core question | Primary tool |
|-------|--------------|--------------|
| 1. DEFINE | What exactly is the gap? | Problem statement + success criteria |
| 2. DECOMPOSE | What are the parts? | MECE issue tree |
| 3. DIAGNOSE | Why does it happen? | 5 Whys / fishbone / stratification |
| 4. GENERATE | What are ALL the options? | Brainstorm + SCAMPER + first principles (≥10) |
| 5. DECIDE | Which one, and by what method? | Weighted matrix + reversibility + pre-mortem |
| 6. PLAN | Who does what by when? | Work-back schedule + risk register |
| 7. EXECUTE | Is it moving? | PDCA + leading indicators |
| 8. VERIFY | Did the number move? | Original criteria + counter-metrics |
| 9. LEARN | What did we teach the future? | Blameless retrospective |

**Debiasing moves (do these five, always):** state success criteria before solutions · generate ≥10 options before evaluating any · reversibility test on every big decision · pre-mortem on one-way doors · kill criteria in writing before execution.

**Escalation triggers:** gap > one team's control → raise scope · no root cause after 3 rounds of why → stratify data or instrument · all options below the success bar → re-frame the problem, do not lower the bar silently.

**Communication:** BLUF — recommendation first, evidence second, history last. One recommendation, ≤3 supporting reasons, each backed by evidence with a number in it.

