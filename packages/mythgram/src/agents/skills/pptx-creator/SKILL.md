---
name: pptx-creator
description: >
  Builds and edits PowerPoint .pptx files programmatically with python-pptx:
  complete decks, single slides, native charts, tables, images, and speaker
  notes, all from rerunnable generator scripts with a render-and-inspect QA
  loop. Use this skill whenever the user asks to "create a PowerPoint", "make
  a .pptx", "build a slide deck", "generate slides from this CSV/JSON", "add
  a slide to an existing deck", "make a chart slide", "put this table on a
  slide", "add speaker notes", "duplicate this deck template with new data",
  "convert this report into slides", or "give me a presentation file I can
  open in PowerPoint/Keynote/Google Slides". Also use it for mechanical deck
  surgery: changing slide size, removing default placeholder text, fixing
  fonts, inserting logos, or batch-producing one slide per data row. It owns
  the full design system enforcement: 16:9 canvas, safe margins, type scale,
  five-color palette, and slide archetypes with exact geometry. Do NOT use
  this skill for deciding what the deck should say — narrative, storyboard,
  action titles, and delivery planning are slides-creator's job (route there
  first, then bring the approved storyboard here for production). Do NOT use
  it for PDF documents — that is pdf-creator's job — and do NOT use it for
  spreadsheet deliverables — that is excel-creator's job. Every deck ships
  only after LibreOffice/Poppler rendering confirms zero overflow, zero
  off-canvas shapes, and zero leftover "Click to add" placeholders.
---

# PPTX Creator
> Produce clean, correctly-laid-out .pptx decks from python-pptx scripts, enforcing a design system and visually QA-ing every slide before delivery.

## 0. Operating Rules (Non-Negotiable)

1. **ALWAYS build decks from a script using `prs.slide_layouts[6]` (Blank) as the layout for every slide.** NEVER rely on placeholder-driven layouts for content slides. Why: blank layout + explicit textboxes gives deterministic geometry; theme placeholders reflow unpredictably across PowerPoint/LibreOffice versions and leave "Click to add" ghosts.
2. **ALWAYS set the canvas to 16:9 explicitly:** `prs.slide_width = Inches(13.333)`, `prs.slide_height = Inches(7.5)`. Why: the python-pptx default template is 4:3 (10 × 7.5 in); a 16:9 design measured on a 4:3 canvas overflows.
3. **ALWAYS pass BOTH `width` and `height` to `add_picture`, computed from the image's real pixel aspect ratio via PIL.** NEVER pass only one dimension for full-bleed art. Why: one dimension alone letterboxes with wrong coverage; guessed pairs distort — both are caught instantly in QA.
4. **ALWAYS work in `Inches`/`Pt`/`Emu` unit objects, never raw floats.** Why: python-pptx stores EMUs (914400 per inch); passing floats works in some signatures and fails in others — unit objects are safe everywhere.
5. **NEVER use font sizes below 12 pt anywhere, body text 16–20 pt.** Why: decks are read at room distance; 12 pt on a slide is 9 pt print. If it doesn't fit, the slide has too much content — cut content, not type size.
6. **NEVER leave unused placeholders or default text frames on a slide.** Blank layout avoids them, but if you open a themed template you MUST delete empty placeholder shapes. Why: unrendered decks show "Click to add title" in the final PDF export — an instant credibility kill.
7. **ALWAYS define the 5-color palette (background, primary text, accent, secondary, muted) as module-level constants and reference ONLY those.** Why: ad-hoc `RGBColor(0x3E, ...)` improvisation produces rainbow decks that QA can see immediately.
8. **ALWAYS write speaker notes** (`slide.notes_slide.notes_text_frame.text = "..."`) as 3–5 cue bullets, NEVER as a transcript of the slide. Why: duplicated text turns presenters into readers.
9. **ALWAYS run the QA loop before delivery:** `soffice --headless --convert-to pdf deck.pptx` → `pdftoppm -r 60 -jpeg deck.pdf qa/slide` → inspect EVERY slide image. NEVER deliver a deck you have not rendered. Why: python-pptx reports success for geometrically broken slides; only pixels tell the truth.
10. **Fix the generator script and re-run, NEVER the .pptx by hand.** Why: a hand-patched pptx is destroyed the next time the script runs, and patching hides the real layout bug.
11. **ALWAYS use widely-available fonts (Arial, Calibri, Segoe UI, Georgia) and state the font requirement in delivery notes.** Why: missing fonts silently substitute on the viewer's machine, reflowing every text box you measured.
12. **NEVER overlap shapes or run text to canvas edges.** Keep all content inside safe margins: ≥ 0.6 in from every edge. Why: projectors and TV walls crop 3–5% of the frame; margin content disappears.

## 1. When to Use / When Not To

**Use this skill when:**
- A `.pptx` file must be created, extended, or batch-generated from data (CSV/JSON rows → slides).
- Slides need native charts (`add_chart`), tables (`add_table`), images, shapes, or speaker notes.
- An existing deck needs mechanical surgery: fix slide size, swap images, replace text, delete placeholder ghosts.
- A template deck must be duplicated and refilled with new numbers each week/month.
- QA requires rendering the deck to PDF/images for visual inspection.

**Do NOT use this skill when:**

| The request is actually about... | Route it to |
|---|---|
| What the deck should SAY: story, slide order, action titles, storyboard, delivery coaching | **slides-creator** (do this FIRST, then come here) |
| Producing PDF documents/reports/invoices | **pdf-creator** |
| Spreadsheet (.xlsx/CSV) deliverables or data analysis workbooks | **excel-creator** |

Division of labor: **slides-creator decides, pptx-creator builds.** If the user's request is only "make me a deck about X" with no storyboard supplied, produce the storyboard (or request slides-creator's output), then implement.

## 2. Core Concepts & Mental Models

