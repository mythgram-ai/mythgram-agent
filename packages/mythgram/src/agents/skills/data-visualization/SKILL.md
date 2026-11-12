---
name: data-visualization
description: >
  Produces accurate, readable, decision-driving charts and dashboards from any
  tabular or numeric data, and repairs charts that fail those standards. Covers
  the full pipeline end to end: chart-type selection through a strict decision
  tree (comparison to bar, trend over time to line, distribution to
  histogram/box/violin/ECDF, relationship to scatter, part-of-whole to stacked
  bar, correlation matrix to heatmap, geography to choropleth, single number to
  KPI card); figure construction with matplotlib's object-oriented API,
  seaborn, plotly express, and Apache ECharts; colorblind-safe color systems
  (viridis/cividis, Okabe-Ito; sequential vs diverging vs categorical
  palettes); axis and typography engineering (zero baselines, tick density, SI
  units, takeaway titles); emphasis and annotation (highlight-one-dim-the-rest,
  direct labeling, reference lines, small multiples); statistical graphics
  (box vs violin vs ECDF, Freedman-Diaconis binwidth, error bars and confidence
  intervals, regression with residuals); dashboard layout (KPI cards,
  12-column grid, F-pattern, 5-second rule); large-data strategies (opacity,
  hexbin, 2D histograms, downsampling); and production export (150/300 DPI,
  PNG/SVG/PDF, CJK-safe fonts). Use this whenever the user says "plot",
  "chart", "visualize", "graph", "make a figure", "show me the trend", "draw a
  heatmap", "compare these distributions", "make a dashboard", "what chart
  should I use", or wants any PNG/SVG/PDF/interactive chart as the deliverable.
  Also use it to repair broken charts (overlapping labels, clipped text,
  truncated axes, rainbow colors) and to QA rendered figures. Do NOT use it
  for .xlsx files with embedded native Excel charts — that is excel-creator's
  job; do NOT use it for slide decks — that is pptx-creator's job; do NOT use
  it for AI-generated artistic or illustrative images — that is
  image-generator's job; do NOT use it for the statistical analysis itself —
  that is information-analyst's job, whose findings this skill then
  visualizes.
---

# Data Visualization

> Convert data into a visual argument that lands in five seconds: the right chart type, colorblind-safe color, honest axes, zero clutter, and a title that states the takeaway.

## 0. Operating Rules (Non-Negotiable)

1. **ALWAYS render and visually inspect before delivering. NEVER hand over an unrendered chart.** Overlapping labels, clipped text, and missing units are invisible in code and obvious in the image; since a chart is a visual artifact, visual QA is the only QA that counts. Save to a file, inspect it, fix, re-render.
2. **MUST start bar-chart value axes at 0.** Bar length is the encoding channel: with the axis starting at 90, bars of 95 and 92 render with a 2.5:1 length ratio while the true data ratio is 1.03:1 — a lie factor of about 2.4x. Line charts MAY use a non-zero baseline because position on a shared scale, not length, carries the signal.
3. **NEVER use rainbow/Jet/hsv colormaps for ordered data.** Hue jumps inside a continuous scale create fake boundaries, distort perceived magnitude, and are illegible to color-blind readers. Use `viridis` or `cividis` for sequential data and `RdBu_r` centered on a meaningful midpoint for diverging data.
4. **MUST title every chart with the takeaway, not the topic.** "Churn doubled among users who never completed onboarding" — not "Churn analysis". Readers scan titles and skip the rest; a topic title wastes the only text they will read.
5. **MUST label both axes with quantity AND unit** ("Revenue (USD millions)", "Latency (ms)"). A chart without units forces guessing and enables 1000x misreads.
6. **MUST use colorblind-safe palettes and cap categorical series at 7.** Beyond 7 hues, adjacent colors become indistinguishable and the legend turns into spaghetti. Use the Okabe-Ito hexes or viridis-derived palettes.
7. **NEVER use 3D pies, exploded pies, or side-by-side pies.** Angle and area are weak decoding channels; 3D perspective makes the front slice look bigger. Use a bar chart instead — position and length are the most accurately decoded channels (Cleveland & McGill).
8. **MUST size figures and DPI for the destination:** 150 DPI for screens, 300 DPI for print, fonts at least 10 pt at final size. A 12x6-inch figure squeezed into a 6-inch slide column renders unreadable 5-pt text.
9. **NEVER mix plotting libraries in one figure** (e.g., matplotlib axes + plotly figure) and **NEVER combine `plt.tight_layout()` with `constrained_layout=True`** — they fight over layout and clip content. Default to matplotlib's object-oriented API with `constrained_layout=True`.
10. **MUST choose one library per deliverable and stay with it:** matplotlib/seaborn for static PNG/SVG/PDF, plotly express for interactive HTML, ECharts for web dashboards. Each library has different default colors and fonts; mixing them inside one report looks broken.
11. **NEVER invent, extrapolate, or smooth data to make a chart look better.** Plot exactly the values in the source and add a source note ("Source: orders table, 2024-01-01 to 2024-12-31") so every pixel is traceable.
12. **MUST run the QA loop — render → inspect (overlap? clipped text? units? zero baseline? color?) → fix → re-render — at least once**, twice for anything customer-facing.

## 1. When to Use / When Not To

**Use this skill when:**
- The deliverable is a data-driven image (PNG/SVG/PDF) or an interactive HTML chart.
- The user asks "what chart should I use for…?", "how do I make this readable?", "why does my plot look wrong?"
- A rendered chart has overlapping labels, unreadable fonts, a truncated bar axis, rainbow colors, or legend soup and must be repaired.
- A dashboard view (KPI cards + trend + breakdown panels) must be produced from a dataframe.
- Charts must be embedded in a report, notebook, README, or web page.

