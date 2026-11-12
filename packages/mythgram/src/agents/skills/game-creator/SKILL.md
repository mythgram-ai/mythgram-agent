---
name: game-creator
description: >
  Game designer and builder for small-to-medium scope games that takes an
  idea from one-sentence core loop to a shipped, polished playable. It
  enforces scope discipline (one-mechanic rule, MVP list, explicit cut list),
  provides genre playbooks (platformer, top-down shooter, arcade dodger,
  breakout/snake, match-3, roguelike, idle, card game) with minimal feature
  lists and classic pitfalls, teaches design fundamentals (core loop, difficulty
  curves, player motivations, faucets/sinks economy, game juice), selects the
  tech (vanilla Canvas JS, Phaser 3, pygame, Godot 4, Unity) with hello-loop
  examples, and implements the real math: delta-time integration, vector ops,
  AABB and circle collision, paddle-reflection formulas, lerp and easing
  functions (quadOut, cubicOut, elasticOut, backOut), sprite animation state
  machines, hitbox generosity rules, pooled particle systems, audio layering
  (music -12dB under SFX), game state machines with pause-on-blur, versioned
  save systems, teach-then-test level design with a single difficulty config
  object, playtest protocols, and a polish checklist (input buffering, coyote
  time, fair first death). Includes a complete playable flappy-style game in
  ~150 lines of vanilla JS. Use this whenever the user says "make a game",
  "build a platformer/puzzle/arcade game", "make my game feel good",
  "balance difficulty", "add game feel or juice", "make a flappy/pong/snake
  clone", "design levels", or "ship my game to itch.io". Do NOT use it for
  utility apps — that is mobile-app-creator's job; for websites use
  website-creator; for generating art assets use image-generation.
---

# Game Creator

> Design AND build small-to-medium games: lock the scope, nail the core loop, make it feel good, ship it.

## 0. Operating Rules (Non-Negotiable)

1. ALWAYS define the core loop in ONE sentence before writing any code ("flap, dodge pipes, chase your score"). NEVER start with art, menus, or meta-features. Why: everything that doesn't serve the loop is scope creep in disguise.
2. MUST apply the one-mechanic rule for small games: one verb done deeply beats five done badly. Write the cut list (features explicitly OUT) next to the MVP list. Why: unfinished games die of feature creep, not lack of features.
3. MUST use delta-time physics (`position += velocity * dt`), with dt clamped (e.g., ≤ 1/30s). NEVER tie movement to frame count. Why: frame-rate independence; unclamped dt tunnels objects through walls after a lag spike.
4. MUST be generous to the player and harsh on enemies: player hitboxes smaller than sprites, enemy hitboxes full-size, off-screen spawns telegraphed or forbidden. Why: players forgive hard, never unfair — unfair deaths are the #1 quit reason in small games.
5. MUST put every tuning number (speed, gravity, spawn rate, HP, gap size) in ONE config object. NEVER scatter magic numbers through code. Why: balancing means editing one block; scattered constants make iteration impossible.
6. MUST implement: pause on blur/visibility change, mute toggle, restart that can never softlock, and skip for any intro. Why: these four are the difference between "junk" and "respectful of the player's time".
7. Platformers/jumpers MUST include input buffering (~100ms) and coyote time (~100ms). Why: players press jump milliseconds early/late constantly; buffering converts that from frustration into forgiveness, invisibly.
8. Audio MUST follow: one SFX per event with slight pitch variation, music −12dB under SFX, mute toggle persisted. NEVER let music and SFX fight at the same loudness. Why: muddy audio reads as amateur within seconds.
9. ALWAYS playtest by silent observation: watch, take notes, then ask "what did you want to do here?" — never explain controls mid-test. Why: every explanation during a test is a bug report you suppressed.
10. MUST teach every mechanic in safe context before testing it (teach → practice → combine → master). NEVER gate progress behind an undocumented mechanic. Why: a tutorial wall of text teaches nothing; safe failure teaches everything.
11. NEVER ship a first playable without a game-feel pass (juice: screenshake, flash, particles, easing). Why: the same mechanics with juice test 2–3× more fun in playtests; "game feel" is not optional polish.
12. MUST do a post-jam cleanup pass before shipping: remove debug, dead code, unused assets; verify restart, mute, and saves on a fresh load. Why: the last 5% is what separates itch.io features from accidents.

## 1. When to Use / When Not To

Use this skill when:
- Building any game: web canvas games, puzzle, arcade, platformer, roguelike, idle, card games
- Designing core loops, difficulty curves, scoring, economies, level structure
- Making games feel good: juice, animation, audio, game feel
- Shipping to itch.io or wrapping for mobile (Capacitor)

Do NOT use this skill when:
- The deliverable is a utility/productivity app → **mobile-app-creator**
- The deliverable is a website → **website-creator**
- The ask is for art assets (sprites, backgrounds, covers) → image-generation
- The ask is 3D AAA-scale production → still usable for design, but out of scope for the pipeline here

| Request contains | Route to |
|---|---|
| "App with forms and login" | mobile-app-creator |
| "Game", "levels", "score", "game feel" | **game-creator** (this skill) |
| "Generate sprite art / capsule art" | image-generation (then assemble here) |
| "Game promo website" | website-creator |

