/* pitch.js — microphone pitch detection (play-along input).
   Polyphonic: an FFT harmonic-sum salience finds every sounding fundamental at
   once, so ringing overtones and open strings no longer drown out the note you
   just played — detect() returns the set of pitch classes that are sounding and
   the game passes if the target is any of them. It also reports the dominant
   pitch (refined to sub-bin accuracy) for the on-screen tuner.
   Note: getUserMedia needs a secure context — works on https or localhost, NOT
   on file:// (serve the app to use the microphone). */
(function (App) {
  'use strict';

  const FFT_SIZE = 4096;  // ~93 ms window @44.1k; bins ~10.8 Hz (harmonic-sum
                          // localises low notes despite the coarse bin spacing)
  const MIDI_LO = 33, MIDI_HI = 93; // semitone search range (~55 Hz .. ~1661 Hz)

  // Live-tunable detection params (exposed as App.Pitch.cfg so the in-game debug
  // panel can fine-tune them). Lower salienceCut = more sensitive (more notes
  // reported); a louder ringing string can otherwise push the note you just
  // played below the threshold and miss it.
  const cfg = {
    mode: 'poly',       // 'poly' = FFT harmonic-sum; 'mono' = autocorrelation
    rmsGate: 0.005,     // input level below which we treat it as silence
    salienceCut: 0.18,  // (poly) a note counts if its salience >= this fraction of the loudest
    harmonics: 8,       // (poly) harmonics summed when scoring each candidate fundamental
    monoClarity: 0.3,   // (mono) minimum autocorrelation clarity to report a pitch
    minFreq: 60,        // a touch below low-E guitar / bass, with margin
    maxFreq: 1600,      // above the top of a guitar's range
  };

  let ctx = null, analyser = null, stream = null, source = null;
  let tbuf = null, fbuf = null, running = false;

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
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0; // no spectral smoothing — react per frame
    source.connect(analyser);
    tbuf = new Float32Array(FFT_SIZE);
    fbuf = new Float32Array(analyser.frequencyBinCount);
    running = true;
    return true;
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (source) try { source.disconnect(); } catch (e) {}
    running = false;
  }

  const freqToMidi = (f) => Math.round(69 + 12 * Math.log2(f / 440));
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Linear magnitude of an FFT bin (the analyser hands back dB).
  function magAt(i) {
    const db = fbuf[i];
    if (!isFinite(db) || db < -110) return 0;
    return Math.pow(10, db / 20);
  }
  // Magnitude at a fractional bin (linear interpolation).
  function magFrac(b) {
    const i = Math.floor(b);
    if (i < 0 || i + 1 >= fbuf.length) return 0;
    const a = magAt(i), c = magAt(i + 1);
    return a + (c - a) * (b - i);
  }

  // Dispatch to the selected detector. Both return the same shape
  // { freq, midi, clarity, rms, pcs, candidates } so the rest of the app doesn't
  // care which one ran.
  function detect() {
    if (!running) return null;
    return cfg.mode === 'mono' ? detectMono() : detectPoly();
  }

  // Improved mono pitch detection: time-domain autocorrelation over the
  // plausible pitch-lag window, picking the first strong peak (the fundamental)
  // so it doesn't drop an octave-and-a-fifth. One pitch only — overtones and
  // ringing strings can mislead it, but it's lighter and very precise.
  function detectMono() {
    const N = 2048; // a 2048-sample sub-window is plenty for autocorrelation
    analyser.getFloatTimeDomainData(tbuf);
    let c0 = 0;
    for (let i = 0; i < N; i++) c0 += tbuf[i] * tbuf[i];
    const rms = Math.sqrt(c0 / N);
    if (rms < cfg.rmsGate || c0 <= 0) return { freq: 0, midi: null, clarity: 0, rms, pcs: [], candidates: [] };

    const sr = ctx.sampleRate;
    const minLag = Math.max(2, Math.floor(sr / cfg.maxFreq));
    const maxLag = Math.min(N - 2, Math.ceil(sr / cfg.minFreq));
    const c = new Float32Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < N; i++) sum += tbuf[i] * tbuf[i + lag];
      c[lag] = sum;
    }
    let maxval = -Infinity, maxpos = -1;
    for (let lag = minLag; lag <= maxLag; lag++) if (c[lag] > maxval) { maxval = c[lag]; maxpos = lag; }
    if (maxpos < 0 || maxval <= 0) return { freq: 0, midi: null, clarity: 0, rms, pcs: [], candidates: [] };

    const thresh = maxval * 0.85;
    let pos = maxpos;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (c[lag] >= thresh && c[lag] > c[lag - 1] && c[lag] >= c[lag + 1]) { pos = lag; break; }
    }
    let T0 = pos;
    const x1 = c[pos - 1] || 0, x2 = c[pos], x3 = c[pos + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
    if (a) T0 = pos - b / (2 * a);

    const clarity = maxval / c0;
    const freq = sr / T0;
    if (freq < cfg.minFreq || freq > cfg.maxFreq || clarity < cfg.monoClarity) return { freq, midi: null, clarity, rms, pcs: [], candidates: [] };
    const midi = freqToMidi(freq);
    const pc = ((midi % 12) + 12) % 12;
    return { freq, midi, clarity, rms, pcs: [pc], candidates: [{ midi, pc, rel: 1, on: true }] };
  }

  // Returns { freq, midi, clarity, rms, pcs, candidates } or null. `pcs` is the
  // set of sounding pitch classes (0..11) at/above the cut; `candidates` lists
  // every local-max note (midi, pc, rel = salience/max, on = at/above cut) for
  // the debug panel; `midi`/`freq` describe the dominant note for the tuner.
  // midi is null and pcs is empty when nothing is playing.
  function detectPoly() {
    analyser.getFloatTimeDomainData(tbuf);
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i++) energy += tbuf[i] * tbuf[i];
    const rms = Math.sqrt(energy / FFT_SIZE);
    if (rms < cfg.rmsGate) return { freq: 0, midi: null, clarity: 0, rms, pcs: [], candidates: [] }; // noise gate

    analyser.getFloatFrequencyData(fbuf);
    const binHz = ctx.sampleRate / FFT_SIZE;

    // Harmonic-sum salience for every semitone in range: a true fundamental
    // lines up all its harmonics and scores high, while an isolated overtone (or
    // a sub-harmonic ghost) only partially aligns and scores lower.
    const sal = new Float32Array(MIDI_HI - MIDI_LO + 1);
    let maxSal = 0;
    for (let m = MIDI_LO; m <= MIDI_HI; m++) {
      const f0 = midiToFreq(m);
      if (f0 < cfg.minFreq || f0 > cfg.maxFreq) continue;
      let s = 0;
      for (let h = 1; h <= cfg.harmonics; h++) {
        const b = (f0 * h) / binHz;
        if (b >= fbuf.length - 1) break;
        s += magFrac(b) / h; // weight the lower harmonics more
      }
      sal[m - MIDI_LO] = s;
      if (s > maxSal) maxSal = s;
    }
    if (maxSal <= 0) return { freq: 0, midi: null, clarity: 0, rms, pcs: [], candidates: [] };

    // Every salience peak above a fraction of the strongest is a sounding note.
    // Leaning low (small cut) favours catching the played note over missing it.
    const cut = maxSal * cfg.salienceCut;
    const show = maxSal * 0.08; // lower floor for what the debug panel lists
    const pcs = [];
    const candidates = [];
    let bestM = -1, bestS = -1;
    for (let i = 0; i < sal.length; i++) {
      const s = sal[i];
      if (s < show) continue;
      if (s < (sal[i - 1] || 0) || s < (sal[i + 1] || 0)) continue; // local max
      const m = MIDI_LO + i;
      const pc = ((m % 12) + 12) % 12;
      const on = s >= cut;
      candidates.push({ midi: m, pc, rel: s / maxSal, on });
      if (on && pcs.indexOf(pc) === -1) pcs.push(pc);
      if (s > bestS) { bestS = s; bestM = m; }
    }
    candidates.sort((a, b) => b.rel - a.rel);
    if (candidates.length > 10) candidates.length = 10;
    if (bestM < 0) return { freq: 0, midi: null, clarity: 0, rms, pcs, candidates };

    // Refine the dominant note's frequency from its spectral peak (for the tuner).
    const f0 = midiToFreq(bestM);
    let freq = f0;
    const lo = Math.max(1, Math.floor((f0 * 0.97) / binHz));
    const hi = Math.min(fbuf.length - 2, Math.ceil((f0 * 1.03) / binHz));
    let pbin = -1, pmag = -Infinity;
    for (let i = lo; i <= hi; i++) { const v = magAt(i); if (v > pmag) { pmag = v; pbin = i; } }
    if (pbin > 0) {
      const a = magAt(pbin - 1), b = magAt(pbin), c = magAt(pbin + 1);
      const den = a - 2 * b + c;
      const d = den ? 0.5 * (a - c) / den : 0;
      freq = (pbin + d) * binHz;
    }

    return { freq, midi: freqToMidi(freq), clarity: bestS / maxSal, rms, pcs, candidates };
  }

  App.Pitch = { start, stop, detect, cfg, isRunning: () => running };
})(window.App = window.App || {});
