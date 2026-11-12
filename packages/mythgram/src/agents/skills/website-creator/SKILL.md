---
name: website-creator
description: >
  Complete website builder that takes a project from requirements to a
  deployed, measured, production site. It runs the content-first process
  (content inventory before layout, sitemap, wireframe, build), routes to the
  right stack (pure HTML/CSS/JS static sites, Next.js/React app-like builds,
  headless CMS only when warranted), writes semantic HTML with complete heads
  (Open Graph, favicons, validation attributes), builds CSS systems (flexbox
  vs grid decisions, mobile-first breakpoints at 640/768/1024/1280, custom
  properties, prefers-color-scheme dark mode, clamp() fluid type, container
  queries), implements vanilla JS patterns (event delegation, fetch with
  loading/error states, IntersectionObserver, localStorage guards), and
  delivers accessibility (WCAG AA: contrast, keyboard, focus, labels, skip
  links), SEO (titles, meta descriptions, JSON-LD structured data, sitemaps,
  canonical URLs), and performance (WebP/AVIF pipelines, srcset/sizes, font
  loading, Core Web Vitals: LCP < 2.5s, CLS < 0.1, INP < 200ms). It also
  ships site-type blueprints section-by-section (landing, blog, portfolio,
  docs, dashboard, small ecommerce), contact forms with honeypot protection,
  and deployment to Vercel/Netlify with domains, caching headers, and
  post-launch analytics. Use this whenever the user says "build me a
  website", "make a landing page", "create a portfolio/blog/docs site",
  "improve my site's SEO or speed", "make it accessible", "fix my Lighthouse
  score", "add a contact form", or "deploy my site". Do NOT use it for native
  mobile apps — that is mobile-app-creator's job; for mobile design systems
  use mobile-app-designer; for games use game-creator; for slide decks or PDF
  documents use the slides/pdf skills.
---

# Website Creator

> Build complete websites from plan to deploy: content-first design, semantic code, WCAG AA accessibility, SEO, performance, and shipping.

## 0. Operating Rules (Non-Negotiable)

1. ALWAYS inventory real content BEFORE designing layout. NEVER use lorem ipsum as a design input. Why: layout must serve the actual copy; a headline that fits at 3 words breaks at 12, and redesigning after content arrives doubles the work.
2. NEVER add a framework the requirements don't need. A landing page is HTML+CSS+JS; Next.js earns its place only with app behavior, rich content collections, or data needs. Why: every framework adds build complexity, attack surface, and maintenance cost forever.
3. MUST use semantic HTML: one `h1`, landmark elements (`header`/`nav`/`main`/`footer`), lists as lists, buttons for actions and anchors for navigation. Why: semantics ARE the accessibility tree and half of SEO; divs throw both away.
4. MUST meet WCAG AA: contrast ≥ 4.5:1, full keyboard operation with visible focus, labels on every input, alt text on every image. NEVER remove focus outlines without a visible replacement. Why: it is a legal baseline in many jurisdictions and simply correct engineering.
5. MUST set explicit `width`/`height` (or `aspect-ratio`) on all images and video. Why: unsized media is the #1 cause of layout shift (CLS), a Core Web Vitals ranking factor.
6. MUST give every page a unique `<title>` ≤ 60 chars and meta description ≤ 155 chars, and exactly one `h1`. Why: titles/descriptions are the search listing; duplicates waste rankings, missing ones write themselves badly.
7. NEVER commit secrets or API keys. Use environment variables per environment (.env.local, host dashboard). Why: leaked keys are harvested by bots within minutes of pushing.
8. MUST provide loading, success, AND error UI for every form and fetch. NEVER leave a submit button dead or a blank area silent. Why: silence reads as breakage; users retry and double-submit.
9. MUST validate on the client (UX) AND the server (security); use a honeypot on public forms. Why: client validation is a courtesy, not a control; bots fill public forms relentlessly.
10. MUST test on a real phone and in a second browser engine before deploy. Why: your dev machine is wide, fast, and Chrome; your users are not.
11. MUST ship the launch kit: 404 page, favicon set, OG tags, sitemap.xml, robots.txt. Why: each missing piece is a visible defect in search results, link previews, or error moments.
12. MUST hit Lighthouse ≥ 90 in Performance, Accessibility, Best Practices, and SEO on key pages — or write down exactly why a metric is blocked. Why: the score is a reproducible QA gate, and each sub-90 category maps to real user pain.

