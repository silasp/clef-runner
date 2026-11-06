// Tiny SVG staff renderer. Pitch only (barbershop learners care about
// which note, not exact rhythm), but note length is hinted by spacing
// and a hold-bar for long notes. Returns an SVG string (no DOM needed).

import { noteName, pitchClass, keySignature } from './music.js';

// key-signature positions as written steps (C4 = 28), in engraving order
const SIG_STEPS = {
  treble: { '♯': [38, 35, 39, 36, 33, 37, 34], '♭': [34, 37, 33, 36, 32, 35, 31] },
  bass: { '♯': [24, 21, 25, 22, 19, 23, 20], '♭': [20, 23, 19, 22, 18, 21, 17] },
};

const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** Clef per barbershop convention: tenor/lead on treble-8vb, bari/bass on bass clef. */
export function clefFor(part) {
  return part === 'Tenor' || part === 'Lead' ? 'treble8' : 'bass';
}

/** Diatonic staff step (C4 = 28) and accidental, spelled for the key. */
export function staffPosition(midi, tonic) {
  const name = noteName(midi, tonic, false); // e.g. "B♭"
  const letter = name[0];
  const acc = name.length > 1 ? name[1] : '';
  let octave = Math.floor(Math.round(midi) / 12) - 1;
  // B♯/C♭ edge cases don't occur with our spellings, but keep octave sane
  if (letter === 'C' && acc === '♭') octave += 1;
  const step = octave * 7 + LETTER_STEP[letter];
  return { step, acc, letter };
}