- **python-pptx is a geometry engine, not a layout engine.** It places exactly what you tell it where you tell it. There is NO auto-layout, NO flow, NO constraint solver. You are the layout engine; every rectangle is your responsibility.
- **Everything lives on a slide as a shape.** `slide.shapes` is a collection of shapes: text boxes (`add_textbox`), autoshapes (`add_shape`), pictures (`add_picture`), tables (`add_table`), charts (`add_chart`), groups. Each has `left, top, width, height` in EMUs.
- **EMU (English Metric Unit): 914400 per inch, 12700 per point.** `Inches(13.333)` → 12191712 EMU (python-pptx rounds to the integer EMU it accepts). Helpers: `Inches()`, `Cm()`, `Pt()`, `Emu()`. Store positions as Inches variables; compute gutters arithmetically.
- **Text frame → paragraphs → runs.** A `text_frame` contains `paragraphs`; each paragraph contains `runs`. Formatting lives at BOTH levels: `paragraph.alignment`, `paragraph.space_after`, `paragraph.line_spacing` vs `run.font.size`, `run.font.bold`, `run.font.color.rgb`, `run.font.name`. Mixed-weight headings (bold lead + regular rest) are multiple runs in one paragraph.
- **Two ways to make text:** textboxes (full control, recommended) and placeholders from layouts (inherit theme, unpredictable geometry). This skill standardizes on blank layout + textboxes.
- **Tables auto-grow:** row height increases with wrapped text and NEVER shrinks below what you set. Underestimate your row heights and the table pushes past the bottom margin — the classic overflow bug.
- **Native charts are editable but style-limited; matplotlib PNGs look identical everywhere but are frozen images.** Decision table in §6.
- **Rendering truth:** LibreOffice's `soffice --headless --convert-to pdf` is the reference renderer in this pipeline; PowerPoint's exact kerning may differ ±2%, so leave breathing room rather than pixel-fitting.

## 3. Mandatory Workflow

1. **Secure the storyboard.** Get the slide-by-slide blueprint (from slides-creator or your own plan): slide #, archetype, action title, content, data. NEVER start coding without it. Why: rework after geometry is set is the most expensive kind.
2. **Collect assets and data.** Confirm every image path exists (PIL-verify each), every chart has its numbers, every table its rows. Missing assets are discovered NOW, not mid-build.
3. **Set up the design system module** (constants at the top of the script): slide size, palette, font family, type scale, margins, and a `SLIDE_W/SLIDE_H` pair. Every later measurement derives from these — no magic numbers in functions.
4. **Write one build function per archetype** (`build_cover(prs, spec)`, `build_bullets(prs, spec)`, `build_chart(prs, spec)`, ...) that takes a spec dict and returns the slide. Why: archetype functions are reusable across decks and testable one at a time.
5. **Assemble:** create `Presentation()`, set size, loop specs, call builders, add speaker notes, save. `prs.save("deck.pptx")` is the ONLY write step.
6. **Render for QA:** `soffice --headless --convert-to pdf deck.pptx` then `pdftoppm -r 60 -jpeg deck.pdf qa/slide`. Inspect EVERY slide for: text overflow past boxes, overlaps, off-canvas shapes, tiny/low-contrast text, distorted images, leftover placeholders, table row growth past margins.
7. **Verify structurally:** slide count matches the storyboard; open the PDF's text (`pdftotext`) and confirm each action title present, no "Click to add", no placeholder residue.
8. **Fix the generator, rebuild, re-render.** Loop 6–8 until every slide is clean. NEVER patch the pptx.
9. **Deliver** deck + script + notes: slide count, fonts used, and explicit "every slide rendered and inspected" statement. If fonts beyond Arial/Calibri were used, call that out so recipients install them.

## 4. Deep Knowledge Library

### 4.1 python-pptx Core Inventory

| Need | API | Notes |
|---|---|---|
| New deck | `Presentation()` | Starts from default 4:3 template — resize immediately |
| Slide size | `prs.slide_width = Inches(13.333)`; `prs.slide_height = Inches(7.5)` | ALWAYS before adding slides |
| Add slide | `prs.slides.add_slide(prs.slide_layouts[6])` | Index 6 = Blank in the default template |
| Textbox | `slide.shapes.add_textbox(l, t, w, h)` | Then `tf = box.text_frame` |
| Word wrap | `tf.word_wrap = True` | Without it, long lines run off-canvas |
| Auto-size | `tf.auto_size = MSO_AUTO_SIZE.NONE` | Avoids surprise box resizing on open |
| Paragraph | `tf.paragraphs[0]` (first) or `tf.add_paragraph()` | First paragraph exists and is empty |
| Run | `p.add_run()` → `run.text = "..."` | Formatting per run |
| Shape | `slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, l, t, w, h)` | Fill/line via `shape.fill`, `shape.line` |
| Picture | `slide.shapes.add_picture(path, l, t, width=, height=)` | ALWAYS both dims from PIL |
| Table | `slide.shapes.add_table(rows, cols, l, t, w, h).table` | Returns `table`; style cells individually |
| Chart | `slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, l, t, w, h, chart_data).chart` | `CategoryChartData` first |
| Notes | `slide.notes_slide.notes_text_frame.text = "..."` | Accessing `.notes_slide` creates it |
| Save | `prs.save("deck.pptx")` | Only at the end |

Enums to import: `from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE`, `from pptx.enum.shapes import MSO_SHAPE`, `from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION`, `from pptx.dml.color import RGBColor`, `from pptx.util import Inches, Pt, Emu`.

### 4.2 Text Frames Done Right

```python
def add_text(slide, x, y, w, h, text, size=18, bold=False, color=INK,
             align=PP_ALIGN.LEFT, font=FONT, line_spacing=1.1, space_after=6,
             anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = line_spacing
    p.space_after = Pt(space_after)
    run = p.add_run(); run.text = text
    f = run.font
    f.size = Pt(size); f.bold = bold; f.name = font
    f.color.rgb = color
    return box
```

- `line_spacing = 1.1` (float multiplier) tightens bullet blocks; 1.0 for titles.
- `MSO_ANCHOR.MIDDLE` vertically centers (quote slides, table cells, KPI blocks).
- For a heading with a bold lead-in ("Revenue +23% — EMEA led all regions"), make two runs in one paragraph: `r1 = p.add_run(); r1.font.bold = True` then a regular `r2`.
- Text boxes do NOT clip overflow text; it just spills visibly past the box. Box heights are therefore *guidance for you*, not protection — QA is mandatory.
- Empty `tf.paragraphs[0]` in an untouched textbox renders as invisible — fine. A placeholder (from layouts) with no text renders as "Click to add" — never ship that.

