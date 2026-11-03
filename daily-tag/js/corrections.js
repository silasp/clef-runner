// Human corrections to the tag library.
//
// A correction replaces one part's notes (and/or marks it checked) or
// hides a whole tag. Corrections live in data/corrections.json in the
// repo (applied on top of the generated tags.json, so they survive
// rebuilds) and in localStorage until they reach the repo.
//
// Shape:  { "<tagId>": { ts, hide?, comment?, parts: { "<Part>": { ok?, notes? } } } }
// Notes:  [midi, start, dur, beats|null, syllable]  — as in tags.json.

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

/** Split note i into two equal notes of the same pitch (repeated notes). */
export function splitNote(notes, i) {
  const out = clone(notes);
  const [m, s, d, b, syl] = out[i];
  const half = d / 2;
  const bh = b == null ? null : Math.max(0.25, Math.round(b / 2 * 4) / 4);
  out.splice(i, 1, [m, r2(s), r2(half), bh, syl || ''], [m, r2(s + half), r2(d - half), bh, '']);
  return out;
}

/** Merge note i with the next one (keeps i's pitch and syllable). */
export function mergeNext(notes, i) {
  if (i >= notes.length - 1) return clone(notes);
  const out = clone(notes);
  const a = out[i], b = out[i + 1];
  a[2] = r2(b[1] + b[2] - a[1]);
  a[3] = a[3] == null || b[3] == null ? a[3] : a[3] + b[3];
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
  for (let i = from, k = 0; i < to; i++, k++) out[i][4] = k < tokens.length ? tokens[k] : '';
  return out;
}

/** The lyric text of notes [from, to) in layLyrics' syntax (round-trips). */
export function lyricText(notes, from = 0, to = notes.length) {
  const toks = [];
  let held = 0;
  for (let i = from; i < to; i++) {
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
  if (notes) p.notes = notes.map(n => [n[0], r2(n[1]), r2(n[2]), n[3] == null ? null : n[3], n[4] || '']);
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
    const checked = {};
    for (const [p, c] of Object.entries(e.parts || {})) {
      if (c.notes && c.notes.length) parts[p] = c.notes;
      if (c.ok) checked[p] = true;
    }
    out.push({ ...t, parts, checked, corrected: Object.values(e.parts || {}).some(c => c.notes) });
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
          const [m, s, d, b, syl] = n;
          if (!Number.isInteger(m) || m < 24 || m > 96 || !(s >= 0) || !(d > 0)) throw new Error(`Bad note values in ${id} ${p}`);
          return [m, r2(s), r2(d), b == null ? null : Number(b), String(syl || '').slice(0, 40)];
        });
      }
      v.parts[p] = pc;
    }
    out[id] = v;
  }
  return out;
}
