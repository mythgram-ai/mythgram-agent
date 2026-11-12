---
name: voice-response
description: >
  Text-to-speech (TTS) pipeline operating manual covering the full chain from
  raw text to polished audio: text normalization (numbers, dates, times,
  currency, percentages, units, abbreviations, URLs, acronyms, symbols),
  TTS-friendly rewriting for the ear, voice and speed selection, pausing
  control, long-form chunking with silence-stitched concatenation, multi-voice
  dialogue production, ffmpeg post-processing (silence trim, loudness
  normalization, format conversion), and a mandatory ASR-based verification
  loop. Use this whenever the user asks to: convert text to speech, make an
  audio version of an article or post, read text aloud, generate a voiceover,
  narration, voice assistant reply, IVR menu, podcast intro voice, audiobook
  chapter, or accessibility reading; synthesize dialogue between two or more
  characters; fix robotic or wrong-sounding TTS output (numbers read
  literally, dates garbled, abbreviations spelled out); or prepare a timed VO
  file for a video. Also use when the user says "turn this into audio", "make
  it speak", "TTS this", "voice this script", or complains that synthesized
  speech mispronounces or rushes text. Do NOT use for: sung vocals or music —
  that is music-generator's job; assembling the VO into a finished video —
  video-generator (this skill exports the timed VO file for it); or
  transcribing existing audio — the ASR skill (though this skill CALLS ASR
  for its verification loop).
---
# Voice Response
> Produce natural spoken audio by normalizing text for the ear, synthesizing in disciplined chunks, post-processing to loudness spec, and verifying every output against its source.

## 0. Operating Rules (Non-Negotiable)

