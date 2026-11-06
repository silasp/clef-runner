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
      if (type === 'lyricGap' && !hasLyricGap(lyricFor(item.tag, item.part, item.phrase))) continue;
      if (type === 'chordFind' && chordSize(item.tag, item.part, itemNotes(item.tag, item.part, item.phrase)) < 3) continue;
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
    let pick = c.level >= 2 && allowed('sing', caps) && rng() < 0.6 ? 'sing'
      : rng() < 0.65 ? 'tap' : reviewTypes[Math.floor(rng() * reviewTypes.length)];
    if (pick === 'chordFind' && chordSize(byId[tagId], part, itemNotes(byId[tagId], part, phrase)) < 3) pick = 'tap';
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

/** Words a part sings in a phrase: from per-note syllables when the tag has
 *  timed lyrics, else a proportional slice of the lyric text. */
export function sungWords(notes, lyrics = '') {
  // syllables → words; a trailing "-" joins the next syllable
  const words = [];
  let join = false;
  for (const n of notes) {
    const s = n[4];
    if (!s) continue;
    const syl = s.endsWith('-') ? s.slice(0, -1) : s;
    if (join && words.length) words[words.length - 1] += syl; else words.push(syl);
    join = s.endsWith('-');
  }
  return mendWords(words, lyrics).join(' ');
}

const bare = w => w.toLowerCase().replace(/[^a-z']/g, '');

/** Repair words split oddly by a score's lyric syllables, using the tag's own
 *  lyric line as the dictionary: "Ta" + "g" → "Tag", "Taag" → "Tag" (a held
 *  vowel spelled out), "Ta" + "ag" → "Tag". Only merges into a word the
 *  lyrics contain, so real pairs ("to old") are never glued together. */
export function mendWords(words, lyrics = '') {
  const vocab = new Set((lyrics || '').split(/\s+/).map(bare).filter(Boolean));
  if (!vocab.size) return words;
  const known = w => vocab.has(bare(w));
  const undouble = w => w.replace(/([aeiou])\1/gi, '$1');
  const fix = w => (known(w) || !known(undouble(w)) ? w : undouble(w));
  const ws = words.map(fix), out = [];
  for (let i = 0; i < ws.length; i++) {
    // longest run of 2–4 unknown pieces that spells a lyric word
    let done = false;
    for (let k = Math.min(4, ws.length - i); k >= 2 && !done; k--) {
      const run = ws.slice(i, i + k);
      if (run.some(known)) continue;
      const glued = [run.join(''), undouble(run.join(''))].find(known);
      if (glued) { out.push(glued); i += k - 1; done = true; }
    }
    if (!done) out.push(ws[i]);
  }
  return out;
}

export function lyricFor(tag, part, phrase) {
  const notes = phrase === 'all' ? tag.parts[part] : tag.phrases[part][phrase];
  const sung = notes ? sungWords(notes, tag.lyrics) : '';
  if (sung) return sung;
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

/** Whether a gap-fill question can be made (a word of 3+ letters to blank). */
export function hasLyricGap(text) {
  return !!text && text.split(/\s+/).some(w => w.replace(/[^A-Za-z']/g, '').length >= 3);
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

/** Sounding notes of every part at time t (rests and silences left out). */
function soundingAt(tag, t) {
  const chord = {};
  for (const p of Object.keys(tag.parts)) {
    const n = tag.parts[p].find(x => x[1] <= t && x[1] + x[2] >= t && !(typeof x[5] === 'string' && x[5].includes('r')));
    if (n) chord[p] = n[0];
  }
  return chord;
}

/** The most parts sounding together at any note of the phrase (1 = a solo line). */
export function chordSize(tag, part, notes) {
  let best = 0;
  for (const n of notes || []) best = Math.max(best, Object.keys({ ...soundingAt(tag, n[1] + n[2] / 2), [part]: 1 }).length);
  return best;
}

/** For chord-find: pick a moment in the phrase where the most parts sound
 *  together (a pickup the part sings alone is no chord to find a note in),
 *  and the sounding notes of all parts. With rng = () => 0 it's the first
 *  such moment. */
export function chordAt(tag, part, notes, rng) {
  const sized = notes.map(n => {
    const t = n[1] + n[2] / 2;
    const chord = { ...soundingAt(tag, t), [part]: n[0] };
    return { n, t, chord, size: Object.keys(chord).length };
  });
  const most = Math.max(...sized.map(x => x.size));
  const pool = sized.filter(x => x.size === most);
  const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  return { time: pick.t, chord: pick.chord, answer: pick.n[0] };
}

export { itemNotes };
