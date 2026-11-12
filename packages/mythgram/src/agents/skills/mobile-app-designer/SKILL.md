---
name: mobile-app-designer
description: >
  Mobile UI/UX design specialist that takes a product idea from first research
  to a developer-ready design specification. It runs the full design thinking
  loop (empathize, define, ideate, prototype, test), writes personas and JTBD
  problem statements, produces user flows with error paths, journey maps with
  emotion curves, information architecture with card sorting, low-fidelity
  wireframes with numbered annotations, and a complete design system with real
  values (8pt spacing grid, 1.25 modular type scale, 60-30-10 color split,
  WCAG AA 4.5:1 contrast, radius and elevation scales, all 8 component states).
  It also delivers iOS HIG vs Material 3 guidance, navigation pattern
  selection, thumb-zone-ergonomic screen blueprints (onboarding, auth, feed,
  list+detail, search, settings, empty/error/loading states), accessibility
  and dark mode review, micro-interaction and haptics specs, and a full handoff
  package (token JSON, measurements, 1x/2x/3x asset list). Use this whenever
  the user says "design my app", "make wireframes", "create the onboarding
  flow", "map the user journey", "pick a navigation pattern", "build a design
  system", "what should this screen look like", "make it accessible",
  "review my app's UX", or "prepare the app for design handoff". It owns the
  entire pre-code design phase of a mobile product. Do NOT use it to write
  application code — that is mobile-app-creator's job; for websites use
  website-creator; for games use game-creator.
---

# Mobile App Designer

> Turn raw product ideas into validated, developer-ready mobile UI/UX: research, flows, wireframes, design systems, and platform-correct screen specs.

## 0. Operating Rules (Non-Negotiable)

1. ALWAYS run the phases in order: research → define → flows → lo-fi wireframes → usability test → design system → hi-fi. NEVER start with hi-fi visuals. Why: polish hides structural flaws; a beautiful screen built on a broken flow must be redrawn from zero, which doubles the work and destroys stakeholder trust.
2. NEVER design a screen without a named user task attached to it. Why: screens without jobs accumulate filler; every element must earn its place by serving a task from the flow map.
3. MUST guarantee touch targets ≥ 44×44pt (iOS) / 48×48dp (Android) with ≥ 8pt/8dp between adjacent targets. Why: sub-minimum targets are the top cause of mis-taps found in usability tests and a hard WCAG 2.5.5 (AAA 44px) concern.
4. MUST keep text contrast ≥ 4.5:1 (≥ 3:1 for text ≥ 24px or 19px bold) and NEVER signal meaning by color alone — always pair color with an icon, label, or position. Why: roughly 8% of men have color-vision deficiency, and outdoor glare destroys subtle palettes.
5. MUST define all 8 component states — default, hover (tablet/web), pressed, focus, disabled, loading, empty, error — for every interactive component. Why: the missing states are exactly where implementations break and QA ticket counts explode.
6. NEVER exceed 5 items in a bottom tab bar and NEVER make a hamburger drawer the only navigation. Why: five or fewer tabs stay memorable and thumb-reachable; hidden navigation measurably reduces feature discovery and daily engagement.
7. ALWAYS design the empty, error, and loading states of every screen, not just the happy path. Why: for a new user, the empty state IS the first impression of most screens; an unhandled error state is where trust dies.
8. MUST use skeleton placeholders for content-area loading; reserve spinners only for in-place actions under ~2 seconds. Why: skeletons communicate structure and score ~15–20% better on perceived speed than spinners.
9. NEVER force registration before the user has received value. Why: registration-before-value is a leading cause of first-session abandonment; prove value first, then ask for identity.
10. MUST produce a handoff package before any code: token JSON, per-screen measurements, asset export list (1x/2x/3x), and a component sheet showing all states. Why: a design without a spec is re-interpreted — wrongly — by every developer who touches it.
11. MUST run the full Design QA checklist (Section 7) on real devices at the smallest and largest supported sizes before approving any screen. Why: mockups hide truncation, notch overlap, and keyboard collision; only real devices reveal them.
12. ALWAYS validate with 5 participants per usability round, then fix before recruiting more. Why: five users surface ~85% of usability problems; testing beyond five before fixing wastes budget on duplicates.

## 1. When to Use / When Not To

Use this skill when the task is any part of the mobile design phase:
- "Design my app's UI/UX", "make wireframes", "redesign these screens"
- Choosing a navigation model, information architecture, or sitemap
- Creating a design system, tokens, color/typography/spacing scales
- Specifying onboarding, auth, feed, search, settings, or empty/error/loading states
- Accessibility review (dynamic type, screen reader labels, contrast) and dark mode mapping
- Preparing developer handoff (tokens, measurements, asset exports) or running design QA

