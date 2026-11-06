import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPhrases, phraseLyrics, prepareTags, nextNewItem, learningQueue, partStatus, cardId, partOrder, itemNotes, learnedParts, tagStatus, markKnown, unmarkKnown, isKnownSkip } from '../js/curriculum.js';
import { newCard, review, dueCards } from '../js/srs.js';
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

test('part order: melody first by default, or my part first', () => {
  assert.deepEqual(partOrder('Bari', 'melody'), ['Lead', 'Bass', 'Tenor', 'Bari']);
  assert.deepEqual(partOrder('Bari', 'mine'), ['Bari', 'Lead', 'Bass', 'Tenor']);
  assert.deepEqual(partOrder('nope'), ['Lead', 'Bass', 'Tenor', 'Bari']);
});

test('learning queue: whole tag (all four parts) before the next, easy → hard', () => {
  const tags = prepareTags([fakeTag(1, 60, 12), fakeTag(2, 60, 4)]);
  const q = learningQueue(tags, 'Bari', 'tag-by-tag', 'melody');
  assert.equal(q.length, 8);
  assert.deepEqual(q.slice(0, 4).map(x => x.part), ['Lead', 'Bass', 'Tenor', 'Bari']);
  assert.ok(q.slice(0, 4).every(x => x.tag === q[0].tag));
  assert.ok(q[0].tag.difficulty <= q[4].tag.difficulty);
  const q2 = learningQueue(tags, 'Bari', 'my-part-first', 'mine');
  assert.deepEqual(q2.slice(0, 2).map(x => x.part), ['Bari', 'Bari']);
});

test('forward chaining within a part, then on to the next part once the whole part is learned', () => {
  const tags = prepareTags([fakeTag(1, 60, 8)]);
  const t = tags[0];
  const cards = {};
  let it = nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody');
  assert.deepEqual([it.part, it.phrase], ['Lead', 0]);
  cards[cardId('1', 'Lead', 0)] = { ...newCard(cardId('1', 'Lead', 0)), reps: 1, level: 1 };
  assert.equal(nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody').phrase, 0, 'still learning phrase 0');
  const n = t.phrases.Lead.length;
  for (let i = 0; i < n; i++) cards[cardId('1', 'Lead', i)] = { ...newCard('x'), reps: 2, level: 2 };
  it = nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody');
  assert.equal(it.phrase, 'all');
  assert.equal(itemNotes(t, 'Lead', 'all').length, t.parts.Lead.length);
  // whole part recalled once (level 2) is enough to start the next part
  cards[cardId('1', 'Lead', 'all')] = { ...newCard('x'), reps: 2, level: 2 };
  it = nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody');
  assert.deepEqual([it.part, it.phrase], ['Bass', 0]);
  const st = partStatus(t, 'Lead', cards);
  assert.ok(st.learned && !st.done);
  assert.deepEqual(learnedParts(t, cards), ['Lead']);
  assert.equal(tagStatus(t, cards).learnedParts, 1);
  cards[cardId('1', 'Lead', 'all')].level = 4;
  assert.ok(partStatus(t, 'Lead', cards).done);
});

test('"I already know this part" moves on to the next part, reviews it later, and can be undone', () => {
  const tags = prepareTags([fakeTag(1, 60, 8)]);
  const cards = {};
  markKnown(cards, '1', 'Lead', 100);
  assert.equal(nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody').part, 'Bass', 'moves on to the next part');
  assert.ok(isKnownSkip(cards, '1', 'Lead'));
  assert.equal(dueCards(cards, 102).length, 1, 'comes back as a review');
  assert.ok(unmarkKnown(cards, '1', 'Lead'));
  assert.equal(nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody').part, 'Lead');
  markKnown(cards, '1', 'Lead', 100);
  const id = cardId('1', 'Lead', 'all');
  cards[id] = review(cards[id], 0.2, 102, 3);
  const it = nextNewItem(tags, cards, 'Lead', 'tag-by-tag', 'melody');
  assert.deepEqual([it.part, it.phrase], ['Lead', 0], 'a missed review sends it back to learning');
});