### 4.3 The Design System (enforced on every deck)

```python
# ---- design system: change HERE, never at call sites ----
SLIDE_W, SLIDE_H = 13.333, 7.5            # inches, 16:9
MARGIN = 0.6                               # safe area on all sides
FONT = "Calibri"                           # Arial / Segoe UI / Calibri / Georgia
BG      = RGBColor(0xFF, 0xFF, 0xFF)       # background
INK     = RGBColor(0x1F, 0x2A, 0x44)       # primary text
ACCENT  = RGBColor(0x0F, 0x8A, 0x8A)       # accent (titles' underline, highlights)
SECOND  = RGBColor(0x5B, 0x71, 0x83)       # secondary text / chart series 2
MUTED   = RGBColor(0xA3, 0xAD, 0xB6)       # captions, gridlines, footers
TITLE_SIZE, SECTION_SIZE, BODY_SIZE, CAPTION_SIZE = 30, 22, 18, 12
```

- **Type scale:** slide title 28–34 pt (use 30), section headers 20–24, body 16–20 (use 18), captions/footnotes 12. NOTHING below 12 pt, ever.
- **Safe area:** everything inside `[MARGIN, SLIDE_W − MARGIN] × [MARGIN, SLIDE_H − MARGIN]` ⇒ usable 12.13 × 6.3 in. Compute every shape against these bounds.
- **Title discipline:** every content slide's title occupies the SAME rect: `x=MARGIN, y=0.45, w=SLIDE_W−2*MARGIN, h=0.9`. Identical position on every slide is what makes a deck look designed.
- **One accent color.** Used for: title rule lines, one chart series, one highlight box. If everything is accent, nothing is.
- **Background:** white `BG` on all content slides; `INK` background with `BG` text allowed ONLY on cover, section dividers, and closing slide (the "dark slide" rhythm).

### 4.4 Slide Archetypes — Concrete Geometry (all values in inches)

| Archetype | Key rectangles (x, y, w, h) | Type roles |
|---|---|---|
| Cover | full-bleed picture `0,0,13.333,7.5` (crop to fill) + scrim rect `0,3.9,13.333,3.6` at 60% `INK` | Title 40 pt on scrim, subtitle 18 pt, date 12 pt |
| Agenda | title rect (standard); numbered rows: `0.7, 1.7+i*0.75, 11.9, 0.65` | Row number 20 pt ACCENT, row text 18 pt INK |
| Section divider | full `INK` background rect `0,0,13.333,7.5`; section number `0.7,2.4` 60 pt ACCENT; name `0.7,3.4,10,1.2` 34 pt white | BG-colored text on dark |
| Bullets | title (standard); bullet block `0.7,1.7,11.9,5.0` | ≤ 6 bullets, ≤ 2 lines each, 18 pt |
| Two-column | left `0.7,1.7,6.0,5.0`; right `6.9,1.7,5.7,5.0` (0.2 gutter between) | Column headers 20 pt bold, body 16–18 pt |
| Chart + takeaway | takeaway box `0.7,1.6,11.9,0.8` (18 pt bold, the insight); chart `0.7,2.6,11.9,4.2` | Chart title OFF (slide title states the insight) |
| Table | title (standard); table `0.7,1.7,11.9,~4.5`; header row shaded `INK`/white text | Body cells 14–16 pt; ≤ 6 rows on-slide |
| Quote | quote text `1.5,2.2,10.3,2.6` 24 pt italic centered; attribution `1.5,5.0,10.3,0.5` 14 pt MUTED | Large quotation mark 72 pt ACCENT at `0.7,1.6` |
| Timeline | horizontal line `0.9,3.9,11.5,0.02` (thin rect); milestone dots + alternating labels above/below | Milestone 14–16 pt; dates 12 pt MUTED |
| Comparison | two half-panels: `0.7,1.7,5.9,4.9` and `6.73,1.7,5.9,4.9`; headers colored differently | "us/them" or "before/after" |
| Closing | dark slide like divider; CTA sentence 28 pt + contact line 14 pt | One action, no recap dump |

Rules per archetype: **bullets** — parallel grammatical structure, no terminal periods; **chart+takeaway** — the title IS the takeaway sentence; **quote** — attribution = name, role, company, no anonymous quotes; **comparison** — symmetric heights so neither side "wins" by layout accident.

### 4.5 Pictures Without Distortion (cover-crop math)

```python
from PIL import Image as PILImage

def add_cover_picture(slide, path, x, y, w, h):
    """Fill rect (x,y,w,h) with path, center-cropped like CSS object-fit: cover."""
    iw, ih = PILImage.open(path).size
    target, source = w / h, iw / ih
    pic = slide.shapes.add_picture(path, Inches(x), Inches(y),
                                   width=Inches(w), height=Inches(h))
    if source > target:                       # image too wide -> crop sides
        excess = 1 - target / source
        pic.crop_left = pic.crop_right = excess / 2
    else:                                     # image too tall -> crop top/bottom
        excess = 1 - source / target
        pic.crop_top = pic.crop_bottom = excess / 2
    return pic
```

`crop_*` values are fractions of the ORIGINAL image removed from each side (0.1 = 10%). This is the ONLY reliable way to fill a rect without distortion. For charts rendered as PNG, NEVER crop — place with exact `width`/`height` preserving the aspect ratio. Image resolution: ≥ 96 px per final inch is the floor, 150+ preferred (a 12-in-wide cover wants ≥ 1600 px wide source).

### 4.6 Tables

