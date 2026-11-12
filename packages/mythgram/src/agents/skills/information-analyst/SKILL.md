---
name: information-analyst
description: >
  Turns raw data and messy information into verified findings, quantified
  insights, and actionable recommendations. Runs the full analyst loop:
  question framing, data cleaning (missing-value rules by column type and
  missingness share, IQR/z-score outlier fences, deduplication, type
  coercion, currency and unit normalization, date parsing, string hygiene),
  exploratory data analysis (univariate to bivariate to multivariate,
  distributions and skew, Pearson vs Spearman, segments and cohorts),
  statistics essentials (mean vs median, central limit theorem, t-test,
  chi-square, ANOVA, p-value caveats, effect sizes, confidence intervals,
  Simpson's paradox, small-sample traps), business frameworks (SWOT, PESTLE,
  Porter's five forces, funnel analysis, cohort retention, RFM, Pareto 80/20,
  KPI trees, north-star metrics), KPI design (leading vs lagging, input vs
  output metrics, counter-metrics, vanity-metric traps), and insight writing
  (action titles, pyramid principle, BLUF, so-what test) assembled into a
  disciplined report: method, numbered evidence-backed findings, implications,
  and recommendations with owner, effort, and impact. Includes pandas recipes
  (groupby/agg, pivot_table, merge, resample, cut) and SQL window-function
  patterns for MoM and ranking. Use this whenever the user asks to "analyze
  this data", "find insights", "explain why sales dropped", "look at the
  numbers", "what does this tell us", "do an A/B test readout", "calculate
  retention", "design a KPI", "write an analysis report", "give me
  recommendations", or "make sense of this dataset". Do NOT use it to search
  the web for external facts — that is deep-researcher/web-researcher's job;
  do NOT use it to produce the chart images themselves — that is
  data-visualization's job; do NOT use it to build .xlsx deliverables — that
  is excel-creator's job; this skill feeds all three with verified numbers.
---

# Information Analyst

> Convert data into decisions: clean it honestly, interrogate it systematically, and end every analysis with a specific, owned, evidence-backed recommendation — never with bare numbers.

## 0. Operating Rules (Non-Negotiable)

1. **NEVER end an analysis with numbers alone.** Every finding MUST terminate in a "so what" and a recommendation with an owner, an effort estimate, and expected impact. Numbers without an action are trivia; the deliverable is a decision.
2. **MUST look at the data before modeling or summarizing.** Run distributions, missingness, and a head() dump first. Why: silent type errors, sentinel values like -999, and duplicated rows invalidate every downstream statistic.
3. **NEVER invent, extrapolate, or estimate numbers without labeling them as estimates.** Every figure in the deliverable MUST be traceable to a source table, query, or computation the reader can re-run. Why: one fabricated number destroys the credibility of the entire report.
4. **MUST state uncertainty with every key number** (sample size, confidence interval, or "directional only — n=23"). Why: a point estimate without spread invites overconfident decisions.
5. **MUST treat p-values as evidence strength, never as probability of truth.** "p=0.03" does NOT mean "97% chance the hypothesis is true". Pair every p-value with effect size and confidence interval. Why: p<0.05 with a 0.2% lift is usually not worth shipping.
6. **MUST prefer the median for skewed data** (revenue per user, session time, response latency) and report the skew that forced the choice. Why: one whale user can double a mean while 90% of users got worse.
7. **MUST check correlation against causation:** segment, time-order, and confounder-check before writing "X drives Y". Why: Simpson's paradox can reverse a correlation's sign when a segment is added.
8. **MUST compare like with like:** use YoY for seasonal businesses, MoM for fast-moving products, and NEVER compare a partial period against a full one. Why: "December vs November" reads seasonality as collapse.
9. **NEVER cherry-pick windows.** MUST state the full period analyzed and show neighboring periods. Why: a chosen 2-week window can prove anything; reviewers who find the trick discard the whole report.
10. **MUST sanity-check sample sizes** before any percentage claim (a rate on n=12 is noise, not signal). Why: percentages on tiny denominators swing ±30 points for no reason.
11. **MUST write one message per paragraph, finding titles that state the finding.** "Churn doubled among users who never completed onboarding", not "Churn analysis". Why: readers decide from titles whether to keep reading.
12. **NEVER present a cleaned number without saying it was cleaned.** Record dropped rows, imputed values, and excluded outliers with counts and reasons. Why: "revenue is $4.58M" means nothing if 8% of rows were silently dropped.

## 1. When to Use / When Not To

**Use this skill when:**
- The user hands you a dataset, CSV, database extract, or a pile of metrics and asks "what's going on?", "why did X change?", "what should we do?"
- A metric moved and the cause is unknown (sales dip, churn spike, cost blowout).
- An experiment (A/B test) must be read out with effect size, uncertainty, and a ship/no-ship call.
- Retention, funnel, cohort, RFM, or KPI structures must be built and interpreted.
- A report or memo must turn findings into prioritized recommendations.
- The user asks "is this number good or bad?" — benchmarking against targets, history, and segments.

