/* folktunes.js — provide ~1000 real fiddle tunes (with rhythm) from the
   Nottingham Music Database. Prefers the pre-parsed compact bundle
   (js/data/tunes.js — MIDI + tick durations, no runtime parse, offline +
   file:// friendly). Falls back to a raw-ABC bundle (App.NMD_ABC) or the
   CORS-enabled jsDelivr CDN (both via App.ABC) if present. Folk degrades to the
   curated + generated pool if none are available.
   Source: github.com/jukedeck/nottingham-dataset (public domain). */
(function (App) {
  'use strict';

  const BASE = 'https://cdn.jsdelivr.net/gh/jukedeck/nottingham-dataset@master/ABC_cleaned/';
  const FILES = [
    ['jigs', 'Jig'], ['reelsa-c', 'Reel'], ['reelsd-g', 'Reel'], ['reelsh-l', 'Reel'],
    ['reelsm-q', 'Reel'], ['reelsr-t', 'Reel'], ['reelsu-z', 'Reel'], ['hpps', 'Hornpipe'],
    ['slip', 'Slip jig'], ['waltzes', 'Waltz'], ['morris', 'Morris'], ['playford', 'Playford'],
    ['ashover', 'Ashover'], ['xmas', 'Carol'],
  ];

  let tunes = [];
  let state = 'idle'; // idle | loading | loaded | error
  let origin = '';    // 'local' | 'cdn'
  const cbs = [];
  const notify = () => cbs.forEach((cb) => { try { cb(tunes, state); } catch (e) {} });

  function tuneFromAbc(abc, typeLabel) {
    const p = App.ABC.parseTune(abc, { maxNotes: 64 });
    if (!p) return null;
    const notes = [], durs = [];
    p.notes.forEach((ev) => {
      if (ev.rest) { if (durs.length) durs[durs.length - 1] += ev.dur; return; } // fold rest into prev
      notes.push(ev.note); durs.push(ev.dur);
    });
    if (notes.length < 6) return null;
    return { name: p.title, source: 'trad. · Nottingham DB · ' + typeLabel, notes, durs, meter: p.meter };
  }

  function parseCollection(text, typeLabel, cap) {
    const chunks = text.split(/\n(?=X:\s*\d)/);
    for (const ch of chunks) {
      if (tunes.length >= cap) break;
      if (!/^X:/m.test(ch)) continue;
      const t = tuneFromAbc(ch, typeLabel);
      if (t) tunes.push(t);
    }
  }

  async function load(maxTunes) {
    if (state === 'loaded' || state === 'loading') return tunes;
    state = 'loading';
    const cap = maxTunes || 1000;

    // 1) pre-parsed compact bundle (js/data/tunes.js) — fastest, no ABC parse,
    //    works offline + file://. Format: { res, types, tunes:[{n,t,p,d}] } where
    //    p = comma MIDI, d = comma duration-ticks (dur_beats = ticks / res).
    if (App.FOLK_TUNES && App.Theory) {
      try {
        const D = App.FOLK_TUNES, res = D.res || 4;
        for (const tt of D.tunes) {
          if (tunes.length >= cap) break;
          const notes = tt.p.split(',').map((m) => App.Theory.spellMidi(+m));
          const durs = tt.d.split(',').map((x) => +x / res);
          if (notes.length < 1) continue;
          tunes.push({ name: tt.n, source: 'trad. · Nottingham DB · ' + (D.types[tt.t] || 'Tune'), notes, durs });
        }
        if (tunes.length) { origin = 'local'; state = 'loaded'; notify(); return tunes; }
      } catch (e) { /* fall through */ }
    }

    // 2) raw-ABC bundle (legacy) — parsed at runtime
    if (App.NMD_ABC && App.ABC) {
      try {
        for (const [file, type] of FILES) {
          if (tunes.length >= cap) break;
          const text = App.NMD_ABC[file];
          if (text) parseCollection(text, type, cap);
        }
        if (tunes.length) { origin = 'local'; state = 'loaded'; notify(); return tunes; }
      } catch (e) { /* fall through to CDN */ }
    }

    // 3) CDN fallback (needs js/abc.js)
    try {
      for (const [file, type] of FILES) {
        if (tunes.length >= cap) break;
        let text;
        try {
          const res = await fetch(BASE + file + '.abc', { mode: 'cors' });
          if (!res || !res.ok) continue;
          text = await res.text();
        } catch (e) { continue; }
        parseCollection(text, type, cap);
      }
      if (tunes.length) { origin = 'cdn'; state = 'loaded'; } else { state = 'error'; }
    } catch (e) { state = 'error'; }
    notify();
    return tunes;
  }

  App.FolkTunes = {
    load,
    tunes: () => tunes,
    count: () => tunes.length,
    state: () => state,
    origin: () => origin,
    onLoad: (cb) => cbs.push(cb),
  };
})(window.App = window.App || {});
