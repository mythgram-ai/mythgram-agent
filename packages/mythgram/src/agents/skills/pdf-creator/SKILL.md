---
name: pdf-creator
description: >
  Generates polished, print-ready PDF documents programmatically and manipulates
  existing PDF files (merge, split, rotate, extract, fill forms, watermark,
  compress, set metadata). Use this skill whenever the user asks to "create a
  PDF", "generate a report/invoice/letter/resume/contract as PDF", "turn this
  data into a PDF", "merge these PDFs", "split pages out of a PDF", "extract
  text or tables from a PDF", "fill in a PDF form", "add page numbers or a
  watermark", "compress or shrink a PDF", "make it printable", "produce a
  one-pager", or "give me a document I can email". Also use it when a QA step
  requires rendering PDF pages to images for visual inspection. It always picks
  the right engine: ReportLab platypus for structured text reports, LaTeX
  (tectonic) for academic and math-heavy papers, HTML/CSS via WeasyPrint or
  Playwright for pixel-perfect posters and designed one-pagers, and
  pypdf/PyMuPDF/pdfplumber for surgery on existing files. Every deliverable is
  produced by a rerunnable generator script and every page is visually
  inspected before handoff. Do NOT use this skill for building .pptx slide
  decks — that is pptx-creator's job. Do NOT use it for narrative planning,
  storyboarding, or presentation thinking — that is slides-creator's job. Do
  NOT use it for spreadsheet or CSV deliverables — that is excel-creator's job.
---

# PDF Creator
> Build and modify PDFs programmatically: pick the correct engine, generate everything from a rerunnable script, and visually inspect every page before delivery.

## 0. Operating Rules (Non-Negotiable)

1. **ALWAYS generate PDFs from a script.** NEVER hand-edit, screenshot, or "print to PDF" as the production path. Why: a script is reproducible, diffable, and fixable; a hand-patched PDF is dead on the first content change.
2. **NEVER paste raw Unicode glyphs for superscripts, subscripts, or math symbols** (`²`, `³`, `₂`, `≈`, `≤`, `≥`, `✓`, `→`, `×`) into Paragraph text. Use ReportLab inline markup instead: `<super>2</super>`, `<sub>2</sub>`, `<b>`, `<i>`, `<font color="#C00000">`. Why: most embedded fonts lack these glyphs and they render as empty boxes ("tofu"), the single most common cause of rejected PDFs.
3. **ALWAYS register and embed a real TTF font for any non-Latin text** (Chinese, Japanese, Korean, Cyrillic, Arabic, Thai). NEVER assume base-14 Helvetica handles it. Why: the built-in base-14 fonts carry only Latin-1; CJK text silently renders as black squares or gibberish.
4. **ALWAYS make the sum of table `colWidths` less than or equal to the frame width** (A4 usable width = 21.0 cm − left margin − right margin). Why: ReportLab does not auto-shrink tables; an oversized table silently overflows the page edge and is discovered only at QA.
5. **ALWAYS compute image `width` AND `height` from the source pixel aspect ratio** (via PIL) before calling `Image(path, width=..., height=...)`. NEVER eyeball both values. Why: a mismatched pair stretches the chart into a funhouse mirror, which is instantly visible on page inspection.
6. **ALWAYS run the render-and-inspect QA loop before delivering**: `pdftoppm -r 60 -jpeg out.pdf qa/page` then look at EVERY page image for overflow, overlap, tofu, blank pages, and broken tables. NEVER deliver a PDF you have not rendered. Why: `doc.build()` exiting cleanly only means the code ran — not that the pages look right.
7. **NEVER leave placeholder residue** ("Lorem", "TODO", "TBD", "XXX", "example.com") in shipped output. Why: extract the text back and grep — recipients do read appendixes.
8. **ALWAYS set document metadata** (`/Title`, `/Author`) on generated and manipulated files. Why: search indexes and email previews surface it; "Untitled" reads as machine garbage.
9. **ALWAYS XML-escape text destined for `Paragraph`** (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, use `html.escape(s)`). Why: Paragraph bodies are mini-XML; a stray `<` crashes the build with an opaque paraparser error.
10. **ALWAYS set `leading` ≈ 1.35 × `fontSize` on every custom `ParagraphStyle`.** Why: ReportLab's default leading does not scale with your chosen size, producing cramped or gappy lines that look amateurish.
11. **Fix the generator script, NEVER the output PDF.** If QA finds a defect, change the code, rebuild, re-render. Why: patches applied to the artifact are destroyed the next time the script runs.
12. **NEVER trust success messages.** Verify page count (expect it explicitly), file size (a 0-byte or 2 KB "report" means the build silently produced nothing), and rendered pixels.

## 1. When to Use / When Not To

**Use this skill when:**
- The user wants a *document* deliverable in PDF form: report, invoice, letter, resume, contract, spec, datasheet, poster, certificate, one-pager.
- Existing PDFs must be *manipulated*: merged, split, rotated, stamped, watermarked, compressed, re-numbered, or have metadata set.
- Content must be *extracted* from PDFs: full text, per-page text, tables, images, form field names and values.
- Forms must be *filled* programmatically.
- A QA step needs pages rendered to images for visual inspection.

**Do NOT use this skill when:**

| The request is actually about... | Route it to |
|---|---|
| Building or editing a `.pptx` slide deck file | **pptx-creator** |
| Deciding what the presentation should say, slide order, storyboarding, delivery coaching | **slides-creator** |
| Building or formatting a `.xlsx`/CSV data workbook | **excel-creator** |
| Editing a `.docx` Word document | the docx-handling skill in this pack |
| OCR quality tuning of a scanner pipeline (only *simple* OCR routing is covered here) | dedicated OCR tooling (`ocrmypdf` docs) |

Rule of thumb: **PDF in, PDF out → this skill. Slides on screen → siblings.**

## 2. Core Concepts & Mental Models

