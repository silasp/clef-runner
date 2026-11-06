// Chunking + ordering: turns tags into bite-sized phrases and decides
// what to learn next (easy tags first, forward-chaining phrases).

import { PARTS, detectKey, partDifficulty, parseWrittenKey } from './music.js';
import { isMemorised, newCard, LEARNED_LEVEL, INTERVAL_DAYS } from './srs.js';

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
    const tied = typeof prev[5] === 'string' && prev[5].includes('~');   // never split a tied note
    const boundary = !tied && (gap >= 0.3 || prev[2] >= 1.3) && cur.length >= minNotes;
    if (!tied && (boundary || cur.length >= maxNotes)) groups.push([n]);
    else cur.push(n);
  }
  // fold a too-short tail into the previous phrase
  if (groups.length > 1 && groups[groups.length - 1].length < minNotes) {
    const tail = groups.pop();
    groups[groups.length - 1].push(...tail);
  }
  return groups;
}

export function cardId(tagId, part, phrase) {
  return `${tagId}:${part}:${phrase}`;
}

/** Melody first, then the foundation, then the harmony parts. */
export const MELODY_FIRST = PARTS.slice();

/**
 * Order in which to learn the parts of a tag.
 * @param {string} myPart
 * @param {'melody'|'mine'} [order='mine']  'melody' = Lead → Bass → Tenor → Bari;
 *   'mine' = the learner's own part first, then melody order.
 */
export function partOrder(myPart, order = 'mine') {
  if (order === 'melody' || !PARTS.includes(myPart)) return MELODY_FIRST.slice();
  return [myPart, ...MELODY_FIRST.filter(p => p !== myPart)];
}

/**
 * Curriculum mode:
 *  - 'tag-by-tag' (default): learn all four parts of a tag, one after the
 *    other, before moving on to the next (easy → hard) tag.
 *  - 'my-part-first': learn your own part in every tag first, then circle
 *    back for the other parts.
 */
export function learningQueue(tags, myPart, mode = 'tag-by-tag', order = 'mine') {
  const parts = partOrder(myPart, order);
  const sorted = tags.slice().sort((a, b) => a.difficulty - b.difficulty);
  const q = [];
  if (mode === 'tag-by-tag') {
    for (const t of sorted) for (const p of parts) q.push({ tag: t, part: p });
  } else {
    for (const p of parts) for (const t of sorted) q.push({ tag: t, part: p });
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
    learned: !!whole && whole.level >= LEARNED_LEVEL,
    wholeMemorised: isMemorised(whole),
    done: isMemorised(whole),
  };
}

/**
 * The next new thing to learn. Forward chaining: introduce phrase k only
 * once phrases < k have reached level ≥ 2; when every phrase is at level
 * ≥ 2, the whole-part chain becomes the item. A part counts as done for
 * *learning* once the whole part can be recalled (level ≥ 2) — after that
 * spaced reviews take it to long-term memory while the next part starts.
 * @returns {{tag, part, phrase: number|'all'}|null}
 */
export function nextNewItem(tags, cards, myPart, mode, order) {
  for (const { tag, part } of learningQueue(tags, myPart, mode, order)) {
    const n = tag.phrases[part].length;
    const whole = cards[cardId(tag.id, part, 'all')];
    if (whole && whole.level >= LEARNED_LEVEL) continue;
    for (let i = 0; i < n; i++) {
      const c = cards[cardId(tag.id, part, i)];
      if (!c || c.reps === 0 || c.level < LEARNED_LEVEL) return { tag, part, phrase: i };
    }
    return { tag, part, phrase: 'all' };
  }
  return null;
}

/** Tag-level progress: how many of the four parts are learned / memorised. */
export function tagStatus(tag, cards) {
  const st = PARTS.map(p => partStatus(tag, p, cards));
  return {
    learnedParts: st.filter(s => s.learned).length,
    memorisedParts: st.filter(s => s.done).length,
    started: st.some(s => s.introduced > 0),
  };
}

/** Parts of a tag that are learned well enough to quiz by surprise. */
export function learnedParts(tag, cards) {
  return PARTS.filter(p => partStatus(tag, p, cards).learned);
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

/**
 * "I already know this": skip the chunk-by-chunk lessons and put the whole
 * part straight into spaced review as recalled (level 2), due in a couple
 * of days. A good review takes it on towards memorised; a failed one drops
 * it below "learned", and learning resumes from the first chunk.
 */
export function markKnown(cards, tagId, part, today) {
  const id = cardId(tagId, part, 'all');
  const c = cards[id] || newCard(id);
  cards[id] = { ...c, level: Math.max(c.level, LEARNED_LEVEL), reps: Math.max(1, c.reps), last: today,
    due: today + INTERVAL_DAYS[LEARNED_LEVEL], known: true };
  return cards[id];
}

/** Undo markKnown — only while that review hasn't happened yet. */
export function unmarkKnown(cards, tagId, part) {
  const id = cardId(tagId, part, 'all');
  const c = cards[id];
  if (!c || !c.known || c.reps > 1) return false;
  delete cards[id];
  return true;
}

/** Whether the part was skipped as already known (and not yet reviewed). */
export function isKnownSkip(cards, tagId, part) {
  const c = cards[cardId(tagId, part, 'all')];
  return !!c && !!c.known && c.reps <= 1;
}