**Do NOT use when:**

| Request is about | Route to | Why |
|---|---|---|
| Searching the web for external facts, market data, competitor info | deep-researcher / web-researcher | Fact-finding pipelines differ from data analysis; mixing them produces unsourced numbers |
| Producing chart images / dashboards as the deliverable | data-visualization | This skill computes and words the insight; that skill renders it |
| Building the .xlsx workbook deliverable | excel-creator | This skill defines the summary logic; excel-creator builds the styled file |
| PDF/DOCX report formatting | pdf-creator | Formatting is downstream; this skill produces the content structure |
| Pure data wrangling with no "why/so-what" question | a data-engineering task | Without a decision question, there is no analysis, only ETL |

## 2. Core Concepts & Mental Models

### 2.1 The Analyst Loop
question → data → clean → analyze → insight → so-what → recommendation → (decision) → new question. The loop is not done at "insight": an insight ("churners never finished onboarding") must convert into an action ("gate activation on step 3; owner: PM; effort: M"). ALWAYS close the loop.

### 2.2 Observation vs Insight vs Recommendation
- **Observation:** "Q3 revenue was $2.1M, down 12% YoY." A fact.
- **Insight:** "The decline is entirely the enterprise segment, concentrated in September renewals that slipped to Q4." A fact plus cause or mechanism.
- **Recommendation:** "Assign CSM coverage to the 9 September renewals (owner: VP Sales, effort: S, impact: ~$300K pull-forward)." A decision-ready action.
Deliverables MUST contain all three layers, clearly separated.

### 2.3 Pyramid Principle and BLUF
Lead with the answer, then 3 supporting findings, then the evidence. Executives read the first 3 lines; everything below is optional depth. BLUF = Bottom Line Up Front: the executive summary states conclusion + 2–3 proofs + the ask in ≤150 words before any methodology.

### 2.4 Metric Anatomy: leading vs lagging, input vs output
- **Lagging/output metrics** (revenue, churn) report outcomes you cannot act on directly. **Leading/input metrics** (demos booked, onboarding completion) are the levers.
- Every output KPI MUST have 1–2 input KPIs that move it, and 1 **counter-metric** that prevents gaming (growth in signups ↔ activation rate; speed of delivery ↔ defect rate).
- **Vanity metrics** (total signups, page views, downloads) only ever go up; they carry no decision value. Replace with rates or cohort comparisons.

### 2.5 Distributions Before Averages
Mean, median, and percentile tell different truths. ALWAYS plot/inspect the distribution first: bimodal data invalidates any single average; a 90th-percentile latency story is invisible in the mean. Report the shape (skew, modes) alongside the central value.

### 2.6 Segments Before Totals
A total is an average over hidden segments. Revenue "flat" can hide enterprise −30% / SMB +30%. ALWAYS disaggregate by the 2–4 dimensions the business actually acts on (segment, region, channel, plan) before writing any finding.

## 3. Mandatory Workflow

1. **Frame the question and the decision.** MUST write: "This analysis answers X so that [role] can decide Y." NEVER start with "explore the data". Why: without a decision, analysis has no stopping condition and no success criterion.
2. **Inventory the data.** Row counts, date ranges, grain (one row = what?), source system, known quality issues. MUST verify the grain — double counting comes from joining at the wrong grain. Why: 80% of wrong analyses are grain and filter errors, not statistics errors.
3. **Clean (§4.1):** dedupe, fix types, normalize units and currency, handle missing values by rule, flag outliers. MUST log every transformation with a count ("dropped 214 duplicate order rows, 1.7%"). Why: cleaning choices move results; the reader must be able to audit them.
4. **EDA (§4.2):** univariate → bivariate → multivariate; distributions, skew, segments. NEVER skip to the model or the headline. Why: EDA is where Simpson's paradox, data errors, and the real story are found.
5. **Analyze with the right statistic (§4.3):** choose mean vs median by skew, the right test by data type, effect size with every test. Why: the wrong statistic confidently reports the wrong thing.
6. **Disaggregate and verify:** segment every headline number; check seasonality and cohort effects; hunt for confounders. Why: the aggregate is usually the least informative view.
7. **Write findings (§4.6):** numbered, each with an action title, the evidence (number + comparison + period), and the so-what. Apply the so-what test: if no action could change given this finding, cut or merge it. Why: reports die from findings that inform no decision.
8. **Recommend:** owner + effort (S/M/L) + impact (estimated, with the arithmetic) + a first step executable this week. NEVER recommend "investigate more" without a specific next probe. Why: vague recommendations transfer work back to the reader.
9. **QA the deliverable (§7 checklist):** every number re-traced to source, uncertainty stated, periods labeled, no partial-vs-full-period comparisons. Why: an analysis with one broken number loses all authority.

## 4. Deep Knowledge Library

### 4.1 Data Cleaning Rules

