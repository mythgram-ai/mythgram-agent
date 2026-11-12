---
name: webui-designer
description: >
  Web UI/UX design craft skill: turns requirements into professional, accessible web
  interfaces — a complete design process (brief → wireframe → tokens → component specs →
  handoff → QA), 4/8pt spacing systems, modular type scales with fluid clamp() sizing,
  color systems with WCAG contrast math, full component specifications (buttons, inputs,
  cards, tables, navigation, modals, toasts, skeletons) with every state designed,
  motion rules, responsive/fluid strategy, accessibility (WCAG AA) checklists, design
  tokens in JSON/CSS/Tailwind, page-type blueprints (landing, dashboard, settings,
  auth, list+detail), and a rendered design-QA protocol. Use this skill whenever the
  user mentions UI design, design system, wireframe, mockup, layout, typography, color
  palette, component design, restyle/redesign, "make it look professional/beautiful/
  modern", "why does my UI look bad", landing page design, dashboard design, form
  design, dark mode, accessibility, or design handoff — even if the word "design" never
  appears and they just show a screenshot or CSS to improve. Do NOT use it for building
  complete websites end-to-end (website-creator implements; this skill designs and hands
  off specs), native mobile app UI (mobile-app-designer), game interfaces (gameui-
  designer), slide decks (slides-creator), PDF documents (pdf-creator), or AI-generated
  imagery (image-generator).
---

# Web UI Designer — Interface Craft from Wireframe to Design System

> Interfaces look professional because of discipline — spacing scales, type scales, contrast math, complete states — never because of decoration. This skill is that discipline, enforced.

## 0. Operating Rules (Non-Negotiable)