## 2. Core Concepts & Mental Models

- **The core loop**: verb → challenge → feedback → reward → motivation. If you cannot draw this cycle for your game in five boxes, the design isn't done. Every feature must feed a box.
- **Difficulty curve**: teach → practice → test → breathe, in intervals — a sawtooth, not a slope. Players need recovery valleys to consolidate skills; constant escalation reads as noise and burns players out by minute five.
- **Player motivations** (why they stay): mastery (get better — arcade, roguelike), fantasy (be something — simulations, RPG), story (see what happens next — narrative). Pick ONE primary motivation; a small game serving all three serves none.
- **Scoring & progression**: score is feedback for mastery motivation; progression (unlocks, new abilities) is the meta-loop that converts one good session into ten.
- **Economy — faucets vs sinks**: faucets create resources (coins per run), sinks remove them (upgrades, lives). Healthy economies have sinks slightly stronger than faucets late-game. Write both lists before adding a shop.
- **Game juice**: presentational effects (shake, flash, particles, squash & stretch, easing, sound layering) that make correct feedback feel physical. Juice never changes game state — it amplifies it.
- **State machine thinking**: menu / playing / paused / game-over (plus per-entity states: idle/run/jump/fall). Explicit states prevent the "ghost input after death" class of bugs.
- **Teach-then-test level design**: introduce a mechanic where failing is free → practice it → combine it with a known one → master it under pressure. Intervals of 2–4 encounters per mechanic.
- **Fairness budget**: every death must be attributable by the player to their own action. Telegraphed spawns, readable projectiles, no random instant death.

## 3. Mandatory Workflow

1. **Write the core loop** in one sentence. Post it at the top of the main source file. NEVER proceed without it.
2. **Write the MVP list + cut list.** MVP: 5–9 items, all must serve the loop (movement, obstacle, score, death, restart, juice, save best score). Cut list: everything named but out (multiplayer, meta-shop, story mode). Why: Rule 2; the cut list is a contract with yourself.
3. **Pick the genre playbook** (4.2) and steal its minimal feature list; add nothing day one.
4. **Pick the tech** from the Section 6 table (Canvas JS for jams/small web, Phaser for feature-complete web, pygame for desktop learning, Godot for serious 2D). Write the hello-loop (5.1–5.3) and get a rectangle moving under your control — before ANY art or menu.
5. **Prototype the verb.** Make the single core action feel good with placeholder rectangles: tight movement, correct physics dt, first juice (stretch on action, tiny shake on impact). Do not build content on a verb that feels bad.
6. **Add challenge + feedback**: obstacle/spawn system (config-driven), collision (4.5), score, death, restart. Keep all tunables in `CFG` (Rule 5).
7. **Build the state machine + saves**: menu/playing/paused/game-over, pause on blur, versioned save (5.7). Test every transition, including death during pause and blur during death.
8. **Content pass with the config object**: 5–10 levels/waves; apply teach-then-test pacing; difficulty ramps in intervals (4.9).
9. **Audio pass**: one SFX per event (pitch-varied), looping music at −12dB under SFX, mute persisted (4.7).
10. **Playtest protocol** (4.10): 3–5 players, silent observation, log confusion points; tune via config only; repeat until the first 60 seconds need zero explanation.
11. **Polish checklist** (Section 7): input buffering/coyote time if applicable, fair first death, transitions, no softlocks. Fix every failure.
12. **Ship**: web export to itch.io (zip with index.html; note SharedArrayBuffer needs), capsule + screenshots (describe-composed or generated), post-jam cleanup (Rule 12). For mobile, wrap with Capacitor and follow store rules from mobile-app-creator.

## 4. Deep Knowledge Library

### 4.1 Scope Discipline (the actual skill)

- One sentence, one mechanic, one screen. Small games succeed on depth-of-feel, never breadth-of-features.
- MVP litmus: "if I cut this, does the loop still function?" If yes, it's not MVP.
- Cut list examples (flappy-like): OUT = power-ups, skins shop, achievements, daily challenges, story. IN = flap, pipes, score, best score, juice, mute, restart.
- Time-box the prototype: 4–8 hours to "moving rectangle feels good". If the verb doesn't feel good with rectangles, cut or change the mechanic — art never fixes feel.
- Every new idea goes to a `IDEAS.md` file, not the codebase. Ideas are free; scope is not.

### 4.2 Genre Playbooks (mechanics → minimal feature list → classic pitfall)

