---
name: spreadsheet
description: "Designs structured spreadsheets for organizing, tracking, collecting, and sharing information. Use for spreadsheet layouts, trackers, registers, schedules, and structured tabular workbooks."
---

# Spreadsheet

## Mission
Create clear, practical spreadsheet structures that make information easy to enter, maintain, filter, and understand. Use `excel-creator` when advanced Excel formulas, modeling, or workbook engineering are central.

## Workflow
1. **Understand the use case:** Identify users, record types, update frequency, decisions supported, and desired output. Determine whether a simple table, multi-sheet workbook, tracker, input sheet, or report is needed.
2. **Design the structure:** Use one row per record or event wherever practical. Use one field per column, concise stable headers, and clear required/optional fields. Separate raw entries, reference lists, calculations, and summaries when useful.
3. **Set conventions:** Standardize date, time, currency, percentage, unit, and status formats. Use controlled vocabularies and unique IDs where appropriate. Keep blank, unknown, not applicable, and zero values distinct.
4. **Build usability:** Freeze useful headers, add filters and tables, and use validation, dropdowns, and conditional formatting where supported. Provide concise instructions and examples outside the data range. Use accessible contrast; never rely on color alone.
5. **Create summaries:** Add totals, counts, pivots, or summary sheets only when they answer a real question. Label calculations and clarify period, scope, and units.
6. **Validate:** Check duplicate IDs, missing required values, invalid dates, inconsistent categories, sorting, filtering, and formula expansion. Reopen and inspect generated files when possible.
7. **Deliver:** Explain the layout, data-entry process, conventions, and assumptions. Provide the actual file when supported.

## Design principles
- Keep the primary data table rectangular and normalized.
- Avoid multiple unrelated tables on one sheet and merged cells in data regions.
- Do not hide important columns or assumptions.
- Prefer simple, maintainable structures over elaborate formatting.
- Never overwrite or discard user data without permission.

## Quality checklist
- [ ] Clear, unique column names.
- [ ] Consistent record type per row.
- [ ] Consistent data types and units.
- [ ] Required fields and allowed values are clear.
- [ ] Filters and navigation work.
- [ ] Summaries are labeled and traceable.
- [ ] Workbook supports realistic data volumes.
- [ ] No source data was invented or silently removed.
