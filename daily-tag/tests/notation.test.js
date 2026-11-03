import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStaff, staffPosition, clefFor, renderContour, rhythmGlyph } from '../js/notation.js';
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

test('rhythm glyphs map beats to note values', () => {
  assert.deepEqual([rhythmGlyph(4).hollow, rhythmGlyph(4).stem], [true, false]);       // whole
  assert.deepEqual([rhythmGlyph(2).hollow, rhythmGlyph(2).stem], [true, true]);        // half
  assert.equal(rhythmGlyph(1).hollow, false);                                         // quarter
  assert.equal(rhythmGlyph(0.5).flags, 1);                                            // eighth
  assert.equal(rhythmGlyph(0.25).flags, 2);                                           // sixteenth
  assert.ok(rhythmGlyph(1.5).dot && rhythmGlyph(3).dot);
  assert.equal(rhythmGlyph(1.1).beats, 1, 'snaps to the nearest value');
});

test('staff shows syllables under notes with melisma extenders and hyphens', () => {
  const notes = [[60, 0, .5, .5, 'lo-'], [62, .5, .5, .5, 'ving'], [64, 1, .5, .5, 'you'], [65, 1.5, .5, .5, ''], [67, 2, 1, 2, '']];
  const svg = renderStaff(notes, { part: 'Lead', lyrics: true, rhythm: true });
  assert.ok(svg.includes('>lo<') && svg.includes('>ving<') && svg.includes('>you<'));
  assert.ok(svg.includes('>-<'), 'hyphen between syllables of one word');
  assert.equal((svg.match(/st-ext/g) || []).length, 2, 'extender over the two held notes');
  assert.ok((svg.match(/st-stem/g) || []).length >= 4, 'stems drawn in rhythm mode');
  const plain = renderStaff(notes, { part: 'Lead' });
  assert.ok(!plain.includes('st-syl') && !plain.includes('st-stem'), 'pitch-only view has neither');
});

test('barlines and ties are drawn', async () => {
  const { renderStaff } = await import('../js/notation.js');
  const svg = renderStaff([[60, 0, 1, 1, 'a', '~'], [60, 1, 1, 1, ''], [62, 2, 1, 1, 'b', '|']], { rhythm: true });
  assert.equal((svg.match(/st-bar/g) || []).length, 1);
  assert.equal((svg.match(/st-tie/g) || []).length, 1);
  assert.equal((renderStaff([[60, 0, 1, 1, 'a', '|']]).match(/st-bar/g) || []).length, 0, 'no barline before the first note');
});