| Genre | Core mechanics | Minimal v1 feature list | Classic pitfall |
|---|---|---|---|
| Platformer | run, jump (variable height), land | 1 mechanic + 8–12 short levels, checkpoints, coyote time, buffering | levels requiring the double-jump you haven't taught |
| Top-down shooter | aim/shoot, dodge, waves | one weapon, 3 enemy types, score, health, screen-clear on wave end | enemy HP inflation instead of new behaviors |
| Arcade dodger (flappy/runner) | one input, obstacles, score | spawn system, fair hitboxes, instant restart, best score | unfair off-screen spawns; input lag |
| Breakout/Snake | paddle/steer + bounce | bricks/snake body, angle-by-hit-position, lives, win/lose | ball speed unbounded → tunneling; no paddle english |
| Match-3 | swap, match-3+, cascade | grid, swap validation, cascade resolve, score, shuffle on deadlock | cascades without limits → infinite loops |
| Roguelike | procedural runs, permadeath | 1 character, 5+ items, 3 floors, save-on-exit only | item pool too shallow to create synergy stories |
| Idle/incremental | buy → number grows | 1 currency, 3 generators, offline earnings, big-number format | faucet/sink imbalance → prestigeless grind |
| Card game | hand, deck, turn | 20-card pool, energy system, 3 enemy encounters | too many keywords; no deck view |

### 4.3 Design Fundamentals

- Core loop diagram (draw it): **verb** (jump/shoot/match) → **challenge** (obstacle/enemy/board) → **feedback** (sound, flash, score) → **reward** (points, progress, unlock) → **motivation** (mastery/fantasy/story) → back to verb.
- Difficulty curve mechanics: introduce (safe), practice (repeatable, low cost of failure), test (combined pressure), breathe (valley). Ramp in **intervals** — each plateau lets skills consolidate. If your win-rate data shows a cliff (4.10), you drew a slope, not a sawtooth.
- Motivations: choose primary = mastery for arcade/puzzle, fantasy for sim/creative, story for narrative. Score serves mastery; unlocks serve fantasy; cliffhangers serve story.
- Economy: list faucets (coins/run: 30–80) and sinks (upgrade: 200/500/1200). If sinks drain faster than faucets mid-game, players stall; if never, the shop is decoration. Idle games: next-tier purchase should land every 30–90 seconds early on.
- Fairness: the first death should feel like the player's fault and happen ≤ 30 seconds in, with an instant retry. Losses must teach (visible cause) or they only frustrate.

### 4.4 Tech Selection

- **Vanilla JS + Canvas**: zero install, tiny, total control — jams, one-mechanic web games, learning. You build: loop, input, collision, audio (WebAudio), saves (localStorage). 5.1 hello-loop; 5.6 is a complete game.
- **Phaser 3**: feature-complete 2D web framework — physics engines (Arcade/Matter), tilemaps, tweens, particles, sound, scenes. Choose when the game needs real physics or scene management beyond ~300 lines.
- **pygame**: desktop Python; great for learning fundamentals, mediocre for shipping (packaging is painful). Choose for teaching/prototypes.
- **Godot 4 + GDScript**: free, serious 2D (and 3D) editor, scenes/nodes, signals, exports to web/desktop/mobile. The default for "a real small game".
- **Unity + C#**: 3D, mobile stores, console pipelines, huge asset ecosystem. Heavier than needed for one-mechanic games.
- Hello loops for Canvas (5.1), pygame (5.2), Godot (5.3) — always start by proving the loop runs before importing anything else.

### 4.5 Game Math (with the exact formulas)

- **Vectors**: add `a+b`, scale `a*s`, length `√(x²+y²)`, normalize `a/len` (guard len==0). Heading = normalized direction.
- **Integration (frame-rate independent)**: `pos += vel * dt; vel += acc * dt`; friction as `vel *= exp(-friction*dt)` (frame-count independent, unlike `vel *= 0.9` per frame).
- **Collisions**: AABB overlap test and circle-circle distance test — exact code in 5.4. Circle-vs-rect (player vs blocks): clamp circle center to rect, compare distance to radius (used in 5.6).
- **Paddle bounce (breakout)**: outgoing angle from hit position: `rel = clamp((ballX - paddleCenter)/(paddleHalf), -1, 1); angle = rel * 60°; vx = sin(angle)*speed; vy = -cos(angle)*speed` — always upward, never flat (5.8). "English": moving paddle adds a fraction of its velocity to the ball.
- **lerp**: `a + (b-a)*t` for smoothing (`x = lerp(x, target, 1 - exp(-k*dt))` for frame-rate-independent smoothing).
- **Easing (t ∈ [0,1])**: `quadOut = 1-(1-t)²`; `cubicOut = 1-(1-t)³`; `backOut = 1 + 2.70158*(t-1)³ + 1.70158*(t-1)²` (overshoot); `elasticOut` (springy) — full code in 5.4.
- **Spawn timers**: `spawnT -= dt; if (spawnT <= 0) { spawn(); spawnT = interval; }` with interval pulled from config.
- **Boundaries**: wrap (`(v%max+max)%max`) for loops like Snake/Asteroids; clamp for paddles/player bounds; bounce with restitution for balls (5.4).

### 4.6 Sprites, Animation & Hitboxes

- Sprite sheet: one image, fixed-size frames; draw via `ctx.drawImage(sheet, sx, sy, w, h, dx, dy, w, h)`. Pixel art animates at **8–12 fps** (crisper than interpolation for the style).
- Animation state machine per entity: `idle → run → jump → fall` with transitions on velocity/grounded flags; each state = frame range + fps. NEVER cross-fade pixel frames — switch hard.
- Hitboxes: player hitbox ≈ 60–80% of sprite (be generous); enemy/projectile hitboxes 100% (be strict). If it looks like a miss but registers, players call it cheating — because it is.
- Particles: pooled (fixed array, reuse dead particles — zero GC), each with life, velocity, gravity, fade; emit on impact/death/pickup. 5.5 is a complete pooled system.
- Squash & stretch: scale on impulse (jump stretch 1.15/0.9, land squash 0.9/1.1) recovering with `cubicOut` in ~150ms — the single cheapest "alive" feeling.

