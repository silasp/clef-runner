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

  App.Audio = {
    unlock() { ensureCtx(); },
    playMidi,
    playError,
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
  };
})(window.App = window.App || {});
