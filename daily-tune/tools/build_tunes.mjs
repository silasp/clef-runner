#!/usr/bin/env node
// Build data/tunes.json from Clef Runner's tune collections (../js/data):
//   folk  — the Nottingham Music Database (1000 tunes, public domain) and the
//           thesession.org tunes with at least 10 community settings (a
//           popularity signal), first setting of each;
//   swing & jazz — OpenEWLD lead sheets (standards: "Jazz" and "Stage & Screen")
//           and Charlie Parker Omnibook solos (phrases re-joined).
// Each tune is stored compactly — p: MIDI pitches, d: durations in sixteenths,
// bar: quarter beats per bar — and expanded by the app (js/tunes.js), which
// places barlines from the metre (a pickup is the remainder of the length).
//   node tools/build_tunes.mjs [path/to/clef-runner]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || join(here, '..', '..');
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
const load = f => vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx);
load('js/data/manifest.js'); load('js/data/tunes.js');
const App = ctx.App;

// metre by tune type: [quarter beats per bar, compound]
const METRE = {
  Jig: [3, true], Reel: [4, false], Hornpipe: [4, false], 'Slip jig': [4.5, true], Waltz: [3, false],
  Morris: [4, false], Playford: [4, false], Ashover: [4, false], Strathspey: [4, false], March: [4, false],
  'Three-two': [6, false], Slide: [6, true], Polka: [2, false], Mazurka: [3, false], Barndance: [4, false],
};

function notesOf(pitches, durs, res, barLen) {
  const p = pitches.split(',').map(Number), d = durs.split(',').map(Number);
  const beats = d.map(x => x / res);
  const total = beats.reduce((a, b) => a + b, 0);
  const pickup = barLen ? +(total % barLen).toFixed(3) : 0;
  const out = [];
  let t = 0;
  for (let i = 0; i < p.length; i++) {
    const n = [p[i], +t.toFixed(3), +beats[i].toFixed(3), null, ''];
    if (barLen && i > 0) {
      const rel = (t - pickup) / barLen;
      if (rel > 1e-6 && Math.abs(rel - Math.round(rel)) < 1e-6) n.push('|');
      else if (Math.abs(t - pickup) < 1e-6 && pickup > 0) n.push('|');
    }
    out.push(n);
    t += beats[i];
  }
  return out;
}

const tunes = [];
const seen = new Set();
const add = (name, genre, style, notes, source, barLen) => {
  const key = name.toLowerCase().replace(/^the\s+|,\s*the$/g, '').replace(/[^a-z0-9]/g, '');
  if (seen.has(key) || notes.length < 8 || /^missing title/i.test(name)) return;
  const ps = notes.map(n => n[0]);
  if (Math.max(...ps) - Math.min(...ps) > 30) return;          // not a single melodic line
  seen.add(key);
  // compact: pitches and durations (sixteenths) as strings; the app expands them (expandTune)
  tunes.push({ id: key, title: name, genre, style, source, bar: barLen || 0,
    p: ps.join(','), d: notes.map(n => Math.round(n[2] * 4)).join(',') });
};

// thesession.org: popular tunes (≥ 10 settings), first setting
const rows = {};
for (const f of App.SONG_MANIFEST.folk.filter(f => /folk\.\d/.test(f))) {
  App.SONG_RAW = []; load(f);
  for (const [, js] of App.SONG_RAW) {
    const o = JSON.parse(js);
    for (const r of o.t) (rows[r[0]] = rows[r[0]] || { n: 0, first: [r, o] }).n++;
  }
}
const session = Object.entries(rows).filter(([n, v]) => v.n >= 10 && !/^gan ainm/i.test(n) && !/^paddy fahey/i.test(n))
  .sort((a, b) => b[1].n - a[1].n);
for (const [name, v] of session) {
  const [r, o] = v.first;
  const style = o.types[r[3]] || 'Tune';
  const m = METRE[style];
  add(name.replace(/^(.*), The$/, 'The $1'), 'folk', style, notesOf(r[1], r[2], o.res, m && m[0]), 'thesession.org', m && m[0]);
}
// Nottingham Music Database
const F = App.FOLK_TUNES;
for (const t of F.tunes) {
  const style = F.types[t.t] || 'Tune';
  const m = METRE[style];
  add(t.n, 'folk', style, notesOf(t.p, t.d, F.res, m && m[0]), 'Nottingham Music Database', m && m[0]);
}
// OpenEWLD lead sheets
App.SONG_RAW = []; load('js/data/jazz.s0.js');
for (const [, js] of App.SONG_RAW) {
  const o = JSON.parse(js);
  for (const r of o.t) {
    const src = o.srcs[r[3]] || '';
    add(r[0], 'jazz', /Stage/.test(src) ? 'Standard (stage & screen)' : 'Standard', notesOf(r[1], r[2], o.res, 4), 'OpenEWLD lead sheet', 4);
  }
}
// Charlie Parker Omnibook: phrases of a solo, in order
App.SONG_RAW = []; load('js/data/jazz.o0.js');
for (const [, js] of App.SONG_RAW) {
  const o = JSON.parse(js);
  const byName = {};
  for (const r of o.t) (byName[r[0]] = byName[r[0]] || []).push(r);
  for (const [name, rs] of Object.entries(byName)) {
    const p = rs.map(r => r[1]).join(','), d = rs.map(r => r[2]).join(',');
    add(`${name} (Parker solo)`, 'jazz', 'Bebop solo', notesOf(p, d, o.res, 4), 'Charlie Parker Omnibook', 4);
  }
}
const out = { generated: new Date().toISOString().slice(0, 10),
  source: "Clef Runner's tune collections: thesession.org, Nottingham Music Database, OpenEWLD, Charlie Parker Omnibook",
  tunes };
writeFileSync(join(here, '..', 'data', 'tunes.json'), JSON.stringify(out));
const by = {}; for (const t of tunes) by[t.genre + '/' + t.source] = (by[t.genre + '/' + t.source] || 0) + 1;
console.log(tunes.length, 'tunes', by);
