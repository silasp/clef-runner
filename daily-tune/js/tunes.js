// Tune library: expands the compact data (data/tunes.json) into the shape the
// curriculum uses — one "Melody" part per tune — and chunks each tune into
// bar-sized phrases for learning.
import { isDiatonic } from './music.js';
import { prepareTags } from './curriculum.js';

/** Where the first full bar starts (the pickup length, in beats). The data
 *  keeps no rests (they're folded into the note before) and some tunes lose
 *  a trailing rest, so "length mod bar" can mislead. Score each offset by the
 *  notes it makes cross a barline (fewest wins — notes rarely tie over in
 *  these tunes); ties go to "length mod bar", then to offsets that put more
 *  notes on downbeats. */
export function findPickup(durs, bar) {
  if (!bar) return 0;
  const total = durs.reduce((a, b) => a + b, 0);
  const naive = +(total % bar).toFixed(3);
  const step = 0.25;
  let best = naive, bestKey = null;
  for (let k = 0; k * step < bar - 1e-6; k++) {
    const off = k * step;
    let cross = 0, down = 0, t = 0;
    for (const d of durs) {
      const pos = (((t - off) % bar) + bar) % bar;
      const onBar = pos < 1e-6 || bar - pos < 1e-6;
      if (onBar) down++;
      else if (pos + d > bar + 1e-6) cross += d;
      t += d;
    }
    const key = [-cross, Math.abs(off - naive) < 1e-6 ? 1 : 0, down];
    if (!bestKey || key[0] > bestKey[0] + 1e-9 || (Math.abs(key[0] - bestKey[0]) < 1e-9 && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      bestKey = key; best = off;
    }
  }
  return +best.toFixed(3);
}

/** p: MIDI pitches, d: durations in sixteenths, bar: quarter beats per bar →
 *  notes [midi, beat, beats, beats, '', flags] with barlines ("|"). */
export function expandTune(raw) {
  const ps = raw.p.split(',').map(Number);
  const ds = raw.d.split(',').map(x => Number(x) / 4);
  const bar = raw.bar || 0;
  const pickup = findPickup(ds, bar);
  const notes = [];
  // barlines every `bar` beats from the pickup; when a note would straddle one
  // (the data drops some rests and repeat endings), the grid re-syncs to the
  // nearer edge of that note so later bars line up again
  let t = 0, nextBar = pickup > 1e-6 ? pickup : bar;
  for (let i = 0; i < ps.length; i++) {
    const n = [ps[i], +t.toFixed(3), ds[i], ds[i], ''];
    if (bar) {
      const end = t + ds[i];
      if (t > nextBar + 1e-6) nextBar += bar * Math.ceil((t - nextBar - 1e-6) / bar);
      if (t < nextBar - 1e-6 && end > nextBar + 1e-6) {
        // straddles: snap the barline to this note's start or end, whichever is nearer
        if (nextBar - t <= end - nextBar) nextBar = t; else nextBar = end;
      }
      if (i > 0 && Math.abs(t - nextBar) < 1e-6) { n.push('|'); nextBar += bar; }
      else if (i === 0 && Math.abs(nextBar) < 1e-6) nextBar += bar;
    }
    notes.push(n);
    t += ds[i];
  }
  return {
    id: String(raw.id), title: raw.title, genre: raw.genre, style: raw.style, source: raw.source,
    bar, pickup, parts: { Melody: notes },
  };
}

/**
 * Chunk a tune for learning: whole bars, sized to hold about 5–12 notes
 * (one bar of a reel, two bars of a slow air, …). Unbarred tunes fall back
 * to runs of up to 10 notes, broken after long notes.
 */
export function chunkTune(notes) {
  const starts = [0];
  notes.forEach((n, i) => { if (i > 0 && typeof n[5] === 'string' && n[5].includes('|')) starts.push(i); });
  if (starts.length < 3) {
    const out = [];
    let cur = [];
    for (const n of notes) {
      cur.push(n);
      if (cur.length >= 10 || (cur.length >= 5 && n[3] >= 2)) { out.push(cur); cur = []; }
    }
    if (cur.length) (cur.length < 3 && out.length ? out[out.length - 1].push(...cur) : out.push(cur));
    return out;
  }
  const bars = starts.map((s, k) => notes.slice(s, starts[k + 1] ?? notes.length));
  // whole bars, at least 5 notes, at most 12 (a busy bar is split into even runs of ≤10)
  const out = [];
  let cur = [];
  for (const b of bars) {
    if (b.length > 12) {
      if (cur.length) { out.push(cur); cur = []; }
      const k = Math.ceil(b.length / 10), size = Math.ceil(b.length / k);
      for (let i = 0; i < b.length; i += size) out.push(b.slice(i, i + size));
      continue;
    }
    if (cur.length && cur.length + b.length > 12) { out.push(cur); cur = []; }
    cur = cur.concat(b);
    if (cur.length >= 5) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  // a pickup bar joins the first chunk; a short tail joins the last
  if (out.length > 1 && out[0].length < 3) out.splice(0, 2, out[0].concat(out[1]));
  if (out.length > 1 && out[out.length - 1].length < 3) { const tail = out.pop(); out[out.length - 1].push(...tail); }
  return out;
}

/** Difficulty 1–10 for a whole tune: rates rather than counts (so length
 *  doesn't swamp everything) — range, leapiness, chromatic notes — plus a
 *  gentle length term, since long tunes take longer to hold. */
export function tuneDifficulty(notes, tonic) {
  const m = notes.map(n => n[0]);
  if (m.length < 2) return 1;
  const iv = m.slice(1).map((x, i) => Math.abs(x - m[i]));
  const range = Math.max(...m) - Math.min(...m);
  const meanLeap = iv.reduce((a, b) => a + b, 0) / iv.length;
  const leapRate = iv.filter(x => x >= 5).length / iv.length;
  const chromRate = m.filter(x => !isDiatonic(x, tonic)).length / m.length;
  const len = Math.max(0, Math.log2(m.length / 24));
  const raw = range * 0.12 + meanLeap * 0.45 + leapRate * 4 + chromRate * 9 + len * 1.1 - 1.4;
  return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
}

/** Raw rows (data/tunes.json) → curriculum-ready tunes: chunked, rated. */
export function prepareTunes(rows, part = 'Melody') {
  return prepareTags(rows.map(expandTune)).map(t => {
    t.phrases = { [part]: chunkTune(t.parts[part]) };
    t.difficulty = tuneDifficulty(t.parts[part], t.tonic);
    return t;
  });
}
