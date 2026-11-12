---
name: image-generator
description: >
  AI text-to-image generation and image-editing operating manual. Builds
  production-ready prompts with subject-first anatomy, chooses the correct
  size and aspect ratio for the destination, calls generation APIs (SDK and
  REST, Node and Python) with retry and backoff, saves and verifies output
  files, runs multi-candidate iteration with locked style blocks for series
  consistency, and inspects results for artifacts before delivery. Use this
  whenever the user asks to: create, generate, make, draw, design, or render
  an image, picture, photo, illustration, artwork, avatar, icon, banner, hero
  image, background, wallpaper, poster, flyer, product mockup, texture,
  pattern, mascot, character, logo concept, scene, thumbnail, or "AI art";
  rewrite or strengthen a weak image prompt; produce a consistent series, icon
  set, or character sheet; edit, retouch, inpaint, extend, or restyle an
  existing image; or create artwork to embed in blogs, slides, ads, or
  documents. Also use when the user says "text-to-image", "generate an image
  of", "I need a visual for", "make me a banner, wallpaper, or icon", or
  pastes a rough prompt expecting better results. Do NOT use for: video or
  motion clips — that is video-generator's job; spoken narration —
  voice-response's job; music — music-generator's job; assembling images into
  finished PDF/PPTX files — pdf-creator and pptx-creator's job; describing or
  analyzing existing images — use a vision skill instead.
---
# Image Generator
> Turn any brief into production-ready AI images through disciplined prompt anatomy, size-by-destination planning, multi-candidate iteration, and strict output inspection.

## 0. Operating Rules (Non-Negotiable)

1. NEVER deliver the first generation as the final answer. ALWAYS generate 2-4 candidates and pick the best — diffusion output is stochastic, and selection is where deliverable quality actually comes from.
2. ALWAYS decide the output size from the DESTINATION (slide, banner, avatar, poster) BEFORE writing the prompt. Aspect ratio drives composition; regenerating at the correct size is cheap, reshaping afterwards is not.
3. NEVER stretch, squash, or crop an image to force an aspect ratio. Stretching distorts faces and circles; blind cropping destroys composition and cuts subjects. ALWAYS regenerate at the target size instead.
4. ALWAYS front-load the subject and follow the anatomy order: subject → attributes → action/pose → environment → composition → style → lighting → quality tags. Models weight earlier tokens more heavily, so late placement dilutes what matters most.
5. NEVER ask the model to render more than 3 short words of text inside an image. Rendered text is the most common diffusion failure; either avoid text or generate clean negative space and overlay real text in post with a design tool.
6. ALWAYS change exactly ONE variable per iteration (style block OR lighting OR composition OR subject detail). Changing three things at once makes improvement unattributable and turns the next iteration into a guess.
7. ALWAYS reuse the identical "style block" string verbatim across every image in a series, and reuse seed values where the API exposes them. A single changed adjective (e.g. "warm" → "cool") breaks visual consistency across the whole set.
8. ALWAYS wrap API calls in retry with exponential backoff (3 attempts: 2s, 4s, 8s) and handle the empty-result case explicitly. Image APIs fail transiently with 429/5xx and sometimes return `data: []` with HTTP 200.
9. ALWAYS save images to disk with a descriptive filename (`purpose_size_style_vN.png`) and verify real dimensions and file integrity before presenting anything. An image that fails to open or is 512px instead of 1792px is a silent failure the user will discover in production.
10. NEVER generate real-person likenesses for deception, NEVER reproduce copyrighted characters or watermarked styles for commercial use, and ALWAYS disclose AI-generated imagery when the publishing context requires it.
11. ALWAYS inspect every candidate for the classic diffusion failure modes — hands, eyes, teeth, limb count, gibberish text, warped straight lines — before delivery. One six-fingered hand destroys trust in the entire deliverable.
12. ALWAYS deliver the exact prompt text together with the file. The prompt is the reproduction recipe; without it the user cannot request variants or regenerate a lost asset.

## 1. When to Use / When Not To

