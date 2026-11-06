import test from 'node:test';
import assert from 'node:assert/strict';
import { newCard, review, isDue, dueCards, cueMask, isMemorised, dayNumber, MEMORISED_LEVEL } from '../js/srs.js';

test('copying with full notation never counts as memory beyond level 1', () => {
  let c = newCard('x');
  for (let i = 0; i < 5; i++) c = review(c, 1, 100 + i * 10, 0);
  assert.equal(c.level, 1);
});

test('same-day practice can reach "learned" (2) but not further', () => {
  let c = newCard('x');
  c = review(c, 1, 100, 0);  // guided → 1
  c = review(c, 1, 100, 2);  // partial cues → 2
  c = review(c, 1, 100, 3);  // still day 100 → capped
  c = review(c, 1, 100, 5);
  assert.equal(c.level, 2);
  assert.ok(c.due > 100 && c.due <= 102);
});

test('spaced successes with fading cues reach "memorised"', () => {
  let c = newCard('x');
  c = review(c, 1, 100, 0);
  c = review(c, 1, 100, 2);
  let day = 100;
  while (c.level < MEMORISED_LEVEL) { day = c.due; c = review(c, 0.95, day, c.level + 1); }
  assert.ok(isMemorised(c));
  assert.ok(day - 100 >= 3, 'memorising needs several days');
});

test('failure drops the level and shortens the interval', () => {
  let c = { ...newCard('x'), level: 4, reps: 6, due: 200, last: 190 };
  c = review(c, 0.3, 200, 5);
  assert.equal(c.level, 2);
  assert.equal(c.lapses, 1);
  assert.ok(c.due <= 202);
});

test('due cards are sorted most overdue first', () => {
  const cards = {
    a: { ...newCard('a'), reps: 1, due: 10, level: 2 },
    b: { ...newCard('b'), reps: 1, due: 5, level: 3 },
    c: { ...newCard('c'), reps: 1, due: 50, level: 1 },
    d: newCard('d'),
  };
  assert.deepEqual(dueCards(cards, 20).map(c => c.id), ['b', 'a']);
  assert.ok(!isDue(cards.d, 20));
});

test('cue masks fade with level', () => {
  assert.ok(cueMask(6, 0).every(Boolean));
  assert.ok(cueMask(6, 1).every(Boolean));
  const m2 = cueMask(10, 2, 3);
  assert.ok(m2[0] && m2.some(x => !x));
  assert.deepEqual(cueMask(4, 3), [true, false, false, false]);
  assert.ok(cueMask(4, 4).every(x => !x));
  assert.deepEqual(cueMask(10, 2, 3), cueMask(10, 2, 3), 'deterministic');
});

test('dayNumber uses local calendar days', () => {
  const a = dayNumber(new Date(2026, 0, 1, 0, 5));
  const b = dayNumber(new Date(2026, 0, 1, 23, 55));
  const c = dayNumber(new Date(2026, 0, 2, 0, 1));
  assert.equal(a, b);
  assert.equal(c, a + 1);
});