1. ALWAYS normalize text BEFORE synthesis (§4.1). Raw text is the #1 quality killer: "1,250", "2024-11-05", "$5.99" get read literally or garbled. The TTS model does not fix your text; it speaks your text.
2. NEVER send unbounded text in one request. Chunk at 800-1,000 characters and ONLY at paragraph or sentence boundaries — mid-sentence chunks produce audible prosody cliffs.
3. ALWAYS keep voice ID and speed IDENTICAL across all chunks of one deliverable. A chunk rendered with a different voice or 0.95 vs 1.0 speed is an instant re-render.
4. NEVER set speed below 0.8 — below that speech sounds intoxicated, not slow. If the user wants slower delivery, rewrite shorter sentences and add punctuation instead.
5. ALWAYS end every sentence with terminal punctuation (period, question mark, exclamation). TTS derives prosody and pause length from punctuation; unpunctuated text is read as one breathless run.
6. NEVER leave emojis, URLs, or symbols (@, #, /) in spoken text. Strip emojis or convert to words; replace URLs with "the link in the description"; spell out or rephrase symbols.
7. ALWAYS verify output with the ASR diff loop (§4.8): transcribe the result back and compare to the normalized source. This catches truncation, wrong numbers, and dropped chunks automatically.
8. ALWAYS sanity-check duration: speech at 1.0x runs ≈150 words/minute. A 900-word script that renders in 2 minutes means a chunk was silently dropped.
9. ALWAYS post-process: trim leading/trailing silence, loudness-normalize (-16 LUFS podcast / -14 LUFS streaming-adjacent), convert to the delivery format. Raw TTS output has hot levels and ragged edges.
10. ALWAYS wrap synthesis calls in error handling: empty/whitespace input (reject), too-long input (chunk), invalid voice ID (fall back to the platform default and SAY so), rate limits (exponential backoff, 3 tries).
11. NEVER splice different voices for one character across a deliverable, and NEVER pick a second voice for dialogue that differs only slightly from the first — distinguish speakers by gender/age/energy, not by 0.05 speed tweaks.
12. ALWAYS disclose synthetic voice when content is published as if spoken by a real person (podcast hosts, endorsements, IVR that claims to be human).

## 1. When to Use / When Not To

**Use this skill when the user:**
- wants text spoken: article→audio, blog→podcast, "read this to me", accessibility reading.
- needs voiceover for video (export a timed VO file for video-generator).
- wants an assistant reply, IVR menu set, notification voice, kiosk prompt.
- needs an audiobook chapter or long-form narration with chapter gaps.
- wants multi-voice dialogue (skit, interview simulation, ad read).
- reports TTS reading numbers/dates/abbreviations wrong.

**Routing table:**

| The request mentions | Correct skill | Why |
|---|---|---|
| song, singing, music, melody, beat | music-generator | musical audio, not speech |
| put the VO into video, sync with clips | video-generator | assembly; this skill exports the timed VO |
| transcribe an existing audio file | ASR skill | recognition (this skill uses ASR only for QA) |
| subtitles/captions for a video | video-generator (SRT handling) | caption pipeline lives with the video |
| "make it sound like [celebrity]" | refuse / generic voice | voice-cloning of real people is a deception vector |

## 2. Core Concepts & Mental Models

- **TTS speaks text literally.** It has no world knowledge: "3.14" is "three one four" unless you write "three point one four". Normalization is the craft; synthesis is the easy part.
- **Prosody comes from punctuation.** Period = full stop + pitch drop; comma = short rise; em dash = suspension; paragraph break = big breath. You compose phrasing WITH punctuation marks.
- **Chunking is a prosody tool, not just a size limit.** Chunks = breath groups. Equal-length garbage chunks sound mechanical; paragraph-aligned chunks sound natural.
- **Voice = a bundle of attributes** (gender impression, age, accent, energy, warmth) — pick by audience and use case (§4.3), never by "sounding cool".
- **Speed 0.9-1.1 is the natural window.** Slower comprehension comes from shorter sentences, not from dragging the rate.
- **Verification closes the loop.** ASR the output, diff against source: machines catching machines is the only scalable QA for long audio.
- **Silence is a first-class audio object.** Pauses between sections (250-400 ms) and between dialogue turns (300-500 ms) are inserted as real audio, not hoped for from punctuation.

## 3. Mandatory Workflow

1. **Collect the script and its spec:** use case (assistant/audiobook/IVR/VO), desired voice character, speed, output format, duration target. MUST resolve use case — it drives voice, speed, and loudness targets.
2. **Normalize the text** (§4.1 reference function): expand numbers, dates, times, currency, percentages, units, abbreviations, URLs, acronyms, symbols, ordinals. Run the function; NEVER eyeball this.
3. **Rewrite for the ear** (§4.2): sentences ≤25 words, one clause deep, contractions, active voice, no parentheses/semicolons, homograph traps rephrased, acronyms spelled on first use.
4. **Chunk** at paragraph boundaries to 800-1,000 chars (§5.4). NEVER mid-sentence (Rule 2).
5. **Synthesize chunk by chunk** with the locked voice+speed (§5.1/§5.2), retry/backoff on failure, descriptive filenames `chunk_001.wav`….
6. **Concat with designed silence:** 250-400 ms between sections, 300-500 ms between dialogue turns (§5.5).
7. **Post-process:** trim edge silence, loudnorm to target, fades, format conversion (§5.6).
8. **QA loop (MANDATORY):** ASR-diff vs source (§5.7), duration plausibility (§5.8), waveform/clipping inspection, spot-listen for numbers/dates/acronyms. Fix and re-run until clean.
9. **Deliver:** final file(s) in the requested format, plus the normalized script and a spec line (voice, speed, duration, LUFS, format). If the deliverable is video VO, also deliver a timing sheet (line → start second) for video-generator.

## 4. Deep Knowledge Library

### 4.1 Text Normalization — The #1 Quality Factor

Expand BEFORE synthesis. Rules with worked examples:

| Category | Raw | Spoken (write this) |
|---|---|---|
| Numbers | 1,250 units | one thousand two hundred fifty units |
| Year | 2024 | twenty twenty-four |
| Decimal | 3.14 | three point one four |
| Date (ISO) | 2024-11-05 | November fifth, twenty twenty-four |
| Time (12h) | 2:30 pm | two thirty pm |
| Time (24h) | 14:30 | fourteen thirty |
| Currency | $5.99 | five dollars and ninety-nine cents |
| Currency | $1,250 | one thousand two hundred fifty dollars |
| Percentage | 45% | forty-five percent |
| Units | 5 km, 3 °C | five kilometers, three degrees Celsius |
| Abbreviations | Dr., vs., e.g., approx. | Doctor, versus, for example, approximately |
| URL | https://x.com/a | the link in the description |
| Acronym (letters) | NASA, FAQ | say letter-by-letter (en-ay-es-ay → "N A S A") |
| Acronym (words) | NATO, LEGO | say as a word |
| Symbols | & / % # | and / slash / percent / (rephrase "#1" → "number one") |
| Ordinals | 1st, 21st | first, twenty-first |
| Emoji | 🎉🚀 | strip, or "hooray" if the tone needs it |

Acronym rule of thumb: pronounceable consonant-vowel alternation (NATO, LEGO, Scuba) → word; unpronounceable clusters (NASA, FAQ, API, UI) → letters. When ambiguous ("SQL"), pick the form your audience uses and stay consistent.

### 4.2 TTS-Friendly Rewriting (for the ear, not the eye)

- Sentences ≤25 words; one clause deep. Split with periods, not commas.
- Contractions ("we're", "it's") — written form sounds stiff spoken.
- Active voice: "We shipped the update" not "The update was shipped by us".
- Spell out on first use: "application programming interface, or API" — thereafter "API".
- Rephrase homograph traps: "read" → "has read"/"will read" context or rewrite; "lead" (metal) → "led"; "live" (adj/verb) → rewrite; "wound" → "injury"/"he wound up". If pronunciation depends on unseen context, the listener guesses wrong.
- No parentheses, semicolons, or footnotes — they are visual grammar; speech has no way to render them.
- Numbers you'll compare: keep the same format throughout ("fifteen of the fifty" not "15 of the fifty").
- End EVERY sentence with terminal punctuation (Rule 5).

### 4.3 Voice Selection — Attribute Dimensions & Use-Case Matching

Dimensions: gender impression · age impression (young adult / mature) · accent · energy (low/warm vs high/bright) · warmth (soft vs crisp).

| Use case | Voice character | Speed | Notes |
|---|---|---|---|
| Assistant / conversational | warm neutral, medium energy | 1.0 | friendly, not breathy |
| Audiobook narration | mature, steady, low-medium energy | 0.95-1.0 | consistent for hours |
| News read | crisp neutral, medium-high energy | 1.0-1.05 | authoritative clarity |
| Advertisement | energetic, bright | 1.05-1.1 | push pace, punchy script |
| Meditation / sleep | soft, slow, low energy | 0.85-0.9 | long pauses (§4.4) |
| Children's content | bright, higher pitch | 0.95 | exaggerated punctuation |
| IVR / phone system | clear neutral, medium | 0.95-1.0 | max intelligibility, no personality stunts |

Speed window: 0.9-1.1 sweet spot; NEVER < 0.8 (Rule 4). Chunk-level speed must never vary within one deliverable (Rule 3).

### 4.4 Pausing Control

Where SSML or break syntax is supported, use it explicitly:
```xml
Welcome back.<break time="500ms"/>Today's topic: text normalization.
```
Otherwise compose pauses with punctuation (approximate relative lengths):

| Marker | Pause | Effect |
|---|---|---|
| comma | ~150 ms | light rise, list rhythm |
| period + space | ~300-400 ms | full stop, pitch drop |
| em dash — | ~400-500 ms | suspension, "and then…" |
| ellipsis … | ~500-700 ms | trailing thought |
| paragraph break | ~600-900 ms | scene change breath |
| (inserted silence file) | exact ms | chapter/dialogue gaps (§5.5) |

Technique: for a needed pause that punctuation won't give, split the sentence into two — "This matters. A lot." reads with emphasis AND a pause.

### 4.5 Long-Form Chunking & Concatenation
- Chunk size: 800-1,000 characters, cut at paragraph boundaries; oversize paragraphs split at sentence boundaries; a single sentence >1,000 chars (rare) splits at semicolons/colons as a last resort.
- Keep identical voice+speed across chunks (Rule 3); number chunks with zero-padding so order is unambiguous.
- Insert designed silence between paragraph sets/chapters: 250-400 ms normal, 1-2 s between book chapters.
- Concat with the ffmpeg demuxer (§5.5) — NEVER re-encode between chunks.
- Audiobook pipeline: normalize whole book → chunk per paragraph → synthesize → per-chapter concat with 1.5 s gap → per-chapter loudnorm → export per-chapter files + metadata tags.

### 4.6 Multi-Voice Dialogue Production
Script format (one line per turn, speaker prefix):
```
HOST: Welcome back to the show. Today we answer one question: does speed matter more than quality?
EXPERT: Quality compounds. Speed just gets you to the same wall faster.
HOST: So what should a small team do first?
EXPERT: Build quality first. Then add speed.
```
- Synthesize each line separately with that speaker's voice config; zero-pad filenames in reading order (`line_001_HOST.wav`).
- Concat with 300-500 ms gaps between turns (silence file, §5.5).
- Distinguish speakers by attribute bundle (gender/age/energy), optionally ±3% pitch — NEVER two near-identical voices (Rule 11).
- Keep a voice map in the delivery notes so future episodes reuse the same cast.

### 4.7 Post-Processing Recipes (full commands in §5.6)
Edge-silence trim (silenceremove + areverse trick) · loudness normalize (loudnorm I=-16 podcast / I=-14 general) · fade in/out (afade) · resample (-ar 44100/48000) · WAV→MP3 192k (libmp3lame) · concat (demuxer).

### 4.8 QA Loop — Four Gates (MANDATORY)
1. **ASR diff (automated):** transcribe output, normalize both sides (lowercase, collapse whitespace), compare with difflib; similarity <0.9 = investigate (§5.7). Catches truncation, wrong numbers, dropped chunks.
2. **Duration plausibility:** expected seconds ≈ words/150×60 at 1.0x (scale by 1/speed). Outside 0.6x-1.6x of expected = something is missing (§5.8).
3. **Waveform/clipping inspection:** peaks ≤ -1 dBTP after loudnorm; no flat-line (silent) stretches longer than ~2 s mid-file; listen to first/last 10 s.
4. **Semantic spot-check:** verify every number, date, acronym, and proper noun in the first/last/middle of the file matches the normalized script.

### 4.9 Use-Case Playbooks with Settings

| Playbook | Voice | Speed | Format/loudness | Special steps |
|---|---|---|---|---|
| Article → audio | warm neutral | 1.0 | MP3 192k, -14 LUFS | normalize+rewrite, chunk, concat, ASR QA |
| Assistant reply | warm neutral | 1.0 | MP3 128k, -14 LUFS | short (<300 chars), no chunking, low latency path |
| IVR menu set | clear neutral | 0.95 | WAV 8 kHz μ-law or 44.1k WAV | one file per prompt: menu/wait/error/goodbye; consistent take style |
| Audiobook chapter | mature steady | 0.95-1.0 | per-chapter MP3 192k, -16 LUFS | chapter gaps 1.5 s, metadata tags |
| Video VO | per video brief | 0.95-1.05 | WAV 48 kHz | build timing sheet: line → start second; export for video-generator |
| Accessibility reading | clear neutral | 0.9-1.0 | MP3 192k | extra care: expand EVERY abbreviation, slower commas |

### 4.10 Error Handling & Edge Cases
- Empty/whitespace-only input → reject BEFORE calling the API (fail fast, §5.2).
- Too-long single request → chunk (Rule 2); too-long single WORD (URLs, hashes) → insert spaces or spell it.
- Mixed languages → synthesize per-language segments with a voice that supports each, then concat; do NOT send one request and hope.
- Emoji → strip or verbalize (Rule 6); unpaired quotes/brackets → remove (they cause tone glitches).
- Invalid voice ID → catch, fall back to platform default voice, and TELL the user in the delivery note.
- Rate limits (429) → exponential backoff, 3 attempts, resume from last successful chunk (checkpoint pattern, §5.3).

## 5. Code & Tool Templates

### 5.1 Node SDK (z-ai-web-dev-sdk) — synthesize one chunk

```js
// tts.mjs — Node 18+. Run: node tts.mjs "text" out.mp3
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs/promises';

const TEXT = process.argv[2];
const OUT = process.argv[3] ?? `speech_${Date.now()}.mp3`;

if (!TEXT || !TEXT.trim()) {
  console.error('Empty input — refusing to call the API.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synth() {
  const zai = await ZAI.create();
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await zai.audio.speech({
        input: TEXT,
        voice: 'tongtong',   // any voice ID your platform supports; keep IDENTICAL across chunks
        speed: 1.0,          // never below 0.8
        format: 'mp3',
      });
      const b64 = res?.data?.base64 ?? res?.base64 ?? res?.audio;
      if (!b64) throw new Error('Empty result: no audio payload in response');
      await fs.writeFile(OUT, Buffer.from(b64, 'base64'));
      console.log(`Saved ${OUT}`);
      return OUT;
    } catch (err) {
      lastErr = err;
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`Attempt ${attempt} failed: ${err.message}. Retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

synth().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

### 5.2 Python REST (OpenAI-style payload) — same contract

```python
# tts_rest.py — Run: python tts_rest.py input.txt out.mp3
import os, sys, time, requests

API_URL = os.environ["TTS_API_URL"]            # e.g. https://api.example.com/v1/audio/speech
API_KEY = os.environ["TTS_API_KEY"]
VOICE, MODEL, SPEED = "alloy", "tts-1", 1.0    # keep IDENTICAL across all chunks

def synth(text: str, out: str) -> str:
    if not text.strip():
        raise ValueError("Empty input — refusing to call the API")
    for attempt in range(3):
        r = requests.post(API_URL,
            json={"model": MODEL, "input": text, "voice": VOICE,
                  "response_format": "mp3", "speed": SPEED},
            headers={"Authorization": f"Bearer {API_KEY}"}, timeout=120)
        if r.status_code == 200:
            if len(r.content) < 1000:
                raise RuntimeError(f"Suspiciously small audio ({len(r.content)} B) — possible truncation")
            open(out, "wb").write(r.content)
            return out
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 * 2 ** attempt); continue
        r.raise_for_status()
    raise RuntimeError("All retries failed")

if __name__ == "__main__":
    text = open(sys.argv[1], encoding="utf-8").read()
    print("Saved:", synth(text, sys.argv[2] if len(sys.argv) > 2 else "speech.mp3"))
```

### 5.3 Reference normalize() — production-ready implementation

```python
# normalize.py — run: python normalize.py input.txt
import re, sys

ONES = {0:"zero",1:"one",2:"two",3:"three",4:"four",5:"five",6:"six",7:"seven",8:"eight",
        9:"nine",10:"ten",11:"eleven",12:"twelve",13:"thirteen",14:"fourteen",15:"fifteen",
        16:"sixteen",17:"seventeen",18:"eighteen",19:"nineteen",20:"twenty",30:"thirty",
        40:"forty",50:"fifty",60:"sixty",70:"seventy",80:"eighty",90:"ninety"}
ORDS = {1:"first",2:"second",3:"third",4:"fourth",5:"fifth",6:"sixth",7:"seventh",8:"eighth",
        9:"ninth",10:"tenth",11:"eleventh",12:"twelfth",13:"thirteenth",14:"fourteenth",
        15:"fifteenth",16:"sixteenth",17:"seventeenth",18:"eighteenth",19:"nineteenth",
        20:"twentieth",30:"thirtieth"}
MONTHS = ["January","February","March","April","May","June","July","August",
          "September","October","November","December"]

def num_words(n: int) -> str:
    if n < 0: return "minus " + num_words(-n)
    if n in ONES: return ONES[n]
    if n < 100:
        t = ONES[(n // 10) * 10]
        return t + ("-" + ONES[n % 10] if n % 10 else "")
    if n < 1000:
        return ONES[n // 100] + " hundred" + (" " + num_words(n % 100) if n % 100 else "")
    for div, word in ((1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")):
        if n >= div:
            return num_words(n // div) + " " + word + (" " + num_words(n % div) if n % div else "")
    return str(n)

def year_words(y: int) -> str:
    hi, lo = divmod(y, 100)
    if lo == 0: return num_words(hi) + " hundred"
    if lo < 10: return num_words(hi) + " oh " + ONES[lo]      # 1905 -> nineteen oh five
    return num_words(hi) + " " + num_words(lo)                # 2024 -> twenty twenty-four

ABBREV = {"Dr.":"Doctor","Mr.":"Mister","Mrs.":"Missus","Ms.":"Miss","Prof.":"Professor",
          "St.":"Saint","vs.":"versus","etc.":"et cetera","e.g.":"for example",
          "i.e.":"that is","approx.":"approximately","Fig.":"Figure"}

def normalize(text: str) -> str:
    text = re.sub(r"https?://\S+", " the link in the description ", text)          # 1 URLs
    for k, v in ABBREV.items():                                                    # 2 abbreviations
        text = text.replace(k, v)
    def money(m):                                                                  # 3 currency
        whole, _, frac = m.group(1).replace(",", "").partition(".")
        w = num_words(int(whole)) + " dollars"
        if frac: w += " and " + num_words(int(frac)) + " cents"
        return w
    text = re.sub(r"\$(\d[\d,]*(?:\.\d+)?)", money, text)
    text = re.sub(r"(\d[\d,]*)\s?%",                                               # 4 percentages
                  lambda m: num_words(int(m.group(1).replace(",", ""))) + " percent", text)
    def iso_date(m):                                                               # 5 dates
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            day = ORDS.get(d, num_words(d))
            return f"{MONTHS[mo-1]} {day}, {year_words(y)}"
        return m.group(0)
    text = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", iso_date, text)
    def clock(m):                                                                  # 6 times
        h, mins, ap = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
        if ap in ("am", "pm"):
            return f"{num_words(h % 12 or 12)} {num_words(mins)} {ap}"
        return f"{num_words(h)} {num_words(mins)}"                                 # 14:30 -> fourteen thirty
    text = re.sub(r"\b(\d{1,2}):(\d{2})\s?(am|pm|AM|PM)?\b", clock, text)
    def decimal(m):                                                                # 7 decimals
        digits = " ".join(ONES[int(d)] for d in m.group(2))
        return num_words(int(m.group(1))) + " point " + digits
    text = re.sub(r"\b(\d+)\.(\d+)\b", decimal, text)
    text = re.sub(r"\b(19\d{2}|20\d{2})\b", lambda m: year_words(int(m.group(1))), text)  # 8 years
    text = re.sub(r"\b\d{1,3}(,\d{3})+\b",                                         # 9 comma numbers
                  lambda m: num_words(int(m.group(0).replace(",", ""))), text)
    text = re.sub(r"\b(\d+)(st|nd|rd|th)\b",                                       # 10 ordinals
                  lambda m: ORDS.get(int(m.group(1)), num_words(int(m.group(1)))), text)
    text = re.sub(r"\b\d+\b", lambda m: num_words(int(m.group(0))), text)          # 11 plain integers
    text = text.replace("°C", " degrees Celsius").replace("°F", " degrees Fahrenheit")
    text = text.replace(" km", " kilometers").replace(" kg", " kilograms")
    text = text.replace("%", " percent").replace(" & ", " and ").replace("#1", "number one")
    text = re.sub(r"[^\x00-\x7F]+", " ", text)                                     # 12 strip emoji/non-ascii
    return re.sub(r"\s+", " ", text).strip()                                       # 13 whitespace tidy

if __name__ == "__main__":
    print(normalize(open(sys.argv[1], encoding="utf-8").read()))
```
NOTE the ordering: money → percent → date → time → decimal → year → comma-numbers → ordinals → integers. Reordering breaks compound cases ("$5.99" must be consumed by money before the decimal rule sees it).

### 5.4 Paragraph-safe chunker

```python
# chunker.py — split at paragraph, then sentence boundaries. NEVER mid-sentence.
import re

def chunk_for_tts(text: str, max_chars: int = 900) -> list[str]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, buf = [], ""
    def flush():
        nonlocal buf
        if buf.strip(): chunks.append(" ".join(buf.split()))
        buf = ""
    for para in paragraphs:
        pieces = [para] if len(para) <= max_chars else re.split(r'(?<=[.!?])\s+', para)
        for piece in pieces:
            if len(buf) + len(piece) + 2 > max_chars:
                flush()
            buf += ("\n\n" if buf.endswith((".", "!", "?")) else " ") + piece if buf else piece
    flush()
    return chunks   # each chunk < max_chars, boundaries at paragraph/sentence edges
```

### 5.5 Concat chunks with designed silence (ffmpeg)

```bash
# one silence file, reused everywhere
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.35 -c:a pcm_s16le silence_350ms.wav
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1.5  -c:a pcm_s16le silence_chapter.wav

cat > list.txt <<'EOF'
file 'chunks/chunk_001.wav'
file 'silence_350ms.wav'
file 'chunks/chunk_002.wav'
file 'silence_350ms.wav'
file 'chunks/chunk_003.wav'
file 'silence_chapter.wav'
file 'chunks/chunk_004.wav'
EOF
ffmpeg -f concat -safe 0 -i list.txt -c:a pcm_s16le book_raw.wav
```

### 5.6 Post-processing chain (trim edges → normalize → fade → convert)

```bash
# 1. trim leading/trailing silence (reverse trick catches the tail)
ffmpeg -i book_raw.wav -af \
"silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse" \
book_trim.wav
# 2. loudness normalize (-16 podcast / -14 general) + gentle fade-in
ffmpeg -i book_trim.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.2" -ar 44100 book_clean.wav
# 3. delivery encode
ffmpeg -i book_clean.wav -codec:a libmp3lame -b:a 192k -metadata title="Chapter 1" book_ch01.mp3
```

### 5.7 ASR verification loop (gate 1 of §4.8)

```python
# verify.py — transcribe the output and diff against the normalized source
import difflib, re, requests

def asr_text(path: str) -> str:
    with open(path, "rb") as f:
        r = requests.post(f"{os.environ['ASR_API_URL']}", files={"file": f},
                          headers={"Authorization": f"Bearer {os.environ['ASR_API_KEY']}"})
    r.raise_for_status()
    return r.json()["text"]

def tidy(s: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", "", s.lower()).split())

source, heard = tidy(NORMALIZED_SCRIPT), tidy(asr_text("book_ch01.mp3"))
ratio = difflib.SequenceMatcher(None, source, heard).ratio()
print(f"ASR similarity: {ratio:.3f}")
assert ratio > 0.9, f"Verification failed ({ratio:.3f}) — inspect numbers/dates/end of file"
```

### 5.8 Duration plausibility check (gate 2)

```python
import subprocess, json
def probe_duration(path: str) -> float:
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries",
                                   "format=duration", "-of", "json", path])
    return float(json.loads(out)["format"]["duration"])

words = len(NORMALIZED_SCRIPT.split())
expected = words / 150 * 60 / SPEED          # 150 wpm at 1.0x
actual = probe_duration("book_ch01.mp3")
assert 0.6 * expected <= actual <= 1.6 * expected, \
    f"Duration implausible: {actual:.0f}s vs expected ~{expected:.0f}s — a chunk likely dropped"
```

### 5.9 Multi-voice dialogue runner

```python
# dialogue.py — script.txt lines: "SPEAKER: text"
VOICES = {"HOST":   {"voice": "alloy",   "speed": 1.0},
          "EXPERT": {"voice": "onyx",    "speed": 0.97}}   # distinguish by bundle, not tweak
import subprocess
n = 0
files = []
for line in open("script.txt", encoding="utf-8"):
    speaker, _, text = line.partition(":")
    if not text.strip(): continue
    n += 1
    cfg = VOICES[speaker.strip()]
    out = f"lines/line_{n:03d}_{speaker.strip()}.wav"
    synth(text.strip(), out, **cfg)                       # same synth() as §5.2, parameterized
    files.append(out)
# interleave 0.4 s silence and concat (§5.5 pattern)
with open("list.txt", "w") as f:
    for i, fn in enumerate(files):
        f.write(f"file '{fn}'\n")
        if i < len(files) - 1:
            f.write("file 'silence_400ms.wav'\n")
subprocess.run(["ffmpeg", "-f", "concat", "-safe", "0", "-i", "list.txt",
                "-c:a", "pcm_s16le", "dialogue_raw.wav"], check=True)
```

## 6. Decision Tables

**6.1 Speed choice**

| Need | Setting | Why |
|---|---|---|
| Natural conversation | 1.0 | models are tuned here |
| Comprehension-heavy content | 0.95 + shorter sentences | clarity without drunkenness |
| Energetic ad | 1.05-1.1 + punchy script | pace sells |
| "Make it slower" request | NEVER < 0.8 — rewrite instead | sub-0.8 sounds unnatural (Rule 4) |

**6.2 Output format**

| Destination | Format | Why |
|---|---|---|
| Podcast / audiobook | MP3 192k (-16 LUFS) | standard, small, good quality |
| Web/app assistant reply | MP3 128k | latency and size matter most |
| Video VO | WAV 48 kHz | lossless into the video mux |
| IVR / telephony | WAV 8 kHz μ-law (or provider spec) | phone systems require it |
| Archival master | WAV 44.1/48 kHz 24-bit | no generation loss |

**6.3 Voice by use case** — see §4.3 table; assistant=warm neutral 1.0x · audiobook=mature steady · news=crisp · ad=energetic 1.05 · meditation=soft slow · IVR=clear neutral.

**6.4 Pause strategy**

| Need | Tool |
|---|---|
| Light beat in a sentence | comma |
| Full stop | period (Rule 5) |
| Suspension / dramatic hold | em dash or ellipsis |
| Exact ms gap (spec'd, chapters, dialogue) | inserted silence file (§5.5) — punctuation cannot be trusted for exact timing |
| SSML-capable platform | `<break time="500ms"/>` |

## 7. Quality Checklist

- [ ] Use case resolved BEFORE voice/speed/format chosen (§4.3/§4.9)
- [ ] normalize() ran on the FULL script — no raw numbers, dates, currency, symbols remain
- [ ] Every abbreviation expanded or consciously kept (acronym policy applied)
- [ ] No emojis, URLs, @handles, or stray symbols in spoken text
- [ ] Sentences ≤25 words; no parentheses/semicolons; every sentence ends with terminal punctuation
- [ ] Homograph traps (read/lead/live/wound) rephrased or disambiguated
- [ ] Chunks 800-1,000 chars, cut at paragraph/sentence boundaries — zero mid-sentence cuts
- [ ] Same voice ID and speed on EVERY chunk of the deliverable
- [ ] Filenames zero-padded in reading order; no chunk skipped (checkpoint log complete)
- [ ] Designed silences inserted: 250-400 ms sections, 300-500 ms dialogue turns, 1-2 s chapters
- [ ] Edge silence trimmed; no dead air >2 s mid-file
- [ ] Loudness normalized: -16 LUFS podcast / -14 LUFS general; TP ≤ -1.5 dBTP
- [ ] Fade-in (and fade-out for endings) applied
- [ ] Format matches destination (§6.2); resample to 44.1/48 kHz as required
- [ ] ASR-diff similarity > 0.90 against normalized source
- [ ] Duration plausible: within 0.6x-1.6x of words/150/60 ÷ speed
- [ ] Numbers, dates, acronyms, and proper nouns spot-verified at start/middle/end
- [ ] Multi-voice: speakers distinguished by attribute bundle; voice map documented
- [ ] Delivery notes include voice, speed, duration, LUFS, format, and the normalized script
- [ ] Synthetic-voice disclosure added where content implies a real human speaker

## 8. Common Mistakes & Fixes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Raw numbers in text | "1,250" read as "one comma two fifty" | normalize() before synthesis (Rule 1) |
| 2 | Raw dates | "2024-11-05" garbled | Expand to "November fifth, twenty twenty-four" |
| 3 | Unchunked long input | request rejected or tail truncated | Chunk 800-1,000 chars at paragraph edges (Rule 2) |
| 4 | Mid-sentence chunk split | prosody cliff, robotic seam | Sentence-boundary chunking (§5.4) |
| 5 | Speed 0.75 for "slow" | drunk-sounding speech | 0.9-1.1 window; slow via shorter sentences (Rule 4) |
| 6 | Missing terminal punctuation | breathless run-on delivery | End every sentence with . ? ! (Rule 5) |
| 7 | Emojis left in script | weird beeps or skipped words | Strip/verbalize (Rule 6) |
| 8 | Different speed across chunks | jarring tempo jumps mid-file | Lock voice+speed constants (Rule 3) |
| 9 | No edge-silence trim | 2 s dead air at file start | silenceremove + areverse chain (§5.6) |
| 10 | Unnormalized loudness | way hotter/quieter than other content | loudnorm to -16/-14 LUFS (Rule 9) |
| 11 | No ASR verification | silent truncation discovered by user | Gate 1 is mandatory (§5.7) |
| 12 | Duration never checked | half the script missing, nobody noticed | words/150/60 sanity check (§5.8) |
| 13 | Invalid voice ID, unchecked | API error or default voice surprise | Catch + fallback + TELL the user (§4.10) |
| 14 | Two near-identical dialogue voices | listeners can't tell speakers apart | Distinguish by gender/age/energy (Rule 11) |
| 15 | Homograph "lead" mispronounced | wrong word sound, loss of trust | Rephrase: "led the team" / "led pipe"→rewrite |

## 9. Advanced Techniques

### 9.1 Prosody scripting with punctuation engineering
Rewrite key lines to control emphasis: "This. Changes. Everything." produces three punchy units; "This changes everything?" produced as a question lands skeptical. Read your script aloud (or ASR-loop it) and edit punctuation before touching any parameter.

### 9.2 Voice casting with minimal A/B tests
Before a long production, synthesize ONE fixed paragraph (with numbers, a date, and a question) in 2-3 candidate voices. Compare on: number pronunciation, sentence-final pitch drop, fatigue at 60 s. Cast the winner for the whole project; document the voice map (§4.6).

### 9.3 Checkpointed long-form production (resume after failure)
Persist `manifest.json` mapping chunk index → {text, out_path, status}. On retry, synthesize only status≠done chunks. Long books WILL hit a rate limit mid-run; checkpointing turns a 2-hour failure into a 30-second resume (§4.10).

### 9.4 Timed VO export for video-generator
After chunk synthesis, probe each chunk duration (`ffprobe`), compute cumulative starts, and emit `vo_timing.csv` (line_id, start_s, end_s, text). The video editor aligns storyboard scenes to real audio lengths instead of guessing — VO-first editing eliminates sync drift.

### 9.5 Pronunciation lexicons
Where the platform supports a lexicon/phoneme hint, maintain a project glossary (brand names, product names, jargon) and pre-substitute phonetic spellings in the normalized script ("Kubernetes" → "koo-ber-net-eez" only if the voice fails it). Re-test after every voice change.

### 9.6 Batch IVR production with consistent takes
Generate all menu prompts in ONE session with ONE voice at ONE speed, then normalize all files together (same loudnorm settings). Mixing sessions produces audible level/timbre drift that callers notice immediately (§4.9).

## 10. Quick Reference Card

- Pipeline: **script → normalize() → rewrite-for-the-ear → chunk 800-1,000 chars → synth per chunk (locked voice+speed) → concat with designed silence → post-process → ASR QA → deliver**.
- Normalize: 1,250→words · 2024→twenty twenty-four · 3.14→three point one four · $5.99→five dollars and ninety-nine cents · 45%→forty-five percent · URLs→"link in the description" · strip emojis.
- Rules of the ear: ≤25-word sentences · contractions · active voice · no parentheses/semicolons · terminal punctuation always.
- Voice/speed: assistant warm 1.0 · audiobook mature 0.95 · ad energetic 1.05 · IVR clear 0.95; window 0.9-1.1, NEVER <0.8; identical across chunks.
- Pauses: comma ~150 ms · period ~300-400 ms · dash/ellipsis 400-700 ms · exact gaps via silence files (anullsrc) · SSML `<break>` where supported.
- Post: `silenceremove`+areverse edge trim → `loudnorm=I=-16:TP=-1.5:LRA=11` (podcast) or I=-14 → fade → `libmp3lame -b:a 192k` → `-ar 44100/48000`.
- QA gates: ASR diff >0.90 · duration ≈ words/150/60 ÷ speed (0.6-1.6x) · waveform peaks ≤-1 dBTP · spot-check numbers/dates/names.
- Handoffs: music → music-generator · VO into video → video-generator (send WAV 48 kHz + timing sheet) · transcription needs → ASR skill.

