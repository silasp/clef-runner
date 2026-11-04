import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transpose, splitNote, mergeNext, deleteNote, setSyllable, layLyrics, lyricText,
  recordPart, recordHide, forget, pending, mergeStores, pruneLocal, applyCorrections,
  buildSubmission, parseSubmission, validate,
} from '../js/corrections.js';

const NOTES = [[60, 0.5, 0.8, 1, 'honk'], [64, 1.3, 2.5, 3, 'Beep'], [64, 3.8, 0.8, 1, 'with'], [65, 4.6, 2.5, 3, 'gas']];

test('note edits are pure and keep timing consistent', () => {
  const t = transpose(NOTES, 0, 1);
  assert.equal(t[0][0], 61);
  assert.equal(NOTES[0][0], 60, 'original untouched');
  const s = splitNote(NOTES, 0);
  assert.equal(s.length, 5);
  assert.deepEqual(s.slice(0, 2).map(n => [n[0], n[1], n[2], n[4]]), [[60, 0.5, 0.4, 'honk'], [60, 0.9, 0.4, '']]);
  assert.equal(s[0][3], 0.5);
  const m = mergeNext(s, 0);
  assert.deepEqual(m[0], [60, 0.5, 0.8, 1, 'honk']);
  const d = deleteNote(NOTES, 2);
  assert.equal(d.length, 3);
  assert.equal(d[1][2], 3.3, 'previous note absorbs the deleted note');
  assert.equal(setSyllable(NOTES, 1, ' beep ')[1][4], 'beep');
  assert.equal(deleteNote([NOTES[0]], 0).length, 1, 'never deletes the last note');
});

test('layLyrics: one token per note, hyphens, melismas, and round-trip', () => {
  const ten = Array.from({ length: 10 }, (_, i) => [60, i, 1, 1, '']);
  const out = layLyrics(ten, 'Honk honk beep beep fill it up with gas');
  assert.deepEqual(out.map(n => n[4]), ['Honk', 'honk', 'beep', 'beep', 'fill', 'it', 'up', 'with', 'gas', '']);
  const mel = layLyrics(ten.slice(0, 5), 'lo-ving _ you');
  assert.deepEqual(mel.map(n => n[4]), ['lo-', 'ving', '', 'you', '']);
  assert.equal(lyricText(mel), 'lo-ving _ you');
  assert.deepEqual(layLyrics(mel, lyricText(mel)).map(n => n[4]), mel.map(n => n[4]));
  const held = layLyrics(ten.slice(0, 4), 'lo- _ ving');
  assert.deepEqual(held.map(n => n[4]), ['lo-', '', 'ving', '']);
  assert.equal(lyricText(held), 'lo- _ ving');
  const part = layLyrics(ten, 'a b', 2, 5);
  assert.deepEqual(part.map(n => n[4]).slice(0, 6), ['', '', 'a', 'b', '', '']);
});

test('store: record, pending, merge, prune, forget', () => {
  const local = {};
  recordPart(local, '1970', 'Lead', { notes: NOTES, now: 100 });
  recordPart(local, '1970', 'Bass', { now: 101 });
  recordHide(local, '42', { comment: 'not a tag', now: 50 });
  assert.equal(local['1970'].ts, 101);
  assert.deepEqual(pending(local, {}).sort(), ['1970', '42']);
  const remote = { 42: { ts: 50, hide: true, parts: {} } };
  assert.deepEqual(pending(local, remote), ['1970']);
  const merged = mergeStores(remote, local);
  assert.ok(merged['1970'].parts.Lead.notes);
  pruneLocal(local, remote);
  assert.deepEqual(Object.keys(local), ['1970']);
  local['1970'].submitted = true;
  assert.deepEqual(pending(local, remote), []);
  assert.deepEqual(pending(local, remote, { includeSubmitted: true }), ['1970']);
  forget(local, '1970', 'Lead'); forget(local, '1970', 'Bass');
  assert.deepEqual(local, {});
});

