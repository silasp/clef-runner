/* scales.js — scale / mode / arpeggio exercises for the "Scales" practice style.
   Each type is a set of semitone intervals from the root; exercise() renders it
   ascending then descending as a lick-shaped object {name, source, notes}. The
   game's normal lick pipeline then octave-fits it to the instrument, and (when
   random-key is on) transposes it to a random key — so a single C-rooted
   exercise covers every key. Spelling is re-derived per phrase by the game's
   best-fit key estimator, so we only need MIDI numbers here. */
(function (App) {
  'use strict';
  const T = App.Theory;

  // family → ordered list of {key, name, intervals}. Covers the requested set:
  // major, minor, bebop, pentatonic, chromatic, diminished, modes and arpeggios.
  const TYPES = [
    // --- scales ---
    { key: 'major', name: 'Major scale', family: 'Scales', intervals: [0, 2, 4, 5, 7, 9, 11] },
    { key: 'natural_minor', name: 'Natural minor scale', family: 'Scales', intervals: [0, 2, 3, 5, 7, 8, 10] },
    { key: 'harmonic_minor', name: 'Harmonic minor scale', family: 'Scales', intervals: [0, 2, 3, 5, 7, 8, 11] },
    { key: 'melodic_minor', name: 'Melodic minor scale', family: 'Scales', intervals: [0, 2, 3, 5, 7, 9, 11] },
    { key: 'major_pentatonic', name: 'Major pentatonic', family: 'Scales', intervals: [0, 2, 4, 7, 9] },
    { key: 'minor_pentatonic', name: 'Minor pentatonic', family: 'Scales', intervals: [0, 3, 5, 7, 10] },
    { key: 'blues', name: 'Blues scale', family: 'Scales', intervals: [0, 3, 5, 6, 7, 10] },
    { key: 'chromatic', name: 'Chromatic scale', family: 'Scales', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { key: 'whole_tone', name: 'Whole-tone scale', family: 'Scales', intervals: [0, 2, 4, 6, 8, 10] },
    { key: 'diminished_wh', name: 'Diminished (whole–half)', family: 'Scales', intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
    { key: 'diminished_hw', name: 'Diminished (half–whole)', family: 'Scales', intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
    { key: 'bebop_dominant', name: 'Bebop dominant scale', family: 'Scales', intervals: [0, 2, 4, 5, 7, 9, 10, 11] },
    { key: 'bebop_major', name: 'Bebop major scale', family: 'Scales', intervals: [0, 2, 4, 5, 7, 8, 9, 11] },
    // --- modes (Ionian = Major, Aeolian = Natural minor, already above) ---
    { key: 'dorian', name: 'Dorian mode', family: 'Modes', intervals: [0, 2, 3, 5, 7, 9, 10] },
    { key: 'phrygian', name: 'Phrygian mode', family: 'Modes', intervals: [0, 1, 3, 5, 7, 8, 10] },
    { key: 'lydian', name: 'Lydian mode', family: 'Modes', intervals: [0, 2, 4, 6, 7, 9, 11] },
    { key: 'mixolydian', name: 'Mixolydian mode', family: 'Modes', intervals: [0, 2, 4, 5, 7, 9, 10] },
    { key: 'locrian', name: 'Locrian mode', family: 'Modes', intervals: [0, 1, 3, 5, 6, 8, 10] },
    // --- arpeggios ---
    { key: 'maj_triad', name: 'Major triad arpeggio', family: 'Arpeggios', intervals: [0, 4, 7] },
    { key: 'min_triad', name: 'Minor triad arpeggio', family: 'Arpeggios', intervals: [0, 3, 7] },
    { key: 'dim_triad', name: 'Diminished triad arpeggio', family: 'Arpeggios', intervals: [0, 3, 6] },
    { key: 'aug_triad', name: 'Augmented triad arpeggio', family: 'Arpeggios', intervals: [0, 4, 8] },
    { key: 'dom7', name: 'Dominant 7th arpeggio', family: 'Arpeggios', intervals: [0, 4, 7, 10] },
    { key: 'maj7', name: 'Major 7th arpeggio', family: 'Arpeggios', intervals: [0, 4, 7, 11] },
    { key: 'min7', name: 'Minor 7th arpeggio', family: 'Arpeggios', intervals: [0, 3, 7, 10] },
    { key: 'min7b5', name: 'Half-diminished 7th arpeggio', family: 'Arpeggios', intervals: [0, 3, 6, 10] },
    { key: 'dim7', name: 'Diminished 7th arpeggio', family: 'Arpeggios', intervals: [0, 3, 6, 9] },
  ];
  const BY_KEY = {};
  TYPES.forEach((t) => { BY_KEY[t.key] = t; });

  const DEFAULT_ROOT = 60; // C4

  // Difficulty → how many octaves a scale / arpeggio should span.
  const OCTAVES_BY_DIFFICULTY = { easy: 1, medium: 2, hard: 4 };

  // Render a type as an ascending-then-descending run over `octaves` octaves.
  function exercise(typeKey, rootMidi, octaves) {
    const t = BY_KEY[typeKey];
    if (!t) return null;
    rootMidi = rootMidi == null ? DEFAULT_ROOT : rootMidi;
    octaves = octaves || 1;
    const up = [];
    for (let o = 0; o < octaves; o++) t.intervals.forEach((s) => up.push(rootMidi + 12 * o + s));
    up.push(rootMidi + 12 * octaves);            // land on the top root
    const down = up.slice(0, -1).reverse();      // back down, without repeating the top
    const midis = up.concat(down);
    return {
      name: t.name,
      source: 'scale exercise · ' + t.family.toLowerCase(),
      notes: midis.map((m) => T.spellMidi(m)),
      durs: midis.map(() => 1),                  // quarter notes
    };
  }

  // Build an exercise positioned for a specific instrument:
  //   • octave count comes from the difficulty (easy 1, medium 2, hard 4);
  //   • the root is placed at the LOWEST octave the instrument can play for the
  //     requested pitch class, giving the run the most room to ascend;
  //   • if the run still overshoots the top of the range, the octave count is
  //     reduced (down to 1) until the whole ascent fits in [minMidi, maxMidi].
  // `rootPc` is a pitch class 0–11 (defaults to C). The returned exercise is
  // already in range, so the game uses its notes directly with no octave-fitting.
  function fitted(typeKey, inst, difficulty, rootPc) {
    if (!BY_KEY[typeKey]) return null;
    const lo = inst.minMidi, hi = inst.maxMidi;
    const pc = rootPc == null ? (DEFAULT_ROOT % 12) : ((((rootPc | 0) % 12) + 12) % 12);
    const rootMidi = lo + ((((pc - lo) % 12) + 12) % 12); // lowest playable root of this pitch class
    let octaves = OCTAVES_BY_DIFFICULTY[difficulty] || 1;
    while (octaves > 1 && rootMidi + 12 * octaves > hi) octaves--;
    return exercise(typeKey, rootMidi, octaves);
  }

  // Library catalogue: one selectable item per type. The baked preview is at C4;
  // `scaleKey` lets the game re-fit it to the instrument/difficulty when played.
  function catalog() {
    return TYPES.map((t) => ({
      id: 'scale:' + t.key,
      name: t.name,
      group: t.family,
      kind: 'scale',
      lick: () => { const ex = exercise(t.key, DEFAULT_ROOT, t.family === 'Arpeggios' ? 2 : 1); if (ex) ex.scaleKey = t.key; return ex; },
    }));
  }

  // Pool for the Scales style: lightweight {scaleKey,name,source} descriptors.
  // The game re-builds each one per phrase via fitted() so octave span tracks
  // the difficulty and the run is placed within the instrument's range.
  function pool(typeKeys) {
    const keys = (typeKeys && typeKeys.length) ? typeKeys : ['major'];
    return keys.map((k) => {
      const t = BY_KEY[k];
      return t ? { scaleKey: k, name: t.name, source: 'scale exercise · ' + t.family.toLowerCase() } : null;
    }).filter(Boolean);
  }

  App.Scales = { TYPES, exercise, fitted, catalog, pool, byKey: (k) => BY_KEY[k] };
})(window.App = window.App || {});