**Use this skill when the user:**
- wants any still image created from a description: "make a hero banner about teamwork", "generate a cozy coffee shop illustration", "I need a background for my slide".
- pastes a weak or vague prompt ("a dog", "make it look nice") and expects a rewritten, stronger prompt plus candidates.
- requests a consistent set: icon collection, onboarding illustration series, character sheet, palette-locked scene set.
- asks to edit an existing image: inpaint an object out, restyle a photo, extend a background, img2img variation of a draft.
- needs artwork assets produced as the first step of a larger job (blog post, slide deck, ad, PDF, video thumbnail).

**Route away when the request is really about:**

| The request mentions | Correct skill | Why |
|---|---|---|
| video, animation, motion clip, footage, b-roll | video-generator | moving images are a separate pipeline with ffmpeg assembly |
| music, song, soundtrack, audio bed, jingle | music-generator | audio generation and loudness mastering |
| voice, narration, speech, "read this aloud", TTS | voice-response | spoken voice synthesis, not imagery |
| "put these images into a PDF / slide deck" | pdf-creator / pptx-creator | document assembly — generate the images HERE first, then hand over |
| "what is in this image", OCR, captioning, compare | vision/analysis skill | interpretation of existing media, not generation |
| "just crop/resize/compress this file" | local tools (Pillow, ImageMagick, sharp) | pure post-processing needs no generation call |

## 2. Core Concepts & Mental Models

- **Diffusion generation.** The model starts from random noise and repeatedly denoises it while being steered by text embeddings. The prompt is a steering vector, not a database query: it biases, it does not fetch. This is why vague prompts produce vague averages.
- **Token order = token weight.** Early tokens set the dominant subject; trailing tokens nudge texture and finish. A prompt that buries its subject at the end gets a muddled image.
- **Stochasticity and candidates.** The same prompt produces different images on each call unless a seed is fixed. Quality practice is generating a small batch (2-4) and selecting, not hoping one call lands.
- **Size is composition.** A 1024x1024 canvas wants centered subjects; 1792x1024 wants lateral flow and negative space; 1024x1792 wants vertical stacking. Choosing size after generating wastes the generation.
- **The style block.** A reusable, verbatim string of style/lighting/quality descriptors appended to every prompt in a series. It is the contract that keeps ten images looking like one campaign.
- **Negative instructions.** Diffusion models handle negation poorly ("no text" can still summon text). Prefer positively specifying what you DO want, and additionally append explicit negatives ("no text, no watermark, no letters") where the API supports a negative-prompt field.
- **img2img strength.** The dial between source and prompt: low strength (0.3) preserves structure and changes texture; high strength (0.8) approaches text-to-image with the source as rough layout.
- **Text rendering is a known weakness.** Models paint letter-shaped squiggles. Plan for post-production text overlay as the default.
- **File pipeline.** b64 payload → decode → disk → verify dimensions → optimize/downscale → deliver. Every skipped verification step pushes errors downstream to the user.

## 3. Mandatory Workflow

1. **Parse the brief.** Extract: subject, purpose/destination (blog hero? slide? avatar? poster?), desired style, constraints (palette, no text, brand colors). MUST identify the destination — if genuinely ambiguous, ask one clarifying question — because destination decides size (Rule 2) and size decides composition.
2. **Choose size from the destination table (§4.5).** NEVER guess. A slide is 16:9 (1792x1024), an avatar is 1024x1024, a phone wallpaper is 1024x1792.
3. **Build the prompt in anatomy order (§4.1).** Subject first; append composition, style fragment, lighting, quality tags. MUST include "no text, no watermark" negatives for any image that will carry real text later.
4. **Lock the style block for series work.** Write the style fragment once as a constant and reuse it verbatim in every prompt of the set (Rule 7). Record the seed if the API supports seeds.
5. **Generate 2-4 candidates** through the API with retry/backoff (§5.1, §5.2). NEVER proceed on an empty `data` array — retry, then fail loudly with the API error text rather than pretending success.
6. **Save and verify.** Write files with the naming convention (§4.9), then programmatically check dimensions and decodability before inspection.
7. **Inspect every candidate** against the artifact checklist (hands, eyes, text, anatomy, prompt adherence, palette fit). Use a vision model or the user's eyes; NEVER ship uninspected output (Rule 11).
8. **Iterate one variable at a time.** Re-run with exactly one changed slot (e.g. swap lighting "overcast diffuse" → "golden hour"). Keep a log of prompt → result verdict so progress is attributable.
9. **Deliver:** final file(s) at correct size/format, downscaled web version when needed, the exact prompt used, and the size/settings. The delivered bundle must let anyone reproduce or fork the result.