- **PDF is a fixed-layout, paged, vector format.** Nothing reflows. A PDF looks identical on every machine *because* fonts are embedded (or substituted from the base-14 set). Every visual defect is baked in permanently — hence the mandatory QA render.
- **Coordinate system: 72 points per inch, origin at bottom-left.** A4 = 595.27 × 841.89 pt = 21.0 × 29.7 cm. US Letter = 612 × 792 pt = 21.59 × 27.94 cm. ReportLab's `cm` and `inch` units convert for you; use them, never raw floats.
- **Two tool families.** *Generators* create pages from content: ReportLab (Python flowables), LaTeX/tectonic (source typesetting), WeasyPrint/Playwright (HTML/CSS print). *Manipulators* operate on existing files: pypdf (pure-Python page surgery), PyMuPDF/fitz (fast render + text + images), pdfplumber (geometry-aware text/table extraction). Pick one family per task; do not mix generators for one document.
- **Platypus flow model (ReportLab).** You build a *story* — an ordered list of *flowables* (`Paragraph`, `Table`, `Spacer`, `PageBreak`, `Image`, ...) — and a `SimpleDocTemplate` pours them into frames, breaking pages automatically. You control style via `ParagraphStyle`; you control page furniture (headers/footers/page numbers) via `onPage` callbacks that draw directly on the canvas.
- **Fonts must be embedded.** Base-14 fonts (Helvetica, Times-Roman, Courier and their bold/italic variants) are *not embedded* and contain only Latin-1. Any other glyph set requires `pdfmetrics.registerFont(TTFont(...))`. A `.ttc` collection needs a `subfontIndex`.
- **Paragraph text is mini-XML.** Inline tags: `<b>`, `<i>`, `<u>`, `<super>`, `<sub>`, `<font name= size= color=>`, `<br/>`, links via `<a href="...">`. This is the *only* sanctioned way to get sub/superscripts and inline color.
- **Extraction ≠ layout.** `fitz` `page.get_text()` returns fast raw text; `pdfplumber` understands geometry (`extract_tables()`, word boxes). Choose by need.
- **QA mental model:** you are a print shop checking a proof. Render at 60 dpi, look at each page as an image, then at 150 dpi for anything suspicious.

## 3. Mandatory Workflow

1. **Classify the deliverable.** Ask: structured text report? designed one-pager? academic math? surgery on existing files? The answer selects the engine (Section 6, Table 1). NEVER default to ReportLab for a pixel-perfect poster or LaTeX for a quick invoice.
2. **Establish the locale and font plan.** Determine every language and special character the content contains. If CJK/Cyrillic/Arabic appears, locate a concrete font file NOW (see §4.6) and verify it exists with `os.path.exists()`. Why: font discovery mid-build wastes a full rebuild cycle.
3. **Set up the environment explicitly.** `pip install reportlab pypdf pymupdf pdfplumber pillow matplotlib`. Confirm `pdftoppm` (poppler-utils) is available for QA rendering; if not, use `fitz` to rasterize (`page.get_pixmap(dpi=60)`).
4. **Run a character-coverage probe** (§9.1) for every non-ASCII character in the content before writing the full document. Why: a missing glyph found at QA costs a re-render; found at probe time it costs nothing.
5. **Write the generator script** with a design system defined once at the top: margins (≥ 1.8 cm), palette (`colors.HexColor`), style scale (H1 20 pt, H2 14 pt, body 10.5 pt), header/footer callback. NEVER scatter ad-hoc sizes through the code.
6. **Build** with `doc.build(story, onFirstPage=..., onLaterPages=...)` (or `multiBuild` when a `TableOfContents` is present). Always close/flush; always check the output file exists and is > some sane size.
7. **Render for QA:** `mkdir -p qa && pdftoppm -r 60 -jpeg out.pdf qa/page`. Inspect EVERY page image: overflow past margins, overlapping elements, blank pages, tofu boxes, tables split across pages mid-row, stretched images.
8. **Extract text back and grep for residue:** `pdftotext out.pdf - | grep -nEi "lorem|todo|tbd|xxx|placeholder"` (or `fitz` + Python). Must return nothing.
9. **Fix the generator, rebuild, re-render.** Loop steps 7–9 until clean. NEVER patch the PDF.
10. **Deliver** the PDF plus the generator script, and report page count, file size, and "every page visually inspected" explicitly.

## 4. Deep Knowledge Library

### 4.1 Engine Route Selection (the decision tree)

Ask these questions **in order**; the first match wins:

1. **Is the task modifying or extracting from an existing PDF?** → Manipulators: `pypdf` (merge/split/rotate/metadata/forms), `PyMuPDF`/fitz (fast text/image extraction, rasterize, watermark, compress), `pdfplumber` (tables and geometry-aware text). Stop here — do not regenerate anything.
2. **Is it a structured text report** (business/technical: headings, paragraphs, tables, TOC)? → **ReportLab platypus**. The default route for 80% of requests.
3. **Is it academic with heavy math** (equations, theorems, citations, two-column journal layout)? → **LaTeX via tectonic** (`tectonic paper.tex`) if installed; otherwise ReportLab with `<i>`/`<super>` approximations and a note to the user about math fidelity limits.
4. **Is it a pixel-perfect designed page** (poster, flyer, infographic, certificate) where layout freedom beats text reflow? → **HTML/CSS → PDF**: WeasyPrint (`pip install weasyprint; weasyprint page.html page.pdf`) for static pages, or Playwright `page.pdf(format="A4", print_background=True)` when the CSS uses modern features. Absolutely-positioned CSS gives you total control.
5. **Is the source a scan/image-only PDF and the user wants text?** → OCR: `ocrmypdf -l eng+chi_sim in.pdf out.pdf --deskew` or `pytesseract` per rendered page. Mention OCR confidence limits; never present OCR text as verified.

### 4.2 ReportLab Document Anatomy

The canonical skeleton every report script starts from:

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

doc = SimpleDocTemplate(
    "report.pdf", pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm, topMargin=2.2*cm, bottomMargin=2.0*cm,
    title="Q3 Business Review", author="Analytics Team",
)
styles = getSampleStyleSheet()
story = [Paragraph("Q3 Business Review", styles["Title"]), Spacer(1, 12)]
doc.build(story)
```

Facts that matter:
- Usable frame width = `pagesize[0] − leftMargin − rightMargin`. For A4 with 2 cm margins that is **17.0 cm ≈ 481.9 pt**. Every table and image width MUST be checked against this number.
- `topMargin` must leave room for the running header; 2.0–2.5 cm is the working range. Header text is drawn *above* the frame in the `onPage` callback.
- Margins below 1.8 cm look like a flyer; keep documents ≥ 1.8 cm on all sides.
- `title=` and `author=` kwargs set the PDF metadata in the same call — no excuse to skip Rule 8.

### 4.3 ParagraphStyles & Typography Scale

Define a style system once, reuse everywhere:

```python
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT, TA_RIGHT