## 1. When to Use / When Not To

Use this skill when:
- Building any website: landing page, marketing site, portfolio, blog, docs, dashboard, small store
- Improving an existing site's SEO, accessibility, performance, or Lighthouse score
- Adding forms, analytics, dark mode, or responsive behavior
- Deploying to Vercel/Netlify/static hosts with domains and caching

Do NOT use this skill when:
- The deliverable is a native mobile app → **mobile-app-creator**
- The ask is mobile UI/UX design artifacts → **mobile-app-designer**
- The product is a game → **game-creator**
- The deliverable is a slide deck or PDF document → slides/pdf skills
- The work is purely backend API with no user-facing site → backend/fullstack skills

| Request contains | Route to |
|---|---|
| "Native app", "App Store", "React Native" | mobile-app-creator |
| "Wireframes for my app", "design system" (mobile) | mobile-app-designer |
| "Website", "landing page", "blog", "Lighthouse", "SEO" | **website-creator** (this skill) |
| "Game", "canvas", "levels" | game-creator |

## 2. Core Concepts & Mental Models

- **Content-first**: copy is the raw material of design. Sitemap and wireframes are derived from the content inventory, never the reverse.
- **Progressive enhancement**: HTML works alone; CSS adds layout; JS adds behavior. If JS fails, content and forms still function. Why: resilience across devices, networks, and years.
- **Mobile-first CSS**: style the phone layout with no media query, then add complexity upward at breakpoints. Why: mobile is most constrained and most trafficked; upward overrides are shorter than downward ones.
- **The box model and layout ownership**: flexbox solves ONE axis (a row OR a column); grid solves TWO axes (rows AND columns together). Choosing wrong produces fragile hacks.
- **The accessibility tree**: browsers expose semantics to assistive tech; HTML elements come with roles for free, ARIA is a patch for when HTML can't express something. First rule of ARIA: don't use ARIA.
- **Request/response anatomy**: every asset is a request; latency is dominated by round trips and payload size. Performance work = fewer requests, smaller payloads, earlier critical requests, no render-blocking junk.
- **Caching layers**: browser cache (Cache-Control), CDN edge (hosts handle it), immutable hashed assets. "Never cache HTML, always cache fingerprints" is the whole policy.
- **Deploy = build output + static hosting**: for static sites the server is a file server with headers; dynamic behavior lives at the edge or in API routes.

## 3. Mandatory Workflow

1. **Requirements (30 min).** Write the goal ("generate leads for X"), audience, primary action per page, and constraints (deadline, brand, existing assets). MUST define the ONE primary conversion per page. Why: every later decision grades against this.
2. **Content inventory.** List every page with its real copy: headlines, body, images, CTA labels, legal text. Write/collect actual text FIRST. NEVER proceed with placeholders. Why: Rule 1.
3. **Sitemap.** Tree of URLs with the primary action per page. Keep marketing sites ≤ 7 top-level pages. Why: navigation mirrors this tree; more depth = more navigation debt.
4. **Wireframe.** Low-fidelity blocks per page, desktop + mobile, no color. Mark where the conversion happens. Why: structure debates must finish before style debates start.
5. **Visual direction.** Pick type scale, palette (with AA contrast pre-checked), spacing system, imagery. Small projects: a tokens.css file IS the design system (5.2).
6. **Choose the stack** via the Section 6 routing table; write one line of rationale. NEVER pick a framework by fashion.
7. **Build HTML first, page by page.** Semantic structure + full head (5.1) before any CSS. Validate forms with native attributes (5.1). Why: content in semantic HTML is already 70% accessible and SEO-ready.
8. **Style with the CSS system** (5.2): tokens, mobile-first, fluid type, dark mode. NEVER override specificity with !important chains.
9. **Add JS behavior** (5.3) only where HTML/CSS can't: fetches, validation UX, observers. Each enhancement keeps the page functional without it.
10. **Accessibility pass.** Keyboard-only walkthrough, focus visibility, labels, contrast audit, screen-reader smoke test. Fix before styling polish.
11. **SEO & performance pass.** Titles/descriptions, JSON-LD (5.5), sitemap/robots (5.8), image pipeline (5.6), Core Web Vitals check. Why: these compounds are cheap now, expensive after launch.
12. **Test: the Section 7 checklist** — links, forms (submit with empty/invalid/valid), console clean, real device, second browser, Lighthouse ≥ 90.
13. **Deploy** (5.8): push → build → host → domain DNS → SSL (automatic) → verify production with the same checklist on the live URL.
14. **Measure.** Analytics (privacy-respecting), uptime monitor, weekly Core Web Vitals review; iterate on the page with the worst conversion or score.

