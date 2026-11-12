---
name: music-generator
description: >
  AI music generation operating manual covering music theory essentials, song
  structure, layered prompt craft, lyric writing, scenario-to-genre mapping,
  audio formats and loudness targets, ffmpeg post-processing, and QA. Builds
  genre-correct prompts with layered descriptors (genre, subgenre, mood,
  instrumentation, BPM, production style, structure tags, vocal spec), writes
  singable lyrics with proper rhyme schemes and syllable counts, and finishes
  tracks with fades, crossfades, loop seams, format conversion, and loudness
  normalization. Use this whenever the user asks to: create, generate, make,
  or compose music, a song, a track, background music, BGM, soundtrack, score,
  jingle, sting, intro/outro music, loop, beat, melody, instrumental, or
  "something that sounds like..."; write song lyrics, hooks, or verses; set a
  mood with audio (focus, workout, meditation, trailer, podcast bed, game
  music); convert, trim, loop, fade, crossfade, normalize, or tag audio files;
  or pick the right audio format and loudness for streaming, podcast, or video
  delivery. Also use when the user says "make me a lo-fi track", "I need 30
  seconds of upbeat music for an ad", "write a chorus about summer", or
  "loop this track seamlessly". Do NOT use for: spoken voice, narration,
  audiobook or TTS output — that is voice-response's job; assembling audio
  into a finished video — video-generator (this skill supplies the music file
  and ducking guidance); or transcribing audio — the ASR skill.
---
# Music Generator
> Deliver the right track for the moment: map the scenario to genre and tempo, prompt with layered descriptors, iterate one descriptor at a time, and master to delivery spec with ffmpeg.

## 0. Operating Rules (Non-Negotiable)

1. ALWAYS state explicitly whether the track must be instrumental or vocal. Omitting this is the #1 generation error — models default to vocals and an unwanted singer ruins a podcast bed. For instrumentals write the literal words "instrumental, no vocals".
2. ALWAYS specify BPM in the prompt. Tempo is the strongest mood lever; leaving it out surrenders the single most important parameter to chance.
3. ALWAYS map the scenario first (study, workout, trailer, podcast, game, ad, meditation → §4.6 table) before choosing genre. The user's use case, not personal taste, picks the genre.
4. NEVER stack more than one genre and one subgenre in a prompt ("jazz-trap-orchestral-waltz" produces mush). One genre + one subgenre + concrete instrumentation wins.
5. ALWAYS change exactly ONE descriptor per iteration (swap "mellow" → "uplifting", or 78 → 92 BPM — never both). Unattributable changes make refinement a lottery.
6. NEVER deliver a track that ends mid-phrase or hard-stops. ALWAYS finish with either a musical resolution or a fade-out (1-3 s, longer for ambient).
7. For video BGM, ALWAYS make music length ≥ video length, then trim and fade in post. Extending a short track is impossible; trimming is trivial.
8. ALWAYS normalize delivery loudness: -14 LUFS for streaming/video/social, -16 LUFS for podcast/voice-adjacent beds, TP ≤ -1.0 dBTP. Raw AI output swings ±6 LU between generations.
9. NEVER prompt to imitate a specific living artist's voice or to pass AI music off as a named human artist's work. Check the generation platform's license terms for commercial use before delivering.
10. ALWAYS verify the QA gates before delivery: duration matches the brief (±5% or exact when trimmed), clean ending, consistent volume, style matches the brief, no artifacts (sudden cuts, glitch loops).
11. ALWAYS deliver in the format the destination needs (WAV master + MP3 distribution copy) with correct sample rate: 44.1 kHz music, 48 kHz when the track will be muxed into video.
12. For loopable assets (games, BGM), ALWAYS verify the seam: end and start must connect with no click, no double-hit, and consistent energy across the boundary.

## 1. When to Use / When Not To

