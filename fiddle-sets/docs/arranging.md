# Arranging model and techniques

## 1. Data model

### Tune file (`tunes/<id>.yaml`)

```yaml
id: hector-the-hero
meter: 3/4
key: A            # ABC-style: A, Am, Edor, Amix …
unit: 1/8         # ABC L: field
tempo: {bpm: 54, beat_ql: 1.0, text: "Slow air — freely"}
motifs:           # named fragments, used when writing transitions
  head: {abc: "AB | {B}c4 (3B/c/B/ A", note: "..."}
parts:
  P:
    pickup: "(AB"              # anacrusis (spliced onto the previous bar)
    pickup_chord: E7           # optional
    key: A                     # optional per-part key (e.g. a B part in the dominant)
    abc: "…8 bars…"            # every bar must be full length; no repeat endings
    chords: "A | D | A | F#m | A | D | E | E7"
    phrases:
      - {bars: 1-4, cadence: open, peak: 2}
      - {bars: 5-8, cadence: half, peak: 6, climax: true}
    variants:                  # alternative bars (endings, final bar …)
      last: {abc: {8: "B/c/dB AGF E3"}, chords: {8: "G D Em"}}
```

**Chord line:** one cell per bar, separated by `|`. Tokens split the bar
evenly; `.` extends the previous chord. In 3/4 `D . A/E` = D for two beats,
A/E for one. In 9/8 `G D Em` = one chord per dotted crotchet.

**Phrases** drive the expressive layer: `cadence` (open/half/perfect) marks
where tension resolves (suspensions are placed at cadence arrivals), `peak`
marks the high point of a phrase, `climax: true` marks the tune's main climax.
The analyser (`python -m fiddlekit analyse <tune>`) adds roman numerals and a
0–4 tension value per chord (tonic 0, subdominant ~1.5, dominant 3, V7 3.5,
cadential 6-4 3, secondary dominants ~3).

### Set file (`sets/<id>.yaml`)

```yaml
voices: {v1: {instrument: violin, name: Violin I}, v2: {instrument: violin, name: Violin II}}
sequence:
  - tune: hector-the-hero
    passes:
      - part: P                       # or "B:rep" to use a variant
        dyn: {v1: mp, v2: p}
        v2:                           # one spec, or a list with bar ranges
          - {bars: 1-4, tech: rest}
          - {bars: 5-8, tech: drone, notes: "E4 A4", high: A4}
        hairpins: [{bars: 1-2, type: cresc}]
        text: {6: "rit."}
        fermata_end: true
  - transition:                       # free bars between tunes
      meter: 2/4
      key: D
      tempo: {bpm: 104, beat_ql: 1.0, text: "a tempo"}
      chords: "A7 | A7"
      v1: "z4 | A,/B,/C/D/ E2"        # ABC for the lead voice
      v2: {tech: vamp}                # any technique works here too
```

Any voice can take any technique, so role swaps are one line
(`v1: {tech: harmony, above: true}` + `v2: {tech: melody}`). Adding a third
voice (`v3: {instrument: viola}`) needs no engine changes.

## 2. Techniques

| tech | what it writes | key parameters |
|------|----------------|----------------|
| `melody` / `unison` | the tune | `octave: -1` (8vb where it fits), `plain: true` (drop ornaments) |
| `harmony` | a parallel line in 3rds/6ths (10ths allowed) | `above`, `density: melody/beat/half/bar`, `prefer: thirds/sixths`, `flip` (default on), `max_gap` |
| `counter` | a counter-melody | `rhythm: auto/beat/half`, `fills: echo/scale/none`, `center`, `low`, `high`, `suspensions` |
| `drone` | open-string drones / double stops | `notes`, `follow` (re-voice when the chord moves), `rhythm: sustain/beat/bar/<ql>`, `high` |
| `vamp` | bass + double-stop chord backing | `pattern: waltz, waltz-lilt, polka, polka-quarters, reel, reel-drive, jig, slip`, `staccato`, `bass_high` |
| `rest` | tacet | |
| `abc` | hand-written ABC | `abc` |

