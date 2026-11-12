---
name: excel-creator
description: >
  Builds polished, formula-driven, styled .xlsx workbooks with openpyxl:
  multi-sheet reports (cover sheet, raw data, summary with live formulas,
  charts), KPI dashboards with conditional formatting, CSV-to-styled-Excel
  converters, and bulk exports that stay fast past 100k rows via write_only
  mode. Masters the openpyxl object model (Workbook, create_sheet, cell
  access, append, merged ranges, freeze panes, column widths, print setup,
  gridline control), the styling system (Font, PatternFill, Border, Side,
  Alignment, NamedStyle, number formats such as '#,##0.00', '0.0%',
  'yyyy-mm-dd', currency), real Excel formulas written as strings (SUM,
  SUMIFS, COUNTIFS, VLOOKUP, INDEX+MATCH, XLOOKUP, IFERROR, cross-sheet
  references, absolute vs relative refs), Excel Tables with TableStyleInfo,
  autofilters, named ranges, data-validation dropdowns, hidden config sheets,
  ColorScaleRule / CellIsRule / FormulaRule / DataBarRule / IconSetRule
  conditional formatting, and embedded BarChart / LineChart / PieChart /
  ScatterChart objects with Reference and series styling. Knows the critical
  gotchas: openpyxl never calculates formulas (write computed values or
  recalculate via LibreOffice 'soffice --convert-to xlsx'), style objects
  must not be mutated after being shared across cells, sheet names are
  capped at 31 characters, and data_only=True returns None unless Excel or
  LibreOffice has opened and saved the file. Includes a mandatory reopen-and-
  assert QA loop. Use this whenever the user asks for "an Excel file", "a
  spreadsheet", "an .xlsx report", "a workbook", "put this data in Excel",
  "an Excel dashboard", "export this with formatting", "a budget tracker",
  "a pivot-style summary sheet", or converting CSV to formatted Excel. Do NOT
  use it for statistical analysis or insight writing — that is
  information-analyst's job; do NOT use it for standalone PNG/SVG chart
  images — that is data-visualization's job; do NOT use it for PDF or DOCX
  reports — that is pdf-creator's job.
---

# Excel Creator

> Produce .xlsx workbooks that open clean, calculate correctly, look professionally styled, and pass a reopened-file QA — cover sheet, live formulas, conditional formatting, charts, and all.

## 0. Operating Rules (Non-Negotiable)

1. **MUST reopen every saved workbook with `load_workbook()` and assert structure** (sheet names, headers, row counts, spot values, formula strings) before delivering. Why: openpyxl writes silently; the only proof the file is correct is reading it back.
2. **NEVER assume openpyxl calculates formulas.** Cells written as `"=SUM(B2:B13)"` store the formula string with NO cached value; pandas/programmatic readers see None until Excel or LibreOffice opens and saves the file. Either write computed values for cells a machine will read, or recalculate via `soffice --headless --convert-to xlsx`, and say which you did.
3. **NEVER mutate a style object after sharing it.** Assigning the same `Font` instance to many cells is fine, but changing `font.bold = True` afterwards repaints every cell holding that object; create a fresh style per variant or use `copy.copy()` when in doubt.
4. **MUST keep sheet names ≤31 characters** with no `: \ / ? * [ ]` characters and no duplicates. Why: Excel rejects or silently truncates longer/invalid names; cross-sheet formulas then break.
5. **MUST write only the top-left cell of a merged range.** Writing to any other cell of a merged range throws AttributeError; style the merge by applying borders to each cell in the range.
6. **MUST apply number formats to every numeric cell** (`#,##0.00`, `0.0%`, `yyyy-mm-dd`, `$#,##0`). Why: a "percent" stored as 0.023 displays as 0.023 and gets misread; dates stored as serial numbers are unreadable.
7. **MUST write CSV with `encoding="utf-8-sig"`** so Excel detects UTF-8; plain utf-8 files with non-ASCII text open garbled in Excel.
8. **MUST freeze the header row** (`ws.freeze_panes = "A2"`) on any data sheet longer than one screen. Why: a scrolling sheet without a frozen header is unusable.
9. **NEVER style per-cell inside hot loops for large exports.** >50k rows MUST use `Workbook(write_only=True)` with pre-styled `WriteOnlyCell` headers and plain value rows. Why: per-cell style objects for 200k cells consume minutes and gigabytes.
10. **MUST use en-US formula syntax** — commas as argument separators, dot decimals. Why: openpyxl stores formulas in canonical en-US; semicolons or localized syntax produce #NAME? errors everywhere else.
11. **NEVER leave an empty header cell.** Blank headers break Excel Tables, autofilters, and pandas re-reads; every column gets a name or gets deleted.
12. **MUST run a final visual sanity pass** (convert to PDF via LibreOffice or screenshot the sheet) for anything customer-facing. Why: overlapping charts, 8-char-wide columns, and white-on-white text are invisible to asserts but obvious to the user.

## 1. When to Use / When Not To

**Use this skill when:**
- The deliverable is an .xlsx file: data export, report, dashboard, template, tracker, or budget model.
- The user says "put this in Excel", "make me a spreadsheet", "export with formatting", "add a summary sheet", "make it look professional".
- Formulas must stay live in the file (SUMIFS, VLOOKUP/XLOOKUP, cross-sheet totals) so users can edit inputs.
- CSV data must become a typed, styled, filtered Excel table.
- Conditional formatting (color scales, data bars, icon sets) or embedded native Excel charts are requested.

**Do NOT use when:**

| Request is about | Route to | Why |
|---|---|---|
| Deciding what the numbers mean, tests, insight writing | information-analyst | Analysis logic is upstream; this skill renders the agreed summary |
| Standalone chart images (PNG/SVG/PDF) for docs or slides | data-visualization | matplotlib produces dead-image charts; here charts live INSIDE the workbook linked to cells |
| PDF or Word report layout | pdf-creator | Different rendering pipeline entirely |
| Google Sheets-specific features or live web embedding | a web/integration task | openpyxl only writes the .xlsx file format |
| Editing an .xlsm's VBA macros | a VBA scripting task | openpyxl can preserve but not write macro code |

## 2. Core Concepts & Mental Models