## 4. Deep Knowledge Library

### 4.1 Prompt Anatomy — Order Is Weight

Fill the slots in this exact order; earlier slots dominate the image:

| Slot | Question it answers | Examples |
|---|---|---|
| 1. Subject | WHAT is pictured | "a wet golden retriever puppy", "a ceramic ramen bowl" |
| 2. Attributes | subject qualities | "steam rising, chopsticks lifting noodles", "mustard knit sweater" |
| 3. Action / pose | what is happening | "shaking off water", "resting her chin on her hand" |
| 4. Environment | where | "on a misty lake dock", "dark slate restaurant table" |
| 5. Composition | framing/camera | "medium close-up, rule of thirds, shallow depth of field" |
| 6. Style | rendering family | "photorealistic, 85mm lens" or "flat vector illustration" |
| 7. Lighting | light design | "golden hour backlight", "soft window light from the left" |
| 8. Quality tags | finish boosters | "high detail, sharp focus, natural textures" |

Weak prompt → strong prompt transformations (note the subject never moves from the front):

| Weak prompt | Strong prompt |
|---|---|
| "a dog" | "A wet golden retriever puppy shaking off water, droplets frozen mid-air, on a misty lake dock, medium close-up, shallow depth of field, photorealistic, 85mm lens f/1.8, golden hour backlight, natural fur texture, high detail" |
| "company banner" | "Abstract flowing gradient waves in deep navy and electric teal, smooth silk surface, wide composition with clear negative space on the left third for headline overlay, soft studio lighting, premium corporate style, no text, no watermark" |
| "cute robot icon" | "Minimalist line-art robot head icon, single-weight rounded strokes, geometric shapes, centered on flat pastel mint background, flat vector style, no gradients, no text" |
| "food photo" | "Overhead shot of a rustic ceramic bowl of ramen, steam rising, chopsticks lifting noodles, dark slate table, scattered scallions, soft window light from the left, shallow depth of field, food photography, 50mm macro, high detail" |
| "isometric city" | "Isometric miniature city block at dusk, pastel palette, tiny glowing windows, soft ambient occlusion, clean vector edges, centered on a plain light background, flat illustration style, no text" |
| "person thinking" | "Medium shot of a young woman in a mustard sweater resting her chin on her hand, looking up-left with a faint smile, cozy bookshelf office softly blurred behind her, warm window light, natural skin texture, editorial photography, 85mm f/1.8" |

### 4.2 Style Vocabulary Tables — Ready-to-Copy Fragments

| Family | Copy-paste style fragment | Use for |
|---|---|---|
| Photoreal | "photorealistic, shot on 85mm lens, f/1.8, shallow depth of field, natural skin texture, subtle film grain, high detail" | product shots, editorial, banners |
| Illustration | "flat vector illustration, bold clean outlines, limited 5-color palette, geometric shapes, subtle paper grain, no gradients" | icons, slides, explainers, UI art |
| 3D render | "3D render, octane render, subsurface scattering, soft studio HDRI lighting, matte pastel materials, gentle ambient occlusion, 4k product shot" | mockups, mascot, tech branding |
| Painterly | "watercolor wash, soft bleeding edges, visible cold-press paper texture, loose expressive brushwork, muted palette" | editorial art, invitations, mood pieces |
| Graphic | "minimalist line art, single continuous stroke weight, monochrome on white, generous negative space" | logos, diagrams, austere branding |
| Anime / manga | "anime key visual, cel shading, crisp linework, vibrant colors, dramatic sky, expressive eyes, studio-quality finish" | characters, fan-style art, posters |
| Pixel art | "16-bit pixel art, limited 32-color palette, crisp pixels, dithered shading, no anti-aliasing" | game assets, retro motifs |

