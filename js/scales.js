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

  // Library catalogue: one selectable item per type (rendered at C4; the game
  // transposes when random-key is on).
  function catalog() {
    return TYPES.map((t) => ({
      id: 'scale:' + t.key,
      name: t.name,
      group: t.family,
      kind: 'scale',
      lick: () => exercise(t.key, DEFAULT_ROOT, t.family === 'Arpeggios' ? 2 : 1),
    }));
  }

  // Pool of exercises for the Scales style, given selected type keys.
  function pool(typeKeys) {
    const keys = (typeKeys && typeKeys.length) ? typeKeys : ['major'];
    return keys.map((k) => exercise(k, DEFAULT_ROOT, BY_KEY[k] && BY_KEY[k].family === 'Arpeggios' ? 2 : 1))
      .filter(Boolean);
  }

  App.Scales = { TYPES, exercise, catalog, pool, byKey: (k) => BY_KEY[k] };
})(window.App = window.App || {});
