// Human corrections to the tag library.
//
// A correction replaces one part's notes (and/or marks it checked) or
// hides a whole tag. Corrections live in data/corrections.json in the
// repo (applied on top of the generated tags.json, so they survive
// rebuilds) and in localStorage until they reach the repo.
//
// Shape:  { "<tagId>": { ts, hide?, comment?, parts: { "<Part>": { ok?, notes? } } } }
// Notes:  [midi, start, dur, beats|null, syllable, flags?] — as in tags.json.
//         flags: "|" = barline before this note, "~" = tied to the next note,
//                "r" = a rest (keeps its pitch so it can turn back into a note).

export const REPO = 'silas-dsc/daily-tag';
export const MARKER = 'daily-tag-corrections';
const LOCAL_KEY = 'daily-tag:corrections';
const URL_LIMIT = 7600;          // GitHub rejects much longer prefilled issue URLs

// ------------------------------------------------------------ note edits (pure)
const r2 = x => Math.round(x * 100) / 100;
const clone = notes => notes.map(n => [...n]);

export function transpose(notes, i, semis) {
  const out = clone(notes);
  out[i][0] = Math.max(24, Math.min(96, out[i][0] + semis));
  return out;
}

export const hasFlag = (n, f) => typeof n[5] === 'string' && n[5].includes(f);

function withFlag(n, f, on) {
  const cur = (typeof n[5] === 'string' ? n[5] : '').replace(f, '');
  const next = on ? cur + f : cur;
  const out = n.slice(0, 5);
  while (out.length < 5) out.push(out.length === 3 ? null : '');
  if (next) out.push(['|', '~', 'r'].filter(c => next.includes(c)).join(''));
  return out;
}

export const isRest = n => hasFlag(n, 'r');

/** Turn note i into a rest, or a rest back into a note. A rest has no
 *  syllable and no ties. Never leaves fewer than two sung notes. */
export function toggleRest(notes, i) {
  const out = clone(notes);
  if (isRest(out[i])) { out[i] = withFlag(out[i], 'r', false); return out; }
  if (out.filter(n => !isRest(n)).length <= 2) return out;
  out[i] = withFlag(withFlag(out[i], 'r', true), '~', false);
  out[i][4] = '';
  if (i > 0) out[i - 1] = withFlag(out[i - 1], '~', false);
  return out;
}

/** Set note i's pitch; a rest given a pitch becomes a note again. */
export function setPitch(notes, i, midi) {
  const out = clone(notes);
  out[i][0] = Math.max(24, Math.min(96, midi));
  if (isRest(out[i])) out[i] = withFlag(out[i], 'r', false);
  return out;
}

/** The notes that are sung (rests removed). A rest's barline moves to the next note. */
export function stripRests(notes) {
  const out = [];
  let bar = false;
  for (const n of notes) {
    if (isRest(n)) { bar = bar || hasFlag(n, '|'); continue; }
    out.push(bar && out.length ? withFlag([...n], '|', true) : n);
    bar = false;
  }
  return out;
}

/**
 * For notation: put the written part's rests back among some sung notes
 * (a phrase). Rests from just before the first note's end to just after
 * the last note's end are included. Returns { notes, map } where map[k] is
 * the sung-note index of display item k, or -1 for a rest.
 */
export function withRests(sung, written) {
  if (!sung.length || !written || !written.some(isRest)) return { notes: sung, map: sung.map((_, i) => i) };
  const t0 = sung[0][1], last = sung[sung.length - 1], t1 = last[1] + last[2] + 0.05;
  const rests = written.filter(n => isRest(n) && n[1] > t0 && n[1] <= t1);
  if (!rests.length) return { notes: sung, map: sung.map((_, i) => i) };
  const items = [...sung.map((n, i) => ({ n, i })), ...rests.map(n => ({ n, i: -1 }))]
    .sort((a, b) => a.n[1] - b.n[1] || (a.i === -1 ? -1 : 1));
  // a rest's barline was moved onto the next sung note by stripRests: show it on the rest only
  for (let k = 1; k < items.length; k++) {
    if (items[k - 1].i === -1 && hasFlag(items[k - 1].n, '|') && items[k].i !== -1 && hasFlag(items[k].n, '|')) {
      items[k] = { ...items[k], n: withFlag([...items[k].n], '|', false) };
    }
  }
  return { notes: items.map(x => x.n), map: items.map(x => x.i) };
}

/**
 * Make part notes the same as another part's: the whole part, or only the
 * notes starting in [t0, t1) (a phrase). shift moves the copy in semitones
 * (±12 for an octave). Returns the new notes, ordered by time.
 */