**Do NOT use when the request is really about:**

| Request is about | Route to | Why |
|---|---|---|
| .xlsx workbook with native Excel charts, formulas, conditional formatting | excel-creator | Excel charts live inside the workbook and stay linked to sheet data; a matplotlib PNG pasted into a cell is a dead picture |
| Slide decks, speaker notes, deck-wide theming | pptx-creator | The deck pipeline controls layout and fonts; it consumes this skill's exported images |
| AI-generated artistic or illustrative images with no data mapping | image-generator | No quantitative encoding is involved |
| Which statistic to compute, significance testing, insight wording, recommendations | information-analyst | That skill decides WHAT the number means; this skill decides HOW it looks |
| Finding facts or datasets on the web | deep-researcher / web-researcher | Data acquisition is a separate pipeline |

## 2. Core Concepts & Mental Models

### 2.1 Marks, Channels, and Decoding Accuracy
Every chart places **marks** (points, lines, bars) onto **channels** (position, length, angle, area, color). Human decoding accuracy is ranked (Cleveland & McGill, 1984); ALWAYS encode the most important quantity in the most accurate channel:

| Rank | Channel | Accuracy | Use it for | Avoid it for |
|---|---|---|---|---|
| 1 | Position on common scale | Best | scatter, dot plot, line endpoints | — |
| 2 | Length | Very good | bar charts | values within 2% of each other |
| 3 | Angle | Moderate | — (skip pie charts) | any precise comparison |
| 4 | Area | Poor | bubble maps (ALWAYS label values) | precise reading |
| 5 | Hue / saturation | Worst | heatmaps (print values in cells) | any precise reading |

### 2.2 The 5-Second Rule
A business chart must answer its question within 5 seconds of being seen. If a viewer needs the legend plus both axes plus 30 seconds, redesign: reduce series count, direct-label the lines, or split into small multiples. Complexity budget: one message per chart.

### 2.3 Data–Ink Ratio and Chartjunk
Every pixel that does not carry data (heavy gridlines, 3D effects, decorative icons, double borders, gradient backgrounds) competes with the data for attention. Maximize data–ink (Tufte): light y-grid only (alpha ≤ 0.25), no top/right spines, no chart borders, no background fills that fight the marks.

### 2.4 Grammar of Graphics (how the libraries think)
Data → aesthetic mapping (x, y, color, size) → geometry (bar/line/point) → scale (linear/log) → facet (small multiples). seaborn and plotly express implement this grammar; once internalized, "x=date, y=revenue, color=region, facet=country" translates directly into code without hunting Stack Overflow.

### 2.5 Variable Type → Palette Type
| Data type | Examples | Palette | NEVER use |
|---|---|---|---|
| Categorical (unordered) | region, channel, plan | Okabe-Ito, tab10, max 7 | viridis (implies order), rainbow |
| Ordinal | low/med/high, 1–5 stars | viridis, Blues (cropped range) | unrelated hues |
| Sequential quantitative | revenue, density, count | viridis, cividis, Blues | RdBu (implies a midpoint), rainbow |
| Diverging around a midpoint | delta vs target, correlations | RdBu_r, coolwarm centered at 0 | viridis (hides the midpoint) |

### 2.6 Lie Factor
Lie factor = (size of effect shown on canvas) ÷ (size of effect in the data). Anything far from 1.0 is distortion. Truncated bar axes, dual axes with mismatched scales, and 3D perspective all inflate it. Compute it mentally before shipping: does the visual jump match the numeric jump?

## 3. Mandatory Workflow

1. **Clarify the question, audience, and destination.** MUST write down: what decision the viewer makes, where the chart appears (slide/report/web), and how it will be read (glance vs study). Why: chart type, figure size, and DPI all follow from the destination, not from the data.
2. **Match chart type to question using the decision tree (§4.1).** NEVER pick a chart because it looks impressive. Why: every chart type answers one specific question; mismatched encoding is the #1 cause of misleading charts.
3. **Prepare the data.** MUST aggregate to the plotted granularity, sort bars descending (or by natural order for ordinals), resample time series to a regular frequency, and handle nulls deliberately (drop or flag, never silently). NEVER plot more than 10k raw points without the §4.8 strategies. Why: messy input produces charts that lie by accident.
4. **Pick the library (§4.2) and open the figure with the object-oriented API:** `fig, ax = plt.subplots(figsize=..., constrained_layout=True)`. NEVER use the pyplot state machine (`plt.plot()` + `plt.title()`) for multi-axes work. Why: the OO API handles multi-panel layouts deterministically and keeps every reference explicit.
5. **Style systematically:** palette by variable type (§4.3), zero baseline for bars, 4–8 y-ticks via `ax.yaxis.set_major_locator(MaxNLocator(5))`, axis labels with units, bold left-aligned takeaway title. Why: consistent styling is what separates a professional figure set from homework.
6. **Emphasize the argument:** highlight the one series/bar that matters, mute the rest to gray, direct-label instead of using a legend where possible, add at most 3 annotations (reference line, callout, last-point label). Why: emphasis is how a chart states its claim; uniform styling states nothing.
7. **Render and QA (Rule 12 loop):** save a working PNG, inspect for overlapping labels, clipped text, missing units, wrong baseline, legend order not matching data order; fix and re-render. NEVER skip this on deadline pressure. Why: every skipped QA pass ships visible defects.
8. **Export at destination settings** (150 DPI screen / 300 DPI print; SVG or PDF for vector; `facecolor="white"`) and append the source note. Why: 72-DPI screenshots look amateur, print badly, and cannot be scaled.