## 4. Deep Knowledge Library

### 4.1 Process: Content Inventory & Sitemap

Content inventory columns: page / purpose / headline / body blocks / media / CTA / SEO title / meta description / status (draft, final). The sitemap lists every URL, its parent, and its conversion. Marketing sites converge on: Home, Product/Features (1–3), Pricing, About, Blog, Contact. Docs converge on: home + sidebar tree + search. Write meta title/description in the inventory — they are content, not an afterthought.

### 4.2 Tech Routing

- **Pure static (HTML+CSS+JS)**: landing pages, portfolios, brochures, small docs. Zero build, fastest possible load, deploy anywhere. The default choice — complexity must be earned.
- **Next.js/React**: app-like interactions, per-page data fetching, hundreds of pages from content (blog/docs), image optimization pipeline, API routes for forms. Use when content is data or the UI is stateful.
- **Headless CMS** (Contentful, Sanity, or MDX in-repo): only when non-developers must publish regularly. Otherwise content-as-files is simpler and versionable.
- **Tailwind vs vanilla CSS**: Tailwind for fast iteration and design-system consistency in component frameworks; vanilla custom-properties CSS for small static sites and full control. Never mix paradigms in one project.

### 4.3 HTML Essentials

- Document skeleton and head order (charset → viewport → title → description → canonical → OG/Twitter → icons → CSS → preload) — 5.1 is the canonical template.
- Semantic landmarks: `header` (site identity + nav), `nav` (labeled when multiple: `aria-label="Primary"`), `main` (ONE per page, skip-link target), `article`/`section` (with headings), `aside`, `footer`.
- Heading order: one `h1`; descendants never skip levels (h1→h3 is a violation). Headings are the page outline — screen-reader users navigate by them.
- Forms: every input has a `<label for>`; native validation attributes (`required`, `type="email"`, `min`/`max`, `minlength`, `pattern`) give free UX in every browser; `autocomplete` attributes (`name`, `email`, `tel`) speed completion; buttons declare `type` explicitly.
- Meta/OG: OG image 1200×630; `og:url` canonical; Twitter `summary_large_image`. Favicon set: SVG + 32px PNG + apple-touch-icon 180×180 (5.1).

### 4.4 CSS System

- **Flex vs grid**: one-dimensional distribution (nav, button rows, card actions) → flexbox; two-dimensional layout (page shells, gallery with row/column alignment) → grid. Table in Section 6.
- **Breakpoints (mobile-first)**: base = phone; `@media (min-width: 640px)` large phone/landscape; 768px tablet; 1024px laptop; 1280px desktop cap. Content decides exact values — never design to devices.
- **Units**: `rem` for type and spacing (respects user settings), `%`/`fr` for layout, `ch` for measure — body text max-width ~65ch (readability ceiling), `px` only for borders/shadows.
- **Fluid type**: `font-size: clamp(1.5rem, 4vw, 3rem)` scales a headline from 24px→48px between viewports without breakpoints.
- **Custom properties theming**: `:root { --brand: #2563eb; }` consumed everywhere; dark mode redefines tokens under `prefers-color-scheme: dark` (5.2) — components never know the theme changed.
- **Container queries**: `@container (min-width: 400px)` styles a component by its CONTAINER's size, not the viewport — the right tool for reusable cards in variable columns.
- **Cheap animations**: animate only `transform` and `opacity` (compositor-only, no layout); transitions 150–300ms; honor `prefers-reduced-motion: reduce`.

### 4.5 Vanilla JS Patterns

Four patterns cover static sites (5.3 implements all): **event delegation** (one listener on a stable ancestor using `e.target.closest('[data-action]')` — survives dynamic DOM); **fetch wrapper** with loading/content/error tri-state and `res.ok` checks (fetch does NOT throw on 404/500); **IntersectionObserver** for reveal-on-scroll and lazy triggers (unobserve after firing); **localStorage JSON guard** (try/catch + shape check + fallback — corrupted storage must never crash the page). Discipline: `querySelector` with explicit selectors, no global mutation soup; each script has one job; behavior attached via `data-*` attributes, not class names.

### 4.6 Next.js / React Essentials