### 4.3 Composition & Camera Vocabulary

| Term | Effect | Prompt fragment |
|---|---|---|
| Rule of thirds | subject off-center, dynamic | "rule of thirds composition, subject on right third" |
| Centered symmetrical | formal, iconic | "centered symmetrical composition" |
| Close-up | face/detail intimacy | "close-up shot" |
| Medium shot | waist-up context | "medium shot" |
| Wide shot | environment scale | "wide establishing shot" |
| Overhead | flat-lay, map feel | "overhead bird's-eye view" |
| Low angle | power, monumentality | "low angle looking up" |
| POV | immersion | "first-person point of view" |
| Shallow depth of field | subject pops | "shallow depth of field, f/1.8" |
| Bokeh | creamy background orbs | "creamy bokeh background" |
| Leading lines | eye guided to subject | "leading lines converging on the subject" |
| Negative space | room for text overlay | "large clean negative space on the left for text" |

### 4.4 Lighting Vocabulary

| Term | Mood / use | Prompt fragment |
|---|---|---|
| Softbox studio | clean commercial | "softbox studio lighting, even shadows" |
| Rim light | dramatic separation | "strong rim light outlining the subject" |
| Golden hour | warm, nostalgic | "golden hour sunlight, long warm shadows" |
| Overcast diffuse | honest, catalog-clean | "overcast diffused daylight, soft shadows" |
| Chiaroscuro | moody, fine-art | "chiaroscuro lighting, deep shadows, single key light" |
| Volumetric rays | cinematic atmosphere | "volumetric light rays through haze" |
| Neon glow | night, cyber, nightlife | "neon glow, magenta and cyan practical lights, wet reflections" |
| Window light | natural interiors | "soft window light from the left, gentle falloff" |

### 4.5 Sizes, Aspect Ratios & Destination Map

ALWAYS choose size by destination. NEVER alter ratio after generation.

| Destination | Size | Why |
|---|---|---|
| Blog hero banner | 1792x1024 | wide header, fits full-width layouts without cropping |
| Slide background / 16:9 illustration | 1792x1024 | matches 16:9 slide canvas exactly |
| Wide email/web header | 1440x720 | 2:1 strip, sits under a nav bar |
| Avatar / profile picture | 1024x1024 | square, crop-safe, centered face |
| Icon set | 1024x1024 | downscales cleanly to 64/128/512 px |
| Phone wallpaper / story | 1024x1792 | matches 9:16 screens |
| Poster / flyer | 1024x1792 | portrait print ratio |

### 4.6 Text in Images — The Standing Rule

- Default: NO text inside the image. Append "no text, no watermark, no letters, no typography" to the prompt.
- If the user insists on in-image text: keep it to ≤3 short words (e.g. "SALE", "OPEN") and accept retries; verify legibility letter by letter.
- Best practice: generate clean negative space (§4.3) and overlay real text in a design tool or HTML canvas — crisp, editable, translatable.
- For logos: generate a logo CONCEPT, not a final logo; real logos need vector work.

### 4.7 Iteration Protocol & Series Consistency

1. Generate batch of 2-4 → inspect → record verdicts.
2. Pick the best; identify the ONE thing to change (style block, lighting, composition, subject attribute).
3. Re-run with that single change. Repeat until it passes the checklist.
4. Series consistency: define the style block ONCE, reuse verbatim, keep seed fixed where supported, and keep the same size for every image in the set. Example locked block: `"flat vector illustration, bold 4px rounded outlines, palette: deep navy #0A2540, teal #14B8A6, coral #F97362, cream #FFF8F0, generous margins, no text, no watermark"`.
5. A "character" is kept consistent by repeating their descriptor word-for-word: "a 30-year-old courier with round glasses, short black hair, teal cap" — identical string in every prompt.

### 4.8 Image Editing: img2img, Inpainting, Edit vs Regenerate