| Problem | Rule | Threshold / method | Never |
|---|---|---|---|
| Missing numeric, <5% of rows, MCAR | drop rows | listwise on the measure | impute silently |
| Missing numeric, 5–30% | impute | median (skewed) / mean (symmetric) / model-based | drop rows (bias + lost power) |
| Missing numeric, >30% | exclude column | report missingness as a finding | impute (invents the majority of the column) |
| Missing categorical | flag | fill "Unknown" and keep it as a category | drop rows |
| Missing time series point | interpolate | linear within gaps ≤2 periods | interpolate long gaps |
| Outliers | flag first, decide by business context | IQR fence: outside [Q1−1.5×IQR, Q3+1.5×IQR]; z>3 only for near-normal data | delete automatically |
| Duplicates | dedupe on natural key | df.drop_duplicates(subset=[key]) | dedupe full rows only (near-dupes survive) |
| Types | coerce explicitly | pd.to_numeric(errors="coerce") + audit coerced NaNs | let "1,234" stay a string |
| Currency | normalize first | convert at period-average rate; label the rate source | mix EUR and USD in one sum |
| Units | normalize to one unit | convert MB→GB, ms→s; store the unit in the column name | sum mixed units |
| Dates | parse to datetime | dayfirst=True for EU formats; audit NaT count | trust dd/mm vs mm/dd silently |
| Strings | trim and collapse | strip + collapse whitespace + consistent case for keys | join on untrimmed strings |

Missingness mechanism matters: MCAR (random) → dropping is safe; MAR/MNAR (missing because of the value, e.g., high earners skipping salary) → dropping or naive imputation biases every result; say which case you are in.

### 4.2 EDA Protocol (always in this order)

1. **Univariate:** numeric → describe() + histogram + skew (|skew|>1 → median and log-transform for modeling); categorical → value_counts(normalize=True), watch rare levels (<1% → consider bucketing "Other").
2. **Bivariate:** numeric×numeric → scatter + Pearson r; if either variable is skewed use Spearman (rank-based, robust to outliers and non-linearity). categorical×numeric → box/violin by group + group medians. categorical×categorical → crosstab with row percentages.
3. **Multivariate:** pivot (segment × time) heatmaps; cohort tables; check whether the bivariate story survives within segments (Simpson check, §9.3).
4. **Time sanity:** plot the raw series; mark known events (launches, outages, price changes); confirm period completeness (no half-months).
EDA output is a list of candidate insights with evidence attached — not a data dump.

### 4.3 Statistics Essentials

| Question | Test | Assumptions | Report with |
|---|---|---|---|
| Two group means | Welch t-test (scipy.stats.ttest_ind, equal_var=False) | approx normal or n≥30/group | mean diff + 95% CI + Cohen's d |
| Two proportions (A/B) | two-proportion z-test | n·p≥5 both arms | abs/rel lift + CI |
| ≥3 group means | one-way ANOVA + Tukey HSD | normal-ish residuals, similar variance | group table + pairwise diffs |
| Two categorical associations | chi-square (scipy.stats.chi2_contingency) | expected count ≥5 per cell | contingency table + Cramér's V |
| Non-normal / small n | Mann–Whitney U / Wilcoxon | — | median diff + CI (bootstrap) |
| Association, skewed | Spearman correlation | monotonic | ρ + scatter |

- **Central limit theorem:** with n≥30–50, sample means are approximately normal, which is why t-tests tolerate moderate skew at business sample sizes — but NOT for heavy-tailed revenue data; bootstrap instead.
- **p-value caveats:** p is P(data this extreme | H0 true), NOT P(H0 true); 0.049 vs 0.051 is no meaningful difference; multiple comparisons inflate false positives (test 20 segments, expect 1 false "winner" — correct with Bonferroni α/20 or pre-register the primary segment).
- **Effect size > significance:** always pair with Cohen's d (0.2 small / 0.5 medium / 0.8 large) or relative lift; a significant 0.3% lift on a 3-week test will not survive seasonality.
- **Confidence interval:** the range of plausible effect sizes; decisions should weigh the lower bound ("worst plausible case still positive?").
- **Small-sample traps:** percentages on n<30; stops at step k of a funnel computed from different cohorts; "3 of 4 users prefer A" (CI 95% spans 22–94% — say so).

### 4.4 Business Frameworks

| Framework | Use when | Core mechanics |
|---|---|---|
| SWOT | positioning, strategy reviews | internal strengths/weaknesses vs external opportunities/threats; each item must be evidence-backed, not adjectives |
| PESTLE | market entry, macro shifts | Political, Economic, Social, Technological, Legal, Environmental scan |
| Porter's 5 forces | industry attractiveness | supplier power, buyer power, entrants, substitutes, rivalry; rate each H/M/L with evidence |
| Funnel analysis | conversion problems | stage-by-stage conversion vs benchmark; find the single worst step, don't optimize all at once |
| Cohort retention | product stickiness | group users by start month, track M1/M3/M6 retention per cohort (§5.4) |
| RFM | customer segmentation | Recency, Frequency, Monetary quintiles → 5×5×5 segments; act on "high-F low-R" (win-back) and "high-RF M" (VIP) |
| Pareto 80/20 | prioritization | cumulative share curve; find the few SKUs/customers/causes producing ~80% of effect |
| KPI tree | metric diagnostics | decompose north star into input metrics multiplicatively (§9.4) |
| North-star metric | focus | one metric capturing delivered value (e.g., weekly active teams completing a core action) |