## 4. Deep Knowledge Library

### 4.1 Chart Selection Decision Tree

| # | The question | Chart | Notes |
|---|---|---|---|
| 1 | Compare a metric across categories | Horizontal bar, sorted descending | >15 categories → top-N + "Other"; label values at bar ends |
| 2 | Compare across two categorical dimensions | Grouped bar (≤3 series) or heatmap (many) | Grouped bar dies past 4 series; switch to heatmap |
| 3 | Trend over time, one series | Line with direct end label | NEVER use bar-per-month for a trend question |
| 4 | Trend, 2–5 series | Multi-line, muted palette, direct labels | Order legend by final value, or drop legend |
| 5 | Trend, >5 series | Small multiples grid | Shared axes; one highlighted panel |
| 6 | Distribution, one variable | Histogram (state binwidth) or ECDF for n>1000 | ALWAYS state binwidth; KDE overlay optional |
| 7 | Distribution, 2–6 groups | Overlaid ECDF or box/violin | ECDF overlaps read better than histograms |
| 8 | Distribution, many groups | Boxplot grid, sorted by median | Rotate category labels 45° ha="right" only if needed |
| 9 | Relationship, two numerics | Scatter + trendline | alpha=0.3 past 1k points; hexbin past 10k |
| 10 | Relationship, three numerics | Scatter with size channel (label bubbles) or facet | NEVER encode the third variable by color hue |
| 11 | Part-of-whole, ≤5 slices | 100% stacked bar, or pie ONLY if ≤5 slices and no two adjacent slices within 2% | NEVER more than 5 pie slices |
| 12 | Composition over time | Stacked area (total matters) or stacked bar (rows matter) | Stack order: largest at bottom, most volatile on top |
| 13 | Correlation matrix | Heatmap, RdBu_r, vmin=-1, vmax=1, values printed in cells | Diverging centered at 0 |
| 14 | Geographic pattern | Choropleth, sequential palette, legend with units | NEVER color countries by rank; color by value |
| 15 | One important number | KPI card with delta vs previous period | Big number + small context line |
| 16 | Flow through stages | Horizontal funnel bar with conversion % between stages | Show step-to-step drop, not only totals |
| 17 | Rank change between two periods | Slope graph or dumbbell | Direct-label both ends |

Hard decision rules: pie ONLY when ≤5 slices AND the smallest is visually distinct; NEVER a pie for time series; NEVER a line for unordered categories; NEVER stack bars that do not sum to something meaningful.

### 4.2 Library Routing

| Library | Use when | Strengths | Gotchas |
|---|---|---|---|
| matplotlib (OO API) | Static images for docs, slides, reports; pixel control | Every chart possible; vector output; ubiquitous | Verbose; use constrained_layout=True; set backend Agg headless |
| seaborn | Statistical graphics on dataframes | Distributional and categorical plots with CIs built in | Wraps matplotlib; set theme once via sns.set_theme(), then override |
| plotly express | Interactive HTML for stakeholders | Hover, zoom, pan, filter for free | Heavy HTML files; not for print; export PNG needs kaleido |
| Apache ECharts | Web dashboards | Responsive, dark mode, rich interactivity | JSON config model; server-side PNG export needs a snapshot service |

### 4.3 Color System

- **Categorical default (Okabe-Ito, colorblind-safe):** `["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"]` — use in this order, stop at 7.
- **Sequential default:** `viridis`; **colorblind-optimal:** `cividis`; **diverging default:** `RdBu_r` with `vmin`/`vmax` symmetric around the meaningful midpoint (0 for deltas, −1/+1 for correlations).
- **Highlight + gray:** highlight color `#D55E00` (orange) or `#0072B2` (blue); context color `#C3CDDC` (light gray-blue). This is the single most effective emphasis technique.
- **60-30-10 rule:** ~60% of the canvas neutral (background, muted bars), ~30% secondary structure (grid, axis, secondary series), ~10% accent on the ONE element that carries the message.
- **Cultural caveat on red/green:** red = bad/loss in Western finance, but red = gain/up in Chinese stock-market convention. For global audiences, NEVER rely on hue alone — pair color with an explicit marker (triangle + signed percentage).
- NEVER use rainbow for ordered data; NEVER use a diverging palette for data without a meaningful midpoint.

### 4.4 Axes, Scales & Typography

- **Zero baseline for bars is mandatory.** Truncation math: bars of 92 and 95 on an axis starting at 90 render at lengths 2 and 5 (ratio 2.5) versus true ratio 1.03 — the visual overstates the difference ~2.4x.
- **Tick density:** 4–8 ticks per axis. `ax.yaxis.set_major_locator(MaxNLocator(5))`; for dates use `AutoDateLocator` + `ConciseDateFormatter` (gives "2024-Mar" style ticks without rotation).
- **SI units:** convert 4,580,000 to 4.58 and label "Revenue (USD millions)"; do not print raw 7-digit numbers on ticks.
- **Log scales:** only for strictly positive, multiplicative data; MUST state "(log scale)" in the axis label; NEVER use log axes for bar charts (length channel breaks); log(0) is −inf so clip or use `symlog` for signed data.
- **Typography:** fonts ≥10 pt at final size; title 13–14 pt bold, left-aligned; axis labels 10–11 pt; annotation 9–10 pt. Avoid rotated labels entirely when possible ("Jan", "Feb" beat "January" at 45°); if unavoidable, `rotation=45, ha="right"`.
- **Grid:** y-only, alpha 0.25, drawn behind data (`ax.set_axisbelow(True)`).

### 4.5 Emphasis & Annotation

