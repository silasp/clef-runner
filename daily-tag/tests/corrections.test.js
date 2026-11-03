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
