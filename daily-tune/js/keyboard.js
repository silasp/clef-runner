// Touch piano keyboard sized for small phones. Pure layout helper is
// exported separately so it can be unit-tested.

import { isBlackKey, noteName, isDiatonic } from './music.js';

/** White/black key layout between lo..hi (inclusive), widened to white keys. */
export function keyLayout(lo, hi) {
  let a = Math.floor(lo), b = Math.ceil(hi);
  if (isBlackKey(a)) a--;
  if (isBlackKey(b)) b++;
  const whites = [], blacks = [];
  let wi = 0;
  for (let m = a; m <= b; m++) {
    if (isBlackKey(m)) blacks.push({ midi: m, after: wi - 1 });
    else whites.push({ midi: m, index: wi++ });
  }
  return { lo: a, hi: b, whites, blacks };
}

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]);   // F B♭ E♭ A♭ D♭ majors

/**
 * Computer-keyboard note entry. A letter A–G gives that note as the key
 * signature has it (F in G major is F♯); Shift raises it a semitone,
 * Alt/Option lowers it. Octave doesn't matter when typing: if the pitch
 * class is the one expected, the expected note is returned; otherwise the
 * nearest such note to the previous one (within lo..hi when possible).
 * @returns {number|null} midi, or null if the key isn't a note letter
 */
export function typedNote(letter, { shift = false, alt = false } = {}, { tonic = 0, target = null, last = null, lo = 48, hi = 84 } = {}) {
  const L = String(letter || '').toUpperCase();
  if (!(L in LETTER_PC)) return null;
  let pc = LETTER_PC[L];
  if (!isDiatonic(pc, tonic)) pc += FLAT_KEYS.has(((tonic % 12) + 12) % 12) ? -1 : 1;
  if (shift) pc += 1;
  if (alt) pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  if (target != null && ((target % 12) + 12) % 12 === pc) return target;
  const ref = last != null ? last : target != null ? target : Math.round((lo + hi) / 2);
  let best = null;
  for (let m = ref - 12; m <= ref + 12; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue;
    if (best == null || (inRange(m) && !inRange(best)) || (inRange(m) === inRange(best) && Math.abs(m - ref) < Math.abs(best - ref))) best = m;
  }
  return best;
  function inRange(m) { return m >= lo && m <= hi; }
}

/** True on a device with a mouse/trackpad (where a computer keyboard is likely). */
export function hasKeyboard() {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Choose a range that covers the notes with a little context. */
export function rangeFor(midis, minWhite = 10) {
  let lo = Math.min(...midis) - 2, hi = Math.max(...midis) + 2;
  while (keyLayout(lo, hi).whites.length < minWhite) { lo--; if (keyLayout(lo, hi).whites.length < minWhite) hi++; }
  return [lo, hi];
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {number} o.lo
 * @param {number} o.hi
 * @param {number} [o.tonic]
 * @param {boolean} [o.labels]
 * @param {(midi:number)=>void} o.onKey
 * @param {boolean} [o.typing]   also take notes typed on a computer keyboard
 * @param {()=>number|null} [o.target]  the note expected next (typing is octave-free)
 * @param {Object<string,()=>void>} [o.keys]  extra shortcuts while mounted, e.g. {h: hint, ' ': pipe}
 */
export function mountKeyboard(host, o) {
  const { whites, blacks } = keyLayout(o.lo, o.hi);
  const el = document.createElement('div');
  el.className = 'kb';
  el.dataset.tonic = o.tonic || 0;
  const ww = 100 / whites.length;
  const minPx = 26;
  el.style.minWidth = (whites.length * minPx) + 'px';
  const keys = new Map();
  for (const w of whites) {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'kw';
    k.style.left = (w.index * ww) + '%';
    k.style.width = ww + '%';
    k.dataset.midi = w.midi;
    if (o.labels) k.innerHTML = `<span>${noteName(w.midi, o.tonic || 0, false)}</span>`;
    else if (w.midi % 12 === 0) k.innerHTML = `<span class="c">C${Math.floor(w.midi / 12) - 1}</span>`;
    keys.set(w.midi, k);
    el.appendChild(k);
  }
  for (const b of blacks) {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'kb-black';
    k.style.left = ((b.after + 1) * ww - ww * 0.32) + '%';
    k.style.width = (ww * 0.64) + '%';
    k.dataset.midi = b.midi;
    keys.set(b.midi, k);
    el.appendChild(k);
  }
  const press = e => {
    const t = e.target.closest('button');
    if (!t) return;
    e.preventDefault();
    last = Number(t.dataset.midi);
    o.onKey(last);
  };
  el.addEventListener('pointerdown', press);
  let last = null;
  if (o.typing && typeof document !== 'undefined') {
    const onType = e => {
      if (!el.isConnected) { document.removeEventListener('keydown', onType); return; }
      if (e.metaKey || e.ctrlKey || e.repeat) return;
      if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
      // e.code survives Option on a Mac (which turns letters into symbols)
      const letter = /^Key[A-G]$/.test(e.code || '') ? e.code[3] : (e.key || '').length === 1 ? e.key : '';
      const extra = o.keys && (o.keys[(e.key || '').toLowerCase()] || (e.code === 'Space' && o.keys[' ']));
      const m = typedNote(letter, { shift: e.shiftKey, alt: e.altKey }, { tonic: o.tonic || 0, target: o.target ? o.target() : null, last, lo: o.lo, hi: o.hi });
      if (m != null) { e.preventDefault(); last = m; o.onKey(m); }
      else if (extra && !e.shiftKey && !e.altKey) { e.preventDefault(); extra(); }
    };
    document.addEventListener('keydown', onType);
  }
  const wrap = document.createElement('div');
  wrap.className = 'kb-wrap';
  wrap.appendChild(el);
  host.appendChild(wrap);

  return {
    el,
    flash(midi, cls) {
      const k = keys.get(midi); if (!k) return;
      k.classList.add(cls);
      setTimeout(() => k.classList.remove(cls), 380);
    },
    hint(midi) {
      for (const k of keys.values()) k.classList.remove('hint');
      const k = keys.get(midi);
      if (k) { k.classList.add('hint'); k.scrollIntoView && k.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    },
    clearHint() { for (const k of keys.values()) k.classList.remove('hint'); },
    /** Light one key (e.g. the note being sung now) without scrolling; null clears. */
    light(midi) {
      for (const k of keys.values()) k.classList.remove('live');
      const k = midi == null ? null : keys.get(midi);
      if (k) k.classList.add('live');
    },
  };
}