### 4.7 Audio Design

- SFX discipline: exactly one sound per event type; slight random pitch variation (±5–10%) prevents machine-gun monotony; never stack three sounds on one event.
- Loudness layering: music at −12dB relative to SFX (e.g., music gain 0.25 vs SFX gain 1.0 in WebAudio); master gain node for the mute toggle (persisted in settings).
- WebAudio pattern: one `AudioContext`, decode buffers at load, `playbackRate` for pitch variation; mobile requires unlocking the context on first user gesture (do it in the first tap handler).
- Feedback pairing: every juice event gets a sound (jump, land, score, death) — silence where feedback should be reads as broken input.

### 4.8 Game States, Saves & Settings

- Top-level state machine: `menu → playing → paused → gameover` (+ `dead` transition state for juice before gameover). Draw only the current state; update only when playing/paused-render. 5.6 implements it fully.
- **Pause on blur**: `visibilitychange` + window `blur` → auto-pause. NEVER let the player die while tabbed away.
- Saves: versioned JSON (`{v:1, best: 42, unlocked: 3}`) in localStorage (web) or file (desktop); reject unknown versions; corrupt/parserror → start fresh, never crash (5.7).
- Settings persisted: volume, mute, maybe reduced-flash mode. Load before first render to avoid flash-of-wrong-theme.
- Restart can NEVER softlock: restart resets ALL mutable state through one `reset()` function — the only sanctioned way (5.6).

### 4.9 Level Design & Difficulty Config