Frameworks are thinking checklists: each cell needs a number or named evidence, otherwise it is filler.

### 4.5 KPI Design

- **Leading vs lagging:** revenue (lag) ← pipeline + win rate (lead). If the KPI review happens after the outcome, add leading indicators or the meeting is an autopsy.
- **Input vs output:** teams own inputs (calls made, features shipped); leadership watches outputs (ARR). Tie them with a KPI tree so inputs demonstrably move outputs.
- **Counter-metrics:** every KPI gets a guardrail — activation up ↔ support tickets flat; velocity up ↔ escape rate flat. Without a counter-metric, KPIs get gamed.
- **Vanity metric trap:** cumulative totals, registered users, and impressions are monotone and decision-free. Replace with period rates and cohort curves.
- **Good KPI bar:** (1) moves weekly, (2) has an owner, (3) has a target and a counter-metric, (4) is defined in one sentence with its denominator.

### 4.6 Insight Writing

- **Action titles:** a finding, not a topic. Bad: "Churn analysis". Good: "Churn doubled among users who never completed onboarding step 3". Bad: "Revenue by region". Good: "EMEA drove 80% of the Q3 revenue decline; APAC grew 9%".
- **So-what test:** after each finding, write "therefore we should…". If nothing fits, the finding is decoration — cut it or fold it into evidence.
- **One message per paragraph:** claim sentence → 1–3 evidence sentences (number, comparison, period) → implication sentence.
- **BLUF executive summary template:** (1) headline conclusion in one sentence; (2) 2–3 numbered proofs with magnitudes; (3) the ask: what decision/action is needed, by whom, when.
- **Numbers:** round to decision precision (say 12%, not 12.38%, unless the decimals carry the argument); ALWAYS give the comparison ("12% YoY" not "12%"); state the period on every number.

### 4.7 Report Architecture

1. **Question** — the decision this analysis serves.
2. **Method** — data sources, period, cleaning choices, limitations (3–6 lines; details to appendix).
3. **Findings** — numbered F1, F2, F3…; each: action title → evidence → so-what. Order by decision importance, not by computation order.
4. **Implications** — what the findings mean together; risks and what would change the conclusion.
5. **Recommendations** — table: action, owner, effort (S/M/L), impact (estimate + arithmetic), first step.
6. **Appendix** — queries, full tables, cohort grids, outlier log.
Executive summary sits on top and is written LAST, after the findings stabilize.

### 4.8 Bias & Quality

- **Survivorship bias:** analyzing only current customers erases churners; ALWAYS include the churned cohort or state the exclusion.
- **Selection bias:** survey respondents ≠ customers; app users ≠ all users. State who is missing from the data.
- **Seasonality vs trend:** decompose before judging (§9.1); a −10% MoM in retail January is usually calendar, not collapse. Rules: MoM for fast-moving products, YoY for seasonal ones; label both when presenting both.
- **Cherry-picking:** report the full window you queried; if a sub-window is highlighted, show it in context of the whole.
- **Sample-size sanity:** rates need expected counts ≥5 per cell (chi-square) and n≥30–50 per arm (means); state n next to every percentage.
- **Gaming and instrumentation:** verify the metric's tracking event actually fired (compare against a second source) before analyzing a sudden change — 20% of "anomalies" are broken pipelines.

### 4.9 pandas Recipes

```python
# Segment summary in one pass
summary = (df.groupby(["region", "segment"], as_index=False)
             .agg(revenue=("revenue_usd", "sum"),
                  orders=("order_id", "nunique"),
                  aov=("revenue_usd", "mean"),
                  buyers=("user_id", "nunique")))

# Pivot with margins for the total row
pivot = df.pivot_table(index="region", columns="month", values="revenue_usd",
                       aggfunc="sum", fill_value=0, margins=True, margins_name="Total")

# Time resampling: weekly revenue + 4-week rolling median
weekly = (df.set_index("order_date")["revenue_usd"]
            .resample("W").sum().to_frame("revenue"))
weekly["roll4"] = weekly["revenue"].rolling(4).median()

# Banding with cut: AOV tiers with labels
df["aov_tier"] = pd.cut(df["aov"], bins=[0, 50, 200, 1000, np.inf],
                        labels=["<50", "50-200", "200-1k", "1k+"])

# Safe joins: validate grain to prevent silent row explosion
df = orders.merge(customers, on="customer_id", how="left", validate="m:1")
```

### 4.10 SQL Patterns