- **Highlight-one-dim-the-rest:** saturate the bar/line that carries the message, gray out everything else. Readers find the point in under a second.
- **Direct labeling beats legends** for ≤5 series: annotate each line at its right end with the series name in series color, then delete the legend. Reserve legends for >5 series or dense scatter groups.
- **Reference lines:** `ax.axhline(target, ls="--", lw=1.2, color="#666666")` plus a short inline label ("target 400") at the right edge — context the viewer would otherwise lack.
- **Callouts:** at most 3 per chart; use `ax.annotate(text, xy=(x, y), xytext=(offset), arrowprops=dict(arrowstyle="->"))`. Every annotation MUST add meaning, not decoration.
- **Small multiples** when comparing more than 4 groups over time: same x/y scales everywhere, group name as panel title, one panel highlighted.

### 4.6 Statistical Graphics

| Plot | Shows | Use when | Watch out |
|---|---|---|---|
| Boxplot | median, IQR, outliers | n ≥ 20 per group; many groups | Hides multimodality; small n makes quartiles meaningless |
| Violin | full density shape | n ≥ 50; showing shape differences | KDE tails can imply impossible values — set `cut=0` |
| ECDF | every data point, no bins | n > 1000; overlapping distributions | Needs a legend/label; less familiar to business readers |
| Histogram | binned counts | n ≥ 30 | Binwidth choice changes the story — ALWAYS state it |

- **Binwidth:** Freedman–Diaconis rule `binwidth = 2 * IQR * n**(-1/3)`; in seaborn pass `binwidth=` explicitly; NEVER ship `bins=10` defaults unexamined.
- **Error bars:** 95% CI ≈ 1.96 × SEM for n ≥ 30; MUST state in the caption what the bars represent ("95% CI"). NEVER show plain ±1 SD and call it an interval of the mean.
- **Regression:** `sns.regplot(..., ci=95)` draws the fit plus confidence band; ALWAYS inspect residuals with `sns.residplot` for curvature before quoting r; correlation ≠ causation belongs in the caption when the chart could imply causality.

### 4.7 Dashboard Layout

- **Reading order:** KPI row (4–6 cards) → main trend → component breakdowns → detail table. This matches the F-pattern: eyes sweep the top row, then scan the left edge downward.
- **Grid:** 12-column grid; panels span 12/8/6/4/3 columns; consistent gutters; every panel gets a one-line takeaway title.
- **5-second rule per panel:** one message per panel; if a panel needs a paragraph, split it.
- **Consistency:** one palette, one date format, one number format across ALL panels; series colors keep the same meaning everywhere.
- **Interactivity:** date-range filter top-left, cross-filtering between panels, drill-down on KPI cards, hover for exact values — interactivity serves exploration, the static top row serves the headline.
- **Number formats:** currency abbreviated ($4.6M), percentages one decimal (12.4%), deltas signed (+12.4%).

### 4.8 Large-Data Strategies

| Points in the plot | Strategy | Parameters |
|---|---|---|
| ≤ 1,000 | plain scatter | s=20, alpha=0.8 |
| 1,000–10,000 | transparent scatter | alpha=0.3, s=15, `rasterized=True` for vector export |
| 10,000–100,000 | hexbin or 2D histogram | `ax.hexbin(x, y, gridsize=50, cmap="viridis", mincnt=1)` or `ax.hist2d(x, y, bins=60, cmap="viridis")` |
| > 100,000 | downsample or kernel density | `df.sample(50000, random_state=42)` + note in caption; or `sns.kdeplot(x, y, fill=True, cmap="viridis")` |

- **Time series:** `df.resample("W")["rev"].mean()` to a regular frequency; overlay a rolling median (`df["rev"].rolling(7).median()`) to tame noise.
- **Log-scale caveats:** zero and negative values break log axes (log(0) → −inf); clip to a small positive floor, use `symlog`, or plot |value| with sign encoded by color; NEVER hide the clipping — say it in the axis label.
- **Duplicates at the same (x, y):** scatter hides them; a 2D histogram or hexbin reveals them.

### 4.9 Rendering & Export

| Destination | Format | DPI | Notes |
|---|---|---|---|
| Screen / web / chat | PNG | 150 | `fig.savefig("out.png", dpi=150, facecolor="white")` |
| Print report / PDF doc | PDF or SVG | vector | embeds infinitely scalable; fonts embedded |
| Slide deck | PNG | 300 | size the figure to the placement (e.g., 8x4.5 in for a half-slide) |
| Poster / large print | PDF/SVG | vector | fonts must be embedded; test at 100% |

- Export one-liner: `fig.savefig(path, dpi=300, facecolor="white", bbox_inches=None)` — with `constrained_layout=True` you do NOT need `bbox_inches="tight"`, and NEVER call `plt.tight_layout()` on the same figure.
- Multi-page PDF: `from matplotlib.backends.backend_pdf import PdfPages`, then `with PdfPages("report.pdf") as pdf: pdf.savefig(fig)`.
- **CJK/Unicode fonts:** register the font file once, then point rcParams at it and disable the Unicode minus glyph, which CJK fonts lack:
```python
from matplotlib import font_manager
font_manager.fontManager.addfont("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
plt.rcParams["font.sans-serif"] = ["Noto Sans CJK SC", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False
```

