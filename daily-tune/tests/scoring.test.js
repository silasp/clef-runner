import test from 'node:test';
import assert from 'node:assert/strict';
import { framesToNotes, alignPitches, lyricMatch, normaliseWords, levenshtein, combineScores, gradeTaps } from '../js/scoring.js';

const frames = (seq, dt = 0.033) => {
  const out = []; let t = 0;
  for (const [m, dur] of seq) { const k = Math.round(dur / dt); for (let i = 0; i < k; i++) { out.push({ t, midi: m == null ? null : m + (Math.random() - 0.5) * 0.3 }); t += dt; } }
  return out;
};

test('framesToNotes segments a sung line and ignores blips', () => {
  const f = frames([[60, 0.5], [null, 0.1], [62, 0.4], [70, 0.05], [64, 0.6]]);
  const n = framesToNotes(f).map(x => x.midi);
  assert.deepEqual(n, [60, 62, 64]);
});

test('framesToNotes keeps repeated notes separated by a breath merged when close', () => {
  const f = frames([[60, 0.4], [null, 0.05], [60, 0.4]]);
  assert.equal(framesToNotes(f).length, 1);
});

test('alignPitches: perfect, octave-shifted, and transposed attempts', () => {
  const target = [60, 62, 64, 65, 67];
  assert.equal(alignPitches([60, 62, 64, 65, 67], target).score, 1);
  const oct = alignPitches([48, 50, 52, 53, 55], target);
  assert.equal(oct.score, 1);
  assert.equal(oct.shift, 12);
  assert.ok(alignPitches([48, 50, 52, 53, 55], target, { octaveFree: false }).score < 0.5);
  assert.ok(alignPitches([61, 63, 65, 66, 68], target).score < 0.3, 'a semitone sharp everywhere is wrong');
});

test('alignPitches: rhythm-free — sustained repeated notes count once', () => {
  const target = [60, 60, 62, 62, 64];
  const r = alignPitches([60, 62, 64], target);
  assert.equal(r.score, 1);
  assert.deepEqual(r.hits, [true, true, true, true, true]);
});

test('alignPitches: a missed note and an extra scoop', () => {
  const target = [60, 62, 64, 65];
  const r = alignPitches([60, 64, 65], target);
  assert.deepEqual(r.hits, [true, false, true, true]);
  const r2 = alignPitches([59, 60, 62, 64, 65], target);
  assert.equal(r2.score, 1);
});

test('alignPitches edge cases', () => {
  assert.equal(alignPitches([], [60]).score, 0);
  assert.equal(alignPitches([60], []).score, 1);
});

test('lyric matching is fuzzy and order-aware', () => {
  assert.equal(lyricMatch('There I go, lost in your eyes', 'there I go lost in your eyes'), 1);
  assert.ok(lyricMatch('There I go, lost in your eyes', 'their I go lust in yer eyes') >= 0.6);
  assert.equal(lyricMatch('hello world', ''), 0);
  assert.equal(lyricMatch('', 'anything'), 1);
  assert.deepEqual(normaliseWords("Don't stop—believin'!"), ['dont', 'stop', 'believin']);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('combined grade weights pitch over words', () => {
  assert.equal(combineScores(0.9, null), 0.9);
  assert.ok(Math.abs(combineScores(1, 0) - 0.8) < 1e-9);
  assert.equal(combineScores(1, 1), 1);
});

test('gradeTaps', () => {
  assert.equal(gradeTaps([60, 62, 64], [60, 62, 64]), 1);
  assert.equal(gradeTaps([60, 74, 64], [60, 62, 64]), 2 / 3);
  assert.equal(gradeTaps([60, 74, 64], [60, 62, 64], { octaveFree: true }), 1);
});

test('a transposed attempt does not score by accidental overlap', () => {
  const target = [57, 58, 60, 61, 62, 65, 64, 62, 60];
  assert.ok(alignPitches(target.map(x => x + 3), target).score < 0.4);
  assert.ok(alignPitches(target.map(x => x + 2), target).score < 0.4);
});
