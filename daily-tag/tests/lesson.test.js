import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLesson, allowed, nextNoteQuestion, listenChooseQuestion, shapeOf, lyricGapQuestion, chordAt, makeRng, EXERCISE_TYPES, sungWords, lyricFor } from '../js/lesson.js';
import { prepareTags, cardId } from '../js/curriculum.js';
import { newCard } from '../js/srs.js';
import { fakeTag } from './fixtures.js';

const tags = prepareTags([fakeTag(1), fakeTag(2, 62, 10)]);

test('a fresh lesson introduces a new phrase first', () => {
  const { exercises, newItem } = buildLesson({ tags, cards: {}, today: 10, myPart: 'Lead', canListen: true, canSing: true });
  assert.ok(newItem);
  assert.equal(exercises[0].type, 'intro');
  assert.equal(exercises[1].type, 'guided');
  assert.ok(exercises.some(e => e.type === 'sing'));
  assert.ok(exercises.length >= 5 && exercises.length <= 10);
});

test("can't listen / can't sing removes those exercise types", () => {
  const { exercises } = buildLesson({ tags, cards: {}, today: 10, myPart: 'Lead', canListen: false, canSing: false });
  for (const e of exercises) {
    assert.ok(!EXERCISE_TYPES[e.type].listen, e.type);
    assert.ok(!EXERCISE_TYPES[e.type].sing, e.type);
  }
  assert.ok(exercises.some(e => e.type === 'tap'));
  assert.ok(!allowed('sing', { canListen: true, canSing: false }));
  assert.ok(!allowed('chordFind', { canListen: false, canSing: true }));
  assert.ok(allowed('tap', { canListen: false, canSing: false }));
});

test('due reviews are mixed in', () => {
  const id = cardId('2', 'Lead', 0);
  const cards = { [id]: { ...newCard(id), reps: 3, level: 2, due: 9 } };
  const { exercises } = buildLesson({ tags, cards, today: 10, myPart: 'Lead', canListen: true, canSing: false });
  assert.ok(exercises.some(e => e.review && e.cardId === id));
});

test('"Switch parts!" quizzes another learned part of the same tag', () => {
  const t = tags.find(x => x.id === '1');
  const cards = {};
  for (const p of ['Lead', 'Bass']) {
    t.phrases[p].forEach((_, i) => { cards[cardId('1', p, i)] = { ...newCard(cardId('1', p, i)), reps: 2, level: 2, due: 99 }; });
    cards[cardId('1', p, 'all')] = { ...newCard(cardId('1', p, 'all')), reps: 2, level: 2, due: 99 };
  }
  const { exercises, newItem } = buildLesson({ tags: [t], cards, today: 10, myPart: 'Lead', order: 'melody', canListen: false, canSing: false });
  assert.equal(newItem.part, 'Tenor');
  const sw = exercises.find(e => e.type === 'switch');
  assert.ok(sw, 'has a switch exercise');
  assert.ok(['Lead', 'Bass'].includes(sw.part));
});

test('focus mode teaches the requested tag/part', () => {
  const { newItem } = buildLesson({ tags, cards: {}, today: 10, myPart: 'Lead', canListen: true, canSing: true, focus: { tagId: '2', part: 'Bass' } });
  assert.equal(newItem.tag.id, '2');
  assert.equal(newItem.part, 'Bass');
});

test('question generators', () => {
  const rng = makeRng(5);
  const notes = tags[0].parts.Lead;
  const nn = nextNoteQuestion(notes, rng);
  assert.equal(nn.options.length, 4);
  assert.ok(nn.options.includes(nn.answer));
  assert.equal(new Set(nn.options).size, 4);
  const lc = listenChooseQuestion(notes, rng);
  assert.equal(lc.options.length, 3);
  assert.deepEqual(lc.options[lc.answerIndex], notes.map(n => n[0]));
  const lg = lyricGapQuestion('there I go lost in your eyes', rng, ['moon', 'June', 'spoon', 'harmony']);
  assert.ok(lg.options.includes(lg.answer));
  assert.equal(lyricGapQuestion('a b', rng), null);
  const ch = chordAt(tags[0], 'Lead', notes, rng);
  assert.equal(Object.keys(ch.chord).length, 4);
  assert.equal(ch.chord.Lead, ch.answer);
});

