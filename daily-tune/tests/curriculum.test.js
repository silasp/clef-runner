import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPhrases, prepareTags, nextNewItem, learningQueue, partStatus, cardId, partOrder, itemNotes, learnedParts, tagStatus } from '../js/curriculum.js';
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

test('prepareTags adds tonic, phrases and difficulty', () => {
  const [t] = prepareTags([fakeTag(1)]);
  assert.equal(t.id, '1');
  assert.equal(typeof t.tonic, 'number');
  assert.ok(t.difficulty >= 1);
  assert.equal(t.phrases.Melody.flat().length, t.parts.Melody.length);
});

test('one part per tune: the melody', () => {
  assert.deepEqual(partOrder('Melody', 'melody'), ['Melody']);
  assert.deepEqual(partOrder('nope'), ['Melody']);
});

test('learning queue: easy → hard, one tune at a time', () => {
  const tags = prepareTags([fakeTag(1, 60, 12), fakeTag(2, 60, 4)]);
  const q = learningQueue(tags, 'Melody', 'tag-by-tag', 'melody');
  assert.equal(q.length, 2);
  assert.ok(q[0].tag.difficulty <= q[1].tag.difficulty);
});

test('forward chaining chunk by chunk, then the whole tune, then the next tune', () => {
  const tags = prepareTags([fakeTag(1, 60, 8), fakeTag(2, 60, 30)]);
  const t = tags.find(x => x.id === '1');
  const cards = {};
  let it = nextNewItem(tags, cards, 'Melody', 'tag-by-tag', 'melody');
  assert.deepEqual([it.tag.id, it.phrase], ['1', 0]);
  cards[cardId('1', 'Melody', 0)] = { ...newCard(cardId('1', 'Melody', 0)), reps: 1, level: 1 };
  assert.equal(nextNewItem(tags, cards, 'Melody', 'tag-by-tag', 'melody').phrase, 0, 'still learning chunk 0');
  const n = t.phrases.Melody.length;
  for (let i = 0; i < n; i++) cards[cardId('1', 'Melody', i)] = { ...newCard('x'), reps: 2, level: 2 };
  it = nextNewItem(tags, cards, 'Melody', 'tag-by-tag', 'melody');
  assert.equal(it.phrase, 'all');
  assert.equal(itemNotes(t, 'Melody', 'all').length, t.parts.Melody.length);
  // the whole tune recalled once (level 2) is enough to start the next tune
  cards[cardId('1', 'Melody', 'all')] = { ...newCard('x'), reps: 2, level: 2 };
  it = nextNewItem(tags, cards, 'Melody', 'tag-by-tag', 'melody');
  assert.deepEqual([it.tag.id, it.phrase], ['2', 0]);
  const st = partStatus(t, 'Melody', cards);
  assert.ok(st.learned && !st.done);
  assert.deepEqual(learnedParts(t, cards), ['Melody']);
  assert.equal(tagStatus(t, cards).learnedParts, 1);
  cards[cardId('1', 'Melody', 'all')].level = 4;
  assert.ok(partStatus(t, 'Melody', cards).done);
});