1. **ALWAYS establish a spacing scale on a 4/8pt grid and use ONLY those values** (4, 8, 12, 16, 24, 32, 48, 64, 96). Why: consistent spacing is the single strongest signal separating professional UI from amateur UI; arbitrary values (7px, 13px, 22px) read as visual noise even when nobody can name why.
2. **ALWAYS build a modular type scale (ratio 1.25 desktop) and use ONLY those sizes.** Why: five sizes that differ by 2px destroy hierarchy; a ratio gives every level a distinct, repeatable voice.
3. **NEVER use color alone to convey state or meaning.** Why: ~8% of men have color-vision deficiency and WCAG 1.4.1 requires a non-color cue — pair color with icon, label, position, or shape, always.
4. **ALWAYS design every interactive component in ALL its states:** default, hover, active/pressed, focus-visible, disabled, loading, plus error and empty where applicable. Why: missing states are where broken UX hides; focus-visible is an accessibility requirement (WCAG 2.4.7), and users spend real time in error and loading states even though mockups never show them.
5. **ALWAYS meet WCAG AA contrast with math, not eyes:** ≥4.5:1 for body text, ≥3:1 for large text (≥24px or ≥18.66px bold) and for UI component boundaries. Why: it is a legal requirement in many jurisdictions, and the eye reliably deceives — verify with the luminance function in §5.6.
6. **DESIGN MOBILE-FIRST:** lay out the 375px screen first, then add complexity at breakpoints. Why: the constraint forces hierarchy decisions (what really matters?); retrofitting mobile onto a desktop design always fails because content was never prioritized.
7. **ALWAYS define design tokens (color, spacing, radius, shadow, type, z-index) BEFORE building components.** Why: components designed before tokens drift apart within weeks; tokens are what make dark mode and theming a remap instead of a redesign.
8. **NEVER decorate over broken hierarchy.** Whitespace, size, weight, and position do the communicating; gradients, shadows, and glassmorphism come last — or never. Why: a hierarchy failure cannot be fixed with ornament; it can only be fixed by deciding what matters.
9. **ALWAYS give interaction feedback within 100ms** (state change, spinner, or optimistic update). Why: perceived performance is psychological; below ~100ms an interface feels instant, above it users doubt the tap registered and double-tap.
10. **Inventory real content BEFORE laying out.** Why: a headline that fits at 3 words breaks at 12; real column counts change tables; placeholder-length content guarantees a redesign.
11. **NEVER use pure black text (#000) on white, or large low-contrast gray areas on dark backgrounds.** Why: maximum contrast vibrates at large sizes (#111–#1a1a1a reads better), and dark themes need elevated surfaces (#1a1a1a on #121212), not gray soup at 3:1.
12. **ALWAYS finish with a rendered QA pass at 375px, 768px, and 1440px** plus the keyboard walk and contrast audit (§9.5). Why: layout bugs live at the edges and at real viewports; a design that was never rendered is a design that was never checked.

## 1. When to Use / When Not To

**Use this skill when the task involves:**
- Designing or redesigning any web interface, screen, or page.
- Creating or auditing a design system, component library, or token set.
- Improving the look of existing UI ("make it professional", screenshot critique, CSS polish).
- Specifying components for handoff to a developer (or to website-creator).
- Choosing layout, type, color, spacing, or interaction patterns.
- Making an interface accessible (WCAG) or responsive.
- Deciding dark mode, theming, or density strategies.

**Do NOT use when the task is:**
- Building/deploying the full website end-to-end → **website-creator** (this skill hands it tokens + specs).
- Native mobile app screens → **mobile-app-designer** (platform conventions differ).
- Game interfaces, HUDs, gamepad menus → **gameui-designer**.
- Slide decks → **slides-creator**; PDF documents → **pdf-creator**.
- Charts for data analysis → **data-visualization** (this skill covers chart *styling* only after chart *choice*).
- AI-generated images → **image-generator**.

| The user asks for... | Correct skill | This skill's role |
|---|---|---|
| "Build me a landing page" | website-creator | Design spec, tokens, component states first |
| "This dashboard looks bad, fix it" | webui-designer | Full ownership: diagnose, re-spec, hand off |
| "Mobile app screens for my idea" | mobile-app-designer | None (different platform grammar) |
| "Game inventory screen" | gameui-designer | None (different physics: gamepad, distance) |
| "Make my form accessible" | webui-designer | Full ownership |

## 2. Core Concepts & Mental Models

**Visual hierarchy is ranking.** Every view answers one question first: size, weight, color, position, and whitespace tell the eye the reading order. Exactly ONE primary action per view (one filled button); everything else is secondary (outline) or tertiary (ghost/text). Two competing primary buttons = no primary button.

**The 4/8pt grid.** All spacing and sizing snap to multiples of 4 (half-steps for icons and fine gaps), typically 8 for layout. Why 8: it divides cleanly, matches common screen densities, and produces the recognizable rhythm of professional products. The scale is a vocabulary: if a gap needs 22px, the design is wrong, not the scale.

**Proximity beats boxes (Gestalt).** Related items sit close (8px), unrelated sit far (24px+); add a card border/background ONLY when spacing alone cannot express the grouping. Cards around everything = boxes around nothing.

**Affordance and signifiers.** Clickable things must look clickable (filled or outlined, cursor, hover); interactive areas ≥44×44px on touch. Signifiers (what shows it can be used) must survive flat design — if everything is flat and gray, nothing is clickable.

**Consistency is a feature.** The same object looks and behaves the same everywhere (same button = same radius, same height, same states). Inconsistency taxes users on every screen; consistency compounds.

**Progressive disclosure.** Show the 20% of controls used 100% of the time; hide the rest behind "Advanced", accordions, or secondary screens. Density is not sophistication; it is taxation.

**Content shapes layout.** Design serves the content's real shape (headline lengths, table columns, image ratios). This is why rule 10 exists — and why "lorem-ready" layouts are a bug, not a deliverable.

**Tokens over literals.** Never hardcode `#3B82F6` or `16px` in a component; reference `--color-accent` and `--space-4`. Literal values scattered across components are why themes and dark modes fail.

## 3. Mandatory Workflow

**Step 1 — Brief.** Users (who, context, device), jobs to be done, success metric (signup rate, task time, error rate), constraints (brand, stack, existing system). MUST be written down; "modern and clean" is not a brief — "B2B finance team, desktop-first, trust + speed, reduce support tickets about exports" is.

**Step 2 — Content inventory.** Real copy (headlines, labels, errors), real data shapes (field lists, column counts, value ranges), and the empty/error/loading variants of each screen. NEVER skip: this step is what prevents redesign-after-real-content.

**Step 3 — Information architecture.** Screen list + what each screen must accomplish + entry/exit points. One sentence per screen: "This screen exists so the user can ___." A screen without a sentence gets cut.

**Step 4 — Wireframe (lo-fi, grayscale, no brand).** Boxes, hierarchy, one primary action per screen, mobile-first. NO color, NO fonts, NO logos yet. Why: color hides structural problems; grayscale wireframes expose them.

**Step 5 — Design tokens.** Build the palette with contrast math (§4.3), the type scale (§4.2), spacing, radius, shadow, z-index scales. Deliver as tokens file (§5.1). This is the contract everything else references.

**Step 6 — Component inventory + specs.** List every component the screens need; spec each with anatomy, sizing, and ALL states (§4.4). Two components that "do the same thing" get merged — the inventory exists to dedupe.

**Step 7 — Hi-fi spec / build.** Apply tokens, grid, fluid type (§4.6). If implementing in code: semantic HTML first, tokens as CSS custom properties.

**Step 8 — Handoff.** Tokens file + component spec table (states included) + per-screen blueprints + spacing annotations where non-obvious. "Make it like the mockup" is not a handoff; §5.1–§5.5 are.

**Step 9 — Design QA (mandatory).** Render at 375/768/1440 (§9.5 script), run the §7 checklist, keyboard-walk the flows, audit contrast pairs, walk every component state. Fix → re-render → repeat until zero findings.

## 4. Deep Knowledge Library

### 4.1 Layout & spacing system
**Grid:** 12 columns on desktop (max content width 1200–1440px, centered), 4 columns tablet, 1 column mobile. Gutters 16–24px. Columns are a rhythm aid, not a cage — but odd widths (a 7-column card row) mean the grid was ignored.
**Spacing scale (use these and nothing else):**
| Token | Value | Use for |
|---|---|---|
| space-1 | 4px | icon↔label, chip padding |
| space-2 | 8px | related inline elements, label↔field |
| space-3 | 12px | compact list rows, tight component padding |
| space-4 | 16px | component padding, related-group gap, card padding (min) |
| space-6 | 24px | between groups inside a section, card padding (comfortable) |
| space-8 | 32px | between subsections |
| space-12 | 48px | between major sections |
| space-16/24 | 64/96px | page-region separation, hero padding |
**Rules:** parent padding ≥ child gaps (nested content always sits closer to its siblings than to its container edge); group with 8, separate with 24+; one dominant alignment axis (left for body — never center paragraphs); vertical rhythm in line-height multiples of 4. Whitespace is not wasted space; it is the cheapest hierarchy tool and the first one amateurs delete.

### 4.2 Typography system
**Scale (1.25 ratio, desktop base 16):** 12 caption · 14 secondary · 16 body · 20 h4/emphasis · 25 h3 · 31 h2 · 39 h1 · 49 display. Mobile: same ratios, h1 tops at ~31. NEVER sizes outside the scale (and never more sizes than the scale has).
**Line-height:** body 1.5–1.6; headings 1.1–1.2; buttons/labels 1.2. **Letter-spacing:** large headings −0.01 to −0.02em; NEVER positive tracking on body; uppercase labels +0.04–0.08em.
**Weights & families:** 2 weights per family (400 + 600), 2 families max (one for UI/body, optional display for marketing); always declare a system fallback stack. Body text ≥16px, secondary ≥14px, caption ≥12px — nothing smaller, ever.
**Measure:** body text 45–75 characters per line (≈640–720px max at 16px); NEVER 100%-viewport-width paragraphs.
**Fluid type:** clamp with a mobile floor and desktop ceiling (code in §5.2). **Numerals:** `font-variant-numeric: tabular-nums` in tables, timers, prices — proportional digits make columns dance.

### 4.3 Color system with contrast math
**Structure (build in this order):**
1. **Neutral ramp** (9–11 steps, gray to near-tinted): 0 (page bg) → 100 (surface) → 200 (subtle bg/borders-light) → 300 (strong borders) → 500 (muted text/icons) → 700 (secondary text) → 900 (primary text).
2. **Brand/accent ramp:** 100 (subtle bg) / 500 (solid fills, links) / 600 (hover) / 700 (active) / contrast-safe text-on-accent (usually white — VERIFY 4.5:1, colored buttons with white text fail constantly at 400-level).
3. **Semantic set:** success / warning / danger / info — each with bg, border, text, and icon roles; pair each with a non-color signifier (icon: ✓ ⚠ ⛔ or shape).
**Token naming is semantic, not literal:** `--color-text-secondary`, NOT `--color-gray-700` — because dark mode remaps semantics (secondary text becomes lighter gray) while literals would have to be hunted down everywhere.
**Contrast math (verify pairs, never eyeball):** relative luminance L = 0.2126·R + 0.7152·G + 0.0722·B (linearized channels); ratio = (L1+0.05)/(L2+0.05). Required: body text 4.5:1, large text & UI borders 3:1, disabled is exempt but aim 2:1. Pairs to verify every time: body/surface, secondary/surface, text-on-accent, link/surface, placeholder/surface (aim 4.5 — placeholders must stay readable), focus ring/surface. Working checker in §5.6.
**Distribution 60-30-10:** 60% neutral (backgrounds, text), 30% secondary neutrals/surfaces, 10% accent. Accent marks THE action and key data; when everything is accented, nothing is.
**Dark mode = semantic remap, not inversion:** bg `#121212`, surfaces elevate by lightness (`#1a1a1a`, `#242424`), text `#e6e6e6` primary / `#a0a0a0` secondary, reduce shadow reliance (shadows vanish on dark — use lighter surface + subtle border), desaturate brand colors ~10% (saturated colors vibrate on dark), and images/illustrations may need a dimming layer.

### 4.4 Component specifications (with every state)
**Button.** Variants: primary (one per view) / secondary (outline) / ghost (text) / destructive (danger color, reserved for irreversible). Height 40px compact–48px comfortable; horizontal padding ≥16px; radius = radius token (match the system, don't invent); label verb-first ("Save changes", never "Yes"). States: default / hover (+1 shade bg, 150ms) / active (pressed: −1 shade, scale 0.98 or inset shadow) / focus-visible (2px ring, 2px offset, accent or white-on-dark) / disabled (40–50% opacity, `cursor: not-allowed`, AND explain why nearby when non-obvious) / loading (spinner replaces or precedes label, width LOCKED so layout doesn't jump, click ignored). Touch target ≥44×44 including padding. NEVER: disabled-only form submission without reason text, icon-only buttons without `aria-label`, two primary buttons side by side.
**Text input.** Label ALWAYS visible above (placeholder is NOT a label — it vanishes on focus); optional helper text below in secondary; error message below in danger WITH icon, replacing helper; input height 40–48px; focus = 2px accent ring (not just color change); validate on blur (not per keystroke), validate confirm-fields on submit; never clear user input on error; mark required explicitly (asterisk AND text, or better: mark the rare optional).
**Select / checkbox / radio / toggle.** Native elements restyled where possible (they inherit keyboard/AT behavior for free). Radio groups for ≤5 mutually exclusive options; select for more. Toggle = immediate effect + visible state label ("Notifications: On"), never used for settings requiring a save button. Checkbox list ≥5 items → "Select all" affordance.
**Card.** Padding 16–24; internal hierarchy: title (20) → description (14 secondary) → action area; one emphasized action; hover elevation ONLY if the whole card is clickable (+2px shadow or border accent, 150ms); never nest cards; content decides height, never fixed heights that clip.
**Table.** Row height 48–56px; header sticky + distinct bg; numbers right-aligned + tabular-nums; primary row action visible, secondary in overflow menu (⋯); sortable columns show direction arrows; zebra OR row-borders (never both); empty state with action; dense mode optional (40px rows) for data-heavy tools; on mobile → card-ify (§5.7) or priority-column pattern.
**Navigation.** Top nav: logo left, 5–7 items max, CTA right, active item visually distinct (weight+color or underline, not color alone); sidebar: 240–280px, grouped sections with headers, collapse to icons at ≤1024, drawer at mobile; breadcrumbs when depth ≥3 (trails, not history); current page unclickable.
**Modal.** ONLY for blocking decisions (never for information you can inline); dims backdrop; closes on Esc AND backdrop click EXCEPT destructive flows; focus trap + return focus to trigger on close; buttons: action verb left-of-cancel or stacked full-width mobile; destructive action = danger button + typed confirmation only for severe/irreversible.
**Toast/notification.** Bottom-right desktop / top-center-or-full-width mobile; auto-dismiss 4–8s UNLESS it carries an action (then persist ≥10s or until dismissed); max 3 stacked, queue the rest; always include undo for destructive-adjacent actions; NEVER for critical errors the user must see — use inline or modal.
**Tabs / accordion / stepper.** Tabs: peer content, URL-addressable where possible; accordion: >4 sequential items or long content in limited space, first item default-open; stepper: >3 sequential steps with forward/back + step labels; never tabs inside tabs.
**Skeleton loaders** (shape-matched, shimmer subtle) for anything >1s; spinners only <1s; NEVER a blank flash. **Empty states:** one-line explanation + the exact action that fills it ("No projects yet — Create your first project"); empty states are onboarding, not dead ends. **Tooltip:** delay 300–500ms, dismiss on scroll/Esc, NEVER contains info required to complete the task (tooltips are invisible on touch).

### 4.5 Interaction states & motion
**State matrix — every interactive component gets:**
| State | Visual | Duration |
|---|---|---|
| default | base token styling | — |
| hover | +1 shade bg / border accent | 150ms |
| active/pressed | −1 shade, scale 0.98 or inset | 100ms |
| focus-visible | 2px ring, 2px offset | instant |
| disabled | 40–50% opacity + not-allowed cursor | — |
| loading | spinner, width locked | — |
| error (forms) | danger border + message below | 200ms |
| empty | illustration/one-liner + action | — |
**Motion rules:** animate ONLY transform and opacity (cheap, GPU-composited); entrances ease-out 200–300ms, exits ease-in 150–200ms, movement standard ease; durations ≤300ms (attention), or 300–500ms (large surfaces); NEVER animate layout properties (width/top/margin). Honor `prefers-reduced-motion`: replace transitions with instant state changes or simple opacity fades. Motion communicates causality (what just happened, what responded) — if it communicates nothing, delete it.

### 4.6 Responsive & fluid strategy
**Breakpoints (content-driven, these are defaults):** 640 / 768 / 1024 / 1280. Mobile-first: base styles = small screen; `min-width` queries add complexity.
**Fluid type + spacing with clamp()** (§5.2) — stops maintaining separate mobile/desktop sizes; the type scale breathes with the viewport between floor and ceiling.
**Transformations at breakpoints:** sidebar → drawer ≤1024; multi-column card grids → 2 → 1; table → card list (§5.7); horizontal nav → menu/drawer; form two-column → one; sticky table header → column-priority pattern.
**Touch & pointer:** targets ≥44×44px (with spacing ≥8 between); hover-dependent UI must degrade (tap = first click opens, second activates, or use `<details>`/click-toggles); `pointer: coarse` media query for touch-specific affordances.
**Non-negotiable tests:** 200% browser zoom keeps every flow usable (WCAG 1.4.4); landscape phone doesn't trap content behind sticky headers; 320px (iPhone SE-class) shows no horizontal scroll.

### 4.7 Accessibility (WCAG 2.1 AA) — the working checklist
**Perceivable:** every informative image has alt (decorative: `alt=""`); contrast pairs verified (§4.3); text resizes to 200% without loss; no information by color alone; form fields labeled (visible labels, `for`/`id`).
**Operable:** entire flow keyboard-only (Tab/Shift+Tab/Enter/Space/arrows); visible focus on every focusable element (never `outline: none` without replacement); focus order follows visual/DOM order; skip-to-content link on pages with repeated nav; modals trap focus and return it; targets ≥44px; no keyboard traps.
**Understandable:** `lang` attribute set; errors identified in text next to the field (`aria-describedby`) and announced; consistent naming for the same thing across screens; no session timeout without warning/extension.
**Robust:** semantic HTML first (`button` not `div onclick`, `nav`/`main`/`header` landmarks, real `table` for data); ARIA only where HTML can't express it (a `div` with `role="button"` + `tabindex="0"` + keydown handling is worse than just `<button>`); icon-only buttons get `aria-label`.
**The 10-minute audit order:** unplug the mouse → grayscale (color-only signals?) → zoom 200% → Tab through (order, focus visibility, traps) → run the contrast checker on text/borders → screen-reader smoke test on the key flow.

### 4.8 Design tokens
Single source of truth; every component references tokens, never literals. Structure: color (semantic roles per §4.3) · spacing · radius (4/8/12/16/full) · shadow (sm/md/lg) · typography (size/weight/line-height per level) · z-index scale (dropdown 1000, sticky 1020, overlay 1040, modal 1050, toast 1080 — never arbitrary 99999s) · breakpoints. Full working CSS + JSON + Tailwind mapping in §5.1/§5.5. Naming rule: `{category}-{role}-{variant?}`; if a token name contains a color word ("gray", "blue"), it is a primitive — keep primitives in a separate layer that ONLY tokens reference, so re-theming touches one file.

### 4.9 Page-type blueprints
**Landing page:** hero (headline ≤9 words + subhead ≤2 lines + ONE primary CTA + product visual) → social proof (logos/metrics) → benefits 3-col (icon + title + 2 lines) → how-it-works (3 steps) → testimonial with attribution → pricing (3 tiers, recommended tier visually emphasized but same height) → FAQ (accordion, 5–8 real objections) → final CTA → footer (links, legal, minimal).
**Dashboard/app shell:** sidebar (groups, collapse) + topbar (search, account) + content: KPI cards row (4 max, trend indicator + delta) → primary chart (one message) → table (filters above, actions in rows); density toggle for data-heavy users; every empty widget states why it's empty.
**Settings:** grouped sections (Account / Notifications / Security), each item = label + description + control on one row; decide save model explicitly — auto-save with "Saved" confirmation, or explicit Save bar that appears on change (never silent data loss on leave).
**Auth:** single centered column ≤400px, logo, social buttons first, separator, email+password, clear error text, password rules visible before typing, link to help.
**List + detail:** master list (search + filters left/top, rows with the 3 identifying fields) + detail pane (desktop) or pushed screen (mobile); selected row state must survive sort/filter.
**404/error/offline:** what happened in plain words + 1–2 recovery actions (home, search, retry) + the doggo/illustration if brand allows — never a dead "Error" with no exit.

### 4.10 Anti-patterns gallery
Placeholder-as-label (vanishes on focus) → visible labels. Center-aligned paragraphs → left-align. Light-gray 12px text on white → 16px at 4.5:1. Pure #000 on #fff at display sizes → #111–#1a1a1a. Shadow soup (4 depths on one screen) → 3-level elevation scale. Radius roulette (4/6/10/16/24 mixed) → radius tokens. 5 fonts / 3 weights-of-3-families → 2 families, 2 weights each. Hover-only menus (invisible on touch/keyboard) → click/tap + focus support. Auto-rotating hero carousels → static hero (slide 2+ gets ~1% of clicks). Infinite scroll with no footer → paginate or load-more. Modal over modal over modal → one blocking layer, ever. Disabled submit with no explanation → reason text next to it. ALL-CAPS body text → caps only for short labels with tracking. Toast for a critical billing error → inline banner/modal. Gradient-on-gradient-on-glass → restraint (accent exists to be scarce).

## 5. Code & Tool Templates

### 5.1 tokens.css — the complete starter token set
```css
:root {
  /* primitives (reference layer) */
  --gray-0:#ffffff; --gray-100:#f5f6f8; --gray-200:#e9ebee; --gray-300:#d5d9e0;
  --gray-500:#6b7280; --gray-700:#374151; --gray-900:#111827;
  --accent-100:#e8f0fe; --accent-500:#2563eb; --accent-600:#1d4ed8; --accent-700:#1e40af;
  /* semantic (components reference ONLY these) */
  --color-bg:var(--gray-0); --color-surface:var(--gray-100);
  --color-text-primary:var(--gray-900); --color-text-secondary:var(--gray-700);
  --color-text-muted:var(--gray-500); --color-border:var(--gray-200);
  --color-accent:var(--accent-500); --color-accent-hover:var(--accent-600);
  --color-accent-active:var(--accent-700); --color-on-accent:#ffffff;
  --color-danger:#dc2626; --color-success:#16a34a; --color-warning:#d97706;
  /* spacing 4/8pt */ --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
  --space-6:24px; --space-8:32px; --space-12:48px; --space-16:64px;
  /* radius / shadow / z-index */
  --radius-sm:4px; --radius-md:8px; --radius-lg:12px; --radius-full:9999px;
  --shadow-sm:0 1px 2px rgb(17 24 39 / 0.06);
  --shadow-md:0 4px 12px rgb(17 24 39 / 0.08);
  --shadow-lg:0 12px 32px rgb(17 24 39 / 0.12);
  --z-dropdown:1000; --z-sticky:1020; --z-overlay:1040; --z-modal:1050; --z-toast:1080;
}
[data-theme="dark"] { /* semantic remap — primitives untouched */
  --color-bg:#121212; --color-surface:#1a1a1a;
  --color-text-primary:#e6e6e6; --color-text-secondary:#a0a0a0; --color-text-muted:#787878;
  --color-border:#2e2e2e; --color-accent:#60a5fa; --color-on-accent:#0b1220;
}
```

### 5.2 Fluid type with clamp()
```css
h1 { font-size: clamp(1.75rem, 1.2rem + 2.2vw, 2.4375rem); line-height: 1.15; letter-spacing: -0.02em; } /* 28 → 39px */
h2 { font-size: clamp(1.5rem, 1.15rem + 1.4vw, 1.9375rem); line-height: 1.2; }
body { font-size: clamp(1rem, 0.95rem + 0.2vw, 1.0625rem); line-height: 1.55; } /* 16 → 17px */
.measure { max-width: 68ch; } /* reading measure, not pixels */
```

### 5.3 Button component — all states
```css
.btn {
  display:inline-flex; align-items:center; justify-content:center; gap:var(--space-2);
  min-height:44px; padding:0 var(--space-4); border-radius:var(--radius-md);
  font: 600 1rem/1.2 inherit; cursor:pointer; border:1px solid transparent;
  transition: background-color 150ms ease, transform 100ms ease, box-shadow 150ms ease;
}
.btn:focus-visible { outline:2px solid var(--color-accent); outline-offset:2px; }
.btn:active { transform: scale(0.98); }
.btn[disabled] { opacity:0.45; cursor:not-allowed; }
.btn--primary { background:var(--color-accent); color:var(--color-on-accent); }
.btn--primary:hover:not([disabled]) { background:var(--color-accent-hover); }
.btn--primary:active:not([disabled]) { background:var(--color-accent-active); }
.btn--secondary { background:transparent; color:var(--color-accent); border-color:var(--color-accent); }
.btn--secondary:hover:not([disabled]) { background:var(--accent-100); }
.btn--danger { background:var(--color-danger); color:#fff; }
.btn--loading { position:relative; color:transparent !important; pointer-events:none; }
.btn--loading::after {
  content:""; position:absolute; width:1rem; height:1rem; border-radius:var(--radius-full);
  border:2px solid currentColor; border-top-color:transparent; animation:spin 700ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

### 5.4 Form field pattern with validation UI
```html
<div class="field">
  <label for="email">Work email <span aria-hidden="true">*</span><span class="visually-hidden">(required)</span></label>
  <input id="email" name="email" type="email" required aria-describedby="email-help email-error"
         aria-invalid="false" autocomplete="email">
  <p id="email-help" class="field__help">Use your company address.</p>
  <p id="email-error" class="field__error" hidden>⚠ Enter a valid email, e.g. name@company.com</p>
</div>
```
```css
.field input { min-height:44px; border:1px solid var(--color-border); border-radius:var(--radius-md); }
.field input:focus-visible { outline:2px solid var(--color-accent); outline-offset:1px; }
.field input[aria-invalid="true"] { border-color:var(--color-danger); }
.field__error { color:var(--color-danger); } /* icon + text: never color alone */
/* JS: on blur validate; on error set aria-invalid="true", unhide #email-error, hide help. */
```

### 5.5 Tailwind mapping (tokens → theme)
```js
// tailwind.config.js — components then use classes like bg-surface text-secondary p-4
module.exports = { theme: { extend: {
  colors: { bg:"var(--color-bg)", surface:"var(--color-surface)",
    primary:"var(--color-text-primary)", secondary:"var(--color-text-secondary)",
    accent:{ DEFAULT:"var(--color-accent)", hover:"var(--color-accent-hover)" },
    danger:"var(--color-danger)" },
  borderRadius: { md:"var(--radius-md)", lg:"var(--radius-lg)" },
  boxShadow: { sm:"var(--shadow-sm)", md:"var(--shadow-md)", lg:"var(--shadow-lg)" },
}}}
```

### 5.6 Contrast checker (working)
```python
def lum(hex_color: str) -> float:
    r, g, b = (int(hex_color.lstrip('#')[i:i+2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(r), lin(g), lin(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(fg: str, bg: str) -> float:
    l1, l2 = sorted((lum(fg), lum(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)

print(contrast("#374151", "#ffffff"))  # 10.4 → PASS body text
print(contrast("#ffffff", "#60a5fa"))  # 2.3  → FAIL on-accent: darken accent or use dark text
```
Run this for EVERY claimed pair before shipping a palette. A palette without printed ratios is an unverified palette.

### 5.7 Table → card pattern (responsive)
```css
@media (max-width: 640px) {
  .table-responsive thead { display:none; }
  .table-responsive tr { display:block; padding:var(--space-4); border:1px solid var(--color-border); border-radius:var(--radius-md); margin-bottom:var(--space-2); }
  .table-responsive td { display:flex; justify-content:space-between; gap:var(--space-4); }
  .table-responsive td::before { content:attr(data-label); font-weight:600; color:var(--color-text-secondary); }
}
```

## 6. Decision Tables

### 6.1 Layout engine
| The region is... | Use | Why |
|---|---|---|
| One-axis flow (row or column) | Flexbox | Natural sizing, gaps, wrapping |
| Two-dimensional page frame | Grid | Simultaneous row+column control |
| Card/masonry collection | Grid + `repeat(auto-fill, minmax(240px,1fr))` | Responsive without media queries |
| Centering anything | Flex `align-items/justify-content: center` | Not margin hacks |
| Component adapting to ITS container | Container queries | Reusable in sidebar AND full width |

### 6.2 Units
| Context | Unit | Why |
|---|---|---|
| Font sizes, spacing | rem | Honors user's browser setting (a11y) |
| Borders, radii, shadows | px | Must not scale with user font size |
| Line length cap | ch | The unit OF text measure |
| Component width | % / minmax / clamp | Fluid inside the grid |
| Media (img/video) | intrinsic + max-width:100% | Never fixed both dimensions |

### 6.3 Surface & feedback choice
| Situation | Use | Not |
|---|---|---|
| Blocking decision (delete project?) | Modal | Toast |
| Transient success ("Saved") | Toast | Modal |
| Error tied to a field | Inline under field | Toast |
| System-wide error (billing failed) | Banner + email | Toast |
| Extra detail on hover (desktop, optional) | Tooltip | Modal |
| >4 sequential steps | Stepper | Accordion |
| Peer content, same level | Tabs | Accordion |
| Long content, limited space | Accordion (first open) | Tabs (too many) |

### 6.4 Form controls
| Options | Control |
|---|---|
| 2–5, mutually exclusive, always visible | Radio group |
| >5, mutually exclusive, space-tight | Select |
| 1 binary, effect immediate | Toggle (with state label) |
| 1 binary, effect needs "Save" | Checkbox |
| 2–5 binary filters | Checkbox group + "Select all" |

## 7. Quality Checklist

- [ ] Spacing uses ONLY scale values (4/8/12/16/24/32/48/64/96) — no 7px, 13px, 22px anywhere
- [ ] Type uses ONLY scale sizes; body ≥16px; nothing below 12px
- [ ] Body text measure ≤75ch; paragraphs left-aligned
- [ ] Exactly ONE primary action per view; destructive styled distinctly
- [ ] Every interactive component has: default, hover, active, focus-visible, disabled, loading (+ error/empty where applicable) — designed AND implemented
- [ ] Focus-visible ring present on every focusable element; focus never `outline: none` without replacement
- [ ] Contrast ratios PRINTED and passing: 4.5:1 body text, 3:1 large text & UI borders (checker §5.6 output attached)
- [ ] No color-only state: every semantic color paired with icon/text/shape
- [ ] Labels visible on every input; placeholders never used as labels; errors inline with `aria-describedby` + `aria-invalid`
- [ ] Touch targets ≥44×44px with ≥8px spacing; hover-only patterns have tap/keyboard fallbacks
- [ ] Keyboard-only walk of every core flow passed; modals trap + return focus
- [ ] 200% zoom usable (WCAG 1.4.4); 320px shows no horizontal scroll
- [ ] Tokens file exists; components reference tokens, zero hardcoded literals (grep-verified)
- [ ] Dark mode is a semantic remap, surfaces elevate by lightness, colors desaturated ~10%
- [ ] Motion only on transform/opacity, ≤300ms (≤500ms large), `prefers-reduced-motion` honored
- [ ] Loading: skeletons >1s, spinners <1s, no blank flashes; empty states include the filling action
- [ ] Toasts: max 3, auto-dismiss logic per §4.4, critical errors NOT in toasts
- [ ] Rendered QA done at 375/768/1440 with screenshots inspected (§9.5) — zero findings

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---------|---------|-----|
| 1 | Designing desktop-first | Mobile is a broken afterthought | Re-do hierarchy at 375px first (Rule 6) |
| 2 | Placeholder-only labels | Users forget what the field was | Visible labels; placeholder = example only |
| 3 | Eyeballed contrast | "Looks fine" fails the checker at 3.8:1 | Run §5.6 on every pair; print ratios |
| 4 | Color-only signals (red = error) | Colorblind users miss errors entirely | Icon + text + color, always |
| 5 | Missing states | Broken hover/focus/loading discovered in QA — or in production | Spec all 8 states per component (§4.4) before build |
| 6 | Hardcoded values everywhere | Dark mode/theming = full rewrite | Tokens first; grep for literals |
| 7 | Decoration over hierarchy | Gradients on a page users can't scan | Grayscale test: if hierarchy fails without color, fix structure |
| 8 | Giant gray text fields (placeholder styling) | Placeholder looks like pre-filled data | Style placeholder at muted level; never primary-text color |
| 9 | Carousel hero | Slide 2+ ignored; CTA unseen | Static hero with one CTA |
| 10 | Modal for everything | Modal fatigue; flows blocked | Decision table §6.3; toasts/inline for non-blocking |
| 11 | Disabled submit, silent why | User stares, retries, leaves | Explain next to the button what's missing |
| 12 | Infinite scroll with no footer | Footer/legal unreachable | Paginate or "Load more" button |
| 13 | Animate-all-the-things | Janky width/top animations, motion sickness | transform/opacity only; ≤300ms; reduced-motion honored |
| 14 | 12px "subtle" text | Nobody reads the fine print (because they can't) | Min 12px for legal captions; 14–16 for anything actionable |

## 9. Advanced Techniques

### 9.1 Perceptual color ramps
HSL ramps produce steps whose *perceived* lightness jumps unevenly (yellow looks far lighter than blue at 50% lightness). Build ramps in a perceptual space — OKLCH (native `oklch()` in modern CSS) — with constant lightness steps per ramp row, so `--gray-300` is the same perceptual step from 200 everywhere, and accent-500 keeps its lightness when hue changes. Practical rule: generate the ramp once in OKLCH, then hard-freeze the hex values into primitives — components must never call `oklch()` with live math.

### 9.2 Elevation system
Shadows = key light + ambient: `box-shadow: 0 1px 2px rgb(0 0 0/0.06), 0 1px 3px rgb(0 0 0/0.10)` (raised), scaling y-offset/blur/opacity with depth — and shadow communicates ONE thing: vertical stacking. Never mix "error = red shadow" into the elevation scale. Three levels only (rest / raised / overlay). Dark mode: shadows stop working → elevation by surface lightness + 1px lighter border (§4.3).

### 9.3 Data-dense interfaces
For dashboards/tables with 10+ columns: density toggle (comfortable 56px rows ↔ compact 40px); fixed first column with scroll; column priority (which 3 columns identify a row? those survive mobile); keyboard-first patterns (command palette ⌘K, `/` to search, `j/k` rows) for power users; `tabular-nums`, right-aligned numerics, thousands separators; virtualized lists beyond ~200 rows. Density is a power-user feature — default stays comfortable.

### 9.4 Design-to-dev handoff discipline
The handoff artifact is the TOKEN FILE + COMPONENT STATE TABLE, not screenshots with redlines. Redlines are a smell: if spacing/size/type come from tokens, the developer reads the token name, not "24px (but 22px on this one)". Deliver: tokens.css/tokens.json (§5.1), per-component state matrix (§4.5 table), per-screen blueprint with content inventory, and the acceptance checklist (§7). Acceptance = QA renders pass, not "looks about right".

### 9.5 Rendered design QA protocol
```bash
npx playwright screenshot --viewport-size=375,812  URL qa-375.png
npx playwright screenshot --viewport-size=768,1024 URL qa-768.png
npx playwright screenshot --viewport-size=1440,900 URL qa-1440.png
```
Inspect all three; then walk: keyboard-only flow, tab order, focus visibility, disabled/loading/error states forced manually (devtools), contrast check on text/borders, `prefers-reduced-motion` emulation, 200% zoom. Log findings as: viewport → element → issue → token/state that fixes it. Fix the SOURCE (tokens/spec), never one-off inline styles.

### 9.6 Perceived performance design
Optimistic UI for low-risk writes (like/save: update instantly, roll back with toast on failure); skeletons shape-matched to content (no layout shift); prioritize the LCP element (hero text/image loads first, analytics fonts after); button loading states lock width; progress bars only when duration is knowable (>2s operations get stages, not a fake bar). The interface's job during waiting is to answer "did it hear me?" within 100ms and "is it working?" continuously.

## 10. Quick Reference Card

**The 9-step workflow:** brief → content inventory → IA → grayscale wireframe (mobile-first) → tokens with contrast math → component inventory + all states → hi-fi/build → handoff (tokens + state matrix) → rendered QA at 375/768/1440.

**Scales:** spacing 4/8/12/16/24/32/48/64/96 · type 12/14/16/20/25/31/39/49 · radius 4/8/12/16/full · z 1000/1020/1040/1050/1080.

**Contrast law:** 4.5:1 body · 3:1 large text & borders · verified with the checker, never eyes · never color alone.

**State law:** default/hover/active/focus-visible/disabled/loading/error/empty — all eight, every interactive component.

**Motion law:** transform+opacity only · 150–300ms · ease-out in, ease-in out · reduced-motion honored · if it communicates nothing, delete it.

**Component laws:** one primary button per view · visible labels always · modals for blocking decisions only · skeletons for >1s · empty states carry the action · touch targets ≥44px.

**Handoff law:** tokens + state matrix + blueprints + acceptance checklist. Never "make it like the mockup."

