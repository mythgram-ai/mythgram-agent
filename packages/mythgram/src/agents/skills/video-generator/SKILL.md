---
name: video-generator
description: >
  AI video generation and ffmpeg assembly operating manual. Runs the full
  pipeline from concept to delivered file: script (two-column visual/audio),
  storyboard, text-to-video clip prompting with motion-first language, shot
  and transition grammar, platform specs, ffmpeg assembly (trim, concat,
  scale, pad, crop, drawtext, zoompan Ken Burns, audio mix, fades, loudness
  normalization, final H.264 encode), captioning in SRT, and a mandatory
  frame-level QA loop. Use this whenever the user asks to: create, make, or
  generate a video, promo, ad, teaser, trailer, explainer, reel, short,
  TikTok, YouTube video, slideshow, animated sequence, motion graphics,
  "text-to-video", or "turn this into a video"; assemble or edit existing
  clips (cut, join, crop to 9:16, resize to 1080p, add text overlays, add
  music or voiceover, add captions, convert to GIF, extract a thumbnail);
  fix video problems (black bars, audio drift, huge files, won't play in
  browser); or prepare platform-ready deliverables for YouTube, Shorts,
  Reels, TikTok, or LinkedIn. Also use when the user wants a storyboard or
  shot list for a video concept. Do NOT use for: still images — that is
  image-generator's job; music or jingles — music-generator; voiceover
  recording — voice-response (this skill consumes its output); or slide
  documents — pptx-creator.
---
# Video Generator
> Ship platform-ready video by planning shots before pixels, prompting motion first, assembling deterministically with ffmpeg, and QA-ing every deliverable frame by frame.

## 0. Operating Rules (Non-Negotiable)

