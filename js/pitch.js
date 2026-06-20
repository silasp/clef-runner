/* pitch.js — microphone pitch detection (play-along input).
   Time-domain autocorrelation with an RMS noise-gate, a clarity threshold and a
   frequency window, so it tolerates intonation drift and background noise.
   Note: getUserMedia needs a secure context — works on https or localhost, NOT
   on file:// (serve the app to use the microphone). */
(function (App) {
  'use strict';

  const SIZE = 2048;
  const MIN_FREQ = 60;    // a touch below low-E guitar / bass, with margin
  const MAX_FREQ = 1600;  // above the top of a guitar's range
  let ctx = null, analyser = null, stream = null, source = null, buf = null, running = false;

  async function start() {
    if (running) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-getusermedia');
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = SIZE;
    source.connect(analyser);
    buf = new Float32Array(SIZE);
    running = true;
    return true;
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (source) try { source.disconnect(); } catch (e) {}
    running = false;
  }

  // Returns { freq, midi, clarity, rms } or null. midi is null when no pitch.
  // Time-domain autocorrelation restricted to the plausible pitch-lag window —
  // this is both faster (so it can run every frame) and avoids picking sub-
  // harmonics that would land on the wrong pitch class. Thresholds lean toward
  // reporting a note: a wrong reading is harmless (the game ignores mismatches),
  // while a missed reading costs a note.
  function detect() {
    if (!running) return null;
    analyser.getFloatTimeDomainData(buf);
    let c0 = 0;
    for (let i = 0; i < SIZE; i++) c0 += buf[i] * buf[i];
    const rms = Math.sqrt(c0 / SIZE);
    if (rms < 0.006 || c0 <= 0) return { freq: 0, midi: null, clarity: 0, rms }; // noise gate

    const sr = ctx.sampleRate;
    const minLag = Math.max(2, Math.floor(sr / MAX_FREQ));
    const maxLag = Math.min(SIZE - 2, Math.ceil(sr / MIN_FREQ));

    const c = new Float32Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < SIZE; i++) sum += buf[i] * buf[i + lag];
      c[lag] = sum;
    }

    // strongest correlation peak in the window …
    let maxval = -Infinity, maxpos = -1;
    for (let lag = minLag; lag <= maxLag; lag++) if (c[lag] > maxval) { maxval = c[lag]; maxpos = lag; }
    if (maxpos < 0 || maxval <= 0) return { freq: 0, midi: null, clarity: 0, rms };

    // … but prefer the FIRST peak that reaches most of it: that's the
    // fundamental period, so we don't report an octave-and-a-fifth too low.
    const thresh = maxval * 0.85;
    let pos = maxpos;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (c[lag] >= thresh && c[lag] > c[lag - 1] && c[lag] >= c[lag + 1]) { pos = lag; break; }
    }

    // parabolic interpolation around the chosen peak
    let T0 = pos;
    const x1 = c[pos - 1] || 0, x2 = c[pos], x3 = c[pos + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
    if (a) T0 = pos - b / (2 * a);

    const clarity = maxval / c0;
    const freq = sr / T0;
    if (freq < MIN_FREQ || freq > MAX_FREQ || clarity < 0.3) return { freq, midi: null, clarity, rms };
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    return { freq, midi, clarity, rms };
  }

  App.Pitch = { start, stop, detect, isRunning: () => running };
})(window.App = window.App || {});
