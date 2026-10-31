import type { SlideTemplate } from "./types.js";

/**
 * Pre-created slide projects that ship as reusable templates.
 *
 * Every slide is a complete, standalone HTML document designed for a 1280x720
 * (16:9) canvas. They are rendered inside a fixed-size, scaled iframe by the
 * frontend, so they use stable design coordinates rather than viewport units.
 *
 * Built-in templates are never persisted or mutated: they are merged into
 * list/read operations by the slide engine, and the panel can preview them but
 * not delete them.
 */

interface Palette {
  bg: string;
  panel: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  font: string;
}

const SLIDE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 1280px; height: 720px; overflow: hidden; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
    width: 1280px;
    height: 720px;
  }
  .slide {
    position: relative;
    width: 1280px;
    height: 720px;
    padding: 76px 88px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .kicker {
    font-size: 15px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 700;
    margin-bottom: 22px;
  }
  h1 {
    margin: 0;
    font-size: 76px;
    line-height: 1.03;
    letter-spacing: -0.035em;
    font-weight: 800;
  }
  h2 {
    margin: 0 0 30px;
    font-size: 48px;
    line-height: 1.08;
    letter-spacing: -0.03em;
    font-weight: 800;
  }
  p { margin: 0; }
  .sub {
    margin-top: 26px;
    max-width: 800px;
    font-size: 23px;
    line-height: 1.5;
    color: var(--muted);
  }
  .accent-line {
    width: 96px;
    height: 7px;
    border-radius: 999px;
    background: var(--accent);
    margin: 30px 0;
  }
  .grid { display: grid; gap: 22px; margin-top: 14px; }
  .grid.two { grid-template-columns: 1fr 1fr; }
  .grid.three { grid-template-columns: repeat(3, 1fr); }
  .card {
    background: var(--panel);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 22px;
    padding: 28px 30px;
  }
  .card .num {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.16em;
    color: var(--accent);
    margin-bottom: 14px;
  }
  .card h3 { margin: 0 0 12px; font-size: 25px; letter-spacing: -0.015em; }
  .card p { color: var(--muted); font-size: 18px; line-height: 1.45; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 13px 21px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accentFg);
    font-size: 18px;
    font-weight: 800;
  }
  .footer {
    position: absolute;
    left: 88px;
    right: 88px;
    bottom: 38px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.72;
  }
  .glow {
    position: absolute;
    border-radius: 999px;
    filter: blur(2px);
    opacity: 0.45;
  }
  .split { display: flex; flex: 1; gap: 60px; align-items: stretch; }
  .split > div { flex: 1; }
  .stat { font-size: 62px; font-weight: 800; letter-spacing: -0.05em; color: var(--accent); }
  .stat-label { margin-top: 8px; font-size: 17px; color: var(--muted); }
  .clean-list { margin: 20px 0 0; padding: 0; list-style: none; }
  .clean-list li {
    display: flex;
    gap: 16px;
    padding: 17px 0;
    border-top: 1px solid rgba(255,255,255,0.10);
    font-size: 21px;
    color: var(--muted);
  }
  .clean-list li strong { color: var(--fg); min-width: 150px; }
  .clean-list li:last-child { border-bottom: 1px solid rgba(255,255,255,0.10); }
`;

function slideDocument(title: string, palette: Palette, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1280, height=720" />
<title>${title}</title>
<style>
:root {
  --bg: ${palette.bg};
  --panel: ${palette.panel};
  --fg: ${palette.fg};
  --muted: ${palette.muted};
  --accent: ${palette.accent};
  --accentFg: ${palette.accentFg};
  --font: ${palette.font};
}
${SLIDE_CSS}
</style>
</head>
<body>
<div class="slide">
${body}
<div class="footer"><span>Mythgram</span><span>${title}</span></div>
</div>
</body>
</html>`;
}

const midnight: Palette = {
  bg: "#0a0e1a",
  panel: "rgba(255,255,255,0.055)",
  fg: "#f7f9ff",
  muted: "#a9b4cc",
  accent: "#7c9cff",
  accentFg: "#071022",
  font: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
};

const ember: Palette = {
  bg: "#14100d",
  panel: "rgba(255,255,255,0.06)",
  fg: "#fff8ef",
  muted: "#c9b8a6",
  accent: "#ff9b54",
  accentFg: "#241207",
  font: "'Georgia', 'Times New Roman', serif",
};

const paper: Palette = {
  bg: "#f4f1ea",
  panel: "rgba(20,25,32,0.055)",
  fg: "#18202b",
  muted: "#5c6878",
  accent: "#2457d6",
  accentFg: "#ffffff",
  font: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
};

const forest: Palette = {
  bg: "#0b1712",
  panel: "rgba(255,255,255,0.06)",
  fg: "#f2fff8",
  muted: "#a5c6b5",
  accent: "#54e0a0",
  accentFg: "#062016",
  font: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
};