Do NOT use this skill when:
- The deliverable is working code → that is **mobile-app-creator**'s job
- The target is a website or web app → **website-creator**
- The product is a game (or game-like UI loops) → **game-creator**
- The need is generated imagery, icons, or illustrations → image-generation

| Request contains | Route to |
|---|---|
| "Build the React Native / Flutter screens", "ship to TestFlight" | mobile-app-creator |
| "Landing page", "responsive site", "SEO" | website-creator |
| "Game loop", "levels", "physics" | game-creator |
| "Wireframes", "journey map", "design tokens", "usability test" | **mobile-app-designer** (this skill) |
| Both design and code requested | Run this skill first, hand its output to mobile-app-creator |

## 2. Core Concepts & Mental Models

- **Design thinking loop**: empathize → define → ideate → prototype → test. It is a loop, not a line: every test result sends you back one phase. NEVER skip empathize (research) — unvalidated assumptions are the #1 root cause of failed products.
- **Jobs To Be Done (JTBD)**: users "hire" the app for a job. Format: *When [situation], I want to [motivation], so I can [outcome]*. Example: "When I finish a workout, I want to log it in two taps, so I can keep my weekly streak."
- **Persona + problem statement**: exactly one primary persona for v1, three JTBD statements, and one problem statement: "[Persona] needs a way to [need] because [insight]."
- **Fitts's Law**: time to hit a target grows with distance and shrinks with size. Consequence: primary actions go bottom-center/bottom-right (thumb arc), large, and destructive actions go where mis-taps are hard.
- **Hick's Law**: decision time grows with the number of options. Consequence: chunk menus (5–9 items), use progressive disclosure, hide advanced options behind "More".
- **3-tap guideline**: any core task should be reachable in about 3 taps. Treat it as a heuristic, not a law — 2 wide levels beat 3 cramped ones when content demands it.
- **Thumb zone**: the comfortable reach arc at the bottom of the screen. Zone map (relative to one-handed phone use): natural arc = bottom third; stretch = middle third; hard = top third. Tab bars, primary CTAs, and list actions live in the natural arc; destructive or rarely used controls live up top.
- **Progressive disclosure**: show the 20% of controls used 80% of the time; reveal the rest on demand.
- **Recognition over recall**: show options (menus, recent searches, suggestions) instead of forcing users to remember syntax or paths.
- **Peak–end rule**: users judge an experience by its peak moment and its ending. Design the "wow" peak (first success moment) and a clean, reassuring ending (confirmation, undo offer) deliberately.
- **Design debt is compounding**: every unstyled state, unmeasured spacing, and ad-hoc hex code added now costs more later. Tokens are the interest-rate fix.

## 3. Mandatory Workflow