- **img2img strength bands:** 0.2-0.4 = texture/light retouch, structure preserved; 0.5-0.7 = restyle or object swap; 0.8-1.0 = near regeneration, source is only a layout hint.
- **Inpainting:** provide the source image + a mask (white = repaint this region, black = keep) + an instruction describing ONLY the masked region ("replace the potted plant with a stack of vintage books"). Masks MUST match the source dimensions.
- **Edit when:** the composition is right but a detail is wrong (one object, background, color mood). **Regenerate when:** composition, subject identity, or pose is wrong — editing cannot fix a broken skeleton.

### 4.9 File Handling: Formats, Naming, Verification, Downscaling

| Format | Use when | Avoid when |
|---|---|---|
| PNG | flat-color graphics, icons, transparency, text overlays, screenshots | huge photographic files (bloat) |
| JPG | photographs, gradients, hero imagery, web delivery | transparency or hard graphic edges (halos) |

- Naming: `purpose_size_style_vN.ext` → `blog-hero_1792x1024_photoreal_v2.png`. NEVER deliver `image(3).png`.
- Decode: Python `base64.b64decode(b64)`; Node `Buffer.from(b64, 'base64')`.
- Verify: Python `Image.open(f).size`; shell `identify -format "%wx%h" f.png`; `file f.png`.
- Downscale for web delivery: Pillow `im.thumbnail((1600,1600), Image.LANCZOS)`; ImageMagick `convert in.png -resize 1600x1600\> out.png`; Node `sharp(...).resize(1600,1600,{fit:'inside'})`.

### 4.10 Worked Example Briefs

1. **Blog hero banner** — Prompt: "Abstract flowing gradient waves in deep navy and electric teal, smooth silk surface, wide composition with clean negative space on the left third, soft studio lighting, premium corporate style, no text, no watermark". Size 1792x1024, JPG for delivery. Used as a full-width header; overlay the headline in post.
2. **Slide illustration** — Prompt: "Isometric team of three people assembling a giant jigsaw puzzle, flat vector illustration, bold 4px rounded outlines, palette: deep navy #0A2540, teal #14B8A6, coral #F97362, cream #FFF8F0, generous margins, no text". Size 1792x1024, PNG. Sits right of a bullet list on a 16:9 slide.
3. **Product mockup** — Prompt: "Matte white cosmetic pump bottle standing on a travertine stone pedestal, water droplets, softbox studio lighting, soft gradient beige backdrop, centered composition, 3D render, octane render, subsurface scattering, high detail, no text". Size 1024x1024, PNG. E-commerce card; label added in post.
4. **Icon set brief** — One locked style block (§4.7) + per-icon subjects: "a paper plane", "a bar chart", "a shield with a checkmark". Size 1024x1024 each, PNG, identical seed if available. Delivered at 512/128/64 px.
5. **Character sheet** — Prompt: "Character reference sheet of a 30-year-old courier with round glasses, short black hair, teal cap, orange jacket, front view and side view, neutral pose, plain light gray background, flat vector illustration, bold outlines, no text". Size 1024x1024. The descriptor string is reused verbatim for every future scene with this character.
6. **Texture background** — Prompt: "Seamless texture of hand-painted terracotta tiles, warm muted palette, soft daylight, even lighting, no shadows, no text, high detail". Size 1024x1024. Tiled via CSS `background-repeat`; even lighting is what makes tiling invisible.

### 4.11 Ethics & Policy

- NEVER fabricate a real person's likeness for deception, endorsement, or defamation.
- NEVER prompt for living artists' signature styles presented as authentic, or for trademarked characters in commercial deliverables.
- Respect watermarks: NEVER ask the model to remove or reproduce them.
- Disclose AI generation when content is published in journalistic, advertising, or stock contexts.
- Keep output brand-safe: no hateful, sexual, or violent content in professional deliverables.

## 5. Code & Tool Templates

### 5.1 Node (SDK style, z-ai-web-dev-sdk) — generate, retry, save