test('applyCorrections replaces parts, marks checks, hides tags', () => {
  const raw = [
    { id: 1970, title: 'Honk Honk', parts: { Tenor: NOTES, Lead: NOTES, Bari: NOTES, Bass: NOTES } },
    { id: 42, title: 'Gone', parts: { Tenor: NOTES, Lead: NOTES, Bari: NOTES, Bass: NOTES } },
  ];
  const fixed = splitNote(NOTES, 0);
  const store = {};
  recordPart(store, '1970', 'Lead', { notes: fixed });
  recordPart(store, '1970', 'Bass', {});
  recordHide(store, '42');
  const out = applyCorrections(raw, store);
  assert.equal(out.length, 1);
  assert.equal(out[0].parts.Lead.length, 5);
  assert.equal(out[0].parts.Tenor, NOTES);
  assert.deepEqual(out[0].checked, { Lead: true, Bass: true });
  assert.equal(out[0].corrected, true);
  assert.equal(raw[0].parts.Lead.length, 4, 'raw tags untouched');
});

test('submission round-trips through the issue body and validates', () => {
  const store = {};
  recordPart(store, '1970', 'Lead', { notes: layLyrics(splitNote(NOTES, 0), 'Honk honk Beep with gas'), now: 5 });
  recordPart(store, '1970', 'Tenor', { now: 6 });
  const sub = buildSubmission(store, ['1970'], { 1970: { title: 'Honk Honk', parts: { Lead: NOTES } } });
  assert.match(sub.title, /Honk Honk/);
  assert.match(sub.body, /Lead ✎ 4→5 notes, lyrics “Honk honk Beep with gas”/);
  assert.match(sub.body, /Tenor ✓ checked/);
  assert.ok(sub.fits);
  assert.ok(sub.url.startsWith('https://github.com/silas-dsc/daily-tag/issues/new?title='));
  const back = parseSubmission(sub.body);
  assert.deepEqual(back['1970'].parts.Lead.notes, store['1970'].parts.Lead.notes);
  assert.equal(back['1970'].parts.Tenor.ok, true);
  assert.equal(back['1970'].ts, 6);
});

test('validate rejects malformed payloads', () => {
  assert.throws(() => validate([]));
  assert.throws(() => validate({ abc: { parts: {} } }), /Bad tag id/);
  assert.throws(() => validate({ 1: { parts: { Soprano: { ok: true } } } }), /Bad part/);
  assert.throws(() => validate({ 1: { parts: { Lead: { notes: [[200, 0, 1]] } } } }), /Bad note values/);
  assert.throws(() => validate({ 1: { parts: { Lead: { notes: [] } } } }), /Bad notes/);
  assert.throws(() => parseSubmission('no marker here'), /marker/);
  const ok = validate({ 7: { ts: 3, parts: { Lead: { ok: true, notes: [[60, 0, 1, null, 'la<script>'.repeat(10)]] } } } });
  assert.equal(ok['7'].parts.Lead.notes[0][4].length, 40);
});

test('lengths, barlines and ties', async () => {
  const { setBeats, toggleFlag, autoBars, hasFlag, tiedFromPrev } = await import('../js/corrections.js');
  const n = [[60, 0, 0.5, 1, 'a'], [60, 0.5, 0.5, 1, 'b'], [62, 1, 1, 2, 'c'], [64, 2, 0.5, 1, 'd'], [65, 2.5, 1.5, 3, 'e']];
  const l = setBeats(n, 2, 1);
  assert.equal(l[2][3], 1);
  assert.equal(l[2][2], 0.5, 'sounding length follows the tempo (0.5 s per beat)');
  assert.equal(setBeats(n, 0, 4)[0][2], 0.5, 'never runs into the next note');
  const b = autoBars(n, 0, 4);
  assert.deepEqual(b.map(x => hasFlag(x, '|')), [false, false, false, true, false]);
  const b3 = autoBars(n, 1, 2);
  assert.deepEqual(b3.map(x => hasFlag(x, '|')), [false, true, false, true, true]);
  const t = toggleFlag(n, 0, '~');
  assert.equal(t[0][5], '~');
  assert.equal(t[1][4], '', 'tied-to note is not re-sung');
  assert.ok(tiedFromPrev(t, 1));
  const both = toggleFlag(toggleFlag(t, 0, '|'), 0, '~');
  assert.equal(both[0][5], '|');
  assert.equal(toggleFlag(both, 0, '|')[0].length, 5, 'no empty flag element');
  assert.deepEqual(validate({ 1: { parts: { Lead: { notes: [[60, 0, 1, 1, 'a', '|~']] } } } })['1'].parts.Lead.notes[0], [60, 0, 1, 1, 'a', '|~']);
  assert.throws(() => validate({ 1: { parts: { Lead: { notes: [[60, 0, 1, 1, 'a', 'x']] } } } }), /flags/);
});