1. **Research (empathize).** Run 5+ user interviews or surrogate research (app-store reviews of 3 competitors — mine 1-star reviews for pain themes; forum/Reddit threads). Output: a ranked top-5 pain list. MUST write it down; MUST anchor every later decision to it. Why: unverifiable assumptions poison every downstream artifact.
2. **Define.** Produce 1 primary persona, 3 JTBD statements, 1 problem statement, and 3–5 measurable success metrics (e.g., "task creation in < 15s on first run"). NEVER proceed without a written problem statement.
3. **Ideate.** Crazy 8s: 8 rough concepts in 8 minutes, converge as a group or self-review against the pain list. Then prioritize features with **MoSCoW** (Must/Should/Could/Won't). MUST produce an explicit cut list — features officially OUT of v1. Why: the cut list is the only durable defense against scope creep.
4. **Information architecture.** Run an open card sort (20–30 content cards, users group and label them) for new IA, or a closed sort to validate an existing taxonomy. Build the sitemap; pick the navigation model using the Section 6 table. NEVER exceed 4 levels of depth without evidence.
5. **User flows.** One flow per critical task (signup, core loop, purchase, recovery). Use the notation in 4.2. MUST include error paths and back-navigation; a flow without error paths is fiction.
6. **Journey map.** Stages awareness → onboarding → habit → churn, with an emotion curve (1–5 per stage). Identify the two lowest dips and design specific fixes for them. Why: the dips are where users leave.
7. **Lo-fi wireframes.** Monochrome boxes per the 4.5 conventions, numbered callouts, no branding, no color. Why: color and polish trigger aesthetic debate exactly when the discussion must be structural.
8. **Test the flows.** 5 participants, task-based, think-aloud, on real phones (paper or a tool like Figma/Balsamiq exports). Fix defects, re-test only failed tasks. NEVER argue with a confused participant — confusion is data.
9. **Design system.** Tokens first (color, type, spacing, radius, elevation — values in 4.6), then a component sheet for the top ~10 components with all 8 states each. NEVER invent one-off values per screen; every value must come from a token.
10. **Hi-fi screens.** Only after flows are validated. Apply platform guidelines (4.7), thumb-zone placement (4.8), and the screen blueprints (4.9).
11. **Handoff.** Deliver: token JSON (5.1), measurements (spacing/type as pt/dp), asset export list at 1x/2x/3x, component sheet, and flow maps. Why: this package is the contract the developer implements against.
12. **Design QA.** Walk every screen through Section 7 on real devices — smallest and largest supported, light and dark, RTL if shipped. Approve only at 100% checklist pass.

## 4. Deep Knowledge Library

### 4.1 Research & Definition Toolkit

- **Interview protocol**: 5 open questions maximum; ask about past behavior, never hypotheticals ("tell me about the last time you…", never "would you use…"). Record verbatim quotes — they become evidence in stakeholder debates.
- **JTBD statement format**: *When [situation], I want [motivation], so I can [outcome]*. Write one per critical scenario; the core flow must serve JTBD #1.
- **Pain ranking**: score each pain by frequency (how often it occurs) × severity (how much it hurts). Build what scores highest, not what is easiest.
- **Competitive teardown grid**: 3 competitors × (onboarding steps, nav model, core-loop taps, monetization, 1-star review themes). Note the conventions users already know — you must beat competitors on value, not on novelty of navigation.
- **Crazy 8s**: fold a sheet into 8 boxes, 8 minutes, one concept per box, quantity over quality. Converge by dot-voting against the pain list.
- **MoSCoW**: Must (v1 dies without it), Should (v1 hurts without it), Could (nice), Won't (cut list). A healthy v1 has 5–9 Must items. More than that means the cut list was fictional.

### 4.2 User Flows: Notation & Rules

Notation (keep it consistent across the project):
- **Rounded rectangle** = entry/exit point (app launch, push tap, deep link)
- **Rectangle** = screen
- **Diamond** = decision (permissions granted? logged in?)
- **Cylinder** = data store/API call
- **Solid arrow** = forward path; **dashed arrow** = error/back path

Rules:
- MUST include: entry point, happy path, every error path, and exit points. A flow for "sign up with email" MUST show invalid email → inline error, existing account → "log in instead?" offer, network failure → retry state.
- MUST label every diamond with the condition and both branch outcomes.
- MUST mark where system dialogs appear (permission prompts) — these are not designable surfaces, so design the **pre-prompt rationale screen** that precedes them.
- Keep one flow per diagram. Cross-reference with node IDs (F1, F2…) instead of spaghetti arrows.

### 4.3 Journey Maps & Emotion Curves

Standard stages: **awareness → onboarding → first success → habit → churn risk**. For each stage capture: what the user is doing, touchpoints (screens, emails, notifications), emotion score 1–5, and the pain causing any dip. The deliverable is the **emotion curve** plus two designed fixes at the deepest dips. Typical dips and fixes: onboarding overwhelm → progressive disclosure + skip; first-use confusion → empty-state guidance with one CTA; day-3 drop-off → well-timed, value-carrying notification (never "come back!" nagging).

### 4.4 Information Architecture: Card Sorting, Depth, Sitemaps

- **Open card sort** (users group + label cards) builds a new taxonomy; **closed card sort** (users place cards into given categories) validates one. 15–20 participants is enough for statistical signal; tools: Optimal Workshop, or paper cards.
- **Depth vs breadth**: each level adds one cognitive step. Prefer ≤ 3 levels. Two wide levels (6–8 items each) beat three narrow ones for task-based apps; three levels are acceptable for large content libraries (e.g., Settings).
- **3-tap guideline**: core tasks in ~3 taps. When a task needs 4+, first try merging steps, then try shortcuts (recent items, smart defaults) — not more hierarchy.
- **Sitemap output**: tree diagram of screens with IDs (S1 Home, S2 Search…), the nav model annotation, and depth markers. Every screen in the sitemap MUST trace to a flow node; orphan screens get cut.

### 4.5 Wireframing Conventions & Annotations

Lo-fi vocabulary (universal, tool-agnostic): image = rectangle with an X; text = 2–3 gray lines; button = rounded rectangle with a real label; input = rectangle with a placeholder label inside; video = rectangle with a play triangle; list = stacked rows of 56–72px with avatar+lines.

Annotation format: number every element (①②③) and keep a side table: `# | element | behavior | data source | edge cases`. Example row: `3 | FAB Add | tap → composer modal | local only | keyboard covers half screen — composer scrolls`.

Fidelity ladder: **sketch → lo-fi → hi-fi**. Lo-fi is enough for: flow validation, IA checks, stakeholder alignment, early usability tests. Hi-fi is required for: brand/motion decisions, final handoff, stakeholder persuasion. NEVER jump to hi-fi before the flows survive a 5-user test.

### 4.6 Design System Numbers (copy these values)

**Color — 60-30-10**: 60% neutral background (surface), 30% secondary surfaces and text, 10% accent reserved for primary actions. The 10% accent MUST be spent almost exclusively on the one primary action per screen; if everything is blue, nothing is.

Semantic tokens (name by role, never by hex):

| Token | Light value | Dark value | Used for |
|---|---|---|---|
| color.primary | #2563EB | #60A5FA | primary CTAs, active tab |
| color.onPrimary | #FFFFFF | #0B1220 | text/icons on primary |
| color.surface | #FFFFFF | #121212 | screen background |
| color.surfaceElevated | #F9FAFB | #1E1E1E | cards, sheets |
| color.textPrimary | #111827 | #E6E6E6 | body text |
| color.textSecondary | #6B7280 | #A1A1AA | captions, hints |
| color.border | #E5E7EB | #2E2E2E | hairlines, outlines |
| color.success | #16A34A | #4ADE80 | confirmations |
| color.warning | #D97706 | #FBBF24 | destructive-adjacent cautions |
| color.error | #DC2626 | #F87171 | errors, destructive |

Contrast floors: body text 4.5:1; large text (≥24px or ≥19px bold) 3:1; icons and UI boundaries 3:1 (WCAG 1.4.11).

**Typography — 1.25 modular scale**: 12 caption / 14 body-small / 16 body / 20 lead·h3 / 25 h2 / 31 h1 (pt or dp). Line-height ≈ 1.4 for body (16→22), ≈ 1.2 for headings (25→31). Weights: 400 regular, 600 semibold. Platform fonts: SF Pro (iOS), Roboto (Android); system fonts avoid licensing and load instantly. Body text MUST default to 16pt/16dp — smaller triggers iOS zoom-on-focus in inputs and fails readability outdoors.

**Spacing — 8pt grid**: 4 / 8 / 16 / 24 / 32 / 40 / 48. Screen side margin 16; card padding 16; between unrelated sections 24–32; between related items 8. Icons inside touch targets: 24×24 visual, 44×44pt / 48×48dp hit area.

**Radius scale**: 4 (chips, small controls) / 8 (cards, inputs, buttons) / 12 (bottom sheets) / 16 (full-screen modals) / full (pills, avatars). Pick per-tier once; NEVER freehand radius per screen.

**Elevation levels**:
| Level | Use | Shadow (light mode) |
|---|---|---|
| 0 | page background, lists | none |
| 1 | cards | `0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.10)` |
| 2 | dropdowns, floating buttons | `0 4px 8px rgba(0,0,0,.12)` |
| 3 | bottom sheets | `0 -4px 16px rgba(0,0,0,.16)` |
| 4 | modals, alerts | `0 8px 24px rgba(0,0,0,.20)` |
On Android dark mode, elevation is expressed as surface lightness (elevation overlays), not shadows.

**The 8 component states** (every interactive component, no exceptions): default → hover (tablet/web builds) → pressed (scale 0.97 or opacity 0.85) → focus (visible ring, required for external keyboards) → disabled (40–50% opacity, no pointer events, plus explanatory text when possible) → loading (skeleton or in-button spinner) → empty (what shows with zero data) → error (what shows when the action fails). A component sheet missing any state is an incomplete deliverable.

### 4.7 Platform Guidelines: iOS HIG vs Material 3

| Concept | iOS (HIG) | Android (Material 3) | Design decision |
|---|---|---|---|
| Top bar | Navigation bar, large title collapses on scroll | Top app bar / center-aligned | Follow platform; do not force custom headers |
| Back | Edge-swipe gesture + back chevron labeled with parent | System back gesture (edge or gesture nav) | Never design a custom back button inside pushed screens |
| Typography | SF Pro, Dynamic Type 11 accessibility sizes | Roboto, fontScale up to 2.0 | Support both scaling systems; layouts must reflow |
| Feedback toast | No native toast — use alert, banner, or custom snackbar | Snackbar (bottom, action optional) | Use snackbar/toast pattern for non-blocking confirmations |
| Blocking message | Alert (centered, 2 actions max recommended) | Dialog | Reserve for destructive/decisive moments only |
| Tab placement | Bottom tab bar, always | Bottom navigation (nav rail on tablets ≥ 600dp) | Bottom for both on phones |
| Switches/controls | Toggle, stepper, slider | Switch, chips, slider | Platform-native controls; never restyle fundamentals |
| Pickers | Wheels (inline/date), context menus | Material date picker, bottom sheets | Use platform pickers; users know them |
| Modals | Sheet (page/card) sliding up | Bottom sheet (standard/modal) | Sheets for compose/detail flows on both |
| Ripple feedback | None (highlight/opacity) | Material ripple | Comes free with native components |
| Icons | SF Symbols | Material Symbols | Never mix icon families in one app |

Rule: when in doubt, build with platform components and restyle only colors/tokens. Platform components give you accessibility behaviors (VoiceOver rota, TalkBack order, ripple, large-font reflow) for free; custom restyles silently destroy them.

### 4.8 Navigation Patterns & Thumb-Zone Ergonomics

- **Stack** (push/pop): every hierarchical drill-in. Every app has at least one stack. Back must always work (gesture + system), and screen titles should name the destination.
- **Bottom tabs (3–5)**: peer top-level destinations used frequently. Each tab keeps its own stack. NEVER 6+ items — recognition collapses; use "More" only for true long-tail, never for top destinations.
- **Drawer**: secondary/low-frequency destinations (settings, help, legal). NEVER the sole navigation — hidden behind one icon, features inside a drawer see dramatically lower discovery.
- **Modal/sheet**: focused, self-contained tasks (compose, filters, quick detail). MUST have an explicit close (X or "Done") and MUST NOT stack more than one modal deep.
- **Thumb-zone placement**: primary CTA bottom area (natural arc); destructive actions top-right or behind confirmation; inputs' submit buttons above the keyboard, never under it.
- **Touch targets**: 44×44pt / 48×48dp minimum, 8pt/8dp separation; list rows ≥ 48dp tall; icon-only buttons need `accessibilityLabel`s.

### 4.9 Screen Blueprints (element-by-element)

- **Onboarding**: ≤ 3 screens, each = one value proposition (visual + headline ≤ 8 words + one sentence). "Skip" always visible top-right. Final screen ends in the single primary CTA. Do permissions as a **pre-prompt rationale screen** ("We need notifications to remind you 5 minutes before class") that triggers the real system prompt on tap.
- **Login/signup**: social buttons first (Apple first on iOS — App Store requires it when other social logins exist), email/password fallback below. Password field: show/hide toggle, inline requirement checklist, error displayed at the field (never a top-of-form-only message). "Forgot password?" always visible. Error copy states the fix ("That email doesn't match an account — try signing up").
- **Home/feed**: top = greeting or search; content = card list (thumbnail, title, meta); primary action in bottom thumb zone (tab or FAB). Pull-to-refresh mandatory on feeds. First-run home = the empty state (see below), not a blank list.
- **List + detail**: list row = leading thumbnail/avatar, title (1 line, ellipsize), meta line; whole row is the target. Detail = hero media, title, meta, content, one sticky primary action pinned to the bottom safe area.
- **Search**: field focused on entry with keyboard up; empty field shows recents + suggestions; typing shows live suggestions; results = same list-row anatomy; no-results state offers query relaxation ("No matches for 'xyz' — try 'xy'") not a dead end. Filters = chip row or filter sheet with an applied-filters count badge.
- **Settings**: grouped list (iOS inset grouped style), row = label + current value/chevron; toggles change state instantly (no save button); destructive actions in their own group, red, placed last; account/sign-out group at the very bottom.
- **Empty states**: one-line explanation + one CTA. Formula: what's missing + why it matters + the button that fixes it. "No tasks yet — add your first one to get reminders" [Add task].
- **Error states**: plain-language cause + retry action. Distinguish offline (cache + "You're offline" banner) from failure ("Couldn't load — [Retry]").
- **Loading**: skeletons matching final layout (3 shimmering rows for lists); NEVER a full-screen blocking spinner for content areas; keep navigation usable while content loads.

### 4.10 Accessibility, Dark Mode & Micro-interactions

**Accessibility (WCAG mobile basics)**
- Dynamic type: layouts MUST reflow at 200% font scale (iOS Dynamic Type, Android fontScale 2.0). NEVER fix the height of text containers; let them grow.
- Screen readers: every icon-only button gets a label ("Add to cart", never "button"); group related elements (avatar+name) into one focusable element; announce state changes (added/removed) via live-region equivalents.
- Contrast: 4.5:1 body, 3:1 large text and UI components. NEVER color-only signaling — pair error red with an icon + text, required fields with an explicit marker, chart series with labels or patterns.
- Focus order follows visual order; modals trap focus until dismissed. Captions/overlays on video ≥ 12pt with a scrim for contrast. Relevant criteria: 1.4.3, 1.4.11, 2.5.5, 3.3.2.

**Dark mode**
- Map semantic tokens (4.6 table), NEVER invert. Surfaces go darker while elevating lighter: #121212 → #1E1E1E → #262626 as elevation rises (Material elevation overlays).
- Text: off-white #E6E6E6, not pure white (halation on OLED). Primary brand color lightens/desaturates one step (#2563EB → #60A5FA) to hold contrast.
- Images/photos dim 20–40% or get a scrim; illustrations get dark variants if brand-critical.

**Micro-interactions & haptics**
- Durations: 150–200ms for micro-feedback (taps, toggles, checkboxes); 250–300ms for transitions (push, sheet); NEVER > 400ms for any feedback animation — snappiness is perceived quality.
- Easing: ease-out for entrances, ease-in for exits, ease-in-out for moves (iOS default ≈ `cubic-bezier(0.25,0.1,0.25,1)`; Material "emphasized" for expressive moves).
- Animate for feedback (press scale 0.97) and orientation (where an element came from/went) only. NEVER animate for decoration.
- Haptics: light impact on selection, success/error notifications on task completion/failure, medium on destructive confirm. NEVER buzz on every keystroke.

## 5. Code & Tool Templates

### 5.1 Design token file (hand this to mobile-app-creator verbatim)

```json
{
  "color": {
    "primary": { "value": "#2563EB" },
    "onPrimary": { "value": "#FFFFFF" },
    "surface": { "value": "#FFFFFF" },
    "surfaceElevated": { "value": "#F9FAFB" },
    "textPrimary": { "value": "#111827" },
    "textSecondary": { "value": "#6B7280" },
    "border": { "value": "#E5E7EB" },
    "success": { "value": "#16A34A" },
    "warning": { "value": "#D97706" },
    "error": { "value": "#DC2626" },
    "dark": {
      "primary": { "value": "#60A5FA" },
      "surface": { "value": "#121212" },
      "surfaceElevated": { "value": "#1E1E1E" },
      "textPrimary": { "value": "#E6E6E6" },
      "textSecondary": { "value": "#A1A1AA" },
      "border": { "value": "#2E2E2E" }
    }
  },
  "font": {
    "size": { "caption": 12, "bodySmall": 14, "body": 16, "lead": 20, "h2": 25, "h1": 31 },
    "lineHeight": { "body": 22, "heading": 38 }
  },
  "space": { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32 },
  "radius": { "sm": 4, "md": 8, "lg": 12, "xl": 16 },
  "shadow": { "card": "0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.10)" }
}
```

### 5.2 Web-reusable CSS implementation of the same tokens

```css
/* tokens.css — same system for any web-based prototype or design QA harness */
:root {
  --color-primary: #2563eb; --color-on-primary: #ffffff;
  --color-surface: #ffffff; --color-surface-elevated: #f9fafb;
  --color-text: #111827; --color-text-secondary: #6b7280;
  --color-border: #e5e7eb; --color-success: #16a34a;
  --color-warning: #d97706; --color-error: #dc2626;
  --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px; --space-5: 32px;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
  --font-body: 1rem; --font-lead: 1.25rem; --font-h2: 1.5625rem; --font-h1: 1.9375rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #60a5fa; --color-surface: #121212;
    --color-surface-elevated: #1e1e1e; --color-text: #e6e6e6;
    --color-text-secondary: #a1a1aa; --color-border: #2e2e2e;
  }
}
:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px; }
```

### 5.3 React Native theme module (consumes 5.1 directly)

```jsx
// theme.js — single source of truth mirroring the token JSON
export const colors = {
  primary: '#2563EB', onPrimary: '#FFFFFF', surface: '#FFFFFF',
  surfaceElevated: '#F9FAFB', textPrimary: '#111827', textSecondary: '#6B7280',
  border: '#E5E7EB', success: '#16A34A', warning: '#D97706', error: '#DC2626',
};
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 4, md: 8, lg: 12, xl: 16 };
export const type = {
  caption: { fontSize: 12, lineHeight: 17 },
  body: { fontSize: 16, lineHeight: 22 },
  lead: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  h1: { fontSize: 31, lineHeight: 38, fontWeight: '600' },
};
```

```jsx
// HomeScreen.jsx — safe-area-aware screen built only from tokens
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, type } from './theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      <Text style={styles.h1}>Today</Text>
      <Pressable
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        accessibilityRole="button" accessibilityLabel="Add a new task"
      >
        <Text style={styles.ctaLabel}>Add Task</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  h1: { ...type.h1, color: colors.textPrimary, marginBottom: spacing.md },
  cta: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary,
         alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  pressed: { opacity: 0.85 },
  ctaLabel: { ...type.body, color: colors.onPrimary, fontWeight: '600' },
});
```

### 5.4 WCAG contrast checker (runnable)

```python
# contrast_check.py — WCAG 2.1 ratio between two hex colors.
# Usage: python contrast_check.py "#6B7280" "#FFFFFF"
import sys

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rel_luminance(hex_color):
    r, g, b = (c / 255 for c in hex_to_rgb(hex_color))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

def contrast(fg, bg):
    l1, l2 = sorted((rel_luminance(fg), rel_luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)

if __name__ == '__main__':
    fg, bg = sys.argv[1], sys.argv[2]
    ratio = contrast(fg, bg)
    verdict = 'PASS AA' if ratio >= 4.5 else ('LARGE TEXT ONLY' if ratio >= 3.0 else 'FAIL')
    print(f'{fg} on {bg}: {ratio:.2f}:1 -> {verdict}')
```

### 5.5 Usability test script (template)

```markdown
# Usability Test — [App] — Round [n] — Participant [ID]
Setup: participant's own phone, screen recording ON, think-aloud.
Say: "We're testing the app, not you. There are no wrong answers."

Tasks (give one at a time; observe silently):
1. "Show me how you'd create your first task."  Success: task visible in list in < 60s.
2. "Set a reminder for tomorrow at 9am."        Success: reminder set; note how the picker was found.
3. "You're done with this task — clear it."     Success: item removed; note if they looked for undo.

After each task: "What did you expect to happen there?" (never lead).
Close: "If you had a magic wand, what one thing would you change?"

Log per task: time | success y/n | confusion points (quote + timestamp) | severity 0–4.
3+ participants failing the same task = design defect, not user error. Fix, then re-test failed tasks only.
```

### 5.6 Journey map + wireframe annotation templates

```markdown
## Journey map — [persona] — [scenario]
| Stage | Awareness | Onboarding | First success | Habit | Churn risk |
|---|---|---|---|---|---|
| Doing | hears about app | signup + permissions | completes core task | returns daily | friction or decay |
| Touchpoints | store listing | onboarding, pre-prompt | home, core flow | notifications | settings, support |
| Emotion 1–5 | 3 | 2 | 5 | 4 | 2 |
| Pain (dip) | unclear value | too many steps | — | notification fatigue | no undo |
| Design fix | clearer screenshots | skip + progressive disclosure | — | value-carrying pings | destructive confirm + undo |

## Screen: Home — Wireframe v1
| # | Element | Behavior | Data | Edge cases |
|---|---------|----------|------|------------|
| 1 | Search bar | tap → Search screen | recent queries | empty → show suggestions |
| 2 | Feed card | tap → Detail | GET /feed | error → retry card; empty → empty state |
| 3 | FAB Add | tap → composer sheet | local | keyboard overlap → sheet scrolls |
```

## 6. Decision Tables

**Navigation model selection**

| Situation | Pattern | Why |
|---|---|---|
| 3–5 frequent peer destinations | Bottom tabs (3–5) | always visible, thumb-reachable, zero memory load |
| Hierarchical content (mail, settings) | Stack | drill-in with reliable back |
| Secondary/low-frequency destinations | Drawer | keeps primary chrome clean; NEVER sole navigation |
| Focused task (compose, checkout, filters) | Modal / bottom sheet | preserves context; explicit close |
| Tablet / foldable ≥ 600dp width | Tabs + two-pane (list–detail side by side) | use the width instead of extra taps |

**Feedback surface selection**

| Message | Surface | Lifetime |
|---|---|---|
| Action succeeded | Snackbar/toast with optional Undo | auto-dismiss 3–4s |
| Destructive confirmation | Alert (2 actions, verb-labeled buttons) | blocks until choice |
| Persistent condition (offline) | Inline banner at top of affected screen | until condition clears |
| Field problem | Inline error under the field, icon + text | until fixed |

**Fidelity selection**

| Goal | Fidelity |
|---|---|
| Validate flows/IA, run cheap tests | lo-fi boxes |
| Stakeholder alignment | lo-fi + journey map |
| Brand, motion, dark mode decisions | hi-fi |
| Developer handoff | hi-fi + tokens + component sheet |

**Onboarding style**

| Style | Use when | Risk |
|---|---|---|
| Skip-able value carousel (≤3) | value needs explaining | skip-everything users |
| Progressive permission (pre-prompt) | app needs notifications/location | prompt fatigue if greedy |
| Interactive first-task checklist | learning by doing is possible | over-guidance for experts |
| Contextual tips (first-run tooltips) | UI is unconventional | tip blindness — cap at 3 |

## 7. Quality Checklist

Verify EVERY item before approving any screen or handoff package:

- [ ] Every screen traces to a user flow node and a named user task
- [ ] All touch targets ≥ 44pt/48dp with ≥ 8pt/8dp spacing
- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 large text and UI boundaries), verified with a checker
- [ ] No meaning conveyed by color alone (icon/label/position paired)
- [ ] All 8 component states specified for every interactive component
- [ ] Empty, error, and loading states designed for every screen
- [ ] Content loading uses skeletons; no full-screen blocking spinners
- [ ] Bottom tab bar has 3–5 items; no hamburger-only navigation
- [ ] Primary actions sit in the bottom thumb zone; destructive actions hard to mis-tap
- [ ] Layouts survive 200% font scaling without truncation or clipping
- [ ] Icon-only controls have accessibility labels specified
- [ ] Safe areas (notches, home indicator) respected; content padded by insets
- [ ] Inputs never covered by the keyboard; submit buttons above keyboard
- [ ] Text truncation rules defined (1-line ellipsis vs 2-line clamp) per element
- [ ] Dark mode uses semantic tokens; elevation via surface lightness on Android
- [ ] Motion durations within 150–300ms; haptics specified for key events
- [ ] Token JSON, measurements, and 1x/2x/3x asset list delivered
- [ ] Usability round (5 users) run on the flows; defects fixed and re-tested
- [ ] RTL reviewed (mirrored icons, aligned text) if the app ships in RTL locales
- [ ] Platform checks passed: SF Symbols/Dynamic Type on iOS, ripple/fontScale on Android