BODY = ParagraphStyle("Body", fontName="Helvetica", fontSize=10.5, leading=14,
                      alignment=TA_JUSTIFY, spaceAfter=6)
H1 = ParagraphStyle("H1x", parent=BODY, fontName="Helvetica-Bold", fontSize=20,
                    leading=24, spaceBefore=18, spaceAfter=10)
H2 = ParagraphStyle("H2x", parent=BODY, fontName="Helvetica-Bold", fontSize=14,
                    leading=17, spaceBefore=14, spaceAfter=6)
CAPTION = ParagraphStyle("Cap", parent=BODY, fontSize=8.5, leading=11,
                         alignment=TA_CENTER, textColor=colors.HexColor("#595959"))
```

Rules of the scale:
- **Hierarchy:** H1 20 pt, H2 14 pt, body 10.5 pt, caption 8.5–9 pt. NEVER put two consecutive levels closer than 3 pt — hierarchy becomes invisible.
- **Leading** ≈ 1.35 × fontSize (10.5 pt → 14 pt). Tighter than 1.2 feels claustrophobic; looser than 1.5 falls apart.
- `spaceBefore`/`spaceAfter` create rhythm; pick values in even steps (4/6/8/10) and never mix arbitrary ones.
- Body alignment: `TA_JUSTIFY` for formal reports, `TA_LEFT` for anything with narrow columns (justified narrow columns create rivers of whitespace).
- `parent=` inheritance is your friend: derive variants (`Bullet` style with `leftIndent=14, bulletIndent=4`) from `BODY` so one change ripples everywhere.
- Whitespace is a layout element: after every major section put `Spacer(1, 6)`–`Spacer(1, 12)`. One idea per page section; if a section needs three pages, break it under H2s.

### 4.4 Flowables Catalog

| Flowable | Purpose | Key parameters / gotchas |
|---|---|---|
| `Paragraph(text, style)` | Wrapped text | Text is mini-XML — escape `&<>`; `<b>`, `<i>`, `<super>`, `<sub>`, `<font color=>`, `<a href>` work |
| `Spacer(w, h)` | Vertical gap | Use instead of empty paragraphs; `Spacer(1, 12)` = 12 pt gap |
| `PageBreak()` | Force new page | Use before every top-level section in formal reports |
| `KeepTogether([...])` | Prevent split | Wrap heading + first paragraph, or a small table + its caption. Why: an H2 stranded at page bottom looks broken |
| `Table(data, colWidths=...)` | Tabular data | See §4.5; always pass explicit `colWidths` |
| `Image(path, width, height)` | Picture | Compute BOTH from PIL aspect ratio (Rule 5) |
| `ListFlowable([ListItem(Paragraph(...)) ...])` | Bullets/numbers | `bulletType="bullet"` or `"1"`; set `leftIndent` on the item style |
| `HRFlowable(width="100%", thickness=0.7, color=...)` | Rule line | Cheap section separator; prefer over decorative images |
| `TableOfContents()` | Auto TOC | Requires `multiBuild` + `afterFlowable` hook (§9.2) |
| `NextPageTemplate("Cover")` + `PageTemplate` | Per-page furniture | Needed when the cover must have NO header/footer |

Composition rules: wrap `H2 + first paragraph` pairs in `KeepTogether`; put a `PageBreak` after the TOC and between major sections; NEVER let a `Table` start in the last 4 cm of a page — precede it with `KeepTogether([mini_intro, table])` or push it with a conditional `PageBreak`.

### 4.5 Tables Mastery

```python
from reportlab.platypus import Table, TableStyle
from reportlab.lib import colors

data = [["Region", "Revenue", "Growth"],
        ["EMEA",  "€4.2M", "+23%"],
        ["APAC",  "€2.9M", "+11%"],
        ["Americas", "€7.1M", "+6%"]]
