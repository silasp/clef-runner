#!/usr/bin/env node
// Tag fixes and approvals arrive as GitHub issues from the app.
//
//   node tools/apply_corrections.mjs merge   <issue> [body-file]   anyone's fixes → data/corrections.json
//   node tools/apply_corrections.mjs approve <issue> [body-file]   the maintainer's approvals → data/approved.json
//
// Every fix merges at once (anyone can correct a chart), but learners only see
// a corrected chart once the maintainer approves it. An approval names the
// version reviewed (the fix's timestamp, 0 for the generated chart); it is
// refused if the chart changed since, and otherwise snapshots the reviewed
// chart into data/approved.json, so later edits stay invisible to learners
// until they are approved too. Body from the file or ISSUE_BODY. Prints a
// one-line summary. Used by .github/workflows/corrections.yml.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSubmission, mergeStores, parseApproval, applyCorrections } from '../js/corrections.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixesFile = join(root, 'data', 'corrections.json');
const approvedFile = join(root, 'data', 'approved.json');
const [action, issue, bodyFile] = process.argv.slice(2);
if (!['merge', 'approve'].includes(action) || !/^\d+$/.test(issue || '')) {
  console.error('usage: apply_corrections.mjs merge|approve <issue> [body-file]');
  process.exit(2);
}
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const writeLines = (f, obj) => {
  const ids = Object.keys(obj).sort((a, b) => Number(a) - Number(b));
  writeFileSync(f, '{\n' + ids.map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(obj[id])}`).join(',\n') + (ids.length ? '\n' : '') + '}\n');
};
const tags = readJson(join(root, 'data', 'tags.json'), { tags: [] }).tags;
const byId = Object.fromEntries(tags.map(t => [String(t.id), t]));
const title = id => `${byId[id] ? byId[id].title : 'tag ' + id} (#${id})`;
const body = bodyFile ? readFileSync(bodyFile, 'utf8') : process.env.ISSUE_BODY;
const fixes = readJson(fixesFile, {});

if (action === 'merge') {
  const sub = parseSubmission(body);
  const stamped = Object.fromEntries(Object.entries(sub).map(([id, e]) =>
    [id, { ...e, ts: Math.max(e.ts, (fixes[id]?.ts || 0) + 1), issue: Number(issue) }]));
  writeLines(fixesFile, mergeStores(fixes, stamped));
  console.log(Object.entries(sub).map(([id, e]) => {
    const what = e.hide ? 'hide' : Object.entries(e.parts).map(([p, c]) => `${p}${c.notes ? ' edited' : ' checked'}`).join(', ');
    return `${title(id)}: ${what}`;
  }).join('; '));
} else {
  const want = parseApproval(body);          // {id: version}
  const approved = readJson(approvedFile, {});
  const done = [], stale = [];
  for (const [id, version] of Object.entries(want)) {
    const e = fixes[id];
    const current = e ? e.ts : 0;
    if (!byId[id] || current !== version) { stale.push(title(id)); continue; }
    if (e && e.hide) {
      approved[id] = { version, at: new Date().toISOString().slice(0, 10), issue: Number(issue), hide: true };
    } else {
      const [t] = applyCorrections([byId[id]], e ? { [id]: e } : {});
      approved[id] = { version, at: new Date().toISOString().slice(0, 10), issue: Number(issue), parts: t.written || t.parts };
    }
    done.push(title(id));
  }
  writeLines(approvedFile, approved);
  console.log([done.length ? `approved: ${done.join(', ')}` : '', stale.length ? `changed since review (not approved): ${stale.join(', ')}` : '']
    .filter(Boolean).join('; ') || 'nothing to approve');
  if (!done.length) process.exitCode = 3;
}