### 4.10 Anti-Pattern Gallery

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| 3D pie chart | perspective inflates front slices; angle channel is weak | 2D bar chart |
| Two pies side by side | humans cannot compare angles across pies | grouped or stacked bar |
| Truncated bar axis | length lies about magnitude | `ax.set_ylim(0, max*1.15)` |
| Dual y-axis misuse | two scales imply a causal lockstep that may be an artifact | two stacked panels sharing the x-axis |
| Rainbow colormap | fake bands, order unclear, color-blind hostile | viridis / cividis |
| Legend spaghetti (10+ entries) | reader ping-pongs between legend and lines | direct labels or small multiples |
| Chartjunk (3D, shadows, icons) | steals attention from the data | flat marks, light grid only |
| Heavy full grid both axes | moiré noise; bars get lost | y-grid only, alpha 0.25 |
| 90°-rotated tick labels | head-tilt reading; often clipped | shorter labels or horizontal bars |
| Pie for time series | angle encodes nothing over time | line or stacked area |
| Unlabeled error bars | viewer cannot know what they mean | state "95% CI" in caption |
| Default gray matplotlib look | signals "unreviewed draft" | rcParams house style (§5.1) |

## 5. Code & Tool Templates

All templates assume the setup header below has been executed once. Every snippet runs as written with `matplotlib>=3.5`, `seaborn>=0.12`, `pandas>=2.0`, `numpy>=1.24`.

### 5.1 Setup header: backend, house style, CJK fonts

```python
import matplotlib
matplotlib.use("Agg")                      # headless-safe backend; MUST precede pyplot import
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
import numpy as np
import pandas as pd

plt.rcParams.update({
    "figure.figsize": (8, 4.5),            # fits a report text column
    "figure.dpi": 150,                     # working resolution for QA renders
    "savefig.dpi": 300,                    # production export resolution
    "font.size": 11,
    "axes.labelsize": 11,
    "axes.titlesize": 13,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "axes.grid.axis": "y",                 # y-grid only: aids reading, hides nothing
    "grid.alpha": 0.25,
    "legend.frameon": False,
    "axes.unicode_minus": False,           # CJK fonts lack U+2212 minus
})

# Optional CJK support (run once if labels contain Chinese/Japanese/Korean):
# from matplotlib import font_manager
# font_manager.fontManager.addfont("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
# plt.rcParams["font.sans-serif"] = ["Noto Sans CJK SC", "DejaVu Sans"]
```

### 5.2 Bar chart with highlight, sorted, value-labeled

```python
def bar_highlight(labels, values, highlight, title, ylabel, path):
    """Sorted bar chart: highlight one bar, mute the rest, label every bar."""
    order = np.argsort(values)[::-1]                       # MUST sort descending
    labels = [labels[i] for i in order]
    values = [values[i] for i in order]
    colors = ["#D55E00" if l == highlight else "#C3CDDC" for l in labels]
    fig, ax = plt.subplots(figsize=(8, 4.5), constrained_layout=True)
    bars = ax.bar(labels, values, color=colors, width=0.62)
    ax.bar_label(bars, fmt="%.0fk", padding=3, fontsize=10)
    ax.set_title(title, loc="left", fontweight="bold")     # takeaway, not topic
    ax.set_ylabel(ylabel)
    ax.set_ylim(0, max(values) * 1.15)                     # zero baseline + label headroom
    ax.yaxis.set_major_locator(MaxNLocator(5))
    fig.savefig(path, facecolor="white")
    plt.close(fig)

bar_highlight(["Search", "Email", "Social", "Direct", "Referral"],
              [412, 388, 255, 240, 98], highlight="Email",
              title="Email is within 6% of Search on signups",
              ylabel="Signups (thousands)", path="bar_highlight.png")
```

### 5.3 Multi-series line chart with direct end labels (no legend)

```python
def line_direct_labels(df, x, series, value, title, ylabel, path,
                       palette=("#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00")):
    """Long-form df; direct-label each line at its right end."""
    fig, ax = plt.subplots(figsize=(8, 4.5), constrained_layout=True)
    for (name, g), c in zip(df.groupby(series), palette):
        g = g.sort_values(x)
        ax.plot(g[x], g[value], color=c, lw=2.2)
        last = g.iloc[-1]
        ax.annotate(str(name), xy=(last[x], last[value]), xytext=(6, 0),
                    textcoords="offset points", va="center",
                    color=c, fontweight="bold", fontsize=10)
    ax.set_title(title, loc="left", fontweight="bold")
    ax.set_ylabel(ylabel)
    ax.margins(x=0.14)                        # reserve room for end labels
    fig.savefig(path, facecolor="white")
    plt.close(fig)

dates = pd.date_range("2024-01-01", periods=12, freq="MS")
df = pd.DataFrame({
    "month": list(dates) * 3,
    "region": ["EMEA"] * 12 + ["APAC"] * 12 + ["LATAM"] * 12,
    "revenue": np.concatenate([np.linspace(120, 158, 12),
                               np.linspace(90, 132, 12),
                               np.linspace(40, 61, 12)]),
})
line_direct_labels(df, "month", "region", "revenue",
                   title="APAC is closing the gap with EMEA",
                   ylabel="Revenue (USD thousands)", path="line_labels.png")
```

### 5.4 Correlation heatmap with printed values

```python
def correlation_heatmap(df, path):
    corr = df.select_dtypes("number").corr()
    n = len(corr)
    fig, ax = plt.subplots(figsize=(6.4, 5.2), constrained_layout=True)
    im = ax.imshow(corr.to_numpy(), cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(n), corr.columns, rotation=45, ha="right")
    ax.set_yticks(range(n), corr.columns)
    for i in range(n):
        for j in range(n):
            v = corr.iloc[i, j]
            ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=9,
                    color="white" if abs(v) > 0.55 else "black")
    fig.colorbar(im, ax=ax, shrink=0.85, label="Pearson r")
    ax.set_title("Correlation matrix", loc="left", fontweight="bold")
    ax.grid(False)                            # heatmap supplies its own structure
    fig.savefig(path, facecolor="white")
    plt.close(fig)

rng = np.random.default_rng(0)
dfh = pd.DataFrame(rng.normal(size=(200, 4)),
                   columns=["visits", "signups", "trials", "purchases"])
dfh["purchases"] += dfh["trials"] * 0.8        # inject one strong correlation
correlation_heatmap(dfh, "corr_heatmap.png")
```

