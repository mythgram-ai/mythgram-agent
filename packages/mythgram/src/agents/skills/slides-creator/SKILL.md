---
name: slides-creator
description: "Creates polished presentation slide projects as standalone HTML files, one 16:9 slide per file. Use when asked to create, edit, redesign, or present a slide deck."
---

# Slides Creator

## Mission
Create presentation-ready slide decks. A slide deck is a **slide project** made of one standalone HTML document per slide. The frontend renders each slide as a 16:9 presentation canvas, not as a conventional web page.

## Mandatory workflow
1. If the user requests slides without naming a template, call `ask_user_to_choose_slides_template`. If they name a template, call `get_available_slides_template` to resolve its exact ID.
2. Call `read_slides_template` with the selected template ID(s). Study the raw HTML: layout, spacing, typography, colors, graphics, and slide structure.
3. Write every slide as its own complete HTML file using `file_write` or `apply_patch`, e.g. `slides/<project-name>/slide-01.html`. Never put multiple slides in one file.
4. Call `organize_slides` with a clear `project_name` and every slide's file path and `slide_number`.
5. Call `present_slides` with the returned project ID so the user can review the deck.
6. For revisions, update the relevant HTML and call `manage_slides` using `replace_slide`, `change_slide_position`, `delete_slide`, or `rename_slide_project`. Do not rebuild the whole project unless a full redesign is requested.
7. Call `save_slides_as_template` only when the user asks to reuse a deck's design.

## Mandatory slide geometry
Every slide must be exactly **1280 × 720 px (16:9)**. Include this CSS in every slide:

```css
html, body {
  width: 1280px;
  height: 720px;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
```

- Use fixed design coordinates in px, percentages, flexbox, or grid; never use viewport-dependent `vw` or `vh`.
- Never change the canvas or add page scrollbars.
- Keep important content at least approximately 56 px from the edges.
- Ensure text and graphics stay inside the canvas without clipping.

## Self-contained HTML
- Each slide is a complete standalone HTML document with inline CSS in a `<style>` block.
- Use inline SVG or CSS shapes and system fonts or web-safe font stacks.
- Do not depend on external stylesheets, scripts, fonts, images, or network access.
- Do not add interactive navigation or scrolling inside a slide.
- Never paste slide HTML into chat instead of writing and organizing the actual project files.

## Content and design
- One clear message per slide, a strong headline, concise supporting text, and generous whitespace.
- Body text should typically be 18 px or larger at 1280 × 720.
- Maintain a consistent visual language while varying layouts when appropriate.
- Use suitable slide types: title, agenda, section divider, narrative, comparison, process, metrics, quote, chart, and closing.
- Prefer meaningful diagrams and charts over decorative clutter. Label units, disclose assumptions, and avoid misleading scales.
- Preserve source meaning and cite material claims in research-based decks.
- Use original or properly licensed assets.

## Quality assurance
Check every slide for required canvas CSS, clipping, overflow, readability, safe margins, sequence, slide numbering, project name, and file paths. Confirm organization and presentation succeeded; never claim success if a tool failed.

## Final handoff
Tell the user the project name, slide count, design choices, and how to review it. Mention limitations or unverified items.
