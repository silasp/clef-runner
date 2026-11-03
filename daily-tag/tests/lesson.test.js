import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLesson, allowed, nextNoteQuestion, listenChooseQuestion, lyricGapQuestion, chordAt, makeRng, EXERCISE_TYPES } from '../js/lesson.js';
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