t = Table(data, colWidths=[5*cm, 4*cm, 3*cm], repeatRows=1)
t.setStyle(TableStyle([
    ("FONTNAME",  (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE",  (0, 0), (-1, -1), 9.5),
    ("BACKGROUND",(0, 0), (-1, 0), colors.HexColor("#1F2A44")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F4F7")]),
    ("ALIGN",     (1, 0), (-1, -1), "RIGHT"),
    ("VALIGN",    (0, 0), (-1, -1), "MIDDLE"),
    ("GRID",      (0, 0), (-1, -1), 0.4, colors.HexColor("#D0D5DD")),
    ("LINEBELOW", (0, 0), (-1, 0), 1.0, colors.HexColor("#1F2A44")),
    ("TOPPADDING",(0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
```

- **Coordinates are `(col, row)` with `(0,0)` top-left; `-1` means last.** Every TableStyle command takes a cell range `("CMD", (c0, r0), (c1, r1), args...)`.
- `repeatRows=1` repeats the header row when the table splits across pages — ALWAYS set it for tables longer than ~8 rows.
- **SPAN** merges: `("SPAN", (0, 0), (1, 0))`. Underlying hidden cells still exist in `data` (put `""` in them).
- **Numbers right-aligned, text left-aligned** — non-negotiable for financial tables.
- Zebra stripes via `ROWBACKGROUNDS` improve scan-ability for > 4 rows; skip them for tiny 2-row tables.
- **Width budget:** `sum(colWidths) ≤ frame width` (17.0 cm for A4/2 cm margins). For dynamic content compute widths from `doc.width`, e.g. `colWidths=[doc.width*0.4, doc.width*0.3, doc.width*0.3]` — this can never overflow.
- Long unbreakable strings (URLs, order IDs) overflow cells. Fix: insert zero-width-friendly breaks or shrink the font for that column; NEVER let one column exceed its `colWidths` share.

### 4.6 Fonts, Embedding, and CJK

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

def register_fonts():
    candidates = {
        "NotoSansSC": [  # Simplified Chinese
            "C:/Windows/Fonts/msyh.ttc",                      # Windows: Microsoft YaHei
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",  # Debian/Ubuntu
            "/System/Library/Fonts/PingFang.ttc",             # macOS
        ],
        "DejaVuSans": [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/DejaVuSans.ttf",
        ],
    }
    for name, paths in candidates.items():
        for p in paths:
            if os.path.exists(p):
                pdfmetrics.registerFont(TTFont(name, p, subfontIndex=0))
                return name
    raise RuntimeError("No usable TTF font found; install fonts-noto-cjk")
```

- `.ttc` collections are supported via `subfontIndex=` (e.g. index 0 of `msyh.ttc`). If a glyph family is missing, try `subfontIndex=1`, `2`.
- After registering a non-base font, **use it explicitly in every style** (`fontName="NotoSansSC"`). Also register its bold face as a separate name and use `registerFontFamily` so `<b>` works:
  `pdfmetrics.registerFontFamily("NotoSansSC", normal="NotoSansSC", bold="NotoSansSC-Bold", italic="NotoSansSC", boldItalic="NotoSansSC-Bold")`.
- **Fallback strategy:** Latin-first documents can stay on Helvetica; any document containing one CJK character must switch the WHOLE document (or at minimum the affected styles) to the CJK font. NEVER mix fonts across one paragraph.
- For HTML routes (WeasyPrint/Playwright), embed via CSS `@font-face { font-family: "Noto Sans SC"; src: url("file:///usr/share/fonts/.../NotoSansCJK-Regular.ttc"); }` — Playwright additionally renders whatever fontconfig exposes.

### 4.7 Character Safety (the tofu killer)

Every glyph must exist in the registered font. The table below is binding:

| FORBIDDEN raw glyph | Renders as | Use instead |
|---|---|---|
| `²` `³` `⁴` | tofu box in most fonts | `m<super>2</super>`, `cm<super>3</super>` |
| `₂` `₃` and all subscripts | tofu | `CO<sub>2</sub>`, `H<sub>2</sub>O` |
| `≈` `≤` `≥` `≠` | tofu in Helvetica | words "approx.", "&lt;=", "&gt;=", "!=" — or a font verified to contain them |
| `→` `←` `⇒` | tofu | `-&gt;`, `=&gt;`, or the word "to" |
| `✓` `✗` `✔` | tofu | `<b>OK</b>` / `<b>N/A</b>` or a drawn checkbox |
| `×` `÷` | often tofu | `x` (dimensional), `÷` → `/` |
| `—` em dash `–` en dash `“ ” ‘ ’` | usually fine in TTF fonts, tofu in Helvetica | test first; safe fallback `-` and straight quotes |
| `€ £ ¥` | tofu in Helvetica | the CJK/DejaVu font, or `EUR/GBP/JPY` codes |
| Emoji of any kind | tofu guaranteed | NEVER put emoji in PDFs |

**Probe render (do this before any real build):**

```python
# probe.py — render every special character once; inspect probe.pdf visually
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

pdfmetrics.registerFont(TTFont("NotoSansSC",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", subfontIndex=0))
s = ParagraphStyle("p", fontName="NotoSansSC", fontSize=14, leading=20)
chars = "€£¥——–“”‘’…°éüñ北京日本語"
story = [Paragraph(f"Glyph probe: {chars}", s),
         Paragraph("Markup: m<super>2</super>, CO<sub>2</sub>, <b>bold</b>, <i>italic</i>", s)]
SimpleDocTemplate("probe.pdf", pagesize=A4).build(story)
```

Look at `probe.pdf`: any hollow rectangle = that glyph must not appear in the final document.

### 4.8 Page Furniture: Headers, Footers, Page Numbers

```python
from reportlab.pdfgen import canvas as rl_canvas

def draw_furniture(canv: rl_canvas.Canvas, doc):
    canv.saveState()  # ALWAYS: isolate graphics state so styles never leak
    w, h = A4
    canv.setFont("Helvetica", 8.5)
    canv.setFillColor(colors.HexColor("#595959"))
    canv.drawString(2*cm, h - 1.35*cm, "Q3 Business Review — Confidential")
    canv.drawRightString(w - 2*cm, 1.2*cm, f"Page {doc.page}")
    canv.setStrokeColor(colors.HexColor("#D0D5DD"))
    canv.setLineWidth(0.5)
    canv.line(2*cm, h - 1.55*cm, w - 2*cm, h - 1.55*cm)
    canv.restoreState()  # ALWAYS pair with saveState

doc.build(story, onFirstPage=draw_furniture, onLaterPages=draw_furniture)
```

- `doc.page` gives the current page number — sufficient for "Page 7".
- **"Page X of Y" requires a second pass** because Y is unknown during layout; use the `NumberedCanvas` pattern (§9.1).
- The cover page usually must be header-free: define two `PageTemplate`s (via `BaseDocTemplate`) or simply accept the header on page 1 for one-pagers.
- Rule: `saveState()`/`restoreState()` around EVERYTHING in callbacks. Why: without it, a font or color set for the footer corrupts the first flowable drawn on that page.

### 4.9 Charts in PDFs

NEVER let ReportLab draw charts from primitives; render with matplotlib, then embed:

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.platypus import Image
from PIL import Image as PILImage

def chart_flowable(path, target_width_cm):
    fig, ax = plt.subplots(figsize=(7.0, 3.2), dpi=200)  # 200 dpi minimum for print
    ax.bar(["EMEA", "APAC", "Americas"], [4.2, 2.9, 7.1], color="#1F2A44")
    ax.set_ylabel("Revenue (EUR M)"); ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)
    pw, ph = PILImage.open(path).size
    w = target_width_cm * 2.83465           # cm -> points
    return Image(path, width=w, height=w * ph / pw)  # aspect preserved (Rule 5)
```

- **dpi ≥ 200** or text in the chart looks fuzzy in print. `figsize=(w_in, h_in), dpi=200` ⇒ pixel size = inches × 200; the embedded point width determines final size, the dpi only buys sharpness.
- Match chart font family/size to the document (`plt.rcParams.update({"font.size": 10, "font.family": "sans-serif"})`) so captions and axis labels don't clash.
- Style every chart: `spines[["top","right"]].set_visible(False)`, light gridlines `ax.grid(axis="y", alpha=0.3)`, direct value labels where possible.
- Caption with the `CAPTION` style: "Figure 2 — Revenue by region, Q3 2025." Put `KeepTogether([chart, caption])` so a caption never strands.

### 4.10 Manipulation Toolbox (pypdf / PyMuPDF / pdfplumber)

Install: `pip install pypdf pymupdf pdfplumber`. Division of labor:

| Task | Tool | One-liner |
|---|---|---|
| Merge N files | pypdf | `writer.append(reader)` per file |
| Split pages | pypdf | `writer.add_page(reader.pages[i])` |
| Rotate | pypdf | `page.rotate(90)` |
| Text (fast, per page) | PyMuPDF | `fitz.open(p)[i].get_text()` |
| Tables / word boxes | pdfplumber | `page.extract_tables()` |
| Images out | PyMuPDF | `page.get_images(full=True)` + `fitz.Pixmap(doc, xref)` |
| Form field names | pypdf / fitz | `reader.get_fields()` / `[w.field_name for w in page.widgets()]` |
| Watermark stamp | pypdf | `page.merge_page(stamp_page)` |
| Compress | PyMuPDF | `doc.save(out, garbage=4, deflate=True)` |
| Metadata | pypdf | `writer.add_metadata({"/Title": ..., "/Author": ...})` |
| Page count / size | pypdf | `len(reader.pages)`, `page.mediabox` |

Full recipes are in §5.4–§5.5. Remember: manipulation is *lossless-ish* but never free — after ANY manipulation, re-run the QA render (a broken xref shows up as blank pages).

## 5. Code & Tool Templates

### 5.1 Business Report (cover → TOC → sections → appendix)

```python
# business_report.py — complete and runnable
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, KeepTogether)
from reportlab.platypus.tableofcontents import TableOfContents

NAVY = colors.HexColor("#1F2A44"); GREY = colors.HexColor("#595959")
ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1x", parent=ss["Heading1"], fontName="Helvetica-Bold",
                    fontSize=20, leading=24, spaceBefore=18, spaceAfter=10,
                    textColor=NAVY)
H2 = ParagraphStyle("H2x", parent=ss["Heading2"], fontName="Helvetica-Bold",
                    fontSize=14, leading=17, spaceBefore=14, spaceAfter=6,
                    textColor=NAVY)
BODY = ParagraphStyle("BodyX", parent=ss["Normal"], fontSize=10.5, leading=14,
                      alignment=TA_JUSTIFY, spaceAfter=6)

def furniture(canv, doc):
    canv.saveState()
    w, h = A4
    canv.setFont("Helvetica", 8.5); canv.setFillColor(GREY)
    canv.drawString(2*cm, h-1.35*cm, "Q3 2025 Business Review - Confidential")
    canv.drawRightString(w-2*cm, 1.2*cm, f"Page {doc.page}")
    canv.restoreState()

story = []
# --- Cover (no TOC entries here) ---
story += [Spacer(1, 6*cm),
          Paragraph("Q3 2025 Business Review", ParagraphStyle(
              "Cover", parent=H1, fontSize=26, leading=32, alignment=TA_CENTER)),
          Paragraph("Prepared by the Analytics Team - October 2025",
                    ParagraphStyle("CoverSub", parent=BODY, alignment=TA_CENTER,
                                   textColor=GREY)),
          PageBreak()]
# --- Table of contents ---
toc = TableOfContents()
toc.levelStyles = [ParagraphStyle("TOC1", fontName="Helvetica-Bold", fontSize=11,
                                  leading=16, leftIndent=6)]
story += [Paragraph("Contents", H1), toc, PageBreak()]
# --- Executive summary ---
story += [Paragraph("Executive Summary", H1),
          Paragraph("Revenue reached EUR 14.2M in Q3, up 13% year over year, "
                    "driven by EMEA (+23%) and the launch of the Pro tier in "
                    "August. Gross margin held at 61% despite higher cloud "
                    "costs. We recommend increasing EMEA sales headcount by "
                    "four in Q4 to protect the pipeline into 2026.", BODY),
          PageBreak()]
# --- Numbered section with a table ---
story += [Paragraph("1. Revenue Performance", H1),
          Paragraph("All regions grew, but growth is concentrating in EMEA; "
                    "the Americas decelerated for the second straight quarter.",
                    BODY)]
rows = [["Region", "Revenue", "YoY"], ["EMEA", "EUR 4.2M", "+23%"],
        ["APAC", "EUR 2.9M", "+11%"], ["Americas", "EUR 7.1M", "+6%"]]
t = Table(rows, colWidths=[6*cm, 6*cm, 5*cm], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY), ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,-1), 9.5),
    ("ALIGN", (1,1), (-1,-1), "RIGHT"), ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#D0D5DD")),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#F2F4F7")]),
    ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5)]))