- Server Components (default in App Router) render on the server: fetch data directly, zero JS shipped for static parts; `'use client'` ONLY for interactivity (state, effects, events). Why: the less client JS, the faster INP/LCP.
- Routing: file-based (`app/blog/[slug]/page.tsx`); `loading.tsx` gives every segment a Suspense fallback; `error.tsx` is the recovery boundary (5.5); `not-found.tsx` the 404.
- Data: fetch in server components with `next: { revalidate: 3600 }` for ISR-style caching; mutations via API routes (`app/api/contact/route.ts`) or server actions.
- Metadata: `export const metadata = { title, description, alternates: { canonical } }`; per-page, never one global title.

### 4.7 Accessibility (WCAG AA Checklist)

- Alt text: informative images describe content and function; decorative images get `alt=""` (screen readers skip them); NEVER omit the attribute.
- Keyboard: every interactive element reachable and operable by Tab/Enter/Space in visual order; visible `:focus-visible` styles mandatory; skip link first in DOM (5.1/5.2).
- Labels: every input has a programmatic label; placeholder is never the label.
- Contrast: text ≥ 4.5:1 (≥ 3:1 large); check brand colors before committing them.
- Structure: landmarks, one h1, logical heading order, tables with `<th>` scope.
- ARIA only when HTML can't express it (tab widgets, live regions); a `role="alert"` region for errors, `aria-live="polite"` for status.
- Focus management: on modal open, focus moves in and is trapped; on close, focus returns to the trigger; on route change, focus moves to the new `h1`/main.
- Test with: keyboard only, 200% zoom, one screen-reader pass (VoiceOver/NVDA), automated axe scan.

### 4.8 SEO & Structured Data

- Title ≤ 60 chars: `Primary Keyword — Brand`; description ≤ 155 chars, one compelling sentence, unique per page. One h1 containing the primary keyword naturally.
- URL hygiene: lowercase, hyphens, stable slugs; canonical tag prevents duplicate-content splits (with/without trailing slash, query params).
- JSON-LD (5.5): `Organization` sitewide; `Article` on posts (headline, datePublished, author); `Product` with offers on commerce; `FAQPage` for FAQ sections. Validate in Google Rich Results Test.
- `sitemap.xml` lists canonical URLs; `robots.txt` points to it and blocks nothing important by accident (5.8).
- Internal links with descriptive anchor text ("read the pricing guide", never "click here").

### 4.9 Performance Pipeline

- Core Web Vitals targets: **LCP < 2.5s** — preload the hero image, serve it in AVIF/WebP, fast TTFB host, no render-blocking font script; **CLS < 0.1** — width/height on all media, no late-injected banners above content, `font-display: swap` with metric-compatible fallbacks; **INP < 200ms** — break long tasks (yield with `setTimeout`/scheduler), ship less JS, avoid layout thrash in handlers.
- Images: AVIF/WebP with JPEG fallback via `<picture>`; `srcset`/`sizes` for resolution switching; `loading="lazy"` below the fold only (never on the LCP hero); explicit dimensions (5.6).
- Fonts: ≤ 2 families, subset to used weights, `font-display: swap`, `preload` the primary WOFF2.
- JS/CSS: minify+bundle (hosts/builders do it), code-split per route in Next.js, defer non-critical scripts (`defer`), drop unused libraries — every KB of JS costs parse time on mid-range Android.
- Caching: hashed assets `Cache-Control: public, max-age=31536000, immutable`; HTML `no-cache`/`must-revalidate` (5.8).

### 4.10 Site-Type Blueprints (section-by-section)

- **Landing page**: hero (headline ≤ 10 words + subhead + one CTA + product visual) → social proof (logos/numbers) → features (3, icon+benefit+link) → how it works (3 steps) → testimonial (photo, name, result) → pricing (3 tiers, featured middle) → FAQ (accordion + FAQPage schema) → final CTA → footer (links, legal, contact). Every section answers one objection in sequence.
- **Blog**: index (list with title, date, excerpt, tags) → post (title, meta, prose, author box, related) → tag pages → pagination (or load-more with real links) → RSS feed. Content from MDX or a headless CMS; `Article` schema per post.
- **Portfolio**: work grid (thumbnail, title, one-liner) → case study (problem → process → outcome with numbers) → about (photo + story + skills) → contact (form or email CTA). Case studies are the product; the grid is just the shelf.
- **Docs**: sidebar tree (collapsible groups) + content pane + search + prev/next pager + "Was this helpful?" feedback. Keep every page under one heading tree; deep-link anchors for each h2.
- **Dashboard**: sidebar (primary nav) + topbar (search, account) → KPI cards (4–6, number + delta) → main chart → table (sortable, paginated, empty state). Dense but scannable; the KPI row is above the fold.
- **Small ecommerce**: catalog (grid + filters) → product (gallery, price, variants, add-to-cart) → cart (line items, totals) → checkout (contact → shipping → payment → review; guest checkout mandatory; one column; progress indicator). `Product` schema with offers; cart state in localStorage with a JSON guard.