```js
// generate.mjs — Node 18+. Run: node generate.mjs "PROMPT" 1792x1024 out.png
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs/promises';

const PROMPT = process.argv[2];
const SIZE = process.argv[3] ?? '1024x1024';
const OUT = process.argv[4] ?? `image_${SIZE}_${Date.now()}.png`;

if (!PROMPT || !PROMPT.trim()) {
  console.error('Empty prompt — refusing to call the API.');  // Rule: fail fast
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate() {
  const zai = await ZAI.create();
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await zai.images.generations({ prompt: PROMPT, size: SIZE });
      const item = res?.data?.[0];
      if (!item) throw new Error('Empty result: API returned no image data');
      const b64 = item.base64;
      if (!b64) throw new Error('Response missing base64 payload');
      await fs.writeFile(OUT, Buffer.from(b64, 'base64'));   // decode + save
      console.log(`Saved ${OUT} (${SIZE})`);
      return OUT;
    } catch (err) {
      lastErr = err;
      const wait = 2000 * 2 ** (attempt - 1);                // 2s, 4s, 8s
      console.warn(`Attempt ${attempt} failed: ${err.message}. Retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

generate().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

### 5.2 Python (generic REST, requests) — same contract

```python
# generate.py — Run: python generate.py "PROMPT" 1792x1024 out.png
import base64, os, sys, time
import requests

API_URL = os.environ["IMAGE_API_URL"]        # e.g. https://api.example.com/v1/images/generations
API_KEY = os.environ["IMAGE_API_KEY"]
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

def generate(prompt: str, size: str = "1024x1024", out: str | None = None) -> str:
    if not prompt.strip():
        raise ValueError("Empty prompt — refusing to call the API")
    out = out or f"image_{size}_{int(time.time())}.png"
    payload = {"prompt": prompt, "size": size, "n": 1, "response_format": "b64_json"}
    last = None
    for attempt in range(3):
        try:
            r = requests.post(API_URL, json=payload, headers=HEADERS, timeout=120)
        except requests.RequestException as e:           # network layer
            last = e; time.sleep(2 * 2 ** attempt); continue
        if r.status_code == 200:
            data = r.json().get("data") or []
            if not data:
                raise RuntimeError("Empty result: API returned no image data")
            b64 = data[0].get("b64_json")
            if not b64:
                raise RuntimeError("Response missing b64_json field")
            with open(out, "wb") as f:
                f.write(base64.b64decode(b64))           # decode + save
            return out
        if r.status_code in (429, 500, 502, 503, 504):   # transient -> backoff
            last = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
            time.sleep(2 * 2 ** attempt)
            continue
        r.raise_for_status()                             # 4xx: do not retry blindly
    raise RuntimeError(f"All retries failed: {last}")

if __name__ == "__main__":
    print("Saved:", generate(
        sys.argv[1],
        sys.argv[2] if len(sys.argv) > 2 else "1024x1024",
        sys.argv[3] if len(sys.argv) > 3 else None))
```

### 5.3 Series generation with a locked style block (Python)

```python
STYLE_LOCK = ("flat vector illustration, bold 4px rounded outlines, "
              "palette: deep navy #0A2540, teal #14B8A6, coral #F97362, cream #FFF8F0, "
              "generous margins, no text, no watermark")          # reused VERBATIM

SCENES = {
    "onboarding": "A person planting a small tree in a pot",
    "dashboard":  "A person pointing at floating bar charts",
    "handoff":    "Two people passing a glowing folder between desks",
}
for name, subject in SCENES.items():
    prompt = f"{subject}, {STYLE_LOCK}"                # subject first, style identical
    generate(prompt, size="1792x1024", out=f"onboarding_{name}_1792x1024_v1.png")
```

### 5.4 img2img / inpainting payload shapes (adapt field names to your API)

```python
# img2img: strength is the distance dial from the source image
img2img = {"prompt": "same scene, now at night with warm interior lights",
           "image": b64_of_source, "strength": 0.45,
           "size": "1024x1024", "response_format": "b64_json"}

# inpainting: mask (white=repaint, black=keep) must match source dimensions
inpaint = {"prompt": "replace the potted plant with a stack of vintage books",
           "image": b64_of_source, "mask": b64_of_mask,
           "size": "1024x1024", "response_format": "b64_json"}
```

