/* theory.js — music model: pitches, MIDI, staff geometry.
   Attaches to the global App namespace (classic script, works via file://). */
(function (App) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // semitone offset of each natural letter within an octave
  const LETTER_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // MIDI 60 = C4 (middle C). midi = (octave+1)*12 + semitone + accidental
  function midiOf(letter, octave, accidental) {
    return (octave + 1) * 12 + LETTER_SEMITONE[letter] + (accidental || 0);
  }

  // "Diatonic step": a strictly increasing integer per staff position
  // (line/space). Adjacent line<->space differ by 1. Used for vertical layout.
  function stepOf(letter, octave) {
    return octave * 7 + LETTERS.indexOf(letter);
  }

  // Build a note descriptor from its musical spelling.
  function makeNote(letter, octave, accidental) {
    accidental = accidental || 0;
    return {
      letter,
      octave,
      accidental, // -1 flat, 0 natural, +1 sharp
      midi: midiOf(letter, octave, accidental),
      step: stepOf(letter, octave),
      name: letter + (accidental === 1 ? '#' : accidental === -1 ? 'b' : '') + octave,
      label: letter + (accidental === 1 ? '♯' : accidental === -1 ? '♭' : ''),
    };
  }

  // Generate all natural notes whose MIDI falls within [loMidi, hiMidi].
  function naturalsInRange(loMidi, hiMidi) {
    const out = [];
    for (let oct = 0; oct <= 8; oct++) {
      for (const letter of LETTERS) {
        const n = makeNote(letter, oct, 0);
        if (n.midi >= loMidi && n.midi <= hiMidi) out.push(n);
      }
    }
    return out.sort((a, b) => a.midi - b.midi);
  }

  // Generate sharped notes (C#, D#, F#, G#, A#) within range — for harder modes.
  function sharpsInRange(loMidi, hiMidi) {
    const out = [];
    const sharpable = ['C', 'D', 'F', 'G', 'A'];
    for (let oct = 0; oct <= 8; oct++) {
      for (const letter of sharpable) {
        const n = makeNote(letter, oct, 1);
        if (n.midi >= loMidi && n.midi <= hiMidi) out.push(n);
      }
    }
    return out.sort((a, b) => a.midi - b.midi);
  }

  // --- Clef geometry -------------------------------------------------------
  // A clef defines which note sits on the middle (3rd) staff line.
  const CLEFS = {
    treble: { glyph: '𝄞', middleStep: stepOf('B', 4) }, // 𝄞 G-clef, middle line B4
    bass: { glyph: '𝄢', middleStep: stepOf('D', 3) },   // 𝄢 F-clef, middle line D3
  };

  // Parse scientific pitch like "C4", "F#5", "Bb3" into a note descriptor.
  function parseNote(str) {
    const m = /^([A-Ga-g])(#|♯|b|♭)?(-?\d+)$/.exec(String(str).trim());
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : (m[2] === 'b' || m[2] === '♭' ? -1 : 0);
    return makeNote(letter, parseInt(m[3], 10), acc);
  }

  // Spell a MIDI number as a note descriptor using sharps (e.g. 70 -> A#4).
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function spellMidi(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    const nm = SHARP_NAMES[pc];
    return makeNote(nm[0], oct, nm.length > 1 ? 1 : 0);
  }

  // --- Key signatures ------------------------------------------------------
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const MAJOR_TONIC = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
  function keySig(fifths) {
    const accMap = {}; const order = [];
    if (fifths > 0) for (let i = 0; i < fifths && i < 7; i++) { accMap[SHARP_ORDER[i]] = 1; order.push({ letter: SHARP_ORDER[i], acc: 1 }); }
    else if (fifths < 0) for (let i = 0; i < -fifths && i < 7; i++) { accMap[FLAT_ORDER[i]] = -1; order.push({ letter: FLAT_ORDER[i], acc: -1 }); }
    return { fifths, accMap, order };
  }
  function keyName(fifths) { return (MAJOR_TONIC[fifths] || 'C') + ' major'; }
  const pcOf = (letter, acc) => (((LETTER_SEMITONE[letter] + acc) % 12) + 12) % 12;
  // map pitch-class -> diatonic {letter,acc} for a key
  function diatonicMap(accMap) {
    const m = {};
    for (const L of LETTERS) { const a = accMap[L] || 0; m[pcOf(L, a)] = { letter: L, acc: a }; }
    return m;
  }
  function octForLetter(midi, letter, acc) {
    return Math.round((midi - LETTER_SEMITONE[letter] - acc) / 12) - 1;
  }
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Spell a MIDI note within a key: diatonic notes keep the key's spelling (so the
  // key signature covers them); chromatic notes get an accidental (flats in flat
  // keys, sharps otherwise).
  function spellMidiInKey(midi, fifths) {
    const { accMap } = keySig(fifths);
    const dia = diatonicMap(accMap);
    const pc = ((midi % 12) + 12) % 12;
    if (dia[pc]) { const d = dia[pc]; return makeNote(d.letter, octForLetter(midi, d.letter, d.acc), d.acc); }
    const nm = (fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc];
    const letter = nm[0], acc = nm.length > 1 ? (fifths < 0 ? -1 : 1) : 0;
    return makeNote(letter, octForLetter(midi, letter, acc), acc);
  }
  // Pick the key signature (fifths -6..+6) that makes the most notes diatonic.
  function estimateFifths(midis) {
    let best = 0, bestCost = 1e9;
    for (let k = -6; k <= 6; k++) {
      const dia = diatonicMap(keySig(k).accMap);
      let cost = 0;
      for (const m of midis) if (!dia[((m % 12) + 12) % 12]) cost++;
      cost += Math.abs(k) * 0.3; // tie-break toward simpler keys
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    return best;
  }

  App.Theory = {
    LETTERS,
    makeNote,
    parseNote,
    spellMidi,
    spellMidiInKey,
    midiOf,
    stepOf,
    naturalsInRange,
    sharpsInRange,
    keySig,
    keyName,
    estimateFifths,
    CLEFS,
    // freq in Hz for a MIDI note (A4 = 440)
    freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); },
    // detected freq -> nearest midi + cents deviation (for the tuner)
    centsOff(freq) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      const ref = 440 * Math.pow(2, (midi - 69) / 12);
      return { midi, cents: Math.round(1200 * Math.log2(freq / ref)) };
    },
  };
})(window.App = window.App || {});