### 4.11 Forms, Data & Deployment

- Forms (5.4): native validation attributes for UX, JS submit handler with `reportValidity()`, honeypot field hidden off-screen with `tabindex="-1"`, POST to an endpoint — static-form services (Formspree/Netlify Forms) for static sites, API route/server action for Next.js. Server MUST re-validate everything and reject honeypot fills silently (return 200 to not tip off bots).
- Success = visible confirmation + form reset; failure = inline `role="alert"` message with a human fallback (email address). NEVER alert() — style in-page states.
- Deployment: static host flow = connect repo → build command → output dir → deploy; hosts auto-issue SSL and give preview URLs per PR. Custom domain: DNS A/CNAME records per host docs; SSL automatic. Environment variables in the host dashboard — NEVER in the repo.
- Post-launch: analytics (Plausible/Fathom/GA4), uptime monitor, custom 404 page, weekly review of Vitals and top exit pages.

## 5. Code & Tool Templates

### 5.1 Canonical HTML boilerplate (semantic head, skip link, landmarks)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Primary Keyword — Brand</title>                    <!-- ≤ 60 chars, unique per page -->
  <meta name="description" content="One compelling sentence, 150–155 chars, unique per page.">
  <link rel="canonical" href="https://example.com/page">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Primary Keyword — Brand">
  <meta property="og:description" content="Same sentence as meta description.">
  <meta property="og:image" content="https://example.com/og-image.png"> <!-- 1200×630 -->
  <meta property="og:url" content="https://example.com/page">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png"> <!-- 180×180 -->
  <link rel="stylesheet" href="/styles.css">
  <link rel="preload" as="image" href="/hero.avif">          <!-- LCP hero only -->
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header>
    <a href="/" class="brand">Brand</a>
    <nav aria-label="Primary"><ul>…top-level links…</ul></nav>
  </header>
  <main id="main">
    <h1>Exactly one per page, primary keyword natural.</h1>
    <article>…</article>
  </main>
  <footer>…contact, legal, secondary links…</footer>
</body>
</html>
```

### 5.2 CSS foundation (tokens, mobile-first, dark mode, focus, cheap motion)

```css
/* styles.css — the whole design system for a small site */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; line-height: 1.5;
       color: #111827; background: #fff; }
img, video { max-width: 100%; height: auto; display: block; }

:root { --brand: #2563eb; --ink: #111827; --muted: #6b7280;
        --surface: #f9fafb; --measure: 65ch; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e6e6e6; --muted: #a1a1aa; --surface: #1e1e1e; }
  body { background: #121212; }
}

h1 { font-size: clamp(1.5rem, 4vw, 3rem); line-height: 1.2; } /* fluid type */
p  { max-width: var(--measure); }                              /* ~65ch readability cap */

.container { padding-inline: 1rem; }                            /* mobile-first base */
@media (min-width: 640px)  { .container { padding-inline: 2rem; } }
@media (min-width: 768px)  { .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; } }
@media (min-width: 1024px) { .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; } }
@media (min-width: 1280px) { .container { max-width: 1200px; margin-inline: auto; } }

:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; } /* NEVER remove without replacement */
.skip-link { position: absolute; left: -999px; }
.skip-link:focus { left: 1rem; top: 1rem; z-index: 10; background: #fff; padding: .5rem 1rem; }

/* Cheap animation: transform + opacity only, 150–300ms */
.reveal { opacity: 0; transform: translateY(16px);
          transition: opacity .3s ease-out, transform .3s ease-out; }
.reveal.is-visible { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .reveal { transition: none; opacity: 1; transform: none; }
}
```

### 5.3 Vanilla JS patterns (delegation, fetch tri-state, observer, storage guard)

```js
// site.js — the four patterns that cover 90% of static sites

// 1) Event delegation: one listener for many controls; survives DOM updates
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'toggle-menu') document.body.classList.toggle('nav-open');
});

