---
name: gameui-designer
description: >
  Game UI/HUD design skill: designs player-facing interfaces for games of any genre,
  engine, or platform — HUD layout systems with TV safe zones and clutter budgets, the
  four UI classes (diegetic / non-diegetic / spatial / meta), gamepad-first menu and
  inventory navigation with focus management, readability at gameplay distance (text
  sizes for TV/desktop/mobile, contrast in bright scenes, colorblind support), feedback
  and juice (hit markers, damage numbers, screen shake, haptics, UI audio identity),
  onboarding and tutorial UI, touch/mobile game controls and thumb zones, game
  accessibility (remapping, hold-to-toggle, subtitles, UI scale, flash safety), UI
  states (focus/selected/equipped/locked), iconography and visual language, settings
  menu architecture, and engine-aware handoff (Unity uGUI/Canvas, Godot Control nodes,
  HTML/CSS for web games) with working code. Use this skill whenever the user mentions
  HUD, game menu, game UI, inventory screen, health bar, minimap, crosshair, pause
  screen, game settings, damage numbers, game tooltips, mobile game interface, gamepad
  navigation, or asks to design, improve, or critique the interface of any game — 2D or
  3D, web, PC, console, or mobile — even if they just say "my game's UI feels bad" or
  paste a screenshot. Do NOT use it for game mechanics, code architecture, or level
  design (game-creator builds the game itself), general web or app UI (webui-designer /
  mobile-app-designer — different physics: no gamepad, no distance, no time pressure),
  or AI-generated art assets (image-generator can supply icons/illustrations to spec).
---

# Game UI Designer — HUDs, Menus & Player-Facing Interfaces

> Game UI has one job: give the player the right information in one glance and get out of the way. Everything in this skill serves that — layout physics, readability at distance, gamepad focus, feedback loops, and accessibility that lets everyone play.

## 0. Operating Rules (Non-Negotiable)

1. **DESIGN GAMEPAD-FIRST for any PC/console game:** every screen navigable with left stick/d-pad + one confirm button + one back button, and focus position must NEVER be lost or ambiguous — including after lists change, tabs switch, or a menu closes. Why: a lost focus softlocks the player; mouse-only menus exclude controller players and most couch/Steam Deck play.
2. **ALWAYS respect safe zones:** keep critical HUD inside ~90% of screen width/height (≈5% margins); verify layouts in 16:9 AND 16:10 AND ultrawide (21:9) without elements clipping. Why: TVs overscan/crop edges; HUD hugging the screen edge is invisible or unreadable on the most common living-room display.
3. **NEVER convey state by color alone.** Poison = green tint + droplet icon + label. Rarity = color + border shape/pattern + text. Why: ~8% of male players have color-vision deficiency; the information must survive a grayscale screenshot.
4. **THE ONE-GLANCE RULE: gameplay HUD communicates critical state in <500ms of attention, with ≤5 simultaneous HUD elements;** non-critical elements fade when stable and return on change. Why: HUD competes with the game itself for a finite attention budget; every permanent element taxes every second of play.
5. **ALWAYS size text for viewing distance:** 1080p TV at ~3 m → UI text ≥24–28px; desktop at ~60 cm → ≥16px; mobile at ~30 cm → ≥16px equivalent with generous spacing; subtitles on TV ≥28–32px. Why: a player who can't read it might as well not have it; text nobody reads is worse than no text because it wastes the clutter budget.
6. **FEEDBACK FOR EVERY INPUT AND EVENT within one frame (~16–50ms):** press → audio + visual; hit → directional indicator + marker; damage → number/flash/haptic; button focus change → tick sound. Why: silent UI makes a correct game feel broken; responsiveness IS the game feel of menus.
7. **PAUSE is sacred: always available, always shows** resume, options (audio/display/controls at minimum), and save state; options must open from pause, not only from the main menu. Why: pausing is a player right; burying settings forces players to quit mid-session to change volume.
8. **NEVER hide controls: every currently-available verb has an on-screen hint** (contextual bottom bar, button glyphs). Why: players who forget a verb blame the game and quit; the tutorial ends but hints must not.
9. **DESIGN EVERY STATE of every element:** buttons (normal/focus/hover/pressed/disabled), items (normal/focused/selected/equipped/locked/new/insufficient-currency), lists (empty, no saves, offline, corrupted-save). Why: game UI fails in the states nobody mocked — and "no saves yet" with a dead screen is a design bug.
10. **PHOTOSENSITIVITY SAFETY: no more than 3 general flashes per second;** provide a flash/damage-effect reduction option. Why: seizure risk is a real safety and legal issue (WCAG 2.3.1 principle applies to games).
11. **CHOOSE the fiction relationship per UI element and stay consistent:** diegetic (in-world), non-diegetic (classic overlay), spatial (world-anchored), meta (stylized glass). Why: mixing is fine when deliberate (§4.1) but accidental mixing reads as sloppy, not stylish.
12. **ALWAYS playtest the UI with a player who has never seen it:** watch them find a verb, equip an item, and change one setting — silently. Why: designers cannot see their own UI; every confusion point is a design bug, not a player failure.

