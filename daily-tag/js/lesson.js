// Lesson builder: picks ~6–8 short exercises mixing reviews (spaced
// repetition) with one new chunk, respecting "can't listen / can't sing".

import { cardId, itemNotes, nextNewItem, phraseLyrics, learnedParts } from './curriculum.js';
import { dueCards } from './srs.js';

export const EXERCISE_TYPES = {
  intro: { listen: false, sing: false, label: 'New phrase' },
  guided: { listen: false, sing: false, label: 'Tap along' },
  listenChoose: { listen: true, sing: false, label: 'Which one did you hear?' },
  chordFind: { listen: true, sing: false, label: 'Find your note in the chord' },
  nextNote: { listen: false, sing: false, label: 'What comes next?' },
  lyricGap: { listen: false, sing: false, label: 'Fill in the words' },
  tap: { listen: false, sing: false, label: 'Tap it from memory' },
  sing: { listen: false, sing: true, label: 'Sing it' },
  switch: { listen: false, sing: false, label: 'Switch parts!' },
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
    plan.push('listenChoose', 'nextNote', 'tap', 'chordFind', 'sing', 'lyricGap', 'tap');
    for (const type of plan) {
      if (!allowed(type, caps)) continue;
      if (type === 'lyricGap' && !lyricFor(item.tag, item.part, item.phrase)) continue;
      ex.push({ type, ...base });
    }
    // the final "tap" in the new-item block is the memory test: fade cues more
    let tapCount = 0;
    for (const e of ex) if (e.type === 'tap') e.cueBoost = tapCount++;
  }

  // 1b) "Switch parts!": once 2+ parts of the current tag are learned, quiz a
  //     random *other* learned part — knowing every voice is the goal.
  if (item) {
    const others = learnedParts(item.tag, cards).filter(p => p !== item.part);
    if (others.length) {
      const part = others[Math.floor(rng() * others.length)];
      const n = item.tag.phrases[part].length;
      const phrase = rng() < 0.35 ? 'all' : Math.floor(rng() * n);
      ex.push({ type: 'switch', tagId: String(item.tag.id), part, phrase, cardId: cardId(item.tag.id, part, phrase), review: true });
    }
  }

  // 2) reviews of due cards (interleaved), cap so lessons stay ~3 minutes
  const due = dueCards(cards, today).filter(c => !item || c.id !== cardId(item.tag.id, item.part, item.phrase));
  const reviewTypes = ['sing', 'tap', 'chordFind', 'nextNote', 'listenChoose'].filter(t => allowed(t, caps));
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

export function lyricFor(tag, part, phrase) {
  if (phrase === 'all') return (tag.lyrics || '').trim();
  return phraseLyrics(tag.lyrics, tag.phrases[part], phrase);
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

/** "Which did you hear?": the real phrase plus 2 plausible mutations. */
export function listenChooseQuestion(notes, rng) {
  const m = notes.map(n => n[0]);
  const variants = [m];
  let guard = 0;
  while (variants.length < 3 && guard++ < 50) {
    const v = m.slice();
    const k = Math.floor(rng() * v.length);
    const delta = [1, -1, 2, -2, 3, -3][Math.floor(rng() * 6)];
    v[k] += delta;
    if (rng() < 0.5 && v.length > 2) {
      const k2 = (k + 1 + Math.floor(rng() * (v.length - 1))) % v.length;
      v[k2] += [2, -2, 1][Math.floor(rng() * 3)];
    }
    if (!variants.some(x => x.join() === v.join())) variants.push(v);
  }
  const order = variants.map((v, i) => ({ v, correct: i === 0 }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { options: order.map(o => o.v), answerIndex: order.findIndex(o => o.correct) };
}

/** Lyric gap-fill: blank one word, 3 options. */
export function lyricGapQuestion(text, rng, pool = []) {
  const words = text.split(/\s+/).filter(Boolean);
  const clean = w => w.replace(/[^A-Za-z']/g, '');
  const candidates = words.map((w, i) => i).filter(i => clean(words[i]).length >= 3);
  if (!candidates.length) return null;
  const idx = candidates[Math.floor(rng() * candidates.length)];
  const answer = clean(words[idx]);
  const opts = new Set([answer.toLowerCase()]);
  const others = pool.map(clean).filter(w => w.length >= 3);
  let guard = 0;
  while (opts.size < 3 && guard++ < 100 && others.length) {
    opts.add(others[Math.floor(rng() * others.length)].toLowerCase());
  }
  const options = [...opts];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { before: words.slice(0, idx).join(' '), after: words.slice(idx + 1).join(' '), answer: answer.toLowerCase(), options };
}

/** For chord-find: pick a moment in the phrase and the sounding notes of all parts. */
export function chordAt(tag, part, notes, rng) {
  const target = notes[Math.floor(rng() * notes.length)];
  const t = target[1] + target[2] / 2;
  const chord = {};
  for (const p of Object.keys(tag.parts)) {
    const n = tag.parts[p].find(x => x[1] <= t && x[1] + x[2] >= t);
    if (n) chord[p] = n[0];
  }
  chord[part] = target[0];
  return { time: t, chord, answer: target[0] };
}

export { itemNotes };