// bottom line steps: treble E4 = 4*7+2 = 30; bass G2 = 2*7+4 = 18
function bottomLineStep(clef) {
  if (clef === 'bass') return 18;
  if (clef === 'treble8') return 30 - 7; // sounds an octave lower than written
  return 30;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A rest of the given length, centred on the staff's middle line. */
function restGlyph(x, midY, gap, beats, cur) {
  const g = rhythmGlyph(beats);
  const cls = `st-rest${cur ? ' cur' : ''}`;
  let s = '';
  if (g.beats >= 4) s = `<rect x="${x - 6}" y="${midY - gap}" width="12" height="${gap / 2}" class="${cls}"/>`;
  else if (g.beats >= 2) s = `<rect x="${x - 6}" y="${midY - gap / 2}" width="12" height="${gap / 2}" class="${cls}"/>`;
  else if (g.beats >= 1) s = `<path d="M${x - 2} ${midY - 12} l5 6 l-5 6 l5 6 q-7 -2 -3 6" class="${cls} line"/>`;
  else {
    const flags = g.flags || 1;
    for (let f = 0; f < flags; f++) s += `<circle cx="${x - 3 - f}" cy="${midY - 5 + f * 6}" r="2" class="${cls}"/>`;
    s += `<path d="M${x - 3} ${midY - 5} q4 1 5 -2 l-4 ${10 + (flags - 1) * 6}" class="${cls} line"/>`;
  }
  if (g.dot) s += `<circle cx="${x + 8}" cy="${midY - 2}" r="1.6" class="${cls}"/>`;
  return s;
}

/** Glyph for a length in beats (quarter = 1): head, stem, flags, dot. */
export function rhythmGlyph(beats) {
  const table = [
    [8, { hollow: true, stem: false, flags: 0, dot: false, double: true }],
    [6, { hollow: true, stem: false, flags: 0, dot: true }],
    [4, { hollow: true, stem: false, flags: 0, dot: false }],
    [3, { hollow: true, stem: true, flags: 0, dot: true }],
    [2, { hollow: true, stem: true, flags: 0, dot: false }],
    [1.5, { hollow: false, stem: true, flags: 0, dot: true }],
    [1, { hollow: false, stem: true, flags: 0, dot: false }],
    [0.75, { hollow: false, stem: true, flags: 1, dot: true }],
    [0.5, { hollow: false, stem: true, flags: 1, dot: false }],
    [0.375, { hollow: false, stem: true, flags: 2, dot: true }],
    [0.25, { hollow: false, stem: true, flags: 2, dot: false }],
  ];
  let best = table[0];
  for (const row of table) if (Math.abs(Math.log(row[0]) - Math.log(Math.max(0.2, beats))) < Math.abs(Math.log(best[0]) - Math.log(Math.max(0.2, beats)))) best = row;
  return { beats: best[0], ...best[1] };
}

// ---------------------------------------------------------------- engraving
//
// Layout follows common engraving practice (after E. Gould, "Behind Bars"):
//  * spacing grows with duration, ~×1.3 per doubling (not proportionally);
//    accidentals, dots and lyrics get the room they need on top of that;
//  * lines break at barlines only (inside a bar only if one bar is wider
//    than a line), lines are balanced and justified; a short last line is
//    left at its natural width;
//  * lyrics: roman, one baseline; syllables centred under their note, a
//    syllable that starts a melisma left-aligned; hyphens centred between
//    syllables (repeated over long gaps); extender lines only for
//    word-final melismas, ending under the last note;
//  * stems: down on and above the middle line, one octave (3½ spaces) long,
//    reaching the middle line for ledger-line notes; beams by beat;
//  * dots in spaces, ties opposite the stems, whole-bar rests centred;
//  * key signature on every line, time signature (when the barlines show
//    a regular metre) on the first, final barline at the end of a part.

const SP = 8;                    // staff space (px)
const HEAD = 5.2;                // notehead half-width
const SYL_CH = 6.3;              // average lyric character width at 12px
const NAME_W = 14;               // note-name label width
const flagOf = (nt, f) => typeof nt[5] === 'string' && nt[5].includes(f);

/** Distance (in spaces) a note of `beats` takes before the next note. */
function durSpace(beats) {
  return 3.3 * Math.pow(Math.max(0.25, beats || 1), 0.4);
}

/** Width estimate of a lyric syllable as drawn (hyphen removed). */
function sylWidth(syl) {
  const t = String(syl || '').replace(/-$/, '');
  let w = 0;
  for (const c of t) w += /[mwMW]/.test(c) ? 9 : /[iljtfI'.,!:;]/.test(c) ? 3.4 : /[A-Z]/.test(c) ? 7.6 : SYL_CH;
  return w;
}

/** Does syllable i start a melisma (held over the next note(s))? */
function startsMelisma(notes, i) {
  return !!notes[i][4] && i + 1 < notes.length && notes[i + 1][4] === '' && !flagOf(notes[i + 1], 'r');
}

/** Horizontal extent [left, right] of syllable i's text relative to its note x. */
function sylBox(notes, i) {
  const w = sylWidth(notes[i][4]);
  return startsMelisma(notes, i) ? [-HEAD, -HEAD + w] : [-w / 2, w / 2];
}

/**
 * Regular metre from the barlines: { beats, compound } or null.
 * Complete bars (not the first or last) must mostly agree.
 */
export function inferMeter(notes) {
  const lens = [];
  let cur = 0, started = false;
  notes.forEach((n, i) => {
    if (i > 0 && flagOf(n, '|')) { lens.push(cur); cur = 0; started = true; }
    cur += rhythmGlyph(n[3] || 1).beats;
  });
  lens.push(cur);
  if (!started || lens.length < 3) return null;
  const inner = lens.slice(1, -1).map(l => Math.round(l * 4) / 4);
  const count = {};
  for (const l of inner) count[l] = (count[l] || 0) + 1;
  const [best, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (n / inner.length < 0.7) return null;
  const beats = Number(best);
  const vals = notes.map(x => rhythmGlyph(x[3] || 1).beats);
  const dottedQ = vals.filter(v => v === 1.5 || v === 3).length;
  const plainQ = vals.filter(v => v === 1 || v === 2).length;
  const compound = [1.5, 3, 4.5, 6].includes(beats) && dottedQ >= plainQ;
  return { beats, compound, pickup: Math.max(0, beats - lens[0]) % beats };
}

function meterLabel(m) {
  if (!m) return null;
  if (m.compound || !Number.isInteger(m.beats)) return [String(Math.round(m.beats * 2)), '8'];
  return [String(m.beats), '4'];
}

/**
 * Natural x positions (centre of each note) for a whole part, before line
 * breaking, plus per-note left padding (room for accidentals).
 */
function naturalSpacing(notes, o, accs) {
  const xs = [];
  let x = 0;
  let lastSyl = -1;
  for (let i = 0; i < notes.length; i++) {
    if (i > 0) {
      const prev = notes[i - 1];
      const g = rhythmGlyph(prev[3] || 1);
      let d = (o.rhythm ? durSpace(g.beats) : 3.3) * SP;
      let min = 2.6 * SP + (g.dot && o.rhythm ? 0.8 * SP : 0) + (accs[i] ? 1.3 * SP : 0);
      if (o.names) min = Math.max(min, NAME_W + 5);
      d = Math.max(d, min);
      if (flagOf(notes[i], '|')) d += 2.2 * SP;            // room either side of the barline
      x += d;
    }
    xs.push(x);
    // lyrics: no two syllables closer than a word space (a hyphen's room inside a word)
    if (o.lyrics && notes[i][4] && !flagOf(notes[i], 'r')) {
      if (lastSyl >= 0) {
        const a = sylBox(notes, lastSyl), b = sylBox(notes, i);
        const inWord = String(notes[lastSyl][4]).endsWith('-');
        const need = a[1] + (inWord ? 14 : 8) - b[0];
        const deficit = need - (xs[i] - xs[lastSyl]);
        if (deficit > 0) {
          // spread the extra room across the notes in between
          const span = i - lastSyl;
          for (let k = lastSyl + 1; k <= i; k++) xs[k] += deficit * (k - lastSyl) / span;
          x = xs[i];
        }
      }
      lastSyl = i;
    }
  }
  return xs;
}

/** Which accidental (if any) each note shows: key signature + bar memory. */
function accidentals(notes, tonic, sig) {
  const keyAcc = Object.fromEntries(sig.letters.map(L => [L, sig.acc]));
  const barred = notes.some((nt, i) => i > 0 && flagOf(nt, '|'));
  let barState = {};
  return notes.map((nt, i) => {
    if (i > 0 && flagOf(nt, '|')) barState = {};
    if (flagOf(nt, 'r')) return '';
    const { step, acc, letter } = staffPosition(nt[0], tonic);
    const current = barred && step in barState ? barState[step] : (keyAcc[letter] || '');
    if (barred) barState[step] = acc;
    return acc === current ? '' : (acc || '♮');
  });
}

/** Break a part into lines: arrays of [from, to) note indices. */
function breakLines(notes, xs, usableFirst, usableRest, o) {
  const N = notes.length;
  const barred = notes.some((n, i) => i > 0 && flagOf(n, '|'));
  const isBar = i => i === 0 || i === N || flagOf(notes[i], '|');
  const pad = 2.2 * SP;                         // first note after the header + room at the line end
  const width = (a, b) => xs[b - 1] - xs[a] + pad + 2 * SP;
  const breakPenalty = b => {
    if (b === N || b === 0) return 0;
    if (isBar(b)) return 0;
    if (barred) return 400;                      // only inside a bar if it can't fit
    const n = notes[b], p = notes[b - 1];
    const wordStart = n[4] && !String(p[4] || '').endsWith('-');
    return wordStart || flagOf(p, 'r') || flagOf(n, 'r') || rhythmGlyph(p[3] || 1).beats >= 2 ? 0 : 25;
  };
  const best = new Array(N + 1).fill(Infinity), from = new Array(N + 1).fill(-1), lines = new Array(N + 1).fill(0);
  best[0] = 0;
  for (let b = 1; b <= N; b++) {
    for (let a = b - 1; a >= 0; a--) {
      if (best[a] === Infinity) continue;
      const usable = lines[a] === 0 ? usableFirst : usableRest;
      const w = width(a, b);
      const single = b - a === 1;
      if (w > usable && !single) {
        // too wide: allowed only as a single bar that can't fit anyway
        const oneBar = isBar(a) && isBar(b) && ![...Array(b - a - 1)].some((_, k) => isBar(a + 1 + k));
        if (!oneBar || w > usable * 1.25) { if (w > usable * 3) break; continue; }
      }
      const last = b === N;
      const fill = w / usable;
      let cost = 12;                                                  // per line: prefer fewer lines
      if (fill > 1) cost += (fill - 1) * 300;
      else if (!last) cost += Math.pow(1 - fill, 2) * 100;
      else if (fill < 0.3) cost += 20;                                 // avoid a stub of a last line
      cost += breakPenalty(b);
      if (best[a] + cost < best[b]) { best[b] = best[a] + cost; from[b] = a; lines[b] = lines[a] + 1; }
    }
  }
  const out = [];
  for (let b = N; b > 0; b = from[b]) out.unshift([from[b], b]);
  return out;
}

/**
 * Render notes as engraved staff lines (one SVG per line).
 * @param {number[][]} notes  [midi, start, dur, beats?, syllable?, flags?]  flags: "|" barline before, "~" tie to next, "r" rest
 * @param {object} o
 * @param {string} o.part
 * @param {number} o.tonic
 * @param {boolean[]} [o.mask]      which notes are visible (cue fading)
 * @param {boolean} [o.names]       show note names under heads
 * @param {string[]} [o.labels]     custom labels instead of note names
 * @param {boolean} [o.rhythm]      draw note values (stems, flags, beams, dots) and space by length
 * @param {boolean} [o.lyrics]      draw each note's syllable (hyphens, extenders)
 * @param {number} [o.highlight]    index of note to highlight (current)
 * @param {boolean[]} [o.hits]      per-note correctness colouring
 * @param {number} [o.width]        line width (px)
 * @param {boolean} [o.final]       end with a final barline (a whole part)
 * @param {boolean} [o.keySig]      false to omit the key signature
 */
export function renderStaff(notes, o = {}) {
  const opt = { part: 'Lead', tonic: 0, names: false, highlight: -1, width: 340, rhythm: false, lyrics: false, ...o };
  if (!notes.length) return '';
  const clef = clefFor(opt.part);
  const sig = opt.keySig === false ? { acc: '', letters: [] } : keySignature(opt.tonic);
  const accs = accidentals(notes, opt.tonic, sig);
  const meter = opt.rhythm ? inferMeter(notes) : null;
  const ts = meterLabel(meter);
  const hasSyl = opt.lyrics && notes.some(n => n[4]);
  const xs = naturalSpacing(notes, { rhythm: opt.rhythm, names: opt.names, lyrics: hasSyl }, accs);
  const header = first => 30 + (sig.letters.length ? sig.letters.length * 6.5 + 4 : 0) + (first && ts ? 16 : 0) + 4;
  const right = 6;
  const lines = breakLines(notes, xs, opt.width - header(true) - right, opt.width - header(false) - right, opt);
  // beat positions (for beaming), honouring a pickup bar
  const beatPos = [];
  let pos = meter ? meter.pickup : 0;
  notes.forEach((n, i) => {
    if (i > 0 && flagOf(n, '|')) pos = 0;
    beatPos.push(pos);
    pos += rhythmGlyph(n[3] || 1).beats;
  });
  const beatUnit = meter && meter.compound ? 1.5 : 1;
  return lines.map(([a, b], li) => drawLine(notes, a, b, {
    ...opt, clef, sig, accs, xsNat: xs, header: header(li === 0), right, ts: li === 0 ? ts : null,
    lastLine: li === lines.length - 1, beatPos, beatUnit, hasSyl,
  })).join('');
}

/** Same as renderStaff; the name says what it does now (several lines). */
export const renderScore = renderStaff;

function drawLine(notes, a, b, o) {
  const { clef, sig, accs, tonic, mask, hits, highlight, rhythm, width, names, labels, hasSyl } = o;
  const gap = SP;
  const base = bottomLineStep(clef);
  const T = 0;                                         // staff top (shifted into view at the end)
  const yOf = step => T + gap * 4 - (step - base) * (gap / 2);
  const midY = T + gap * 2;
  const staffEnd = width - o.right;
  // --- positions: justify unless it's a short last line
  const startX = o.header + 1.6 * gap + (accs[a] ? 1.3 * gap : 0);
  const endRoom = 2 * gap;
  const span = o.xsNat[b - 1] - o.xsNat[a];
  const avail = staffEnd - endRoom - startX;
  let k = span > 0 ? avail / span : 1;
  const natural = span + startX + endRoom <= staffEnd;
  if (o.lastLine && natural && span / avail < 0.72) k = 1;
  const X = i => startX + (o.xsNat[i] - o.xsNat[a]) * k;
  const lineEnd = o.lastLine && k === 1 ? Math.min(staffEnd, X(b - 1) + endRoom + gap) : staffEnd;
  let minY = -8, maxY = gap * 4 + 8;
  const ext = (y1, y2 = y1) => { minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2); };
  let s = '';
  // staff, clef, key and time signatures
  for (let i = 0; i < 5; i++) s += `<line x1="4" x2="${lineEnd}" y1="${T + i * gap}" y2="${T + i * gap}" class="st-line"/>`;
  if (clef === 'bass') s += `<text x="6" y="${T + gap * 2.2}" class="st-clef" font-size="${gap * 4}">𝄢</text>`;
  else {
    s += `<text x="5" y="${T + gap * 3.6}" class="st-clef" font-size="${gap * 6}">𝄞</text>`;
    s += `<text x="12" y="${T + gap * 4 + 18}" class="st-small">8</text>`;
    ext(T - 14, T + gap * 4 + 18);
  }
  sig.letters.forEach((_, kk) => {
    const w = SIG_STEPS[clef === 'bass' ? 'bass' : 'treble'][sig.acc][kk] - (clef === 'treble8' ? 7 : 0);
    s += `<text x="${30 + kk * 6.5}" y="${yOf(w) + 4}" class="st-acc st-sig">${sig.acc}</text>`;
  });
  if (o.ts) {
    const tx = o.header - 12;
    s += `<text x="${tx}" y="${T + gap * 2 - 1}" text-anchor="middle" class="st-time">${o.ts[0]}</text>`;
    s += `<text x="${tx}" y="${T + gap * 4 - 1}" text-anchor="middle" class="st-time">${o.ts[1]}</text>`;
  }
  // barlines: before a barred note (between it and the previous one); the line end
  const barAt = i => {
    const prev = X(i - 1), cur = X(i) - (accs[i] ? 1.3 * gap : 0);
    return prev + (cur - prev) * 0.55;
  };
  const bars = [];
  for (let i = a + 1; i < b; i++) if (flagOf(notes[i], '|')) bars.push([i, barAt(i)]);
  for (const [, bx] of bars) s += `<line x1="${bx}" x2="${bx}" y1="${T}" y2="${T + gap * 4}" class="st-bar"/>`;
  const endsAtBar = b === notes.length || flagOf(notes[b], '|');
  if (b === notes.length && o.final) {
    s += `<line x1="${lineEnd - 6}" x2="${lineEnd - 6}" y1="${T}" y2="${T + gap * 4}" class="st-bar"/>`;
    s += `<rect x="${lineEnd - 3.5}" y="${T}" width="3.5" height="${gap * 4}" class="st-final"/>`;
  } else if (endsAtBar && b < notes.length) {
    s += `<line x1="${lineEnd}" x2="${lineEnd}" y1="${T}" y2="${T + gap * 4}" class="st-bar"/>`;
  }
  // bar edges, for centring a whole-bar rest
  const barEdges = i => {
    let l = o.header, r = lineEnd;
    for (const [bi, bx] of bars) { if (bi <= i) l = bx; else { r = bx; break; } }
    return [l, r];
  };

  // --- beaming (by beat) and stem directions
  const info = [];
  for (let i = a; i < b; i++) {
    const nt = notes[i];
    const g = rhythmGlyph(nt[3] || 1);
    const visible = !mask || mask[i];
    info[i] = { g, y: !flagOf(nt, 'r') && visible ? yOf(staffPosition(nt[0], tonic).step) : null };
  }
  const beam = {};
  const groups = [];
  if (rhythm) {
    const beamable = i => info[i].y != null && info[i].g.stem && info[i].g.flags >= 1;
    let cur = [];
    const flush = () => { if (cur.length >= 2) groups.push(cur); cur = []; };
    for (let i = a; i < b; i++) {
      if (!beamable(i)) { flush(); continue; }
      const same = cur.length && cur[cur.length - 1] === i - 1 && !flagOf(notes[i], '|')
        && Math.floor(o.beatPos[i - 1] / o.beatUnit + 1e-6) === Math.floor(o.beatPos[i] / o.beatUnit + 1e-6);
      if (!same) flush();
      cur.push(i);
    }
    flush();
    for (const grp of groups) {
      const ys = grp.map(i => info[i].y);
      // the note furthest from the middle line decides the direction
      const far = ys.reduce((m, y) => (Math.abs(y - midY) > Math.abs(m - midY) ? y : m), ys[0]);
      const up = far > midY;
      const sx = grp.map(i => X(i) + (up ? HEAD - 0.4 : -HEAD + 0.4));
      const tip = kk => ys[kk] + (up ? -3.5 * gap : 3.5 * gap);
      const w = Math.max(1, sx[sx.length - 1] - sx[0]);
      const slope = Math.max(-0.1, Math.min(0.1, (tip(grp.length - 1) - tip(0)) / w));
      const line = x => tip(0) + slope * (x - sx[0]);
      let shift = 0;
      grp.forEach((_, kk) => {
        const need = up ? line(sx[kk]) - (ys[kk] - 2.8 * gap) : (ys[kk] + 2.8 * gap) - line(sx[kk]);
        if (need > shift) shift = need;
      });
      const at = x => line(x) + (up ? -shift : shift);
      grp.forEach((i, kk) => { beam[i] = { up, end: at(sx[kk]) }; });
      groups[groups.indexOf(grp)] = { grp, up, sx, at, flags: grp.map(i => info[i].g.flags) };
    }
  }

  // --- notes and rests
  for (let i = a; i < b; i++) {
    const nt = notes[i];
    const x = X(i);
    const isCur = i === highlight;
    if (flagOf(nt, 'r')) {
      const barred = notes.some((n, k) => k > 0 && flagOf(n, '|'));
      const alone = barred && (i === 0 || flagOf(nt, '|')) && (i + 1 === notes.length || flagOf(notes[i + 1], '|'));
      if (alone && rhythmGlyph(nt[3] || 1).beats >= 2) {
        const [l, r] = barEdges(i);
        s += restGlyph((l + r) / 2, midY, gap, 4, isCur);           // whole-bar rest, centred
      } else s += restGlyph(x, midY, gap, rhythm ? nt[3] || 1 : 1, isCur);
      continue;
    }
    const visible = !mask || mask[i];
    if (!visible) {
      s += `<text x="${x}" y="${midY + 4}" text-anchor="middle" class="st-hidden">?</text>`;
      continue;
    }
    const { step } = staffPosition(nt[0], tonic);
    const y = yOf(step);
    ext(y - 5, y + 5);
    const bottom = yOf(base), topLine = yOf(base + 8);
    for (let ly = bottom + gap; ly <= y + 0.1; ly += gap) s += `<line x1="${x - 8.5}" x2="${x + 8.5}" y1="${ly}" y2="${ly}" class="st-line"/>`;
    for (let ly = topLine - gap; ly >= y - 0.1; ly -= gap) s += `<line x1="${x - 8.5}" x2="${x + 8.5}" y1="${ly}" y2="${ly}" class="st-line"/>`;
    let cls = 'st-note';
    if (hits && hits[i] != null) cls += hits[i] ? ' hit' : ' miss';   // notes not reached yet stay plain
    if (isCur) cls += ' cur';
    let hollow;
    if (rhythm) {
      const g = info[i].g;
      hollow = g.hollow;
      const bm = beam[i];
      const up = bm ? bm.up : y > midY;                 // stems down on and above the middle line
      if (g.stem) {
        const sx = up ? x + HEAD - 0.4 : x - HEAD + 0.4;
        let sy2 = bm ? bm.end : up ? Math.min(y - 3.5 * gap, Math.max(midY, y - 3.5 * gap)) : Math.max(y + 3.5 * gap, Math.min(midY, y + 3.5 * gap));
        if (!bm && up && y - 3.5 * gap > midY) sy2 = midY;      // ledger notes: reach the middle line
        if (!bm && !up && y + 3.5 * gap < midY) sy2 = midY;
        if (!bm && g.flags) sy2 += up ? -(g.flags - 1) * 3 : (g.flags - 1) * 3;
        s += `<line x1="${sx}" x2="${sx}" y1="${y}" y2="${sy2}" class="st-stem ${cls}"/>`;
        ext(sy2);
        if (!bm) for (let f = 0; f < g.flags; f++) {
          const fy = up ? sy2 + f * 6 : sy2 - f * 6;
          s += `<path d="M${sx} ${fy} q 7 ${up ? 6 : -6} 5 ${up ? 14 : -14}" class="st-flag ${cls}"/>`;
        }
      }
      if (g.dot) {
        const onLine = (step - base) % 2 === 0;
        s += `<circle cx="${x + HEAD + 4}" cy="${onLine ? y - gap / 2 : y}" r="1.6" class="${cls}"/>`;
      }
      if (g.double) s += `<line x1="${x - 8}" x2="${x - 8}" y1="${y - 5}" y2="${y + 5}" class="st-stem"/><line x1="${x + 8}" x2="${x + 8}" y1="${y - 5}" y2="${y + 5}" class="st-stem"/>`;
    } else {
      hollow = nt[2] >= 1.0;
    }
    s += `<ellipse cx="${x}" cy="${y}" rx="${HEAD}" ry="4" transform="rotate(-20 ${x} ${y})" class="${cls}${hollow ? ' held' : ''}"/>`;
    if (accs[i]) s += `<text x="${x - HEAD - 9}" y="${y + 4}" class="st-acc">${accs[i]}</text>`;
    // ties: opposite the stem, head to head (or to the line end / from the line start)
    const stemUp = beam[i] ? beam[i].up : y > midY;
    const tieY = y + (stemUp || !rhythm ? 1 : -1) * (gap * 0.75);
    const bow = (stemUp || !rhythm ? 1 : -1) * 6;
    if (flagOf(nt, '~')) {
      const x2 = i + 1 < b ? X(i + 1) - HEAD - 1 : lineEnd + 2;
      s += `<path d="M${x + HEAD + 1} ${tieY} Q ${(x + HEAD + 1 + x2) / 2} ${tieY + bow} ${x2} ${tieY}" class="st-tie"/>`;
      ext(tieY + bow);
    }
    if (i === a && a > 0 && flagOf(notes[a - 1], '~') && notes[a - 1][0] === nt[0]) {
      const x1 = o.header - 2;
      s += `<path d="M${x1} ${tieY} Q ${(x1 + x - HEAD - 1) / 2} ${tieY + bow} ${x - HEAD - 1} ${tieY}" class="st-tie"/>`;
    }
  }
  // beams: primary over the group; second beams join neighbouring sixteenths, or a stub
  for (const g of groups) {
    const th = 3.6, d = g.up ? 1 : -1;
    const poly = (x1, x2, off) => {
      const y1 = g.at(x1) + d * off, y2 = g.at(x2) + d * off;
      ext(y1, y2);
      return `<polygon points="${x1},${y1} ${x2},${y2} ${x2},${y2 + d * th} ${x1},${y1 + d * th}" class="st-beam"/>`;
    };
    s += poly(g.sx[0], g.sx[g.sx.length - 1], 0);
    for (let kk = 0; kk < g.grp.length; kk++) {
      if (g.flags[kk] < 2) continue;
      if (kk + 1 < g.grp.length && g.flags[kk + 1] >= 2) s += poly(g.sx[kk], g.sx[kk + 1], 6);
      else if (!(kk > 0 && g.flags[kk - 1] >= 2)) {
        const stub = kk + 1 < g.grp.length ? 8 : -8;
        s += poly(Math.min(g.sx[kk], g.sx[kk] + stub), Math.max(g.sx[kk], g.sx[kk] + stub), 6);
      }
    }
  }

  // --- names and lyrics, on baselines clear of the lowest notes
  const nameY = Math.max(gap * 4 + 16, maxY + 12);
  const lyrY = (names ? nameY + 15 : Math.max(gap * 4 + 18, maxY + 14));
  if (names) {
    for (let i = a; i < b; i++) {
      if (flagOf(notes[i], 'r') || (mask && !mask[i])) continue;
      const label = labels ? labels[i] : staffPosition(notes[i][0], tonic).letter + (staffPosition(notes[i][0], tonic).acc || '');
      s += `<text x="${X(i)}" y="${nameY}" text-anchor="middle" class="st-name">${esc(label)}</text>`;
    }
    maxY = Math.max(maxY, nameY);
  }
  if (hasSyl) {
    const boxes = [];
    for (let i = a; i < b; i++) {
      const syl = notes[i][4];
      if (!syl || flagOf(notes[i], 'r')) continue;
      const [l, r] = sylBox(notes, i);
      const x = X(i);
      const anchor = startsMelisma(notes, i) ? 'start' : 'middle';
      s += `<text x="${anchor === 'start' ? x - HEAD : x}" y="${lyrY}" text-anchor="${anchor}" class="st-syl">${esc(String(syl).replace(/-$/, ''))}</text>`;
      boxes.push({ i, l: x + l, r: x + r, hyphen: String(syl).endsWith('-') });
    }
    // continuing into this line from the previous one
    if (a > 0 && !notes[a][4]) {
      let p = a - 1;
      while (p > 0 && !notes[p][4]) p--;
      const firstSyl = boxes.length ? boxes[0].l : lineEnd;
      if (String(notes[p][4] || '').endsWith('-')) s += hyphens(o.header, firstSyl, lyrY);
      else {
        let last = a;
        while (last + 1 < b && notes[last + 1][4] === '' && !flagOf(notes[last + 1], 'r')) last++;
        s += `<line x1="${o.header}" x2="${X(last) + HEAD}" y1="${lyrY + 2}" y2="${lyrY + 2}" class="st-ext"/>`;
      }
    }
    boxes.forEach((bx, kk) => {
      const next = boxes[kk + 1];
      if (bx.hyphen) {
        s += hyphens(bx.r, next ? next.l : lineEnd, lyrY);
      } else {
        // extender: a word-final syllable held over more notes
        let last = bx.i;
        while (last + 1 < b && notes[last + 1][4] === '' && !flagOf(notes[last + 1], 'r')) last++;
        if (last > bx.i) {
          const x2 = X(last) + HEAD;
          if (x2 - bx.r > 6) s += `<line x1="${bx.r + 2}" x2="${x2}" y1="${lyrY + 2}" y2="${lyrY + 2}" class="st-ext"/>`;
        }
      }
    });
    maxY = Math.max(maxY, lyrY + 4);
  }

  const padTop = -minY + 6;
  const h = maxY + padTop + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" class="staff" role="img" aria-label="${esc(o.part)} notation"><g transform="translate(0 ${padTop})">${s}</g></svg>`;
}

/** Hyphens centred between two syllables; repeated over a long gap. */
function hyphens(x1, x2, y) {
  const gapW = x2 - x1;
  if (gapW < 4) return '';
  const count = gapW > 48 ? Math.min(6, Math.floor(gapW / 36)) : 1;
  let s = '';
  for (let k = 1; k <= count; k++) {
    const x = x1 + (gapW * k) / (count + 1);
    s += `<line x1="${x - 2.5}" x2="${x + 2.5}" y1="${y - 3.5}" y2="${y - 3.5}" class="st-hyph"/>`;
  }
  return s;
}

/** Simple contour (melodic shape) as an SVG polyline — used for "which did you hear?". */
export function renderContour(midis, { width = 260, height = 46, range } = {}) {
  // `range` [lo, hi] puts several contours on one scale, so they compare fairly
  const lo = (range ? range[0] : Math.min(...midis)) - 1, hi = (range ? range[1] : Math.max(...midis)) + 1;
  const span = Math.max(4, hi - lo);
  const dx = width / Math.max(1, midis.length);
  const pts = midis.map((m, i) => {
    const x = dx * i + dx / 2;
    const y = height - 6 - ((m - lo) / span) * (height - 12);
    return [x, y];
  });
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" class="contour">`;
  pts.forEach(([x, y]) => { s += `<rect x="${x - dx * 0.35}" y="${y - 3}" width="${dx * 0.7}" height="6" rx="3" class="ct-bar"/>`; });
  s += '</svg>';
  return s;
}

export { pitchClass };
