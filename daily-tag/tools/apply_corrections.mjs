#!/usr/bin/env node
// Merge a corrections submission (a GitHub issue body from the app's review
// screen) into data/corrections.json.
//
//   node tools/apply_corrections.mjs issue-body.md        # or ISSUE_BODY env var
//
// Prints a one-line summary. Used by .github/workflows/corrections.yml.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSubmission, mergeStores } from '../js/corrections.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'data', 'corrections.json');
const body = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : process.env.ISSUE_BODY;
const incoming = parseSubmission(body);
const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const tags = JSON.parse(readFileSync(join(root, 'data', 'tags.json'), 'utf8')).tags;
const titles = Object.fromEntries(tags.map(t => [String(t.id), t.title]));

// The submission is newer than anything in the repo for these tags.
const merged = mergeStores(current, Object.fromEntries(Object.entries(incoming).map(([id, e]) => [id, { ...e, ts: Math.max(e.ts, (current[id]?.ts || 0) + 1) }])));

// One tag per line keeps diffs readable.
const ids = Object.keys(merged).sort((a, b) => Number(a) - Number(b));
writeFileSync(file, '{\n' + ids.map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(merged[id])}`).join(',\n') + '\n}\n');

const words = Object.entries(incoming).map(([id, e]) => {
  const what = e.hide ? 'hidden' : Object.entries(e.parts).map(([p, c]) => `${p}${c.notes ? ' edited' : ' checked'}`).join(', ');
  return `${titles[id] || 'tag ' + id} (#${id}): ${what}`;
});
console.log(words.join('; '));
