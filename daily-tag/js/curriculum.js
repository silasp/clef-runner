// Chunking + ordering: turns tags into bite-sized phrases and decides
// what to learn next (easy tags first, forward-chaining phrases).

import { PARTS, detectKey, partDifficulty, parseWrittenKey } from './music.js';
import { isMemorised, newCard } from './srs.js';

/**
 * Split one part's notes ([midi, start, dur]) into phrases.
 * Boundaries fall on rests or after long held notes; phrases hold
 * roughly 3–9 notes so each is a 20–40 second learning chunk.
 */
export function splitPhrases(notes, { minNotes = 3, maxNotes = 9 } = {}) {
  if (!notes.length) return [];
  const groups = [[notes[0]]];
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1], n = notes[i];
    const gap = n[1] - (prev[1] + prev[2]);
    const cur = groups[groups.length - 1];
    const boundary = (gap >= 0.3 || prev[2] >= 1.3) && cur.length >= minNotes;
    if (boundary || cur.length >= maxNotes) groups.push([n]);
    else cur.push(n);
  }
  // fold a too-short tail into the previous phrase
  if (groups.length > 1 && groups[groups.length - 1].length < minNotes) {
    const tail = groups.pop();
    groups[groups.length - 1].push(...tail);
  }
  return groups;
}

/** Slice the tag's lyrics proportionally to a phrase's position in time. */
export function phraseLyrics(lyrics, phrases, idx) {
  const words = (lyrics || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || !phrases.length) return '';
  const start = phrases[0][0][1];
  const lastP = phrases[phrases.length - 1];
  const lastN = lastP[lastP.length - 1];
  const end = lastN[1] + lastN[2];
  const span = Math.max(0.001, end - start);
  const p = phrases[idx];
  const a = (p[0][1] - start) / span;
  const pl = p[p.length - 1];
  const b = (pl[1] + pl[2] - start) / span;
  const i0 = Math.floor(a * words.length);
  const i1 = Math.max(i0 + 1, Math.round(b * words.length));
  return words.slice(i0, i1).join(' ');
}

export function cardId(tagId, part, phrase) {
  return `${tagId}:${part}:${phrase}`;
}

/** Parts in the learner's preferred order (their own part first). */
export function partOrder(myPart) {
  if (!PARTS.includes(myPart)) return PARTS.slice();
  return [myPart, ...PARTS.filter(p => p !== myPart)];
}

/**
 * Curriculum mode:
 *  - 'my-part-first' (default): learn your own part in every tag (easy → hard),
 *    then circle back for the other parts.
 *  - 'tag-by-tag': learn all four parts of a tag before moving on.
 */
export function learningQueue(tags, myPart, mode = 'my-part-first') {
  const order = partOrder(myPart);
  const sorted = tags.slice().sort((a, b) => a.difficulty - b.difficulty);
  const q = [];
  if (mode === 'tag-by-tag') {
    for (const t of sorted) for (const p of order) q.push({ tag: t, part: p });
  } else {
    for (const p of order) for (const t of sorted) q.push({ tag: t, part: p });
  }
  return q;
}

/** Status of one tag/part: how many phrases are introduced/memorised. */
export function partStatus(tag, part, cards) {
  const n = tag.phrases[part].length;
  let introduced = 0, memorised = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[cardId(tag.id, part, i)];
    if (c && c.reps > 0) introduced++;
    if (isMemorised(c)) memorised++;
  }
  const whole = cards[cardId(tag.id, part, 'all')];
  return {
    phrases: n, introduced, memorised,
    wholeMemorised: isMemorised(whole),
    done: isMemorised(whole),
  };
}

/**
 * The next new thing to learn. Forward chaining: introduce phrase k only
 * once phrases < k have reached level ≥ 2; when every phrase is at level
 * ≥ 2, the whole-part chain becomes the item.
 * @returns {{tag, part, phrase: number|'all'}|null}
 */
export function nextNewItem(tags, cards, myPart, mode) {
  for (const { tag, part } of learningQueue(tags, myPart, mode)) {
    const n = tag.phrases[part].length;
    const whole = cards[cardId(tag.id, part, 'all')];
    if (isMemorised(whole)) continue;
    let ready = true;
    for (let i = 0; i < n; i++) {
      const c = cards[cardId(tag.id, part, i)];
      if (!c || c.reps === 0) return { tag, part, phrase: i };
      if (c.level < 2) { ready = false; return { tag, part, phrase: i }; }
    }
    if (ready && (!whole || whole.reps === 0 || whole.level < 4)) return { tag, part, phrase: 'all' };
  }
  return null;
}

export function ensureCard(cards, id) {
  if (!cards[id]) cards[id] = newCard(id);
  return cards[id];
}

/** Notes for an item (a phrase or the whole part). */
export function itemNotes(tag, part, phrase) {
  if (phrase === 'all') return tag.parts[part];
  return tag.phrases[part][phrase];
}

/**
 * Enrich raw tag data (from data/tags.json) with tonic, phrases and a
 * difficulty score. Done at load time so the data file stays small.
 */
export function prepareTags(raw) {
  return raw.map(t => {
    const all = PARTS.flatMap(p => t.parts[p] || []);
    const bass = t.parts.Bass || [];
    const key = detectKey(all, bass.length ? bass[bass.length - 1][0] : null, parseWrittenKey(t.writtenKey));
    // `tonic` is the major key used for spelling / scale degrees (relative major for minor tags)
    const tonic = typeof t.tonic === 'number' ? t.tonic : key.spell;
    const phrases = {};
    const diff = {};
    for (const p of PARTS) {
      const notes = t.parts[p] || [];
      phrases[p] = splitPhrases(notes);
      diff[p] = partDifficulty(notes, tonic);
    }
    const difficulty = Math.round(PARTS.reduce((a, p) => a + diff[p], 0) / PARTS.length * 10) / 10;
    return { ...t, id: String(t.id), tonic, key, phrases, partDifficulty: diff, difficulty };
  });
}