Common options: `dyn` (dynamic at the start of the run), `articulation`,
`suspensions: true` (4–3 / 7–3 suspensions at cadences, only when they can be
prepared).

### How `harmony` chooses notes
Dynamic programming (Viterbi) over every candidate note for every melody note:

* **intervals** – 3rds and 6ths free; 10ths cheap; 4ths/5ths costly; unison/
  octave only cheap on a cadence root; seconds/sevenths very costly on strong
  beats or long notes, tolerated as quick passing notes;
* **harmony** – chord tones preferred on strong beats, guide tones (3rd/7th)
  rewarded, non-chord tones tolerated on weak beats;
* **voice-leading** – small steps preferred, parallel 5ths/8ves penalised,
  similar motion into perfect intervals penalised, staying in 3rds (or in 6ths)
  rewarded, crossing the tune mid-phrase penalised;
* **flip** – when the tune dips too low to harmonise underneath (e.g. the
  hopsa's low A), the line may jump over it for a note or two rather than
  doubling the tune;
* **playability** – first-position notes preferred; `density: beat` thins the
  rhythm to one note per beat.

### How `counter` works
Slots follow the harmonic rhythm (one per chord, split at mid-bar in 4/4) or a
beat grid (`rhythm: beat` → a walking line where passing notes are allowed on
weak beats if approached and left by step). Costs reward guide tones, stepwise
motion and contrary motion, and keep the line about a sixth under the tune's
average pitch. Where the tune **holds a long note** the counter answers with a
**fill**: `echo` imitates the tune's previous figure, diatonically transposed so
it fits the chord and stays under the held note; `scale` runs stepwise into
the next chord. This gives the call-and-response, complementary-rhythm texture
of good second-fiddle parts.

### Fiddle playability rules (`instruments.py`)
* First position: open string to a 4th finger (7 semitones) on each string;
  anything above B5 is reported.
* Double stops must lie on adjacent strings with a real fingering: two
  different fingers (or one flat finger for a fifth), no reverse stretches,
  at most a fourth between stopped notes; open strings are preferred.
* Instruments are data (strings, reach, comfortable top, clef), so viola,
  cello and bass parts use the same rules (`VIOLA`, `CELLO`, `BASS`).

## 3. Arranging checklist used for the sets

* **Shape the set**: slow → medium → fast; vary meter, mode and key; end in a
  key that feels like home (Set 1 starts and ends in A).
* **Change texture every strain or pass**: solo → drone → counter-melody →
  harmony → vamp → unison/octaves → role swap → descant. Never the same thing
  twice in a row.
* **Build and release**: hold back on the first pass, drop to a quieter
  "breakdown" before the last time through, end with everyone in
  harmony/octaves at the top dynamic.
* **Transitions** (1–3 bars): take a motif from the tune you're leaving or the
  one you're approaching, re-cast it in the new meter, and prepare the new key
  with its dominant (or the modal ♭VII for dorian/mixolydian tunes). A bar of
  accompaniment alone is a good way to set a new tempo and groove.
* **Metric modulation**: link tempos by a shared pulse (hopsa ♩ = slip jig ♩.).
* **Reharmonise repeats** (e.g. Bm instead of D, ii–V instead of V).
* **Cadences**: suspensions (prepared, resolving down by step) for tension;
  the 3rd of the tonic for release.

## 4. Roadmap for bigger ensembles

* **Triple fiddle / quartet**: add `v3`/`v4` voices; a `bass` technique (roots
  and fifths with walking approach notes, on the cello's C/G strings) and a
  `pad` technique (chord-tone voicing across several voices with common-tone
  voice-leading) are the next additions. The harmony DP can take *another
  voice* as its reference instead of the melody, giving 3-part close harmony.
* **String orchestra**: instruments already include viola/cello/bass; add
  `divisi` and section dynamics balancing.
* **School orchestra**: per-voice difficulty profiles (allowed keys/strings,
  no 4th finger, no double stops, rhythmic simplification via `density`).
