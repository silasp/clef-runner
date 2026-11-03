// Tiny SVG staff renderer. Pitch only (barbershop learners care about
// which note, not exact rhythm), but note length is hinted by spacing
// and a hold-bar for long notes. Returns an SVG string (no DOM needed).

import { noteName, pitchClass } from './music.js';

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

/**
 * @param {number[][]} notes  [midi, start, dur]
 * @param {object} o
 * @param {string} o.part
 * @param {number} o.tonic
 * @param {boolean[]} [o.mask]      which notes are visible (cue fading)
 * @param {boolean} [o.names]       show note names under heads
 * @param {number} [o.highlight]    index of note to highlight (current)
 * @param {boolean[]} [o.hits]      per-note correctness colouring
 * @param {number} [o.width]
 */
export function renderStaff(notes, o = {}) {
  const { part = 'Lead', tonic = 0, mask, names = false, highlight = -1, hits, width = 340, labels } = o;
  const clef = clefFor(part);
  const gap = 8; // px between staff lines
  const top = 26;
  const h = top + gap * 4 + 40;
  const left = 34;
  const usable = width - left - 12;
  const n = Math.max(1, notes.length);
  const dx = Math.min(44, usable / n);
  const x0 = left + Math.max(0, (usable - dx * n) / 2);
  const base = bottomLineStep(clef);
  const yOf = step => top + gap * 4 - (step - base) * (gap / 2);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" class="staff" role="img" aria-label="${esc(part)} notation">`;
  for (let i = 0; i < 5; i++) {
    const y = top + i * gap;
    s += `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" class="st-line"/>`;
  }
  // clef glyph (text keeps this tiny and font-independent enough)
  if (clef === 'bass') s += `<text x="6" y="${top + gap * 2.2}" class="st-clef" font-size="${gap * 4}">𝄢</text>`;
  else {
    s += `<text x="5" y="${top + gap * 3.6}" class="st-clef" font-size="${gap * 6}">𝄞</text>`;
    s += `<text x="12" y="${top + gap * 4 + 18}" class="st-small">8</text>`;
  }
  notes.forEach((nt, i) => {
    const x = x0 + dx * i + dx / 2;
    const visible = !mask || mask[i];
    if (!visible) {
      s += `<text x="${x}" y="${top + gap * 2 + 4}" text-anchor="middle" class="st-hidden">?</text>`;
      return;
    }
    const { step, acc, letter } = staffPosition(nt[0], tonic);
    const y = yOf(step);
    // ledger lines
    const bottom = yOf(base), topLine = yOf(base + 8);
    for (let ly = bottom + gap; ly <= y + 0.1; ly += gap) s += `<line x1="${x - 8}" x2="${x + 8}" y1="${ly}" y2="${ly}" class="st-line"/>`;
    for (let ly = topLine - gap; ly >= y - 0.1; ly -= gap) s += `<line x1="${x - 8}" x2="${x + 8}" y1="${ly}" y2="${ly}" class="st-line"/>`;
    let cls = 'st-note';
    if (hits) cls += hits[i] ? ' hit' : ' miss';
    if (i === highlight) cls += ' cur';
    const held = nt[2] >= 1.0;
    s += `<ellipse cx="${x}" cy="${y}" rx="5.2" ry="4" transform="rotate(-20 ${x} ${y})" class="${cls}${held ? ' held' : ''}"/>`;
    if (acc) s += `<text x="${x - 13}" y="${y + 4}" class="st-acc">${acc}</text>`;
    if (names) {
      const label = labels ? labels[i] : letter + acc;
      s += `<text x="${x}" y="${h - 6}" text-anchor="middle" class="st-name">${esc(label)}</text>`;
    }
  });
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