test('rests: toggle, keep pitch, skip words, stripped for learning', async () => {
  const { toggleRest, isRest, setPitch, stripRests } = await import('../js/corrections.js');
  const n = [[60, 0, 1, 1, 'a', '~'], [60, 1, 1, 1, ''], [62, 2, 1, 1, 'b', '|'], [64, 3, 1, 1, 'c']];
  const r = toggleRest(n, 2);
  assert.ok(isRest(r[2]));
  assert.equal(r[2][0], 62, 'a rest keeps its pitch');
  assert.equal(r[2][4], '', 'a rest has no syllable');
  assert.equal(r[2][5], '|r', 'barline kept');
  assert.ok(!isRest(toggleRest(r, 2)[2]), 'and turns back into a note');
  const r1 = toggleRest(n, 1);
  assert.equal(r1[0][5] || '', '', 'a tie into a rest is removed');
  assert.equal(toggleRest(toggleRest(r, 3), 0)[0][5], '~', 'never fewer than two sung notes');
  assert.ok(!isRest(setPitch(r, 2, 65)[2]) && setPitch(r, 2, 65)[2][0] === 65, 'a pitch makes it a note');
  assert.deepEqual(layLyrics(r, 'x y z').map(x => x[4]), ['x', 'y', '', 'z']);
  assert.equal(lyricText(layLyrics(r, 'x y z')), 'x y z');
  const s = stripRests(r);
  assert.equal(s.length, 3);
  assert.equal(s[2][5], '|', "a rest's barline moves to the next note");
  const out = applyCorrections([{ id: 9, parts: { Tenor: n, Lead: n, Bari: n, Bass: n } }], { 9: { ts: 1, parts: { Lead: { notes: r } } } });
  assert.equal(out[0].parts.Lead.length, 3, 'learning sees sung notes only');
  assert.equal(out[0].written.Lead.length, 4, 'notation keeps the rest');
  assert.ok(validate({ 9: { parts: { Lead: { notes: r } } } }));
});

test('withRests puts written rests back among sung notes; copyPart copies parts', async () => {
  const { withRests, copyPart, stripRests, toggleRest, toggleFlag } = await import('../js/corrections.js');
  const written = toggleFlag(toggleRest([[60, 0, 1, 1, 'a'], [62, 1, 1, 1, 'b'], [64, 2, 1, 1, 'c'], [65, 3, 1, 1, 'd']], 1), 1, '|');
  const sung = stripRests(written);
  assert.equal(sung[1][5], '|');
  const { notes, map } = withRests(sung, written);
  assert.deepEqual(map, [0, -1, 1, 2]);
  assert.equal(notes[1][5], '|r');
  assert.equal(notes[2][5] || '', '', 'barline shown once, on the rest');
  assert.deepEqual(withRests(sung.slice(1), written).map, [0, 1], 'rests outside the phrase are left out');
  const plain = [[60, 0, 1, 1, 'x']];
  assert.equal(withRests(plain, plain).notes, plain);

  const lead = [[60, 0, 1, 1, 'a'], [62, 1, 1, 1, 'b'], [64, 2, 1, 1, 'c']];
  const tenor = [[64, 0, 1.5, 1, 't'], [65, 1.5, 1.5, 1, 'u']];
  assert.deepEqual(copyPart(tenor, lead, { shift: 12 }).map(n => n[0]), [72, 74, 76]);
  const ph = copyPart(lead, tenor, { t0: 1, t1: 3 });
  assert.deepEqual(ph.map(n => [n[0], n[1]]), [[60, 0], [65, 1.5]], 'only the phrase window is replaced');
  assert.equal(lead[0][0], 60, 'source untouched');
});