### 5.5 Histogram with stated binwidth, KDE, and median line

```python
import seaborn as sns

def histogram_kde(values, binwidth, title, xlabel, path):
    values = np.asarray(values, dtype=float)
    bins = np.arange(np.floor(values.min()), np.ceil(values.max()) + binwidth, binwidth)
    fig, ax = plt.subplots(figsize=(8, 4.5), constrained_layout=True)
    sns.histplot(values, bins=bins, kde=True, ax=ax,
                 color="#4C72B0", edgecolor="white", alpha=0.9)
    med = float(np.median(values))
    ax.axvline(med, color="#D55E00", ls="--", lw=1.8)
    ax.text(med, ax.get_ylim()[1] * 0.92, f" median {med:.1f}",
            color="#D55E00", fontsize=10, fontweight="bold")
    ax.set_title(title, loc="left", fontweight="bold")
    ax.set_xlabel(f"{xlabel} (binwidth {binwidth:g})")
    ax.set_ylabel("Count")
    fig.savefig(path, facecolor="white")
    plt.close(fig)

rng = np.random.default_rng(42)
histogram_kde(np.concatenate([rng.normal(30, 4, 900), rng.normal(46, 3, 100)]),
              binwidth=2,
              title="Order value is bimodal — a second high-value segment exists",
              xlabel="Order value (USD)", path="hist_kde.png")
```

### 5.6 Box vs violin vs ECDF comparison panel

```python
def distribution_panel(df, group, value, path):
    fig, axes = plt.subplots(1, 3, figsize=(12.5, 4), constrained_layout=True)
    sns.boxplot(data=df, x=group, y=value, ax=axes[0], fliersize=2, color="#C3CDDC")
    sns.violinplot(data=df, x=group, y=value, ax=axes[1],
                   inner="quartile", cut=0, color="#C3CDDC")
    sns.ecdfplot(data=df, x=value, hue=group, ax=axes[2])
    axes[0].set_title("Boxplot: quartiles + outliers", loc="left", fontsize=11)
    axes[1].set_title("Violin: full density shape", loc="left", fontsize=11)
    axes[2].set_title("ECDF: every point visible", loc="left", fontsize=11)
    fig.savefig(path, facecolor="white")
    plt.close(fig)

rng = np.random.default_rng(7)
dfe = pd.DataFrame({
    "plan": np.repeat(["Basic", "Pro", "Enterprise"], 150),
    "seats": np.concatenate([rng.gamma(2, 2, 150), rng.gamma(3, 3, 150),
                             rng.gamma(5, 8, 150)]),
})
distribution_panel(dfe, "plan", "seats", "distribution_panel.png")
```

### 5.7 Scatter with regression line and 95% CI

```python
def scatter_regression(df, x, y, title, path):
    fig, ax = plt.subplots(figsize=(7, 5), constrained_layout=True)
    sns.regplot(data=df, x=x, y=y, ax=ax, ci=95,
                scatter_kws={"alpha": 0.35, "s": 22, "color": "#0072B2"},
                line_kws={"color": "#D55E00", "lw": 2})
    r = df[[x, y]].corr().iloc[0, 1]
    ax.set_title(f"{title} (r = {r:.2f})", loc="left", fontweight="bold")
    ax.set_ylabel(f"{y} — correlation is not causation")
    fig.savefig(path, facecolor="white")
    plt.close(fig)

rng = np.random.default_rng(3)
dfs = pd.DataFrame({"spend": rng.uniform(0, 1000, 400)})
dfs["conversions"] = 0.8 * dfs["spend"] + rng.normal(0, 60, 400)
scatter_regression(dfs, "spend", "conversions",
                   "Conversions scale with spend", "scatter_reg.png")
```

### 5.8 Small multiples grid with shared axes

```python
def small_multiples(df, col, x, y, ncol=3, path="small_multiples.png"):
    groups = sorted(df[col].unique())
    nrow = int(np.ceil(len(groups) / ncol))
    fig, axes = plt.subplots(nrow, ncol, figsize=(3.2 * ncol, 2.6 * nrow),
                             constrained_layout=True, sharex=True, sharey=True)
    for ax_, g in zip(np.ravel(axes), groups):
        sub = df[df[col] == g]
        ax_.plot(sub[x], sub[y], lw=1.6)
        ax_.set_title(str(g), fontsize=10)
    for ax_ in np.ravel(axes)[len(groups):]:
        ax_.set_visible(False)               # hide empty trailing panels
    fig.savefig(path, facecolor="white")
    plt.close(fig)

months = pd.date_range("2024-01-01", periods=24, freq="MS")
rng = np.random.default_rng(11)
rows = [pd.DataFrame({"month": months, "store": s,
                      "sales": b + np.linspace(0, 20, 24) + rng.normal(0, 6, 24)})
        for s, b in [("North", 120), ("South", 95), ("East", 140),
                     ("West", 88), ("Central", 102), ("Online", 60)]]
small_multiples(pd.concat(rows), col="store", x="month", y="sales")
```

### 5.9 KPI card figure (dashboard header row)