- Teach-then-test: encounter 1 = mechanic alone, safe; 2–3 = mechanic repeated; 4 = mechanic + known mechanic; 5 = mechanic under time/pressure; then breathe (empty valley, pickup, joke sign).
- Pacing/energy: alternate intensity; after a hard test, give a guaranteed-win stretch. Players remember peaks and valleys, not averages.
- Checkpoints: platformers every 60–120 seconds of progress; roguelike floors; arcade = none (score is the progress).
- **ONE config object** for all tuning (5.6's `CFG`): speed, gravity, spawn interval, gap, HP. Designers (you, later) tune the game by editing this object; the code never changes for balance. Difficulty modes = different config presets.

### 4.10 Balancing & Playtesting

- Metrics to watch: win rate per level (target ~60–80% for casual; watch for <30% cliffs), time-to-death, restart rate (high = engaging OR unfair — check which via video), funnel drop-offs (level 3 quit = level 3 is broken).
- Playtest protocol: 3–5 players; say "think aloud, I can't help"; watch silently and timestamp confusions; after each session ask "what did you want to do here?" and "when did you feel smart?"; change ONE thing between sessions.
- Symmetric vs asymmetric difficulty: symmetric (same rules, P1 vs P2) is self-balancing; asymmetric (player vs system) is where all tuning lives — only the system side is adjustable, so config object + playtest loop is the entire method.
- Tuning iteration order: (1) first 30 seconds, (2) the hardest wall found in tests, (3) late-game pacing. NEVER polish the credits screen before the first minute is right.

### 4.11 Juice Catalog (when to use what)

| Effect | Use when | Never when |
|---|---|---|
| Screenshake (2–6px, 100–200ms) | impacts, deaths, big scores | every frame; constant shake causes nausea |
| Hit flash (white 1–2 frames) | damage confirmation | as decoration |
| Particles (pooled, 8–32/event) | death, pickup, landing dust | high-frequency idle emission |
| Squash & stretch (150ms) | jumps, landings, launches | on UI elements |
| Easing on motion (cubicOut/backOut) | popups, score ticks, UI in/out | core gameplay input response |
| Hitstop (freeze 40–80ms) | big hits, kills | weak hits — it reads as lag |
| Sound layering (5.7) | every feedback event | decoration without an event |

### 4.12 Shipping & Post-Jam

- Web export: itch.io → zip the built folder with `index.html` at root; itch renders it in an iframe. If you use SharedArrayBuffer (some WASM builds), set itch's "SharedArrayBuffer" checkbox or the game won't boot — test the itch page itself.
- Mobile wrap: Capacitor (web → native shell) — fullscreen, orientation lock, and follow mobile-app-creator for signing/stores. Touch targets ≥ 48dp; test audio unlock on real devices.
- Capsule & screenshots: 616×353 capsule, 3–5 screenshots showing the loop (not menus); GIF of the verb in action outsells any description.
- Post-jam cleanup: remove debug overlays/logs, dead assets, unused libraries; verify fresh-load restart/mute/save; version tag (`v1.0`); then stop touching it.

## 5. Code & Tool Templates

### 5.1 Canvas + JS hello-loop (save as hello.html, open in a browser)

```html
<canvas id="c" width="480" height="320"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  const player = { x: 40, y: 40, vx: 120, vy: 90, r: 10 };
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);   // delta-time, spike-clamped
    last = now;
    player.x += player.vx * dt;                          // integrate BEFORE drawing
    player.y += player.vy * dt;
    if (player.x < 0 || player.x > 480) player.vx *= -1; // bounce off edges
    if (player.y < 0 || player.y > 320) player.vy *= -1;
    ctx.clearRect(0, 0, 480, 320);
    ctx.fillStyle = '#2563eb';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
</script>
```

### 5.2 pygame hello-loop (`pip install pygame` then `python hello_pygame.py`)

```python
import pygame
pygame.init()
screen = pygame.display.set_mode((480, 320))
clock = pygame.time.Clock()
player = pygame.Rect(40, 40, 20, 20)
vel = [120, 90]
running = True
while running:
    dt = clock.tick(60) / 1000                        # seconds since last frame
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
    player.x += vel[0] * dt
    player.y += vel[1] * dt
    if player.left < 0 or player.right > 480: vel[0] *= -1
    if player.top < 0 or player.bottom > 320: vel[1] *= -1
    screen.fill((17, 17, 17))
    pygame.draw.rect(screen, (37, 99, 235), player)
    pygame.display.flip()
pygame.quit()
```

### 5.3 Godot 4 hello-loop (attach to a Node2D, press F5)

```gdscript
extends Node2D

var vel := Vector2(120, 90)
var pos := Vector2(40, 40)
var bounds := Vector2(480, 320)

func _process(delta: float) -> void:
    pos += vel * delta                                 # delta = seconds since last frame
    if pos.x < 0 or pos.x > bounds.x: vel.x *= -1
    if pos.y < 0 or pos.y > bounds.y: vel.y *= -1
    queue_redraw()

func _draw() -> void:
    draw_circle(pos, 10.0, Color("2563eb"))
```

### 5.4 Math toolkit: vectors, collisions, easing, boundaries

```js
// math.js — the exact formulas, frame-rate independent
const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const vScale = (a, s) => ({ x: a.x * s, y: a.y * s });
const vLen = (a) => Math.hypot(a.x, a.y);
const vNorm = (a) => { const l = vLen(a) || 1; return { x: a.x / l, y: a.y / l }; };

// Integration with exponential friction (NOT per-frame multiplication)
function integrate(b, dt) {
  b.vx += b.ax * dt; b.vy += b.ay * dt;
  const f = Math.exp(-b.friction * dt);
  b.vx *= f; b.vy *= f;
  b.x += b.vx * dt; b.y += b.vy * dt;
}

const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const circleHit = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r; return dx*dx + dy*dy < r*r; };

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const quadOut = (t) => 1 - (1 - t) * (1 - t);
const cubicOut = (t) => 1 - Math.pow(1 - t, 3);
const backOut = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const elasticOut = (t) => t === 0 || t === 1 ? t
  : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;

const wrap = (v, max) => (v % max + max) % max;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function bounce1D(pos, vel, lo, hi, restitution = 0.8) {
  if (pos < lo) { pos = lo; vel = Math.abs(vel) * restitution; }
  if (pos > hi) { pos = hi; vel = -Math.abs(vel) * restitution; }
  return { pos, vel };
}
```

### 5.5 Pooled particle system (zero GC during play)

```js
const MAX = 256;
const pool = Array.from({ length: MAX }, () => ({ life: 0 }));
let cursor = 0;

function emit(x, y, { n = 10, speed = 120, color = '#fff', size = 3, life = 0.5, gravity = 300 } = {}) {
  for (let i = 0; i < n; i++) {
    const p = pool[cursor]; cursor = (cursor + 1) % MAX;      // recycle oldest
    const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random() * 0.5);
    Object.assign(p, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                       life, maxLife: life, color, size, gravity });
  }
}
function updateParticles(dt) {
  for (const p of pool) {
    if (p.life <= 0) continue;
    p.life -= dt; p.vy += p.gravity * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
function drawParticles(ctx) {
  for (const p of pool) {
    if (p.life <= 0) continue;
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
```

### 5.6 COMPLETE playable flappy-style game (vanilla JS, ~150 lines)

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Flap</title>
<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#111}canvas{max-width:100vw;max-height:100vh}</style>
</head><body>
<canvas id="c" width="360" height="640"></canvas>
<script>
'use strict';
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;

// 1. CONFIG — every tuning knob in one place (Rule 5)
const CFG = { gravity: 1400, flapVel: -420, maxFall: 650, pipeSpeed: 160,
              pipeGap: 170, pipeWidth: 60, pipeEvery: 1.6, groundH: 80 };

// 2. STATE MACHINE — menu / play / dead
const S = { MENU: 'menu', PLAY: 'play', DEAD: 'dead' };
let state = S.MENU, score = 0, best = +(localStorage.getItem('flap_best') || 0);
let bird, pipes, spawnT, shake, flashes, deadAt;

function reset() {                                  // the ONLY way state resets → no softlocks
  bird = { x: W * 0.28, y: H * 0.4, vy: 0, r: 14, rot: 0 };
  pipes = []; spawnT = 0; score = 0; shake = 0; flashes = [];
}

// 3. INPUT
function flap() {
  if (state === S.MENU) { reset(); state = S.PLAY; }
  else if (state === S.PLAY) bird.vy = CFG.flapVel;
  else if (state === S.DEAD && performance.now() - deadAt > 500) { reset(); state = S.PLAY; }
}
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); flap(); } });
cv.addEventListener('pointerdown', flap);
addEventListener('blur', () => { if (state === S.PLAY) { state = S.MENU; reset(); } }); // pause on blur