```python
from pptx.util import Inches, Pt
from pptx.enum.text import MSO_ANCHOR

def add_data_table(slide, x, y, w, rows_data, col_fracs):
    n_rows, n_cols = len(rows_data), len(rows_data[0])
    gfx = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y),
                                 Inches(w), Inches(0.4 * n_rows))
    table = gfx.table
    for i, frac in enumerate(col_fracs):                 # column widths
        table.columns[i].width = Inches(w * frac)
    for r, row in enumerate(rows_data):
        for c, val in enumerate(row):
            cell = table.cell(r, c)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = cell.margin_right = Inches(0.08)
            cell.margin_top = cell.margin_bottom = Inches(0.04)
            tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.RIGHT if (c > 0 and r > 0) else PP_ALIGN.LEFT
            run = p.add_run(); run.text = str(val)
            run.font.size = Pt(14); run.font.name = FONT
            run.font.bold = (r == 0)
            run.font.color.rgb = BG if r == 0 else INK
            cell.fill.solid()
            cell.fill.fore_color.rgb = INK if r == 0 else (
                BG if r % 2 else RGBColor(0xF2, 0xF4, 0xF7))
    return table
```

- **Row heights auto-GROW with wrapped text.** Budget: 14 pt text with 1–2 lines ≈ 0.4–0.6 in per row. A 7-row table starting at y=1.7 can reach y=6.4 — past the safe area if any cell wraps to 3 lines. Keep on-slide tables ≤ 6 data rows; the full table belongs in the appendix or handout.
- Set `table.columns[i].width` for every column; `col_fracs` must sum to 1.0.
- Header row: filled `INK`, white bold text. Zebra body rows optional but helpful ≥ 5 rows.
- The first table style PowerPoint applies (banded blue) comes from the default table style — the explicit per-cell fills above override it; do not fight it, replace it.

### 4.7 Native Charts (when you choose editable)

```python
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION

cd = CategoryChartData()
cd.categories = ["EMEA", "APAC", "Americas"]
cd.add_series("Revenue (EUR M)", (4.2, 2.9, 7.1))
gframe = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,
                                Inches(0.7), Inches(2.6), Inches(11.9), Inches(4.2), cd)
chart = gframe.chart
chart.has_legend = False                      # one series -> legend is noise
chart.has_title = False                       # slide title states the insight
plot = chart.plots[0]
plot.gap_width = 60                           # slimmer bars, modern look
plot.has_data_labels = True
plot.data_labels.number_format = "0.0"
plot.data_labels.number_format_is_linked = False
plot.data_labels.font.size = Pt(12)
series = plot.series[0]
series.format.fill.solid()
series.format.fill.fore_color.rgb = ACCENT
cat_axis = chart.category_axis
cat_axis.tick_labels.font.size = Pt(12)
val_axis = chart.value_axis
val_axis.has_major_gridlines = True
val_axis.major_gridlines.format.line.color.rgb = RGBColor(0xE4, 0xE7, 0xEB)
val_axis.tick_labels.font.size = Pt(12)
```

- Chart types that cover 95% of needs: `COLUMN_CLUSTERED`, `BAR_CLUSTERED`, `LINE_MARKERS`, `PIE` (≤ 5 slices only), `DOUGHNUT`, `SCATTER`.
- For a **highlight bar** (one bar accented, rest muted), iterate `plot.series[0].points` and set `point.format.fill` per point (python-pptx supports per-point formatting).
- `XL_LABEL_POSITION.OUTSIDE_END` works for bar/column; `INSIDE_END` for stacked. Pie labels: `XL_LABEL_POSITION.BEST_FIT`.
- Axis titles: `val_axis.has_title = True; val_axis.axis_title.text_frame.text = "EUR M"`.
- After ANY chart creation, the chart part may render with default fonts in LibreOffice QA — check tick label sizes in the render.

### 4.8 Speaker Notes

```python
notes = slide.notes_slide.notes_text_frame
notes.text = "Open with the EMEA win story (20s)\nContrast Q2 miss - keep it brief\n" \
             "If asked about APAC: pipeline covers H2, see backup slide 14"
```

- Accessing `slide.notes_slide` lazily creates the notes part — safe to call on any slide.
- Cue style: 3–5 short lines per slide: the ONE point to land, timing hint, anticipated question + pointer to backup. NEVER paste the slide's text again.
- Data-driven decks: generate notes from the same spec dicts so each slide's note mentions its own numbers.

### 4.9 Batch / Data-Driven Decks

Pattern: specs in, slides out — one function per archetype, one spec dict per slide.

```python
SPECS = [
    {"archetype": "cover",    "title": "Q3 2025 Business Review",
     "subtitle": "Analytics Team - October 2025"},
    {"archetype": "bullets",  "title": "Three things happened this quarter",
     "bullets": ["Revenue +13% YoY, led by EMEA", "Pro tier launched Aug 12",
                 "Churn stabilized at 1.8%/mo"]},
    {"archetype": "chart",    "title": "Revenue grew 23% in EMEA",
     "categories": ["EMEA", "APAC", "Americas"], "series": [(4.2, 2.9, 7.1)],
     "series_name": "Revenue (EUR M)"},
    # ... one dict per slide, exactly the storyboard
]
BUILDERS = {"cover": build_cover, "bullets": build_bullets, "chart": build_chart, ...}
prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
for spec in SPECS:
    BUILDERS[spec["archetype"]](prs, spec)
prs.save("deck.pptx")
```

- Load specs from CSV/JSON for batch decks: `json.load(open("deck_spec.json"))` or `csv.DictReader`. Validate required keys per archetype BEFORE building (`assert "bullets" in spec`).
- **Template reuse:** open an existing deck with `Presentation("template.pptx")`, iterate `prs.slides`, edit text of known shapes (keep a shape-name convention), or duplicate a slide's XML via `copy.deepcopy(slide._element)` into a new `SlidePart` — heavy but workable; prefer rebuilding from specs when geometry is known.
- Deck-level invariants to assert post-build: slide count == len(SPECS); every slide has a title shape; no `MSO_SHAPE_TYPE.PLACEHOLDER` with empty text remains.

### 4.10 Gotchas That Break Decks

