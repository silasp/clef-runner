/* audio.js — tiny Web Audio synth for note feedback + UI cues. */
(function (App) {
  'use strict';

  let ctx = null;
  let master = null;
  let enabled = true;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    // browsers suspend until a user gesture resumes it
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Pluck/piano-ish tone: two detuned oscillators through a quick envelope.
  function playMidi(midi, dur) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    dur = dur || 0.45;
    const freq = App.Theory.freqOf(midi);
    const t = c.currentTime;
    const g = c.createGain();
    g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    [0, 0.4].forEach((detune, i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  // Short error buzz for a wrong tap.
  function playError() {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime;
    const g = c.createGain();
    g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.2);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.24);
  }

  // Metronome click — bar = loud/high, beat = medium, sub = soft/low.
  const TICK = { bar: { f: 2000, a: 0.5 }, beat: { f: 1500, a: 0.32 }, sub: { f: 1050, a: 0.14 } };
  function tick(level) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const cfg = TICK[level] || TICK.beat;
    const t = c.currentTime;
    const g = c.createGain();
    g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(cfg.a, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = cfg.f;
    o.connect(g);
    o.start(t);
    o.stop(t + 0.06);
  }

  // Triumphant ascending arpeggio + shimmering chord for celebration screens.
  function fanfare() {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const run = [60, 64, 67, 72, 76, 79, 84]; // C-major arpeggio climbing up
    run.forEach((midi, i) => {
      const t = t0 + i * 0.11;
      const freq = App.Theory.freqOf(midi);
      const g = c.createGain(); g.connect(master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      [0, 0.5].forEach((detune, j) => {
        const o = c.createOscillator();
        o.type = j === 0 ? 'triangle' : 'square';
        o.frequency.value = freq; o.detune.value = detune;
        o.connect(g); o.start(t); o.stop(t + 0.55);
      });
    });
    // sustained final chord that rings out
    const tc = t0 + run.length * 0.11;
    [72, 76, 79, 84].forEach((midi) => {
      const g = c.createGain(); g.connect(master);
      g.gain.setValueAtTime(0.0001, tc);
      g.gain.exponentialRampToValueAtTime(0.35, tc + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, tc + 1.3);
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.value = App.Theory.freqOf(midi);
      o.connect(g); o.start(tc); o.stop(tc + 1.35);
    });
  }

  App.Audio = {
    unlock() { ensureCtx(); },
    playMidi,
    playError,
    tick,
    fanfare,
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
  };
})(window.App = window.App || {});
