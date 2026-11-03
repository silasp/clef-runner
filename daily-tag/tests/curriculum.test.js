import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPhrases, phraseLyrics, prepareTags, nextNewItem, learningQueue, partStatus, cardId, partOrder, itemNotes } from '../js/curriculum.js';
import { newCard } from '../js/srs.js';
import { fakeTag } from './fixtures.js';

test('splitPhrases breaks on rests / held notes and keeps 3–9 notes', () => {
  const notes = [[60, 0, .4], [62, .4, .4], [64, .8, 1.5], [65, 2.4, .4], [67, 2.8, .4], [69, 3.2, .4], [67, 4.1, .4], [65, 4.5, .4], [64, 4.9, 2]];
  const ph = splitPhrases(notes);
  assert.deepEqual(ph.map(p => p.length), [3, 3, 3]);
  const long = Array.from({ length: 25 }, (_, i) => [60 + (i % 5), i * 0.3, 0.3]);
  for (const p of splitPhrases(long)) assert.ok(p.length >= 3 && p.length <= 9);
  assert.equal(splitPhrases(long).flat().length, 25, 'no notes lost');
  assert.deepEqual(splitPhrases([]), []);
});

test('short tail is folded into the previous phrase', () => {
  const notes = [[60, 0, .4], [62, .4, .4], [64, .8, 1.5], [65, 2.4, .4]];
  assert.deepEqual(splitPhrases(notes).map(p => p.length), [4]);
});

test('phraseLyrics slices words proportionally', () => {
  const ph = [[[60, 0, 1], [62, 1, 1]], [[64, 2, 1], [65, 3, 1]]];
  assert.equal(phraseLyrics('one two three four', ph, 0), 'one two');
  assert.equal(phraseLyrics('one two three four', ph, 1), 'three four');
  assert.equal(phraseLyrics('', ph, 0), '');
});

test('prepareTags adds tonic, phrases and difficulty', () => {
  const [t] = prepareTags([fakeTag(1)]);
  assert.equal(t.id, '1');
  assert.equal(typeof t.tonic, 'number');
  assert.ok(t.difficulty >= 1);
  for (const p of ['Tenor', 'Lead', 'Bari', 'Bass']) assert.equal(t.phrases[p].flat().length, t.parts[p].length);
});

test('part order puts my part first', () => {
  assert.deepEqual(partOrder('Bari'), ['Bari', 'Tenor', 'Lead', 'Bass']);
  assert.deepEqual(partOrder('nope'), ['Tenor', 'Lead', 'Bari', 'Bass']);
});

test('learning queue goes easy → hard, my part first', () => {
  const tags = prepareTags([fakeTag(1, 60, 12), fakeTag(2, 60, 4)]);
  const q = learningQueue(tags, 'Lead');
  assert.equal(q[0].part, 'Lead');
  assert.ok(q[0].tag.difficulty <= q[1].tag.difficulty);
  assert.equal(q.length, 8);
  const q2 = learningQueue(tags, 'Lead', 'tag-by-tag');
  assert.deepEqual(q2.slice(0, 4).map(x => x.part), ['Lead', 'Tenor', 'Bari', 'Bass']);
});

test('forward chaining: next phrase only after the previous is learned, then the whole part', () => {
  const tags = prepareTags([fakeTag(1, 60, 8)]);
  const t = tags[0];
  const cards = {};
  let it = nextNewItem(tags, cards, 'Lead');
  assert.deepEqual([it.part, it.phrase], ['Lead', 0]);
  cards[cardId('1', 'Lead', 0)] = { ...newCard(cardId('1', 'Lead', 0)), reps: 1, level: 1 };
  assert.equal(nextNewItem(tags, cards, 'Lead').phrase, 0, 'still learning phrase 0');
  const n = t.phrases.Lead.length;
  for (let i = 0; i < n; i++) cards[cardId('1', 'Lead', i)] = { ...newCard('x'), reps: 2, level: 2 };
  it = nextNewItem(tags, cards, 'Lead');
  assert.equal(it.phrase, 'all');
  assert.equal(itemNotes(t, 'Lead', 'all').length, t.parts.Lead.length);
  cards[cardId('1', 'Lead', 'all')] = { ...newCard('x'), reps: 5, level: 4 };
  it = nextNewItem(tags, cards, 'Lead');
  assert.notEqual(it.part, 'Lead', 'moves on to another part');
  assert.ok(partStatus(t, 'Lead', cards).done);
});
