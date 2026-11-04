import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../js/pitch.js';
import { freqToMidi } from '../js/music.js';

function voiceLike(freq, sr, n, { harmonics = 5, noise = 0 } = {}) {
  const b = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * freq * h * i / sr) / h;
    b[i] = 0.3 * v + noise * rnd();
  }
  return b;
}

for (const [freq, decimate] of [[98, 1], [146.8, 2], [220, 2], [392, 2], [659.3, 1], [880, 2]]) {
  test(`detects ${freq} Hz (decimate ${decimate})`, () => {
    const r = detectPitch(voiceLike(freq, 48000, 2048), 48000, { decimate, minFreq: 60, maxFreq: 1100 });
    assert.ok(r, 'expected a pitch');
    const cents = Math.abs(freqToMidi(r.freq) - freqToMidi(freq)) * 100;
    assert.ok(cents < 15, `off by ${cents.toFixed(1)} cents (got ${r.freq})`);
  });
}

test('robust to mild noise', () => {
  const r = detectPitch(voiceLike(196, 44100, 2048, { noise: 0.15 }), 44100, { decimate: 2 });
  assert.ok(r && Math.abs(freqToMidi(r.freq) - freqToMidi(196)) < 0.3);
});

test('silence returns null', () => {
  assert.equal(detectPitch(new Float32Array(2048), 44100), null);
});

test('white noise is rejected', () => {
  let seed = 3;
  const b = new Float32Array(2048).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
  assert.equal(detectPitch(b, 44100), null);
});
