// Touch piano keyboard sized for small phones. Pure layout helper is
// exported separately so it can be unit-tested.

import { isBlackKey, noteName } from './music.js';

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
 */
export function mountKeyboard(host, o) {
  const { whites, blacks } = keyLayout(o.lo, o.hi);
  const el = document.createElement('div');
  el.className = 'kb';
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
    o.onKey(Number(t.dataset.midi));
  };
  el.addEventListener('pointerdown', press);
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
  };
}
