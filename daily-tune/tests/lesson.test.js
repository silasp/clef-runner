import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLesson, allowed, nextNoteQuestion, listenChooseQuestion, makeRng, EXERCISE_TYPES } from '../js/lesson.js';
import { prepareTags, cardId } from '../js/curriculum.js';
import { newCard } from '../js/srs.js';
import { fakeTag } from './fixtures.js';

const tags = prepareTags([fakeTag(1), fakeTag(2, 62, 10)]);

test('a fresh lesson introduces a new phrase first', () => {
  const { exercises, newItem } = buildLesson({ tags, cards: {}, today: 10, myPart: 'Melody', canListen: true, canSing: true });
  assert.ok(newItem);
  assert.equal(exercises[0].type, 'intro');
  assert.equal(exercises[1].type, 'guided');
  assert.ok(exercises.some(e => e.type === 'sing'));
  assert.ok(exercises.length >= 5 && exercises.length <= 10);
});

test("can't listen / can't sing removes those exercise types", () => {
  const { exercises } = buildLesson({ tags, cards: {}, today: 10, myPart: 'Melody', canListen: false, canSing: false });
  for (const e of exercises) {
    assert.ok(!EXERCISE_TYPES[e.type].listen, e.type);
    assert.ok(!EXERCISE_TYPES[e.type].sing, e.type);
  }
  assert.ok(exercises.some(e => e.type === 'tap'));
  assert.ok(!allowed('sing', { canListen: true, canSing: false }));
  assert.ok(!allowed('listenChoose', { canListen: false, canSing: true }));
  assert.ok(allowed('tap', { canListen: false, canSing: false }));
});

test('due reviews are mixed in', () => {
  const id = cardId('2', 'Melody', 0);
  const cards = { [id]: { ...newCard(id), reps: 3, level: 2, due: 9 } };
  const { exercises } = buildLesson({ tags, cards, today: 10, myPart: 'Melody', canListen: true, canSing: false });
  assert.ok(exercises.some(e => e.review && e.cardId === id));
});

test('focus mode teaches the requested tune', () => {
  const { newItem } = buildLesson({ tags, cards: {}, today: 10, myPart: 'Melody', canListen: true, canSing: true, focus: { tagId: '2', part: 'Melody' } });
  assert.equal(newItem.tag.id, '2');
  assert.equal(newItem.part, 'Melody');
});

test('question generators', () => {
  const rng = makeRng(5);
  const notes = tags[0].parts.Melody;
  const nn = nextNoteQuestion(notes, rng);
  assert.equal(nn.options.length, 4);
  assert.ok(nn.options.includes(nn.answer));
  assert.equal(new Set(nn.options).size, 4);
  const lc = listenChooseQuestion(notes, rng);
  assert.equal(lc.options.length, 3);
  assert.deepEqual(lc.options[lc.answerIndex], notes.map(n => n[0]));
});

test('rng is deterministic', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});