### 5.5 Verify + optimize deliverables (Pillow)

```python
# postprocess.py — verify dimensions, make JPG + thumbnail
from PIL import Image

im = Image.open("blog-hero_1792x1024_photoreal_v2.png")
assert im.size == (1792, 1024), f"Wrong dimensions: {im.size}"     # never skip
im.convert("RGB").save("blog-hero_1792x1024_v2.jpg", "JPEG", quality=88, optimize=True)
thumb = im.copy(); thumb.thumbnail((800, 800), Image.LANCZOS)
thumb.save("blog-hero_800_thumb.jpg", "JPEG", quality=85)
```

### 5.6 ImageMagick one-liners (shell)

```bash
identify -format "%f  %wx%h  %b\n" blog-hero_1792x1024_v2.png        # dimensions + bytes
convert blog-hero_1792x1024_v2.png -resize 800x800\> blog-hero_800_thumb.jpg
convert icon_1024x1024_v1.png -resize 512x512 -resize 128x128 -resize 64x64 icon_%d_px.png
```

## 6. Decision Tables

**6.1 Edit vs Regenerate**

| Situation | Action | Why |
|---|---|---|
| Composition good, one object wrong | Inpaint that region | Editing is local and preserves the rest |
| Color mood / lighting wrong, layout right | img2img strength 0.3-0.5 | Structure survives, palette shifts |
| Wrong subject, pose, or anatomy | Regenerate text-to-image | Weak bones cannot be patched |
| Need different aspect ratio | Regenerate at new size | Rule 3: no post-hoc reshaping |
| Need text overlay | Generate negative space + overlay in post | Rendered text is unreliable |

**6.2 PNG vs JPG**

| Deliverable | Format | Why |
|---|---|---|
| Icons, flat illustration, transparency | PNG | lossless edges + alpha channel |
| Photo, hero banner, texture | JPG q85-90 | 5-10x smaller, visually identical |
| Source archive / future edits | PNG | no generation loss on re-save |

**6.3 Size by destination** — see §4.5 table; map destination → size BEFORE prompting.

**6.4 First-iteration variable priority** (when results feel "off", change in this order)

| Priority | Variable | Symptom it fixes |
|---|---|---|
| 1 | Style block | image is photoreal but job wanted illustration (or vice versa) |
| 2 | Lighting | flat, muddy, or mood-mismatched image |
| 3 | Composition/framing | subject too small, off-balance, no room for text |
| 4 | Subject attributes | wrong clothing/props/age/shape details |
| 5 | Quality tags | soft focus, plastic textures (last resort) |

## 7. Quality Checklist

Verify EVERY item before finishing:

