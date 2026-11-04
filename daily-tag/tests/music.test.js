import test from 'node:test';
import assert from 'node:assert/strict';
import { midiToFreq, freqToMidi, noteName, scaleDegree, detectTonic, detectKey, parseWrittenKey, isDiatonic, partDifficulty, intervals, keyName } from '../js/music.js';

test('midi <-> frequency round-trips', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.63) < 0.01);
  for (const m of [36, 48, 60, 72.5]) assert.ok(Math.abs(freqToMidi(midiToFreq(m)) - m) < 1e-9);
});

test('note names are spelled for the key', () => {
  assert.equal(noteName(70, 5), 'B♭4');   // F major uses flats
  assert.equal(noteName(70, 7), 'A♯4');   // G major uses sharps
  assert.equal(noteName(60, 0, false), 'C');
  assert.equal(keyName(3), 'E♭ major');
});

test('scale degrees relative to tonic', () => {
  assert.equal(scaleDegree(67, 0), '5');
  assert.equal(scaleDegree(70, 0), '♭7');
  assert.equal(scaleDegree(62, 2), '1');
  assert.ok(isDiatonic(64, 0));
  assert.ok(!isDiatonic(63, 0));
});

test('detectTonic finds the key of a simple major line', () => {
  // Bb major arpeggio-ish line with long tonic
  const notes = [[58, 0, 2], [62, 2, 1], [65, 3, 1], [63, 4, 0.5], [60, 4.5, 0.5], [58, 5, 3]];
  assert.equal(detectTonic(notes), 10);
  const cmaj = [[60, 0, 2], [64, 2, 1], [67, 3, 1], [65, 4, 0.5], [62, 4.5, 0.5], [60, 5, 3]];
  assert.equal(detectTonic(cmaj), 0);
});

test('difficulty grows with range, leaps and chromaticism', () => {
  const easy = [[60, 0, 1], [60, 1, 1], [62, 2, 1], [60, 3, 1]];
  const hard = [[55, 0, 1], [67, 1, 1], [61, 2, 1], [70, 3, 1], [58, 4, 1], [66, 5, 1], [54, 6, 1], [73, 7, 1]];
  assert.ok(partDifficulty(hard, 0) > partDifficulty(easy, 0));
  assert.equal(partDifficulty([], 0), 0);
  assert.deepEqual(intervals([60, 62, 59]), [2, -3]);
});

test('detectKey recognises minor tags and spells with the relative major', () => {
  // D harmonic minor line ending on D
  const dmin = [[62, 0, 2], [65, 2, 1], [69, 3, 1], [70, 4, 1], [69, 5, 0.5], [61, 5.5, 0.5], [62, 6, 3], [57, 9, 1], [65, 10, 1], [62, 11, 3]];
  const k = detectKey(dmin);
  assert.equal(k.tonic, 2);
  assert.equal(k.mode, 'minor');
  assert.equal(k.spell, 5); // F major signature → B♭
  assert.equal(noteName(70, k.spell, false), 'B♭');
  const cmaj = [[60, 0, 2], [64, 2, 1], [67, 3, 1], [65, 4, 0.5], [62, 4.5, 0.5], [60, 5, 3]];
  assert.deepEqual([detectKey(cmaj).tonic, detectKey(cmaj).mode], [0, 'major']);
});

test('parseWrittenKey', () => {
  assert.deepEqual(parseWrittenKey('Major:Eb'), { tonic: 3, mode: 'major' });
  assert.deepEqual(parseWrittenKey('Minor:F#'), { tonic: 6, mode: 'minor' });
  assert.equal(parseWrittenKey(''), null);
});

test('key signatures and letter entry', async () => {
  const { keySignature, letterToMidi } = await import('../js/music.js');
  assert.deepEqual(keySignature(2), { acc: '♯', letters: ['F', 'C'] });
  assert.deepEqual(keySignature(3), { acc: '♭', letters: ['B', 'E', 'A'] });
  assert.deepEqual(keySignature(0).letters, []);
  assert.equal(letterToMidi('f', 2, 60), 66, 'F means F♯ in D major');
  assert.equal(letterToMidi('B', 3, 60), 58, 'B means B♭ in E♭, nearest below');
  assert.equal(letterToMidi('C', 0, 67), 72, 'nearest C to G4 is C5');
  assert.equal(letterToMidi('D', 0, 60), 62);
  assert.equal(letterToMidi('x', 0, 60), null);
});