| Gotcha | Mechanism | Defense |
|---|---|---|
| Font substitution | Viewer lacks "Segoe UI" → PowerPoint swaps, text reflows | Use Arial/Calibri; or ship font name in delivery notes |
| `auto_size` surprises | `MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT` resizes boxes on open | Always set `MSO_AUTO_SIZE.NONE` + `word_wrap=True` |
| "Click to add" ghosts | Placeholder with no content from themed layouts | Blank layout 6; or delete placeholder shapes after `add_slide` |
| Table row growth | Wrapped text increases row height, pushes table off-slide | ≤ 6 rows, 14–16 pt, compute worst-case height before placing |
| Image DPI too low | 500 px image stretched to 12 in = 42 ppi blur | Check pixel dims ≥ 96/inch of final size |
| EMU float positions | `Inches(1.5) + 0.3` silently returns float EMUs → next setter errors | Wrap: `Inches(x + 0.3)`; never add raw floats to `Inches()` results |
| Hyperlinks | Link lives on a RUN: `run.hyperlink.address = "https://..."` | Style link text with ACCENT color yourself (no auto underline) |
| Title truncation in thumbnails | Long titles clip in outline view | Keep titles ≤ ~70 chars; action titles can be two lines at 28 pt |
| Rotation units | `shape.rotation = 45` is degrees clockwise (float, fine) | Only rotate shapes, not text boxes with wrapped text |
| Notes lost on template edit | `notes_slide` created lazily | Set notes AFTER final slide assembly |

## 5. Code & Tool Templates

### 5.1 Complete Worked Template — 10-Slide Business Review Deck