```sql
-- MoM change and share-of-total with window functions
SELECT
  month,
  region,
  revenue,
  revenue - LAG(revenue) OVER (PARTITION BY region ORDER BY month) AS mom_delta,
  ROUND(100.0 * (revenue - LAG(revenue) OVER (PARTITION BY region ORDER BY month))
        / NULLIF(LAG(revenue) OVER (PARTITION BY region ORDER BY month), 0), 1) AS mom_pct,
  RANK() OVER (PARTITION BY month ORDER BY revenue DESC) AS region_rank,
  ROUND(100.0 * revenue / NULLIF(SUM(revenue) OVER (PARTITION BY month), 0), 1) AS share_pct
FROM monthly_revenue
ORDER BY month, revenue DESC;
```
MUST use NULLIF around denominators — one zero division kills the whole query. Window functions compute MoM/rank/share without self-joins and stay readable in review.

### 4.11 Worked Mini-Examples

**Sales dip readout.** Question: "Revenue fell 18% MoM — why?" Method: orders table, both full months, deduped, currency normalized. Findings: F1 volume only −5%, AOV −14% → mix, not demand; F2 promo-bundle SKU share rose 12%→31% at half price; F3 EMEA −34% traced to one distributor stockout (their share fell 22%→6%). So-what: the dip is self-inflicted pricing plus supply, not market loss. Recommendation: cap bundle discount exposure, restock distributor (owner: Head of Supply, effort: S, impact: recovers ~60% of the gap = 0.6 × $810K); first step: confirm distributor PO today.

**Retention cohort readout.** Question: "Are new cohorts stickier?" Build the cohort grid (§5.4). Finding: M1 retention slid 32% (Jan cohort) → 21% (Jun cohort); M2 curve shapes are parallel, so the damage happens in month 1, not in later decay. Segment: the slide starts exactly with the May cohort; the May onboarding change removed the setup wizard. Recommendation: A/B revert of the wizard for new signups (owner: PM Growth, effort: M, impact: restore ~11pp M1 retention ≈ 11% more month-2 actives); first step: ship revert to 50% of signups this sprint.

**A/B test readout.** Checkout A 4.2% (n=50,000) vs B 4.6% (n=50,000): absolute +0.4pp, relative +9.5%, z≈3.1, p≈0.002, 95% CI [+0.15pp, +0.65pp]. Guardrails: AOV flat (−$0.30, n.s.), refund rate flat. So-what: worst plausible case (+0.15pp) still clears the rollout bar. Recommendation: ship B to 100% (owner: Eng, effort: S), keep the counter-metric dashboard live for 2 weeks; expected annualized impact = 0.004 × 600K checkouts/mo × 12 × $68 AOV contribution.

## 5. Code & Tool Templates

All snippets run as written with `pandas>=2.0`, `numpy>=1.24`, `scipy>=1.10`.

### 5.1 Reusable cleaning pipeline

```python
import pandas as pd
import numpy as np

def clean(df):
    """Audit-logged cleaning: every step keeps a count so the report can cite it."""
    log = {}
    df = df.copy()
    # 1. String hygiene — joins fail on untrimmed keys
    for col in df.select_dtypes("object"):
        df[col] = df[col].str.strip().str.replace(r"\s+", " ", regex=True)
    # 2. Exact duplicates
    before = len(df)
    df = df.drop_duplicates()
    log["exact_dupes_dropped"] = before - len(df)
    # 3. Explicit type coercion + audit of coerced nulls
    df["order_date"] = pd.to_datetime(df["order_date"], errors="coerce")
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    log["bad_dates"] = int(df["order_date"].isna().sum())
    log["bad_numbers"] = int(df["revenue"].isna().sum())
    # 4. Currency normalization (period-average rates; cite the source)
    rates = {"USD": 1.00, "EUR": 1.08, "GBP": 1.27}
    if "currency" in df:
        df["revenue_usd"] = df["revenue"] * df["currency"].map(rates)
    else:
        df["revenue_usd"] = df["revenue"]
    # 5. Missing values by rule: drop on the measure, flag categoricals
    before = len(df)
    df = df.dropna(subset=["revenue_usd", "order_date"])
    log["rows_dropped_missing_key_fields"] = before - len(df)
    df["region"] = df["region"].fillna("Unknown")
    # 6. Outliers: IQR fence, flagged — never silently deleted
    q1, q3 = df["revenue_usd"].quantile([0.25, 0.75])
    iqr = q3 - q1
    df["is_outlier"] = ~df["revenue_usd"].between(q1 - 1.5 * iqr, q3 + 1.5 * iqr)
    log["outliers_flagged"] = int(df["is_outlier"].sum())
    print(log)   # paste this log into the report appendix
    return df
```

### 5.2 One-pass EDA sweep

```python
def eda_sweep(df, target=None):
    print("SHAPE", df.shape)
    print("\nDTYPES\n", df.dtypes)
    miss = (df.isna().mean() * 100).round(1).sort_values(ascending=False)
    print("\nMISSING %\n", miss[miss > 0])
    num = df.select_dtypes("number")
    print("\nNUMERIC SUMMARY\n", num.describe().T[["mean", "50%", "std", "min", "max"]])
    print("\nSKEW (|skew|>1 → use median)\n", num.skew().round(2))
    if target and target in num:
        print("\nPEARSON vs target\n", num.corr()[target].drop(target).round(2))
        print("\nSPEARMAN vs target\n", num.corr(method="spearman")[target].drop(target).round(2))
    for col in df.select_dtypes("object"):
        print(f"\nTOP {col}\n", df[col].value_counts(normalize=True).head(5).round(3))
```

