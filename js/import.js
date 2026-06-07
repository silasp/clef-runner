/* import.js — open a melody from a MIDI (.mid), ABC (.abc) or MusicXML
   (.xml/.musicxml) file. Polyphonic material is reduced to a single melodic
   line (the "skyline": the highest sounding note at each onset). The result is a
   lick-shaped piece {name, notes, durs} that drops straight into the game's
   normal phrase pipeline (so it octave-fits, repeats and, with random-key on,
   transposes). Imported pieces are also registered so they show in the Library. */
(function (App) {
  'use strict';
  const T = App.Theory;

  const imported = []; // {id, name, group:'Imported', kind:'file', lick}

  // snap a raw beat length to a clean note value
  const DUR_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  function snapDur(b) {
    let best = DUR_STEPS[0], bd = 1e9;
    for (const s of DUR_STEPS) { const d = Math.abs(s - b); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  // ---- MIDI (Standard MIDI File) -----------------------------------------
  function isMidi(bytes) {
    return bytes.length > 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64; // "MThd"
  }

  function parseMidi(buf) {
    const dv = new DataView(buf);
    let p = 0;
    const tag = () => { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(dv.getUint8(p++)); return s; };
    if (tag() !== 'MThd') throw new Error('Not a MIDI file.');
    const hlen = dv.getUint32(p); p += 4;
    p += 2; // format
    p += 2; // ntracks (we just read every MTrk chunk we find)
    const division = dv.getUint16(p); p += 2;
    p += (hlen - 6);
    let tpq = (division & 0x8000) ? 480 : division; // PPQ; SMPTE timing → sensible fallback
    if (!tpq) tpq = 480;

    const notes = []; // {start, pitch}
    while (p + 8 <= dv.byteLength) {
      const ck = tag();
      const len = dv.getUint32(p); p += 4;
      const end = Math.min(p + len, dv.byteLength);
      if (ck !== 'MTrk') { p = end; continue; }
      let abs = 0, running = 0;
      const on = {}; // channel*128+pitch -> start tick
      while (p < end) {
        let delta = 0, b;
        do { b = dv.getUint8(p++); delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
        abs += delta;
        let status = dv.getUint8(p);
        if (status & 0x80) { p++; running = status; } else { status = running; }
        if (status === 0xff) { p++; let l = 0, bb; do { bb = dv.getUint8(p++); l = (l << 7) | (bb & 0x7f); } while (bb & 0x80); p += l; continue; }
        if (status === 0xf0 || status === 0xf7) { let l = 0, bb; do { bb = dv.getUint8(p++); l = (l << 7) | (bb & 0x7f); } while (bb & 0x80); p += l; continue; }
        const type = status & 0xf0, ch = status & 0x0f;
        if (type === 0x90 || type === 0x80) {
          const pitch = dv.getUint8(p++); const vel = dv.getUint8(p++);
          const key = ch * 128 + pitch;
          if (type === 0x90 && vel > 0) { on[key] = abs; }
          else if (on[key] != null) { if (ch !== 9) notes.push({ start: on[key], pitch }); delete on[key]; } // skip ch10 drums
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { p += 2; }
        else if (type === 0xc0 || type === 0xd0) { p += 1; }
        else { p++; }
      }
      p = end;
    }
    if (!notes.length) throw new Error('No playable notes found in the MIDI file.');
    return melodyFromOnsets(notes, tpq);
  }

  // Reduce overlapping notes to a monophonic top line on a 16th-note grid.
  function melodyFromOnsets(notes, tpq) {
    const grid = Math.max(1, Math.round(tpq / 4));
    const byOnset = new Map();
    notes.forEach((n) => {
      const q = Math.round(n.start / grid) * grid;
      const cur = byOnset.get(q);
      if (cur == null || n.pitch > cur) byOnset.set(q, n.pitch); // highest note wins (melody)
    });
    const onsets = [...byOnset.keys()].sort((a, b) => a - b);
    const outN = [], outD = [];
    for (let i = 0; i < onsets.length && outN.length < 400; i++) {
      const q = onsets[i];
      const next = i + 1 < onsets.length ? onsets[i + 1] : q + tpq;
      outN.push(T.spellMidi(byOnset.get(q)));
      outD.push(snapDur(Math.max(0.25, Math.min(4, (next - q) / tpq))));
    }
    return { notes: outN, durs: outD };
  }

  // ---- MusicXML -----------------------------------------------------------
  function parseMusicXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not parse MusicXML.');
    const part = doc.getElementsByTagName('part')[0];
    if (!part) throw new Error('No <part> found in the MusicXML.');
    let divisions = 1, firstVoice = null;
    const notes = [], durs = [];
    const measures = part.getElementsByTagName('measure');
    for (let mi = 0; mi < measures.length; mi++) {
      const kids = measures[mi].children;
      for (let ci = 0; ci < kids.length; ci++) {
        const el = kids[ci];
        const tn = el.tagName;
        if (tn === 'attributes') {
          const d = el.getElementsByTagName('divisions')[0];
          if (d) divisions = +d.textContent || divisions;
          continue;
        }
        if (tn !== 'note') continue;
        if (el.getElementsByTagName('grace').length) continue;
        const voice = (el.getElementsByTagName('voice')[0] || {}).textContent;
        if (voice != null) { if (firstVoice == null) firstVoice = voice; else if (voice !== firstVoice) continue; }
        const durEl = el.getElementsByTagName('duration')[0];
        const beats = durEl ? (+durEl.textContent) / divisions : 1;
        const isChord = el.getElementsByTagName('chord').length > 0;
        const pitchEl = el.getElementsByTagName('pitch')[0];
        if (!pitchEl) { // rest: extend the previous note rather than leave a hole
          if (durs.length && !isChord) durs[durs.length - 1] = snapDur(durs[durs.length - 1] + beats);
          continue;
        }
        const step = (pitchEl.getElementsByTagName('step')[0] || {}).textContent;
        const oct = +((pitchEl.getElementsByTagName('octave')[0] || {}).textContent);
        const alter = +((pitchEl.getElementsByTagName('alter')[0] || {}).textContent || 0);
        if (!step) continue;
        const note = T.makeNote(step, oct, alter);
        if (isChord) { // stacked with previous note → keep the higher (top voice)
          if (notes.length && note.midi > notes[notes.length - 1].midi) notes[notes.length - 1] = note;
          continue;
        }
        notes.push(note); durs.push(snapDur(beats));
        if (notes.length >= 400) break;
      }
      if (notes.length >= 400) break;
    }
    if (!notes.length) throw new Error('No notes found in the MusicXML.');
    return { notes, durs };
  }

  // ---- ABC ----------------------------------------------------------------
  function parseAbc(text, fallbackName) {
    const t = App.ABC && App.ABC.parseTune(text, { maxNotes: 400 });
    if (!t || !t.notes.length) return null;
    const notes = [], durs = [];
    t.notes.forEach((ev) => {
      if (ev.rest) { if (durs.length) durs[durs.length - 1] += ev.dur; return; }
      notes.push(ev.note); durs.push(ev.dur);
    });
    if (!notes.length) return null;
    return { name: (t.title && t.title !== 'Untitled') ? t.title : fallbackName, notes, durs };
  }

  // ---- dispatch -----------------------------------------------------------
  async function parseFile(file) {
    const fallback = file.name.replace(/\.[^.]+$/, '');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (isMidi(bytes) || /\.midi?$/i.test(file.name)) {
      return Object.assign({ name: fallback }, parseMidi(buf));
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // "PK" → zip (compressed .mxl)
      throw new Error('Compressed MusicXML (.mxl) isn’t supported — please unzip it to .musicxml first.');
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    if (/<score-(partwise|timewise)|<musicxml|http:\/\/www\.musicxml\.org/i.test(text)) {
      return Object.assign({ name: fallback }, parseMusicXml(text));
    }
    if (/^\s*X:\s*\d/m.test(text) || /^\s*K:/m.test(text)) {
      const piece = parseAbc(text, fallback);
      if (piece) return piece;
    }
    throw new Error('Unrecognised file. Supported: MIDI (.mid), ABC (.abc), MusicXML (.xml/.musicxml).');
  }

  function register(piece) {
    const id = 'file:' + imported.length + ':' + piece.name;
    const item = { id, name: piece.name, group: 'Imported files', kind: 'file', lick: () => ({ name: piece.name, source: 'imported file', notes: piece.notes, durs: piece.durs }) };
    imported.push(item);
    return item;
  }

  App.Import = {
    parseFile,
    register,
    files: () => imported.slice(),
    isSupportedName: (n) => /\.(mid|midi|abc|xml|musicxml|mxl)$/i.test(n || ''),
  };
})(window.App = window.App || {});
