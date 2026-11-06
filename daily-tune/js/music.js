// Pure music helpers: pitch names, keys, scale degrees, frequencies.
// No DOM access — safe to import from Node tests.

export const PARTS = ['Melody'];   // Daily Tune: one melodic line per tune

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

// Major keys that are conventionally written with flats.
const FLAT_TONICS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function freqToMidi(f) {
  return 69 + 12 * Math.log2(f / 440);
}

export function pitchClass(m) {
  return ((Math.round(m) % 12) + 12) % 12;
}

export function octaveOf(m) {
  return Math.floor(Math.round(m) / 12) - 1;
}

/** Note name for a MIDI number, spelled for the given key tonic (0-11, major). */
export function noteName(m, tonic = 0, withOctave = true) {
  const names = FLAT_TONICS.has(tonic) ? FLAT_NAMES : SHARP_NAMES;
  const n = names[pitchClass(m)];
  return withOctave ? n + octaveOf(m) : n;
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const SIG_COUNT = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: -6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

/** Key signature of a major tonic: { acc: '♯' | '♭', letters: ['F', 'C', …] }. */
export function keySignature(tonic) {
  const n = SIG_COUNT[((tonic % 12) + 12) % 12];
  return n >= 0 ? { acc: '♯', letters: SHARP_ORDER.slice(0, n) } : { acc: '♭', letters: FLAT_ORDER.slice(0, -n) };
}

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The note a letter means in this key (F means F♯ in D major), in the octave nearest `near`. */
export function letterToMidi(letter, tonic, near = 60) {
  const L = String(letter).toUpperCase();
  const sig = keySignature(tonic);
  let pc = LETTER_PC[L];
  if (pc == null) return null;
  if (sig.letters.includes(L)) pc += sig.acc === '♯' ? 1 : -1;
  let m = pc + 12 * Math.round((near - pc) / 12);
  if (m - near > 6) m -= 12;
  if (near - m > 6) m += 12;
  return m;
}

export function keyName(tonic, mode = 'major') {
  const names = FLAT_TONICS.has(tonic) || mode === 'minor' && FLAT_TONICS.has((tonic + 3) % 12) ? FLAT_NAMES : SHARP_NAMES;
  return names[tonic] + (mode === 'minor' ? ' minor' : ' major');
}

const MAJOR_DEGREES = { 0: '1', 1: '♯1', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♯4', 7: '5', 8: '♯5', 9: '6', 10: '♭7', 11: '7' };
const SOLFEGE = { 0: 'Do', 1: 'Di', 2: 'Re', 3: 'Me', 4: 'Mi', 5: 'Fa', 6: 'Fi', 7: 'Sol', 8: 'Si', 9: 'La', 10: 'Te', 11: 'Ti' };

/** Scale degree of a note relative to a major tonic (e.g. "5", "♭7"). */
export function scaleDegree(m, tonic) {
  return MAJOR_DEGREES[((pitchClass(m) - tonic) % 12 + 12) % 12];
}

export function solfege(m, tonic) {
  return SOLFEGE[((pitchClass(m) - tonic) % 12 + 12) % 12];
}

export function isDiatonic(m, tonic) {
  const d = ((pitchClass(m) - tonic) % 12 + 12) % 12;
  return [0, 2, 4, 5, 7, 9, 11].includes(d);
}

export function isBlackKey(m) {
  return [1, 3, 6, 8, 10].includes(pitchClass(m));
}

// Krumhansl–Kessler key profiles.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(hist, profile, t) {
  const n = 12;
  const mx = hist.reduce((a, b) => a + b, 0) / n, my = profile.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const x = hist[(i + t) % n] - mx, y = profile[i] - my;
    sxy += x * y; sxx += x * x; syy += y * y;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Estimate key from notes. Returns { tonic, mode, spell } where `spell`
 * is the major tonic whose key signature to use for note spelling
 * (the relative major for minor keys).
 * @param {number[][]} notes  all notes ([midi, start, dur])
 * @param {number} [finalBass] midi of the bass's last note: barbershop tags
 *   end on the tonic chord in root position, so it breaks major/minor and
 *   relative-key ties.
 * @param {{tonic:number, mode:string}} [hint] the arranger's written key —
 *   preferred whenever the sung notes fit it about as well (learning tracks
 *   are usually sung in the written key).
 */
export function detectKey(notes, finalBass = null, hint = null) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pitchClass(n[0])] += n[2] || 1;
  const cands = [];
  for (let t = 0; t < 12; t++) {
    cands.push({ score: correlate(hist, KK_MAJOR, t), tonic: t, mode: 'major' });
    cands.push({ score: correlate(hist, KK_MINOR, t) - 0.03, tonic: t, mode: 'minor' });
  }
  cands.sort((a, b) => b.score - a.score);
  let best = cands[0];
  const hinted = hint && cands.find(c => c.tonic === hint.tonic && c.mode === hint.mode);
  if (hinted && hinted.score >= best.score - 0.2) best = hinted;
  else if (finalBass != null) {
    const fb = pitchClass(finalBass);
    const onBass = cands.find(c => c.tonic === fb);
    if (onBass && onBass.score >= best.score - 0.25) best = onBass;
  }
  const spell = best.mode === 'minor' ? (best.tonic + 3) % 12 : best.tonic;
  return { tonic: best.tonic, mode: best.mode, spell };
}

/**
 * Estimate the (major) tonic from a list of [midi, start, dur] notes,
 * weighting by duration. Barbershop tags almost always resolve to the
 * major tonic, so a major-only profile is sufficient.
 */
export function detectTonic(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pitchClass(n[0])] += n[2] || 1;
  let best = 0, bestScore = -Infinity;
  for (let t = 0; t < 12; t++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += hist[(i + t) % 12] * KK_MAJOR[i];
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

/** Semitone intervals between consecutive notes. */
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Parse barbershoptags.com "Major:Eb" / "Minor:F#" into {tonic, mode}. */
export function parseWrittenKey(s) {
  const m = /^(Major|Minor):([A-G])([b#]?)/i.exec(s || '');
  if (!m) return null;
  const tonic = (PC[m[2].toUpperCase()] + (m[3] === '#' ? 1 : m[3] === 'b' ? -1 : 0) + 12) % 12;
  return { tonic, mode: m[1].toLowerCase() };
}

export function intervals(midis) {
  const out = [];
  for (let i = 1; i < midis.length; i++) out.push(midis[i] - midis[i - 1]);
  return out;
}

/** Difficulty score (≈1–10) of a single part's note list. */
export function partDifficulty(notes, tonic) {
  if (!notes.length) return 0;
  const m = notes.map(n => n[0]);
  const iv = intervals(m).map(Math.abs);
  const range = Math.max(...m) - Math.min(...m);
  const meanLeap = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
  const bigLeaps = iv.filter(x => x >= 5).length;
  const chromatic = m.filter(x => !isDiatonic(x, tonic)).length;
  const changes = iv.filter(x => x > 0).length;
  const raw = changes * 0.12 + range * 0.12 + meanLeap * 0.5 + bigLeaps * 0.3 + chromatic * 0.25;
  return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
}
