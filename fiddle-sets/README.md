# fiddle-sets

Traditional fiddle tunes (Irish, Scottish, Cape Breton, Scandinavian…) arranged
into **sets** — 3–4 contrasting tunes joined by short transitions built on the
tunes' own motifs — and scored for **two violins** (more ensembles later).

The output is **MusicXML** (opens in MuseScore, Dorico, Sibelius, Finale), plus
MIDI, an engraved PDF, a native MuseScore `.mscz`, a check report and ABC for
every generated part.

## Set 1 — *Hector's Crossing*

| # | Tune | Origin | Form · meter · key |
|---|------|--------|--------------------|
| 1 | Hector the Hero (J. Scott Skinner) | Scotland | slow air · 3/4 · A |
| 2 | Randers Hopsa | Denmark | 3-part hopsa · 2/4 · D (B part in A) |
| 3 | A Fig for a Kiss | Ireland | slip jig · 9/8 · E dorian |
| 4 | Miss McLeod's | Scotland / Cape Breton | reel · 4/4 · A |

Files: [`output/01-hectors-crossing/`](output/01-hectors-crossing/) —
`.musicxml`, `.mscz`, `.pdf`, `.mid`, `report.md`, `parts.abc.txt`.
Arranging notes for this set: [`docs/set-01-notes.md`](docs/set-01-notes.md).

## How it works

```
tunes/*.yaml   one file per tune: ABC melody per strain, chords per bar,
               phrases/cadences/peaks (tension & release), motifs, sources
sets/*.yaml    the arrangement: running order, passes, a technique per voice
               per bar range, transitions, dynamics
fiddlekit/     the engine: ABC reader/writer, theory, instruments, techniques,
               set loader, arranger, MusicXML renderer, checks
```

The tune files hold everything that is reusable across arrangements (melody,
harmony, phrase structure, tension points, motifs). The set files only say
*who does what, where*. Techniques are generic and instrument-aware, so the
same tune data can drive a trio, quartet or school-orchestra arrangement later
by adding voices.

Techniques (see [`docs/arranging.md`](docs/arranging.md) for the details):
`melody`, `unison` (optionally 8vb), `harmony` (3rds/6ths below or above,
optionally thinned to the beat), `counter` (guide-tone counter-melody with
echo/scale fills, or a walking line), `drone` (open-string drones that follow
the harmony), `vamp` (bass + double-stop backing in waltz/polka/reel/jig/slip-jig
patterns), `rest`, `abc` (hand-written).

## Build

```bash
pip install -r requirements.txt
python -m fiddlekit build sets/01-hectors-crossing.yaml   # → output/01-hectors-crossing/
python -m fiddlekit analyse hector-the-hero               # chords, roman numerals, tension
python -m pytest -q tests
```

If MuseScore (`mscore`/`mscore3`) is on the PATH the PDF and `.mscz` are
engraved by MuseScore; otherwise a Verovio preview PDF is made.
`tools/musescore_render.sh` renders PNG pages for proofreading.

## Refining an arrangement

1. Change a technique or its parameters in the set file and rebuild.
2. To hand-edit a generated passage, copy its line from `parts.abc.txt` into
   the set file as `{bars: 5-8, tech: abc, abc: "…"}` and edit it — it is now
   frozen and won't be regenerated.
3. Check `report.md`: range/position, double-stop fingerings, strong-beat
   clashes and parallel 5ths/8ves between the violins.

## Sources

Tune transcriptions are adapted from [The Session](https://thesession.org)
(setting links are in each tune file). All four tunes are traditional or in
the public domain (Skinner died in 1927).