story += [KeepTogether([Paragraph("Table 1. Revenue by region (EUR M).", BODY), t]),
          PageBreak(),
          Paragraph("Appendix A. Methodology", H1),
          Paragraph("Figures are unaudited management accounts, FX-adjusted "
                    "at the quarterly average rate of 1.08 USD/EUR.", BODY)]

class ReportDoc(SimpleDocTemplate):
    """Registers H1s into the TOC during multiBuild."""
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "H1x":
            self.notify("TOCEntry", (0, flowable.getPlainText(), self.page))

ReportDoc("business_report.pdf", pagesize=A4,
          leftMargin=2*cm, rightMargin=2*cm, topMargin=2.2*cm, bottomMargin=2.0*cm,
          title="Q3 2025 Business Review", author="Analytics Team"
          ).multiBuild(story, onFirstPage=furniture, onLaterPages=furniture)
print("OK")
```

Structure invariant: cover (page 1) → TOC (page 2) → executive summary (page 3) → numbered sections → appendix. `multiBuild` runs layout repeatedly until TOC page numbers stabilize.

### 5.2 Invoice

```python
# invoice.py — complete and runnable
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

RIGHT = ParagraphStyle("R", fontName="Helvetica", fontSize=9.5, leading=13,
                       alignment=TA_RIGHT)
CELL = ParagraphStyle("C", fontName="Helvetica", fontSize=9.5, leading=13)
NAVY = colors.HexColor("#1F2A44")

doc = SimpleDocTemplate("invoice.pdf", pagesize=A4, topMargin=1.8*cm,
                        bottomMargin=1.8*cm, leftMargin=1.8*cm, rightMargin=1.8*cm,
                        title="Invoice INV-2025-0142", author="Acme GmbH")
story = [
    Paragraph("INVOICE INV-2025-0142", ParagraphStyle(
        "T", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=NAVY)),
    Spacer(1, 10),
    Paragraph("Acme GmbH - Musterstrasse 12, 10115 Berlin, Germany - VAT DE123456789", CELL),
    Spacer(1, 14),
    Paragraph("<b>Bill to:</b><br/>Globex Corporation<br/>Attn: Accounts Payable<br/>"
              "1 Example Avenue, 10001 New York, USA", CELL),
    Spacer(1, 16),
]
items = [("Consulting - architecture review (24 h @ EUR 180)", 24, 180.00),
         ("Migration tooling license (12 mo)", 1, 2400.00),
         ("On-site workshop, 2 days (2 @ EUR 950)", 2, 950.00)]
