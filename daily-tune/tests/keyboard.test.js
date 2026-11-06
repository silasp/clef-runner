import test from 'node:test';
import assert from 'node:assert/strict';
import { typedNote } from '../js/keyboard.js';

test('typed letters follow the key signature; Shift ♯, Alt ♭', () => {
  const G = 7, F = 5, C = 0;
  assert.equal(typedNote('f', {}, { tonic: G, last: 64 }) % 12, 6, 'F is F♯ in G major');
  assert.equal(typedNote('B', {}, { tonic: F, last: 64 }) % 12, 10, 'B is B♭ in F major');
  assert.equal(typedNote('F', { alt: true }, { tonic: G, last: 64 }) % 12, 5, 'Alt gives F natural in G');
  assert.equal(typedNote('C', { shift: true }, { tonic: C, last: 60 }), 61);
  assert.equal(typedNote('H', {}, { tonic: C }), null);
  assert.equal(typedNote('', {}, {}), null);
});

test('typing is octave-free for the expected note, else nearest to the last note', () => {
  assert.equal(typedNote('e', {}, { tonic: 0, target: 76, last: 60 }), 76, 'right letter → the expected note');
  assert.equal(typedNote('d', {}, { tonic: 0, target: 76, last: 60 }), 62, 'wrong letter → nearest D to the last note');
  assert.equal(typedNote('b', {}, { tonic: 0, last: 60 }), 59);
  assert.equal(typedNote('b', {}, { tonic: 0, last: 60, lo: 60, hi: 80 }), 71, 'stays on the keyboard when it can');
});