```python
def kpi_cards(metrics, path="kpi_cards.png", good_when="up"):
    """metrics: list of (label, value_str, delta_pct). One row of KPI cards."""
    n = max(len(metrics), 1)
    fig, axes = plt.subplots(1, n, figsize=(2.7 * n, 1.7), constrained_layout=True)
    for ax, (label, value, delta) in zip(np.atleast_1d(axes), metrics):
        ax.axis("off")
        ax.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax.transAxes,
                                   facecolor="#F4F6F8", edgecolor="#E1E6EB", zorder=0))
        good = (delta >= 0) if good_when == "up" else (delta < 0)
        ax.text(0.08, 0.72, label, transform=ax.transAxes, fontsize=10, color="#55606E")
        ax.text(0.08, 0.36, value, transform=ax.transAxes, fontsize=19, fontweight="bold")
        ax.text(0.08, 0.10, f"{'+' if delta >= 0 else ''}{delta:.1f}% vs last year",
                transform=ax.transAxes, fontsize=10,
                color=("#1B7F4D" if good else "#B3261E"))
    fig.savefig(path, facecolor="white")
    plt.close(fig)

kpi_cards([("Revenue", "$4.58M", 12.4), ("Orders", "38,902", 5.1), ("NPS", "47", 6.0)])
```

### 5.10 Interactive plotly express trend for stakeholders

```python
import plotly.express as px

def interactive_trend(df, x, y, color, out_html="trend.html"):
    """Self-contained interactive HTML: hover, zoom, legend toggle."""
    fig = px.line(df, x=x, y=y, color=color, markers=True,
                  template="plotly_white",
                  color_discrete_sequence=px.colors.qualitative.Safe)
    fig.update_layout(title=dict(text=f"{y} by {color}", x=0.01),
                      legend=dict(orientation="h", y=-0.2),
                      hovermode="x unified")
    fig.write_html(out_html, include_plotlyjs="cdn")

interactive_trend(df, "month", "revenue", "region", "trend.html")
```

## 6. Decision Tables

**Table A — Question → chart → template**

| The question | Chart | Template |
|---|---|---|
| Which category is biggest? | Sorted bar + highlight | §5.2 |
| How do series move over time? | Multi-line, direct labels | §5.3 |
| Which variables move together? | Correlation heatmap | §5.4 |
| What does the distribution look like? | Histogram + KDE, stated binwidth | §5.5 |
| How do groups' distributions differ? | Box/violin/ECDF panel | §5.6 |
| Is there a relationship? | Scatter + regression CI | §5.7 |
| How do 5+ groups compare over time? | Small multiples | §5.8 |
| What are the headline numbers? | KPI cards | §5.9 |
| Let stakeholders explore | plotly HTML | §5.10 |

**Table B — Situation → library**

| Situation | Choose | Why |
|---|---|---|
| Figure for a PDF report | matplotlib OO | vector export, exact control |
| Quick statistical view of a dataframe | seaborn | one-line distributional plots |
| Stakeholder wants to hover/filter | plotly express | interactivity for free |
| Persistent web dashboard | Apache ECharts | responsive panels, live data |
| Publication-grade journal figure | matplotlib + PDF | fonts embedded, reproducible rcParams |

**Table C — Data type → palette**

| Data type | Palette | Exact values |
|---|---|---|
| Categorical ≤7 | Okabe-Ito | #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 |
| Categorical, one hero series | gray + accent | context #C3CDDC, highlight #D55E00 or #0072B2 |
| Sequential | viridis / cividis | `cmap="viridis"` |
| Diverging (deltas, correlations) | RdBu_r | `vmin=-1, vmax=1` for correlations; center 0 for deltas |
| Ordinal | cropped Blues | `sns.color_palette("Blues", as_cmap=True)` sliced 0.3–0.9 |

**Table D — Destination → export settings**

| Destination | Format | DPI | Call |
|---|---|---|---|
| Chat / web / README | PNG | 150 | `fig.savefig(p, dpi=150, facecolor="white")` |
| Print report | PDF/SVG | vector | same call, `.pdf` extension |
| Slide (half-slide slot) | PNG | 300 | figsize 8x4.5 in ≈ half-slide 16:9 |
| Poster | PDF | vector | verify fonts embedded at full scale |

## 7. Quality Checklist

Verify EVERY item before finishing:

- [ ] Chart type matches the question per the decision tree (§4.1)
- [ ] Bar/value axes start at 0; line axes may have a justified non-zero baseline
- [ ] Title states the takeaway, not the topic
- [ ] Both axes labeled with quantity AND unit
- [ ] Source note present under the chart
- [ ] Colorblind-safe palette; ≤7 categorical colors
- [ ] The highlighted element is identifiable even in grayscale
- [ ] 4–8 ticks per axis; no unreadable dense tick text
- [ ] No overlapping labels; no clipped or cut-off text
- [ ] Legend order matches visual order, or legend replaced by direct labels
- [ ] ≤3 annotations, each adding meaning
- [ ] Log scale explicitly labeled "(log scale)" if used
- [ ] No 3D, no dual pie, no rainbow, no unexplained dual axis
- [ ] Histogram binwidth stated; error bars defined in caption
- [ ] Figure size and DPI match the destination (150 screen / 300 print)
- [ ] Chart was rendered and visually inspected at least once (twice if customer-facing)
- [ ] Values in the chart trace exactly to the source data; nothing invented or smoothed
- [ ] Background facecolor set (white) — no transparent surprises in slides or dark-mode viewers

## 8. Common Mistakes & Fixes