## 1. When to Use / When Not To

**Use this skill when the task involves:**
- Designing or improving any game HUD, menu, inventory, map, dialogue, or settings screen.
- Critiquing a game's UI ("my game feels clunky", screenshot review, "why do players get lost in menus").
- Gamepad/controller navigation design, focus systems, button mapping hints.
- Readability, HUD clutter, minimap/health-bar/ammo placement decisions.
- Game accessibility: colorblind modes, remapping, subtitles, UI scale, photosensitivity.
- Mobile/touch game controls and on-screen UI.
- Specifying UI for Unity / Godot / web games and handing off to the builder.

**Do NOT use when the task is:**
- Building the game itself: mechanics, loops, physics, level design → **game-creator** (this skill hands it UI specs).
- General web/app UI with no gameplay pressure → **webui-designer** (its 44px targets and forms grammar differ from game UI).
- Non-game mobile apps → **mobile-app-designer**.
- Generating icon/art assets → **image-generator** (this skill writes the asset brief it follows).

| The user asks for... | Correct skill | This skill's role |
|---|---|---|
| "Build me a flappy clone" | game-creator | UI spec (score HUD, game-over) for it to implement |
| "My game's menus are confusing" | gameui-designer | Full ownership |
| "Design my app's settings screen" | webui-designer / mobile-app-designer | None |
| "Inventory icons for my RPG" | image-generator | This skill writes the brief (§4.10) |

## 2. Core Concepts & Mental Models

**The four UI classes (Fagerholt & Lorentzon taxonomy).** *Diegetic:* the UI exists in the game world — Dead Space's holographic health spine on the character's back, FTL's ship-room systems. *Non-diegetic:* classic 2D overlay the world doesn't contain — most health bars, minimaps. *Spatial:* world-anchored but rendered on the glass — objective markers floating above locations, The Division's holograms. *Meta:* full-glass stylized layers — blood splatter on the "camera" when hurt. Rules of thumb: diegetic maximizes immersion at the cost of readability; non-diegetic maximizes clarity at the cost of presence; spatial sits between. CHOOSE per information type (§4.1) and document the choice — accidental mixing is the enemy.

**The attention economy.** Gameplay is the player's primary task; HUD is a background process that must earn every pixel. Each permanent element costs attention every second; each transient element costs an interruption. Budget like money: ≤5 permanent elements, transient elements queue, nothing flashes without meaning.

**Time pressure changes UI physics.** *Real-time* play (action, roguelike, RTS): feedback in frames, no blocking dialogs during play, mistakes recoverable, menus pause the world. *Turn-based* (strategy, card, JRPG): denser UI is affordable, complexity can live on screen. *Meta screens* (inventory, skill tree): no pressure — this is where depth and comparison UI belong. NEVER import real-time blocking patterns (QTE-style confirmations) into meta screens, or vice versa.

**Information priority = what kills or confuses first gets pixels first.** Health before ammo before lore. Within each system: state (what is) before delta (what changed) before history (what was). The minimap earns its corner because spatial awareness prevents death; the tutorial popup does not, because it pauses nothing.

**Genre conventions are learned vocabulary.** Players arrive knowing: health bottom-left (or around the reticle), minimap top-right or bottom-left, ammo bottom-right, abilities bottom-center, objectives top-left. Following conventions is free onboarding; breaking one is a debt you must re-teach. Innovate in HOW information looks, not in WHERE players must look for it.

**The player is not the designer.** Discoverability beats documentation: every mechanic needs an in-UI cue at the moment of need (§4.7). "They'll read the manual" is a bug report from the future.

## 3. Mandatory Workflow

**Step 1 — Gameplay pillars & verb inventory.** List the player's verbs (move, shoot, craft, parley...) and the game's pillars (tension? mastery? exploration?). Why: every UI decision defers to pillars — a horror game's sparse diegetic HUD and a MOBA's dense data HUD are BOTH correct because their pillars differ.

**Step 2 — Information requirements table.** Per system: what info, priority (critical/high/medium/low), update rate (per-frame/per-event/rare), failure cost if missed (death/lost time/none), and best moment of attention. This table IS the design — layout just renders it. A system with "rarely needed, medium priority" has no business as a permanent HUD element.

**Step 3 — UI mode map.** Enumerate the modes: gameplay HUD / contextual prompts / pause / settings / inventory / map / dialogue / cutscene / loading / game-over — and the transitions between them (what can open what, what cancels what, where focus lands in each). Modes without mapped transitions produce the classic bugs: pause-over-inventory stacking, focus lost on close, HUD visible in cutscenes.

**Step 4 — Layout pass.** Anchor map per mode (which corner/edge owns which cluster), safe zones (Rule 2), controller reach zones (for touch: §4.8), clutter budget check (Rule 4). Produce a wireframe — text-and-boxes is fine — with the information requirements table rendered onto it.