function makeTemplate(
  id: string,
  name: string,
  description: string,
  palette: Palette,
  slides: Array<{ title: string; body: string }>,
): SlideTemplate {
  const now = 0;
  return {
    id,
    name,
    description,
    builtin: true,
    createdAt: now,
    updatedAt: now,
    slides: slides.map((slide, index) => ({
      slide_number: index + 1,
      title: slide.title,
      html: slideDocument(slide.title, palette, slide.body),
    })),
  };
}

const modernPitch = makeTemplate(
  "template-modern-pitch",
  "Modern Pitch Deck",
  "A confident dark-mode startup pitch deck: vision, problem, solution, and roadmap.",
  midnight,
  [
    {
      title: "Pitch Deck",
      body: `<div class="kicker">Company overview</div>
<h1>Build the future,<br />one clear idea<br />at a time.</h1>
<div class="accent-line"></div>
<p class="sub">A concise story for investors, partners, and early customers. Replace this copy with your product's narrative.</p>
<div style="margin-top:auto"><span class="pill">Presented with Mythgram</span></div>`,
    },
    {
      title: "The Problem",
      body: `<div class="kicker">Why now</div>
<h2>The work is important.<br />The tooling is not.</h2>
<div class="grid three">
  <div class="card"><div class="num">01</div><h3>Fragmented</h3><p>Teams stitch together five tools to finish one simple task.</p></div>
  <div class="card"><div class="num">02</div><h3>Slow</h3><p>Manual handoffs turn minutes of work into days of waiting.</p></div>
  <div class="card"><div class="num">03</div><h3>Opaque</h3><p>Decisions are buried in inboxes instead of being visible and shared.</p></div>
</div>`,
    },
    {
      title: "The Solution",
      body: `<div class="kicker">What we built</div>
<div class="split">
  <div>
    <h2>One workspace.<br />Every step.</h2>
    <p class="sub">A focused system that brings planning, execution, and review into a single flow.</p>
    <div class="accent-line"></div>
    <span class="pill">Start in minutes</span>
  </div>
  <div class="grid" style="margin:0; align-content:center">
    <div class="card"><div class="num">PLAN</div><h3>Clarity first</h3><p>Turn ambiguity into a short, measurable plan.</p></div>
    <div class="card"><div class="num">BUILD</div><h3>Momentum</h3><p>Execute with the right context always in reach.</p></div>
  </div>
</div>`,
    },
    {
      title: "Roadmap",
      body: `<div class="kicker">What happens next</div>
<h2>A deliberate path<br />to a durable product.</h2>
<ul class="clean-list">
  <li><strong>Q1</strong><span>Launch the core workflow to design partners.</span></li>
  <li><strong>Q2</strong><span>Add collaboration, permissions, and shared templates.</span></li>
  <li><strong>Q3</strong><span>Open the platform and scale go-to-market.</span></li>
</ul>`,
    },
  ],
);

const minimalReport = makeTemplate(
  "template-minimal-report",
  "Minimal Business Report",
  "A clean light report template for findings, metrics, and recommendations.",
  paper,
  [
    {
      title: "Business Report",
      body: `<div class="kicker">Quarterly review</div>
<h1>Clarity in every<br />number and decision.</h1>
<div class="accent-line"></div>
<p class="sub">A calm, readable report format for teams that want the signal without the noise.</p>
<div style="margin-top:auto; display:flex; gap:18px; align-items:center">
  <span class="pill">Prepared for leadership</span>
  <span style="color:var(--muted); font-size:17px">Replace this with your reporting period</span>
</div>`,
    },
    {
      title: "Agenda",
      body: `<div class="kicker">Today</div>
<h2>What we will cover.</h2>
<div class="grid two">
  <div class="card"><div class="num">01</div><h3>Highlights</h3><p>The three outcomes that matter most this period.</p></div>
  <div class="card"><div class="num">02</div><h3>Metrics</h3><p>What moved, what stalled, and what we learned.</p></div>
  <div class="card"><div class="num">03</div><h3>Risks</h3><p>Open issues, owners, and mitigation plans.</p></div>
  <div class="card"><div class="num">04</div><h3>Next steps</h3><p>Decisions requested and the path forward.</p></div>
</div>`,
    },
    {
      title: "Key Findings",
      body: `<div class="kicker">Signals</div>
<h2>Three findings<br />worth acting on.</h2>
<div class="grid three">
  <div><div class="stat">+38%</div><div class="stat-label">Retention among active teams</div></div>
  <div><div class="stat">-22%</div><div class="stat-label">Time to complete a core task</div></div>
  <div><div class="stat">4.7</div><div class="stat-label">Average satisfaction score</div></div>
</div>
<p class="sub">Replace these figures with your own data. Keep each finding tied to a decision.</p>`,
    },
    {
      title: "Recommendation",
      body: `<div class="kicker">Decision</div>
<h2>Focus the next cycle<br />on the strongest signal.</h2>
<ul class="clean-list">
  <li><strong>Invest</strong><span>Double down on the workflow with the clearest pull.</span></li>
  <li><strong>Simplify</strong><span>Remove low-value steps that slow teams down.</span></li>
  <li><strong>Measure</strong><span>Agree on one metric and review it every week.</span></li>
</ul>`,
    },
  ],
);

