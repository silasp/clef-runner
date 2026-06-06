/* pitch.js — microphone pitch detection (play-along input).
   Time-domain autocorrelation with an RMS noise-gate, a clarity threshold and a
   frequency window, so it tolerates intonation drift and background noise.
   Note: getUserMedia needs a secure context — works on https or localhost, NOT
   on file:// (serve the app to use the microphone). */
(function (App) {
  'use strict';

  const SIZE = 2048;
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
  function detect() {
    if (!running) return null;
    analyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.012) return { freq: 0, midi: null, clarity: 0, rms }; // noise gate

    // trim near-silent edges
    let r1 = 0, r2 = SIZE - 1; const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
    const n = r2 - r1;
    if (n < 128) return { freq: 0, midi: null, clarity: 0, rms };

    const c = new Float32Array(n);
    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += buf[r1 + i] * buf[r1 + i + lag];
      c[lag] = sum;
    }
    // first ascending zone, then the strongest peak
    let d = 0; while (d < n - 1 && c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < n; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    if (maxpos <= 0) return { freq: 0, midi: null, clarity: 0, rms };

    // parabolic interpolation around the peak
    let T0 = maxpos;
    const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    const clarity = maxval / (c[0] || 1);
    const freq = ctx.sampleRate / T0;
    if (freq < 70 || freq > 1600 || clarity < 0.5) return { freq, midi: null, clarity, rms };
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    return { freq, midi, clarity, rms };
  }

  App.Pitch = { start, stop, detect, isRunning: () => running };
})(window.App = window.App || {});