### 5.3 A/B test readout with effect size and CI

```python
from scipy import stats
import numpy as np

def ab_readout(conversions_a, n_a, conversions_b, n_b, alpha=0.05):
    """Two-proportion z-test + effect size + 95% CI, ready to paste into a report."""
    p_a, p_b = conversions_a / n_a, conversions_b / n_b
    lift = p_b - p_a
    rel = lift / p_a
    p_pool = (conversions_a + conversions_b) / (n_a + n_b)
    se_pool = np.sqrt(p_pool * (1 - p_pool) * (1 / n_a + 1 / n_b))
    z = lift / se_pool
    p_value = 2 * stats.norm.sf(abs(z))
    se_unpooled = np.sqrt(p_a * (1 - p_a) / n_a + p_b * (1 - p_b) / n_b)
    ci = (lift - 1.96 * se_unpooled, lift + 1.96 * se_unpooled)
    return {"p_a": p_a, "p_b": p_b, "abs_lift": lift, "rel_lift": rel,
            "z": z, "p_value": p_value, "ci95": ci}

r = ab_readout(2100, 50000, 2300, 50000)
print(f"B vs A: {r['abs_lift']:+.2%} abs ({r['rel_lift']:+.1%} rel), "
      f"z={r['z']:.2f}, p={r['p_value']:.4f}, "
      f"95% CI [{r['ci95'][0]:+.2%}, {r['ci95'][1]:+.2%}]")
```

### 5.4 Cohort retention grid

```python
def cohort_retention(orders, user_col="user_id", date_col="order_date"):
    """Rows = monthly cohorts, columns = months since first order, values = retention."""
    orders = orders.assign(period=orders[date_col].dt.to_period("M"))
    first = orders.groupby(user_col)[date_col].min().dt.to_period("M").rename("cohort")
    df = orders.join(first, on=user_col)
    df["month_index"] = (df["period"] - df["cohort"]).apply(lambda x: x.n)
    sizes = df.groupby("cohort")[user_col].nunique()
    ret = (df.pivot_table(index="cohort", columns="month_index",
                          values=user_col, aggfunc="nunique")
             .div(sizes, axis=0).round(3))
    return ret

# ret = cohort_retention(orders_df)
# Read M0 column = size sanity (must be 1.0); read the diagonal down = same calendar month.
```

### 5.5 Confidence interval for a mean (bootstrap, distribution-free)

```python
def ci95_mean(x, n_boot=10_000, seed=0):
    rng = np.random.default_rng(seed)
    x = np.asarray(x, dtype=float)
    boots = rng.choice(x, size=(n_boot, len(x)), replace=True).mean(axis=1)
    return float(np.mean(x)), tuple(np.percentile(boots, [2.5, 97.5]))

# mean, (lo, hi) = ci95_mean(df.loc[df.region == "EMEA", "revenue_usd"])
# Report: "$212 (95% CI $198–$226)" — never a bare mean for skewed data.
```

### 5.6 SQL: cohort sizes and month-1 retention

```sql
WITH first_order AS (
  SELECT user_id, DATE_TRUNC('month', MIN(order_date)) AS cohort
  FROM orders GROUP BY user_id
),
activity AS (
  SELECT o.user_id, f.cohort,
         (DATE_PART('year', AGE(DATE_TRUNC('month', o.order_date), f.cohort)) * 12
          + DATE_PART('month', AGE(DATE_TRUNC('month', o.order_date), f.cohort))) AS month_index
  FROM orders o JOIN first_order f ON o.user_id = f.user_id
)
SELECT cohort,
       COUNT(DISTINCT CASE WHEN month_index = 0 THEN user_id END) AS size,
       ROUND(100.0 * COUNT(DISTINCT CASE WHEN month_index = 1 THEN user_id END)
             / NULLIF(COUNT(DISTINCT CASE WHEN month_index = 0 THEN user_id END), 0), 1) AS m1_retention_pct
FROM activity GROUP BY cohort ORDER BY cohort;
```

### 5.7 Report skeleton (fill, never freestyle)

```markdown
# [Decision at stake] — Analysis
**Question:** [one sentence] · **Data:** [source, period, grain] · **Date:** [YYYY-MM-DD]

## Executive summary
[Conclusion in one sentence.] Proof: (1) [number + comparison]; (2) [number]; (3) [number].
**Ask:** [action] — owner [role], decision needed by [date].

## Findings
**F1. [Action title stating the finding.]** Evidence: [number, vs baseline, period]. So-what: [implication].
**F2. …** · **F3. …**

## Recommendations
| # | Action | Owner | Effort | Impact (est.) | First step |
|---|--------|-------|--------|---------------|------------|

## Method & limitations
[Cleaning log, exclusions, sample sizes, caveats.]
```

