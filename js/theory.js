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

  App.Theory = {
    LETTERS,
    makeNote,
    parseNote,
    spellMidi,
    midiOf,
    stepOf,
    naturalsInRange,
    sharpsInRange,
    CLEFS,
    // freq in Hz for a MIDI note (A4 = 440)
    freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); },
  };
})(window.App = window.App || {});