data = [["Description", "Qty", "Unit", "Amount"]]
for d, q, u in items:
    data.append([d, str(q), f"{u:,.2f}", f"{q*u:,.2f}"])
subtotal = sum(q*u for _, q, u in items)
vat = round(subtotal * 0.19, 2)
data += [["", "", "Subtotal", f"{subtotal:,.2f}"],
         ["", "", "VAT 19%", f"{vat:,.2f}"],
         ["", "", "TOTAL DUE", f"{subtotal+vat:,.2f}"]]
w = doc.width
t = Table(data, colWidths=[w*0.58, w*0.10, w*0.16, w*0.16], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY), ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTNAME", (2,1), (-1,-1), "Helvetica"),
    ("ALIGN", (1,0), (-1,-1), "RIGHT"), ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("LINEBELOW", (0,0), (-1,0), 1.0, NAVY),
    ("LINEABOVE", (0,-3), (-1,-3), 0.7, NAVY),
    ("FONTNAME", (0,-1), (-1,-1), "Helvetica-Bold"),
    ("BACKGROUND", (0,-1), (-1,-1), colors.HexColor("#F2F4F7")),
    ("GRID", (0,0), (-1,0), 0.4, NAVY),
    ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5)]))
story += [t, Spacer(1, 18),
          Paragraph("<b>Payment terms:</b> net 30 days from invoice date. "
                    "IBAN DE89 3704 0044 0532 0130 00 - Reference INV-2025-0142. "
                    "Late payments accrue 9 percentage points above the base rate.", CELL)]
doc.build(story)
print("OK")
```

Invoice invariants: totals column right-aligned, VAT computed with `round(..., 2)`, bold TOTAL row, terms block always present, invoice number in the metadata title.

### 5.3 One-Page Letter

```python
# letter.py — complete and runnable
from datetime import date
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

BODY = ParagraphStyle("LB", fontName="Helvetica", fontSize=11, leading=15.5,
                      alignment=TA_LEFT, spaceAfter=10)
doc = SimpleDocTemplate("letter.pdf", pagesize=A4, topMargin=2.5*cm,
                        bottomMargin=2.5*cm, leftMargin=2.5*cm, rightMargin=2.5*cm,
                        title="Proposal letter", author="J. Rivera")
story = [
    Paragraph("Jane Rivera<br/>Acme GmbH<br/>Musterstrasse 12, 10115 Berlin",
              BODY), Spacer(1, 6),
    Paragraph(date.today().strftime("%d %B %Y"), BODY), Spacer(1, 6),
    Paragraph("Dear Ms. Chen,", BODY),
    Paragraph("Thank you for the opportunity to propose a data platform "
              "assessment for Globex Corporation. Based on our discovery call "
              "on 3 October, we propose a two-week engagement covering: "
              "(1) current-state architecture review, (2) pipeline cost "
              "analysis, and (3) a prioritized 12-month modernization roadmap.", BODY),
    Paragraph("The fixed fee for this engagement is EUR 18,000 excluding VAT. "
              "We can begin on 4 November 2025 and deliver the final roadmap "
              "within ten business days of kickoff.", BODY),
    Paragraph("Sincerely,<br/><br/>Jane Rivera<br/>Principal Consultant, Acme GmbH", BODY),
]
doc.build(story)
```

Letter rules: single page guaranteed by the margins (2.5 cm) and 11 pt body; NEVER let a letter spill to page 2 — trim content, not margins.

### 5.4 Manipulation: merge, split, rotate, metadata

```python
# pdf_tools.py — complete and runnable
import io
from pypdf import PdfReader, PdfWriter
import fitz  # PyMuPDF

def merge(paths, out):
    writer = PdfWriter()
    for p in paths:
        writer.append(PdfReader(p))          # preserves bookmarks where possible
    writer.add_metadata({"/Title": "Merged bundle", "/Author": "Acme GmbH"})
    with open(out, "wb") as f:
        writer.write(f)

def split(path, out_prefix, pages=None):
    reader = PdfReader(path)
    pages = pages if pages is not None else range(len(reader.pages))
    for i in pages:
        writer = PdfWriter()
        writer.add_page(reader.pages[i])
        with open(f"{out_prefix}-{i+1:03d}.pdf", "wb") as f:
            writer.write(f)

def rotate_even_pages(path, out, degrees=90):
    reader = PdfReader(path); writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if i % 2 == 1:
            page.rotate(degrees)
        writer.add_page(page)
    with open(out, "wb") as f:
        writer.write(f)

def extract_text_and_images(path, out_dir):
    doc = fitz.open(path)
    for pno, page in enumerate(doc):
        open(f"{out_dir}/page-{pno+1:03d}.txt", "w", encoding="utf-8").write(page.get_text())
        for xref, *_ in [(im[0],) for im in page.get_images(full=True)]:
            pix = fitz.Pixmap(doc, xref)
            if pix.n > 4:                      # CMYK or alpha -> convert
                pix = fitz.Pixmap(fitz.csRGB, pix)
            pix.save(f"{out_dir}/p{pno+1:03d}-img{xref}.png")
    return len(doc)

if __name__ == "__main__":
    merge(["a.pdf", "b.pdf"], "merged.pdf")
    split("merged.pdf", "part")
    rotate_even_pages("merged.pdf", "rotated.pdf")
    print("pages in merged.pdf:", extract_text_and_images("merged.pdf", "qa_out"))
```

### 5.5 Forms, watermark stamp, compression

```python
# pdf_forms.py — complete and runnable
from pypdf import PdfReader, PdfWriter
import fitz

def list_form_fields(path):
    """ALWAYS the first step: discover real field names before filling."""
    return {k: v.get("/V", "") for k, v in (PdfReader(path).get_fields() or {}).items()}

def fill_form(path, values, out):
    reader = PdfReader(path); writer = PdfWriter()
    writer.append(reader)
    writer.update_page_form_field_values(writer.pages[0], values)  # e.g. {"full_name": "Jane Rivera"}
    with open(out, "wb") as f:
        writer.write(f)