**Use this skill when the user:**
- wants music made: background track, soundtrack, jingle, intro/outro sting, beat, loop, full song with vocals.
- asks for lyrics, a hook, a chorus, or verse writing.
- wants a mood set in audio: "something calm for studying", "epic for a trailer", "upbeat 30-second ad bed".
- needs audio file work: trim, fade, crossfade, loop, convert WAV/MP3/FLAC/M4A, normalize loudness, tag metadata.
- asks which format/bitrate/sample rate to deliver audio in.

**Routing table:**

| The request mentions | Correct skill | Why |
|---|---|---|
| voice, narration, TTS, "read this aloud", audiobook VO | voice-response | spoken audio is a separate pipeline |
| video assembly, adding the track to footage | video-generator | this skill delivers the file + ducking spec; that skill muxes |
| transcript of an audio file | ASR skill | recognition, not generation |
| sound-effect design (UI blips, whooshes) | music-generator (short instrumental prompts) | same generation + post pipeline applies |
| putting music under slides | pptx-creator (embed) | generate HERE first, hand over the file |

## 2. Core Concepts & Mental Models

- **Tempo is the mood dial.** BPM is the fastest way to steer feel: 60-80 calm, 90-110 groove, 120-128 house/pop energy, 140+ aggressive. Genre fixes the plausible BPM window (house won't sit at 70).
- **Mode is the emotion dial.** Major = bright/resolved; minor = melancholic/tense; pentatonic = universally "safe" (no sour notes — why game and corporate music lives there).
- **Progressions are pre-fabricated emotion.** I–V–vi–IV is the pop ubiquity loop; ii–V–I is jazz resolution; canon-style progressions signal nostalgia. Naming a progression in a prompt is a legal move — models understand it.
- **Structure is time architecture.** Sections are counted in bars (8/16); a bar's length in seconds = 240/BPM. At 120 BPM one bar = 2 s, so a 16-bar verse = 32 s. This math turns "30 seconds of music" into "15 bars" — prompt accordingly.
- **Structure tags steer form.** [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Drop] [Outro] markers inside the prompt shape arrangement in tag-aware models.
- **Loudness is a spec.** LUFS is how platforms measure perceived level; -14 LUFS is the streaming standard. Deliver quiet-of-loud: normalize the file, never trust the ear at 2 a.m.
- **Loops are geometry, not vibes.** A good loop ends exactly how it begins: same energy, no reverb tail hanging over the seam, cut at a bar boundary.
- **Vocals multiply risk.** Vocal tracks add intelligibility, lyric quality, and mixing risk; instrumental is the default professional choice for beds.

## 3. Mandatory Workflow

1. **Parse the brief into a spec:** use case, target duration, vocal or instrumental, mood words, references ("like a coffee-shop playlist"), destination (streaming? video? game?). MUST resolve duration and vocal/instrumental — they gate everything else.
2. **Map scenario → genre/tempo/energy** using §4.6. NEVER free-associate genre from mood words alone.
3. **Build the layered prompt:** genre + subgenre + mood + instrumentation + BPM + production style + structure tags + vocal spec (§4.2). Include "instrumental, no vocals" when a bed is needed (Rule 1).
4. **Request duration explicitly** where the API supports it; otherwise plan to trim with fades (§5.2). For video work target length ≥ video length (Rule 7).
5. **Generate 2-3 variants** with the same prompt (or ±1 descriptor). NEVER accept variant zero blindly.
6. **QA each variant against the brief:** duration, style/mood match, clean ending, no mid-phrase cuts or glitches. Reject with a REASON, then refine ONE descriptor (Rule 5) and regenerate.
7. **Post-process to spec:** trim to exact length, fade in/out, loop-seam fix if needed, loudness normalize (§5.6), convert format (§5.5), tag metadata (§5.7).
8. **Deliver:** master (WAV) + distribution copy (MP3 320k or M4A) + a spec line (duration, BPM, key if known, LUFS, format) + the exact prompt for reproducibility.

## 4. Deep Knowledge Library

### 4.1 Music Theory Crash Course (the 10% that steers 90%)

- **Scales:** major (bright, resolved), natural minor (melancholic, tense), major pentatonic (safe, no wrong notes — corporate/games), minor pentatonic (bluesy, rugged).
- **Core progressions:** I–V–vi–IV (the pop loop: "ubiquitous uplift"), vi–IV–I–V (same chords, sadder start), ii–V–I (jazz resolution), i–VI–III–VII (epic/minor anthems), canon progression (I–V–vi–iii–IV–I–IV–V, nostalgic).
- **Tempo ↔ mood map:** 50-60 meditation/ambient · 60-80 calm/chill/lo-fi · 80-100 mid-tempo pop/folk · 90-110 groove/hip-hop · 110-120 dance-pop · 120-128 house/EDM energy · 128-140 peak-time/trance · 140+ DnB/aggressive.
- **Time signatures:** 4/4 default (everything mainstream); 3/4 waltz (whimsy, "amusement park"); 6/8 lilt (folk ballads, sea shanties, lullabies). Never mix meters in one short track.
- **Key ↔ mood is a heuristic, not physics:** C major = plain/bright, D major = triumphant, E minor = intimate sad, A minor = pop melancholy. Use it as a prompt hint; NEVER promise emotional physics from a key name.

### 4.2 Layered Prompt Anatomy

Order the descriptors exactly like this — it reads as a producer's brief:

```
[genre + subgenre] + [mood adjectives] + [instrumentation] + [BPM] +
[key/mode hint] + [production style] + [structure tags] + [vocal spec]
```

Worked template (instrumental bed):
```
Melodic house, deep subgenre, uplifting night-drive mood, analog synth pads,
plucked arpeggio lead, sidechained sub bass, four-on-the-floor kick, 124 BPM,
A minor, polished modern club production, [Intro][Build][Drop][Breakdown][Drop][Outro],
instrumental, no vocals
```
Worked template (vocal song):
```
Indie folk-pop, warm nostalgic mood, fingerpicked acoustic guitar, brushed drums,
upright bass, 92 BPM, D major, intimate close-mic production, airy female vocal,
[Verse][Pre-Chorus][Chorus][Verse][Chorus][Bridge][Chorus][Outro],
lyrics about a last summer road trip
```

### 4.3 Genre Prompt Fragment Library (2 ready-to-copy prompts each)

| Genre | Prompt 1 | Prompt 2 |
|---|---|---|
| Pop | "Upbeat summer synth-pop, airy female vocal, 118 BPM, I–V–vi–IV chorus, glossy radio production, punchy sidechained drums, shimmering synths, [Intro][Verse][Pre-Chorus][Chorus][Chorus][Outro], lyrics about a road trip at sunset" | "Instrumental corporate pop, 112 BPM, plucky synths, finger snaps, warm round bass, uplifting major key, clean modern mix, no vocals" |
| Lo-fi hip-hop | "Lo-fi hip-hop study beat, 78 BPM, dusty vinyl crackle, jazky Rhodes chords, soft swung drums, mellow nostalgic mood, instrumental, no vocals" | "Chillhop rain-window loop, 82 BPM, upright bass walk, muted trumpet licks, tape saturation, sleepy jazz harmony, instrumental" |
| Cinematic orchestral | "Epic orchestral trailer piece, rising from 90 to 140 BPM, soaring strings, taiko hits, brass swells, braams, tense minor key, [Build][Drop][Impact][Outro], instrumental" | "Intimate piano and strings score, 66 BPM, melancholic E minor, gentle rubato feel, film-drama cue for a farewell scene, instrumental, no vocals" |
| EDM / house | "Melodic house, 124 BPM, four-on-the-floor kick, sidechained pads, arpeggio lead, 16-bar build into drop, night-drive energy, [Intro][Build][Drop][Breakdown][Drop][Outro], instrumental" | "Deep house groove, 122 BPM, filtered disco chords, shaker groove, warm sub bass, sunset rooftop mood, instrumental, no vocals" |
| Rock | "Indie rock anthem, 132 BPM, overdriven guitars, live room drums, anthemic shout-along chorus, gritty male vocal, [Verse][Chorus][Verse][Chorus][Bridge][Chorus]" | "Desert blues rock instrumental, 96 BPM, twangy reverb guitar lead, hypnotic bassline, dusty drum groove, no vocals" |
| Jazz | "Smooth jazz trio, 96 BPM swung 4/4, brushed drums, walking upright bass, lyrical piano lead, late-night city mood, instrumental" | "Upbeat bebop quintet, 168 BPM, sax front line, comping piano, ride-cymbal swing, ii–V–I turns, instrumental, no vocals" |
| Ambient | "Ambient drone bed, 55 BPM feel, evolving analog pads, distant granular textures, no percussion, endless-horizon calm, seamless loop, instrumental" | "Meditation soundscape, 50 BPM, warm sine pads with slow swells, soft wind chime accents, no rhythm, no melody spikes, instrumental, no vocals" |
| Folk / acoustic | "Acoustic folk, 92 BPM, fingerpicked guitar, warm male vocal, brushed percussion, close-mic bedroom production, [Verse][Chorus][Verse][Chorus][Outro], lyrics about hometown streets" | "Instrumental acoustic morning cue, 88 BPM, guitar arpeggios, soft mandolin answers, light shaker, hopeful major key, no vocals" |
| Chiptune | "8-bit chiptune, 140 BPM, square-wave leads, NES-style noise drums, adventurous major key, game level theme, seamless loop, instrumental" | "Chill chiptune overworld theme, 110 BPM, triangle-wave bass, arpeggio pads, playful and bouncy, loopable, instrumental, no vocals" |
| Corporate / upbeat | "Uplifting corporate track, 110 BPM, piano ostinato, claps, plucks, light strings, soft whoosh transitions, positive and clean, instrumental, no vocals" | "Motivational tech jingle, 15 seconds, 120 BPM, rising synth arp, impact hit, bright resolved ending, instrumental" |

### 4.4 Song Structure Knowledge

- **Section lengths:** 8 bars (short intro, pre-chorus) or 16 bars (verse, chorus) is the default grammar. Bar seconds = 240/BPM → at 120 BPM: 8 bars = 16 s, 16 bars = 32 s.
- **Radio format:** Intro ≤8 s → Verse 1 → Pre-Chorus → Chorus → Verse 2 → Pre-Chorus → Chorus → Bridge → final Chorus. First chorus should land before ~45 s.
- **Electronic format:** Intro (groove only) → Build (rising tension, snare rolls) → Drop (full energy) → Breakdown → second Build/Drop → Outro. Builds should climb for 8-16 bars, not 4.
- **Loopable format (games/BGM):** no intro/outro — start and end in the same groove; identical energy at both ends; NO reverb tail across the seam; end exactly on a bar boundary.
- **Short-form (ads/stings):** state the hook in the first 3 seconds; resolve the final chord cleanly (no fade for a 15 s jingle unless it loops).

### 4.5 Lyric Craft (when vocals are requested)

- **Verse tells, chorus sells:** verses advance the story with concrete images; the chorus states the emotional hook in plain words and repeats the title in its first line.
- **Rhyme schemes:** AABB (couplets — punchy, folk/rap) or ABAB (interleaved — pop/literary). Pick one per section and hold it.
- **Singability:** 7-10 syllables per line; stress pattern should land naturally ("TAKE me BACK to the SUM-mer…" — iambic-ish). Lines over 12 syllables get mumbled.
- **Concrete > abstract:** "your coffee cup still on the counter" beats "I feel empty inside you left".
- **Wrap lyric sections in structure tags** so the model maps words to sections.

Complete 16-line example (AABB verses, title hook opening the chorus, 8-10 syllables/line, concrete imagery):
```
[Intro — instrumental, 4 bars]

[Verse 1]
City lights are fading soft behind the hills        (10, A)
I keep your coffee cup to hold the morning still    (10, A)
The late train hums along the riverbend             (9, B)
I wrote your name in steam and watched it end       (9, B)

[Pre-Chorus]
Every mile of highway hums your name to me          (10)

[Chorus]
Take me back to the summer on the shoreline sand    (10, A) ← title hook, first line
Where the radio played and you held my hand         (10, A)
We were young, we were loud, we were gold in the sun (10, B)
I would give anything to be that one                (10, B)

[Verse 2]
Your jacket's on the hook where you left it there   (10, A)
A ticket stub and sand still in my hair             (10, A)
The neighbors ask me how I've been, I smile         (10, B)
I drive the long way home once in a while           (10, B)

[Outro]
Take me back… take me back…                         (hook repeat, fade)
```

### 4.6 Scenario Mapping Table (use FIRST, Rule 3)

| Scenario | Genre | BPM | Vocals? | Notes |
|---|---|---|---|---|
| Study / focus | lo-fi hip-hop / chillhop | 70-90 | instrumental | no sudden dynamics; loopable |
| Workout / gym | EDM / big-room house | 120-140 | instrumental or sparse shouts | constant energy, drops every ~60 s |
| Trailer / epic promo | cinematic orchestral + taiko | 90→140 | instrumental | build-impact shape |
| Podcast bed | minimal ambient / mellow lo-fi | 60-80 | instrumental | ≤-16 LUFS under voice; 15-20 s intro/outro |
| Game background | chiptune / orchestral loop | 100-140 | instrumental | seamless loop, no reverb tail |
| Ad jingle (15-30 s) | upbeat pop / corporate | 110-125 | vocal hook or none | hook in first 3 s, clean resolve |
| Meditation / sleep | ambient pads | 50-60 | instrumental | NO percussion, very slow swells |
| Vlog / travel montage | indie folk-pop / tropical house | 95-115 | light vocal OK | steady energy, no hard drops |

### 4.7 Audio Formats & Loudness

| Format | Use when | Why |
|---|---|---|
| WAV (PCM 16/24-bit) | masters, video muxing, further editing | lossless, universal |
| FLAC | archiving, audiophile delivery | lossless + ~40% smaller |
| MP3 320k | universal distribution copy | transparent to most ears |
| MP3 192k | podcasts, spoken-adjacent | good, smaller |
| MP3 128k | previews only | artifacts audible in cymbals |
| M4A/AAC 256k | Apple ecosystems, mobile | efficient, high quality |

- Sample rate: 44.1 kHz for music delivery; 48 kHz when muxing into video (video standard).
- Stereo for music; mono acceptable for single-voice podcast beds.
- Loudness: **-14 LUFS** streaming/video/social; **-16 LUFS** podcast; TP ≤ -1.0 dBTP (≤ -1.5 for lossy encode safety).

### 4.8 Post-Processing Recipe Index (full commands in §5)
Trim to exact duration · fade in/out (afade) · crossfade two tracks (acrossfade) · seamless loop (stream_loop + bar-boundary cut) · loudness normalize (loudnorm) · format conversion (libmp3lame/flac/aac) · metadata tags (-metadata) · sample-rate resample (-ar).

### 4.9 Integration Playbooks
- **Video BGM:** music length ≥ video; duck 10-12 dB under VO (volume 0.3 or sidechain); fade out 2 s; deliver 48 kHz WAV to video-generator.
- **Podcast intro/outro:** 15-20 s intro theme + 15-20 s outro theme, -16 LUFS, music-only bed ≤ -28 LUFS under speech.
- **Game loop:** verify seam by playing end→start join 5 times; normalize loop iteration loudness identical (-14 LUFS); deliver WAV 48 kHz.

### 4.10 Licensing & Ethics
- Check the generation platform's terms for COMMERCIAL USE rights and required attribution before delivery; NEVER assume.
- NEVER prompt to imitate a specific living artist's voice or signature style for deception or endorsement.
- NEVER present AI music as a named human artist's work; disclose AI generation where the publishing context requires it.
- NEVER sample or recreate recognizable copyrighted melodies; prompt for style families, not specific songs.

## 5. Code & Tool Templates

### 5.1 Generation call — generic REST shape (adaptable to your platform)

```python
# music_generate.py — Run: python music_generate.py prompt.txt 30 bgm_focus.wav
import os, sys, time, requests

API_URL = os.environ["MUSIC_API_URL"]          # e.g. https://api.example.com/v1/music
API_KEY = os.environ["MUSIC_API_KEY"]

def generate(prompt: str, duration_seconds: int, out: str) -> str:
    payload = {
        "prompt": prompt,                      # full layered prompt incl. structure tags
        "duration_seconds": duration_seconds,  # request exact length when supported
        "instrumental": True,                  # belt-and-braces with "no vocals" in prompt
        "format": "wav",
    }
    headers = {"Authorization": f"Bearer {API_KEY}"}
    for attempt in range(3):
        r = requests.post(API_URL, json=payload, headers=headers, timeout=300)
        if r.status_code == 200:
            body = r.json()
            if body.get("audio_b64"):
                import base64
                open(out, "wb").write(base64.b64decode(body["audio_b64"]))
                return out
            if body.get("audio_url"):
                open(out, "wb").write(requests.get(body["audio_url"], timeout=300).content)
                return out
            raise RuntimeError(f"Empty result: no audio in response: {body}")
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(4 * 2 ** attempt)       # music generation is slow: longer backoff
            continue
        r.raise_for_status()
    raise RuntimeError("All retries failed")

if __name__ == "__main__":
    prompt = open(sys.argv[1]).read()
    print("Saved:", generate(prompt, int(sys.argv[2]), sys.argv[3]))
```
(If your platform exposes an SDK music method — e.g. `await zai.audio.music({ prompt, duration_seconds })` — the same payload maps 1:1; decode base64 and save identically.)

### 5.2 Trim to exact duration with fades (the video-BGM finishing move)
```bash
# keep exactly 30 s: 0.5 s fade-in, 2 s fade-out starting at 28 s
ffmpeg -i track.wav -af "afade=t=in:st=0:d=0.5,afade=t=out:st=28:d=2" -t 30 bgm_30s.wav
```

### 5.3 Crossfade two tracks into one continuous bed
```bash
ffmpeg -i intro_theme.wav -i main_loop.wav -filter_complex "acrossfade=d=3:c1=tri:c2=tri" joined.wav
```

### 5.4 Seamless loop for games (stretch a loop to N minutes without a seam)
```bash
# -stream_loop -1 repeats infinitely; cut at 300 s for a 5-minute bed
ffmpeg -stream_loop -1 -i loop_8bars.wav -t 300 -c:a pcm_s16le bgm_5min.wav
```

### 5.5 Format conversion matrix
```bash
ffmpeg -i master.wav -codec:a libmp3lame -b:a 320k dist.mp3        # MP3 320k
ffmpeg -i master.wav -codec:a flac dist.flac                        # FLAC archive
ffmpeg -i master.wav -codec:a aac -b:a 256k dist.m4a                # AAC/M4A
ffmpeg -i master.wav -ar 48000 -c:a pcm_s16le master_48k.wav        # 48 kHz for video muxing
```

### 5.6 Loudness normalization (pick the target by destination)
```bash
ffmpeg -i track.wav -af "loudnorm=I=-14:TP=-1.0:LRA=11" -ar 44100 streaming.wav   # streaming/video
ffmpeg -i bed.wav    -af "loudnorm=I=-16:TP=-1.0:LRA=11" -ar 44100 podcast.wav    # podcast bed
```

### 5.7 Metadata tagging
```bash
ffmpeg -i dist.mp3 -c copy -metadata title="Shoreline Summer" -metadata artist="AI Studio" \
  -metadata album="Ad Beds Vol. 1" -metadata genre="Pop" -metadata date="2024" dist_tagged.mp3
```

### 5.8 Bar-boundary trim math (for loop assets)
```bash
# seconds per bar = 240 / BPM. At 120 BPM: 1 bar = 2 s → 16 bars = 32 s exactly.
ffmpeg -i raw.wav -t 32 loop_16bars.wav     # cut ON a bar boundary, never mid-bar
```

## 6. Decision Tables

**6.1 Vocal vs instrumental**

| Use case | Choice | Why |
|---|---|---|
| Any bed under voice (podcast, VO, tutorial) | Instrumental | vocals fight intelligibility — NEVER mix two voices |
| Focus/study/work | Instrumental | lyrics hijack language processing in the brain |
| Ad jingle, song request, artist demo | Vocal (or hook vocal) | the hook IS the product |
| Game/menu music | Instrumental | must survive 1000 repetitions |

**6.2 Format by destination**

| Destination | Format | Settings |
|---|---|---|
| Video editor / muxing | WAV | 48 kHz, 16-bit PCM |
| Streaming upload (Spotify etc.) | WAV master | 44.1 kHz, 24-bit, -14 LUFS |
| Web/social delivery | MP3 | 320k, 44.1 kHz |
| Apple/mobile | M4A AAC | 256k |
| Long-term archive | FLAC | lossless, ~40% smaller than WAV |

**6.3 Duration strategy**

| Situation | Strategy | Why |
|---|---|---|
| API supports exact duration | Request exact length | zero waste, clean structure |
| Only fixed-length output | Generate longer + trim with fade | trimming is lossless, extending impossible |
| Video BGM | ≥ video length, trim + 2 s fade-out | Rule 7 |
| Loop asset | Trim exactly to bar boundary (240/BPM × bars) | seam integrity |

**6.4 Loudness target**

| Destination | Integrated LUFS | True peak |
|---|---|---|
| Streaming/video/social | -14 | ≤ -1.0 dBTP |
| Podcast / speech-adjacent bed | -16 | ≤ -1.0 dBTP |
| Under-voice music bed only | ≤ -28 | ≤ -1.5 dBTP |

## 7. Quality Checklist

- [ ] Scenario mapped to genre/BPM/vocals via §4.6 BEFORE prompting
- [ ] Prompt states "instrumental, no vocals" explicitly when a bed is required
- [ ] Prompt includes BPM, instrumentation, and structure tags
- [ ] Exactly one genre + one subgenre (no genre soup)
- [ ] 2-3 variants generated; best selected with a stated reason
- [ ] Each iteration changed exactly ONE descriptor
- [ ] Duration matches the brief (±5%, or exact after trim)
- [ ] For video: music length ≥ video length, trimmed with fades
- [ ] Ending is clean: fade-out (1-3 s) or musical resolution — never a hard stop or mid-phrase cut
- [ ] No artifacts: no glitch loops, no sudden level jumps, no truncated phrases
- [ ] Loop assets: seam verified (end→start join plays 5x cleanly), cut on a bar boundary
- [ ] Loudness normalized: -14 LUFS streaming / -16 LUFS podcast / ≤-28 LUFS bed-under-voice
- [ ] Sample rate correct: 44.1 kHz music delivery, 48 kHz for video muxing
- [ ] Format matches destination (§6.2); master WAV + distribution copy both delivered
- [ ] Metadata tagged (title, artist, album, genre, date)
- [ ] Exact prompt + settings recorded and delivered for reproducibility
- [ ] Commercial-use license of the generation platform verified
- [ ] No imitation of a living artist's voice; AI disclosure added where required

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Omitting "instrumental, no vocals" | unwanted singer on a podcast bed | Rule 1: state it in the prompt AND the `instrumental` flag |
| 2 | No BPM in prompt | tempo (and mood) lands randomly | Always specify BPM |
| 3 | Genre soup ("jazz-trap-orchestral") | incoherent mush | One genre + one subgenre (Rule 4) |
| 4 | Changing 4 descriptors per iteration | thrash, no learning | ONE descriptor per run (Rule 5) |
| 5 | Track ends mid-phrase | jarring cutoff on playback | Fade out or regenerate ending (Rule 6) |
| 6 | Music shorter than the video | silence gap at the end | Generate ≥ video length, trim (Rule 7) |
| 7 | Delivered at raw level (±6 LU swings) | platform turns it down/up, inconsistent | loudnorm to -14/-16 LUFS (Rule 8) |
| 8 | Loop cut mid-bar | audible click/double-hit at seam | Cut at bar boundary: 240/BPM × bars (§5.8) |
| 9 | 128k MP3 as the only deliverable | swishy cymbals, dull top end | WAV master + MP3 320k copy |
| 10 | 44.1 kHz file muxed into 48 kHz video | resample artifacts in the mux | Deliver 48 kHz for video work (Rule 11) |
| 11 | Lyrics with 14-syllable lines | mumbled, rushed vocal | 7-10 syllables per line (§4.5) |
| 12 | Abstract lyric imagery ("emotions collide") | generic, forgettable | Concrete images: objects, places, actions |
| 13 | Prompting a named living artist's style | policy violation, deception risk | Style families only (Rule 9) |
| 14 | Fade on a 15 s jingle | hook never lands / weak ending | Short ads resolve cleanly; fades are for beds |

## 9. Advanced Techniques

### 9.1 Two-pass loudness for critical masters
```bash
ffmpeg -i master.wav -af "loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json" -f null - 2> measure.json
# read measured_I/measured_TP/measured_LRA/measured_thresh, then apply linear=true pass:
ffmpeg -i master.wav -af "loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=-15.9:measured_TP=0.4:measured_LRA=8.3:measured_thresh=-26.7:linear=true" -ar 44100 master_norm.wav
```
One-pass loudnorm can shift dynamics; the linear two-pass preserves the mix.

### 9.2 Key-matching a sequel track
When a second track must follow the first (playlist, game world), keep the same key and BPM, or move by the Camelot wheel (adjacent number = smooth, e.g. 8A→9A; same number A→B = mood lift). Put "A minor, 124 BPM" in both prompts — matching numbers, not vibes.

### 9.3 Stem-style layering for adaptive game audio
Generate 2-3 siblings of the SAME prompt differing only in energy tag ("calm exploration" / "tension rising" / "combat intensity"), all in one key at one BPM, trimmed to identical bar counts. Crossfade between layers at gameplay-state changes — they stay in sync because bar math matches (§5.8).

### 9.4 Podcast ducking bed (music sinks under speech automatically)
```bash
ffmpeg -i speech.wav -i bed.wav -filter_complex \
"[1:a]asplit=2[sc][mix];[0:a][sc]sidechaincompress=threshold=0.02:ratio=6:attack=50:release=500[duck];\
[mix][duck]amix=inputs=2:duration=first[m]" -map "[m]" podcast_ducked.wav
```

### 9.5 Hook-first ad bed workflow
For 15-30 s ads: generate a 60 s track with the hook early ([Intro] kept ≤ 4 bars), then in post cut a 15 s segment that STARTS on the hook's bar and resolves with a 1 s fade at the end. Deliver both full and cut versions.

### 9.6 Beat-matched video cuts
Give video-generator the BPM: at 120 BPM, cut points every 2 s land on beats (bar = 2 s); at 100 BPM every 2.4 s. Storyboard shot durations as multiples of the bar length and the edit locks to the music without warping anything.

## 10. Quick Reference Card

- Prompt stack: **genre + subgenre + mood + instruments + BPM + key + production + [structure tags] + vocal spec**; always "instrumental, no vocals" for beds.
- Tempo map: 50-60 meditate · 60-80 chill · 90-110 groove · 120-128 house · 140+ aggressive.
- Bar math: seconds per bar = 240/BPM; 16 bars @120 = 32 s.
- Progressions: I–V–vi–IV uplift · ii–V–I jazz · i–VI–III–VII epic.
- Scenario first: study→lo-fi 70-90 · workout→EDM 120-140 · trailer→orchestral build · podcast→ambient ≤-16 LUFS · game→loop · ad→hook in 3 s.
- Structure: radio = Intro≤8s V-PC-C-V-PC-C-Bridge-C; loop = no intro/outro, bar-boundary seam.
- Lyrics: verses tell / chorus sells; title in chorus line 1; AABB or ABAB; 7-10 syllables.
- Post: trim `-t` · fades `afade` · crossfade `acrossfade=d=3` · loop `-stream_loop -1` · loudness `loudnorm=I=-14:TP=-1.0:LRA=11` · 48 kHz for video · MP3 320k distribution.
- Iterate: 2-3 variants → ONE descriptor per retry.
- Ethics: commercial license check · no living-artist imitation · disclose AI where required.

