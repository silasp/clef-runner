# 💈 Daily Tag

Memorise barbershop tags, all four parts, a few minutes a day. It works like Duolingo for tags: short lessons, streaks and XP, spaced repetition, and exercises you can do anywhere. You can sing into the mic, listen, or tap silently on a piano keyboard.

No build step and no dependencies. It's plain HTML, CSS and ES modules, and runs offline as a home-screen app. It's sized for a 320px-wide iPhone SE.

## What's inside

* **100 popular tags** from [barbershoptags.com](https://www.barbershoptags.com), ordered by download count. The library includes every popular tag whose learning tracks could be transcribed cleanly (see *How the tag data was made*). It holds the title, arranger, lyrics, sheet-music link and links to the real learning tracks, plus the **notes of all four parts** (Tenor, Lead, Bari, Bass).
* **A curriculum from easy to hard.** Each part gets a difficulty score from its range, leaps, chromatic notes and number of pitch changes. You learn your own part in every tag first, then the other three. You can switch to "all four parts of each tag" in Settings.
* **One small payoff each day.** Every lesson teaches one new phrase and reviews older ones. The results screen tells you what you can now recall, and when something becomes long-term memory ("Locked in").

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
node tests/e2e/sing.mjs 0 Lead          # synthesises a sung phrase into Chromium's fake mic → must score ≥ 80 %
WRONG=1 node tests/e2e/sing.mjs 0 Lead  # the same phrase a minor third off → must fail
```

## How the tag data was made

`tools/extract_notes.py` and `tools/build_tags.py` (Python, librosa) produce `data/tags.json`:

1. Page through the public barbershoptags.com API sorted by downloads. Keep four-part tags that have Tenor/Lead/Bari/Bass mp3 learning tracks.
2. Use the tags whose tracks are **single part only**. In these, the part is alone on one stereo channel. That channel is found automatically: it's the one whose waveform is uncorrelated with every channel of the other three tracks. The "stereo" style tracks put a mix of voices on both channels, so they can't be transcribed reliably and are skipped.
3. Run pYIN on the isolated channel, quantise to semitones relative to the singer's own tuning offset, segment into notes, absorb glides and fix octave slips.
4. Run quality gates: pitch stability ≥ 80 % of voiced frames within ±35 cents of a semitone, every voice singing through at least 40 % of the tag, and notes inside plausible voice ranges. Tags that fail are dropped; 67 were rejected.
5. Keep the 100 most-downloaded tags that pass.

Key and spelling come from the arranger's written key when the notes fit it. Otherwise the app uses a Krumhansl key estimate, with the final bass note breaking ties.

**Notes are auto-transcribed, so expect occasional small errors.** Each tag page links to the sheet music and to the real learning tracks, and lessons have a 🎙 *Real singer* button that plays exactly the phrase you're learning from the original recording.

## Credits

Tag metadata, lyrics, sheet music and learning tracks come from **[barbershoptags.com](https://www.barbershoptags.com)** and their arrangers, singers and contributors. Each tag page in the app links back to its source page. Please support the site, and the arrangers when you perform their tags.

App code: MIT (see `LICENSE`).
