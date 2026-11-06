import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandTune, chunkTune, tuneDifficulty, prepareTunes } from '../js/tunes.js';

// 6/8 jig shape: a one-quaver pickup, then bars of six quavers (sixteenths: 2 each)
const jig = { id: 'x', title: 'Test Jig', genre: 'folk', style: 'Jig', source: 't', bar: 3,
  p: Array.from({ length: 25 }, (_, i) => 62 + (i % 5)).join(','), d: Array(25).fill(2).join(',') };

test('expandTune: beats, barlines after the pickup', () => {
  const t = expandTune(jig);
  const n = t.parts.Melody;
  assert.equal(n.length, 25);
  assert.equal(n[1][1], 0.5);
  assert.equal(n[0][2], 0.5);
  // pickup is one quaver, so bars start at notes 1, 7, 13, 19
  const bars = n.map((x, i) => (x[5] === '|' ? i : -1)).filter(i => i >= 0);
  assert.deepEqual(bars, [1, 7, 13, 19]);
});

test('chunkTune: whole bars, pickup joins the first chunk, every note kept', () => {
  const n = expandTune(jig).parts.Melody;
  const ch = chunkTune(n);
  assert.equal(ch.flat().length, n.length);
  assert.ok(ch.every(c => c.length >= 3 && c.length <= 14), ch.map(c => c.length).join());
  assert.equal(ch[0][0], n[0]);
  for (const c of ch.slice(1)) assert.equal(c[0][5], '|', 'chunks start on a barline');
});

test('chunkTune: unbarred tunes fall back to short runs; busy bars are split', () => {
  const free = expandTune({ ...jig, bar: 0 }).parts.Melody;
  assert.ok(chunkTune(free).every(c => c.length <= 10));
  const busy = expandTune({ ...jig, bar: 8, p: Array(64).fill(60).join(','), d: Array(64).fill(1).join(',') }).parts.Melody;
  assert.ok(chunkTune(busy).every(c => c.length <= 12));
});

test('tuneDifficulty: leaps and chromatics make it harder', () => {
  const mk = ps => ps.map((m, i) => [m, i * 0.5, 0.5]);
  const step = tuneDifficulty(mk([60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 62]), 0);
  const leap = tuneDifficulty(mk([60, 72, 63, 77, 61, 70, 66, 79, 58, 71, 64, 75]), 0);
  assert.ok(step >= 1 && leap <= 10);
  assert.ok(leap > step + 2);
});

test('the real library loads, chunks and spreads across the difficulty scale', () => {
  const rows = JSON.parse(readFileSync(new URL('../data/tunes.json', import.meta.url))).tunes;
  assert.ok(rows.length > 1000);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'ids are unique');
  assert.ok(rows.every(r => !String(r.id).includes(':')), 'ids are safe in card ids');
  const tunes = prepareTunes(rows);
  assert.ok(tunes.some(t => t.genre === 'folk') && tunes.some(t => t.genre === 'jazz'));
  for (const t of tunes) assert.equal(t.phrases.Melody.flat().length, t.parts.Melody.length, t.title);
  const easy = tunes.filter(t => t.difficulty <= 3).length, hard = tunes.filter(t => t.difficulty >= 7).length;
  assert.ok(easy > 50 && hard > 20, `easy ${easy}, hard ${hard}`);
});
