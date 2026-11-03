import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareTags } from '../js/curriculum.js';

const raw = JSON.parse(readFileSync(new URL('../data/tags.json', import.meta.url)));
const PARTS = ['Tenor', 'Lead', 'Bari', 'Bass'];

test('library holds ~100 tags', () => {
  assert.ok(raw.tags.length >= 95, `only ${raw.tags.length} tags`);
});

test('every tag has four transcribed parts in sensible ranges', () => {
  const ids = new Set();
  for (const t of raw.tags) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`); ids.add(t.id);
    assert.ok(t.title);
    for (const p of PARTS) {
      const n = t.parts[p];
      assert.ok(n.length >= 3, `${t.title} ${p}`);
      for (const [m, s, d] of n) {
        assert.ok(Number.isInteger(m) && m >= 30 && m <= 86, `${t.title} ${p} midi ${m}`);
        assert.ok(s >= 0 && d > 0);
      }
      for (let i = 1; i < n.length; i++) assert.ok(n[i][1] >= n[i - 1][1], `${t.title} ${p} sorted`);
      assert.match(t.tracks[p], /^https:\/\//);
    }
  }
});

test('voices are ordered like a barbershop quartet on average', () => {
  const avg = ns => ns.reduce((a, n) => a + n[0], 0) / ns.length;
  let ok = 0;
  for (const t of raw.tags) if (avg(t.parts.Bass.length ? t.parts.Bass : [[0]]) < avg(t.parts.Lead) && avg(t.parts.Bass) < avg(t.parts.Tenor)) ok++;
  assert.ok(ok / raw.tags.length > 0.9, `bass lowest in only ${ok}/${raw.tags.length}`);
});

test('all tags prepare into phrases with difficulty', () => {
  const tags = prepareTags(raw.tags);
  for (const t of tags) {
    assert.ok(t.difficulty > 0);
    for (const p of PARTS) assert.ok(t.phrases[p].length >= 1);
  }
});
