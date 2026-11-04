# 💈 Daily Tag

Memorise barbershop tags, all four parts, a few minutes a day. It works like Duolingo for tags: short lessons, streaks and XP, spaced repetition, and exercises you can do anywhere. You can sing into the mic, listen, or tap silently on a piano keyboard.

**Live:** https://silas-dsc.github.io/daily-tag/ (once GitHub Pages is enabled; see *Deploy*)

No build step and no dependencies. It's plain HTML, CSS and ES modules, and runs offline as a home-screen app. It's sized for a 320px-wide iPhone SE.

## What's inside

* **Hundreds of the top 1000 tags** from [barbershoptags.com](https://www.barbershoptags.com), ordered by download count. The library includes every tag whose notes could be transcribed reliably (see *How the tag data was made*). It holds the title, arranger, lyrics, sheet-music link and links to the real learning tracks, plus the **notes of all four parts** (Tenor, Lead, Bari, Bass).
* **Learn every part of a tag.** The aim is to know all four parts of a tag, not just one. Tags go from easy to hard, scored by range, leaps, chromatic notes and pitch changes.
  * Each tag is learned one part at a time. By default the melody goes first, then the foundation, then the harmony: Lead → Bass → Tenor → Bari. You can choose "my part first" instead.
  * A part counts as *learned* once you can recall the whole part. The next part then starts, and spaced reviews lock in the earlier parts.
  * Once two or more parts are learned, **"Switch parts!"** quizzes you on a different part of the same tag by surprise.
  * The home card shows four progress bars, one per voice.
  * Settings can switch to "my part in every tag first".
* **One small payoff each day.** Every lesson teaches one new phrase and reviews older ones. The results screen tells you what you can now recall, and when something becomes long-term memory ("Locked in").

## Notation, lyrics and rhythm

* **Key signatures and engraving.** Staves show the key signature; accidentals appear only where a note leaves the key (lasting to the end of the bar once a part has barlines, with naturals to cancel). Eighths and sixteenths in the same beat are beamed.
* **Syllables under notes.** Each note shows the syllable sung on it. A syllable held over several notes (a melisma) gets an extender line, and multi-syllable words are hyphenated ("roam-ing"), as on sheet music.
* **Rhythm while learning, pitch when testing.** While you meet and tap along with a phrase, notes show their values (stems, flags, dots) and are spaced by length. Assessment shows pitch-only noteheads, and scoring ignores rhythm. Settings → *Show rhythm* can make it always or never.
  * Rhythm comes from the sheet music wherever the recording matches it. Otherwise it's quantised from the recording at an estimated tempo.
  * Tags are sung freely, with holds and swells, so treat rhythm from recordings as approximate.

## Check & fix the tags

The notes and words are machine-transcribed, so some are wrong. **🔍 Check tags** (home screen footer, any tag page, or *✎ Wrong notes or words?* while meeting a phrase) opens a review screen:

* **Side by side:** our notes with rhythm and syllables, the original sheet music, and the real singer. *▶ Both* plays our version over the recording, so wrong notes stand out.
* **Pitches from a keyboard:** tap a note, then tap the right key; the selection moves on to the next note, so a wrong phrase can be re-entered in a few taps. 8va ▲▼ fixes octave slips.
* **Follow the singer:** while the real recording plays, each note lights up on the staff, the note list and the keyboard as the singer reaches it (from our timings, so a lag also shows where the timing is off). The same happens in lessons with *Real singer*.
* **Quick fixes:** tap a note, then ▲▼ a semitone, ✂ split it into repeated notes (“honk honk”), ⊕ merge, or 🗑 delete it. Turn it into a rest (or a rest back into a note — tapping a key does that too). Set its length (sixteenth to whole, dotted values too), put a barline before it, tie it to the next note of the same pitch, or place barlines every 2/3/4/6 beats from a chosen downbeat. Tied notes play and are tapped as one held note. Type the words for a phrase (“honk honk beep beep”, “lo-ving”, “_” to hold a syllable) and they're laid over the notes in order.
* **Keyboard shortcuts (MuseScore-style):** <kbd>A</kbd>–<kbd>G</kbd> pitch (in the key, nearest the previous note, then on to the next note) · <kbd>3</kbd>–<kbd>7</kbd> sixteenth to whole · <kbd>.</kbd> dot · <kbd>↑</kbd>/<kbd>↓</kbd> semitone, with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> an octave · <kbd>←</kbd>/<kbd>→</kbd> select · <kbd>T</kbd> tie · <kbd>R</kbd> or <kbd>0</kbd> rest · <kbd>L</kbd> barline · <kbd>Delete</kbd> · <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> undo · <kbd>Space</kbd> play.
* **Same as another part:** copy another part into this one, at the same pitch or an octave up or down (for unisons and octave doublings).
* The screen always shows the whole part; coming from a lesson, it starts on that phrase's first note.
* Rests added here show in lessons' notation too.
* **✓ Correct** marks a part as checked; 🚩 hides a tag that's beyond repair.
* Fixes apply on your phone at once. **Submit** opens a prefilled GitHub issue on this repo. When the repo owner or a collaborator files it, the `apply-corrections` workflow merges it into `data/corrections.json`, commits, and closes the issue. The app applies `corrections.json` on top of the generated `tags.json`, so fixes survive data rebuilds.
* PDF sheets are pre-rendered to `sheets/<id>.png` (`tools/sheet_images.sh`), because iOS can't show a PDF inside a page.

## Memory techniques built in

| Technique | How it shows up |
|---|---|
| **Chunking** | Each part is split into phrases of 3–9 notes at rests and held notes. |
| **Forward chaining** | Phrase *k+1* is introduced only once phrase *k* can be recalled. When every phrase is learned, the whole part becomes its own card. |
| **Vanishing cues** | Notation fades as the card's level rises: full notation with names → full notation → some notes hidden → first note only → nothing. To level up, you must succeed with *less* help than last time. Copying from the page never counts as memory. |
| **Spaced repetition** | Leitner boxes with an SM-2-style ease (1, 2, 4, 8, 16, 35, 75 days). A card can reach "learned" on day one, but "memorised" needs reviews spread over several days. |
| **Retrieval practice** | Tapping from memory, "what comes next?", singing without notation, and filling in missing lyrics. |
| **Multi-sensory encoding** | You see the notation and scale degrees, hear a synth or the real singer, sing, and tap a keyboard. |
| **Harmonic context** | "Find your note in the chord" plays all four parts at a moment in the tag. Barbershoppers remember their note by where it sits in the chord. |
| **Interleaving** | Reviews from different tags and parts are mixed into each lesson. |

## Exercises

| Exercise | Needs sound | Needs mic |
|---|:-:|:-:|
| New phrase: notation, names, scale degrees, synth / with harmony / real singer | optional | |
| Tap along: guided keyboard | | |
| Which one did you hear? (pick the melodic contour) | ✔ | |
| Find your note in the chord | ✔ | |
| What comes next? | | |
| Fill in the words | | |
| Tap it from memory (with cues fading) | | |
| Sing it: pitch tracking plus speech recognition | ✔ (start note) | ✔ |
| Switch parts! (tap another learned part of the same tag) | optional chord | |

**Can't listen / can't sing now.** Every exercise that needs sound or the mic has a *Can't listen now* / *Can't sing now* link. Tapping it swaps that exercise and the rest of the lesson for silent ones (keyboard and notation) for 15 minutes. The home screen has toggles for 🔇 *Silent mode* and 🤐 *No singing* (1 hour each), for the bus or the office.

### Singing assessment

* **Pitch tracking:** a YIN detector (`js/pitch.js`) runs about 30 times a second on the mic input, decimated to 2× on 44.1/48 kHz devices to save CPU on old phones.
* **Rhythm is ignored on purpose.** The sung pitch sequence is split into notes and aligned to the target with a DTW / edit-distance alignment (`js/scoring.js`):
  * holding a note longer or shorter costs nothing;
  * repeated target notes may be sung as one sustained note;
  * a little scoop into a note is forgiven.
* **Octave-free by default,** so a bass can practise the tenor line. You can turn this off.
* **Speech recognition** (Web Speech API, available in iOS Safari 14.5+) checks the words alongside pitch. The grade is 80 % pitch and 20 % words. If the browser has no recogniser, or iOS refuses to share the mic between the recogniser and the pitch tracker, the app scores pitch only.
* **Live feedback:** each target note lights up as you hit it, with a cents needle to tune against.

## Gamification

* XP, levels and a daily goal ring (20/40/80/120 XP; 40 XP is about 3 minutes).
* A day streak that you extend by hitting the daily goal. You get a free streak freeze every 7 days.
* Gems, badges ("First Ring", "Locked In", "Whole Quartet", …), confetti and cheerful sound effects.
* A path screen with a chip for each part of each tag: ○ not started · 🟡 learning · 🟨 learned · 🟢 ★ memorised.

## Run it

```bash
npm run serve      # python3 -m http.server 8080
open http://localhost:8080
```

On iPhone, open the page in Safari, tap **Share → Add to Home Screen**, and launch it from the icon. It then runs full-screen and works offline. The real learning tracks stream from barbershoptags.com, so they need a connection; the synth works offline.

Deep link for practice: `#drill/<exercise>/<tagId>/<Part>/<phrase|all>`, e.g. `#drill/sing/1809/Lead/0`.

## Tests

```bash
npm test               # unit tests (node:test) — music theory, YIN, scoring, SRS, curriculum, lessons, game, notation, data integrity
npm run serve &        # then, with Playwright available:
npm run test:e2e       # completes a whole lesson in silent mode at 320×568, checks persistence and that the page has no horizontal overflow
node tests/e2e/review.mjs               # review screen: edit notes and words, reload, submit, hide
node tests/e2e/sing.mjs 0 Lead          # synthesises a sung phrase into Chromium's fake mic → must score ≥ 80 %
WRONG=1 node tests/e2e/sing.mjs 0 Lead  # the same phrase a minor third off → must fail
```

## How the tag data was made

Every tag gets **two independent transcriptions**, and they check each other.

**1. From the learning tracks** (`tools/extract_notes.py`)

* barbershoptags.com publishes one mp3 per part. All four files of a tag carry the *same* full mix (L+R is identical); they differ only in panning. So one side of the file for part P is `a·voice_P + b·M`, and each voice is recovered as `side_P − c_P·M`. `c_P` is fitted per part so the four recovered voices are mutually uncorrelated. The leftover correlation, typically 0.01–0.08, measures how well this worked. For "single part only" tracks, c ≈ 0.
* pYIN on each recovered voice gives precise pitch and timing. Notes are quantised against the singer's own tuning, glides are absorbed, and octave slips are fixed.
* An independent cross-check needs no demixing. It computes harmonic-sum CQT salience for each file and contrasts it with the other three files: the pitch that is *boosted* in file P is part P's note. That method is also good at octaves, so it votes on octave errors in pYIN.

**2. From the sheet music** (`tools/omr_batch.py`, `tools/omr_parts.py`)

* The published sheet (PDF/PNG/JPG/GIF) is read with the [homr](https://github.com/liebharc/homr) OMR model.
* Barbershop tags are engraved on two staves: Tenor/Lead on a treble-8 clef and Bari/Bass on a bass clef. homr returns chords, so the voices are split by register: on each staff the top note is Tenor or Bari, the bottom note is Lead or Bass, and a single note means unison.
* On a benchmark of 15 tags, OMR matched the clean audio transcriptions 83–91 % per part on average, and 100 % on many parts.

**3. Lyric timing** (`tools/align_lyrics.py`)

* [faster-whisper](https://github.com/SYSTRAN/faster-whisper) transcribes each recovered voice with word timestamps, primed with the tag's lyrics.
* Recognised words are aligned to the real lyric text, so mishearings don't matter much, and hyphenated with pyphen.
* A small dynamic programme then starts each word on its own note as close as possible to when it was sung. The notes up to the next word carry the rest of its syllables, then the melisma.
* Every part is recognised from its own recovered voice.

**4. Assemble** (`tools/build_tags.py`), from the 761 most-downloaded four-part tags that have per-part learning tracks:

| Source | When | Notes used |
|---|---|---|
| ✓ `verified` | Audio and sheet agree (any transposition) | Audio (timing matches the real recordings) |
| `audio` | No usable sheet, but the audio passes its own checks | Audio |
| `sheet` | Audio unusable or no learning tracks, but the sheet is plausible and matches the recording's Lead | Sheet pitches, timed by anchoring the sheet's Lead to the recorded Lead |

Plausibility checks also apply: voice ranges, Bass lowest, Tenor on top. Tags that fail are dropped. The tag page says which source was used. Expect occasional small errors outside ✓ verified tags.

```bash
python3 tools/extract_notes.py --work work --pages 25 --limit 761 download
python3 tools/extract_notes.py --work work --pages 25 --limit 761 process --workers 3 --wait
python3 tools/omr_batch.py --work work --top 1000 --homr homr
python3 tools/align_lyrics.py --work work --parts Lead          # then Bass,Tenor,Bari
python3 tools/build_tags.py --work work --top 1000
python3 tools/test_build.py                                     # self-test of the build helpers
```

## Deploy

It's a static site. In the GitHub repo, go to **Settings → Pages → Deploy from a branch → `main` / root**. The page is then served at `https://<owner>.github.io/daily-tag/`.

## Credits

Tag metadata, lyrics, sheet music and learning tracks come from **[barbershoptags.com](https://www.barbershoptags.com)** and their arrangers, singers and contributors. Each tag page in the app links back to its source page. Please support the site, and the arrangers when you perform their tags.

App code: MIT (see `LICENSE`).
