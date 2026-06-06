/* lickgen.js — procedural lick generator.
   Produces a large pool of idiomatic, playable phrases per genre, built from
   each genre's defining scales, arpeggios and melodic devices (runs, neighbour
   tones, chromatic enclosures, turns, Alberti figures). Output is deterministic
   (seeded per genre+index) so phrases are stable across sessions, and every note
   is generated within the scale/chord so the result is musically valid. These
   complement the hand-curated, named tunes in licks.js. */
(function (App) {
  'use strict';
  const T = App.Theory;

  // deterministic RNG (mulberry32)
  function rngFor(seed) {
    let a = seed >>> 0;
    const f = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { f, int: (n) => Math.floor(f() * n), pick: (arr) => arr[Math.floor(f() * arr.length)] };
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // genre generation configs. roots are MIDI; scales/chords are semitone sets.
  const GEN = {
    folk: { label: 'Folk phrase', tag: 'major', roots: [60, 55, 62, 65, 57],
      scales: [[0, 2, 4, 5, 7, 9, 11], [0, 2, 4, 7, 9]], chord: [0, 4, 7],
      devices: ['run', 'neighbor', 'arp', 'run'], len: [7, 13] },
    blues: { label: 'Blues lick', tag: 'minor blues scale', roots: [57, 52, 55, 60, 62],
      scales: [[0, 3, 5, 6, 7, 10]], chord: [0, 3, 7, 10],
      devices: ['run', 'enclose', 'arp', 'run', 'neighbor'], len: [7, 12] },
    rock: { label: 'Rock lick', tag: 'minor pentatonic', roots: [52, 57, 62, 55],
      scales: [[0, 3, 5, 7, 10], [0, 3, 5, 6, 7, 10]], chord: [0, 3, 7],
      devices: ['run', 'arp', 'run', 'enclose'], len: [7, 12] },
    bluegrass: { label: 'Bluegrass lick', tag: 'major', roots: [55, 57, 62, 60],
      scales: [[0, 2, 4, 5, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10], [0, 2, 4, 7, 9]], chord: [0, 4, 7],
      devices: ['run', 'arp', 'run', 'neighbor'], len: [8, 14] },
    country: { label: 'Country lick', tag: 'major pentatonic', roots: [55, 60, 62, 57],
      scales: [[0, 2, 4, 7, 9], [0, 2, 4, 5, 7, 9, 11]], chord: [0, 4, 7],
      devices: ['run', 'neighbor', 'arp', 'run'], len: [7, 12] },
    jazz: { label: 'Bebop line', tag: 'bebop scale', roots: [60, 53, 55, 62, 58],
      scales: [[0, 2, 4, 5, 7, 9, 10, 11], [0, 2, 4, 5, 7, 8, 9, 11], [0, 2, 3, 5, 7, 9, 10]],
      chord: [0, 4, 7, 10], devices: ['run', 'enclose', 'arp', 'enclose', 'run'], len: [8, 14] },
    gypsy: { label: 'Gypsy lick', tag: 'harmonic minor / Am6', roots: [57, 62, 52, 55],
      scales: [[0, 2, 3, 5, 7, 8, 11], [0, 3, 6, 9]], chord: [0, 3, 7, 9],
      devices: ['arp', 'enclose', 'run', 'enclose', 'arp'], len: [7, 12] },
    classical: { label: 'Classical étude', tag: 'major / minor', roots: [60, 55, 62, 53, 57, 58],
      scales: [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 11]], chord: [0, 4, 7],
      devices: ['run', 'arp', 'turn', 'run', 'alberti'], len: [8, 14] },
  };

  function buildScale(root, intervals, octs) {
    const out = [];
    for (let o = -1; o < octs; o++) intervals.forEach((iv) => out.push(root + 12 * o + iv));
    out.push(root + 12 * octs);
    return [...new Set(out)].sort((a, b) => a - b);
  }

  function device(d, rng, ctx) {
    const { scale, root, chord } = ctx;
    if (d === 'run') {
      const len = 3 + rng.int(4), dir = rng.f() < 0.5 ? 1 : -1, out = [];
      let i = rng.int(scale.length);
      for (let k = 0; k < len; k++) { const j = i + dir * k; if (j < 0 || j >= scale.length) break; out.push(scale[j]); }
      return out;
    }
    if (d === 'arp') {
      const tones = [];
      for (let o = -1; o <= 1; o++) chord.forEach((c) => tones.push(root + 12 * o + c));
      tones.sort((a, b) => a - b);
      const len = 3 + rng.int(3), dir = rng.f() < 0.5 ? 1 : -1, out = [];
      let i = rng.int(tones.length);
      for (let k = 0; k < len; k++) { const j = i + dir * k; if (j < 0 || j >= tones.length) break; out.push(tones[j]); }
      return out;
    }
    if (d === 'enclose') { const t = scale[1 + rng.int(scale.length - 2)]; return [t + 1, t - 1, t]; }
    if (d === 'neighbor') { const i = 1 + rng.int(scale.length - 2); return [scale[i], scale[i + 1], scale[i], scale[i - 1], scale[i]]; }
    if (d === 'turn') { const i = 1 + rng.int(scale.length - 2); return [scale[i + 1], scale[i], scale[i - 1], scale[i]]; }
    if (d === 'alberti') { return [root, root + 7, root + 4, root + 7]; }
    return [scale[rng.int(scale.length)]];
  }

  function nearestChordTone(m, root, chord) {
    let best = root, bd = 1e9;
    for (let o = -2; o <= 2; o++) chord.forEach((c) => { const t = root + 12 * o + c; const d = Math.abs(t - m); if (d < bd) { bd = d; best = t; } });
    return best;
  }

  function makeLick(cfg, genreKey, idx) {
    const rng = rngFor(hash(genreKey) ^ Math.imul(idx + 1, 0x9E3779B1));
    const root = rng.pick(cfg.roots);
    const intervals = rng.pick(cfg.scales);
    const scale = buildScale(root, intervals, 2);
    const target = cfg.len[0] + rng.int(cfg.len[1] - cfg.len[0] + 1);
    let notes = [];
    let guard = 0;
    while (notes.length < target && guard++ < 10) notes = notes.concat(device(rng.pick(cfg.devices), rng, { scale, root, chord: cfg.chord }));
    notes = notes.slice(0, target);
    // smooth leaps larger than an octave so phrases stay readable
    for (let i = 1; i < notes.length; i++) {
      while (notes[i] - notes[i - 1] > 12) notes[i] -= 12;
      while (notes[i] - notes[i - 1] < -12) notes[i] += 12;
    }
    if (notes.length) {
      const prev = notes.length > 1 ? notes[notes.length - 2] : root;
      notes[notes.length - 1] = nearestChordTone(prev, root, cfg.chord);
    }
    const rootLabel = T.spellMidi(root).label;
    return {
      name: cfg.label + ' in ' + rootLabel,
      source: 'generated · ' + rootLabel + ' ' + cfg.tag,
      notes: notes.map((m) => T.spellMidi(m)),
    };
  }

  // generate `count` licks for a genre
  function generate(genreKey, count) {
    const cfg = GEN[genreKey];
    if (!cfg) return [];
    const out = [];
    for (let i = 0; i < count; i++) out.push(makeLick(cfg, genreKey, i));
    return out;
  }

  App.LickGen = { generate, GENRE_KEYS: Object.keys(GEN) };
})(window.App = window.App || {});
