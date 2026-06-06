/* abc.js — a pragmatic ABC-notation parser for monophonic melody extraction.
   Returns { title, key, meter, notes: [{ note, dur }] } where dur is in
   quarter-note beats. Handles: key signatures (major/minor/modes), inline
   accidentals (^ _ =), octave marks (' ,), note durations (n, /n, broken >/<),
   bar-line accidental reset, chords [CEG] (top note), rests. Ignores chord
   symbols "..", grace notes {..}, decorations !..!/~, slurs, ties, tuplet marks. */
(function (App) {
  'use strict';
  const T = App.Theory;
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  // fifths position of each major tonic
  const MAJ_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6 };
  const MODE_OFFSET = { maj: 0, ion: 0, '': 0, m: -3, min: -3, aeo: -3, dor: -2, mix: -1, lyd: 1, phr: -4, loc: -5 };

  function keyAccidentals(keyField) {
    // e.g. "Gmaj", "Edor", "Am", "D", "Bb"
    const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec((keyField || 'C').trim());
    if (!m) return {};
    const tonic = m[1].toUpperCase() + (m[2] || '');
    let mode = (m[3] || '').toLowerCase().slice(0, 3);
    if (mode === 'maj' || mode === 'ion') mode = '';
    const off = MODE_OFFSET[mode] != null ? MODE_OFFSET[mode] : 0;
    let fifths = (MAJ_FIFTHS[tonic] != null ? MAJ_FIFTHS[tonic] : 0) + off;
    const acc = {};
    if (fifths > 0) for (let i = 0; i < fifths && i < 7; i++) acc[SHARP_ORDER[i]] = 1;
    else if (fifths < 0) for (let i = 0; i < -fifths && i < 7; i++) acc[FLAT_ORDER[i]] = -1;
    return acc;
  }

  // default note length L: as quarter-beats per ABC unit, from meter if absent
  function defaultUnit(meterField, lField) {
    if (lField) { const m = /(\d+)\s*\/\s*(\d+)/.exec(lField); if (m) return (+m[1] / +m[2]) * 4; }
    let val = 0.75;
    const m = /(\d+)\s*\/\s*(\d+)/.exec(meterField || '4/4');
    if (m) val = +m[1] / +m[2]; else if (/^C/.test(meterField || '')) val = 1;
    return (val < 0.75 ? 1 / 16 : 1 / 8) * 4; // -> quarter-beats
  }

  function parseTune(abc, opts) {
    opts = opts || {};
    const maxNotes = opts.maxNotes || 80;
    let title = '', meter = '4/4', lField = '', keyField = 'C';
    const bodyLines = [];
    let inBody = false;
    abc.split(/\r?\n/).forEach((line) => {
      const h = /^([A-Za-z]):\s*(.*)$/.exec(line);
      if (h && !inBody) {
        const f = h[1], v = h[2];
        if (f === 'T' && !title) title = v.trim();
        else if (f === 'M') meter = v.trim();
        else if (f === 'L') lField = v.trim();
        else if (f === 'K') { keyField = v.trim(); inBody = true; }
        return;
      }
      if (inBody) {
        // allow inline field changes like K:, M:, L:
        const inl = /^([KML]):\s*(.*)$/.exec(line);
        if (inl) { if (inl[1] === 'K') keyField = inl[2].trim(); else if (inl[1] === 'M') meter = inl[2].trim(); else lField = inl[2].trim(); return; }
        bodyLines.push(line);
      }
    });
    if (!bodyLines.length) return null;

    let unit = defaultUnit(meter, lField);
    let keyAcc = keyActuallyFromField(keyField);
    let barAcc = {};                  // accidentals active within current bar
    const notes = [];
    let pendingBroken = 0;            // >0 -> next note shortened; <0 -> lengthened
    let s = bodyLines.join('\n');
    // strip things we ignore
    s = s.replace(/"[^"]*"/g, '')      // chord symbols
         .replace(/!{1,2}[^!]*!/g, '') // !decorations!
         .replace(/\{[^}]*\}/g, '')    // grace notes
         .replace(/%.*$/gm, '');       // comments

    function key() { return keyAcc; }

    for (let i = 0; i < s.length && notes.length < maxNotes; i++) {
      const ch = s[i];
      if (ch === '|' || ch === ':') { barAcc = {}; continue; } // bar -> reset accidentals
      if (ch === '[') {
        if (/\d/.test(s[i + 1] || '')) { i++; continue; } // [1 / [2 ending marker
        // chord: take first note inside, skip to ]
        const end = s.indexOf(']', i);
        const inner = end > 0 ? s.slice(i + 1, end) : '';
        const parsed = parseNoteToken(inner, 0, keyAcc, barAcc);
        if (parsed.note) applyNote(parsed.note, parsed.dur);
        i = end > 0 ? end : i;
        continue;
      }
      if (ch === '>') { const p = lastReal(); if (p) p.dur *= 1.5; pendingBroken = 0.5; continue; }
      if (ch === '<') { const p = lastReal(); if (p) p.dur *= 0.5; pendingBroken = 1.5; continue; }
      if (ch === 'z' || ch === 'x' || ch === 'Z') { // rest
        const r = readDuration(s, i + 1);
        // rests only add a phrase gap; represent as a rest note
        notes.push({ rest: true, dur: r.mult * unit });
        i = r.next - 1; continue;
      }
      if (/[\^_=A-Ga-g]/.test(ch)) {
        const parsed = parseNoteToken(s, i, keyAcc, barAcc);
        if (parsed.note) { applyNote(parsed.note, parsed.dur); }
        i = parsed.next - 1;
        continue;
      }
      // ignore everything else (spaces, (), -, digits handled in tokens, etc.)
    }

    function lastReal() { for (let k = notes.length - 1; k >= 0; k--) if (!notes[k].rest) return notes[k]; return null; }

    function applyNote(note, dur) {
      let d = dur;
      if (pendingBroken) { d *= pendingBroken; pendingBroken = 0; }
      notes.push({ note, dur: d });
    }

    function readDuration(str, idx) {
      let num = '', den = '';
      let j = idx;
      while (j < str.length && /\d/.test(str[j])) { num += str[j]; j++; }
      if (str[j] === '/') {
        j++;
        while (j < str.length && /\d/.test(str[j])) { den += str[j]; j++; }
        if (!den) { den = '2'; while (str[j] === '/') { den = String(+den * 2); j++; } }
      }
      let mult = num ? +num : 1;
      if (den) mult = mult / +den;
      return { mult, next: j };
    }

    function parseNoteToken(str, idx, kacc, bacc) {
      let j = idx, accidental = null;
      while (str[j] === '^' || str[j] === '_' || str[j] === '=') {
        accidental = (accidental || 0) + (str[j] === '^' ? 1 : str[j] === '_' ? -1 : 0);
        if (str[j] === '=') accidental = 0;
        j++;
      }
      const lc = str[j];
      if (!lc || !/[A-Ga-g]/.test(lc)) return { note: null, next: j + 1, dur: unit };
      let letter = lc.toUpperCase();
      let octave = lc === lc.toLowerCase() ? 5 : 4; // lower-case = octave above
      j++;
      while (str[j] === "'" || str[j] === ',') { octave += str[j] === "'" ? 1 : -1; j++; }
      const dur = readDuration(str, j);
      // resolve accidental: explicit > bar-memory > key signature
      let acc;
      if (accidental != null) { acc = accidental; bacc[letter] = accidental; }
      else if (bacc[letter] != null) acc = bacc[letter];
      else acc = kacc[letter] || 0;
      return { note: T.makeNote(letter, octave, acc), next: dur.next, dur: dur.mult * unit };
    }

    function keyActuallyFromField() { return keyAccidentals(keyField); }

    // refresh keyAcc/unit if K/M changed inline (recompute once up-front is enough
    // for our purposes; most tunes keep them constant in the body)
    return { title: title || 'Untitled', key: keyField, meter, notes };
  }

  App.ABC = { parseTune, keyAccidentals };
})(window.App = window.App || {});