// 2) Fetch with all three UI states: loading, content, error — fetch() does NOT throw on 404/500
async function loadPosts(container) {
  container.innerHTML = '<p aria-live="polite">Loading…</p>';
  try {
    const res = await fetch('/api/posts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = await res.json();
    container.innerHTML = posts.map((p) => `<article><h3>${p.title}</h3></article>`).join('');
  } catch {
    container.innerHTML = '<p role="alert">Couldn\'t load posts. <button data-action="retry">Retry</button></p>';
  }
}

// 3) IntersectionObserver: reveal-on-scroll; unobserve after firing (one-shot)
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
  }
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// 4) localStorage with a JSON guard: corrupt/absent data never crashes the page
function readJSON(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}
const prefs = readJSON('prefs', { mode: 'auto' });
```

### 5.4 Contact form: validation attributes + honeypot + in-page states

```html
<form id="contact" action="/api/contact" method="POST" novalidate>
  <label for="name">Name</label>
  <input id="name" name="name" required minlength="2" autocomplete="name">

  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autocomplete="email">

  <label for="msg">Message</label>
  <textarea id="msg" name="message" required minlength="10"></textarea>

  <!-- Honeypot: hidden from humans; bots fill it → server rejects silently -->
  <div aria-hidden="true" style="position:absolute;left:-9999px">
    <label>Leave this field empty<input name="website" tabindex="-1" autocomplete="off"></label>
  </div>

  <p id="form-status" role="status"></p>
  <button type="submit">Send message</button>
</form>
<script>
  const form = document.getElementById('contact');
  const status = document.getElementById('form-status');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;               // native messages per invalid field
    status.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      status.textContent = 'Thanks! We got your message.';
    } catch {
      status.textContent = 'Sending failed — please email hello@example.com.';
    }
  });
</script>
```

### 5.5 Next.js App Router page with loading + error boundaries

```tsx
// app/blog/page.tsx — Server Component by default
export const metadata = {
  title: 'Blog — Acme',
  description: 'Practical engineering notes from the Acme team.',
  alternates: { canonical: '/blog' },
};