### 2.1 Object Model
`Workbook` → `ws = wb.active` / `wb.create_sheet("Name")` → cells via `ws["A1"]`, `ws.cell(row=1, column=1, value=42)`, or `ws.append([..])` (appends a row after the current max row). Everything else — widths, panes, tables, charts, validation — hangs off the worksheet object; workbook-level items are `wb.sheetnames`, `wb.defined_names`, `wb.save(path)`.

### 2.2 Values vs Formulas vs Cached Values
A cell holds either a literal value (`42`, `"EMEA"`, `datetime`) or a formula string (`"=B2*C2"`). Formula cells have a third concept — the **cached value** Excel last calculated — which openpyxl never writes. Rule of thumb: formulas for humans who will open the file; values for machines that will parse it; `data_only=True` reads only cached values (None if never opened).

### 2.3 Styling Model
Styles are four orthogonal objects — `Font` (typeface/size/color/bold), `PatternFill` (fill_type="solid" + fgColor), `Border`/`Side` (edges), `Alignment` (horizontal/vertical/wrap) — plus the number format string. `NamedStyle` bundles them for reuse. Styles do NOT cascade: every cell that must look a certain way gets the style applied explicitly (loop over ranges or use NamedStyle).

### 2.4 The Header Standard
Every data sheet: row 1 = bold white text on dark fill (`PatternFill(fill_type="solid", fgColor="1F3864")`), centered, frozen (`freeze_panes="A2"`), autofilter or Excel Table attached, column widths sized to content. Consistency across sheets is what makes a workbook look engineered rather than dumped.

### 2.5 Live File Philosophy
A workbook is software: inputs (data/config sheets), logic (formula sheets), outputs (summary/dashboard). Prefer formulas over pasted numbers so users can change inputs; prefer hidden config sheets over magic numbers inside formulas; document the file on a cover sheet (purpose, owner, sources, update date).

### 2.6 Two Openpyxl Modes
Normal mode: random access, styling anywhere, charts — use below ~50k rows. `write_only=True`: append-only streaming, tiny memory, no re-opening of cells, charts/merges limited — use for bulk exports. Decide the mode FIRST; you cannot mix them.

## 3. Mandatory Workflow

1. **Clarify deliverable:** who opens it, in Excel or LibreOffice/Sheets, will they edit inputs, print it? MUST decide formula-vs-value policy here (Rule 2). Why: the whole build strategy depends on it.
2. **Design the sheet map:** e.g. `Cover` (README) → `Data` (raw, Table + autofilter) → `Summary` (formulas) → `Dashboard` (KPIs + charts). NEVER cram data, logic, and presentation into one sheet. Why: separation keeps formulas debuggable and lets users find things.
3. **Prepare data in pandas/plain Python:** clean types, normalize NaN → None (openpyxl writes NaN as a broken float), parse datetimes. NEVER dump raw dataframe dtypes blindly. Why: garbage-in styling cannot fix garbage-out.
4. **Build the skeleton:** create sheets, write headers with the Header Standard (§2.4), set `freeze_panes`, column widths, gridlines off for dashboard sheets. Why: structure first prevents restyling later.
5. **Write data:** `ws.append(row)` per row or column-block writes; apply number formats per column; convert NaN/inf → None. Why: unformatted numerics and NaT cells are the top cause of "the file looks broken".
6. **Add logic:** formulas as strings with absolute refs where needed (`$B$2`), cross-sheet refs (`=Summary!B4`), `IFERROR` around any division. NEVER write semicolon-separated formulas (Rule 10). Why: division by zero and locale syntax are the two most common formula defects.
7. **Style and format:** NamedStyle for repeated patterns, conditional formatting rules with concrete ranges, charts with `Reference` + axis titles. Why: consistent styling is cheap when planned, expensive when patched.
8. **QA (Rule 1):** reopen with `load_workbook()` and assert sheet names, headers, row counts, spot values, formula strings, no None headers; then optionally `soffice --convert-to pdf` and eyeball. NEVER deliver on asserts skipped. Why: every unasserted assumption eventually ships broken.
9. **Deliver with a note:** what each sheet contains, where inputs live, whether formulas are live or values. Why: an undocumented workbook becomes an orphan in a day.

## 4. Deep Knowledge Library

### 4.1 openpyxl Core API

| Task | Call |
|---|---|
| New workbook | `wb = Workbook()`; first sheet is `wb.active` |
| Rename/add sheets | `ws.title = "Data"`; `ws = wb.create_sheet("Summary")` |
| Write a cell | `ws["A1"] = "Revenue"` or `ws.cell(row=1, column=1, value="Revenue")` |
| Append a row | `ws.append(["Month", "Units", "Revenue"])` |
| Read a cell | `ws["B2"].value` |
| Dimensions | `ws.max_row`, `ws.max_column` |
| Column width | `ws.column_dimensions["B"].width = 14` (units ≈ characters of Calibri 11; ~1.0 per char + 2 padding) |
| Row height | `ws.row_dimensions[1].height = 22` (points) |
| Freeze panes | `ws.freeze_panes = "A2"` (row 1 frozen); `"B2"` freezes row 1 + column A |
| Merge | `ws.merge_cells("B2:D2")` — write `ws["B2"]` only |
| Save | `wb.save("report.xlsx")` (overwrites silently) |
| Reopen | `load_workbook("report.xlsx")`; `load_workbook("report.xlsx", data_only=True)` for cached values |

### 4.2 Styling System and the Sharing Gotcha

```python
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment, NamedStyle
from copy import copy

HEADER_FONT = Font(color="FFFFFF", bold=True)                 # sharing = OK
HEADER_FILL = PatternFill(fill_type="solid", fgColor="1F3864")
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
CENTER = Alignment(horizontal="center", vertical="center")

ws["A1"].font = HEADER_FONT                                   # assign freely
ws["A1"].fill = HEADER_FILL

# FORBIDDEN pattern: mutate after sharing —
# HEADER_FONT.bold = True            # repaints EVERY cell already using it
# Correct when a variant is needed: create new or copy
bold_italic = copy(HEADER_FONT); bold_italic.italic = True    # safe: copy first
```

NamedStyle for repeated roles:

```python
money = NamedStyle(name="money")
money.number_format = '$#,##0.00'
money.font = Font(name="Calibri", size=11)
wb.add_named_style(money)
ws["B2"].style = money          # apply by name; updates propagate from the definition
```