export function copyPart(target, source, { shift = 0, t0 = null, t1 = null } = {}) {
  const inWin = n => t0 == null || (n[1] >= t0 - 0.01 && n[1] < t1 - 0.01);
  const copied = source.filter(inWin).map(n => {
    const c = [...n];
    if (!isRest(c)) c[0] = Math.max(24, Math.min(96, c[0] + shift));
    return c;
  });
  if (t0 == null) return copied;
  const kept = target.filter(n => !inWin(n)).map(n => [...n]);
  return [...kept, ...copied].sort((a, b) => a[1] - b[1]);
}

/** Note i continues a tie from note i-1 (same pitch, not re-sung). */
export function tiedFromPrev(notes, i) {
  return i > 0 && hasFlag(notes[i - 1], '~') && notes[i - 1][0] === notes[i][0];
}

/** Split note i into two equal notes of the same pitch (repeated notes). */
export function splitNote(notes, i) {
  const out = clone(notes);
  const [m, s, d, b, syl] = out[i];
  const half = d / 2;
  const bh = b == null ? null : Math.max(0.25, Math.round(b / 2 * 4) / 4);
  const a = withFlag(withFlag([m, r2(s), r2(half), bh, syl || ''], '|', hasFlag(out[i], '|')), '~', false);
  const z = withFlag([m, r2(s + half), r2(d - half), bh, ''], '~', hasFlag(out[i], '~'));
  out.splice(i, 1, a, z);
  return out;
}

const spb = notes => {
  const r = notes.filter(n => n[3] > 0 && n[2] > 0).map(n => n[2] / n[3]).sort((a, b) => a - b);
  return r.length ? r[r.length >> 1] : 0.5;
};

/** Set note i's written length in beats (quarter = 1). Its sounding length
 *  follows, at the part's tempo, up to the next note's start. */
export function setBeats(notes, i, beats) {
  const out = clone(notes);
  const n = out[i];
  const want = beats * spb(notes);
  const room = i + 1 < out.length ? out[i + 1][1] - n[1] : Infinity;
  n[3] = beats;
  n[2] = r2(Math.max(0.1, Math.min(want, room)));
  return out;
}

/** Toggle a barline before note i, or a tie from note i to the next. */
export function toggleFlag(notes, i, f) {
  const out = clone(notes);
  if (f === '~' && (isRest(out[i]) || (out[i + 1] && isRest(out[i + 1])))) return out;
  out[i] = withFlag(out[i], f, !hasFlag(out[i], f));
  if (f === '~' && hasFlag(out[i], '~') && out[i + 1]) out[i + 1][4] = '';   // a tied note isn't re-sung
  return out;
}

/** Barlines every `perBar` beats, the first one before note `from`
 *  (the first downbeat). Replaces barlines from `from` onwards. */
export function autoBars(notes, from, perBar = 4) {
  let out = clone(notes).map((n, k) => (k >= from ? withFlag(n, '|', false) : n));
  let beat = 0, nextBar = 0;
  for (let k = from; k < out.length; k++) {
    if (beat >= nextBar - 0.01) {
      if (k > 0) out[k] = withFlag(out[k], '|', true);
      while (nextBar <= beat + 0.01) nextBar += perBar;
    }
    beat += out[k][3] || 1;
  }
  return out;
}

/** Merge note i with the next one (keeps i's pitch and syllable). */
export function mergeNext(notes, i) {
  if (i >= notes.length - 1) return clone(notes);
  const out = clone(notes);
  const a = out[i], b = out[i + 1];
  a[2] = r2(b[1] + b[2] - a[1]);
  a[3] = a[3] == null || b[3] == null ? a[3] : a[3] + b[3];
  out[i] = withFlag(a, '~', hasFlag(b, '~'));
  out.splice(i + 1, 1);
  return out;
}

export function deleteNote(notes, i) {
  if (notes.length <= 1) return clone(notes);
  const out = clone(notes);
  const gone = out.splice(i, 1)[0];
  if (i > 0) out[i - 1][2] = r2(gone[1] + gone[2] - out[i - 1][1]);   // previous note absorbs the time
  return out;
}

export function setSyllable(notes, i, syl) {
  const out = clone(notes);
  out[i][4] = String(syl || '').trim();
  return out;
}

/**
 * Lay lyric text over notes [from, to): one token per note.
 *   "honk honk beep"   → one word per note
 *   "lo-ving"          → "lo-" then "ving" on consecutive notes
 *   "_"                → the previous syllable is held on this note (melisma)
 * Notes beyond the tokens are held on the last syllable.
 */