async function getPosts() {
  const res = await fetch('https://api.example.com/posts', { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error('Failed to load posts');
  return res.json();
}

export default async function BlogPage() {
  const posts = await getPosts();
  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {posts.map((p: { slug: string; title: string }) => (
          <li key={p.slug}><a href={`/blog/${p.slug}`}>{p.title}</a></li>
        ))}
      </ul>
    </main>
  );
}

// app/blog/loading.tsx — automatic Suspense fallback for this segment
export default function Loading() { return <p aria-live="polite">Loading posts…</p>; }

// app/blog/error.tsx — recovery boundary (client component)
'use client';
export default function Error({ reset }: { reset: () => void }) {
  return <p role="alert">Something broke. <button onClick={reset}>Try again</button></p>;
}
```

### 5.6 JSON-LD structured data (Organization + FAQPage; Article/Product analogous)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "Acme Inc",
      "url": "https://example.com",
      "logo": "https://example.com/logo.png",
      "sameAs": ["https://github.com/acme", "https://x.com/acme"]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Do you offer refunds?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes — within 30 days, no questions asked." }
        }
      ]
    }
  ]
}
</script>
```

### 5.7 Responsive image pipeline (AVIF/WebP + srcset + explicit dimensions)

```html
<picture>
  <source type="image/avif"
          srcset="hero-480.avif 480w, hero-960.avif 960w, hero-1600.avif 1600w"
          sizes="(min-width: 1024px) 960px, 100vw">
  <source type="image/webp"
          srcset="hero-480.webp 480w, hero-960.webp 960w, hero-1600.webp 1600w"
          sizes="(min-width: 1024px) 960px, 100vw">
  <img src="hero-960.jpg"
       srcset="hero-480.jpg 480w, hero-960.jpg 960w, hero-1600.jpg 1600w"
       sizes="(min-width: 1024px) 960px, 100vw"
       width="1600" height="900"
       alt="Team reviewing a design wall"
       loading="lazy" decoding="async">
</picture>
<!-- width/height kill CLS; lazy ONLY below the fold; the LCP hero gets preload + eager instead -->
```

### 5.8 Deploy kit: robots.txt, sitemap.xml, caching headers

```txt
# robots.txt
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><priority>1.0</priority></url>
  <url><loc>https://example.com/blog</loc><priority>0.8</priority></url>
</urlset>
```

```json
// vercel.json — immutable hashed assets, always-revalidate HTML
{
  "headers": [
    { "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] }
  ]
}
```

## 6. Decision Tables

**Stack routing**

| Project | Stack | Why |
|---|---|---|
| Landing page, portfolio, brochure | HTML + CSS + vanilla JS | zero build, fastest load, nothing to maintain |
| Blog/docs with many pages, non-dev publishers | Next.js (+ MDX or headless CMS) | data-driven pages, image pipeline, metadata API |
| App-like site (dashboards, authed areas) | Next.js/React | state, components, API routes |
| Client needs to publish without devs | + headless CMS (Sanity/Contentful) | editorial workflow, no deploys for typos |
| Pure static but contact needed | static host forms (Formspree/Netlify Forms) | no backend to run |

**Flexbox vs Grid**

| Layout | Tool | Why |
|---|---|---|
| Nav bar, button rows, toolbar | Flexbox | one axis, content-driven sizing |
| Page shell (sidebar + content + footer) | Grid | two axes, fixed + fluid tracks |
| Card gallery aligned by row/column | Grid | alignment across both dimensions |
| Components inside a card | Flexbox | one-axis distribution |
| Masonry-ish variable content | Grid + container queries | per-container adaptation |

**Image format**

| Content | Format | Why |
|---|---|---|
| Photos | AVIF → WebP → JPEG fallback | smallest at photographic detail |
| Illustrations/icons/logos | SVG | infinitely scalable, tiny, stylable |
| Screenshots with text | WebP/PNG | crisp text needs lossless-ish |
| Animated short loops | WebM/AVIF sequence or video | GIFs are 5–10× heavier |

**Hosting**

| Need | Host pattern |
|---|---|
| Static site, free | GitHub Pages / Netlify / Cloudflare Pages |
| Next.js with ISR/API routes | Vercel (native support) |
| Custom domain | registrar DNS → host CNAME/A record; SSL automatic |
| Emails from forms | Formspree/Netlify Forms or an API route + mail provider |

## 7. Quality Checklist

Verify EVERY item before declaring a site done:

- [ ] Real copy everywhere; zero lorem ipsum or placeholder headings
- [ ] Every page: unique title ≤ 60 chars, description ≤ 155 chars, exactly one h1, canonical tag
- [ ] Semantic landmarks present; heading order never skips levels
- [ ] All images have alt text (informative or `alt=""` decorative) and explicit width/height
- [ ] Keyboard-only pass: everything reachable/operable, focus visible on every control, skip link works
- [ ] Contrast ≥ 4.5:1 checked for all text, including brand-colored buttons
- [ ] Every input has a label; forms validate natively and show success/error states inline
- [ ] Every fetch has loading, content, and error UI; no silent failures
- [ ] Dark mode renders correctly (token-based, not inverted)
- [ ] Tested on a real phone AND a second browser engine (e.g., Firefox/Safari)
- [ ] All links checked (no 404s, no dead anchors); 404 page exists and is styled
- [ ] Favicon set + OG tags present; link preview renders in a debugger (e.g., opengraph.xyz)
- [ ] Lighthouse ≥ 90 Performance/Accessibility/Best-Practices/SEO on home + a key inner page
- [ ] Core Web Vitals: LCP < 2.5s, CLS < 0.1, INP < 200ms on mid-range hardware
- [ ] Images in AVIF/WebP with srcset/sizes; hero preloaded; lazy loading below the fold only
- [ ] Fonts ≤ 2 families, subset, font-display: swap, primary preloaded
- [ ] sitemap.xml + robots.txt live and referencing the production domain
- [ ] JSON-LD validates in Rich Results Test (Organization at minimum)
- [ ] No console errors or 404'd assets in production
- [ ] Secrets only in host env vars; repo history clean of keys
- [ ] Analytics + uptime monitoring receiving data after deploy

## 8. Common Mistakes & Fixes

1. **Mistake: designing before content exists.** Symptom: final copy overflows every carefully drawn section. Fix: content inventory first; layout adapts to text.
2. **Mistake: framework overkill.** Symptom: a 3-page brochure needs `npm install` and 40s builds. Fix: static HTML/CSS/JS unless the Section 6 table says otherwise.
3. **Mistake: unstyled focus / removed outlines.** Symptom: keyboard users are lost instantly; axe violations. Fix: `:focus-visible` styles shipped with the reset (5.2).
4. **Mistake: missing error states.** Symptom: fetch dies and the section stays blank forever. Fix: tri-state loader (5.3); form status region (5.4).
5. **Mistake: giant unoptimized hero images.** Symptom: LCP 6s+, mobile users bounce. Fix: AVIF/WebP + srcset + preload; 1600px max for a 960px slot.
6. **Mistake: images without dimensions.** Symptom: page jumps as images load (CLS). Fix: width/height attributes everywhere (5.7).
7. **Mistake: placeholder as label.** Symptom: users forget what each field was once typing starts; screen readers announce nothing. Fix: real `<label for>` on every input.
8. **Mistake: one `<title>` for all pages.** Symptom: search results and browser tabs all read "Home". Fix: per-page metadata; template pattern in Next.js.
9. **Mistake: client-only validation.** Symptom: spam and malformed data reach the inbox/API. Fix: server re-validation + honeypot (Rule 9).
10. **Mistake: `alert()` for feedback.** Symptom: jarring, blocks the thread, unstyleable. Fix: in-page status regions with `role="status"`/`role="alert"`.
11. **Mistake: no 404 page.** Symptom: broken links land on an ugly server default; trust drops. Fix: styled 404 with search/nav escape hatches.
12. **Mistake: secrets in client bundles.** Symptom: API keys visible in View Source; quota theft. Fix: keys live server-side (API route proxy) or in env vars consumed only at build.
13. **Mistake: div soup.** Symptom: screen reader announces nothing useful; SEO crawlers guess. Fix: semantic elements first, ARIA only as a patch.

## 9. Advanced Techniques

- **Container queries in depth**: `container-type: inline-size` on the wrapper, `@container (min-width: 420px)` inside — cards reflow by their own slot, so the same card works in a sidebar (stacked) and a grid (horizontal) with no viewport media queries.
- **View Transitions API**: `document.startViewTransition()` for smooth same-document morphs (image → detail page) with graceful degradation in unsupported browsers; in Next.js, experimental `viewTransition` config for cross-document navigations.
- **Service worker offline shell**: cache-first for hashed assets, network-first for HTML, offline fallback page — a static site becomes installable and airplane-proof with ~40 lines (Workbox precaching does the heavy lifting).
- **Edge functions/ISR blend**: static for 95% of pages, `revalidate` tags for content that changes, edge middleware for geo-aware redirects — the cost/perf sweet spot for content sites.
- **Analytics without bloat**: server-side or privacy-first scripts (Plausible/Fathom, < 1KB), event taxonomy mirroring the conversion map, and a weekly dashboard review — measure the funnel, not vanity pageviews.
- **Internationalization**: `hreflang` alternates per locale, translated slugs (keep them stable), locale-aware dates via `Intl.DateTimeFormat`, and RTL direction switching via `dir="rtl"` with logical properties (`margin-inline-start`) instead of left/right.

## 10. Quick Reference Card

- Process: **requirements → content → sitemap → wireframe → stack → HTML → CSS → JS → a11y → SEO/perf → test → deploy → measure**.
- Vitals: **LCP < 2.5s** (preload hero, fast host), **CLS < 0.1** (dimensions on media), **INP < 200ms** (less JS, yield long tasks).
- Breakpoints: **640 / 768 / 1024 / 1280**, mobile-first; body measure ≤ **65ch**; fluid type `clamp(1.5rem, 4vw, 3rem)`.
- SEO: title ≤ **60**, description ≤ **155**, one h1, canonical, JSON-LD (Organization/Article/Product/FAQ), sitemap + robots.
- A11y: contrast **4.5:1**, labels on every input, visible focus, skip link, alt text always present, ARIA only when HTML can't.
- JS: delegation via `data-action`, fetch with `res.ok` check + tri-state UI, IntersectionObserver one-shot, localStorage JSON guard.
- Forms: native validation attrs + `reportValidity()` + honeypot + server re-validation.
- Images: AVIF/WebP → JPEG fallback, `srcset`/`sizes`, lazy below fold only, hero preloaded.
- Fonts: ≤ 2 families, subset, `font-display: swap`, preload primary.
- Caching: hashed assets `max-age=31536000, immutable`; HTML `must-revalidate`.
- Launch kit: 404, favicons, OG, sitemap, robots, analytics, uptime monitor.
- Lighthouse gate: **≥ 90** in all four categories on key pages.

