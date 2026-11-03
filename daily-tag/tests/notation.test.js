import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStaff, staffPosition, clefFor, renderContour } from '../js/notation.js';
import { keyLayout, rangeFor } from '../js/keyboard.js';

test('barbershop clefs', () => {
  assert.equal(clefFor('Lead'), 'treble8');
  assert.equal(clefFor('Tenor'), 'treble8');
  assert.equal(clefFor('Bari'), 'bass');
  assert.equal(clefFor('Bass'), 'bass');
});

test('staff positions follow letter names and key spelling', () => {
  assert.equal(staffPosition(60, 0).step - staffPosition(59, 0).step, 1); // B3 → C4
  const bb = staffPosition(70, 5); // F major: B♭
  assert.equal(bb.letter, 'B'); assert.equal(bb.acc, '♭');
  const as = staffPosition(70, 7); // G major: A♯
  assert.equal(as.letter, 'A'); assert.equal(as.acc, '♯');
});

test('renderStaff hides masked notes and shows names', () => {
  const notes = [[60, 0, 1], [62, 1, 1], [64, 2, 1]];
  const svg = renderStaff(notes, { part: 'Lead', tonic: 0, mask: [true, false, true], names: true });
  assert.equal((svg.match(/<ellipse/g) || []).length, 2);
  assert.equal((svg.match(/st-hidden/g) || []).length, 1);
  assert.ok(svg.includes('>C<') && svg.includes('>E<'));
  assert.ok(renderStaff(notes, { part: 'Bass' }).includes('𝄢'));
  assert.ok(renderContour([60, 62, 59]).includes('<rect'));
});

test('keyboard layout spans whole white keys and fits the notes', () => {
  const k = keyLayout(61, 66); // C#..F# widened to C..G
  assert.equal(k.lo, 60); assert.equal(k.hi, 67);
  assert.equal(k.whites.length, 5);
  assert.equal(k.blacks.length, 3);
  const [lo, hi] = rangeFor([60, 64, 67]);
  assert.ok(lo <= 58 && hi >= 69);
  assert.ok(keyLayout(lo, hi).whites.length >= 10);
});