// 4. COLLISION — circle vs rect: clamp center, compare distance (generous hitbox: r-3)
function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw)), ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);          // juice easing

// 5. UPDATE — delta-time physics (Rule 3)
function update(dt) {
  if (state !== S.PLAY) return;
  bird.vy = Math.min(bird.vy + CFG.gravity * dt, CFG.maxFall);
  bird.y += bird.vy * dt;
  bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 600));

  spawnT -= dt;                                              // spawn timer from config
  if (spawnT <= 0) {
    spawnT = CFG.pipeEvery;
    const topH = 60 + Math.random() * (H - CFG.groundH - CFG.pipeGap - 120);
    pipes.push({ x: W + CFG.pipeWidth, topH, passed: false }); // always on-screen edge, telegraphed
  }
  for (const p of pipes) p.x -= CFG.pipeSpeed * dt;
  pipes = pipes.filter((p) => p.x + CFG.pipeWidth > 0);

  for (const p of pipes) {
    if (!p.passed && p.x + CFG.pipeWidth < bird.x) { p.passed = true; score++; shake = Math.min(shake + 2, 6); }
    if (circleRect(bird.x, bird.y, bird.r - 3, p.x, 0, CFG.pipeWidth, p.topH) ||
        circleRect(bird.x, bird.y, bird.r - 3, p.x, p.topH + CFG.pipeGap, CFG.pipeWidth, H)) return die();
  }
  if (bird.y + bird.r > H - CFG.groundH) return die();
  if (bird.y - bird.r < 0) { bird.y = bird.r; bird.vy = 0; }  // ceiling: clamp, no death

  for (const f of flashes) f.life -= dt;
  flashes = flashes.filter((f) => f.life > 0);
  shake = Math.max(0, shake - 20 * dt);
}
function die() {                                              // fair death: cause is always visible
  state = S.DEAD; deadAt = performance.now(); shake = 10;
  best = Math.max(best, score);
  localStorage.setItem('flap_best', best);
}

// 6. RENDER + JUICE
function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  ctx.fillStyle = '#70c5ce'; ctx.fillRect(-10, -10, W + 20, H + 20);
  ctx.fillStyle = '#5ec637';
  for (const p of pipes) {
    ctx.fillRect(p.x, 0, CFG.pipeWidth, p.topH);
    ctx.fillRect(p.x, p.topH + CFG.pipeGap, CFG.pipeWidth, H - p.topH - CFG.pipeGap - CFG.groundH);
  }
  ctx.fillStyle = '#ded895'; ctx.fillRect(-10, H - CFG.groundH, W + 20, CFG.groundH + 10);
  ctx.save();                                                // squash & stretch on flap
  ctx.translate(bird.x, bird.y); ctx.rotate(bird.rot);
  ctx.scale(1 - Math.min(Math.abs(bird.vy) / 3000, 0.12), 1 + Math.min(Math.abs(bird.vy) / 3000, 0.12));
  ctx.fillStyle = '#ffd83d'; ctx.beginPath(); ctx.arc(0, 0, bird.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -4, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (const f of flashes) {                                  // score pop rings
    ctx.globalAlpha = f.life / 0.35; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(f.x, f.y, 10 * easeOutCubic(1 - f.life / 0.35) + 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(state === S.MENU ? 'FLAP' : String(score), W / 2, 90);
  ctx.font = '16px sans-serif';
  if (state === S.MENU) ctx.fillText('tap or press space — best: ' + best, W / 2, 120);
  if (state === S.DEAD) ctx.fillText('best ' + best + ' — tap to retry', W / 2, H / 2 + 40);
  ctx.restore();
}

// 7. LOOP — dt clamped so tab-back spikes never tunnel collisions
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (score > 0 && pipes.length && pipes[pipes.length - 1].passed && Math.random() < 0.02)
    flashes.push({ x: bird.x, y: bird.y, life: 0.35 });
  update(dt); render();
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
</script>
</body>
</html>
```

### 5.7 Save system + settings + pause-on-blur

```js
// save.js — versioned JSON; corrupt saves start fresh, never crash
const SAVE_KEY = 'mygame_save_v1';
function saveGame(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, ...data })); }
  catch { /* storage full/blocked: game must still run */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.v === 1 ? data : null;   // reject unknown versions
  } catch { return null; }
}
const settings = Object.assign({ music: 0.25, sfx: 1.0, muted: false },
  loadGame()?.settings ?? {});