1. NEVER generate a single frame before the storyboard exists. Video without a storyboard is a slot machine; the storyboard (scene #, duration, shot type, visual description, audio) is the contract every later step verifies against.
2. ALWAYS generate ONE SHOT per text-to-video prompt. NEVER ask for a whole scene, let alone a whole video, in one generation — models produce 3-10 usable seconds and narrative drift grows with length.
3. ALWAYS put MOTION in the prompt ("camera slowly dollies forward", "steam rises"). A prompt without motion words yields a static image that wastes a video generation.
4. NEVER mix frame rates in one timeline (24 + 30 fps clips). Mixed timebases cause audio drift and jitter; ALWAYS normalize everything to one fps (25 or 30) before concat.
5. ALWAYS normalize resolution BEFORE concat, not after: scale/pad every clip to the target canvas (e.g. 1920x1080) so the concat demuxer never sees mismatched dimensions.
6. ALWAYS end the final encode with `-pix_fmt yuv420p` and `-movflags +faststart`. Missing yuv420p produces green/gray frames in QuickTime and browsers; missing faststart makes web playback wait for the whole file.
7. ALWAYS place `-ss` BEFORE `-i` when stream-copying trims (fast, keyframe-aligned) and accept re-encoding for frame-accurate cuts. Copy-trims mid-GOP produce frozen first frames.
8. NEVER change aspect ratio by stretching. Crop (`crop=ih*9/16:ih`) or scale+pad (`scale=...:force_original_aspect_ratio=decrease,pad=...`) — stretching turns circles into eggs.
9. ALWAYS keep text and faces inside platform safe margins: nothing critical in the bottom 15% (UI overlays) or top ~10% of vertical video.
10. ALWAYS normalize final audio to -14 LUFS (loudnorm) and duck music under voiceover. Untreated AI clips swing wildly in loudness and sound amateur on every platform.
11. ALWAYS run the QA loop before delivery: ffprobe duration vs plan, extract first/middle/last frames and inspect, check A/V sync, confirm the file plays in a browser. NEVER deliver an unwatched render.
12. ALWAYS caption any spoken-word social video. Platforms autoplay muted; uncaptioned VO is silent marketing.

## 1. When to Use / When Not To

**Use this skill when the user:**
- wants a video created: promo, ad, teaser, explainer, slideshow with motion, social reel, YouTube intro.
- asks to assemble/edit clips: trim, join, crop to vertical, add text, captions, music, VO, thumbnail, GIF.
- reports video defects: black bars, audio out of sync, file too large, won't play in browser, green frames.
- needs platform-specific deliverables: 16:9 1080p YouTube, 9:16 Shorts/Reels/TikTok, 1:1 LinkedIn.
- wants a script + storyboard + shot list for a video idea.

**Routing table:**

| The request mentions | Correct skill | Why |
|---|---|---|
| still image, illustration, banner, icon | image-generator | static pixels, no timeline |
| music, soundtrack, audio bed, jingle | music-generator | compose/lengthen the bed, then THIS skill mixes it in |
| voiceover, narration, TTS | voice-response | produce the VO file; this skill syncs and mixes it |
| slides/PDF with embedded media | pptx-creator / pdf-creator | document assembly; export short clips or stills for them |
| transcribe the VO audio | ASR skill | recognition, not generation |
| "just cut the last 10 seconds off" | still this skill | trimming is core ffmpeg work |

## 2. Core Concepts & Mental Models

- **The pipeline is a chain of contracts:** concept → script (what is said vs shown) → storyboard (per-shot plan) → generated clips → ffmpeg assembly → QA → delivery. Each stage's output is the next stage's acceptance test.
- **A generation is a shot, not a scene.** Treat every text-to-video call as buying one 3-10 second camera take. Stories are built in the edit, not in the prompt.
- **Motion is the differentiator.** Text-to-video models render "what" reasonably and "happening" only when told. Every prompt needs a camera move and/or subject move.
- **Continuity is repeated descriptors.** Models have no memory between calls. Same style string, same location words, same character description, same seed (if available) — repeated verbatim — is the only way clips feel like one film.
- **ffmpeg is deterministic; generation is not.** All timing, sizing, text, and audio decisions live in ffmpeg where they are exact and reversible. NEVER let the AI model control timing.
- **Pacing is genre-specific:** 2-6 s per shot for social (attention decays in seconds), 5-10 s for documentary/explainer. Cut on motion for energy, cut on stillness for calm.
- **Loudness is a spec, not a feel:** -14 LUFS integrated for streaming/social, true peak ≤ -1.5 dBTP. `loudnorm` makes this a number, not an opinion.
- **Delivery = encode + container flags.** H.264 High, CRF ~20, yuv420p, AAC 192k, +faststart is the universal compatibility baseline.

## 3. Mandatory Workflow

1. **Define concept and constraints.** Platform, aspect ratio, duration, audience, CTA. MUST write these down — the platform spec (§4.5) decides canvas size and pacing before any creative work.
2. **Write the two-column script.** Left: VISUAL. Right: AUDIO (VO lines, music mood, SFX). One row per shot. NEVER write VO longer than the visual holds; ~2.5 words/second of VO is the read-speed ceiling.
3. **Build the storyboard table.** Columns: scene #, duration (s), shot type (wide/medium/close-up), visual description (this becomes the generation prompt), audio. Sum of durations MUST equal target ±10%.
4. **Generate clips one shot at a time.** Prompt = subject + motion + camera language + style + lighting + mood (§4.1). Repeat the continuity string verbatim in every prompt. Generate 1-2 candidates per shot; keep the best.
5. **Inspect each clip before assembly.** ffprobe its duration/resolution/fps; extract first/middle/last frames; reject clips with artifacts now, not after the render.
6. **Normalize and assemble.** Scale/pad every clip to the target canvas at one fps (§5.3), trim the best 2-6 s of each (§5.2), concat via the demuxer (§5.4). NEVER concat mismatched properties (Rule 5).
7. **Build the audio bed.** VO from voice-response, music from music-generator. Music length MUST be ≥ video length; duck music ~10-12 dB under VO (§5.6); mix to -14 LUFS (§5.7).
8. **Add text and captions.** drawtext for titles/CTA inside safe margins (§5.5); SRT captions burned or soft (§4.6).
9. **Final encode + QA loop (MANDATORY).** Encode with §5.8 settings, then: ffprobe duration vs plan; extract first/middle/last frames and inspect; verify A/V sync; check file size is sane; confirm browser playback (faststart). Fix and re-run until every check passes, then deliver with a one-line spec (resolution, fps, duration, size).

## 4. Deep Knowledge Library

### 4.1 Text-to-Video Prompting — Motion First

Anatomy per shot prompt: **subject + MOTION + camera language + style + lighting + mood + duration hint**.

| Layer | Copy-paste vocabulary |
|---|---|
| Subject motion | "steam rises slowly", "she turns her head left", "paper airplane flies across frame", "liquid pours in slow motion", "leaves drift downward", "crowd walks toward camera" |
| Camera motion | "camera slowly dollies forward", "camera pans right", "slow orbit around the subject", "crane up reveal", "handheld follow shot", "static locked-off shot" |
| Shot type | "wide establishing shot", "medium two-shot", "close-up on hands", "macro detail", "overhead shot" |
| Style | "cinematic, shot on ARRI, filmic grade", "clean product video, studio white", "anime style, cel shaded" |
| Lighting | "warm golden hour", "moody low-key with practical lights", "bright even studio" |
| Mood | "energetic", "calm and premium", "tense", "playful" |

Worked shot prompts:
- `"Cinematic close-up of an espresso cup on a marble counter, steam rising slowly, camera slowly dollies forward, warm morning window light, shallow depth of field, photorealistic film look, 5 seconds"`
- `"Wide shot of a red paper airplane flying left to right across a sunlit office, smooth tracking shot following it, bright playful mood, flat corporate-clean grade, 4 seconds"`
- `"Medium shot of a barista pouring latte art, handheld camera drifts slightly, warm cafe lighting with bokeh string lights, cozy premium mood, 6 seconds"`

Realism constraints: a generation is 3-10 usable seconds (plan 5); characters morph if a shot runs long; complex multi-action scenes fail — one action per shot. NEVER prompt "a 30-second video about...".

### 4.2 Shot & Transition Grammar

| Shot | Purpose |
|---|---|
| Wide / establishing | set location, scale, reset the eye |
| Medium | relationships, dialogue, product-in-hand |
| Close-up | emotion, detail, the "why it matters" |
| Overhead | process, layout, flat-lay energy |

| Transition | Use when | ffmpeg |
|---|---|---|
| Hard cut | default; same location/timeline, energetic pacing | concat |
| Fade to/from black | chapter breaks, start/end of film | `fade=t=in:st=0:d=0.5` |
| Dissolve / crossfade | time passing, montage, mood pieces | `xfade` (§9.2) |
| NEVER use | star-wipes, page curls — instant amateur signal | — |

Pacing: social 2-6 s/shot; explainer 5-10 s; trailer accelerates (long → short shots).

### 4.3 Continuity Toolkit (models have no memory)
- Keep a **continuity string** and append it verbatim to EVERY shot prompt: e.g. `"cinematic, shot on ARRI, teal and orange grade, soft key light, shallow depth of field, 24fps film look"`.
- Repeat the character description word-for-word in every prompt: "a 30-year-old courier with round glasses, short black hair, teal cap".
- Repeat location anchors: "exposed brick loft, large north windows, plants on shelves".
- Fix the seed if the API exposes one; change only shot-specific words.
- Prefer location-stable action (same room, different angles) over location jumps between generations.

### 4.4 ffmpeg Recipe Library (all flags real)

**Inspect anything first:**
```bash
ffprobe -v error -show_entries format=duration,size -show_streams promo.mp4
```

**Trim — stream copy (fast, keyframe-aligned; -ss BEFORE -i):**
```bash
ffmpeg -ss 00:00:04 -to 00:00:09 -i in.mp4 -c copy out.mp4
```
**Trim — frame-accurate (re-encode; still keep -ss before -i for speed):**
```bash
ffmpeg -ss 00:00:04 -to 00:00:09 -i in.mp4 -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 192k out.mp4
```

**Concat (demuxer — zero re-encode when inputs match):**
```bash
cat > list.txt <<'EOF'
file 'clip1.mp4'
file 'clip2.mp4'
file 'clip3.mp4'
EOF
ffmpeg -f concat -safe 0 -i list.txt -c copy rough_cut.mp4
# inputs differ (codec/params)? re-encode through the same filter instead of -c copy:
ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k rough_cut.mp4
```

**Normalize to 1920x1080 (letterbox, never stretch):**
```bash
ffmpeg -i in.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" -c:a copy out_1080p.mp4
```
**Horizontal → 9:16 vertical (center crop):**
```bash
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920,fps=30" -c:a copy vertical.mp4
```

**Text overlay inside safe margins, timed:**
```bash
ffmpeg -i in.mp4 -vf "drawtext=text='Summer Sale':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=72:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-160:enable='between(t,1,4)'" -c:a copy titled.mp4
```
(For text with special characters, use `textfile=titles.txt` to avoid escaping hell.)

**Image → 5 s Ken Burns clip (slideshow atom):**
```bash
ffmpeg -loop 1 -i still.png -vf "scale=1920:1080,zoompan=z='zoom+0.0008':d=125:s=1920x1080:fps=25" -t 5 -c:v libx264 -crf 20 -pix_fmt yuv420p clip_still.mp4
```

**Fades in/out (5 → 29 s clip):**
```bash
ffmpeg -i clip.mp4 -vf "fade=t=in:st=0:d=0.5,fade=t=out:st=28:d=0.5" -c:a copy faded.mp4
```

**Speed change (2x, audio pitch-preserved):**
```bash
ffmpeg -i clip.mp4 -vf "setpts=0.5*PTS" -af "atempo=2.0" fast.mp4
```

**Thumbnail:**
```bash
ffmpeg -ss 1 -i final.mp4 -vframes 1 -q:v 2 thumb.jpg
```

**GIF with proper palette (never plain GIF conversion):**
```bash
ffmpeg -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" out.gif
```

**Final universal encode:**
```bash
ffmpeg -i rough_cut.mp4 -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart final.mp4
```

### 4.5 Platform Specs & Safe Zones

| Platform | Ratio | Resolution | Length | Notes |
|---|---|---|---|---|
| YouTube | 16:9 | 1920x1080 | any | 24/30 fps; chapters help retention |
| Shorts / Reels / TikTok | 9:16 | 1080x1920 | ≤60 s | text out of bottom 15% + top 10% (UI) |
| LinkedIn | 16:9 or 1:1 | 1920x1080 / 1080x1080 | <90 s best | autoplays muted → captions required |
| Instagram feed | 1:1 or 4:5 | 1080x1080 | ≤60 s | 4:5 maximizes screen area |

Safe-zone rule: keep text/faces out of the bottom 15% (captions/buttons) and top ~10% (profile bars) of vertical video.

### 4.6 Captions — SRT and Burn-in

SRT format is EXACT (comma before ms, sequence numbers, blank line between cues):
```
1
00:00:00,000 --> 00:00:02,500
Nine out of ten teams ship faster with automation.

2
00:00:02,500 --> 00:00:05,000
Here is how yours can too.
```
- Burn-in (social): `ffmpeg -i in.mp4 -vf "subtitles=captions.srt:force_style='FontSize=22,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,MarginV=40'" -c:a copy out_subbed.mp4`
- Soft subs (YouTube): pass the same .srt as a side file at upload — keeps text searchable and switchable.
- Rule: ≤2 lines per cue, ≤42 chars/line, cues change with phrases, not mid-word.

### 4.7 Audio: VO Sync, Ducking, Loudness
- VO is timed against the storyboard: each line starts at its scene's start offset; ~2.5 words/second.
- Music bed under VO: duck ~10-12 dB (volume 0.25-0.3) or sidechain-duck (§9.3).
- Mix target: -14 LUFS integrated, TP ≤ -1.5 dBTP (`loudnorm=I=-14:TP=-1.5:LRA=11`).
- ALWAYS end music with a fade-out (2 s) — never a hard stop.

### 4.8 QA Protocol (run on EVERY render)
```bash
# 1. duration + size vs plan
ffprobe -v error -show_entries format=duration,size final.mp4
# 2. sample frames: first, every ~10 s, last
ffmpeg -i final.mp4 -vf "fps=1/10" qa_%02d.jpg
ffmpeg -sseof -0.5 -i final.mp4 -vframes 1 qa_last.jpg
# 3. audio present and loudness-compliant
ffmpeg -i final.mp4 -af "loudnorm=print_format=summary" -f null - 2>&1 | grep "Input Integrated"
```
Pass criteria: duration within ±10% of plan; frames show no black/green/frozen segments; audio integrated ≈ -14 LUFS; file plays from partial download (faststart present); size plausible (1080p H.264 ≈ 8-15 MB/min at CRF 20).

## 5. Code & Tool Templates

### 5.1 Audio replace / VO drop-in
```bash
# Replace the clip's audio with the VO file; video is copied untouched
ffmpeg -i video.mp4 -i vo.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest out.mp4
```

### 5.2 Music bed under VO — mix + duck + fades (one pass)
```bash
ffmpeg -i vo.wav -i music.mp3 -filter_complex "\
[1:a]volume=0.3[m];\
[m]afade=t=in:st=0:d=1,afade=t=out:st=28:d=2[bed];\
[0:a][bed]amix=inputs=2:duration=first:weights='1 1'[a];\
[a]loudnorm=I=-14:TP=-1.5:LRA=11[out]" \
-map "[out]" -ar 48000 mixed.wav
```

### 5.3 Normalize a batch of clips before concat (loop)
```bash
for f in clip*.mp4; do
  ffmpeg -y -i "$f" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" \
         -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k "norm_$f"
done
```

### 5.4 Gap-free concat list (absolute paths, -safe 0)
```bash
cat > list.txt <<'EOF'
file '/abs/path/norm_clip1.mp4'
file '/abs/path/norm_clip2.mp4'
file '/abs/path/norm_clip3.mp4'
EOF
ffmpeg -f concat -safe 0 -i list.txt -c copy rough_cut.mp4
```

### 5.5 Silence file for audio gaps between segments
```bash
ffmpeg -f lavfi -i anullsrc=r=48000:cl=stereo -t 0.4 -c:a aac silence_400ms.m4a
```

### 5.6 Worked example — 30-second social promo (5 generated clips + VO + music)

Storyboard (target 30 s, 1080x1920, 30 fps):
| # | Dur | Shot | Prompt (motion in bold) | Audio |
|---|---|---|---|---|
| 1 | 6 s | wide | "Sunlit specialty coffee shop interior, **barista waves toward camera**, slow dolly forward, warm golden light, cinematic film look" | VO line 1 + music in |
| 2 | 6 s | close | "**Steam rises** from an espresso cup, **camera slowly orbits**, marble counter, shallow depth of field, same grade" | VO line 2 |
| 3 | 6 s | medium | "Barista **pours latte art in slow motion**, handheld drift, bokeh string lights, same grade" | VO line 3 |
| 4 | 6 s | close | "Customer **smiles and lifts the cup toward camera**, soft window light, same grade" | VO line 4 |
| 5 | 6 s | wide | "Coffee shop exterior at dusk, **lights flick on one by one**, crane up reveal, same grade" | VO CTA + music fade |

Command sequence:
```bash
# 1. normalize all clips to the 1080x1920 canvas (crop horizontal gens to 9:16)
for f in clip*.mp4; do
  ffmpeg -y -i "$f" -vf "crop=ih*9/16:ih,scale=1080:1920,fps=30" \
    -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k "norm_$f"; done
# 2. concat video timeline
printf "file 'norm_clip1.mp4'\nfile 'norm_clip2.mp4'\nfile 'norm_clip3.mp4'\nfile 'norm_clip4.mp4'\nfile 'norm_clip5.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy rough_cut.mp4
# 3. mix VO + ducked music (30 s, fade out last 2 s), normalize to -14 LUFS
ffmpeg -i vo.wav -i music.mp3 -filter_complex "\
[1:a]volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=28:d=2[bed];\
[0:a][bed]amix=inputs=2:duration=first:weights='1 1'[a];\
[a]loudnorm=I=-14:TP=-1.5:LRA=11[out]" -map "[out]" -ar 48000 mixed.wav
# 4. attach audio + CTA text (inside safe margin, y=h-320 clears bottom 15% of 1920)
ffmpeg -i rough_cut.mp4 -i mixed.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k av.mp4
ffmpeg -i av.mp4 -vf "drawtext=text='Taste it today':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=64:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-320:enable='between(t,26,30)'" -c:a copy titled.mp4
# 5. final encode + thumbnail
ffmpeg -i titled.mp4 -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart promo_final.mp4
ffmpeg -ss 1 -i promo_final.mp4 -vframes 1 -q:v 2 promo_thumb.jpg
# 6. QA: duration ~30 s, frames clean, loudness ~-14 LUFS (see §4.8)
```

## 6. Decision Tables

**6.1 Generate video vs Ken Burns still (when budget/time is tight)**

| Situation | Choice | Why |
|---|---|---|
| Subject must move/act (pouring, walking, flying) | text-to-video clip | stills cannot act |
| Abstract/pattern/texture b-roll | still + zoompan | deterministic, cheap, artifact-free |
| Text-heavy informational beat | still + drawtext | AI text rendering is unusable |
| Character consistency across many shots | stills of one character + motion only in hero shots | generation morphs characters between calls |

**6.2 Encode settings**

| Deliverable | Video | Audio | Flags |
|---|---|---|---|
| Universal final (all platforms) | libx264, crf 20, preset medium | aac 192k | -pix_fmt yuv420p -movflags +faststart |
| Archive master | libx264, crf 18, preset slow | aac 256k or pcm | keep original fps |
| Quick draft review | libx264, crf 23, preset veryfast | aac 128k | +faststart |
| GIF loop | fps=12, scale 480w, palettegen/paletteuse | none | — |

**6.3 Transition choice** — hard cut default; fades at open/close and chapter breaks; dissolves only for montage/time-passing; NEVER novelty wipes.

**6.4 Platform canvas** — YouTube 1920x1080 / Shorts-Reels-TikTok 1080x1920 / LinkedIn 1920x1080 or 1080x1080 / IG feed 1080x1080. Pick BEFORE storyboarding (§4.5).

## 7. Quality Checklist

- [ ] Platform, ratio, and duration were fixed before storyboarding
- [ ] Storyboard durations sum to target duration ±10%
- [ ] Every generation prompt contains explicit subject motion and/or camera motion
- [ ] One shot per generation; no whole-scene prompts
- [ ] Continuity string + character description repeated verbatim across prompts
- [ ] Every clip individually inspected (duration, fps, resolution, frames) BEFORE assembly
- [ ] All clips normalized to one canvas size and one fps before concat
- [ ] Trims used -ss before -i; stream-copy cuts land on keyframes
- [ ] No stretching: crop or scale+pad only
- [ ] Text overlays sit inside safe margins (bottom 15% / top 10% clear on vertical)
- [ ] VO starts align with storyboard scene offsets (~2.5 words/second)
- [ ] Music ducked under VO and faded out at the end (no hard stop)
- [ ] Mix normalized to -14 LUFS, TP ≤ -1.5 dBTP
- [ ] Captions produced for all spoken content (burned or .srt side file)
- [ ] Final encode: libx264 crf 20, yuv420p, AAC 192k, +faststart
- [ ] ffprobe duration matches plan; file size plausible (≈8-15 MB/min at 1080p CRF 20)
- [ ] First/middle/last frames extracted and inspected — no black/green/frozen frames
- [ ] A/V sync verified (waveform or clap check)
- [ ] File plays in a browser from partial load (faststart verified)

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Missing `-pix_fmt yuv420p` | green/gray frames in QuickTime/browsers | Re-encode with yuv420p (Rule 6) |
| 2 | `-ss` after `-i` with `-c copy` | frozen first frame, wrong cut point | Put `-ss` before `-i`; re-encode for frame accuracy |
| 3 | Concat of mixed fps/timebases | audio drifts, playback jitters | Normalize all inputs to one fps, then concat |
| 4 | Scale without pad (or stretch) | 4:3 black bars or distorted image | `scale=...force_original_aspect_ratio=decrease,pad=...` |
| 5 | CRF 18 + preset slow at 1080p | 200 MB "short" video | CRF 20-23, preset medium |
| 6 | No faststart | web video stalls before playing | `-movflags +faststart` on final encode |
| 7 | Text in bottom 15% of vertical | hidden behind platform UI | Keep text in middle band (Rule 9) |
| 8 | Whole-scene generation prompt | morphing subjects, narrative mush | One shot per prompt (Rule 2) |
| 9 | No motion words in prompt | static shot wastes a video gen | Add camera + subject motion (Rule 3) |
| 10 | Music hard-stops at video end | jarring ending | `afade=t=out` over last 2 s |
| 11 | Concat paths relative to wrong cwd | "Impossible to open" errors | Absolute paths in list.txt + `-safe 0` |
| 12 | drawtext with `:` or `,` in text | filter parse error | Escape, or use `textfile=titles.txt` |
| 13 | Mixing fades into concat pipeline twice | double flash to black | Apply fade ONCE, on the final timeline |
| 14 | Delivering without frame inspection | black segment discovered by the client | §4.8 QA is mandatory, not optional |

## 9. Advanced Techniques

### 9.1 Keyframe-hunting for clean stream-copy cuts
`ffprobe -v error -select_streams v -show_entries packet=pts_time,flags -of csv in.mp4 | grep K | head` — list keyframe times, cut at the nearest one before your target when `-c copy` must be used.

### 9.2 Crossfade between two clips (xfade)
```bash
# clip A = 5 s; 0.5 s dissolve starting at offset 4.5
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.5[v]" -map "[v]" xfade.mp4
```
Chain more clips by feeding the output back as the next first input; keep durations in a table — offset math must be exact.

### 9.3 Sidechain ducking (music auto-lowers under VO)
```bash
ffmpeg -i music.mp3 -i vo.wav -filter_complex \
"[1:a]asplit=2[sc][mix];[0:a][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[duck];\
[mix][duck]amix=inputs=2:duration=first[m]" -map "[m]" ducked.wav
```

### 9.4 Two-pass loudness normalization (more accurate than one-pass)
```bash
ffmpeg -i final.mp4 -af "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2> measure.json
# read measured_I/measured_TP/measured_LRA/measured_thresh from the JSON, then:
ffmpeg -i final.mp4 -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-18.2:measured_TP=0.9:measured_LRA=6.1:measured_thresh=-28.4:linear=true" -c:v copy final_loud.mp4
```

### 9.5 Multi-image slideshow with motion (batch loop)
```bash
i=0; for img in stills/*.png; do
  i=$((i+1))
  ffmpeg -y -loop 1 -i "$img" -vf "scale=1920:1080,zoompan=z='zoom+0.0008':d=125:s=1920x1080:fps=25" \
    -t 5 -c:v libx264 -crf 20 -pix_fmt yuv420p "slides/slide_$i.mp4"; done
# then normalize + concat per §5.3-5.4
```

### 9.6 Quick color grade without LUTs
```bash
ffmpeg -i in.mp4 -vf "eq=contrast=1.06:brightness=0.01:saturation=1.15,gamma=0.98" -c:a copy graded.mp4
```
Small moves only (±5-15%); heavy grades on AI clips amplify banding.

## 10. Quick Reference Card

- Pipeline: **concept → two-column script → storyboard → generate shots → inspect → normalize → concat → audio → text/captions → encode → QA → deliver**.
- Prompt recipe: subject + **MOTION** + camera + style + lighting + mood; one shot per call; 3-10 s each.
- Pre-concat normalize: `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`.
- Vertical: `crop=ih*9/16:ih,scale=1080:1920`.
- Final encode: `libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart`.
- Audio: duck music to ~0.3, `loudnorm=I=-14:TP=-1.5:LRA=11`, 2 s fade-out.
- Canvas: YouTube 1920x1080 · Shorts/Reels/TikTok 1080x1920 (≤60 s) · LinkedIn 1080x1080/1920x1080.
- Safe zones: bottom 15% and top 10% of vertical = no text.
- QA: ffprobe duration · frames at 0/mid/last · loudness summary · faststart · browser play.
- Sibling handoffs: stills → image-generator · music → music-generator · VO → voice-response.

