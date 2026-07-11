/* licks.js — genre lick / melody library for "Licks" mode.
   Each entry is a short, recognisable phrase written in scientific pitch
   (transposed to fit the chosen instrument at runtime). Sources noted inline.

   Material is either characteristic genre vocabulary built from that genre's
   defining scale/arpeggio, or the melody of a public-domain traditional tune.
   Research sources:
     • Cripple Creek ABC — Viola Ruth, "Advanced Square Dance Figures of the
       West and Southwest" (abcnotation.com / tunearch.org), trad.
     • Gypsy-jazz Am6 + chromatic 5–♯5–6 vocabulary — jazzguitar.be / premierguitar.com
     • B.B. box / minor-blues-scale vocabulary — guitar.com / happybluesman.com
     • ii–V–I bebop construction — jazzguitar.be / jenslarsen.nl
*/
(function (App) {
  'use strict';
  const T = App.Theory;

  const RAW = {
    folk: [
      { name: 'When the Saints Go Marching In', source: 'trad. · public domain',
        notes: 'C4 E4 F4 G4 C4 E4 F4 G4 C4 E4 F4 G4 E4 C4 E4 D4' },
      { name: 'Frère Jacques', source: 'trad. · public domain',
        notes: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4 E4 F4 G4 G4 A4 G4 F4 E4 C4 C4 G3 C4' },
      { name: 'Appalachian pentatonic phrase', source: 'C major pentatonic',
        notes: 'C4 D4 E4 G4 A4 G4 E4 D4 C4 E4 G4 A4 C5 A4 G4 E4' },
    ],
    blues: [
      { name: 'B.B. box lick', source: 'A minor blues scale',
        notes: 'A4 C5 D5 D#5 E5 G5 E5 D5 C5 A4' },
      { name: 'Blues turnaround', source: 'A minor blues scale',
        notes: 'E5 D5 C5 A4 G4 E4 G4 A4 C5 A4' },
      { name: 'Slow-blues call & response', source: 'A minor blues scale',
        notes: 'A4 C5 E5 D5 C5 A4 G4 A4 C5 D5 D#5 E5' },
    ],
    rock: [
      { name: 'Pentatonic box run', source: 'A minor pentatonic',
        notes: 'A4 C5 D5 E5 G5 A5 G5 E5 D5 C5 A4' },
      { name: 'Classic rock riff', source: 'A minor pentatonic',
        notes: 'E4 G4 A4 E4 G4 A4 C5 A4 G4 E4 D4 E4' },
      { name: 'Bend-and-release lick', source: 'A minor pentatonic',
        notes: 'A4 E5 D5 E5 C5 A4 G4 A4 E4' },
    ],
    bluegrass: [
      { name: 'Cripple Creek (A part)', source: 'trad. · ABC: Viola Ruth',
        notes: 'C5 B4 C5 A4 B4 B4 A4 B4 C5 B4 C5 E4 C5 B4 C5 A4 B4 B4 A4 F4 E4 A4 A4 B4 A4' },
      { name: 'Cripple Creek (B part)', source: 'trad. · ABC: Viola Ruth',
        notes: 'E5 F5 G5 A5 G5 A5 E5 F5 E5 C5 A4 D5 D5 D5 F5 E5 C5 A4' },
      { name: 'Banjo forward roll', source: 'G major · forward roll',
        notes: 'G4 B4 D5 G4 B4 D5 G4 B4 D5 E5 D5 B4 G4 D5 B4 G4' },
    ],
    country: [
      { name: 'Open-position country lick', source: 'G major',
        notes: 'G4 B4 D5 B4 A4 G4 E4 G4 A4 B4 D5 B4 G4' },
      { name: 'Nashville pentatonic lick', source: 'G major pentatonic',
        notes: 'D5 E5 G5 E5 D5 B4 A4 G4 A4 B4 D5 E5' },
      { name: 'Carter-style turnaround', source: 'G major',
        notes: 'G4 B4 D5 E5 D5 B4 A4 B4 G4 F#4 G4' },
    ],
    jazz: [
      { name: 'C bebop scale run', source: 'C bebop major',
        notes: 'C4 D4 E4 F4 G4 G#4 A4 B4 C5' },
      { name: 'ii–V–I arpeggio line', source: 'Dm7 · G7 · Cmaj7',
        notes: 'D4 F4 A4 C5 B4 G4 F4 D4 E4 C4' },
      { name: 'ii–V–I bebop line', source: 'Dm7 · G7 · Cmaj7',
        notes: 'F4 A4 C5 E5 D5 B4 G4 A4 G4 F4 E4' },
    ],
    gypsy: [
      { name: 'Minor Swing arpeggio', source: 'after Django Reinhardt · Am6',
        notes: 'A4 C5 E5 F#5 A5 F#5 E5 C5 A4' },
      { name: 'Chromatic enclosure lick', source: 'Am6 · 5–♯5–6 (E–F–F♯)',
        notes: 'E5 F5 F#5 A5 F#5 E5 C5 A4 C5 A4' },
      { name: 'Django minor sweep', source: 'A minor triad + leading tone',
        notes: 'A4 C5 E5 A5 E5 C5 A4 G#4 A4' },
      { name: 'Minor Swing motif', source: 'after Django Reinhardt · Am6 arpeggio',
        notes: 'E5 A5 F#5 E5 C5 A4 B4 C5 A4' },
      { name: 'Harmonic-minor run', source: 'gypsy jazz · A harmonic minor',
        notes: 'A4 B4 C5 D5 E5 F5 G#5 A5' },
      { name: 'E7♭9 → Am resolution', source: 'gypsy jazz · E7♭9',
        notes: 'G#4 B4 D5 F5 E5 D5 C5 B4 A4' },
      { name: 'Diminished sweep', source: 'gypsy jazz · G#dim7',
        notes: 'G#4 B4 D5 F5 D5 B4 G#4 A4' },
      { name: 'Chromatic descending lick', source: 'gypsy jazz · A minor',
        notes: 'C6 B5 A#5 A5 G#5 A5 F#5 E5 C5 A4' },
      { name: 'Am6 triplet arpeggio', source: 'gypsy jazz · Am6',
        notes: 'A4 C5 E5 F#5 E5 C5 A4 C5 E5 A5' },
      { name: 'E7 arpeggio sweep', source: 'gypsy jazz · E7',
        notes: 'E5 G#5 B5 D6 C6 B5 G#5 E5' },
      { name: 'Harmonic-minor cascade', source: 'gypsy jazz · A harmonic minor',
        notes: 'A5 G#5 F5 E5 D5 C5 B4 A4 G#4 A4' },
      { name: 'Nuages chromatic approach', source: 'after Django Reinhardt',
        notes: 'D5 E5 F5 F#5 G5 G#5 A5 G5 E5' },
      { name: 'Gypsy turn', source: 'gypsy jazz · A harmonic minor',
        notes: 'B4 C5 B4 A4 G#4 A4 C5 E5' },
    ],
    classical: [
      { name: 'Ode to Joy', source: 'Beethoven · public domain',
        notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4' },
      { name: 'Eine kleine Nachtmusik', source: 'Mozart · public domain',
        notes: 'G4 D4 G4 D4 G4 B4 D5 C5 A4 F#4 A4 C5 A4 F#4 D4' },
      { name: 'Für Elise', source: 'Beethoven · public domain',
        notes: 'E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 G#4 B4 C5' },
      { name: 'Symphony No. 5 (motif)', source: 'Beethoven · public domain',
        notes: 'G4 G4 G4 D#4 F4 F4 F4 D4' },
      { name: 'Minuet in G', source: 'Petzold (attr. Bach) · public domain',
        notes: 'D5 G4 A4 B4 C5 D5 G4 G4 E5 C5 D5 E5 F#5 G5 G4 G4' },
      { name: 'Theme (Twinkle Variations)', source: 'Mozart · public domain',
        notes: 'C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4' },
      { name: 'Canon in D', source: 'Pachelbel · public domain',
        notes: 'F#5 E5 D5 C#5 B4 A4 B4 C#5 D5 C#5 B4 A4 G4 F#4 G4 E4' },
      { name: 'Greensleeves', source: 'trad. · public domain',
        notes: 'A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 A4 A4 G#4 A4 B4 G#4 E4' },
      { name: 'New World — Largo', source: 'Dvořák · public domain',
        notes: 'E4 G4 G4 E4 D4 C4 D4 E4 G4 E4 D4 C4' },
      { name: 'Surprise Symphony', source: 'Haydn · public domain',
        notes: 'C4 C4 E4 E4 G4 G4 E4 F4 F4 D4 D4 B3 G4' },
    ],
  };

  const GENRES = [
    { key: 'all', label: 'All' },
    { key: 'folk', label: 'Folk' },
    { key: 'blues', label: 'Blues' },
    { key: 'rock', label: 'Rock' },
    { key: 'bluegrass', label: 'Bluegrass' },
    { key: 'country', label: 'Country' },
    { key: 'jazz', label: 'Jazz' },
    { key: 'gypsy', label: 'Gypsy Jazz' },
    { key: 'classical', label: 'Classical' },
    { key: 'pop', label: 'Pop' },
  ];

  // how many procedurally-generated licks to add per genre (on top of curated)
  const GENERATED_PER_GENRE = 100;

  // notes may be a "C4 D4 …" string (curated) or already an array of descriptors
  function toNotes(n) {
    return typeof n === 'string'
      ? n.trim().split(/\s+/).map((s) => T.parseNote(s)).filter(Boolean)
      : n;
  }

  function get(genre) {
    if (genre === 'all') return getAll();
    const curated = (RAW[genre] || []).map((l) => ({ name: l.name, source: l.source, notes: toNotes(l.notes), durs: l.durs || null }));
    const generated = (App.LickGen ? App.LickGen.generate(genre, GENERATED_PER_GENRE) : [])
      .map((l) => ({ name: l.name, source: l.source, notes: toNotes(l.notes), durs: null }));
    let out = curated.concat(generated);
    // Nottingham fiddle tunes (folk) — pre-parsed, loaded at boot
    if (genre === 'folk' && App.FolkTunes && App.FolkTunes.count()) {
      out = out.concat(App.FolkTunes.tunes().map((l) => ({ name: l.name, source: l.source, notes: l.notes, durs: l.durs })));
    }
    // large thesession.org corpus — lazily loaded thin records ({_p,_d,_res})
    if (App.Songs) out = out.concat(App.Songs.pool(genre));
    return out;
  }

  function getAll() {
    const keys = GENRES.filter((x) => x.key !== 'all').map((x) => x.key);
    let out = [];
    keys.forEach((g) => { out = out.concat(get(g)); });
    return out;
  }

  // Selectable catalogue for the Library: the hand-curated, NAMED phrases per
  // genre plus the folk tunes loaded at boot (the huge lazy song corpus and the
  // procedurally-generated licks are intentionally left out — they're unnamed /
  // too numerous to browse). Each item exposes lick() → {name, source, notes}.
  function catalog() {
    const out = [];
    Object.keys(RAW).forEach((genre) => {
      const label = (GENRES.find((g) => g.key === genre) || {}).label || genre;
      RAW[genre].forEach((l, i) => out.push({
        id: 'lick:' + genre + ':' + i, name: l.name, group: label, source: l.source, kind: 'lick',
        lick: () => ({ name: l.name, source: l.source, notes: toNotes(l.notes), durs: l.durs || null }),
      }));
    });
    if (App.FolkTunes && App.FolkTunes.count && App.FolkTunes.count()) {
      App.FolkTunes.tunes().forEach((l, i) => out.push({
        id: 'folk:' + i, name: l.name, group: 'Folk tunes', source: l.source, kind: 'lick',
        lick: () => ({ name: l.name, source: l.source, notes: l.notes, durs: l.durs }),
      }));
    }
    // Curated, named artist transcriptions from the lazy song corpus (Charlie
    // Parker Omnibook, Stéphane Grappelli, Weimar Jazz DB solo phrases). These
    // are searchable by artist even though the bulk anonymous corpus stays out.
    // Phrases that share a tune name are collapsed into one entry whose lick()
    // plays them back-to-back, so the list browses by piece rather than by the
    // hundreds of individual phrases.
    if (App.Songs && App.Songs.curated) {
      const byKey = new Map();
      App.Songs.curated().forEach((r) => {
        const key = r._group + ' ‖ ' + r.name;
        let e = byKey.get(key);
        if (!e) { e = { name: r.name, group: r._group, source: r.source, ps: [], ds: [], res: r._res || 4 }; byKey.set(key, e); }
        e.ps.push(r._p); e.ds.push(r._d);
      });
      byKey.forEach((e) => out.push({
        id: 'song:' + e.group + ':' + e.name, name: e.name, group: e.group, source: e.source, kind: 'lick',
        lick: () => ({ name: e.name, source: e.source, _p: e.ps.join(','), _d: e.ds.join(','), _res: e.res }),
      }));
    }
    return out;
  }

  // Transpose a lick to fit an instrument's range, then place it at a RANDOM
  // octave within the playable headroom so that, across many phrases, the licks
  // cover the instrument's FULL range instead of all clustering at its centre
  // (which, for the grand piano, parked every melody around middle C).
  //   semis === 0 : octave-shift only, preserving the original spelling.
  //   semis !== 0 : shift by `semis` semitones (random-key), respell with sharps.
  // Every returned note is guaranteed playable (within [minMidi, maxMidi]).
  function transposeToInstrument(notes, inst, semis) {
    semis = semis || 0;
    const loM = inst.minMidi, hiM = inst.maxMidi;
    if (!semis) {
      const mids = notes.map((n) => n.midi);
      const k = pickOctaveShift(Math.min(...mids), Math.max(...mids), loM, hiM);
      return notes.map((n) => {
        let oct = n.octave + k, m = T.midiOf(n.letter, oct, n.accidental);
        while (m < loM) { oct++; m += 12; }
        while (m > hiM) { oct--; m -= 12; }
        return T.makeNote(n.letter, oct, n.accidental);
      });
    }
    const shifted = notes.map((n) => n.midi + semis);
    const k = pickOctaveShift(Math.min(...shifted), Math.max(...shifted), loM, hiM) * 12;
    return shifted.map((m0) => {
      let m = m0 + k;
      while (m < loM) m += 12;
      while (m > hiM) m -= 12;
      return T.spellMidi(m);
    });
  }

  // How many octaves to shift a lick spanning [lo,hi] so it lands at a random
  // playable position inside [loM,hiM]. When it fits with room to spare, the
  // octave is chosen uniformly across every whole-octave slot that fits, so the
  // corpus spreads over the whole range; when it's wider than the instrument
  // (no whole-octave fit), fall back to the shift that centres it.
  function pickOctaveShift(lo, hi, loM, hiM) {
    const kMin = Math.ceil((loM - lo) / 12);
    const kMax = Math.floor((hiM - hi) / 12);
    if (kMax >= kMin) return kMin + Math.floor(Math.random() * (kMax - kMin + 1));
    return Math.round(((loM + hiM) / 2 - (lo + hi) / 2) / 12); // can't fit → centre
  }

  App.Licks = { GENRES, get, getAll, catalog, transposeToInstrument };
})(window.App = window.App || {});