### 4.3 Number Format Catalog

| Data | Format string | Renders 1234.567 as |
|---|---|---|
| Integer count | `#,##0` | 1,235 |
| Money (2dp) | `#,##0.00` or `$#,##0.00` | 1,234.57 |
| Money (k) | `$#,##0,"K"` | $1,235K |
| Percent (1dp) | `0.0%` | 123456.7% of raw 1234.567 — ALWAYS store the fraction (12.34567 → 1234.6%) |
| Rate stored as fraction | `0.0%` on 0.123 | 12.3% |
| Date | `yyyy-mm-dd` | 2024-03-01 |
| Datetime | `yyyy-mm-dd hh:mm` | 2024-03-01 09:30 |
| Euro | `"€"#,##0.00` | €1,234.57 |
| Negative red | `#,##0.00;[Red]-#,##0.00` | -12.00 in red |
| Scientific | `0.00E+00` | 1.23E+03 |

GOTCHAS: percent format multiplies by 100 for display, so store fractions (0.123, not 123); datetime cells NEED the format or they show serial numbers; the `,"K"` thousands-scaler truncates, not rounds up display precision.

### 4.4 Layout: Widths, Panes, Merges, Print

- Column widths: set explicitly per column (`max(len(values)) + 2`, capped at ~45); `width = 0` hides a column; NEVER rely on defaults for deliverables.
- Row heights: only headers/decorative rows need explicit heights; Excel autosizes text otherwise.
- Merged cells: only top-left holds a value; wrap text needs explicit row height (merges don't autosize); apply borders cell-by-cell across the merged range or the outline looks partial.
- Print setup: `ws.page_setup.orientation = "landscape"`; `ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 0; ws.sheet_properties.pageSetUpPr.fitToPage = True` (MUST set fitToPage or fitToWidth is ignored); `ws.print_title_rows = "1:1"` repeats headers on every printed page.
- Gridlines: `ws.sheet_view.showGridLines = False` for cover/dashboard sheets; keep them on for raw data sheets.
- Tab colors: `ws.sheet_properties.tabColor = "1F3864"` groups sheets visually.

### 4.5 Formulas: Syntax, References, and the Calculation Gotcha

| Need | Formula string |
|---|---|
| Sum a range | `"=SUM(B2:B13)"` |
| Conditional sum | `"=SUMIFS(Data!E2:E1000, Data!B2:B1000, \"EMEA\")"` |
| Conditional count | `"=COUNTIFS(Data!C2:C1000, \"Widget\", Data!D2:D1000, \">100\")"` |
| Lookup legacy | `"=IFERROR(VLOOKUP(A2, Data!A:E, 3, FALSE), \"not found\")"` |
| Lookup robust | `"=INDEX(Data!C:C, MATCH(A2, Data!A:A, 0))"` |
| Lookup modern | `"=XLOOKUP(A2, Data!A:A, Data!C:C, \"not found\")"` |
| Safe division | `"=IFERROR(B3/B2, 0)"` |
| Cross-sheet | `"=Summary!B4"` |
| Today | `"=TODAY()"` |
| Text join | `"=TEXTJOIN(\", \", TRUE, A2:A10)"` |

- **Relative vs absolute:** `B2` moves on fill-down; `$B$2` never moves; `$B2`/`B$2` lock one axis. Use `$` on every constant/threshold reference — broken fills are the classic spreadsheet bug.
- **THE GOTCHA:** openpyxl stores the string only. `wb["Summary"]["B2"].value` returns `"=SUM(...)"`; `load_workbook(..., data_only=True)` returns None. Fixes: (a) write computed values with openpyxl when machines will read the file; (b) recalc headlessly: `soffice --headless --calc --convert-to xlsx --outdir out/ file.xlsx` re-saves with cached values (also `--convert-to pdf` for a visual QA artifact); (c) let the user's first open in Excel calculate. State explicitly which one applies to your deliverable.
- openpyxl raises on some invalid names at write time, but most formula typos (missing `=`, #REF!-creating deletions) surface only in Excel — hence the reopen-and-assert QA.

### 4.6 Tables, Filters, Validation, Named Ranges, Hidden Sheets

```python
from openpyxl.worksheet.table import Table, TableStyleInfo
table = Table(displayName="SalesData", ref="A1:E7",
              tableStyleInfo=TableStyleInfo(name="TableStyleMedium2",
                                            showRowStripes=True))
ws.add_table(table)                    # adds banded style + autofilter + structured refs

ws.auto_filter.ref = "A1:E7"           # filter without a Table

from openpyxl.worksheet.datavalidation import DataValidation
dv = DataValidation(type="list", formula1='"High,Medium,Low"', allow_blank=True,
                    showErrorMessage=True, errorTitle="Invalid",
                    error="Pick High, Medium or Low")
ws.add_data_validation(dv)
dv.add("D2:D1000")                     # dropdown on the whole working range

from openpyxl.workbook.defined_name import DefinedName
wb.defined_names["TargetRevenue"] = DefinedName("TargetRevenue",
                                                attr_text="Config!$B$2")  # openpyxl >= 3.1

cfg = wb.create_sheet("Config")
cfg.sheet_state = "hidden"             # magic numbers live here, not in formulas
```

Rules: Table displayName must be unique, no spaces; Table refs MUST start at the header row; a range can hold a Table OR an autofilter, not both; dropdown lists with commas inside items need a named-range `formula1="=ItemList"` instead of the literal.

### 4.7 Conditional Formatting (real arguments)

```python
from openpyxl.formatting.rule import ColorScaleRule, CellIsRule, FormulaRule, DataBarRule, IconSetRule

ws.conditional_formatting.add("C2:C13", ColorScaleRule(
    start_type="min", start_color="F8696B",
    mid_type="percentile", mid_value=50, mid_color="FFEB84",
    end_type="max", end_color="63BE7B"))

ws.conditional_formatting.add("E2:E13", DataBarRule(
    start_type="num", start_value=0, end_type="num", end_value=600,
    color="638EC6", showValue=True))

ws.conditional_formatting.add("E2:E13", CellIsRule(
    operator="lessThan", formula=["0"],
    font=Font(color="B3261E"), fill=PatternFill(fill_type="solid", fgColor="FCE4E4")))

ws.conditional_formatting.add("B2:B13", FormulaRule(
    formula=['AND($E2<0, $D2>100)'],          # anchored to the row: $E2 not $E$2
    font=Font(bold=True, color="B3261E")))

ws.conditional_formatting.add("D2:D13", IconSetRule(
    "3TrafficLights1", "percent", [0, 33, 67], showValue=True))
```

- `CellIsRule` operators: `greaterThan, lessThan, equal, between, notEqual…`; `formula` is a LIST of strings, numbers quoted as strings.
- `FormulaRule` formulas are relative to the TOP-LEFT cell of the range — write them for row 2 and use `$` to anchor columns; wrong anchoring shifts the rule down the range (the #1 conditional-formatting bug).
- `ColorScaleRule` for heatmaps, `DataBarRule` for in-cell bars, `IconSetRule` for status — one semantic per range, never three rules fighting on the same cells.

### 4.8 Embedded Charts

```python
from openpyxl.chart import BarChart, LineChart, PieChart, ScatterChart, Reference, Series
from openpyxl.chart.label import DataLabelList

bar = BarChart(); bar.type = "col"; bar.style = 10
bar.title = "Revenue by month"
bar.y_axis.title = "Revenue (USD)"; bar.x_axis.title = "Month"
bar.add_data(Reference(ws, min_col=5, min_row=1, max_row=13), titles_from_data=True)
bar.set_categories(Reference(ws, min_col=1, min_row=2, max_row=13))
bar.gapWidth = 40
bar.dataLabels = DataLabelList(); bar.dataLabels.showVal = True
ws.add_chart(bar, "H2")                       # anchor: top-left of the chart

line = LineChart()
line.add_data(Reference(ws, min_col=3, max_col=4, min_row=1, max_row=13),
              titles_from_data=True)
line.set_categories(Reference(ws, min_col=1, min_row=2, max_row=13))
for s in line.series: s.smooth = False        # honest lines, no spline invention

pie = PieChart()
pie.add_data(Reference(ws, min_col=5, min_row=1, max_row=7), titles_from_data=True)
pie.set_categories(Reference(ws, min_col=1, min_row=2, max_row=7))
pie.dataLabels = DataLabelList(); pie.dataLabels.showPercent = True

scatter = ScatterChart(); scatter.style = 13
xref = Reference(ws, min_col=2, min_row=2, max_row=13)
yref = Reference(ws, min_col=5, min_row=2, max_row=13)
s = Series(yref, xref, title="Units vs revenue")
s.marker.symbol = "circle"; s.graphicalProperties.line.noFill = True
scatter.series.append(s)
```

Chart rules: `titles_from_data=True` requires the reference to INCLUDE the header row, else series get named "Series1"; charts reference cells, so data edits flow through; one anchor cell per chart — two charts anchored at the same cell overlap; series colors via `s.graphicalProperties.solidFill = "4C72B0"`. Keep charts on the Dashboard sheet, anchored outside the data columns (e.g., "H2").

### 4.9 Multi-Sheet Report Pattern

| Sheet | Contents | Rules |
|---|---|---|
| `Cover` | title, purpose, owner, source systems, generation date, sheet map | gridlines off; no data |
| `Data` | raw rows as an Excel Table | frozen header; number formats; untouched by styling beyond header/table |
| `Summary` | SUMIFS/COUNTIFS pivots over `Data` | formulas reference Table columns or fixed ranges; IFERROR everywhere |
| `Dashboard` | KPI cards (merged cells), conditional formatting, charts referencing Summary | gridlines off; consistent palette `1F3864`/`D9E2F3`/accent `C00000` |
| `Config` (hidden) | thresholds, targets, rates | all constants referenced with defined names |

Palette standard: header fill `1F3864` (dark blue), banding via TableStyleMedium2, negative red `C00000`, good green `1B7F4D`. One palette for the whole workbook — sheet-by-sheet palettes look like five authors wrote one file.

### 4.10 pandas ↔ openpyxl Interop

```python
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill

df = pd.DataFrame({"Region": ["EMEA", "APAC"], "Revenue": [30400, 68200]})
with pd.ExcelWriter("pandas_out.xlsx", engine="openpyxl") as writer:
    df.to_excel(writer, sheet_name="Summary", index=False)   # index=False — ALWAYS
    ws = writer.sheets["Summary"]
    for cell in ws[1]:                                        # style the header row
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = PatternFill(fill_type="solid", fgColor="1F3864")
    ws.freeze_panes = "A2"
    ws.column_dimensions["B"].width = 14
```

- Reading back: `load_workbook(path)` gives formula strings; `load_workbook(path, data_only=True)` gives cached values — **None** if Excel/LibreOffice never opened the file. Reading with BOTH handles side by side is the standard QA trick: formulas from one, computed values from the other (after a soffice recalc).
- NaN handling: `df.fillna("")` or write `None` — openpyxl renders float NaN as a broken cell.
- Large CSV import: read with `pd.read_csv(path, dtype={...})` to pin types, then write; pinning prevents "2024-03" becoming a date or an int.

### 4.11 Performance & write_only Mode

- ≤50k rows with styling: normal mode is fine.
- >50k rows: `Workbook(write_only=True)`; sheets via `wb.create_sheet()`; ONLY `ws.append()`; styles must ride on `WriteOnlyCell` objects at append time; column widths via `ws.set_dimension` before appends... actually set them via `ws.column_dimensions` is unavailable — use plain sheets or accept defaults for bulk data tabs.
- Hot-loop rules: build ONE Font/Fill per role outside the loop and assign (assignment is cheap; construction per cell is not); avoid `ws.cell(row=i, column=j)` lookups in favor of `append`; avoid merged cells and conditional formatting on bulk sheets.
- Save time: `wb.save()` writes a zip — for 200k+ rows expect seconds, not minutes; NEVER re-open and re-save in a loop (build everything, save once).

### 4.12 CSV Interop

```python
import csv

with open("export.csv", "w", newline="", encoding="utf-8-sig") as f:   # BOM → Excel decodes UTF-8
    writer = csv.writer(f)
    writer.writerow(["month", "region", "revenue"])
    writer.writerows(rows)
```

- `utf-8-sig` is MANDATORY for Excel round-trips with non-ASCII text; plain `utf-8` shows "å…¬å�¸"-style mojibake.
- Reading: `csv.Sniffer().sniff(sample, delimiters=",;\t|")` to detect the dialect before parsing; handle quoted fields with embedded commas by letting `csv.reader` do it — NEVER split(",") on CSV text.
- Numbers-as-text: when Excel must keep leading zeros (SKU "0012"), write the CSV cell as `="0012"` or, better, deliver as .xlsx with `Text` format `@`.

## 5. Code & Tool Templates

Every script below is complete and runnable with `openpyxl>=3.1`.

### 5.1 Sales report generator (cover + data Table + formula summary + chart)

```python
"""Monthly sales report: Cover, Data (Table), Summary (live formulas), embedded chart."""
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.chart import BarChart, Reference

DARK = "1F3864"
HEADER_FONT = Font(color="FFFFFF", bold=True)
HEADER_FILL = PatternFill(fill_type="solid", fgColor=DARK)
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = Workbook()

cover = wb.active
cover.title = "Cover"
cover.sheet_view.showGridLines = False
cover["B2"] = "Monthly Sales Report"
cover["B2"].font = Font(size=18, bold=True, color=DARK)
cover["B3"] = f"Generated {date.today():%Y-%m-%d} | Source: CRM extract | Owner: Sales Ops"
cover["B4"] = "Sheets: Data (raw) · Summary (formulas) · chart on Summary"
cover.column_dimensions["B"].width = 70

data = wb.create_sheet("Data")
rows = [
    ["Month", "Region", "Product", "Units", "Revenue"],
    ["2024-01", "EMEA", "Widget", 120, 14400],
    ["2024-01", "EMEA", "Gadget", 80, 16000],
    ["2024-01", "APAC", "Widget", 200, 24000],
    ["2024-02", "EMEA", "Widget", 135, 16200],
    ["2024-02", "APAC", "Gadget", 95, 19000],
    ["2024-02", "APAC", "Widget", 210, 25200],
]
for r in rows:
    data.append(r)
for c in range(1, 6):
    cell = data.cell(row=1, column=c)
    cell.font, cell.fill, cell.border = HEADER_FONT, HEADER_FILL, BOX
data.freeze_panes = "A2"
data.add_table(Table(displayName="SalesData", ref=f"A1:E{len(rows)}",
                     tableStyleInfo=TableStyleInfo(name="TableStyleMedium2",
                                                   showRowStripes=True)))
data.column_dimensions["E"].width = 14
for r in range(2, len(rows) + 1):
    data.cell(row=r, column=5).number_format = "#,##0"

summ = wb.create_sheet("Summary")
for c, title in enumerate(["Metric", "Value"], start=1):
    cell = summ.cell(row=1, column=c, value=title)
    cell.font, cell.fill, cell.border = HEADER_FONT, HEADER_FILL, BOX
metrics = [
    ("Total units", "=SUM(Data!D2:D7)", "#,##0"),
    ("Total revenue", "=SUM(Data!E2:E7)", "$#,##0"),
    ("EMEA revenue", '=SUMIFS(Data!E2:E7, Data!B2:B7, "EMEA")', "$#,##0"),
    ("Widget units", '=SUMIFS(Data!D2:D7, Data!C2:C7, "Widget")', "#,##0"),
    ("Avg revenue per unit", "=IFERROR(B3/B2, 0)", "$#,##0.00"),
]
for i, (label, formula, fmt) in enumerate(metrics, start=2):
    summ.cell(row=i, column=1, value=label)
    cell = summ.cell(row=i, column=2, value=formula)
    cell.number_format = fmt
    cell.border = BOX
summ.column_dimensions["A"].width = 24
summ.column_dimensions["B"].width = 16

chart = BarChart(); chart.type = "col"; chart.title = "Revenue by record"
chart.y_axis.title = "Revenue (USD)"; chart.x_axis.title = "Month / region"
chart.add_data(Reference(data, min_col=5, min_row=1, max_row=len(rows)),
               titles_from_data=True)
chart.set_categories(Reference(data, min_col=1, min_row=2, max_row=len(rows)))
chart.height, chart.width = 8, 15
summ.add_chart(chart, "D2")

wb.save("sales_report.xlsx")
```

### 5.2 KPI dashboard with conditional formatting and trend chart

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.formatting.rule import DataBarRule, CellIsRule
from openpyxl.chart import LineChart, Reference

wb = Workbook()
ws = wb.active
ws.title = "KPI Dashboard"
ws.sheet_view.showGridLines = False

ws["B2"] = "Revenue vs target — H1"
ws["B2"].font = Font(size=14, bold=True, color="1F3864")

headers = ["Month", "Revenue", "Target", "Variance %"]
for i, h in enumerate(headers, start=2):
    c = ws.cell(row=4, column=i, value=h)
    c.font = Font(color="FFFFFF", bold=True)
    c.fill = PatternFill(fill_type="solid", fgColor="1F3864")
    c.alignment = Alignment(horizontal="center")

months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
rev = [412, 388, 455, 470, 462, 501]
tgt = [400, 400, 450, 460, 470, 480]
for i, m in enumerate(months):
    r = 5 + i
    ws.cell(row=r, column=2, value=m)
    ws.cell(row=r, column=3, value=rev[i]).number_format = "#,##0"
    ws.cell(row=r, column=4, value=tgt[i]).number_format = "#,##0"
    ws.cell(row=r, column=5, value=f"=IFERROR((C{r}-D{r})/D{r},0)").number_format = "0.0%"
for col, width in zip("BCDE", (10, 12, 12, 12)):
    ws.column_dimensions[col].width = width

last = 4 + len(months)
ws.conditional_formatting.add(f"C5:C{last}", DataBarRule(
    start_type="num", start_value=0, end_type="num", end_value=600,
    color="638EC6", showValue=True))
ws.conditional_formatting.add(f"E5:E{last}", CellIsRule(
    operator="lessThan", formula=["0"], font=Font(color="B3261E"),
    fill=PatternFill(fill_type="solid", fgColor="FCE4E4")))
ws.conditional_formatting.add(f"E5:E{last}", CellIsRule(
    operator="greaterThanOrEqual", formula=["0"], font=Font(color="1B7F4D")))

ch = LineChart(); ch.title = "Revenue vs target"
ch.add_data(Reference(ws, min_col=3, max_col=4, min_row=4, max_row=last),
            titles_from_data=True)
ch.set_categories(Reference(ws, min_col=2, min_row=5, max_row=last))
for s in ch.series:
    s.smooth = False
ch.height, ch.width = 8, 14
ws.add_chart(ch, "G4")

wb.save("kpi_dashboard.xlsx")
```

### 5.3 Multi-sheet financial summary with cross-sheet formulas

```python
"""Three growth scenarios + dashboard. Cross-sheet formulas; needs one open in
Excel/LibreOffice (or a soffice recalc) before cached values exist."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side

wb = Workbook()
dash = wb.active
dash.title = "Dashboard"
thin = Side(style="thin", color="BFBFBF")
box = Border(left=thin, right=thin, top=thin, bottom=thin)
hdr = Font(bold=True, color="FFFFFF")
fill = PatternFill(fill_type="solid", fgColor="1F3864")

def make_scenario(name, growth):
    ws = wb.create_sheet(name)
    ws.append(["Month", "Units", "Price", "Revenue"])
    for c in range(1, 5):
        ws.cell(row=1, column=c).font = hdr
        ws.cell(row=1, column=c).fill = fill
        ws.cell(row=1, column=c).border = box
    for m in range(1, 13):
        r = m + 1
        ws.cell(row=r, column=1, value=f"2025-{m:02d}")
        ws.cell(row=r, column=2, value=int(1000 * (1 + growth) ** (m - 1)))
        ws.cell(row=r, column=3, value=24.5).number_format = "$#,##0.00"
        ws.cell(row=r, column=4, value=f"=B{r}*C{r}").number_format = "$#,##0"
    ws.cell(row=14, column=1, value="Total").font = Font(bold=True)
    total = ws.cell(row=14, column=4, value="=SUM(D2:D13)")
    total.number_format, total.font = "$#,##0", Font(bold=True)
    ws.column_dimensions["A"].width = 10
    for col in "BCD":
        ws.column_dimensions[col].width = 12

for name, g in [("Base", 0.01), ("Upside", 0.03), ("Downside", -0.02)]:
    make_scenario(name, g)

dash.sheet_view.showGridLines = False
dash["B2"] = "FY2025 revenue scenarios"
dash["B2"].font = Font(size=14, bold=True, color="1F3864")
for i, name in enumerate(["Base", "Upside", "Downside"]):
    r = 4 + i
    dash.cell(row=r, column=2, value=name)
    cell = dash.cell(row=r, column=3, value=f"={name}!D14")
    cell.number_format, cell.border = "$#,##0", box
dash.cell(row=7, column=2, value="Spread (Upside - Downside)")
spread = dash.cell(row=7, column=3, value="=C5-C7")
spread.number_format, spread.font = "$#,##0", Font(bold=True)
dash.column_dimensions["B"].width = 28
dash.column_dimensions["C"].width = 14

wb.save("scenario_model.xlsx")
```

### 5.4 CSV → styled xlsx converter (typed, auto-width, frozen header)

```python
"""Usage: python csv_to_xlsx.py input.csv output.xlsx"""
import csv
import sys
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

def coerce(value):
    s = str(value).strip()
    if s == "":
        return None
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s.replace(",", ""))          # "1,234.5" -> 1234.5
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return s                                       # keep as text

def csv_to_xlsx(src, dst):
    with open(src, newline="", encoding="utf-8-sig") as f:   # utf-8-sig strips BOM
        sample = f.read(4096)
        f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        reader = csv.reader(f, dialect)
        header = next(reader)
        wb = Workbook()
        ws = wb.active
        ws.title = "Data"
        ws.append(header)
        for row in reader:
            ws.append([coerce(v) for v in row])
        for c, name in enumerate(header, start=1):
            cell = ws.cell(row=1, column=c)
            cell.font = Font(color="FFFFFF", bold=True)
            cell.fill = PatternFill(fill_type="solid", fgColor="1F3864")
            cell.alignment = Alignment(horizontal="center")
            widths = [len(str(name))] + [
                len(str(ws.cell(row=r, column=c).value or ""))
                for r in range(2, ws.max_row + 1)]
            ws.column_dimensions[get_column_letter(c)].width = min(max(widths) + 2, 45)
        ws.freeze_panes = "A2"
        if ws.max_row > 1:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(header))}{ws.max_row}"
        for r in range(2, ws.max_row + 1):
            for c in range(1, len(header) + 1):
                v = ws.cell(row=r, column=c).value
                if isinstance(v, datetime):
                    ws.cell(row=r, column=c).number_format = "yyyy-mm-dd"
                elif isinstance(v, float):
                    ws.cell(row=r, column=c).number_format = "#,##0.00"
                elif isinstance(v, int):
                    ws.cell(row=r, column=c).number_format = "#,##0"
        wb.save(dst)
    print(f"Wrote {dst} ({ws.max_row - 1} data rows, {len(header)} columns)")

if __name__ == "__main__":
    csv_to_xlsx(sys.argv[1], sys.argv[2])
```

### 5.5 Bulk export with write_only (200k rows, flat memory)

```python
from datetime import datetime, timedelta
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill

def bulk_export(path, n_rows=200_000):
    wb = Workbook(write_only=True)                 # append-only; no random access
    ws = wb.create_sheet("Data")
    header = [WriteOnlyCell(ws, value=t) for t in ("id", "value", "ts")]
    for c in header:
        c.font = Font(color="FFFFFF", bold=True)
        c.fill = PatternFill(fill_type="solid", fgColor="1F3864")
    ws.append(header)
    base = datetime(2024, 1, 1)
    for i in range(n_rows):
        ws.append([i, i * 1.5, base + timedelta(minutes=i)])   # plain values = fast
    wb.save(path)

bulk_export("bulk.xlsx", 200_000)
```

### 5.6 Mandatory QA script (reopen and assert)

```python
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

def qa_workbook(path, expected_sheets, expected_headers, spot_checks=None):
    """spot_checks: {(sheet, cell): expected_value_or_formula_string}"""
    wb = load_workbook(path)
    assert wb.sheetnames == expected_sheets, f"sheets: {wb.sheetnames}"
    for sheet, headers in expected_headers.items():
        ws = wb[sheet]
        got = [ws.cell(row=1, column=c).value for c in range(1, len(headers) + 1)]
        assert got == headers, f"{sheet} headers: {got}"
        for c in range(1, ws.max_column + 1):
            v = ws.cell(row=1, column=c).value
            assert v not in (None, ""), f"empty header {sheet}!{get_column_letter(c)}1"
        assert ws.max_row > 1, f"{sheet} has no data rows"
    for (sheet, cell), expected in (spot_checks or {}).items():
        got = wb[sheet][cell].value
        assert got == expected, f"{sheet}!{cell} = {got!r}, expected {expected!r}"
    for ws in wb.worksheets:                       # no broken formula strings
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    assert "#REF!" not in cell.value and "#NAME?" not in cell.value, \
                        f"{ws.title}!{cell.coordinate}: {cell.value}"
    # Optional cached-value pass (after soffice recalc):
    wbv = load_workbook(path, data_only=True)
    print("QA passed:", path)
    return wb, wbv

qa_workbook(
    "sales_report.xlsx",
    ["Cover", "Data", "Summary"],
    {"Data": ["Month", "Region", "Product", "Units", "Revenue"],
     "Summary": ["Metric", "Value"]},
    {("Summary", "B2"): "=SUM(Data!D2:D7)"},
)
```

## 6. Decision Tables

**Table A — Formula vs value vs recalc**

| Consumers of the cell | Write | Why |
|---|---|---|
| Humans opening in Excel | formula string | stays live when inputs change |
| Scripts/pandas reading the file | computed value | formulas have no cached value → None |
| Both | formula + deliver after `soffice --convert-to xlsx` recalc | caches values while keeping live formulas |
| Thresholds/targets | value on hidden Config sheet + defined name | one place to edit, no magic numbers |

**Table B — Number format picker**

| Content | Format | Note |
|---|---|---|
| Money | `$#,##0.00` / `$#,##0` | decide decimals once per workbook |
| Percent | `0.0%` | store fraction 0.123, never 123 |
| Counts | `#,##0` | thousands separators always |
| Dates | `yyyy-mm-dd` | ISO sorts and reads unambiguously |
| SKU/phone/zip | `@` (Text) | preserves leading zeros |
| Negative money | `#,##0.00;[Red]-#,##0.00` | red negatives aid scanning |

**Table C — openpyxl chart picker**

| Need | Chart | Key config |
|---|---|---|
| Compare categories | BarChart (`type="col"` or `"bar"`) | `gapWidth=40`, value labels on |
| Trend over time | LineChart | `s.smooth = False`, categories set |
| Part-of-whole (≤5 slices) | PieChart | `dataLabels.showPercent = True` |
| Two numeric columns | ScatterChart | `Series(yref, xref)`, marker, no line |
| Stacked composition | BarChart `grouping="stacked"`, `overlap=100` | order series bottom-up |

**Table D — Conditional formatting rule picker**

| Signal | Rule | Anchor note |
|---|---|---|
| Gradient heatmap | ColorScaleRule (min/percentile/max) | 3-color for midpoints |
| In-cell magnitude bars | DataBarRule (num start 0) | fixed end_value for comparability |
| Above/below threshold | CellIsRule | formula list: ["0"] |
| Row-level logic (A<0 AND B>100) | FormulaRule | relative to top-left, `$` anchor columns |
| Status buckets | IconSetRule ("3TrafficLights1", "percent", [0,33,67]) | thresholds are lower bounds |

## 7. Quality Checklist

Verify EVERY item before delivering:

- [ ] Workbook reopened with `load_workbook()` and structure asserted (sheet names, headers, row counts, spot values, formula strings)
- [ ] Every header cell populated — no blanks (breaks Tables/filters/pandas)
- [ ] Sheet names ≤31 chars, no `: \ / ? * [ ]`, unique, meaningful
- [ ] Header row styled (bold white on dark fill), frozen (`freeze_panes="A2"`), sized columns
- [ ] Number formats on every numeric/date/percent cell; percentages stored as fractions
- [ ] No NaN/inf/NaT written as raw floats; empties are None or ""
- [ ] Formulas use en-US commas and start with "="; no semicolon locale syntax
- [ ] Every division wrapped in IFERROR; denominators guarded
- [ ] Absolute `$` refs on all constants/thresholds inside fillable formulas
- [ ] Merged ranges: value written only to top-left; borders applied across the range
- [ ] Formula-vs-value policy decided and stated (Rule 2); soffice recalc run if cached values were promised
- [ ] Conditional formatting: FormulaRule anchored correctly to the range's top-left; rules verified on first AND last data row
- [ ] Charts: `titles_from_data=True` references include the header row; anchors don't overlap; axis titles set
- [ ] Tables/autofilters: ref starts at the header row; displayName unique, no spaces
- [ ] Data validation ranges cover the whole working column, not just current rows
- [ ] CSV exports written with `encoding="utf-8-sig"`; leading-zero fields protected
- [ ] Gridlines off on cover/dashboard sheets; on for raw data sheets
- [ ] Print setup set if the file will be printed (orientation, fitToWidth + fitToPage=True, title rows)
- [ ] Cover sheet documents purpose, sources, owner, generation date, sheet map
- [ ] File opens without repair warnings in Excel or LibreOffice (verified by actual open or soffice conversion)

## 8. Common Mistakes & Fixes

1. **Formulas read as None** → script consumes `=SUM(...)` file and gets empty data → write computed values for machine readers, or recalc via `soffice --headless --convert-to xlsx --outdir out/ file.xlsx`.
2. **`data_only=True` returns None everywhere** → file was never opened/calculated by an app → run the soffice recalc or open-save once in Excel before programmatic reads.
3. **Shared style mutated** → changing one header's font repaints the whole workbook → `copy.copy(style)` before tweaking, or define separate style objects.
4. **Sheet name 40 chars or contains "/"** → save fails or name truncates and cross-sheet refs break → sanitize: `re.sub(r'[:\\/?*\[\]]', "", name)[:31]`.
5. **Writing to a merged non-top-left cell** → AttributeError at save time → write `ws["B2"]` only for a `B2:D2` merge; style each cell in the range for borders.
6. **`to_excel` without `index=False`** → mystery "Unnamed: 0"/index column → always `df.to_excel(..., index=False)`.
7. **NaN floats in cells** → Excel shows a broken numeric cell → `df = df.where(df.notna(), None)` or `fillna("")` before writing.
8. **UTF-8 CSV opens garbled in Excel** → mojibake for non-ASCII → write with `encoding="utf-8-sig"`.
9. **Percent column shows 1234.6%** → raw number stored, percent format applied → store the fraction (0.1234) then format `0.0%`.
10. **Dates display as 45352** → datetime written without number format → set `number_format = "yyyy-mm-dd"` on every date cell.
11. **FormulaRule fires on wrong rows** → rule drifts down the range → write the formula relative to the range's top-left cell and `$`-anchor columns (`AND($E2<0,$D2>100)` for range starting at row 2).
12. **Chart series named "Series1"** → reference excluded the header row with `titles_from_data=True` → include `min_row=1` in the data Reference.
13. **Two charts stacked on one cell** → second anchor missing → give each `ws.add_chart(chart, "H2"/"H20"/"Q2")` a distinct anchor.
14. **Semicolon formulas** → `=SUM(A1;A2)` → #NAME? on open → openpyxl stores en-US syntax; ALWAYS commas.
15. **Per-cell Font construction in a 200k-row loop** → build takes minutes, RAM balloons → `Workbook(write_only=True)` + shared WriteOnlyCell header styles + plain value rows.

## 9. Advanced Techniques

### 9.1 Streaming with WriteOnlyCell and Row Dimensions
In write_only mode nothing can be restyled after append — attach styles at creation and set column widths up-front: in write_only sheets, define widths before appending via `ws.column_dimensions["A"].width = 12` right after `create_sheet()` (openpyxl ≥3.0 honors early dimension settings). For alternating row banding at scale, pre-build two row templates of WriteOnlyCell and swap fill by `row_number % 2` at append time — the only banding strategy that survives 500k rows.

### 9.2 Defined Names + Hidden Config Sheets
Put every threshold, target, and rate on a hidden `Config` sheet, name the cells (`wb.defined_names["ChurnTarget"] = DefinedName("ChurnTarget", attr_text="Config!$B$2")`), and reference `=ChurnTarget` in formulas. Updating the model becomes editing one cell instead of hunting constants through formulas — and hidden sheets stop casual users from "fixing" the targets. Unhide with `cfg.sheet_state = "visible"` when users must edit inputs.

### 9.3 Headless LibreOffice Recalculation Pipeline
After openpyxl saves, `soffice --headless --convert-to xlsx --outdir out/ report.xlsx` re-saves the file with cached formula values, making it safe for pandas readers AND keeping formulas live; `--convert-to pdf` additionally produces a layout artifact for the visual QA pass (Rule 12). ALWAYS run soffice on a COPY — conversion can normalize some formatting, so the openpyxl original stays the source of truth. Verify the recalc by asserting `load_workbook(copy, data_only=True)["Summary"]["B3"].value is not None`.

### 9.4 Print-Perfect Sheets
For files destined for paper: `ws.print_area = "A1:H40"`; `ws.page_setup.orientation = "landscape"`; `fitToWidth=1, fitToHeight=0` plus `ws.sheet_properties.pageSetUpPr.fitToPage = True`; `ws.print_title_rows = "1:1"` so headers repeat per page; `ws.page_margins = PageMargins(left=0.4, right=0.4, top=0.5, bottom=0.5)`. Without `fitToPage=True`, Excel ignores fitToWidth — the most common "it prints at 140%" complaint.

### 9.5 Workbook Protection and Documentation
Lock the logic, free the inputs: `ws.protection.sheet = True` with `ws.protection.enable()` after unlocking input cells (`cell.protection = Protection(locked=False)`), so users edit the Config/Data cells but cannot break formulas. Add `Comment("Updated from CRM on 2024-07-01", "Analyst Bot")` to cells whose provenance matters — comments survive round-trips and answer "where did this number come from" without a meeting.

## 10. Quick Reference Card

```
CORE:   wb = Workbook() | ws = wb.active / wb.create_sheet("S") | ws["A1"]=v | ws.append(row)
        wb.save(p) | wb2 = load_workbook(p) | load_workbook(p, data_only=True) → cached (None if never opened)
STYLE:  Font(color="FFFFFF", bold=True) | PatternFill(fill_type="solid", fgColor="1F3864")
        Border(left=Side("thin", ...), ...) | Alignment(horizontal="center") | cell.number_format = "#,##0.00"
        NEVER mutate a shared style — copy.copy() first
LAYOUT: ws.freeze_panes="A2" | ws.column_dimensions["B"].width=14 | ws.merge_cells("B2:D2") → write B2 only
        ws.sheet_view.showGridLines=False | print: fitToWidth=1 + pageSetUpPr.fitToPage=True
FORMULA:"=SUM(B2:B13)" | "=SUMIFS(E2:E100,B2:B100,\"EMEA\")" | "=IFERROR(B3/B2,0)" | "=Summary!B4"
        commas ALWAYS (en-US) | $B$2 absolute | openpyxl does NOT calculate → values or soffice recalc
TABLES: Table(displayName, ref="A1:E7", tableStyleInfo=TableStyleInfo("TableStyleMedium2")) | auto_filter.ref
        DataValidation(type="list", formula1='"High,Medium,Low"') + dv.add("D2:D100")
COND:   ColorScaleRule | DataBarRule(start 0, fixed end) | CellIsRule(op, formula=["0"])
        FormulaRule(formula=["AND($E2<0,$D2>100)"]) ← anchor to top-left of range
CHARTS: BarChart/LineChart/PieChart/ScatterChart + Reference(ws, min_col, min_row, max_row)
        titles_from_data=True → include header row | ws.add_chart(chart, "H2") — one anchor per chart
BULK:   >50k rows → Workbook(write_only=True) | append-only | styles on WriteOnlyCell at creation
CSV:    encoding="utf-8-sig" for Excel | Sniffer for delimiters | never split(",") manually
QA:     reopen → assert sheets/headers/rows/spot values/formula strings → no #REF!/#NAME?
        → soffice --convert-to pdf for eyeball pass → deliver
```

