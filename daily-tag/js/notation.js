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

/**
 * @param {number[][]} notes  [midi, start, dur, beats?, syllable?, flags?]  flags: "|" barline before, "~" tie to next
 * @param {object} o
 * @param {string} o.part
 * @param {number} o.tonic
 * @param {boolean[]} [o.mask]      which notes are visible (cue fading)
 * @param {boolean} [o.names]       show note names under heads
 * @param {boolean} [o.rhythm]      draw note values (stems, flags, dots) and space by length
 * @param {boolean} [o.lyrics]      draw each note's syllable (and melisma extenders)
 * @param {boolean} [o.lyricsLead]  syllable shown before the first note belongs to an earlier note (continuation)
 * @param {number} [o.highlight]    index of note to highlight (current)
 * @param {boolean[]} [o.hits]      per-note correctness colouring
 * @param {number} [o.width]
 */
export function renderStaff(notes, o = {}) {
  const { part = 'Lead', tonic = 0, mask, names = false, highlight = -1, hits, width = 340, labels, rhythm = false, lyrics = false } = o;
  const clef = clefFor(part);
  const gap = 8; // px between staff lines
  const top = 30;
  const hasSyl = lyrics && notes.some(n => n[4] != null);
  const nameY = top + gap * 4 + 28;
  const sylY = nameY + (names ? 14 : 0);
  const h = (hasSyl ? sylY : nameY) + 8;
  const sig = o.keySig === false ? { acc: '', letters: [] } : keySignature(tonic);
  const sigW = sig.letters.length ? sig.letters.length * 6.5 + 5 : 0;
  const left = 34 + sigW;
  const usable = width - left - 12;
  const n = Math.max(1, notes.length);
  // horizontal positions: uniform, or proportional to √length when showing rhythm
  const flag = (nt, f) => typeof nt[5] === 'string' && nt[5].includes(f);
  const BAR = 0.5;   // extra room taken by a barline
  const bars = notes.map((nt, i) => i > 0 && flag(nt, '|'));
  const weights = notes.map((nt, i) => (rhythm ? Math.sqrt(rhythmGlyph(nt[3] || 1).beats) + 0.35 : 1) + (bars[i] ? BAR : 0));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const unit = Math.min(44 / (rhythm ? 1.35 : 1), usable / totalW);
  const x0 = left + Math.max(0, (usable - unit * totalW) / 2);
  const xs = [], barXs = [];
  let acc0 = x0;
  weights.forEach((w, i) => {
    const pre = bars[i] ? unit * BAR : 0;
    if (bars[i]) barXs.push(acc0 + pre * 0.45);
    xs.push(acc0 + pre + (unit * (w - (bars[i] ? BAR : 0))) / 2);
    acc0 += unit * w;
  });
  const base = bottomLineStep(clef);
  const yOf = step => top + gap * 4 - (step - base) * (gap / 2);
  const midY = top + gap * 2;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" class="staff" role="img" aria-label="${esc(part)} notation">`;
  for (let i = 0; i < 5; i++) {
    const y = top + i * gap;
    s += `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" class="st-line"/>`;
  }
  if (clef === 'bass') s += `<text x="6" y="${top + gap * 2.2}" class="st-clef" font-size="${gap * 4}">𝄢</text>`;
  else {
    s += `<text x="5" y="${top + gap * 3.6}" class="st-clef" font-size="${gap * 6}">𝄞</text>`;
    s += `<text x="12" y="${top + gap * 4 + 18}" class="st-small">8</text>`;
  }
  // key signature (treble-8 is written like treble, an octave up)
  sig.letters.forEach((_, k) => {
    const w = SIG_STEPS[clef === 'bass' ? 'bass' : 'treble'][sig.acc][k] - (clef === 'treble8' ? 7 : 0);
    s += `<text x="${34 + k * 6.5}" y="${yOf(w) + 4}" class="st-acc st-sig">${sig.acc}</text>`;
  });
  for (const bx of barXs) s += `<line x1="${bx}" x2="${bx}" y1="${top}" y2="${top + gap * 4}" class="st-bar"/>`;

  // accidentals: only where a note differs from the key signature — and, when
  // the part has barlines, from earlier notes in the same bar
  const keyAcc = Object.fromEntries(sig.letters.map(L => [L, sig.acc]));
  const barred = notes.some((nt, i) => i > 0 && flag(nt, '|'));
  let barState = {};
  const accidentalFor = (i, step, letter, acc) => {
    if (bars[i]) barState = {};
    const current = barred && step in barState ? barState[step] : (keyAcc[letter] || '');
    if (barred) barState[step] = acc;
    return acc === current ? '' : (acc || '♮');
  };

  // beaming: eighths and shorter within the same beat share beams instead of flags
  const beam = new Array(notes.length).fill(null);
  const beamGroups = [];
  if (rhythm) {
    let pos = 0;
    const info = notes.map((nt, i) => {
      if (bars[i]) pos = 0;
      const g = rhythmGlyph(nt[3] || 1);
      const visible = !mask || mask[i];
      const r = { pos, g, y: null };
      if (!flag(nt, 'r') && visible) r.y = yOf(staffPosition(nt[0], tonic).step);
      pos += g.beats;
      return r;
    });
    const beamable = i => info[i].y != null && info[i].g.stem && info[i].g.flags >= 1;
    let cur = [];
    const flush = () => { if (cur.length >= 2) beamGroups.push(cur); cur = []; };
    for (let i = 0; i < notes.length; i++) {
      if (!beamable(i)) { flush(); continue; }
      const sameBeat = cur.length && !bars[i] && cur[cur.length - 1] === i - 1
        && Math.floor(info[i - 1].pos + 1e-6) === Math.floor(info[i].pos + 1e-6);
      if (!sameBeat) flush();
      cur.push(i);
    }
    flush();
    for (const grp of beamGroups) {
      const ys = grp.map(i => info[i].y);
      const up = ys.reduce((a, b) => a + b, 0) / ys.length >= midY;
      const sx = grp.map(i => (up ? xs[i] + 4.8 : xs[i] - 4.8));
      const end = k => ys[k] + (up ? -26 : 26);
      const span = Math.max(1, sx[sx.length - 1] - sx[0]);
      const slope = Math.max(-0.12, Math.min(0.12, (end(grp.length - 1) - end(0)) / span));
      let at = x => end(0) + slope * (x - sx[0]);
      // keep every stem at least 22px long
      let shift = 0;
      grp.forEach((_, k) => {
        const need = up ? at(sx[k]) - (ys[k] - 22) : (ys[k] + 22) - at(sx[k]);
        if (need > shift) shift = need;
      });
      const at2 = x => at(x) + (up ? -shift : shift);
      grp.forEach((i, k) => { beam[i] = { up, sx: sx[k], end: at2(sx[k]) }; });
      beamGroups[beamGroups.indexOf(grp)] = { grp, up, sx, at: at2, flags: grp.map(i => info[i].g.flags) };
    }
  }
  let lastSylX = null; // for melisma extenders
  notes.forEach((nt, i) => {
    const x = xs[i];
    const visible = !mask || mask[i];
    const syl = nt[4];
    if (flag(nt, 'r')) {
      s += restGlyph(x, midY, gap, rhythm ? nt[3] || 1 : 1, i === highlight);
      lastSylX = null;   // a rest ends any held syllable
      return;
    }
    if (hasSyl) {
      if (syl) {
        s += `<text x="${x}" y="${sylY}" text-anchor="middle" class="st-syl">${esc(syl.replace(/-$/, ''))}</text>`;
        if (syl.endsWith('-') && i + 1 < notes.length) s += `<text x="${(x + xs[i + 1]) / 2}" y="${sylY}" text-anchor="middle" class="st-syl">-</text>`;
        lastSylX = x;
      } else if (syl === '' && lastSylX != null) {
        // melisma: extend a line under the held syllable to this note
        s += `<line x1="${lastSylX + 6}" x2="${x + 4}" y1="${sylY + 2}" y2="${sylY + 2}" class="st-ext"/>`;
        lastSylX = x - 6;
      } else if (syl === '' && i === 0) {
        s += `<line x1="${x - 8}" x2="${x + 4}" y1="${sylY + 2}" y2="${sylY + 2}" class="st-ext"/>`;
      }
    }
    if (!visible) {
      s += `<text x="${x}" y="${midY + 4}" text-anchor="middle" class="st-hidden">?</text>`;
      return;
    }
    const { step, acc: spelled, letter } = staffPosition(nt[0], tonic);
    const acc = accidentalFor(i, step, letter, spelled);
    const y = yOf(step);
    const bottom = yOf(base), topLine = yOf(base + 8);
    for (let ly = bottom + gap; ly <= y + 0.1; ly += gap) s += `<line x1="${x - 8}" x2="${x + 8}" y1="${ly}" y2="${ly}" class="st-line"/>`;
    for (let ly = topLine - gap; ly >= y - 0.1; ly -= gap) s += `<line x1="${x - 8}" x2="${x + 8}" y1="${ly}" y2="${ly}" class="st-line"/>`;
    let cls = 'st-note';
    if (hits) cls += hits[i] ? ' hit' : ' miss';
    if (i === highlight) cls += ' cur';
    let hollow;
    if (rhythm) {
      const g = rhythmGlyph(nt[3] || 1);
      hollow = g.hollow;
      const bm = beam[i];
      const up = bm ? bm.up : y >= midY; // stems up for low notes
      if (g.stem) {
        const sx = up ? x + 4.8 : x - 4.8;
        const sy2 = bm ? bm.end : up ? y - 26 : y + 26;
        s += `<line x1="${sx}" x2="${sx}" y1="${y}" y2="${sy2}" class="st-stem ${cls}"/>`;
        if (!bm) for (let f = 0; f < g.flags; f++) {
          const fy = up ? sy2 + f * 6 : sy2 - f * 6;
          s += `<path d="M${sx} ${fy} q 7 ${up ? 6 : -6} 5 ${up ? 14 : -14}" class="st-flag ${cls}"/>`;
        }
      }
      if (g.dot) s += `<circle cx="${x + 9}" cy="${y - ((step - base) % 2 === 0 ? 2 : 0)}" r="1.6" class="${cls}"/>`;
      if (g.double) s += `<line x1="${x - 8}" x2="${x - 8}" y1="${y - 5}" y2="${y + 5}" class="st-stem"/><line x1="${x + 8}" x2="${x + 8}" y1="${y - 5}" y2="${y + 5}" class="st-stem"/>`;
    } else {
      hollow = nt[2] >= 1.0;
    }
    s += `<ellipse cx="${x}" cy="${y}" rx="5.2" ry="4" transform="rotate(-20 ${x} ${y})" class="${cls}${hollow ? ' held' : ''}"/>`;
    if (flag(nt, '~')) {
      // tie: a curve under the heads (over them for high notes) to the next note, or off the edge
      const x2 = i + 1 < notes.length ? xs[i + 1] - 4 : width - 6;
      const below = y >= midY;   // opposite the stem
      const yy = y + (below ? 6 : -6), bow = below ? 7 : -7;
      s += `<path d="M${x + 4} ${yy} Q ${(x + 4 + x2) / 2} ${yy + bow} ${x2} ${yy}" class="st-tie"/>`;
    }
    if (acc) s += `<text x="${x - 13}" y="${y + 4}" class="st-acc">${acc}</text>`;
    if (names) {
      const label = labels ? labels[i] : letter + acc;
      s += `<text x="${x}" y="${nameY}" text-anchor="middle" class="st-name">${esc(label)}</text>`;
    }
  });
  // beams: a primary beam over the group; second beams join neighbouring
  // sixteenths, or a short stub for a lone sixteenth
  for (const b of beamGroups) {
    const th = 3.6, d = b.up ? 1 : -1;
    const poly = (x1, x2, off) => {
      const y1 = b.at(x1) + d * off, y2 = b.at(x2) + d * off;
      return `<polygon points="${x1},${y1} ${x2},${y2} ${x2},${y2 + d * th} ${x1},${y1 + d * th}" class="st-beam"/>`;
    };
    s += poly(b.sx[0], b.sx[b.sx.length - 1], 0);
    for (let k = 0; k < b.grp.length; k++) {
      if (b.flags[k] < 2) continue;
      if (k + 1 < b.grp.length && b.flags[k + 1] >= 2) s += poly(b.sx[k], b.sx[k + 1], 6);
      else if (!(k > 0 && b.flags[k - 1] >= 2)) {
        const stub = k + 1 < b.grp.length ? 8 : -8;
        s += poly(Math.min(b.sx[k], b.sx[k] + stub), Math.max(b.sx[k], b.sx[k] + stub), 6);
      }
    }
  }
  s += '</svg>';
  return s;
}

/** Simple contour (melodic shape) as an SVG polyline — used for "which did you hear?". */
export function renderContour(midis, { width = 260, height = 46 } = {}) {
  const lo = Math.min(...midis) - 1, hi = Math.max(...midis) + 1;
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
