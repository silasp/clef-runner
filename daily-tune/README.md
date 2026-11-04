# Daily Tune

Memorise folk, swing and jazz tunes a few minutes a day: Duolingo-style micro-lessons with spaced repetition. It is the single-melody sibling of [Daily Tag](https://github.com/silas-dsc/daily-tag), which teaches barbershop tags.

**Works offline. No build step. Runs on an old iPhone SE.** Plain ES modules plus a service worker.

## How it teaches

- **Chunks.** Each tune is cut into whole bars of about 5–12 notes. That is one bar of a reel, or two bars of a slow air. A busy bar is split, and a pickup joins the first chunk.
- **Forward chaining.** You learn chunk 1, then chunk 2, and so on. Once every chunk can be recalled, the whole tune becomes its own item. When you can play the whole tune once from memory, the next tune starts.
- **Spaced repetition.** Every chunk and every whole tune is a card. Reviews come back on an expanding schedule, and the visual cues fade as each card's level rises:
  1. note names;
  2. some hidden notes;
  3. no notation.
- **Exercise mix**, each about 20 seconds:

  | Exercise | What you do |
  |---|---|
  | Meet the chunk | See it, with scale degrees, and hear it |
  | Tap along | Follow the glowing keys |
  | Which one did you hear? | Pick the right contour |
  | What comes next? | Choose the next note |
  | Tap it from memory | Play the chunk with the cues faded |
  | Sing, whistle or play it | The microphone checks your pitch in any octave; rhythm isn't graded |

- **Situational modes.** Choose "Can't listen" or "Can't sing" and the lesson swaps in silent exercises.
- **Streaks, XP, a daily goal and badges.** They keep the habit going.
- **Easiest first.** The path is ordered by difficulty, which is rated from:
  - the tune's range;
  - how leapy it is;
  - its chromatic notes;
  - its length.

  You can filter it to Folk or Swing & jazz, or search all 1544 tunes.

## The tunes

`data/tunes.json` is built by `tools/build_tunes.mjs` from [Clef Runner](https://github.com/silasp/clef-runner)'s tune collections:

| Source | Tunes | Licence / notes |
|---|---|---|
| [thesession.org](https://thesession.org) | 420 | Irish and other session tunes with 10 or more community settings (a popularity signal); first setting |
| Nottingham Music Database | 897 | Public domain. English and Scottish jigs, reels, hornpipes, waltzes and Morris tunes |
| [OpenEWLD](https://github.com/00sapo/OpenEWLD) | 177 | Jazz and stage-and-screen standards (lead sheet melodies) |
| Charlie Parker Omnibook | 50 | Bebop solos, phrases re-joined |

Each tune is stored compactly as pitches, durations in sixteenths, and quarter beats per bar. The app (`js/tunes.js`) expands it and places barlines. The sources keep no rests and sometimes lose a note at a repeat ending, so the pickup is inferred: the placement that makes the fewest notes straddle a barline wins. Where the data is irregular, the bar grid re-syncs. Regenerate the data with:

```sh
node tools/build_tunes.mjs /path/to/clef-runner
```

## Develop

```sh
npm test                 # unit tests (node --test)
npm run serve            # http://localhost:8080
npm run test:e2e         # Playwright smoke test at iPhone SE size (needs the server)
```

Progress is stored on the device (`localStorage`, key `daily-tune:v1`). You can back it up or restore it in Settings.