function saveSettings() { saveGame({ settings }); } // merge into your real save payload

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');   // NEVER die while away
});
addEventListener('blur', () => { if (state === 'playing') setState('paused'); });
```

### 5.8 Breakout paddle bounce + brick collision

```js
// Outgoing angle from WHERE the ball hits the paddle: rel ∈ [-1, 1]
function bounceOffPaddle(ball, paddle, speed = 420) {
  const rel = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
  const clamped = Math.max(-1, Math.min(1, rel));
  const maxAngle = Math.PI / 3;                       // 60°: never flat, never straight up
  ball.vx = Math.sin(clamped * maxAngle) * speed + paddle.vx * 0.15; // paddle "english"
  ball.vy = -Math.abs(Math.cos(clamped * maxAngle) * speed);         // ALWAYS upward
}
// Brick collision (AABB): resolve on axis of least penetration
function hitBrick(ball, b) {
  if (ball.x + ball.r < b.x || ball.x - ball.r > b.x + b.w ||
      ball.y + ball.r < b.y || ball.y - ball.r > b.y + b.h) return false;
  const l = ball.x + ball.r - b.x, r = b.x + b.w - (ball.x - ball.r);
  const t = ball.y + ball.r - b.y, bt = b.y + b.h - (ball.y - ball.r);
  const min = Math.min(l, r, t, bt);
  if (min === l) ball.vx = -Math.abs(ball.vx);
  else if (min === r) ball.vx = Math.abs(ball.vx);
  else if (min === t) ball.vy = -Math.abs(ball.vy);
  else ball.vy = Math.abs(ball.vy);
  return true;
}
```

## 6. Decision Tables

**Engine/tech choice**

| Situation | Tech | Why |
|---|---|---|
| Jam game, one mechanic, web | Vanilla JS + Canvas | zero install, zero abstraction tax, full control |
| Feature-rich web 2D (physics, tilemaps, scenes) | Phaser 3 | battle-tested arcade/matter physics, tween/particle systems |
| Learning fundamentals, desktop Python | pygame | immediate mode, readable, no build step |
| Serious 2D game, free tooling, exports everywhere | Godot 4 | editor, scenes/signals, web+desktop+mobile export |
| 3D, mobile store, console pipeline | Unity + C# | ecosystem, platform targets, hiring pool |

**Genre → must-have juice budget**

| Genre | Non-negotiable juice | Skip |
|---|---|---|
| Platformer | coyote time, buffering, squash/stretch, land dust | screenshake on every jump |
| Dodger/flappy | death shake, score pop, near-miss tick | heavy particles (readability) |
| Shooter | hit flash, hitstop on kills, muzzle flash | long particle bursts per bullet |
| Puzzle/match-3 | cascade easing, score tick, clear flash | shake (grid readability) |
| Roguelike | item pickup sting, floor transition fade | per-step animation |

**Difficulty knobs (single config object)**

| Knob | Easy preset | Normal | Hard | Effect |
|---|---|---|---|---|
| spawnInterval | 2.2s | 1.6s | 1.1s | obstacle density |
| speed | 130 px/s | 160 | 210 | pace |
| pipeGap | 200px | 170 | 140 | precision demand |
| playerHP | 3 | 2 | 1 | mistake budget |
| scoreMult | 0.8× | 1.0× | 1.5× | risk/reward |

**When to cut (scoping)**

| Signal | Action |
|---|---|
| Prototype verb not fun with rectangles | cut/change mechanic before investing content |
| Feature needs a new screen/system | push to cut list; revisit only post-v1 |
| Playtests stall at minute 2 | fix first minute; freeze all new features |
| 3+ "wouldn't it be cool if…" in one session | write to IDEAS.md; none enter the build |

## 7. Quality Checklist

Verify EVERY item before calling the game done:

- [ ] Core loop written in one sentence at the top of the main file
- [ ] MVP list and cut list exist; every shipped feature serves the loop
- [ ] All movement uses delta-time; dt clamped (≤ 1/30s); test on a 144Hz and a 30fps device
- [ ] Every tuning number lives in ONE config object; no magic numbers in logic
- [ ] Player hitbox smaller than sprite; enemy/projectile hitboxes exact
- [ ] No off-screen untelegraphed spawns; every death's cause is visible
- [ ] First death happens ≤ 30s in, feels fair, retry is instant
- [ ] Input buffering (~100ms) + coyote time (~100ms) if the game has jumping
- [ ] State machine complete: menu/playing/paused/game-over; all transitions tested
- [ ] Pause on blur AND visibility change; resume never skips a beat unfairly
- [ ] Restart works from every state via one reset() — no softlock possible
- [ ] Mute toggle persisted; music −12dB under SFX; one SFX per event with pitch variance
- [ ] Juice pass done: shake/flash/particles/squash & stretch used per the 4.11 table
- [ ] Teach-then-test pacing verified; first 60 seconds need zero explanation
- [ ] Difficulty ramps in intervals (sawtooth), tuned via config presets only
- [ ] Saves versioned, corrupt-save safe, best score persists across reload
- [ ] Playtested with 3–5 silent observers; logged confusions fixed or filed
- [ ] Post-jam cleanup: no debug output, no dead assets, fresh-load restart/mute/save verified
- [ ] itch.io build boots in the itch iframe itself (SharedArrayBuffer setting if needed)
- [ ] Capsule + 3–5 loop-showing screenshots uploaded

## 8. Common Mistakes & Fixes

1. **Mistake: feature creep.** Symptom: 80% complete forever; six half-systems, no game. Fix: cut list enforcement; new ideas go to IDEAS.md until v1 ships.
2. **Mistake: frame-count physics.** Symptom: game plays 2× faster on a 120Hz screen. Fix: delta-time everywhere (Rule 3); multiply every motion by dt.
3. **Mistake: unclamped dt.** Symptom: ball tunnels through the paddle after a lag spike/tab switch. Fix: `dt = min(dt, 1/30)`; continuous collision for fast small objects.
4. **Mistake: unfair off-screen spawns.** Symptom: "that was BS" — deaths with no visible cause. Fix: spawn telegraphs (arrows/flash), on-screen-edge spawns only, grace distance from the player.
5. **Mistake: tutorial wall.** Symptom: three text screens before the first input. Fix: teach in safe play (4.9); one hint line max, in-context.
6. **Mistake: difficulty by randomness.** Symptom: unfair-feeling spikes; win rate data noisy. Fix: difficulty from designed patterns (config presets), randomness only within fair bounds.
7. **Mistake: magic numbers scattered.** Symptom: every balance tweak is a code hunt; branches diverge. Fix: single CFG object (Rule 5); presets per difficulty.
8. **Mistake: full-size player hitbox.** Symptom: players clipped by pixels that "looked clear". Fix: 60–80% hitbox; test by flying into gaps that LOOK passable.
9. **Mistake: no pause on blur.** Symptom: return to a dead run because a Slack message arrived. Fix: 5.7 handlers; resume with a 3-2-1 countdown.
10. **Mistake: audio mud.** Symptom: music buries the SFX that carry feedback. Fix: −12dB layering (Rule 8); master mute; unlock AudioContext on first gesture.
11. **Mistake: softlocking restart.** Symptom: "Restart" leaves an enemy state (paused-within-dead). Fix: one `reset()` path; every transition ends in a coherent state; test death-during-pause.
12. **Mistake: shipping debug UI.** Symptom: FPS counters, debug rects in the itch build. Fix: debug flags behind `?debug=1`; post-jam cleanup pass (Rule 12).

## 9. Advanced Techniques

- **Input deep-dive**: buffer the jump input with a timestamp (`jumpPressedAt`) and consume it on landing if `now - jumpPressedAt < 100ms`; variable jump height by cutting upward velocity on release (`if (released && vy < -minJump) vy = -minJump`). These two lines make platformers feel professional.
- **Seeded randomness & loot**: seeded RNG (`mulberry32(seed)`) makes runs reproducible for bug reports and daily challenges; loot tables with weights (`item: weight` pairs, cumulative draw) plus pity timers (guaranteed rare after N misses) keep economies honest.
- **Object pooling beyond particles**: reuse bullets, enemies, and floaters from fixed arrays; zero allocations in the game loop means zero GC hitches — the difference between "buttery" and "stutters every few seconds" on low-end phones.
- **Procedural generation basics**: rooms via random walk on a grid with a minimum-distance constraint; levels as grammar (start → N challenge pieces → reward → exit); validate every generated level with the same teach-then-test rules before it ships.
- **Meta-progression & daily runs**: meta-currency that persists across deaths converts failure into progress (mastery loop extender); daily seeded run creates retention without new content — both are config + save changes, not new systems.
- **Mobile wrap with Capacitor**: `npx cap add android/ios`, lock orientation, map touch to the same input path, scale the canvas to the safe area, and follow mobile-app-creator for signing/stores; audio unlock and fullscreen quirk testing on real devices is mandatory.

## 10. Quick Reference Card

- Loop: **verb → challenge → feedback → reward → motivation**. One sentence before code.
- Physics: `pos += vel * dt`, dt clamped **1/30s**; friction `vel *= exp(-k*dt)`.
- Jump feel: buffer **~100ms**, coyote **~100ms**, variable height on release.
- Hitboxes: player **60–80%** of sprite; enemies 100%; fair first death ≤ 30s.
- Config object holds: speed, gravity, spawn interval, gap, HP — presets per difficulty.
- Paddle bounce: `angle = rel × 60°`, always upward, +15% paddle velocity "english".
- Easing: `quadOut`, `cubicOut`, `backOut` (overshoot), `elasticOut` (spring).
- Juice: shake 2–6px/100–200ms; flash 1–2 frames; particles pooled 8–32/event; hitstop 40–80ms.
- Audio: one SFX per event, pitch ±5–10%, music **−12dB** under SFX, persisted mute.
- States: menu/playing/paused/game-over; pause on blur; one reset() to rule them all.
- Saves: `{v:1, ...}` JSON, reject unknown versions, corrupt → fresh start.
- Levels: teach → practice → combine → master → breathe; checkpoints every 60–120s (platformers).
- Playtests: 3–5 players, silent, "what did you want to do here?", one change per session.
- Win-rate sanity: ~60–80% per level casual; a <30% level is a broken level.
- Ship: itch zip with index.html at root; 616×353 capsule; post-jam cleanup then freeze.