```python
# business_review_deck.py — complete and runnable
# pip install python-pptx pillow
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.enum.shapes import MSO_SHAPE
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

# ---------------- design system ----------------
SLIDE_W, SLIDE_H, MARGIN = 13.333, 7.5, 0.6
FONT = "Calibri"
BG     = RGBColor(0xFF, 0xFF, 0xFF)
INK    = RGBColor(0x1F, 0x2A, 0x44)
ACCENT = RGBColor(0x0F, 0x8A, 0x8A)
SECOND = RGBColor(0x5B, 0x71, 0x83)
MUTED  = RGBColor(0xA3, 0xAD, 0xB6)
SOFT   = RGBColor(0xF2, 0xF4, 0xF7)

def new_deck():
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(SLIDE_W), Inches(SLIDE_H)
    return prs

def add_slide(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])   # Blank

def txt(slide, x, y, w, h, text, size=18, bold=False, color=INK,
        align=PP_ALIGN.LEFT, italic=False, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap, tf.auto_size = True, MSO_AUTO_SIZE.NONE
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = text
    r.font.size, r.font.bold, r.font.italic = Pt(size), bold, italic
    r.font.name, r.font.color.rgb = FONT, color
    return box

def rect(slide, x, y, w, h, color, line=False):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color
    if line: sh.line.color.rgb = color; sh.line.width = Pt(1)
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    return sh

def title_bar(slide, text):
    txt(slide, MARGIN, 0.45, SLIDE_W - 2*MARGIN, 0.9, text, size=30, bold=True)
    rect(slide, MARGIN, 1.45, 1.6, 0.045, ACCENT)       # accent rule under title

def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text

def bullets(slide, x, y, w, h, items, size=18):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap, tf.auto_size = True, MSO_AUTO_SIZE.NONE
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after, p.line_spacing = Pt(10), 1.1
        r = p.add_run(); r.text = "-  " + item
        r.font.size, r.font.name, r.font.color.rgb = Pt(size), FONT, INK
    return box

# ---------------- archetype builders ----------------
def build_cover(prs, title, subtitle):
    s = add_slide(prs)
    rect(s, 0, 0, SLIDE_W, SLIDE_H, INK)
    rect(s, 0.9, 3.1, 2.2, 0.06, ACCENT)
    txt(s, 0.9, 3.4, 11.5, 1.4, title, size=40, bold=True, color=BG)
    txt(s, 0.9, 4.9, 11.5, 0.6, subtitle, size=18, color=MUTED)
    return s

def build_agenda(prs, title, items):
    s = add_slide(prs); title_bar(s, title)
    for i, item in enumerate(items):
        y = 1.9 + i * 0.85
        txt(s, 0.8, y, 0.7, 0.6, f"0{i+1}", size=20, bold=True, color=ACCENT)
        txt(s, 1.7, y, 10.5, 0.6, item, size=18)
    return s

def build_bullets(prs, title, items):
    s = add_slide(prs); title_bar(s, title)
    bullets(s, 0.8, 1.9, 11.7, 4.9, items)
    return s

def build_two_col(prs, title, left_head, left_items, right_head, right_items):
    s = add_slide(prs); title_bar(s, title)
    for x, head, items in ((0.8, left_head, left_items), (6.95, right_head, right_items)):
        txt(s, x, 1.9, 5.6, 0.5, head, size=20, bold=True, color=ACCENT)
        bullets(s, x, 2.5, 5.6, 4.0, items, size=16)
    return s

def build_chart(prs, title, cats, values, series_name):
    s = add_slide(prs); title_bar(s, title)
    cd = CategoryChartData(); cd.categories = cats
    cd.add_series(series_name, values)
    gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,
                            Inches(0.8), Inches(2.0), Inches(11.7), Inches(4.6), cd)
    ch = gf.chart
    ch.has_legend, ch.has_title = False, False
    plot = ch.plots[0]; plot.gap_width = 60
    plot.has_data_labels = True
    plot.data_labels.font.size = Pt(12)
    ser = plot.series[0]
    ser.format.fill.solid(); ser.format.fill.fore_color.rgb = ACCENT
    ch.category_axis.tick_labels.font.size = Pt(12)
    va = ch.value_axis
    va.tick_labels.font.size = Pt(12)
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = SOFT
    return s

def build_table(prs, title, rows):
    s = add_slide(prs); title_bar(s, title)
    n_r, n_c = len(rows), len(rows[0])
    tbl = s.shapes.add_table(n_r, n_c, Inches(0.8), Inches(1.95),
                             Inches(11.7), Inches(0.45*n_r)).table
    for c in range(n_c):
        tbl.columns[c].width = Inches(11.7 / n_c)
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            cell.fill.fore_color.rgb = INK if r == 0 else (BG if r % 2 else SOFT)
            tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.RIGHT if (c > 0 and r > 0) else PP_ALIGN.LEFT
            run = p.add_run(); run.text = str(val)
            f = run.font
            f.size, f.name = Pt(14), FONT
            f.bold = (r == 0)
            f.color.rgb = BG if r == 0 else INK
    return s

def build_quote(prs, quote, who):
    s = add_slide(prs)
    txt(s, 0.8, 1.5, 2.0, 1.2, "\u201C", size=72, bold=True, color=ACCENT)
    txt(s, 1.6, 2.4, 10.2, 2.4, quote, size=24, italic=True, align=PP_ALIGN.CENTER,
        anchor=MSO_ANCHOR.MIDDLE)
    txt(s, 1.6, 5.1, 10.2, 0.5, who, size=14, color=MUTED, align=PP_ALIGN.CENTER)
    return s

def build_timeline(prs, title, milestones):
    s = add_slide(prs); title_bar(s, title)
    rect(s, 0.9, 3.9, 11.5, 0.03, MUTED)                 # the axis line
    n = len(milestones)
    for i, (when, what) in enumerate(milestones):
        cx = 0.9 + (i + 0.5) * (11.5 / n)
        rect(s, cx - 0.07, 3.83, 0.14, 0.14, ACCENT)     # dot (autoshape)
        up = (i % 2 == 0)
        y_txt = 3.15 if up else 4.15
        txt(s, cx - 1.0, y_txt, 2.0, 0.35, when, size=12, color=SECOND,
            align=PP_ALIGN.CENTER)
        txt(s, cx - 1.1, y_txt + 0.38, 2.2, 0.75, what, size=14, bold=True,
            align=PP_ALIGN.CENTER)
    return s

def build_closing(prs, cta, contact):
    s = add_slide(prs)
    rect(s, 0, 0, SLIDE_W, SLIDE_H, INK)
    txt(s, 0.9, 2.9, 11.5, 1.3, cta, size=28, bold=True, color=BG)
    txt(s, 0.9, 4.4, 11.5, 0.5, contact, size=14, color=MUTED)
    return s

# ---------------- assemble the 10-slide deck ----------------
prs = new_deck()
s1  = build_cover(prs, "Q3 2025 Business Review", "Analytics Team - October 2025")
notes(s1, "Welcome; 20 minutes total\nFlag: decision needed on EMEA headcount")
s2  = build_agenda(prs, "Today in three moves",
                   ["What happened", "What it means", "What we decide today"])
notes(s2, "Promise: one decision at the end")
s3  = build_bullets(prs, "Q3 delivered growth despite a slower market",
                    ["Revenue EUR 14.2M, +13% year over year",
                     "EMEA grew 23%, now 30% of total revenue",
                     "Pro tier launched August 12, already 8% of sales",
                     "Gross margin steady at 61%",
                     "Monthly churn held at 1.8%"])
notes(s3, "Lead with EMEA win (20s)\nDo not read bullets - expand on Pro tier only")
s4  = build_two_col(prs, "Two engines, one brake",
                    "Working", ["EMEA pipeline up 40%", "Pro tier attach rate 8%",
                                "NPS improved to 46"],
                    "Watching", ["Americas growth cooled to 6%",
                                 "Cloud costs up 9 points",
                                 "Two enterprise deals slipped to Q4"])
notes(s4, "Frame the brake as timing, not demand loss")
s5  = build_chart(prs, "Revenue grew 23% in EMEA, led all regions",
                  ["EMEA", "APAC", "Americas"], (4.2, 2.9, 7.1), "Revenue (EUR M)")
notes(s5, "Point at the gap to Americas\nIf asked: Americas softness is pricing")
s6  = build_table(prs, "Regional scorecard, Q3 2025",
                  [["Region", "Revenue", "YoY", "Share"],
                   ["EMEA", "EUR 4.2M", "+23%", "30%"],
                   ["APAC", "EUR 2.9M", "+11%", "20%"],
                   ["Americas", "EUR 7.1M", "+6%", "50%"]])
notes(s6, "Share stable; mix shifting to EMEA over 4 quarters")
s7  = build_quote(prs, "The Pro tier trial was the smoothest rollout we have "
                       "run - zero P1 incidents in week one.",
                  "Head of Platform Engineering, top-5 customer")
notes(s7, "Let it breathe - 3 second pause after reading")
s8  = build_timeline(prs, "Roadmap to 2026",
                     [("Nov 2025", "4 EMEA AEs hired"),
                      ("Jan 2026", "Pro tier v2"),
                      ("Mar 2026", "APAC launch"),
                      ("Jun 2026", "EUR 60M ARR run-rate")])
notes(s8, "Each date has an owner; details in appendix")
s9  = build_bullets(prs, "The ask: four EMEA sales hires now",
                    ["Approve 4 EMEA AE headcount for Q4 (EUR 0.6M fully loaded)",
                     "Protect the EUR 5.8M H1-2026 pipeline",
                     "Decision needed by Nov 1 to hit Jan start dates"])
notes(s9, "State the ask first, then the rationale\nThis is THE decision slide")
s10 = build_closing(prs, "Approve 4 EMEA hires by Nov 1", "analytics@acme.example")
notes(s10, "Close with the ask, open the floor")
prs.save("business_review_deck.pptx")
print("slides:", len(prs.slides._sldIdLst))   # asserts slide count == 10
```

Run the script, then QA per §5.2. The deck must render as exactly 10 slides with no placeholders.

### 5.2 QA Render Script

```python
# qa_deck.py — complete and runnable; run after EVERY build
import subprocess, sys, os, glob

def qa(pptx):
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", pptx],
                   check=True, capture_output=True)
    pdf = os.path.splitext(pptx)[0] + ".pdf"
    os.makedirs("qa", exist_ok=True)
    subprocess.run(["pdftoppm", "-r", "60", "-jpeg", pdf, "qa/slide"], check=True)
    pages = sorted(glob.glob("qa/slide-*.jpg"))
    print(f"rendered {len(pages)} slide images -> inspect EVERY qa/slide-*.jpg")
    print("check: overflow | overlap | off-canvas | tiny text | low contrast | "
          "'Click to add' ghosts | distorted images")
    return len(pages)

qa(sys.argv[1] if len(sys.argv) > 1 else "business_review_deck.pptx")
```

If `soffice` is unavailable, say so and QA by re-opening the file with python-pptx to verify shape bounds: `shape.left + shape.width <= prs.slide_width` for every shape (geometry-only check, still no substitute for pixels).