- [ ] Size matches the destination table exactly (§4.5), verified programmatically
- [ ] 2-4 candidates were generated; the delivered one was consciously selected
- [ ] Prompt follows anatomy order; subject is front-loaded
- [ ] Style block reused verbatim across all images in a series
- [ ] No stray text, letters, or watermarks in the image (unless ≤3 words and requested)
- [ ] Hands, eyes, teeth, and limb counts are anatomically clean
- [ ] No warped straight lines, melted objects, or duplicated features
- [ ] Palette fits the destination document (brand colors / slide theme)
- [ ] Negative space exists where post-production text will go
- [ ] Format is correct: PNG for graphics, JPG q85-90 for photos
- [ ] Filename follows `purpose_size_style_vN` convention
- [ ] File opens and decodes (verified, not assumed)
- [ ] Web version downscaled when the consumer is a page/email
- [ ] Aspect ratio was NEVER altered after generation
- [ ] Exact prompt + size + seed (if used) recorded and delivered with the file
- [ ] No real-person likeness / IP / watermark / brand-safety violations
- [ ] AI-generated disclosure added where the publishing context requires it

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Stretching an image to fit a ratio | fat faces, oval wheels | Regenerate at target size (Rule 3) |
| 2 | Style words placed first in prompt | subject drifts, generic look | Front-load subject (§4.1) |
| 3 | Asking for paragraphs of in-image text | gibberish letter squiggles | Generate clean area, overlay text in post |
| 4 | Changing 5 things per iteration | improvement not attributable, thrash | One variable per run (Rule 6) |
| 5 | Shipping without artifact inspection | six fingers, dead eyes published | Mandatory inspection (Rule 11) |
| 6 | JPG for flat graphics | halos around edges, muddy colors | Use PNG for graphics |
| 7 | 4000px PNG delivered for a 300px slot | slow pages, bloated emails | Downscale with Pillow/ImageMagick |
| 8 | Same series prompt, different sizes per image | set looks mismatched | Same prompt + same size + locked seed for the set |
| 9 | No retry/backoff on 429/5xx | job dies on a transient error | 3 attempts, 2s/4s/8s (§5.2) |
| 10 | Treating `data: []` as success | empty file saved, silent failure | Explicit empty-result check (Rule 8) |
| 11 | Ignoring destination palette | teal image inside orange-brand deck | Put hex codes in the style block (§9.3) |
| 12 | "Make it nicer" iteration prompts | no directional information | Name the exact change: "move light source to the left" |
| 13 | Omitting "no text, no watermark" | surprise watermark on a paid asset | Always append negatives for deliverables |
| 14 | Editing (img2img 0.9) to fix a pose | same broken pose, costlier | Regenerate from text instead (§4.8) |

## 9. Advanced Techniques

### 9.1 Seed Discipline
When the API exposes a seed: fix it for series work (same seed + same prompt = same image), then vary ONE prompt slot to explore controlled variants. Record seed in the delivery note.

### 9.2 Negative Prompt Systems
Where a `negative_prompt` field exists, use a standing negative pack: `"text, watermark, letters, logo, deformed hands, extra fingers, mutated limbs, blurry, low quality, oversaturated"`. Negations inside the positive prompt are weaker than an explicit negative field — use both.

### 9.3 Hex Palette Locking
Insert literal hex codes into the prompt: `"palette: deep navy #0A2540, teal #14B8A6, coral #F97362"`. Models map color words to anchors surprisingly well; hex codes dramatically improve brand-fit on the first candidate.

### 9.4 Reference-Image Consistency
Where img2img accepts a reference: generate the anchor character/scene once, then feed it back at strength 0.4-0.6 with new scene prompts. This preserves identity far better than text descriptors alone.

### 9.5 Prompt Weighting (where supported)
Some APIs accept emphasis syntax like `(golden hour:1.3)` or `golden hour::1.3`. Use 1.1-1.4 to promote an ignored slot and 0.7-0.9 to demote an over-dominant one; NEVER exceed ~1.5 — extreme weights produce burnt, high-contrast artifacts.

### 9.6 Upscale & Delivery Pipeline
Generate at the platform's native size → verify → upscale via the API's larger size or a dedicated upscaler (Real-ESRGAN, Topaz) if ≥2x print resolution is required → re-verify dimensions → produce the web JPG. NEVER upscale text-bearing regions and then present them as crisp; text still needs post overlay.

## 10. Quick Reference Card

- Prompt order: **subject → attributes → action → environment → composition → style → lighting → quality**. Subject FIRST.
- Sizes: slide/banner **1792x1024**, header **1440x720**, avatar/icon **1024x1024**, poster/wallpaper **1024x1792**.
- Always: 2-4 candidates → inspect → ONE variable per iteration → deliver file + prompt + size + seed.
- Text in images: NO. Negative space + post overlay instead. Negatives: "no text, no watermark".
- Editing dials: img2img 0.3 = retouch, 0.6 = restyle, 0.9 = regenerate. Inpaint = mask + local instruction.
- Files: PNG graphics / JPG photos; name `purpose_size_style_vN`; verify dimensions; downscale for web.
- Retry: 3 attempts, 2s/4s/8s; fail loudly on empty `data`.
- Blockers: real-person deception, watermark removal, IP characters in commercial work — ALWAYS refuse.


