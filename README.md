# 🎼 Clef Runner — Sight-Reading Trainer

A mobile-first (landscape) web app that trains sight-reading on **piano**, **guitar**, and **violin**. Notes scroll right-to-left across a staff; tap the correct key / fret / finger position to clear the left-most note before it falls off the edge.

No build step, no dependencies — plain HTML + Canvas + JS.

## Run it

**Easiest (works offline, opens directly):**

```bash
open index.html        # macOS — or just double-click the file
```

**Served (needed for Google SSO + PWA install + service worker):**

```bash
cd sight-reader
python3 -m http.server 8000
# then open http://localhost:8000 on your phone (same Wi-Fi: http://<your-ip>:8000)
```

Rotate to **landscape**. On a phone, use *Add to Home Screen* for a full-screen app.

## How to play

- Pick an instrument and tap **Start**.
- The **left-most note** (highlighted gold) is your target. Tap the matching key/fret/position.
  - ✅ Correct → it clears, the key flashes green, you score (with a streak multiplier).
  - ❌ Wrong key → screen flashes red, you lose a point, streak resets.
  - ⏰ Note reaches the red line → you lose a point, streak resets.
- **Endless practice** by default; flip on **3-Lives mode** for a score-chase with a game-over.

## Features

| | |
|---|---|
| 🎹🎸🎻 | Piano keyboard, guitar fretboard (frets 0–5), violin fingerboard (fretless guide) |
| 🎚️ | 4 scroll speeds (Relaxed → Intense) |
| 📈 | 3 difficulties — Easy (central naturals), Medium (all naturals), Hard (adds sharps) |
| 🎼 | Treble / Bass clef (piano) |
| 🔥 | Streaks with up to ×5 score multiplier |
| 💡 | Hint mode — highlights where to tap + shows note names |
| 🔊 | Web-Audio note feedback |
| 🏆 | Per-instrument local leaderboard + personal bests (localStorage) |
| 👤 | Guest profiles, with **optional Google Sign-In** |
| 📱 | Installable PWA, offline-capable, landscape-locked |

## Enabling Google Sign-In (optional)

Local guest profiles work with zero setup. To add Google SSO:

1. Create an **OAuth 2.0 Web client ID** in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and add your origin (e.g. `http://localhost:8000`) to *Authorized JavaScript origins*.
2. Paste the client ID into `GOOGLE_CLIENT_ID` at the top of [`js/main.js`](js/main.js).
3. Serve over http(s) — SSO does **not** work from `file://`.

> Note: scores are stored in the browser (localStorage). The Google profile personalises the name/avatar; a shared cross-device leaderboard would need a backend, which is intentionally out of scope here.

## Project layout

```
index.html              markup + screen scaffolding
css/styles.css          dark, landscape-first styling
js/theory.js            pitch ↔ MIDI ↔ staff geometry
js/instruments.js       piano + fretboard layout, draw, hit-testing
js/game.js              staff rendering, scrolling notes, scoring/streaks/lives
js/audio.js             Web-Audio synth (note + error cues)
js/auth.js              profiles, local leaderboard, optional Google SSO
js/main.js              menu, settings, canvas sizing, game loop, input
manifest.webmanifest    PWA manifest (landscape)
sw.js                   offline cache
```

### A note on guitar/violin pitch

Guitar is written in treble clef sounding an octave lower; positions use the standard written tuning (E A D G B e). Violin is fretless — the fingerboard shows semitone *guide* positions as tap targets, which is a practical UI for a tap game rather than a literal technique model. Any fret/position that produces the target pitch counts as correct.