### 5.3 One-Row-Per-File Batch Deck

```python
# batch_deck.py — one slide per CSV row (complete and runnable)
import csv
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_AUTO_SIZE

INK  = RGBColor(0x1F, 0x2A, 0x44)
MUTED = RGBColor(0xA3, 0xAD, 0xB6)
ACCENT = RGBColor(0x0F, 0x8A, 0x8A)

def txt(slide, x, y, w, h, text, size, bold=False, color=INK,
        align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap, tf.auto_size = True, MSO_AUTO_SIZE.NONE
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = text
    r.font.size, r.font.bold, r.font.name = Pt(size), bold, "Calibri"
    r.font.color.rgb = color
    return box

def build_row_slide(prs, row):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    txt(s, 0.6, 0.5, 12.1, 1.0, f"{row['name']}: {row['headline']}",
        size=30, bold=True, color=INK)
    txt(s, 0.6, 1.9, 12.1, 4.5, row["body"], size=18, color=INK)
    txt(s, 0.6, 6.7, 12.1, 0.4, f"Owner: {row['owner']} - Status: {row['status']}",
        size=12, color=MUTED)
    return s

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
with open("projects.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        build_row_slide(prs, row)
prs.save("batch_review.pptx")
print("slides:", len(prs.slides._sldIdLst))
```

Validate the CSV header contains every key used in the builder BEFORE building; a missing key at slide 30 of 40 is an avoidable crash.

## 6. Decision Tables

**Table 1 — Chart strategy: native pptx chart vs matplotlib PNG.**

| Criterion | Native (`add_chart`) | matplotlib PNG (`add_picture`) |
|---|---|---|
| Recipient must edit data in PowerPoint | WIN | loses |
| Identical typography everywhere | loses (theme-dependent) | WIN |
| Complex annotation (callouts, highlight deltas) | limited | WIN |
| Build-time dependency | python-pptx only | + matplotlib |
| Multi-series / small multiples | possible, fiddly | WIN |
| Default choice | When editability is explicitly requested | Otherwise (visual reliability first) |

**Table 2 — Which XL_CHART_TYPE for the message.**

| Message | Type | Watch out |
|---|---|---|
| Compare categories | `COLUMN_CLUSTERED` | ≤ 6 categories; sort by value |
| Ranking horizontal | `BAR_CLUSTERED` | Labels read left; put largest on top |
| Trend over time | `LINE_MARKERS` | ≤ 4 series or it is spaghetti |
| Part-of-whole | `PIE` / `DOUGHNUT` | ≤ 5 slices; data labels with percent |
| Two-variable relationship | `SCATTER` | Python-pptx uses `XyChartData` (see below) |
| Composition over time | `COLUMN_STACKED` | `XL_LABEL_POSITION.INSIDE_END` |

Scatter needs a different data class: `from pptx.chart.data import XyChartData; cd = XyChartData(); s = cd.add_series("pts"); s.add_data_point(1.2, 3.4)`.

**Table 3 — Bullet count vs slide real estate.**

| Bullets | Layout | Notes |
|---|---|---|
| 1–3 | One-liner rows y=2.2, step 1.1 in | Big type 20 pt; lots of air is fine |
| 4–6 | Bullet block y=1.9 h=4.9, 18 pt, step ~0.75 in | THE standard content slide |
| 7+ | FORBIDDEN on one slide | Split into two slides or move to appendix |

**Table 4 — When to open an existing file vs rebuild from specs.**

| Situation | Action |
|---|---|
| Weekly deck, same 10 slides, new numbers | Rebuild from specs (template script) — deterministic |
| Recipient's corporate template must be preserved | Open `Presentation("corp.pptx")`, use ITS layouts, minimal edits |
| One slide needs a fix | Rebuild the whole deck from the script when available; patch via python-pptx only if no script exists |
| Deck > 50 slides from data | Batch builder from CSV/JSON rows |

## 7. Quality Checklist

Verify EVERY item before declaring the task complete:

- [ ] Canvas explicitly 16:9: `prs.slide_width = Inches(13.333)`, `prs.slide_height = Inches(7.5)`.
- [ ] Every slide uses the Blank layout (index 6) or, on themed templates, every placeholder is either filled or deleted.
- [ ] Slide count matches the storyboard exactly (asserted in the script, not assumed).
- [ ] Every shape sits inside the safe area: ≥ 0.6 in from all four edges.
- [ ] Titles occupy the same rect on every content slide (consistent position).
- [ ] Type scale respected: titles 28–34, sections 20–24, body 16–20, captions 12; NOTHING below 12 pt.
- [ ] Only the 5 defined palette colors appear; one accent color does the highlighting.
- [ ] One sans-serif font family throughout; font availability documented in delivery notes.
- [ ] Every bullet block ≤ 6 bullets, each ≤ 2 lines, parallel grammar.
- [ ] Every picture added with BOTH width and height computed from real pixel aspect ratio (no distortion).
- [ ] Full-bleed cover images use crop_* math, not stretching.
- [ ] Tables ≤ 6 data rows on-slide; header row styled; numbers right-aligned; worst-case row growth verified in render.
- [ ] Charts: legend/title removed when the slide title carries the message; tick labels ≥ 12 pt; series color from palette.
- [ ] Chart titles are action titles stating the insight, not topic labels.
- [ ] Speaker notes present on every slide, cue-style (3–5 lines), not slide-text duplicates.
- [ ] No "Click to add" text anywhere in the rendered output.
- [ ] Deck rendered via `soffice --headless --convert-to pdf` → `pdftoppm -r 60` and EVERY slide image inspected.
- [ ] No overflow, overlap, off-canvas shapes, or low-contrast text on any slide.
- [ ] File opens cleanly (python-pptx re-open + slide count check passes).
- [ ] Generator script stored alongside the deck; all changes were made in the script.

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | 16:9 design built on default 4:3 canvas | Content clipped on right edge | Set `slide_width=Inches(13.333)` BEFORE adding slides |
| 2 | Placeholder-driven content slide | "Click to add title" ghosts after render; theme fonts override | Use blank layout + explicit textboxes |
| 3 | `add_picture` with only width | Wrong height letterboxing | Compute height from PIL aspect; or use cover-crop helper (§4.5) |
| 4 | Passing raw floats instead of `Inches()` | `TypeError` or EMU overflow errors | Wrap every position: `Inches(x)` |
| 5 | `Inches(1.5) + 0.3` arithmetic | Float EMU breaks subsequent setters | `Inches(1.5 + 0.3)` — add in inches, then wrap |
| 6 | Table auto-grew past bottom margin | Last rows invisible in render | Fewer rows, 14–16 pt, verify worst-case wrap in QA |
| 7 | Text box too small, assumed clipping | Text spills over other shapes | Boxes don't clip; enlarge box or shrink font; QA renders |
| 8 | Missing `tf.word_wrap = True` | Long lines run off the right edge | Always set word_wrap + MSO_AUTO_SIZE.NONE |
| 9 | Chart with default 5-color theme | Rainbow series clash with palette | Set `series.format.fill.fore_color.rgb` per series |
| 10 | Legend left on single-series chart | Useless legend box shrinks plot | `chart.has_legend = False` |
| 11 | Font not on viewer machine | Reflowed text, broken alignment | Arial/Calibri only; note the requirement otherwise |
| 12 | Notes duplicate slide text | Presenter reads slides verbatim | Cue-style notes: point, timing, likely question |
| 13 | Set `slide_width` after adding slides | Existing shapes stay 4:3-positioned | Resize FIRST, then build |
| 14 | `notes_slide` on template-copied slide missing | `AttributeError` | Access `slide.notes_slide` (it creates the part) — but only on a valid slide object |
| 15 | Deleting a shape you still reference | `ReferenceError`-like stale access | Delete LAST in each builder; keep builders side-effect-isolated |
| 16 | Mixed alignment (centered some slides, left others) | Deck looks amateur | Standard: left-align everything except quotes/covers |

