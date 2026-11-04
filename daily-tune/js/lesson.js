// Lesson builder: picks ~6–8 short exercises mixing reviews (spaced
// repetition) with one new chunk, respecting "can't listen / can't sing".

import { cardId, itemNotes, nextNewItem } from './curriculum.js';
import { dueCards } from './srs.js';

export const EXERCISE_TYPES = {
  intro: { listen: false, sing: false, label: 'New phrase' },
  guided: { listen: false, sing: false, label: 'Tap along' },
  listenChoose: { listen: true, sing: false, label: 'Which one did you hear?' },
  nextNote: { listen: false, sing: false, label: 'What comes next?' },
  tap: { listen: false, sing: false, label: 'Tap it from memory' },
  sing: { listen: false, sing: true, label: 'Sing it' },
};

export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function allowed(type, { canListen = true, canSing = true } = {}) {
  const t = EXERCISE_TYPES[type];
  if (!t) return false;
  if (t.listen && !canListen) return false;
  if (t.sing && !canSing) return false;
  return true;
}

function parseId(id) {
  const [tagId, part, ph] = id.split(':');
  return { tagId, part, phrase: ph === 'all' ? 'all' : Number(ph) };
}

/**
 * Build a lesson.
 * @param {object} ctx
 * @param {object[]} ctx.tags
 * @param {object} ctx.cards
 * @param {number} ctx.today
 * @param {string} ctx.myPart
 * @param {string} [ctx.mode]
 * @param {boolean} ctx.canListen
 * @param {boolean} ctx.canSing
 * @param {number} [ctx.seed]
 * @param {'melody'|'mine'} [ctx.order]  order of parts within a tag
 * @param {{tagId:string, part:string}} [ctx.focus]  learn a specific tag/part
 * @returns {{exercises: object[], newItem: object|null}}
 */
export function buildLesson(ctx) {
  const { tags, cards, today, myPart, mode, order, canListen, canSing, seed = today, focus } = ctx;
  const rng = makeRng(seed);
  const byId = Object.fromEntries(tags.map(t => [String(t.id), t]));
  const caps = { canListen, canSing };
  const ex = [];

  // 1) one new chunk (forward-chained)
  let item;
  if (focus) {
    const t = byId[String(focus.tagId)];
    // only that part: put it first and stop at the first item that belongs to it
    item = t ? nextNewItem([t], cards, focus.part, 'tag-by-tag', 'mine') : null;
    if (t && (!item || item.part !== focus.part)) item = { tag: t, part: focus.part, phrase: 'all' };
  } else {
    item = nextNewItem(tags, cards, myPart, mode, order);
  }
  if (item) {
    const id = cardId(item.tag.id, item.part, item.phrase);
    const card = cards[id];
    const level = card ? card.level : 0;
    const base = { tagId: String(item.tag.id), part: item.part, phrase: item.phrase, cardId: id };
    const plan = [];
    if (!card || card.reps === 0) plan.push('intro', 'guided');
    else if (level < 2) plan.push('guided');
    plan.push('listenChoose', 'nextNote', 'tap', 'sing', 'tap');
    for (const type of plan) {
      if (!allowed(type, caps)) continue;
      ex.push({ type, ...base });
    }
    // the final "tap" in the new-item block is the memory test: fade cues more
    let tapCount = 0;
    for (const e of ex) if (e.type === 'tap') e.cueBoost = tapCount++;
  }

  // 2) reviews of due cards (interleaved), cap so lessons stay ~3 minutes
  const due = dueCards(cards, today).filter(c => !item || c.id !== cardId(item.tag.id, item.part, item.phrase));
  const reviewTypes = ['sing', 'tap', 'nextNote', 'listenChoose'].filter(t => allowed(t, caps));
  const maxReviews = item ? 3 : 7;
  for (const c of due.slice(0, maxReviews)) {
    const { tagId, part, phrase } = parseId(c.id);
    if (!byId[tagId]) continue;
    // strongest test the situation allows: sing if possible, else recall by tapping
    const pick = c.level >= 2 && allowed('sing', caps) && rng() < 0.6 ? 'sing'
      : rng() < 0.65 ? 'tap' : reviewTypes[Math.floor(rng() * reviewTypes.length)];
    ex.push({ type: pick, tagId, part, phrase, cardId: c.id, review: true });
  }

  // interleave: keep intro/guided first, shuffle the rest lightly
  const head = ex.filter(e => e.type === 'intro' || e.type === 'guided');
  const tail = ex.filter(e => e.type !== 'intro' && e.type !== 'guided');
  const newOnes = tail.filter(e => !e.review), revs = tail.filter(e => e.review);
  const mixed = [];
  while (newOnes.length || revs.length) {
    if (newOnes.length) mixed.push(newOnes.shift());
    if (revs.length && rng() < 0.7) mixed.push(revs.shift());
  }
  return { exercises: head.concat(mixed).slice(0, 10), newItem: item };
}

/** Multiple-choice "next note": hide one note, offer 4 options. */
export function nextNoteQuestion(notes, rng) {
  const m = notes.map(n => n[0]);
  if (m.length < 2) return null;
  const idx = 1 + Math.floor(rng() * (m.length - 1));
  const answer = m[idx];
  const opts = new Set([answer]);
  const cands = [answer + 1, answer - 1, answer + 2, answer - 2, answer + 3, answer - 3, answer + 4, answer - 5, answer + 5];
  // prefer distractors that also appear in the phrase (plausible)
  const inPhrase = [...new Set(m.filter(x => x !== answer))];
  for (const c of inPhrase.concat(cands)) {
    if (opts.size >= 4) break;
    opts.add(c);
  }
  const options = [...opts];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { shown: m.slice(0, idx), answer, options, index: idx };
}

/** Up/down/same pattern of a line — what a contour shows. */
export function shapeOf(m) {
  return m.slice(1).map((x, i) => Math.sign(x - m[i])).join('');
}

/** "Which did you hear?": the real phrase plus 2 mutations whose up/down
 *  shape differs from the real one and from each other (so they look
 *  different, not just slightly shifted). */
export function listenChooseQuestion(notes, rng) {
  const m = notes.map(n => n[0]);
  const variants = [m];
  const shapes = new Set([shapeOf(m)]);
  const mutate = () => {
    const v = m.slice();
    const k = Math.floor(rng() * v.length);
    v[k] += [2, -2, 3, -3, 4, -4, 5, -5][Math.floor(rng() * 8)];
    if (rng() < 0.5 && v.length > 2) {
      const k2 = (k + 1 + Math.floor(rng() * (v.length - 1))) % v.length;
      v[k2] += [2, -2, 3, -3][Math.floor(rng() * 4)];
    }
    return v;
  };
  for (let guard = 0; variants.length < 3 && guard < 200; guard++) {
    const v = mutate();
    const sh = shapeOf(v);
    // prefer a new shape; after many tries accept any distinct line
    if (shapes.has(sh) && guard < 150) continue;
    if (variants.some(x => x.join() === v.join())) continue;
    variants.push(v); shapes.add(sh);
  }
  const order = variants.map((v, i) => ({ v, correct: i === 0 }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const all = variants.flat();
  return { options: order.map(o => o.v), answerIndex: order.findIndex(o => o.correct), range: [Math.min(...all), Math.max(...all)] };
}

export { itemNotes };