**Step 5 — Component specs with states.** Spec every element from §4.6: sizes, states, art direction hooks (shape language matching the game's art), and audio hooks. Every element gets its full state list BEFORE any art exists.

**Step 6 — Readability pass.** Apply the distance/size table (§4.3); test contrast against the WORST scene (brightest sky, busiest fight); run a colorblind simulation on all status colors; check text plates/outlines over 3D.

**Step 7 — Mockup & iterate.** Even a CSS/HTML mockup or engine greybox beats describing. Iterate layout against the requirements table, not against taste.

**Step 8 — Engine-aware handoff.** Specify resolution independence (anchors, not absolute pixels), safe-area API usage, render order/layering, input map (which button = confirm/back/tabs), and localization margins (text expands up to ~30%). Working snippets in §5.

**Step 9 — QA (mandatory).** Playtest protocol (§9.5) + state walk (force every state: empty saves, locked item, offline) + accessibility options check (play 10 minutes with colorblind mode + reduced flashes + UI scale 150%) + resolution/safe-zone matrix (16:9, 16:10, 21:9, 4:3 stretch check for PC).

## 4. Deep Knowledge Library

### 4.1 The four UI classes — choosing per information type
| Class | What it is | Best for | Cost | Example |
|---|---|---|---|---|
| Diegetic | UI exists inside the world/character | Immersion-critical, atmosphere games; info the CHARACTER would know | Readability, localization, scaling | Dead Space health spine; FTL room systems |
| Non-diegetic | Flat overlay, world-independent | Critical combat data, precision info | Presence/immersion | Health bars; MOBA ability bar; damage numbers |
| Spatial | World-anchored, drawn on glass | Associating info with a place/object | Screen clutter at distance; depth-test fights | Objective markers; enemy outlines; name plates |
| Meta | Full-glass stylized layer | Impact moments, camera fiction | Can't carry data | Blood on lens; frost on screen |
**Decision rule:** ask "who knows this, and when must it be read?" — if the CHARACTER knows it and the player can afford a look (status effects in survival horror) → consider diegetic; if the PLAYER needs it now and precisely (HP during combat) → non-diegetic; if it belongs to a place or object (where to go, what's over there) → spatial; if it's a feeling or a camera event (took a hit) → meta. Deliberate mixing is normal (an FPS is non-diegetic HUD + spatial markers + meta hit feedback); document the choice per element so future additions follow the system.

### 4.2 HUD layout system
**The standard anchor map (follow unless a pillar says otherwise):**
| Zone | Typical residents | Why there |
|---|---|---|
| Bottom-left | Health/armor/status cluster | Genre convention; peripheral-visible |
| Bottom-right | Ammo/resource/resource-spender | Convention; near right thumb (touch) |
| Bottom-center | Ability bar / equipment slots | Between hands; gamepad-face-button adjacency |
| Top-left | Objectives / quest tracker | Convention; read rarely |
| Top-right | Minimap OR currency/notifications | Convention split; pick per genre and stay put |
| Center | Reticle + contextual prompts + damage direction | Focus of attention: fastest read |
**Placement law:** frequency × urgency decides proximity to the reticle. Ammo is read mid-fight → near the action; quest text is read between fights → periphery is fine. NEVER move a resident between zones across updates — muscle memory is a feature you can delete.
**Safe zones (Rule 2):** build with margins ≥5%; expose a HUD-scale option (80–120%); test 16:9 / 16:10 / 21:9 (stretch or extended, but nothing clipped) and OLED burn-in mitigation for always-on elements in long sessions (slight drift or auto-dim on static minimaps in kiosk-like usage).
**Fade-when-stable:** health full → fade to ~40% opacity; ammo unchanged → fade; return instantly on change, on low-value states (HP <30%), and on input. Contextual reveal: interaction prompts appear only near interactables; stealth indicators only in stealth. This is how you keep the clutter budget at ≤5 permanent elements while carrying 15 systems.
**Genre presets:** FPS = reticle-centric (ammo+health near center); MOBA = minimap-centric (minimap top-right/enlarged, abilities bottom); survival = status-centric (body/hunger/temp cluster); racing = speed-centric (speedo bottom-right, position/race info top); RPG = status-row-centric (party/buffs along an edge).

### 4.3 Readability & text at distance
| Context | Viewing distance | Minimum UI text | Notes |
|---|---|---|---|
| TV 1080p (console/PC-couch) | ~3 m | 24–28px; subtitles 28–32px | Test from a real couch, not a monitor |
| Desktop monitor | ~60 cm | 14–16px; body 16px | Dense CRPGs may go 14px minimum |
| Mobile | ~30 cm | 16px equivalent; targets §4.8 | Thumbs shadow bottom corners |
| Steam Deck/handheld PC | ~40 cm | ≥14px | Touch+controller hybrid targets |
**Contrast in scenes (the 3D problem web UI doesn't have):** text floats over arbitrary worlds — bright sky, snow, particle storms. Solutions in order of strength: text plates (dark scrim behind text), outlines/strokes (2px at TV distance), strong drop shadows, then color. ALWAYS test against the worst-case scene; a palette that reads on the menu screen fails in a snowstorm.
**Colorblind support (Rule 3):** deuteranopia is most common; avoid red/green as the ONLY pair (use blue/orange for ally/enemy coding where possible); add dedicated modes (protan/deutan/tritan) that remap status colors AND change shapes/icons; test with a grayscale pass — if the game is still playable and readable, the design is sound.
**UI scale + subtitle options are core settings** (§4.4 settings architecture), not accessibility afterthoughts.

### 4.4 Menus & navigation (gamepad-first)
**The focus model:** one element always holds focus; focus is drawn with scale-up (5–8%), outline/glow, AND audio tick; d-pad/stick moves focus with wrap-around within lists; shoulder buttons switch tabs; A/X or Enter confirms; B/O or Esc goes back — the SAME mapping everywhere. Focus must never die: list empties → focus lands on the empty-state's action; item consumed → focus moves to its neighbor; menu closed → focus returns to what opened it. A screen the player can't reach focus in is a softlock — a `blocker:` in any review.
**Time-to-gameplay:** launch → playing in ≤3 inputs (Continue is pre-selected on the main menu); pause → resume = 1 input. Every additional gate (splash screens, "press any key", mode select) needs a justification against this budget.
**Main menu spec:** Continue (first, pre-focused, shows last-save timestamp/location) · New Game (confirm if a save exists) · Load (thumbnail grid, saves sorted newest-first, corrupt saves labeled not hidden) · Options · Extras/Quit. Quit on console = "Quit to dashboard" phrasing.
**Inventory spec:** grid or list navigable by stick; shoulder tabs = category/filter; item card anatomy: icon, name, rarity treatment (color + border shape + text — Rule 3), stat block, description, action row (Equip/Use primary · Inspect · Drop destructive-guarded); comparison panel shows equipped-vs-highlighted deltas (+/− with arrows, not color alone); sorting/filtering without losing focus; stack splits on a dedicated control, not a hidden combo.
**Settings architecture (the accessibility backbone):** Audio (master/music/SFX/voice sliders, mute-on-unfocus) · Display (brightness WITH a calibration image, UI scale, FOV, fullscreen/windowed, VSync) · Controls (full remap incl. hold→toggle everywhere, sensitivity axes, invert per axis) · Accessibility (colorblind modes, subtitle size/background, screen-shake intensity, flash reduction, aim assist) · Gameplay (difficulty — DECOUPLED from accessibility; they solve different problems). Every control: slider shows its value; changes apply instantly or with explicit Apply; unsaved-changes guard on back.
**Mouse+keyboard parity:** hover = focus (both sounds fire), scroll wheel lists, right-click context menus, and control hints show KB/M and gamepad glyphs side-by-side where both are live (or the last-used input's glyphs, switched on input — the modern standard).

### 4.5 Feedback & juice for UI
**Damage numbers:** float up 0.6–1.0s with slight drift, crit = larger + distinct color + outline, stack cap (~20) with aggregation beyond it, player-dealt vs player-taken visually distinct; option to disable.
**Hit confirmation:** crosshair marker (X or flare) + directional damage indicator (arc around reticle showing attack origin — players cannot dodge what they can't locate) + kill confirm (distinct marker/sound); per-weapon audio identity.
**Screen effects:** shake amplitude 2–8px, decays <300ms, NEVER on menus; hit-stop 30–80ms on heavy impacts; low-HP vignette + heartbeat audio (pair audio+visual — Rule 3's spirit); all of it reducible via settings (Rule 10).
**Haptics map:** light tick = navigation/brush; medium = hit taken; sharp double = confirm; sustained low = danger/roar. Intensity setting 0–100%. Haptics duplicate, never replace, audiovisual feedback.
**UI audio identity:** one palette of 6–8 sounds — move/focus tick, confirm, cancel/back, error, open/close panel, notification — consistent timbre across every screen; SFX mixed −12 to −18 LUFS under music so they read but don't compete; focus ticks at the SAME volume as each other (players hear inconsistency instantly). Cooldowns: ready = glow + single chime; insufficient resource on press = error sound + shake + resource flash — never a silent dead button.

### 4.6 UI component specs with game states
**Buttons:** normal / focused (scale+outline+tick) / hover (mouse) / pressed (scale-down + confirm sound on release) / disabled (dimmed + reason on attempt, not silence) / locked (padlock icon + unlock condition in tooltip). Confirm-on-release (not press) so players can slide off to cancel — a gamepad essential.
**Sliders:** left/right steps with acceleration after ~1s hold; live value readout ("Music 70%"); apply instantly for audio/visual.
**Lists & grids:** wrap-around navigation; page-up/down via triggers; fast-scroll with stick-edge + inertia; scrollbar appears only on mouse.
**Item card:** icon (empty socket visible when no item) · name · rarity · stats (delta arrows vs equipped) · flavor text last. States: focused, selected (marked, may differ from focus), equipped (badge/outline), new ("NEW" pill, cleared on view), locked (condition), insufficient-funds (price in danger color + shake on attempt).
**Tooltips:** hover 300–400ms or hold-to-show on gamepad (LT or a dedicated hint button, shown in the hint bar); position never covers the focused element; contains mechanics numbers, not just flavor.
**Progress bars:** segment marks at meaningful thresholds ( breakpoints where abilities unlock); low-state pulse; cast bars show interrupt points.
**Notification stack:** queue max 3, lifetime 4–6s, newest pushes down, pause-collected history view for achievements/loot; never during boss intros (withhold and release after).
**Dialogue box:** typewriter with speed setting and instant option; auto-advance OFF by default; history log (backlog) reachable; choice menus gamepad-navigable with time-limit indicators only when the fiction demands it.
**Map screen:** layers (fog/objectives/markers), legend, fast-travel with confirm + cost display, marker placing; zoom levels preserve label legibility (labels fade before overlapping).
**Loading screens:** progress + a teaching tip (rotating, real mechanics) or world lore; NEVER a blank screen >2s; asynchronous tips preload so they don't reveal hitching.

### 4.7 Onboarding & tutorial UI
Teach verbs at FIRST NEED, not in a front-loaded wall: the sprint prompt appears at the first corridor long enough to matter. One verb at a time; practice gates (must perform it once to proceed) ONLY for survival-critical verbs (dodge, revive); diegetic > popup (a character calls it out, the world demonstrates it); prompts decay to nothing after N successful uses — but the control hint bar (Rule 8) stays forever. Veterans get a skip (acknowledged mastery via a "New Game+"-style flag or genre-savvy default). Complex systems (crafting, skills) get a first-run checklist — optional tasks in a corner, never modal — and the empty-state UI carries teaching ("No mods yet — craft one from Materials").

### 4.8 Touch & mobile game UI
**Thumb physics:** comfortable reach is the bottom third arcs; primary controls live there; destructive/critical actions NEVER under the movement thumb's travel. Targets ≥60px (9mm) with ≥12px spacing — bigger than web because of motion and latency. Gestures need on-screen affordances (a drag-handle the first time, hints that fade).
**Portrait HUD stacking:** top = currency/objectives/battery-safe zone (notch!), middle = the world, bottom = controls; safe areas include notches AND home indicators (engine safe-area APIs, §5.3).
**Latency honesty:** touch controls need pressed-state feedback the same frame; virtual joysticks show their base + nub; opacity of controls adjustable (50–100%) — players' hands block the screen.
**Performance budget:** UI shares frame time — use texture atlases, avoid full-screen translucent stacks (overdraw), pool damage numbers/floating text, and keep HUD redraw static where possible (batteries, thermals).

### 4.9 Accessibility in games
Settings that must exist for a shippable game: **full remapping** (every verb, including hold→toggle for every hold action), **subtitle standards** (size 3 steps, background plate opacity, speaker names, direction arrows for off-screen speakers), **colorblind modes** (3 types + shapes/labels always), **screen-shake intensity slider**, **flash reduction**, **UI scale**, **aim/assist options** and QTE auto-complete, **high-contrast mode** (outlines + flat backgrounds for low vision), **audio** (separate SFX/music/voice + visual sound indicators for cues like footsteps), **dyslexia-friendly font option** and adjustable text spacing. Difficulty is NOT accessibility: difficulty scales the challenge; accessibility removes interface barriers. A player using colorblind mode + shake-off should still get the intended challenge. Test: play a full session with every accessibility option maxed and verify nothing becomes unreachable or unreadable.

### 4.10 Iconography & visual language
One icon style: consistent stroke weight, perspective, and silhouette; invent NOTHING for known verbs (gear = settings, crossed swords = combat, bag = inventory — conventions are free onboarding); every icon gets a label or tooltip (icon-only is for universally-known verbs only); rarity/status color coding ALWAYS paired with shape or text (Rule 3); icon grid spacing on the 8px system; export at 1x/2x/4x or SVG where the engine allows. When commissioning art (image-generator or an artist), the brief specifies: style refs, stroke weight, silhouette-first test (readable at 24px?), and the state variants needed (§4.6).

### 4.11 Anti-patterns gallery
HUD soup (8+ permanent elements) → requirements table + fade-when-stable. Color-only status → icon+label+color. Focus loss after list changes → neighbor-focus law (§4.4). Mouse-only console menus → gamepad-first rules. Unskippable logo splash chains → time-to-gameplay budget. Modal confirm during combat → real-time rules: no blocking dialogs in play. Settings only on the main menu → pause must open options (Rule 7). Tiny subtitles with no background → §4.3/§4.9. Pixel/display font for body text → display font for titles only, workhorse font for data. Control hints that vanish forever after the tutorial → permanent hint bar. Letterboxed HUD on ultrawide → tested safe zones across aspects. Damage-number spam uncapped → stack cap + aggregation. Silent disabled buttons → attempt feedback with reason. "It's in the manual/wiki" → in-UI cue at moment of need.

## 5. Code & Tool Templates

### 5.1 Web-game HUD with safe zones + health bar (working)
```html
<div id="hud">
  <div class="hud__health"><div class="hud__health-fill" style="width:72%"></div><span class="hud__label">HP 72</span></div>
  <div class="hud__ammo">AMMO <b id="ammo">12</b>/∞</div>
  <div class="hud__hints"><span class="key">SPACE</span> Jump <span class="key">ESC</span> Pause</div>
</div>
```
```css
#hud { position:fixed; inset:0; pointer-events:none; color:#fff;
  /* safe zone: max of 5% and device insets */
  padding: max(5%, env(safe-area-inset-top)) max(5%, env(safe-area-inset-right))
           max(5%, env(safe-area-inset-bottom)) max(5%, env(safe-area-inset-left));
  font: 700 clamp(16px, 2.2vh, 24px)/1.2 system-ui, sans-serif; }
.hud__health { position:absolute; left:0; bottom:0; width:min(26vw,320px); }
.hud__health-fill { height:14px; background:#e5484d; border:2px solid #000;
  box-shadow:0 0 0 2px rgba(255,255,255,.25); transition:width 150ms ease-out; }
.hud__label { font-size:.75em; text-shadow:0 2px 0 rgba(0,0,0,.8); }
.hud__ammo  { position:absolute; right:0; bottom:0; text-shadow:0 2px 0 rgba(0,0,0,.8); }
.hud__hints { position:absolute; left:50%; bottom:0; transform:translateX(-50%);
  opacity:.85; text-shadow:0 2px 0 rgba(0,0,0,.8); }
.key { display:inline-block; border:1px solid #fff; border-radius:4px; padding:0 .4em; margin:0 .4em; }
```

### 5.2 Gamepad-style focus/selection (web menus)
```css
.menu { display:flex; flex-direction:column; gap:12px; width:320px; }
.menu button { font:inherit; color:inherit; background:rgba(255,255,255,.06);
  border:2px solid transparent; padding:14px 18px; text-align:left; cursor:pointer; }
.menu button:hover { background:rgba(255,255,255,.12); }         /* mouse = focus */
.menu button:focus { outline:none; border-color:#7dd3fc; transform:scale(1.04); }
.menu button:focus-visible { outline:3px solid #7dd3fc; outline-offset:2px; }
/* JS: roving tabindex + arrow keys; on list change focus nearest index; play tick on focus. */
```

### 5.3 Godot 4 — safe area + anchor (GDScript)
```gdscript
# HUD root: full-rect Control. Attach to respect device safe areas (notches, TV overscan):
func _ready() -> void:
    var safe := DisplayServer.get_display_safe_area()
    var vp_size := Vector2(get_viewport().size)
    margin_left   = max(safe.position.x, vp_size.x * 0.05)
    margin_top    = max(safe.position.y, vp_size.y * 0.05)
    margin_right  = -max(vp_size.x - safe.end.x, vp_size.x * 0.05)
    margin_bottom = -max(vp_size.y - safe.end.y, vp_size.y * 0.05)
```

### 5.4 Unity uGUI — settings that matter
```csharp
// CanvasScaler on the HUD canvas: Scale With Screen Size, reference 1920x1080, match = 0.5 (width/height)
// Anchor EVERY element: health = anchorMin(0,0)+anchorMax(0,0)+pivot(0,0)+pos(24, 24)
// NEVER absolute center-anchored children of a full-screen canvas (they break on ultrawide).
var scaler = hudCanvas.GetComponent<UnityEngine.UI.CanvasScaler>();
scaler.uiScaleMode = UnityEngine.UI.CanvasScaler.ScaleMode.ScaleWithScreenSize;
scaler.referenceResolution = new Vector2(1920, 1080);
scaler.matchWidthOrHeight = 0.5f;
```

### 5.5 Damage number spawner (Canvas JS, pooled)
```js
const pool = Array.from({length: 20}, () => { const s = {x:0,y:0,vy:0,life:0,text:"",crit:false}; return s; });
function spawnDamage(x, y, amount, crit = false) {
  const s = pool.find(p => p.life <= 0); if (!s) return;        // stack cap: pool IS the cap
  Object.assign(s, {x, y, vy: -60, life: crit ? 1.0 : 0.7, text: String(amount), crit});
}
function updateDamage(dt, ctx) {
  for (const s of pool) if (s.life > 0) {
    s.life -= dt; s.y += s.vy * dt;
    ctx.font = `${s.crit ? 28 : 18}px system-ui`;
    ctx.lineWidth = 3; ctx.strokeStyle = "#000";
    ctx.globalAlpha = Math.min(1, s.life * 2);                   // fade out at the end
    ctx.strokeText(s.text, s.x, s.y); ctx.fillStyle = s.crit ? "#ffd166" : "#fff";
    ctx.fillText(s.text, s.x, s.y); ctx.globalAlpha = 1;
  }
}
```

### 5.6 Settings persistence schema (working)
```json
{
  "audio":   { "master": 0.8, "music": 0.6, "sfx": 0.9, "voice": 1.0 },
  "display": { "uiScale": 1.0, "fov": 90, "brightness": 0.5, "fullscreen": true },
  "controls":{ "invertY": false, "sensitivity": 1.0, "holdToToggleSprint": true,
               "bindings": { "jump": "Space", "crouch": "ControlLeft" } },
  "accessibility": { "colorblindMode": "deuteranopia", "screenShake": 0.3,
               "flashReduction": true, "subtitleSize": 2, "subtitleBackground": 0.6 },
  "gameplay":{ "difficulty": "standard" }
}
```
Save on every change (debounced 500ms); load with defaults-merge so new options appear after patches without corrupting old saves.

## 6. Decision Tables

### 6.1 UI class per information type
| Information | Class | Why |
|---|---|---|
| HP in combat | Non-diegetic (bar) | Precision + speed beats immersion |
| Poisoned status | Diegetic/spatial + label | Slow-burn info; immersion win |
| Objective location | Spatial marker | Belongs to a place |
| Took a hit | Meta (flash/vignette) + directional non-diegetic | Feeling + fact |
| Squad positions | Minimap (non-diegetic) | Constant spatial overview |
| Crafting recipe | Non-diegetic meta-screen | No time pressure; density affordable |

### 6.2 Health presentation
| Genre / pillar | Presentation | Note |
|---|---|---|
| Action/twitch | Bar + screen-edge blood (meta) | Glanceable; regen-friendly |
| Tactical/realistic | Number or segmented bar | Planning resource |
| Horror | Diegetic (body posture, blood) or hidden | Scarcity of info IS the fear |
| Roguelike | Bar + clear max/segments | Legibility beats theming |
| Party RPG | Rows of bars + numbers | Comparison matters |

### 6.3 Confirmation & interruption by pressure
| Context | Pattern |
|---|---|
| Real-time play | NO blocking dialogs; destructive = press-and-hold or double-tap with distinct sound |
| Turn-based / menus | Modal confirm OK; focus lands on the safe choice |
| Irreversible + severe (delete save) | Typed/name confirmation or hold-to-confirm with timer |
| Exit app on console | System-native confirm; "Quit to dashboard" |

### 6.4 Icon vs text vs both
| Situation | Choice |
|---|---|
| Known verb, tiny space (pause, mute) | Icon only, WITH aria/tooltip |
| Status effect | Icon + color + tooltip (label on hover/hold) |
| Currency/resource | Icon + number (icon IS the label) |
| Actions in item cards | Text buttons (verbs must be readable) |
| Ability bar | Icon + keybind glyph + cooldown overlay |

## 7. Quality Checklist

- [ ] Information requirements table exists; every HUD element traces to a row
- [ ] ≤5 permanent HUD elements during play; fade-when-stable implemented for the rest
- [ ] Safe-zone margins ≥5%; tested at 16:9, 16:10, 21:9 (nothing clipped anywhere)
- [ ] Gamepad-first: every screen navigable, confirm/back consistent, wrap-around lists
- [ ] Focus NEVER lost: after empty lists, consumed items, closed menus, tab switches (softlock-hunted)
- [ ] Time-to-gameplay ≤3 inputs from launch; pause→resume = 1 input
- [ ] Text sizes meet the distance table (TV ≥24–28px, desktop ≥14–16px); subtitles 28–32px with plate
- [ ] Every status/state readable in grayscale (no color-only information anywhere)
- [ ] Colorblind modes (protan/deutan/tritan) remap colors AND shapes; verified by playtest
- [ ] Every input/event gives audio+visual feedback ≤50ms; UI audio palette consistent (tick/confirm/cancel/error)
- [ ] Damage numbers capped + aggregated; directional damage indicator present where attacks come from off-screen
- [ ] Every verb has a persistent on-screen control hint; hints match the last-used input device
- [ ] All states designed: normal/focus/pressed/disabled/locked + item: selected/equipped/new/insufficient-funds + screens: empty saves/offline/corrupt
- [ ] Pause shows resume/options/save-state; options reachable from pause; brightness has a calibration image
- [ ] Accessibility set present (§4.9): remap + hold→toggle, subtitle options, shake/flash sliders, UI scale; difficulty decoupled
- [ ] Photosensitivity: no >3 flashes/sec; flash reduction option tested
- [ ] Touch builds: targets ≥60px, thumb-zone layout, notch/home-indicator safe areas
- [ ] Playtest with a new player completed: they found a verb, equipped an item, changed a setting — confusion points logged and fixed
- [ ] Localization margin: buttons/labels survive +30% text expansion without breaking layout

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---------|---------|-----|
| 1 | HUD soup | 10 permanent elements; players miss the important ones | Requirements table; fade-when-stable; ≤5 permanent (Rule 4) |
| 2 | Color-only states | Colorblind players read poison as buff | Icon+label+color, always; grayscale pass (Rule 3) |
| 3 | Focus lost on list change | Console players softlock after using the last item | Neighbor-focus law; focus the empty-state action (§4.4) |
| 4 | Mouse-first menus ported to console | Stick navigation fights wrap and tabs | Gamepad-first rules (Rule 1) |
| 5 | TV-edge HUD | Elements cropped on living-room TVs | 5% safe margins + aspect matrix test (Rule 2) |
| 6 | Tiny subtitles, no plate | "Can't follow dialogue" reviews | 28–32px + background opacity setting (§4.3/§4.9) |
| 7 | Display font for numbers/stats | Data unreadable mid-fight | Workhorse font for data; display font for titles only (§4.11) |
| 8 | Tutorial wall at minute zero | Players quit before play | Teach at first need; decay prompts (§4.7) |
| 9 | Settings only in main menu | Can't change volume mid-session | Pause opens Options (Rule 7) |
| 10 | Blocking dialogs during combat | Death-by-confirmation-window | Real-time rules: no modals in play (§6.3) |
| 11 | Silent disabled/locked buttons | "Is it broken?" | Attempt feedback: error sound + reason tooltip (§4.5) |
| 12 | Control hints that vanish after tutorial | Veterans of OTHER games stuck | Permanent hint bar; last-device glyphs (Rule 8) |
| 13 | Absolute-pixel HUD layout | Breaks on ultrawide/handheld/TV | Anchors + safe-area APIs + CanvasScaler (§5.3/§5.4) |
| 14 | Uncapped damage-number spam | Screen noise in big fights | Pool-as-cap + aggregation (§5.5) |

## 9. Advanced Techniques

### 9.1 Attention modeling for HUD
Rank elements by (read frequency × cost of missing) and place accordingly; favor peripheral-friendly encodings for background data — motion and position read peripherally, color next, text last (fovea-only). Validate with a glance test: show a gameplay screenshot for 500ms and ask "how much HP?" — if the answer needs >1 glance, the layout failed. Continuous HUD A/B: record session video, mark every HUD look, and try to cut the count by merging elements (ammo INTO the reticle, health INTO the character).

### 9.2 Diegetic-by-default conversions
Convert non-diegetic elements without losing clarity: health → body posture + blood overlay PLUS an optional bar in the accessibility settings (diegetic charm, non-diegetic fallback); ammo → magazine check animation plus HUD count; minimap → compass strip (less data, more immersion, cheaper screen space). Rule: diegetic versions must pass the same 500ms glance test at gameplay pace, or they stay optional.

### 9.3 Localization-safe game UI
Text expansion up to +30% (EN→DE) and contraction (EN→ZH is shorter but wider glyphs): buttons sized for the longest language with ellipsis banned on verbs; fonts must cover the glyph ranges shipped (CJK, Cyrillic, diacritics) — pick fonts by coverage, not vibes; RTL mirroring for Arabic/Hebrew (HUD flip decisions documented — minimap flips, health bar side is convention); voice-over subtitles separated from SFX captions by setting; never bake text into textures (untranslatable).

### 9.4 UI performance budget
UI shares the frame: texture atlas ALL HUD/menu sprites (one draw call per layer, not per icon); avoid full-screen translucent stacks (overdraw kills mobile GPUs); pool floating text/particles (§5.5); throttle HUD updates to change-events, not per-frame (set dirty flags); world-space UI (spatial markers) gets occlusion culling and distance LOD; test worst case: max effects + max entities + inventory open on min-spec hardware.

### 9.5 UI playtesting protocol
Four scripted tests with 3–5 first-time players, observed silently: (1) **First touch** — from cold launch, count inputs to gameplay and log hesitations; (2) **Verb find** — "open your map and place a marker" — measure time and wrong turns; (3) **Settings test** — "make subtitles bigger and turn off screen shake" — this tests the accessibility architecture; (4) **Pause test** — mid-combat pause → resume. Metrics: time-to-complete, misclicks, verbal confusion ("what does this icon mean?"). Every confusion is a design bug: fix the UI, never the player. Re-run after fixes; the protocol is cheap (<1 hour) and finds what the team is blind to.

### 9.6 Live-ops & meta UI without clutter
Battle passes, events, and stores push permanent badges onto the HUD — resist: budget them (≤1 persistent promo element, dismissible, never during combat), use the notification queue with a daily digest instead of real-time spam, and keep FOMO mechanics off the gameplay HUD (timer badges live in menus, not mid-fight). Measure: if promo HUD elements reduce session length or increase menu-open time without engagement, they are net negative — cut them.

## 10. Quick Reference Card

**The 9-step workflow:** pillars & verbs → information requirements table → UI mode map → layout (safe zones, anchors, clutter budget) → component specs with states → readability pass (distance/contrast/colorblind) → mockup & iterate → engine handoff (anchors, safe-area, input map) → QA (playtest + state walk + accessibility session).

**Laws:** gamepad-first, focus never dies · ≤5 permanent HUD elements, fade when stable · one glance <500ms · every input feedback ≤50ms · never color alone · TV text ≥24–28px · pause opens options · every verb has a hint bar · no blocking dialogs in real-time play · ≤3 flashes/sec.

**Standard anchors:** health BL · ammo/ resource BR · abilities BC · objectives TL · minimap/notifications TR · reticle center owns prompts & damage direction.

**Menu laws:** time-to-gameplay ≤3 inputs · Continue pre-focused · shoulder = tabs, B = back, everywhere · sliders show values · settings save on change with unsaved-guard.

**Accessibility set (shippable):** remap + hold→toggle · subtitle size/plate/speaker · colorblind modes with shapes · shake & flash sliders · UI scale · high contrast · difficulty decoupled.

**Handoff:** anchors not pixels · safe-area APIs · CanvasScaler/reference-resolution · input map documented · atlas + pooled UI · localization margin +30%.