1. **Truncated bar axis** → tiny differences look dramatic → `ax.set_ylim(0, max(values) * 1.15)`.
2. **Rainbow colormap on ordered data** → fake bands, misordered perception → `cmap="viridis"` (sequential) or `"RdBu_r"` (diverging, centered).
3. **Overlapping datetime tick labels** → unreadable bottom edge → `AutoDateLocator` + `ConciseDateFormatter`, or shorter labels ("Mar").
4. **Legend spaghetti with 10+ entries** → reader ping-pong → direct-label lines at their ends (§5.3) or split into small multiples (§5.8).
5. **Dual y-axis implying false lockstep** → spurious correlation story → two stacked panels sharing the x-axis, each with its own honest scale.
6. **Pie with 12 slices** → angles indistinguishable → top-5 + "Other" as a bar chart.
7. **Text clipped at figure edge** → missing words in the export → keep `constrained_layout=True`, increase `ax.margins(x=...)`, NEVER add `tight_layout` on top.
8. **Blank/white text in saved PNG** → invisible labels → set `facecolor="white"` on savefig and explicit dark text colors.
9. **Blurry print output** → fuzzy 72-DPI screenshot → save at `dpi=300` with figsize equal to the physical placement size.
10. **CJK characters render as boxes □□□** → missing font → `fontManager.addfont(...)` + `rcParams["font.sans-serif"]` + `axes.unicode_minus=False` (§4.9).
11. **Seaborn palette ignored** → default colors persist → pass `palette=` into the plotting call itself (not just rcParams), or set `sns.set_theme(palette=...)` before plotting.
12. **`savefig` after `plt.show()` yields blank file** → Agg backend has nothing after show/close → save BEFORE `plt.show()`/`plt.close(fig)`.
13. **Default histogram bins hide the shape** → bimodality invisible → compute binwidth via Freedman–Diaconis and pass `binwidth=` explicitly (§5.5).
14. **Unlabeled error bars** → viewer misreads them as range or SD → always caption "bars show 95% CI of the mean".

## 9. Advanced Techniques

### 9.1 House Style via rcParams
Freeze a corporate look once: put the §5.1 rcParams dict in a `house_style.py`, then `from house_style import *` in every notebook. For per-project overrides use `with plt.style.context({"font.size": 9}):`. Consistency across dozens of figures is what makes a report feel professionally produced, and a one-line change re-themes everything.

### 9.2 Storytelling Figure
Structure: gray context (all historical data, `#C3CDDC`) + colored climax (the period that matters, `#D55E00`) + one annotation with an arrow at the inflection point + takeaway title. Code sketch: plot the full series gray, overlay `df[df.period >= "2024-06"]` in accent color, `ax.annotate("Price change shipped", xy=(x_inflection, y), xytext=(20, 30), textcoords="offset points", arrowprops=dict(arrowstyle="->"))`. This is the pattern behind every effective Economist/FT-style chart.

### 9.3 Density for Huge Scatter Clouds
Beyond 10k points replace scatter with `ax.hexbin(x, y, gridsize=50, cmap="viridis", mincnt=1)` plus a colorbar labeled "count", or `sns.kdeplot(x=x, y=y, fill=True, cmap="viridis", levels=10)` for smooth density. Keep the scatter version alongside for point-level questions; label the panel "density of 84,212 orders" so the reader knows sampling/density replaced raw points.

### 9.4 Multi-Page PDF Reports
`with PdfPages("report.pdf") as pdf:` and loop over groups — one page per region with identical axes and styling; set `metadata={"Title": "...", "Author": "..."}` on the first save. Identical page composition turns a figure loop into a board-ready document with zero manual layout.

### 9.5 Interactive Plotly for Self-Serve
Upgrade a static chart to self-serve exploration: `px.line(..., hover_data=[...])` for exact values, `hovermode="x unified"` for aligned crosshairs, `fig.update_xaxes(rangeslider_visible=True)` for time zoom, `fig.write_html(out, include_plotlyjs="cdn")` to keep files small. ALWAYS keep a static PNG twin — the interactive version is for exploration, the PNG is the record.

### 9.6 Font Fallback Pipeline
Before relying on a font, verify resolution: `font_manager.findfont("Noto Sans CJK SC")` returns the path actually used; if it falls back to DejaVu, CJK glyphs will be boxes. Ship a fallback chain `["Noto Sans CJK SC", "Noto Sans SC", "WenQuanYi Zen Hei", "DejaVu Sans"]` and check `axes.unicode_minus=False` in the same place, since the minus sign is the second most common missing glyph after CJK ideographs.

## 10. Quick Reference Card

```
PICK: compare→sorted bar | trend→line+direct labels | distribution→hist(state binwidth)/ECDF
      relationship→scatter+trend | part-of-whole→100% stacked bar (pie only ≤5 slices)
      composition over time→stacked area | correlation→heatmap RdBu_r | geo→choropleth
      one number→KPI card | density >10k pts→hexbin gridsize=50

PALETTES: categorical Okabe-Ito #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7
          highlight #D55E00 on context #C3CDDC | sequential viridis/cividis | diverging RdBu_r

FIGURE:  fig, ax = plt.subplots(figsize=(8, 4.5), constrained_layout=True)
TICKS:   ax.yaxis.set_major_locator(MaxNLocator(5))
LABELS:  ax.bar_label(bars, fmt="%.1f", padding=3)
TITLE:   ax.set_title("takeaway sentence", loc="left", fontweight="bold")
EXPORT:  fig.savefig(p, dpi=300, facecolor="white")      # 150 screen, 300 print
CJK:     fontManager.addfont(path); rcParams["font.sans-serif"]=["Noto Sans CJK SC"];
         rcParams["axes.unicode_minus"]=False

NEVER: truncated bar axis | rainbow on ordered data | 3D/dual pie | dual axis without need
       >7 categorical colors | mix libraries in one figure | tight_layout + constrained

QA LOOP: render → overlap? clipped? units? baseline 0? ≤7 colors? title=takeaway?
         → fix → re-render → export at destination DPI → add source note
```