## 8. Common Mistakes & Fixes

1. **Mistake: starting with hi-fi visuals.** Symptom: stakeholders debate gradients while flows are broken. Fix: enforce the ladder — lo-fi first, hi-fi only after the 5-user flow test passes.
2. **Mistake: hamburger-only navigation.** Symptom: feature usage metrics flat; users never find secondary screens. Fix: move top 3–5 destinations into bottom tabs; drawer for the long tail only.
3. **Mistake: forced registration before value.** Symptom: 40–60% drop at the signup gate. Fix: guest mode + deferred account creation at the moment value requires saving.
4. **Mistake: designing only the happy path.** Symptom: dev sprint flooded with "what should happen if…" tickets. Fix: error/empty/loading states are part of the definition of done for a screen.
5. **Mistake: spinners everywhere.** Symptom: app feels slow despite fast APIs. Fix: skeletons for content areas; spinners only for < 2s in-place actions.
6. **Mistake: 38pt/40dp tap targets to fit more UI.** Symptom: mis-tap complaints, rage taps in analytics. Fix: 44pt/48dp minimum; shrink visuals, keep hit areas big.
7. **Mistake: color-only error signaling.** Symptom: color-blind users can't tell error from success. Fix: icon + text with every color signal.
8. **Mistake: modal abuse.** Symptom: modal-on-modal stacks, lost context, no way back. Fix: max one modal deep; prefer sheets; explicit close always.
9. **Mistake: interruptive onboarding (4+ forced screens).** Symptom: day-1 retention collapse. Fix: ≤ 3 skippable screens; move teaching into first-run empty states.
10. **Mistake: icon-only ambiguity.** Symptom: users guess what a toolbar icon does. Fix: labels under icons for top-level actions; accessibilityLabel always; test icon comprehension with 5 users.
11. **Mistake: fixed pixel text containers.** Symptom: truncated labels at large font scales; App Store/Play accessibility flags. Fix: minHeight only, let text wrap, test at 200%.
12. **Mistake: inventing values per screen (spacing, colors, radius).** Symptom: design drifts, QA fights pixel diffs. Fix: tokens only; new values require a system decision, not a one-off.