## 9. Advanced Techniques

### 9.1 Per-point highlighting (the "one accent bar" chart)

```python
from pptx.enum.chart import XL_LABEL_POSITION
series = chart.plots[0].series[0]
for i, point in enumerate(series.points):
    point.format.fill.solid()
    point.format.fill.fore_color.rgb = ACCENT if i == 0 else RGBColor(0xD3, 0xD8, 0xDE)
plot.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
```

Mute everything, accent the ONE bar the title talks about. This single trick makes decks look professionally designed.

### 9.2 Shape name conventions for template decks

```python
title_box = txt(slide, 0.6, 0.45, 12.1, 0.9, "Title", 30, bold=True)
title_box.name = "ACTION_TITLE"          # python-pptx: shape.name = "..."
```

Later edits become data-driven and robust:
```python
for slide in prs.slides:
    for sh in slide.shapes:
        if sh.name == "ACTION_TITLE":
            sh.text_frame.paragraphs[0].runs[0].text = new_title
```

Relying on shape order (`slide.shapes[2]`) breaks the moment anyone touches the deck; names survive reordering.

### 9.3 Scrim + full-bleed photo covers that stay legible

Full-bleed image (§4.5 crop math) + a semi-transparent overlay: python-pptx has no direct alpha API, so fake it — place a solid `INK` rectangle over the photo's lower band and, when transparency is essential, write the alpha directly into the XML: `sh.fill.fore_color._xFill` manipulation is fragile — prefer a pre-darkened image (PIL `ImageEnhance.Brightness(img).enhance(0.55)` saved to a temp PNG) and keep all fills solid. Legibility rule: text on photos ALWAYS sits on a darkened band or scrim, never directly on busy pixels.

### 9.4 Geometry linter (catch overflow before rendering)

```python
def geometry_report(prs):
    W, H = prs.slide_width, prs.slide_height
    issues = []
    for i, slide in enumerate(prs.slides, 1):
        for sh in slide.shapes:
            if sh.left is None:
                continue
            if sh.left < 0 or sh.top < 0 or sh.left + sh.width > W or sh.top + sh.height > H:
                issues.append((i, sh.shape_type, sh.name))
    return issues   # [] means every shape is on-canvas
```

Run it post-build; empty list = no off-canvas shapes. It cannot see text overflow, so it complements — never replaces — the visual render.

### 9.5 Section dividers + navigation footer at scale

For decks > 12 slides: number every content slide bottom-right (`txt(s, 12.35, 7.05, 0.6, 0.3, str(n), 12, color=MUTED)`), and add a thin progress bar (`rect(s, 0, 7.42, SLIDE_W * n/total, 0.08, ACCENT)`) rebuilt per slide from the loop index. Both cost two lines and make long decks navigable in PDF exports where click-navigation dies.

## 10. Quick Reference Card

```
pip install python-pptx pillow
Canvas: prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
Slide:  prs.slides.add_slide(prs.slide_layouts[6])   # Blank
Units:  Inches / Pt / Emu (914400 EMU per inch); ALWAYS wrap, never raw floats
Text:   add_textbox -> tf.word_wrap=True; tf.auto_size=MSO_AUTO_SIZE.NONE
        p.alignment=PP_ALIGN.LEFT; r=p.add_run(); r.font.size=Pt(18) ...
Colors: RGBColor(0x1F,0x2A,0x44); 5-color palette, ONE accent
Type:   title 30 / section 22 / body 18 / caption 12; NEVER < 12pt
Safe:   margins 0.6in; usable 12.13 x 6.3 in
Image:  add_picture(..., width=Inches(w), height=Inches(h)) BOTH from PIL ratio
        cover-fill: pic.crop_left/right/top/bottom (fractions of source)
Table:  add_table(r,c,...).table; columns[i].width; rows auto-GROW; <= 6 rows
Chart:  CategoryChartData + add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,...)
        has_legend=False; series.format.fill...; data_labels for values
Notes:  slide.notes_slide.notes_text_frame.text = "cue bullets, not transcript"
QA:     soffice --headless --convert-to pdf deck.pptx
        pdftoppm -r 60 -jpeg deck.pdf qa/slide   -> inspect EVERY image
Fix the generator, never the .pptx. Storyboard first (slides-creator).
```