## 6. Decision Tables

**Table A — Statistical test chooser**

| Data / question | Test | Key check | Report |
|---|---|---|---|
| 2 means, n≥30/group | Welch t-test (`equal_var=False`) | skew moderate | diff + 95% CI + d |
| 2 proportions (A/B) | two-proportion z | n·p≥5 per arm | lift + CI |
| 3+ means | ANOVA + Tukey HSD | residuals ~normal | pairwise diffs |
| 2 categorical | chi-square | expected ≥5/cell | Cramér's V |
| skewed / small n | Mann–Whitney U or bootstrap | — | median diff + CI |
| monotonic association | Spearman ρ | — | ρ + scatter |

**Table B — Missing-data strategy**

| Missing share | Column type | Action | Justification |
|---|---|---|---|
| <5% | any, MCAR | drop rows | negligible power loss |
| 5–30% | numeric | median/mean/model impute, flagged | keeps sample; imputation documented |
| 5–30% | categorical | "Unknown" category | missingness may itself be signal |
| >30% | any | drop column, report as finding | imputation would invent the column |
| time series gap ≤2 | numeric | linear interpolate | continuity assumption reasonable |
| time series gap >2 | numeric | leave gap, annotate | interpolation would fabricate trend |

**Table C — Central tendency chooser**

| Distribution | Statistic | Example |
|---|---|---|
| Symmetric (skew ≈ 0) | mean | heights, sensor errors |
| Right-skewed (skew > 1) | median + P90 | revenue per user, latency |
| Bimodal | both modes reported | order values with two segments |
| Rates on small n | raw counts + CI | "3/4 users" never "75%" |
| Heavy tails | trimmed mean or median | response times with hangs |

**Table D — Recommendation framing**

| Evidence strength | Wording | Commitment |
|---|---|---|
| Strong (large effect, tight CI, replicated in segments) | "Do X — expected impact Y" | full rollout |
| Moderate (significant, effect small or one segment) | "Pilot X on [segment]" | 2–4 week pilot + guardrails |
| Directional (small n, wide CI) | "Probe X: [specific next query/experiment]" | cheap test, dated |
| Conflicting evidence | "Decision blocked on [specific unknown]" | named owner resolves it |

## 7. Quality Checklist

Verify EVERY item before delivering:

- [ ] The question and the decision it serves are written at the top
- [ ] Data grain verified (one row = one stated entity); joins validated (`validate="m:1"` or SQL uniqueness check)
- [ ] Cleaning log produced: duplicates, coerced nulls, dropped rows, flagged outliers — with counts
- [ ] Every headline number has its period and comparison (YoY/MoM vs target)
- [ ] No partial-period vs full-period comparison anywhere
- [ ] Mean replaced by median (or accompanied) where |skew| > 1
- [ ] Every p-value accompanied by effect size and confidence interval
- [ ] Percentages on n<30 replaced by counts + CI or dropped
- [ ] Headline numbers disaggregated by the 2–4 actionable segments; Simpson's check done
- [ ] Seasonality considered: seasonal business uses YoY; decomposition or calendar check for MoM claims
- [ ] Every finding title states the finding (a sentence with a direction), not the topic
- [ ] Every finding passes the so-what test or was cut
- [ ] Recommendations have owner, effort (S/M/L), impact estimate with arithmetic, and a first step
- [ ] Executive summary ≤150 words, written last, states conclusion + ask
- [ ] Every number re-traced to source: query or computation reproducible
- [ ] Uncertainty stated on all key numbers; estimates labeled as estimates
- [ ] Counter-metric / guardrail checked for any success claim (A/B, KPI)
- [ ] Appendix contains queries, cohort grids, and the cleaning log

## 8. Common Mistakes & Fixes

1. **Averaging skewed data** → "average revenue $212" while 90% of users are below it → median + P90; state skew.
2. **Comparing partial month to full month** → fake collapse on the 15th → time-gate both sides to identical windows.
3. **Reading seasonality as trend** → "December spike proves growth" → YoY for seasonal series; decompose (§9.1) before claiming.
4. **p<0.05 → "proven"** → overconfident ship decisions → report effect size + CI; treat p as one input, not the verdict.
5. **Testing 20 segments, celebrating the winner** → false positive by construction → pre-register the primary segment or Bonferroni-correct (α/20).
6. **Joining at the wrong grain** → revenue doubles after a merge → validate uniqueness of the join key before merging; check row-count deltas.
7. **Dropping outliers silently** → results shift, reader can't reproduce → flag + report counts + rerun without them to show robustness.
8. **Imputing 40% of a column** → invented data drives the conclusion → drop the column, report missingness as a finding.
9. **Survivorship bias** → "loyal users love us" (churners excluded) → include churned cohorts or state the exclusion explicitly.
10. **Percentage on n=12** → 58% swings ±28 points on 5 responses → show counts, widen CI, or refuse the rate.
11. **Topic titles ("Revenue analysis")** → executives skip the section → rewrite as findings ("EMEA drove 80% of the decline…").
12. **Correlation presented as cause** → "chat usage doubles retention, add chat" → check time order, segments, confounders; run the experiment before causal wording.
13. **Funnel steps from different cohorts** → conversion >100% artifacts → compute every step from one fixed cohort entering step 1.
14. **Ending with numbers** → reader asks "so what do we do?" → every analysis closes with owned, effort-sized, impact-estimated recommendations.

