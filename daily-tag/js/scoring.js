// Assessment of sung / tapped answers. Pitch matters, rhythm does not:
// we compare the *sequence* of pitches using a DTW-style alignment, so
// singing a note long or short is never penalised.

/**
 * Turn a stream of pitch frames into discrete sung notes.
 * @param {{t:number, midi:number|null}[]} frames  (t in seconds)
 * @param {object} [o]
 * @returns {{midi:number, start:number, dur:number}[]}
 */
export function framesToNotes(frames, o = {}) {
  const { minDur = 0.12, mergeGap = 0.08 } = o;
  // median-smooth over 5 frames
  const sm = frames.map((f, i) => {
    if (f.midi == null) return null;
    const win = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(frames.length - 1, i + 2); j++) {
      if (frames[j].midi != null) win.push(frames[j].midi);
    }
    win.sort((a, b) => a - b);
    return win[Math.floor(win.length / 2)];
  });
  const runs = [];
  let cur = null;
  for (let i = 0; i < frames.length; i++) {
    const v = sm[i];
    const t = frames[i].t;
    if (v == null) { if (cur) { runs.push(cur); cur = null; } continue; }
    const r = Math.round(v);
    if (cur && r === cur.midi) { cur.end = t; cur.sum += v; cur.n++; continue; }
    if (cur) runs.push(cur);
    cur = { midi: r, start: t, end: t, sum: v, n: 1 };
  }
  if (cur) runs.push(cur);
  // frame spacing estimate
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 0.04;
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.midi === r.midi && r.start - last.end <= mergeGap + dt) {
      last.end = r.end; last.sum += r.sum; last.n += r.n;
    } else merged.push({ ...r });
  }
  const notes = merged
    .map(r => ({ midi: r.midi, start: r.start, dur: r.end - r.start + dt, cents: Math.round((r.sum / r.n - r.midi) * 100) }))
    .filter(n => n.dur >= minDur);
  // re-merge identical neighbours left behind after dropping blips
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && last.midi === n.midi && n.start - (last.start + last.dur) < 0.25) {
      last.dur = n.start + n.dur - last.start;
    } else out.push({ ...n });
  }
  return out;
}

/**
 * Align a sung pitch sequence to a target sequence.
 * Consecutive repeated target notes may be sung as one sustained note,
 * so we compare against the target with repeats collapsed.
 * @param {number[]} sung    midi numbers
 * @param {number[]} target  midi numbers
 * @param {object} [o]
 * @param {boolean} [o.octaveFree=true] allow singing the line in another octave
 * @returns {{score:number, hits:boolean[], shift:number}}
 *   score in [0,1]; hits[i] says whether target note i was matched.
 */
export function alignPitches(sung, target, o = {}) {
  const { octaveFree = true } = o;
  if (!target.length) return { score: 1, hits: [], shift: 0 };
  if (!sung.length) return { score: 0, hits: target.map(() => false), shift: 0 };
  // collapse repeats in target, remember mapping
  const col = [], map = [];
  for (let i = 0; i < target.length; i++) {
    if (i > 0 && target[i] === target[i - 1]) { map.push(col.length - 1); continue; }
    col.push(target[i]); map.push(col.length - 1);
  }
  const shifts = octaveFree ? [-24, -12, 0, 12, 24] : [0];
  let best = null;
  for (const sh of shifts) {
    const r = dtw(sung.map(x => x + sh), col);
    // small preference for no shift so ties resolve sensibly
    const cost = r.cost + Math.abs(sh) * 0.001;
    if (!best || cost < best.cost) best = { ...r, cost, shift: sh };
  }
  const hits = map.map(ci => best.colHits[ci]);
  const recall = hits.filter(Boolean).length / hits.length;
  // wrong extra notes (not scoops/repeats of right ones) cost a little
  const score = recall * (0.6 + 0.4 * Math.min(1, best.precision * 1.25));
  return { score: Math.round(score * 1000) / 1000, hits, shift: best.shift, recall, precision: best.precision };
}

// Edit-distance style alignment: match cost by semitone error, gaps cost 1.
function dtw(a, b) {
  const n = a.length, m = b.length;
  const INF = 1e9;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const B = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) { D[i][0] = i * 0.6; B[i][0] = 1; }
  for (let j = 1; j <= m; j++) { D[0][j] = j; B[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      // 0 exact, 0.7 a semitone off, else 1.2 — cheaper than skipping both notes,
      // so a transposed attempt aligns note-for-note instead of cherry-picking overlaps
      const d = Math.abs(a[i - 1] - b[j - 1]);
      const c = d === 0 ? 0 : d === 1 ? 0.7 : 1.2;
      const diag = D[i - 1][j - 1] + c;
      const up = D[i - 1][j] + 0.6;   // extra sung note
      const left = D[i][j - 1] + 1;   // missed target note
      if (diag <= up && diag <= left) { D[i][j] = diag; B[i][j] = 0; }
      else if (up <= left) { D[i][j] = up; B[i][j] = 1; }
      else { D[i][j] = left; B[i][j] = 2; }
    }
  }
  const colHits = new Array(m).fill(false);
  let matchedSung = 0;
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const bt = B[i][j];
    if (i > 0 && j > 0 && bt === 0) {
      if (Math.abs(a[i - 1] - b[j - 1]) === 0) { colHits[j - 1] = true; matchedSung++; }
      i--; j--;
    } else if (i > 0 && (bt === 1 || j === 0)) i--;
    else j--;
  }
  return { cost: D[n][m], colHits, precision: n ? matchedSung / n : 0 };
}

// ---------- lyrics (speech recognition) ----------

export function normaliseWords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Fraction of expected words that appear (fuzzily, in order) in what was heard. */
export function lyricMatch(expected, heard) {
  const e = normaliseWords(expected), h = normaliseWords(heard);
  if (!e.length) return 1;
  if (!h.length) return 0;
  let found = 0, from = 0;
  for (const w of e) {
    for (let k = from; k < h.length; k++) {
      const tol = w.length <= 3 ? 0 : 1 + (w.length > 6 ? 1 : 0);
      if (levenshtein(w, h[k]) <= tol) { found++; from = k + 1; break; }
    }
  }
  return found / e.length;
}

/** Combine pitch and (optional) lyric accuracy into one 0..1 grade. */
export function combineScores(pitch, lyrics) {
  if (lyrics == null) return pitch;
  return Math.min(1, pitch * 0.8 + lyrics * 0.2);
}

/** Grade a tapped answer sequence (keyboard), exact or octave-free. */
export function gradeTaps(taps, target, { octaveFree = false } = {}) {
  let correct = 0;
  for (let i = 0; i < target.length; i++) {
    const t = taps[i];
    if (t == null) continue;
    if (t === target[i] || (octaveFree && (t - target[i]) % 12 === 0)) correct++;
  }
  return target.length ? correct / target.length : 1;
}