const productLaunch = makeTemplate(
  "template-product-launch",
  "Bold Product Launch",
  "A high-energy launch deck for announcing a product, its features, and impact.",
  ember,
  [
    {
      title: "Product Launch",
      body: `<div class="kicker">Introducing</div>
<h1>A new chapter<br />starts here.</h1>
<div class="accent-line"></div>
<p class="sub">Use this bold template to announce a product, a major release, or a new direction.</p>
<div style="margin-top:auto"><span class="pill">Now available</span></div>`,
    },
    {
      title: "The Shift",
      body: `<div class="kicker">Why it matters</div>
<h2>The old way<br />was never designed<br />for this moment.</h2>
<p class="sub">Frame the change your audience already feels. Then show why the timing is right.</p>`,
    },
    {
      title: "Features",
      body: `<div class="kicker">What is new</div>
<h2>Designed around<br />real work.</h2>
<div class="grid three">
  <div class="card"><div class="num">01</div><h3>Fast</h3><p>Move from idea to result without waiting on setup.</p></div>
  <div class="card"><div class="num">02</div><h3>Focused</h3><p>Everything you need, nothing you do not.</p></div>
  <div class="card"><div class="num">03</div><h3>Trusted</h3><p>Clear controls, reliable behavior, no surprises.</p></div>
</div>`,
    },
    {
      title: "The Impact",
      body: `<div class="kicker">Outcome</div>
<div class="split">
  <div>
    <h2>Less friction.<br />More progress.</h2>
    <p class="sub">Close with the outcome your audience cares about most, then invite them to act.</p>
  </div>
  <div style="display:flex; align-items:center; justify-content:center">
    <div class="card" style="width:100%; text-align:center; padding:52px 30px">
      <div class="stat" style="font-size:88px">10x</div>
      <div class="stat-label">Faster from idea to first result</div>
    </div>
  </div>
</div>`,
    },
  ],
);

const elegantPortfolio = makeTemplate(
  "template-elegant-portfolio",
  "Elegant Portfolio",
  "A refined portfolio deck for presenting selected work, experience, and contact details.",
  forest,
  [
    {
      title: "Portfolio",
      body: `<div class="kicker">Selected work</div>
<h1>Thoughtful design<br />for real people.</h1>
<div class="accent-line"></div>
<p class="sub">A quiet, confident portfolio template. Replace this line with your own point of view.</p>
<div style="margin-top:auto; font-size:17px; color:var(--muted)">Your name &nbsp;·&nbsp; Your role &nbsp;·&nbsp; Your location</div>`,
    },
    {
      title: "About",
      body: `<div class="kicker">About</div>
<div class="split">
  <div>
    <h2>I make complex<br />things feel simple.</h2>
    <p class="sub">Use this space for a short introduction: what you do, who you help, and how you work.</p>
  </div>
  <div class="grid" style="margin:0; align-content:center">
    <div class="card"><h3>Approach</h3><p>Start with the people, then shape the system around them.</p></div>
    <div class="card"><h3>Focus</h3><p>Product, interface, and the details that build trust.</p></div>
  </div>
</div>`,
    },
    {
      title: "Selected Work",
      body: `<div class="kicker">Case studies</div>
<h2>Three projects,<br />three outcomes.</h2>
<div class="grid three">
  <div class="card"><div class="num">01</div><h3>Replatform</h3><p>Rebuilt a critical flow and reduced drop-off by 31%.</p></div>
  <div class="card"><div class="num">02</div><h3>Design system</h3><p>Unified 40 screens into one consistent product language.</p></div>
  <div class="card"><div class="num">03</div><h3>Launch</h3><p>Shipped a new experience from concept to public release.</p></div>
</div>`,
    },
    {
      title: "Contact",
      body: `<div class="kicker">Let us talk</div>
<h2>Have a problem<br />worth solving?</h2>
<div class="accent-line"></div>
<p class="sub">Swap in your preferred contact details. Keep the invitation short and specific.</p>
<div style="margin-top:36px; font-size:26px; font-weight:700; color:var(--accent)">hello@example.com</div>`,
    },
  ],
);

/** Every built-in slide template, in display order. */
export const DEFAULT_SLIDE_TEMPLATES: SlideTemplate[] = [
  modernPitch,
  minimalReport,
  productLaunch,
  elegantPortfolio,
];