## 9. Advanced Techniques

### 9.1 Seasonal Decomposition Before Any Trend Claim
```python
from statsmodels.tsa.seasonal import STL
series = (df.set_index("order_date")["revenue_usd"].resample("MS").sum())
res = STL(series, period=12, robust=True).fit()
# res.trend = underlying level; res.seasonal = repeating pattern; series - res.seasonal = seasonally adjusted
```
Judge the trend on `res.trend` or the seasonally adjusted series, never the raw line; quote the seasonal component's amplitude ("December averages +22%") so the reader stops re-discovering it monthly.

### 9.2 Funnel Step Decomposition
Overall conversion = product of step conversions. Compute each step's conversion for two periods; the step whose ratio explains most of the total change is the finding. In pandas: `steps.pivot_table(index="step", columns="period", values="conv")` then `ratio = p2 / p1` sorted descending. Fixing one broken step beats optimizing five mediocre ones — the arithmetic proves where to spend.

### 9.3 Simpson's Paradox Detector
Compare the pooled relationship with segment-level ones: compute `corr(x, y)` overall and within each segment of the confounder (e.g., traffic source). If signs or orderings flip, the aggregate is lying — lead the report with the segmented view and name the confounder. Classic trigger: aggregated conversion rates across channels with very different volumes shifting share between periods.

### 9.4 KPI Tree Construction
Decompose the north star multiplicatively: `Revenue = Users × Conversion × AOV × Purchase frequency`. Attach each leaf to an owner and a counter-metric, then diagnose dips by computing each factor's period-over-period ratio — the dip lives in whichever factor fell. This turns "revenue is down" into "conversion fell 6% in the Pro segment" in one table.

### 9.5 RFM Segmentation in pandas
```python
snapshot = df["order_date"].max()
rfm = df.groupby("user_id").agg(
    recency=("order_date", lambda s: (snapshot - s.max()).days),
    frequency=("order_id", "nunique"),
    monetary=("revenue_usd", "sum"))
rfm["R"] = pd.qcut(rfm["recency"], 5, labels=[5, 4, 3, 2, 1])
rfm["F"] = pd.qcut(rfm["frequency"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5])
rfm["M"] = pd.qcut(rfm["monetary"], 5, labels=[1, 2, 3, 4, 5])
rfm["score"] = rfm["R"].astype(str) + rfm["F"].astype(str) + rfm["M"].astype(str)
```
Act on named cells: 1xx → win-back campaign; x5x → frequency push; 555 → VIP program. Report segment sizes and revenue share per cell, not the raw grid.

### 9.6 Cohort Curve Reading
Flat-lining retention curves (plateau by M3) = sticky product; continuously declining curves = leaky bucket that no acquisition fixes; curves that flatten higher cohort over cohort = improving product. ALWAYS overlay ≥3 cohorts on one chart with shared x (months since start), and annotate the shipping dates of product changes on the same axis to link curve shifts to causes.

## 10. Quick Reference Card

```
LOOP:    question → data → clean(log) → EDA → analyze → insight → so-what → recommendation
CLEAN:   <5% drop rows | 5-30% impute+flag | >30% drop column | outliers IQR 1.5× fence, flag not delete
         dedupe on natural key | coerce types + audit | normalize currency/units | parse dates explicitly
EDA:     univariate (skew!) → bivariate (Pearson vs Spearman) → segments (Simpson check) → time sanity
TESTS:   2 means → Welch t | 2 props → z | 3+ means → ANOVA+Tukey | 2 cats → chi² | skewed → Mann-Whitney/bootstrap
STATS:   p = P(data|H0) ≠ P(H0 true) | effect size + CI with every p | n≥30 arm | expected ≥5/cell
         median when |skew|>1 | counts when n<30
WRITE:   title = finding | one message per paragraph | BLUF ≤150 words | so-what test | period on every number
RECS:    owner + effort S/M/L + impact with arithmetic + first step this week
BIAS:    survivorship → include churned | selection → state who's missing | seasonality → YoY
         cherry-picking → show full window | small n → CI
pandas:  groupby().agg(name=("col", fn)) | pivot_table(margins=True) | merge(validate="m:1")
         resample("W") | pd.cut(bins, labels) | rolling(4).median()
SQL:     LAG() OVER (PARTITION BY … ORDER BY month) for MoM | NULLIF every denominator
         RANK() OVER (PARTITION BY month ORDER BY revenue DESC) | SUM() OVER () for shares
```

