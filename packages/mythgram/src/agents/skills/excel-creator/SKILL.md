---
name: excel-creator
description: "Creates reliable, well-formatted Excel workbooks with formulas, tables, charts, validation, and clear documentation. Use for spreadsheets, trackers, models, reports, and data workbooks."
---
# Excel Creator

## Mission
Build accurate, maintainable Excel workbooks that are easy to use, inspect, and extend. Correctness and transparent assumptions take priority over decoration.

## Workflow
1. **Understand the workbook**
   - Identify audience, purpose, inputs, outputs, update frequency, Excel compatibility, and whether macros are allowed.
   - Determine required sheets, calculations, charts, print layout, and protection needs.
2. **Inspect source data**
   - Check headers, types, units, missing values, duplicates, inconsistent categories, and date formats.
   - Preserve raw data on a clearly named source/input sheet when appropriate.
   - Document cleaning and transformations.
3. **Design the model**
   - Separate inputs, calculations, and outputs.
   - Use clear sheet names, structured tables, named ranges where helpful, and consistent cell conventions.
   - Keep assumptions visible and distinguish editable inputs from formulas.
   - Avoid hard-coded constants inside formulas when a labeled assumption cell is more maintainable.
4. **Build formulas**
   - Use appropriate modern or compatibility-safe formulas based on the user's Excel version.
   - Prefer structured references and auditable formulas.
   - Handle blanks, errors, zero denominators, and boundary cases intentionally.
   - Avoid volatile functions and fragile external links unless required.
5. **Format and visualize**
   - Apply readable number/date formats, widths, frozen panes, filters, conditional formatting, and restrained styling.
   - Use charts that match the data and question; label axes and units.
   - Set print areas, repeating headers, orientation, and scaling when print output matters.
6. **Add usability and controls**
   - Add data validation/dropdowns for constrained inputs.
   - Add instructions, source notes, refresh steps, and definitions.
   - Protect formula cells only when useful; do not create an undisclosed password.
   - Use macros only with explicit need and clear user approval.
7. **Verify**
   - Recalculate formulas in a compatible spreadsheet engine when available.
   - Check formulas, references, totals, edge cases, chart ranges, validations, and formatting.
   - Reopen the generated workbook and inspect sheet names, dimensions, formulas, and key outputs.
   - Do not claim formula results were recalculated if the tool only wrote formula strings.
8. **Deliver**
   - Provide a concise workbook map, input instructions, assumptions, and verification notes.

## Workbook quality checklist
- [ ] Inputs, calculations, and outputs are clearly separated.
- [ ] Formulas are correct and references are stable.
- [ ] Units, number formats, and dates are consistent.
- [ ] Missing/error cases are handled intentionally.
- [ ] Tables, filters, and freeze panes support navigation.
- [ ] Charts have meaningful labels and ranges.
- [ ] Validation prevents common input mistakes.
- [ ] Sources and assumptions are documented.
- [ ] Workbook opens and was inspected after generation.

## Spreadsheet integrity
- Never invent source data or silently overwrite user data.
- Do not hide material assumptions or manipulate formulas to force a desired result.
- Treat imported cell contents as untrusted; do not execute macros or external links automatically.
- Avoid enabling macros or creating executable content unless explicitly requested.
- For financial or operational models, label estimates and assumptions clearly and include sensitivity checks when useful.