export function layLyrics(notes, text, from = 0, to = notes.length) {
  const tokens = [];
  for (const w of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    if (/^_+$/.test(w)) { tokens.push(''); continue; }
    const parts = w.split('-').filter(Boolean);
    parts.forEach((p, k) => tokens.push(k < parts.length - 1 || w.endsWith('-') ? p + '-' : p));
  }
  const out = clone(notes);
  let k = 0;
  for (let i = from; i < to; i++) {
    if (isRest(out[i])) { out[i][4] = ''; continue; }   // rests carry no words
    out[i][4] = k < tokens.length ? tokens[k] : '';
    k++;
  }
  return out;
}

/** The lyric text of notes [from, to) in layLyrics' syntax (round-trips). */
export function lyricText(notes, from = 0, to = notes.length) {
  const toks = [];
  let held = 0;
  for (let i = from; i < to; i++) {
    if (isRest(notes[i])) continue;
    const s = notes[i][4] || '';
    if (!s) { held++; continue; }
    if (held) toks.push(...Array(held).fill('_'));
    held = 0;
    const prev = toks[toks.length - 1];
    if (prev && prev.endsWith('-')) toks[toks.length - 1] = prev + s;
    else toks.push(s);
  }
  return toks.join(' ');
}

export function sameNotes(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ------------------------------------------------------------ store
export function emptyStore() { return {}; }

/** Record an edit/check for one part. notes = null when only marking checked. */
export function recordPart(store, tagId, part, { notes = null, ok = true, now = Date.now() } = {}) {
  const e = store[tagId] || (store[tagId] = { parts: {} });
  e.parts = e.parts || {};
  const p = e.parts[part] || (e.parts[part] = {});
  if (notes) p.notes = notes.map(n => [n[0], r2(n[1]), r2(n[2]), n[3] == null ? null : n[3], n[4] || '', ...(n[5] ? [n[5]] : [])]);
  p.ok = ok;
  e.ts = now;
  delete e.submitted;
  return store;
}

export function recordHide(store, tagId, { hide = true, comment = '', now = Date.now() } = {}) {
  const e = store[tagId] || (store[tagId] = { parts: {} });
  e.hide = hide;
  if (comment) e.comment = comment;
  e.ts = now;
  delete e.submitted;
  return store;
}

export function forget(store, tagId, part = null) {
  if (!store[tagId]) return store;
  if (part) {
    delete store[tagId].parts[part];
    if (!Object.keys(store[tagId].parts).length && !store[tagId].hide) delete store[tagId];
  } else delete store[tagId];
  return store;
}

/** Entries not yet in the repo (newer than the repo's copy), not yet submitted. */
export function pending(local, remote, { includeSubmitted = false } = {}) {
  return Object.keys(local).filter(id => {
    const e = local[id];
    if (!includeSubmitted && e.submitted) return false;
    return !remote[id] || (remote[id].ts || 0) < (e.ts || 0);
  });
}

/** Merge: local entries win when newer than the repo's. */
export function mergeStores(remote, local) {
  const out = JSON.parse(JSON.stringify(remote || {}));
  for (const [id, e] of Object.entries(local || {})) {
    if (!out[id] || (out[id].ts || 0) < (e.ts || 0)) out[id] = JSON.parse(JSON.stringify(e));
  }
  return out;
}

/** Drop local entries that the repo now has (same or newer). */
export function pruneLocal(local, remote) {
  for (const id of Object.keys(local)) if (remote[id] && (remote[id].ts || 0) >= (local[id].ts || 0)) delete local[id];
  return local;
}

/** Apply corrections to raw tags (before prepareTags). Hidden tags are removed. */
export function applyCorrections(rawTags, store) {
  const out = [];
  for (const t of rawTags) {
    const e = store && store[String(t.id)];
    if (!e) { out.push(t); continue; }
    if (e.hide) continue;
    const parts = { ...t.parts };
    const written = { ...t.parts };     // with rests, for notation and the review screen
    const checked = {};
    for (const [p, c] of Object.entries(e.parts || {})) {
      if (c.notes && c.notes.length && stripRests(c.notes).length >= 2) { written[p] = c.notes; parts[p] = stripRests(c.notes); }
      if (c.ok) checked[p] = true;
    }
    out.push({ ...t, parts, written, checked, corrected: Object.values(e.parts || {}).some(c => c.notes) });
  }
  return out;
}

export function loadLocal(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(LOCAL_KEY)) || {}; } catch (e) { return {}; }
}