def watermark(src, stamp_pdf, out):
    stamp = PdfReader(stamp_pdf).pages[0]
    reader = PdfReader(src); writer = PdfWriter()
    for page in reader.pages:
        page.merge_page(stamp)                 # draws stamp ON TOP of page content
        writer.add_page(page)
    with open(out, "wb") as f:
        writer.write(f)

def compress(src, out):
    doc = fitz.open(src)
    doc.save(out, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
    # Typical shrink: 30-60% on image-heavy files. Verify readability after.

if __name__ == "__main__":
    print(list_form_fields("contract.pdf"))
    # fill_form("contract.pdf", {"full_name": "Jane Rivera", "date": "2025-10-14"}, "filled.pdf")
```

Field names are arbitrary — NEVER guess them; always run `list_form_fields` first and print the dict.

### 5.6 QA Script (render + residue grep)

```python
# qa_render.py — complete and runnable; run after EVERY build
import subprocess, sys, os, fitz, re

def qa(pdf_path, out_dir="qa"):
    os.makedirs(out_dir, exist_ok=True)
    try:                                     # poppler path
        subprocess.run(["pdftoppm", "-r", "60", "-jpeg", pdf_path,
                        os.path.join(out_dir, "page")], check=True)
    except FileNotFoundError:                # fallback: PyMuPDF rasterizer
        doc = fitz.open(pdf_path)
        for i, page in enumerate(doc):
            page.get_pixmap(dpi=60).save(f"{out_dir}/page-{i+1:03d}.jpg")
    doc = fitz.open(pdf_path)
    text = "\n".join(p.get_text() for p in doc)
    bad = re.findall(r"(?i)lorem|todo|tbd|xxx|placeholder|undefined|nan", text)
    print(f"pages={len(doc)}  bytes={os.path.getsize(pdf_path)}  residue={bad}")
    if bad:
        sys.exit(1)                          # residue found -> fix generator
    print(f"INSPECT {out_dir}/page-*.jpg visually for overflow/tofu/overlap NOW")

qa(sys.argv[1] if len(sys.argv) > 1 else "out.pdf")
```

## 6. Decision Tables

**Table 1 — Engine choice.**

| Situation | Engine | Why |
|---|---|---|
| Multi-page report, invoice, letter | ReportLab platypus | Flowable reflow, TOC, tables; Python-native |
| Academic paper, heavy math | LaTeX (tectonic) if installed | Real equation typesetting impossible elsewhere |
| Poster / certificate / designed one-pager | WeasyPrint or Playwright HTML→PDF | Absolute positioning, CSS gradients/shadows |
| Merge/split/rotate/forms/watermark | pypdf | Page-level surgery, pure Python |
| Text/image extraction, compression | PyMuPDF (fitz) | Fastest, robust rasterizer |
| Table extraction from existing PDF | pdfplumber | Geometry-aware `extract_tables()` |
| Scanned document, need text | ocrmypdf / pytesseract | OCR layer; flag accuracy limits to user |

**Table 2 — Font choice.**

| Content | Font | File to register |
|---|---|---|
| Latin-only business doc | Helvetica (base-14) | none needed |
| Latin with `€` or em-dashes | DejaVuSans | `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` |
| Simplified Chinese | Noto Sans CJK SC / YaHei | `NotoSansCJK-Regular.ttc` / `msyh.ttc` |
| Japanese | Noto Sans CJK JP | `NotoSansCJK-Regular.ttc` (subfontIndex for JP) |
| Cyrillic | DejaVuSans | as above |

**Table 3 — Table layout pattern.**

| Table shape | Pattern |
|---|---|
| ≤ 4 rows | No zebra, `LINEBELOW` header only |
| 5–20 rows | Zebra `ROWBACKGROUNDS`, `repeatRows=1` |
| Financial | Numbers right-aligned, total row bold + shaded |
| Matrix with merged headers | `SPAN` + extra `LINEBELOW` under header groups |
| Wide table that can't fit | Reduce font to 8.5 pt + tighten padding BEFORE landscape; landscape only as last resort |

**Table 4 — Compression settings (fitz `save`).**

| Goal | Call | Expected |
|---|---|---|
| General shrink, keep quality | `garbage=4, deflate=True` | 20–40% smaller |
| Image-heavy, email-friendly | add `deflate_images=True` | 30–60% smaller |
| Aggressive | `garbage=4, deflate=True` + rasterize pages at 120 dpi first | 60–80% smaller, text becomes image — LAST RESORT |

## 7. Quality Checklist

Verify EVERY item before declaring the task complete:

- [ ] The PDF was produced by a stored, rerunnable generator script (not hand-edited).
- [ ] Correct engine chosen per Table 1 (no ReportLab posters, no LaTeX invoices).
- [ ] Every non-ASCII character passed the glyph probe or is satisfied by markup (`<super>`/`<sub>`).
- [ ] No raw forbidden glyphs (`² ₂ ≈ ✓ →` etc.) remain in the source text.
- [ ] Font files verified with `os.path.exists()` before registration; CJK registered for any CJK content.
- [ ] Sum of table `colWidths` ≤ frame width (computed, not eyeballed).
- [ ] Every `Image` got width AND height computed from the real pixel aspect ratio.
- [ ] Every custom style has `leading` ≥ 1.2 × fontSize (ideally ≈1.35).
- [ ] `Paragraph` text containing `&`, `<`, `>` is escaped.
- [ ] Metadata set: `/Title` and `/Author` (via `SimpleDocTemplate` kwargs or `add_metadata`).
- [ ] Page count matches expectation exactly (reported, not assumed).
- [ ] Every page rendered at ≥ 60 dpi and visually inspected.
- [ ] No tofu boxes, black squares, or question-mark glyphs on any page.
- [ ] No content crosses the margins; tables and images sit inside the frame.
- [ ] No orphaned headings at page bottoms (`KeepTogether` applied where needed).
- [ ] No unintentionally blank pages; intentional section breaks read naturally.
- [ ] Multi-page tables repeat their header row (`repeatRows=1`).
- [ ] Extracted text contains zero residue (`lorem|todo|tbd|xxx|placeholder|nan`).
- [ ] Numbers in tables right-aligned; totals bold; currency format consistent.
- [ ] For manipulated PDFs: post-operation render re-inspected and metadata reset.

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | CJK text with only base fonts registered | Black squares / tofu | Register Noto/YaHei TTF (§4.6); apply `fontName` to EVERY style used for that text |
| 2 | Raw `²`, `≈`, `✓` in paragraph text | Hollow boxes or missing glyphs | Replace with `<super>2</super>`, words, or verified-font glyphs (§4.7) |
| 3 | Table `colWidths` sum > frame width | Table bleeds past right margin | Compute widths from `doc.width` fractions |
| 4 | Image with mismatched width/height | Stretched/squashed chart | Compute height = width × (pixel_h/pixel_w) via PIL |
| 5 | Forgot `doc.build(story)` or wrote story only | Output file missing or 0 bytes | Add build call; assert output size > threshold |
| 6 | "Page X of Y" shows wrong total | Footer says "Page 3 of 1" | Use the two-pass `NumberedCanvas` (§9.1) |
| 7 | `Paragraph` text contains raw `<` or `&` | Paraparser crash, cryptic error | `html.escape()` dynamic strings before wrapping |
| 8 | Table style applied but invisible | No borders/colors | Style list tuples malformed (range order wrong) — ranges are `((col,row),(col,row))`, `-1` = last |
| 9 | Heading stranded alone at page bottom | "1.2 Overview" with body on next page | Wrap heading+lead-in in `KeepTogether` |
| 10 | TOC empty or page numbers stale | TOC missing entries | Use `multiBuild` + `afterFlowable` notify; plain `build` never fills a TOC |
| 11 | `colors.HexColor` vs string | `AttributeError: 'str' object has no attribute 'rgb'` | Wrap CSS strings: `colors.HexColor("#1F2A44")` |
| 12 | Footer callback leaks font state | Body text suddenly small/grey | `saveState()`/`restoreState()` inside every callback |
| 13 | After merge/split, pages blank | Broken output | Reader objects garbage-collected before write — keep readers alive; re-run QA render |
| 14 | Form fill silently ignored | Values not visible | Wrong field names (guessed) — run `reader.get_fields()` first; also set `need_appearances` when required |
| 15 | Charts fuzzy in print | Blurry axis text | Render matplotlib at dpi ≥ 200; size figure near final print size |

## 9. Advanced Techniques

### 9.1 "Page X of Y" — NumberedCanvas two-pass pattern

```python
from reportlab.pdfgen import canvas as rl_canvas

class NumberedCanvas(rl_canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []
    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()
    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 8.5)
            self.drawRightString(A4[0] - 2*cm, 1.2*cm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()

doc.build(story, onFirstPage=furniture, onLaterPages=furniture, canvasmaker=NumberedCanvas)
```

Why it works: `showPage` defers finishing pages until `save`, when the total is known.

### 9.2 Clickable TOC with bookmarks

Pair `afterFlowable` with `canv.bookmarkPage(key)` + `addOutlineEntry` inside a custom doc template, and `toc.levelStyles` per level. Combine with `Paragraph("<a href='#sec1'>...</a>")`-style anchors by registering `bookmarkPage` keys identical to the link targets. Always `multiBuild` — two or three passes until "no more TOC changes".

### 9.3 Watermark without a stamp file

```python
import fitz
doc = fitz.open("in.pdf")
for page in doc:
    page.insert_text((50, 400), "DRAFT", fontsize=72, fontname="hebo",
                     rotate=45, fill_opacity=0.12, color=(0.9, 0.2, 0.2))
doc.save("draft.pdf", garbage=3, deflate=True)
```

Use `fill_opacity` ≤ 0.15 so body text stays readable; diagonal 45° reads as intentional.

### 9.4 OCR routing for scans

`pip install ocrmypdf` then `ocrmypdf --language eng --deskew --output-type pdfa scan.pdf searchable.pdf`. For single images: `pytesseract.image_to_string(img, lang="eng+chi_sim")` on a 300 dpi render (`fitz` `page.get_pixmap(dpi=300)`). ALWAYS tell the user OCR output is best-effort and show character confidence for numbers/dates.

### 9.5 Table extraction with pdfplumber

```python
import pdfplumber
with pdfplumber.open("report.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        for t in page.extract_tables():
            print(f"page {i+1}:", t[:2], "...")   # preview first rows
```

Set `table_settings={"vertical_strategy": "lines", "horizontal_strategy": "lines"}` when the PDF has ruling lines; switch to `"text"` strategies only when lines are absent. Clean cell values (`strip()`, collapse whitespace) before use — extraction frequently leaves `\n` inside cells.

### 9.6 Batch generation from data

Structure generators as `render_row(record) -> list[flowables]` and loop over JSON/CSV rows. NEVER inline data in layout code: one row per record keeps the template testable with 1 record and the full run deterministic. Assert `len(records) > 0` before building — an empty dataset produces a cover-only PDF that looks "successful".

## 10. Quick Reference Card

```
pip install reportlab pypdf pymupdf pdfplumber pillow matplotlib
A4 = 21.0 x 29.7 cm = 595.27 x 841.89 pt; Letter = 21.59 x 27.94 cm; 1 cm = 28.3465 pt
Frame width (A4, 2cm margins) = 17.0 cm  -> sum(colWidths) <= doc.width
Style scale: H1 20/24 | H2 14/17 | body 10.5/14 | caption 8.5/11
Markup: <b> <i> <u> <super> <sub> <font color="#C00000"> <br/> <a href="...">
FORBIDDEN glyphs: 2 superscripts, subscripts, arrows, checkmarks, math signs, emoji
Fonts: pdfmetrics.registerFont(TTFont("NotoSansSC", <ttc path>, subfontIndex=0))
Header/footer: doc.build(story, onFirstPage=f, onLaterPages=f); f uses saveState/restoreState
Page X of Y -> canvasmaker=NumberedCanvas;  TOC -> multiBuild + afterFlowable notify
Tables: repeatRows=1, ROWBACKGROUNDS zebra, ALIGN numbers RIGHT, SPAN merges
QA: pdftoppm -r 60 -jpeg out.pdf qa/page  (fallback: page.get_pixmap(dpi=60))
     + extract text, grep residue; fix GENERATOR, rebuild, re-render
Manipulate: pypdf merge/split/rotate/forms/metadata | fitz text/images/compress
Compress: doc.save(out, garbage=4, deflate=True, deflate_images=True)
Watermark: pypdf page.merge_page(stamp)  or  fitz page.insert_text(..., fill_opacity=0.12)
```
