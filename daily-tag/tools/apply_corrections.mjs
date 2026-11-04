#!/usr/bin/env node
// Corrections from the app's review screen arrive as GitHub issues with a JSON
// block. Fixes count only once the maintainer has reviewed them:
//
//   node tools/apply_corrections.mjs approve <issue> [body-file]   → merge into data/corrections.json
//   node tools/apply_corrections.mjs pending <issue> [body-file]   → hold in data/pending.json for review
//   node tools/apply_corrections.mjs reject  <issue>               → drop a held submission
//
// The body comes from the file or the ISSUE_BODY env var. "approve" takes the
// held submission for that issue when there is one, so the reviewed version is
// what gets merged. Prints a one-line summary. Used by
// .github/workflows/corrections.yml.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSubmission, mergeStores, validate } from '../js/corrections.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixesFile = join(root, 'data', 'corrections.json');
const pendingFile = join(root, 'data', 'pending.json');
const [action, issue, bodyFile] = process.argv.slice(2);
if (!['approve', 'pending', 'reject'].includes(action) || !/^\d+$/.test(issue || '')) {
  console.error('usage: apply_corrections.mjs approve|pending|reject <issue> [body-file]');
  process.exit(2);
}
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const writeLines = (f, obj, sortNum = true) => {
  const ids = Object.keys(obj).sort((a, b) => (sortNum ? Number(a) - Number(b) : a.localeCompare(b)));
  writeFileSync(f, '{\n' + ids.map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(obj[id])}`).join(',\n') + (ids.length ? '\n' : '') + '}\n');
};
const tags = readJson(join(root, 'data', 'tags.json'), { tags: [] }).tags;
const titles = Object.fromEntries(tags.map(t => [String(t.id), t.title]));
const describe = sub => Object.entries(sub).map(([id, e]) => {
  const what = e.hide ? 'hidden' : Object.entries(e.parts).map(([p, c]) => `${p}${c.notes ? ' edited' : ' checked'}`).join(', ');
  return `${titles[id] || 'tag ' + id} (#${id}): ${what}`;
}).join('; ');

const pending = readJson(pendingFile, {});
const body = () => (bodyFile ? readFileSync(bodyFile, 'utf8') : process.env.ISSUE_BODY);

if (action === 'pending') {
  const sub = parseSubmission(body());
  pending[issue] = { ts: Date.now(), fixes: sub };
  writeLines(pendingFile, pending, false);
  console.log(describe(sub));
} else if (action === 'reject') {
  const held = pending[issue];
  delete pending[issue];
  writeLines(pendingFile, pending, false);
  console.log(held ? `dropped: ${describe(held.fixes)}` : 'nothing held');
} else {
  const sub = pending[issue] ? validate(pending[issue].fixes) : parseSubmission(body());
  delete pending[issue];
  const current = readJson(fixesFile, {});
  // the approved submission is newer than anything in the repo for these tags
  const stamped = Object.fromEntries(Object.entries(sub).map(([id, e]) =>
    [id, { ...e, ts: Math.max(e.ts, (current[id]?.ts || 0) + 1), issue: Number(issue) }]));
  writeLines(fixesFile, mergeStores(current, stamped));
  writeLines(pendingFile, pending, false);
  console.log(describe(sub));
}