export function saveLocal(store, storage = globalThis.localStorage) {
  try { storage.setItem(LOCAL_KEY, JSON.stringify(store)); return true; } catch (e) { return false; }
}

// ------------------------------------------------------------ submission (GitHub issue)
function summaryLine(id, e, original) {
  const t = original[id];
  const name = t ? `${t.title} (#${id})` : `#${id}`;
  if (e.hide) return `- ${name}: 🚩 hide this tag${e.comment ? ` — ${e.comment}` : ''}`;
  const bits = Object.entries(e.parts || {}).map(([p, c]) => {
    if (!c.notes) return `${p} ✓ checked`;
    const before = t && t.parts[p] ? t.parts[p] : [];
    const words = ns => ns.map(n => n[4]).filter(Boolean).join(' ');
    let s = `${p} ✎ ${before.length}→${c.notes.length} notes`;
    if (words(before) !== words(c.notes)) s += `, lyrics “${words(c.notes)}”`;
    return s;
  });
  return `- ${name}: ${bits.join('; ')}${e.comment ? ` — ${e.comment}` : ''}`;
}

/**
 * Build the issue for a set of entries. Returns { title, body, url, fits }.
 * `original` maps id → the uncorrected raw tag (for the human summary).
 */
export function buildSubmission(store, ids, original = {}, repo = REPO) {
  const payload = Object.fromEntries(ids.map(id => [id, store[id]]));
  const n = ids.length;
  const title = `Tag corrections: ${ids.slice(0, 3).map(id => (original[id] && original[id].title) || '#' + id).join(', ')}${n > 3 ? ` +${n - 3}` : ''}`;
  const body = [
    'Corrections from the Daily Tag review screen. The `apply-corrections` workflow merges the JSON below into `data/corrections.json`.',
    '',
    ...ids.map(id => summaryLine(id, store[id], original)),
    '',
    `<!-- ${MARKER} -->`,
    '```json',
    JSON.stringify(payload),
    '```',
  ].join('\n');
  const base = `https://github.com/${repo}/issues/new`;
  const url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return { title, body, url, fits: url.length <= URL_LIMIT, shortUrl: `${base}?title=${encodeURIComponent(title)}` };
}

/** Parse the JSON block out of an issue body (used by the GitHub workflow). */
export function parseSubmission(body) {
  const i = String(body || '').indexOf(MARKER);
  if (i < 0) throw new Error('No corrections marker');
  const m = body.slice(i).match(/```json\s*([\s\S]*?)```/);
  if (!m) throw new Error('No JSON block');
  return validate(JSON.parse(m[1]));
}

const PARTS = ['Tenor', 'Lead', 'Bari', 'Bass'];

/** Validate and normalise a payload; throws on anything malformed. */
export function validate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Payload must be an object');
  const out = {};
  for (const [id, e] of Object.entries(payload)) {
    if (!/^\d{1,7}$/.test(id)) throw new Error(`Bad tag id ${id}`);
    if (!e || typeof e !== 'object') throw new Error(`Bad entry ${id}`);
    const v = { ts: Number(e.ts) || Date.now(), parts: {} };
    if (e.hide) v.hide = true;
    if (e.comment) v.comment = String(e.comment).slice(0, 500);
    for (const [p, c] of Object.entries(e.parts || {})) {
      if (!PARTS.includes(p)) throw new Error(`Bad part ${p}`);
      const pc = { ok: !!c.ok };
      if (c.notes != null) {
        if (!Array.isArray(c.notes) || !c.notes.length || c.notes.length > 400) throw new Error(`Bad notes for ${id} ${p}`);
        pc.notes = c.notes.map(n => {
          if (!Array.isArray(n) || n.length < 3) throw new Error(`Bad note in ${id} ${p}`);
          const [m, s, d, b, syl, fl] = n;
          if (!Number.isInteger(m) || m < 24 || m > 96 || !(s >= 0) || !(d > 0)) throw new Error(`Bad note values in ${id} ${p}`);
          if (b != null && !(Number(b) > 0 && Number(b) <= 16)) throw new Error(`Bad note length in ${id} ${p}`);
          if (fl != null && fl !== '' && !/^\|?~?r?$/.test(fl)) throw new Error(`Bad note flags in ${id} ${p}`);
          const v = [m, r2(s), r2(d), b == null ? null : Number(b), String(syl || '').slice(0, 40)];
          return fl ? [...v, fl] : v;
        });
      }
      v.parts[p] = pc;
    }
    out[id] = v;
  }
  return out;
}