test('rng is deterministic', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('phrase words come from per-note syllables when available', () => {
  const notes = [[60, 0, .5, .5, 'And'], [62, .5, .5, .5, 'lo-'], [64, 1, .5, .5, 'ving'], [65, 1.5, .5, .5, ''], [67, 2, 1, 2, 'you']];
  assert.equal(sungWords(notes), 'And loving you');
  assert.equal(sungWords([[60, 0, 1]]), '');
  const t = { ...tags[0], parts: { ...tags[0].parts, Lead: notes }, phrases: { ...tags[0].phrases, Lead: [notes] } };
  assert.equal(lyricFor(t, 'Lead', 0), 'And loving you');
  assert.equal(lyricFor(t, 'Lead', 'all'), 'And loving you');
});

test('listen-and-choose options all have different shapes, on one scale', () => {
  const notes = [67, 65, 62, 60, 60, 62, 64, 62, 64].map((m, i) => [m, i * 0.5, 0.5]);
  for (let seed = 1; seed < 200; seed++) {
    const q = listenChooseQuestion(notes, makeRng(seed));
    assert.equal(new Set(q.options.map(shapeOf)).size, 3, `seed ${seed}`);
    const all = q.options.flat();
    assert.deepEqual(q.range, [Math.min(...all), Math.max(...all)]);
  }
});

test('split syllables are mended using the tag\'s own lyrics', async () => {
  const { mendWords, hasLyricGap } = await import('../js/lesson.js');
  const lyr = 'Do You Want to Sing a Tag?';
  const syl = arr => arr.map((s, i) => [60, i, 1, 1, s]);
  assert.equal(sungWords(syl(['A', 'Ta', '', 'g']), lyr), 'A Tag');
  assert.equal(sungWords(syl(['a', 'Ta-', 'ag']), lyr), 'a Tag');
  assert.equal(sungWords(syl(['sing', 'a', 'Ta', 'ag']), lyr), 'sing a Tag');
  assert.equal(sungWords(syl(['beau-', 'ti-', 'ful', 'life']), 'beautiful life'), 'beautiful life');
  assert.deepEqual(mendWords(['beau', 'ti', 'ful'], 'my beautiful friends'), ['beautiful']);
  assert.deepEqual(mendWords(['to', 'old'], 'I told you to get old'), ['to', 'old'], 'real words are never glued');
  assert.deepEqual(mendWords(['Ta', 'g'], ''), ['Ta', 'g'], 'no lyrics, no guessing');
  assert.ok(!hasLyricGap('A Ta g'));
  assert.ok(hasLyricGap('A Tag'));
});

test('no gap-fill is planned when there is no word to blank', () => {
  const t = prepareTags([fakeTag(9, 60, 6, { lyrics: 'oh a' })])[0];
  for (const p of Object.keys(t.parts)) t.parts[p].forEach(n => { n[4] = ''; });
  const { exercises } = buildLesson({ tags: [t], cards: {}, today: 10, myPart: 'Lead', canListen: true, canSing: true });
  assert.ok(!exercises.some(e => e.type === 'lyricGap'));
});

test('chord-find picks a moment where the most parts sing, and skips solo lines', async () => {
  const { chordAt, chordSize } = await import('../js/lesson.js');
  // the Lead sings a pickup alone, then all four sing
  const t = {
    id: 'p', parts: {
      Lead: [[52, 1.75, 0.4], [57, 2.2, 1.6], [57, 3.8, 2]],
      Tenor: [[62, 0, 3.8, 3.8, '', 'r'], [62, 3.8, 2]],
      Bari: [[54, 3.8, 2]], Bass: [[47, 3.8, 2]],
    },
  };
  for (let seed = 1; seed < 30; seed++) {
    const q = chordAt(t, 'Lead', t.parts.Lead, makeRng(seed));
    assert.equal(Object.keys(q.chord).length, 4, 'never the solo pickup');
    assert.equal(q.answer, 57);
  }
  assert.equal(chordSize(t, 'Lead', t.parts.Lead.slice(0, 2)), 1, 'a pickup alone has no chord');
  assert.equal(chordSize(t, 'Lead', t.parts.Lead), 4);
});
