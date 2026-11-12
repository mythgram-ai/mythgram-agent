---
name: slides-creator
description: >
  Presentation design and storytelling skill: turns any topic, outline, document, or raw idea
  into a complete audience-ready presentation blueprint — objective brief, narrative arc,
  slide-by-slide storyboard with action titles, slide-type selection, data storytelling,
  visual system, speaker notes, rehearsal and QA — including HTML slide decks (reveal.js /
  slidev) when a web format is wanted. Use this skill whenever the user mentions presentation,
  slides, deck, pitch, keynote, talk, briefing, webinar, lecture, demo day, defense, or "make
  me a presentation" — even when the word "slides" never appears (e.g., "I present quarterly
  results to the board on Monday"). Also use it to fix, restructure, shorten, or critique an
  existing deck, to convert an outline or report into slides, and to write speaker notes or a
  talk track. Do NOT use it for the mechanical production of the .pptx file itself (that is
  pptx-creator's job — hand it the approved storyboard and design spec), for PDF documents or
  written reports (pdf-creator), for spreadsheet data work (excel-creator), or for AI-generated
  illustration images (image-generator).
---

# Slides Creator — Presentation Thinking, Storyboarding & Delivery

> A deck is not a file; it is a decision instrument. This skill plans the decision first, then specifies every slide before any file is built.

## 0. Operating Rules (Non-Negotiable)

1. **ALWAYS produce a written storyboard before any deck file is built.** Why: revising the narrative at storyboard stage costs minutes; revising built slides costs hours, and authors rarely cut slides they already styled.
2. **ALWAYS define the audience and the objective in one written sentence first.** Why: every later choice — depth, tone, slide count, data density — derives from it; without it, decks drift toward "everything I know."
3. **NEVER begin from slide decoration.** Content and order come first, visuals second. Why: a beautiful deck with a broken argument fails the meeting; a plain deck with a winning argument passes.
4. **ALWAYS write action titles** — full-sentence takeaways, not topic labels. Why: the title-only skim test must tell the whole story; topic titles ("Q3 Revenue") force the audience to do the synthesis you were paid to do.
5. **ONE idea per slide.** Why: working memory handles one message at a time; two ideas on one slide means the audience chooses one and loses the other.
6. **NEVER exceed ~6 bullets per slide or ~2 lines per bullet** (and prefer 0 bullets — use statements, images, or charts). Why: if a slide needs more, it is two slides or a handout.
7. **ALWAYS plan the deck length from the time slot** (~1.5–2 min per content slide). Why: a 40-slide deck in a 15-minute slot guarantees either skipping (insulting) or overrunning (worse).
8. **NEVER let a chart on a slide lack a stated so-what.** Why: charts are evidence, not decoration; the annotation of the insight is the slide.
9. **ALWAYS write speaker notes as delivery cues, never as a second copy of the slide text.** Why: reading slides aloud is the fastest way to lose a room.
10. **ALWAYS finish with a QA pass that renders the final file and checks every slide against the storyboard.** Why: layout bugs (overflow, overlap, tiny text) are invisible in code and obvious in a render; shipping unrendered work is shipping blind.
11. **FORBIDDEN: walls of text, unreadable body text below 18 pt on a 16:9 slide, rainbow palettes, decorative animations, and clip art.** Why: each one measurably reduces comprehension and credibility.
12. **ALWAYS keep the data honest:** cite the source on every data slide, use time-consistent ranges, and never let axis truncation manufacture a trend. Why: one caught exaggeration destroys the credibility of every other number in the deck.

## 1. When to Use / When Not To

**Use this skill when the task involves:**
- Creating any presentation: business update, pitch, training, lecture, conference talk, webinar, defense, demo, all-hands.
- Converting an outline, report, document, or set of notes into slides.
- Restructuring, shortening, or fixing a deck that "doesn't flow."
- Writing or improving speaker notes and talk tracks.
- Deciding the narrative for a data-heavy review (what story do these numbers tell?).
- Choosing between deck formats (pptx file, HTML slides, PDF handout).

**Do NOT use when the task is:**
- Building the .pptx file itself → **pptx-creator** (hand it the storyboard + design spec from this skill).
- Producing a PDF report or document → **pdf-creator**.
- Analyzing the dataset behind the slides → **information-analyst**.
- Standalone charts for a document → **data-visualization**.
- AI-generated images for slide visuals → **image-generator**.
- Written long-form reports → this skill's storyboard is the wrong instrument; use a report structure.

**Routing table:**

| The user asks for... | Correct skill | This skill's role |
|---|---|---|
| "Make me a deck about X" | slides-creator + pptx-creator | Storyboard + design spec, then hand off |
| "Fix this messy deck" | slides-creator (then pptx-creator if file edits needed) | Diagnose narrative, re-storyboard |
| "Quarterly report document" | pdf-creator | None |
| "Chart for my slides" | data-visualization (rendered per this skill's spec) | Define message + chart choice |
| "Speaker notes for my talk" | slides-creator | Full ownership |

## 2. Core Concepts & Mental Models

**The audience is the unit of design.** Every slide decision answers to three audience questions: What do they already know? What do they care about? What do you want them to do after? A CFO, an engineering team, and conference attendees hearing the same content need three different decks — not the same deck with different fonts.

**One message per slide.** A slide is a unit of thought, like a paragraph. If you cannot say what a slide argues in one sentence, it is not one slide yet — it is a section.

**The Pyramid Principle (Minto).** Lead with the answer, support it with ≤3 mutually-exclusive collectively-exhaustive (MECE) pillars, each pillar supported by evidence. Audiences follow answer-first structures effortlessly; they must work to follow build-up-then-reveal structures, and many will resist. Vertical logic = each level answers "why?" of the level above; horizontal logic = items on one level are parallel in kind and grammar.

**Action titles.** The title is the message; the body is the evidence. "Churn concentrates in month 1 — onboarding is the leak" beats "Churn analysis" because a reader skimming only titles still receives the full argument. This single habit upgrades most decks more than any design change.

**Signal vs. noise.** Every element on a slide either advances the message or taxes attention. Gridlines, logos, borders, shadows, and animation all tax. Keep the tax near zero so the signal (one number, one chart, one sentence) lands.

**Slides ≠ document.** A slide is a visual aid for a live narrative; a document is read alone. Mixing them produces the worst of both — overloaded slides nobody can read and a transcript nobody reads. If the room needs detail, that is what an appendix and a handout are for.

**The 10/20/30 heuristic (Kawasaki).** ~10 core slides, ~20 minutes, ≥30 pt text — a forcing function against bloat, not a law. Adjust for context (a training deck may run 40 slides because time runs 3 hours), but be able to justify every slide beyond the heuristic.

**Story before data.** Numbers persuade only after a frame exists: situation → complication → resolution. Data without the frame is trivia; the frame without data is assertion. A great deck alternates: claim (title) → evidence (chart/fact) → meaning (callout).

## 3. Mandatory Workflow

**Step 1 — Audience & objective brief (do this in writing, never in your head).**
Fill the brief: Who is the audience (role, seniority, size, prior knowledge)? What decision or action should follow? What do they currently believe (including the wrong beliefs)? What objections will arise? Time slot and setting (room, video call, hybrid)? MUST answer: "After this deck the audience will know/decide/do ___." NEVER proceed without this sentence — it is the yardstick for every later cut.

**Step 2 — Content inventory.**
List every fact, number, image, and argument available. Mark each as: core (needed for the objective), supporting (strengthens), or cut-candidate (nice to know). Why: gathering before structuring prevents the "structure first, then discover missing data" rework spiral.

**Step 3 — Narrative architecture.**
Choose an arc (see §4.2) and lay out the argument as 3–6 beats before touching slides. Write each beat as one sentence. Test: do the beats alone tell the story? Why: beats are the deck's skeleton; slides are flesh added to a skeleton, never the reverse.

**Step 4 — Storyboard table (the deliverable of this skill).**
Produce the slide-by-slide table (template in §5.1): slide #, archetype, action title, visual/content plan, data needed, note cue. Revise HERE: cut slides that do not serve the objective sentence, merge duplicates, move evidence before conclusions it supports. MUST run the title-skim test: read only the action titles top to bottom — they must form a complete, persuasive argument. Why: this 30-second test catches 80% of structural failures before any file exists.

**Step 5 — Data & visual plan.**
For each data slide: name the chart type from the message (§6.2), the exact data series needed, the annotation that carries the so-what, and the source. For each visual: describe it concretely ("full-bleed photo of warehouse floor, subject centered, text zone left third empty"). Why: this makes the build step mechanical and makes missing data visible before, not after, building.

**Step 6 — Handoff to the builder.**
Deliver to pptx-creator (or HTML route per §6.4): the storyboard table, the design system (palette hexes, type sizes, margins), and any chart render specs. NEVER hand off "make it nice" — hand off geometry and content.

**Step 7 — Build QA (with the builder skill).**
Render every slide to an image and check against the storyboard: does each slide deliver its blueprint message? Text overflow? Contrast? Title consistency? Fix the generator, re-render, repeat until zero findings.

**Step 8 — Speaker notes & rehearsal pack.**
Write cue-style notes per slide (§4.7), the 5 hardest anticipated questions with answers (§9.2), and the timing plan. Why: the deck is only half the presentation; the notes are the other half, and QA on paper is cheap.

## 4. Deep Knowledge Library

### 4.1 Audience analysis matrix
Before structuring, classify the audience on four axes and let each axis change the deck:
| Axis | Low → | High → | Deck consequence |
|---|---|---|---|
| Prior knowledge | Define terms, avoid jargon, teach the model first | Skip fundamentals; depth and nuance | Fundamentals slides in or out |
| Stakes in the decision | Needs "why should I care" framing | Needs options, trade-offs, risk analysis | Motivation slides in or out |
| Attention budget | 10 minutes → ≤8 content slides | 45 minutes → 20+ slides OK | Length and appendix depth |
| Trust in you | Cite sources, show method, concede limits | Lead with the recommendation faster | Evidence density per claim |
When the room mixes levels (common), design for the decision-makers' level and put ramp-up material in an appendix. NEVER design for the most technical person present — that is how decks become textbooks.

### 4.2 Narrative arcs (choose one deliberately)
**Context → Complication → Resolution (SCR/McKinsey).** "Here is the situation you know (1–2 slides). Here is what changed / what breaks (1–2 slides). Therefore here is what we propose (the bulk)." The default for business decks: it earns attention by naming the problem before selling the answer.
**Story spine (pitches).** Ordinary world → inciting incident (the problem intensifies) → existing options fail (why current solutions lose) → our approach → proof it works (traction, pilot, demo) → the ask. Use for investors and new audiences.
**Report walkthrough.** Executive summary (answer first) → section per finding → appendix for method and detail. Use for recurring governance updates where the audience reads more than listens.
**Teaching arc.** Motivation (why this matters to you) → concept → worked example → practice/check → summary → next steps. Use for training and lectures; practice beats coverage.
MUST be able to name which arc a deck uses in one sentence. If two arcs are blended, pick one; hybrid arcs read as neither.

### 4.3 Action titles — the craft
Rules: (1) full sentence with a verb or a claim; (2) states the takeaway, not the topic; (3) ≤2 lines; (4) a deck's titles read top-to-bottom as the argument. Examples:
| Weak topic title | Strong action title |
|---|---|
| Q3 Revenue | Q3 revenue grew 23%, led by EMEA enterprise |
| Churn overview | Churn concentrates in month 1 — onboarding is the leak |
| Migration options | Option B is the only one that meets the March deadline |
| Team | Three senior hires closed the mobile gap in Q2 |
| Pricing | At $49 we capture 3× more lifetime value than at $29 |
Ban these title openers: "Overview of...", "Introduction to...", "Some thoughts on...". They announce structure, not message.

### 4.4 Slide type catalog (13 archetypes)
| # | Archetype | When | Content rules |
|---|---|---|---|
| 1 | Title/cover | First slide | Title + subtitle + presenter/date; no agenda crammed in |
| 2 | Agenda | Meetings >15 min | 3–5 items as phrases; skip for <10-min decks |
| 3 | Section divider | Every major beat | One line + number; resets attention, aids navigation |
| 4 | Single statement | The pivotal claim | One sentence, huge type; the most underused high-impact slide |
| 5 | Bullets | Enumerations | ≤6 bullets, ≤2 lines each, parallel grammar; prefer 4. NEVER full sentences if avoidable |
| 6 | Chart | Evidence | One chart, one message, annotated so-what, source line |
| 7 | Table | Exact values matter | ≤5 rows × 5 cols on slide; highlight the row/col that matters; rest to appendix |
| 8 | Image-led | Emotion, context, product | Full-bleed image + ≤15 words caption |
| 9 | Quote | Borrowed authority | Quote + attribution + one line on why it matters |
| 10 | Process/flow | Sequences | ≤5 steps left-to-right or top-to-bottom; label arrows with the trigger |
| 11 | Comparison | Options, before/after | ≤3 columns; criteria as rows; state the winner in the title |
| 12 | Demo | Product truth | Screenshot/video + the one thing to notice; rehearse the click path |
| 13 | Closing/CTA | Last content slide | The ask + the single next action + contact; NEVER "Thank you!" as the final message |
Archetypes are mixable (chart+callout), but every slide names its PRIMARY archetype in the storyboard.

### 4.5 Data storytelling on slides
Match chart to message: trend over time → line; comparison of items → bar (sorted); part-of-whole (≤5 parts) → stacked bar or donut, else table; distribution → histogram; relationship → scatter. Then apply the slide layer: (1) ONE chart per slide; (2) annotate the so-what directly on the chart (arrow to the spike, circle the gap) — the audience should not hunt for the point; (3) declutter: no unnecessary gridlines, no legend if direct labels fit, no axis beyond what the claim needs; (4) big-number slides beat charts for single facts ("$1.2M saved" at 120 pt with context line below); (5) keep units and time ranges on the slide, source in a 10–12 pt footnote; (6) consistent color meaning across the whole deck (this series = this color everywhere). NEVER put two charts with different y-scales side by side — comparison becomes a lie.

### 4.6 Visual system (define once, apply everywhere)
Whitespace ≥30% of every slide; margins consistent (≈0.6 in on 13.33×7.5 in canvas). ONE accent color on a neutral base (background, dark text, accent, one muted support) — the accent marks what matters: the highlighted bar, the key number, the CTA. Type scale: title 28–34 pt, section 20–24 pt, body ≥18 pt, caption/footnote 12 pt; one sans-serif family. Alignment discipline: same title position on every slide, left-aligned body text, everything on an implied 12-column grid. Imagery: high-resolution only, consistent style (all photos or all illustration, never mixed), no watermarks, no cheesy stock handshakes. Icons: one style, used consistently, sized uniformly. Animation: only purposeful reveals of build-up content (one click, one step); decorative motion is FORBIDDEN because it taxes attention and breaks in PDF export.

### 4.7 Speaker notes & delivery design
Notes are cues, not scripts: 3–5 bullets per slide — the point to land, the transition sentence, the number to say, and a timing hint ("~60 s"). Structure the talk track: opening hook (§9.3) ≤90 s, one transition sentence between beats, closing that lands the ask. Timing plan at ~1.5–2 min per content slide; mark slides that may be skipped when over time (designate "flex slides" in the storyboard). Rehearsal checklist: run aloud once end-to-end; run the title-skim; time each beat; prepare the 5 hardest questions (§9.2). Delivery rules: never read the slide; stand still while making a point, move while transitioning; pause after the key number — silence sells it.

### 4.8 Deck-type blueprints
**Business update (10 slides, 20 min):** 1 cover · 2 agenda · 3 executive summary (3 bullets: result, cause, action) · 4 KPI dashboard · 5 what worked (evidence) · 6 what didn't (evidence + cause) · 7 decision needed (options table) · 8 recommendation + why · 9 plan & owners · 10 closing CTA.
**Startup pitch (12 slides, ~15–18 min):** title → problem (person + pain, quantified) → solution (the "how" in one picture) → product (demo screenshot) → market (TAM/SAM/SOM with sources) → go-to-market → traction (chart, growth) → competition (2×2 or feature table; state the unfair advantage) → why now (the shift) → team (why THIS team wins) → financials/plan → the ask (amount + use of funds + milestones). Every slide answers an investor question in order: why this, why now, why you, why this amount.
**Training/lecture (flex length):** motivation → agenda → concept blocks (teach→example→check each) → practice exercise → common mistakes → summary map → next steps/resources.
**Conference talk:** hook → promise ("in 20 minutes you will be able to...") → context → 3 ideas (each: statement slide → story → evidence) → payoff (what to do Monday) → CTA/resources.

### 4.9 HTML slide decks (reveal.js / slidev)
Choose HTML when: presenting from a browser, sharing a link, code-heavy content (syntax highlighting, live demos), or version-controlling the deck as text. **reveal.js** (plain HTML/JS): sections are `<section>` slides; supports fragments (build-ups), speaker notes (`<aside class="notes">`), markdown inside slides, and PDF export via the print stylesheet (`?print-pdf`). **slidev** (Vue-based, developer-first): markdown-per-slide files with frontmatter, code highlighting, live coding, export to PDF/PNG/SPA. Minimal reveal.js skeleton:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
<div class="reveal"><div class="slides">
  <section><h1>Title</h1><p>Subtitle</p></section>
  <section><h2>Action title</h2><ul><li>Point one</li><li>Point two</li></ul>
    <aside class="notes">Cue: land the 23% number, then transition.</aside></section>
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script>Reveal.initialize({ hash: true });</script>
```
The same storyboard and design rules apply; HTML is a rendering channel, not an excuse to skip structure. QA: render/export and check every slide, exactly as with pptx.

### 4.10 Anti-patterns gallery
Walls of text (paragraphs on slides) → split into statement + notes. Reading slides aloud → move the text to notes. Ten charts on one slide → one message per slide, rest to appendix. Rainbow palettes and clip art → one accent, consistent imagery. "Any questions?" as the ending → close with the CTA, THEN take questions. Agenda with 10 items → 3–5 beats or none. Logo on every slide, dense footers → cover and footer on title/leave slides only. Animation as decoration → purposeful reveals only. 4:3 canvas in 2026 → 16:9 unless the venue truly requires otherwise. "Draft" watermark slideware in the final file → version-stamp discreetly once, remove before shipping.

## 5. Code & Tool Templates

### 5.1 Storyboard table (the master template)
```markdown
# Storyboard — <deck title>
- Objective: After this deck the audience will <decide/do/know ___>.
- Audience: <role, knowledge level, size> · Slot: <minutes> · Arc: <SCR/spine/walkthrough/teaching>
- Flex slides (skip if over time): #<n>, #<m>

| # | Archetype | Action title | Visual / content | Data needed | Note cue |
|---|-----------|--------------|------------------|-------------|----------|
| 1 | cover | <deck title> | product visual, subtle | logo | hook in 1 line |
| 2 | statement | <the pivotal claim> | one sentence, 60 pt | — | pause after |
| 3 | chart | <what the data proves> | line chart, annotation on spike | series + source | say the number |
| 4 | comparison | <option B wins because...> | 3-col table, winner highlighted | option matrix | name the trade-off |
| 5 | closing | <the ask> | CTA + next step + contact | — | stop talking |
```
Fill every cell. "—" is allowed ONLY where genuinely nothing is needed. The storyboard is the contract with the builder.

### 5.2 Objective brief template
```markdown
- After this deck: <audience> will <decision/action>.
- They currently believe: <belief 1>, <belief 2 (including wrong ones)>.
- Objections to preempt: <top 3>.
- Success metric: <what "worked" looks like — e.g., budget approved, pilot greenlit>.
- Constraints: <time slot>, <setting>, <must-include facts>, <language>.
```

### 5.3 Skeleton — business update, titles pre-written
```markdown
1. cover        "Q3 Business Review — <team>"
2. agenda       "Three things today: results, causes, decisions"
3. summary      "Q3: revenue +23%, churn flat, one decision needed"
4. chart        "Revenue grew 23%, led by EMEA enterprise"      [line chart]
5. evidence     "Two drivers: pipeline conversion (+9 pts) and pricing"
6. risk         "Churn concentrates in month 1 — onboarding is the leak"
7. options      "Three options for Q4; Option B meets the deadline" [comparison table]
8. statement    "We recommend Option B"
9. plan         "Option B: owner, milestones, and what we stop doing"
10. closing     "Approve Option B today; kickoff Monday"          [CTA]
```

### 5.4 Skeleton — 12-slide investor pitch (titles as prompts)
Title → "X loses <quantified pain> every year" → "We <one-sentence solution>" → product demo image → "<TAM> market, growing <rate>" → "We reach customers via <channel>" → "Growing <metric> <period over period>" → "<Competitor> serves <segment>; we win <different segment/edge>" → "The window is <shift> — why now" → "<Team>: we built <proof>" → "Plan: <milestones> for <$>" → "The ask: <$> for <use> to reach <milestone>".

### 5.5 Speaker note format
```markdown
Slide 7 — "Option B meets the deadline"
- LAND: B is 2 weeks faster AND cheaper at scale.
- SAY: the number — "14 weeks vs 16, and flat cost after 5k users".
- WATCH FOR: cost question → backup slide 14 (TCO table).
- TIME: ~90 s. Transition: "which brings us to what we need from you today."
```

### 5.6 QA conformance check (with pptx-creator's file)
```python
from pptx import Presentation
prs = Presentation("deck.pptx")
board = ["Q3 Business Review", "Three things today", "Q3: revenue +23%"]  # storyboard titles
for i, slide in enumerate(prs.slides, 1):
    texts = [sh.text_frame.text.strip() for sh in slide.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
    title = texts[0] if texts else "(EMPTY)"
    status = "OK" if any(board[j] in title for j in range(min(i, len(board)))) else "CHECK"
    print(f"{i:02d} [{status}] {title[:70]}")
# Run after every build; every CHECK row must be explained or fixed before shipping.
```

## 6. Decision Tables

### 6.1 Slide archetype by message
| The slide's message is... | Use archetype | Not |
|---|---|---|
| A single pivotal claim | statement | bullets |
| Evidence from data | chart | table (unless exact values matter) |
| Exact figures to audit | table | chart |
| How something works over time | process/flow | bullets |
| Why option X wins | comparison + highlighted winner | two equal columns |
| An emotional/contextual beat | image-led | bullets |
| Authority supporting the claim | quote | paragraph |
| The action you need | closing CTA | "thank you" slide |

### 6.2 Chart type by message (pairs with data-visualization skill)
| Message | Chart | Rule |
|---|---|---|
| Trend over time | line | annotate the inflection; y from zero only if the claim needs it |
| Compare items | bar, sorted | sort by value; highlight the one being discussed |
| Part of whole (≤5) | stacked bar / donut | >5 parts → table or "top 3 + other" |
| Distribution | histogram | state bin width; annotate the mode |
| Relationship | scatter | annotate the outlier(s); trendline only if causal story exists |
| One dominant fact | big number | 100–120 pt number + context line + source |

### 6.3 Deck length by slot
| Slot | Content slides | Structure |
|---|---|---|
| 5 min (lightning) | 3–4 | statement-led, zero agenda |
| 10–15 min | 6–8 | cover, 1 agenda max, 4–5 content, CTA |
| 20–30 min | 10–14 | full SCR structure + appendix |
| 45–60 min | 18–24 | section dividers, practice/interaction breaks |
Rule: content slides ≈ slot_minutes ÷ 1.75, minus 2 for cover/close. When over-constrained, cut content, never shrink below 18 pt.

### 6.4 Output format routing
| Situation | Format | Why |
|---|---|---|
| Standard business meeting | .pptx (via pptx-creator) | Expected tooling, notes pane, editing |
| Web-shared or code-heavy talk | HTML deck (reveal.js/slidev) | Link sharing, syntax highlight, version control |
| Read-only distribution of the deck | Export to PDF | Preserves layout, no accidental edits |
| Dense detail for later reading | PDF report (pdf-creator), not slides | Slides are visual aids, not documents |

## 7. Quality Checklist

- [ ] Objective sentence written: "After this deck the audience will ___" — and every slide traces to it
- [ ] Audience classified on the four axes (§4.1); deck designed for the decision-maker level
- [ ] One narrative arc named explicitly; no arc-blending
- [ ] Storyboard table complete for every slide: archetype, action title, visual plan, data needed, note cue
- [ ] Title-skim test passed: titles alone tell the complete, persuasive story
- [ ] Every slide carries exactly ONE message; two-message slides split
- [ ] Bullet discipline: ≤6 bullets/slide, ≤2 lines each, parallel grammar (or zero bullets)
- [ ] Every data slide: one chart, annotated so-what, units, time range, source line
- [ ] Chart type matched to message via §6.2; no dual y-axes; no misleading truncation
- [ ] Design system defined once: palette (≤1 accent), type scale (body ≥18 pt), margins, image style
- [ ] Deck length fits the slot at ~1.5–2 min/content slide; flex slides marked
- [ ] Appendix holds the detail that would otherwise overload content slides
- [ ] Closing slide is a CTA with one concrete next action — not "Thank you"
- [ ] Speaker notes written as cues (land/say/watch-for/time), never slide-text duplicates
- [ ] Five hardest anticipated questions prepared, with backup slide references
- [ ] Final file rendered; every slide inspected against the storyboard; zero overflow/overlap/tiny-text findings
- [ ] All data verified against source; no number appears that no source supports
- [ ] File named and delivered in the routed format (§6.4); handout exported if the room needs detail

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---------|---------|-----|
| 1 | Building slides before the storyboard | Deck "grows" to 40 slides with no argument | Freeze the storyboard first; every slide must earn its row |
| 2 | Topic titles ("Overview of X") | Title-skim tells the audience nothing | Rewrite as action titles — full-sentence takeaways (§4.3) |
| 3 | Deck-as-document | Paragraphs on slides, 12 pt text | Move prose to speaker notes and a handout; slide = one message |
| 4 | Answer at the end | Audience waits 20 minutes for the point | Apply pyramid: answer first, then support (§9.1) |
| 5 | Chart with no so-what | "Here's the churn chart..." ...and? | Annotate the insight on the chart; title states what it proves |
| 6 | Wall-of-numbers dashboard | 9 KPIs, no hierarchy | Max ~5 KPIs on a dashboard slide; the one that matters gets visual priority |
| 7 | Inconsistent visuals | Each slide styled differently, fonts drift | Define the design system before slide 1; apply mechanically |
| 8 | Overrunning the slot | Last 10 slides skipped live | Plan from the slot (§6.3); mark flex slides; cut in rehearsal, not on stage |
| 9 | Notes = slide text duplicated | Presenter reads slides verbatim | Notes are cues: land/say/watch-for/time (§5.5) |
| 10 | "Thank you" ending | No action, meeting just stops | End with the CTA + next step; take questions after the CTA |
| 11 | Stock-photo clichés | Handshakes, lightbulbs, puzzles | Real product/context imagery or consistent illustration; or no image at all |
| 12 | Unverified numbers | A figure gets challenged and the deck's credibility collapses | Source every data slide; verify before storyboard approval, not after challenge |

## 9. Advanced Techniques

### 9.1 Pyramid principle deep dive
Build the pyramid bottom-up, present it top-down: (1) list every fact and argument; (2) group into MECE clusters — each item in exactly one cluster; (3) summarize each cluster in one sentence; (4) summarize the sentences into the governing thought. Vertical logic: each summary must answer the "why/so-what" of the level above it — test by reading up the pyramid and asking "why?" at every step. Horizontal logic: items at one level must be parallel (all reasons, all steps, all options) — mixed levels ("cost, quality, and the vendor is far away") signal a broken group. Deductive (premise→conclusion) reads rigorously but buries the point; use inductive (conclusion→reasons) for business decks, deductive inside a single argument when the audience is analytical.

### 9.2 Q&A preparation matrix
Before the deck, list the 5 hardest plausible questions and map each to a response: (1) the question you hope nobody asks (the real weakness) — answer it in the deck proactively or own it in the appendix; (2) the data challenge ("where did this number come from?") — source slide in appendix; (3) the alternative ("why not do X instead?") — comparison slide ready; (4) the cost/scope probe ("what does this displace?") — trade-off table ready; (5) the timing challenge ("why now?") — the shift evidence ready. For each: one-line verbal answer + backup slide number. If a question has no backup slide, that is a finding against the deck.

### 9.3 Opening hooks (first 60 seconds) and closings
Six hook patterns that reliably work: (1) the surprising number ("we lose $40k every day this stays broken"); (2) the story of one person/one customer; (3) the provocative question ("what would it mean if churn hit zero?"); (4) the before/after snapshot; (5) the counterintuitive claim with a one-line setup; (6) the object/artifact (show the broken part, the actual invoice, the failed unit). NEVER open with logistics ("today I'll cover...") — the agenda slide exists for that. Closings: restate the ask in one sentence, name the single next action with an owner and a date, and only then invite questions. If the room's decision-maker must leave early, move the CTA slide to follow the summary — rehearse the short path.

### 9.4 Virtual and hybrid delivery adjustments
Camera decks: fewer slides, larger type (body ≥20 pt), one idea per screen because attention drops ~2×. Design for the thumbnail: the key number must survive a 480p render. Use the platform's chat/polls as interaction beats every ~6 minutes. Hybrid rooms: address the camera for remote attendees at least once per beat; repeat spoken questions before answering (remote attendees hear nothing). Send the deck in advance ONLY for decision meetings where pre-read is the culture — otherwise it kills the reveal; send the PDF after instead.

### 9.5 Localization and translation-safe decks
When a deck will be translated or presented to mixed-language audiences: (1) keep 30%+ whitespace — translated text runs 15–30% longer (EN→DE, EN→ES; EN→ZH often shorter but wider glyphs); (2) avoid text baked into images (untranslatable); (3) date/number formats per audience (03/04/2026 is March or April depending on the room — use "3 Apr 2026"); (4) currency with ISO codes (US$1.2M, not $1.2M for a global deck); (5) idioms and humor travel worst — replace with concrete statements; (6) keep one editable source of truth, never fork files per language.

### 9.6 The data-gap discipline
When storyboard data does not exist yet: mark the cell with the exact requirement ("arrivals by month, 2024–2026, ops dashboard export") and assign an owner + deadline in the storyboard itself — the gap becomes a tracked task, not a surprise at build time. If the data cannot exist by delivery: either change the claim to what the data supports or label the slide as estimate with method and range. NEVER let an unverified plausible number ship because the chart "looked right."

## 10. Quick Reference Card

**The 8-step workflow:** objective brief → content inventory → narrative arc → storyboard table → data & visual plan → handoff (pptx-creator/HTML) → build QA (render every slide) → notes & rehearsal pack.

**Per-slide law:** one message · action title · body ≥18 pt · ≤6 bullets/2 lines · whitespace ≥30% · source on every number · CTA on the last slide.

**Length law:** content slides ≈ minutes ÷ 1.75 (−2). Over-constrained → cut slides, never shrink type.

**Chart law:** line=trend, bar=compare, stacked/donut=share (≤5), histogram=distribution, scatter=relationship, big-number=one fact. Annotate the so-what. One chart per slide.

**The three tests before shipping:** (1) title-skim — titles alone tell the story; (2) so-what — every slide answers "why does this matter to this audience"; (3) render QA — every slide inspected against the storyboard, zero layout findings.

**Handoff contract:** storyboard table + design system (hexes, sizes, margins) + chart specs + notes cues → pptx-creator or HTML builder. Never "make it nice."