## 9. Advanced Techniques

- **Adaptive layouts (phone/tablet/foldable)**: at ≥ 600dp width, promote list–detail to two panes, switch bottom tabs to a nav rail (Material) or sidebar (iPad), and let sheets become centered cards. Design the breakpoint behavior per screen, not app-wide.
- **Motion choreography**: define duration/elevation tokens alongside color tokens; use shared-element transitions for list→detail (the card becomes the hero) so orientation survives the navigation. Respect `prefers-reduced-motion` by cross-fading instead.
- **Token pipeline**: keep tokens in a single JSON (5.1) and compile with **style-dictionary** to Swift, Kotlin, and CSS outputs. One change propagates everywhere; drift becomes impossible.
- **RITE testing** (Rapid Iterative Testing and Evaluation): test 2–3 participants, fix immediately, re-test — compresses three rounds into one week. Use when the team can change designs within the test window.
- **Designing for interruption**: assume calls and app switches mid-flow. Persist draft input on every keystroke, restore scroll position, and make any destructive operation resumable ("Continue where you left off?").
- **Internationalization by design**: German expands text ~35%, Arabic mirrors layout. Use flex layouts that grow, keep icon+label rows resilient to length, and review screens with pseudolocale content before hi-fi sign-off.

## 10. Quick Reference Card

- Touch targets: **44pt (iOS) / 48dp (Android)** min; 8pt/8dp gaps. List rows ≥ 48dp.
- Contrast: **4.5:1** body text; **3:1** large text + UI boundaries.
- Type scale (1.25): **12 / 14 / 16 / 20 / 25 / 31**; body = 16; line-height 1.4 body, 1.2 headings.
- Spacing (8pt grid): **4 / 8 / 16 / 24 / 32**; screen margin 16; card padding 16.
- Radius: **4 / 8 / 12 / 16**. Tabs: **3–5** items. Onboarding: **≤ 3** screens + Skip.
- Motion: **150–200ms** micro, **250–300ms** transitions; ease-out in, ease-in out.
- Color split: **60-30-10**; accent reserved for the primary action.
- States: **default, hover, pressed, focus, disabled, loading, empty, error** — all 8, always.
- Users per usability round: **5**; 3+ failures on one task = defect.
- Handoff = **tokens JSON + measurements + 1x/2x/3x assets + component sheet**.
- Flow rule: **every flow shows error paths**; journey map fixes the two deepest dips.
- Empty state formula: **what's missing + why it matters + one CTA**.

