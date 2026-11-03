// Web Audio: a light "barbershop-ish" synth voice, pitch pipe, chords,
// feedback sounds, plus streamed playback of the real learning tracks.

import { midiToFreq } from './music.js';

let ctx = null;
let master = null;
let active = [];
let trackEl = null;
let trackTimer = null;

export function hasAudio() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

/** Must be called from a user gesture (iOS). */
export function unlock() {
  if (!hasAudio()) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    // iOS 16.4+/17: play through the silent switch
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
  }
  if (ctx.state === 'suspended') ctx.resume();
  // tiny silent buffer kicks older iOS into gear
  const b = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = b; src.connect(ctx.destination); src.start(0);
  return ctx;
}

export function setVolume(v) { if (master) master.gain.value = v; }

export function stopAll() {
  for (const n of active) { try { n.stop(); } catch (e) { /* already stopped */ } }
  active = [];
  stopTrack();
}

function voice(midi, t0, dur, gain = 0.25) {
  const f = midiToFreq(midi);
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 1.003;
  const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
  const vibGain = ctx.createGain(); vibGain.gain.value = f * 0.004;
  vib.connect(vibGain); vibGain.connect(o1.frequency); vibGain.connect(o2.frequency);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(3200, f * 6); lp.Q.value = 0.7;
  const g = ctx.createGain();
  const a = 0.04, r = Math.min(0.12, dur * 0.3);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + a);
  g.gain.setValueAtTime(gain, t0 + Math.max(a, dur - r));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
  for (const o of [o1, o2, vib]) { o.start(t0); o.stop(t0 + dur + 0.05); active.push(o); }
}

/**
 * Play notes [midi, start, dur]. Rhythm is taken from the recording
 * but can be "evened out" (rhythm doesn't matter for memorising pitch).
 * @param {object} [o]
 * @param {number} [o.rate=1]  playback speed multiplier
 * @param {boolean} [o.even=false]  play each note for a fixed length
 * @param {object} [o.others]  {part: notes} played softly underneath
 * @param {function} [o.onNote] callback(index) as each note starts
 * @returns {number} duration in seconds
 */
export function playNotes(notes, o = {}) {
  if (!unlock() || !notes.length) return 0;
  const { rate = 1, even = false, others = null, onNote, maxDur = 1.6 } = o;
  const t0 = ctx.currentTime + 0.08;
  const origin = notes[0][1];
  let t = 0;
  const timeline = notes.map(n => {
    const start = even ? t : (n[1] - origin) / rate;
    const dur = even ? 0.55 : Math.min(maxDur, Math.max(0.18, n[2] / rate));
    t = start + dur + (even ? 0.05 : 0);
    return [n[0], start, dur];
  });
  // tied notes sound as one: extend the first, don't re-attack
  const tiedOn = i => i > 0 && typeof notes[i - 1][5] === 'string' && notes[i - 1][5].includes('~') && notes[i - 1][0] === notes[i][0];
  for (let i = timeline.length - 1; i > 0; i--) {
    if (tiedOn(i) && !even) timeline[i - 1][2] = Math.max(timeline[i - 1][2], timeline[i][1] + timeline[i][2] - timeline[i - 1][1]);
  }
  timeline.forEach(([m, s, d], i) => {
    if (!tiedOn(i) || even) voice(m, t0 + s, d, 0.28);
    if (onNote) setTimeout(() => onNote(i), (s + 0.08) * 1000);
  });
  const end = timeline.length ? timeline[timeline.length - 1][1] + timeline[timeline.length - 1][2] : 0;
  if (others && !even) {
    const until = notes[notes.length - 1][1] + notes[notes.length - 1][2];
    for (const p of Object.keys(others)) {
      for (const n of others[p]) {
        if (n[1] + n[2] < origin || n[1] > until) continue;
        const s = Math.max(0, (n[1] - origin) / rate);
        voice(n[0], t0 + s, Math.min(maxDur * 1.5, n[2] / rate), 0.09);
      }
    }
  }
  return end + 0.1;
}

export function playChord(midis, dur = 1.6, highlight = null) {
  if (!unlock()) return;
  const t0 = ctx.currentTime + 0.05;
  for (const m of midis) voice(m, t0, dur, m === highlight ? 0.22 : 0.14);
}

export function playNote(midi, dur = 0.5) {
  if (!unlock()) return;
  voice(midi, ctx.currentTime + 0.01, dur, 0.28);
}

/** Pitch-pipe style reference: a pure-ish sine. */
export function pitchPipe(midi, dur = 1.2) {
  if (!unlock()) return;
  const t0 = ctx.currentTime + 0.02;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midiToFreq(midi);
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = midiToFreq(midi) * 2;
  const g = ctx.createGain(); const g2 = ctx.createGain(); g2.gain.value = 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.08);
  g.gain.setValueAtTime(0.3, t0 + dur - 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur); o2.start(t0); o2.stop(t0 + dur);
  active.push(o, o2);
}

export function sfx(kind) {
  if (!unlock()) return;
  const t0 = ctx.currentTime + 0.01;
  const seq = kind === 'good' ? [[76, 0, 0.09], [83, 0.09, 0.16]]
    : kind === 'win' ? [[72, 0, 0.1], [76, 0.1, 0.1], [79, 0.2, 0.1], [84, 0.3, 0.3]]
      : [[52, 0, 0.12], [49, 0.12, 0.2]];
  for (const [m, s, d] of seq) {
    const o = ctx.createOscillator(); o.type = kind === 'bad' ? 'square' : 'triangle';
    o.frequency.value = midiToFreq(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + s);
    g.gain.exponentialRampToValueAtTime(kind === 'bad' ? 0.05 : 0.15, t0 + s + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d);
    o.connect(g); g.connect(master); o.start(t0 + s); o.stop(t0 + s + d + 0.02);
  }
}

// Real learning tracks: one <audio> element per URL, kept so replays are instant.
const trackCache = new Map();
let trackToken = 0;
let trackStateCb = null;
let trackCleanup = null;

function trackFor(url) {
  let el = trackCache.get(url);
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    el.src = url;
    trackCache.set(url, el);
    if (trackCache.size > 6) {                 // keep memory small on old phones
      const [oldUrl, old] = trackCache.entries().next().value;
      if (old !== trackEl) { old.removeAttribute('src'); old.load(); }
      trackCache.delete(oldUrl);
    }
  }
  return el;
}

/** Start downloading a track ahead of time (e.g. when a phrase is shown). */
export function preloadTrack(url) {
  if (url) trackFor(url);
}

export function trackReady(url) {
  const el = trackCache.get(url);
  return !!el && el.readyState >= 3;
}

/**
 * Stream a section of the real learning track (needs network).
 * Call from a tap, so play() starts inside the gesture (iOS). The element
 * is never muted: iOS pauses media that is unmuted outside a gesture.
 * When the file isn't loaded yet, the seek to `start` happens as soon as
 * its metadata arrives (normally before any sound).
 * onState('loading' | 'playing' | 'ended' | 'error'); onEnd(err?) with
 * err.message 'offline' or 'blocked'.
 */
export function playTrack(url, start = 0, end = null, onEnd, { onState } = {}) {
  stopTrack();
  const el = trackFor(url);
  const token = ++trackToken;
  trackEl = el;
  trackStateCb = onState || null;
  const live = () => token === trackToken;
  const target = Math.max(0, start - 0.15);
  let finished = false, started = false;
  const listeners = [];
  const on = (ev, fn) => { el.addEventListener(ev, fn); listeners.push([ev, fn]); };
  const cleanup = () => { for (const [ev, fn] of listeners) el.removeEventListener(ev, fn); listeners.length = 0; clearInterval(trackTimer); };
  trackCleanup = cleanup;
  const finish = err => {
    if (finished) return;
    finished = true;
    cleanup();
    if (live()) { try { el.pause(); } catch (e) { /* ignore */ } trackEl = null; trackStateCb = null; }
    if (onState) onState(err ? 'error' : 'ended');
    if (onEnd) onEnd(err);
  };
  const near = () => Math.abs(el.currentTime - target) < 0.6;
  const seek = () => { try { if (!near()) el.currentTime = target; } catch (e) { /* not seekable yet */ } };
  const markStarted = () => {
    if (!live() || started || el.paused || !near() && el.currentTime < target) return;
    started = true;
    if (onState) onState('playing');
  };
  if (onState) onState(el.readyState >= 3 ? 'playing' : 'loading');
  if (el.readyState >= 1) seek(); else on('loadedmetadata', seek);
  on('playing', () => { if (!near() && el.currentTime < target) seek(); markStarted(); });
  on('seeked', markStarted);
  on('timeupdate', markStarted);
  on('error', () => live() && finish(new Error('offline')));
  on('ended', () => live() && finish());
  on('pause', () => { if (live() && started && !el.seeking) finish(); });   // paused by the OS (call, other app…)
  let p;
  try { p = el.play(); } catch (e) { finish(new Error('blocked')); return; }
  if (p && p.catch) p.catch(e => { if (live() && !(e && e.name === 'AbortError')) finish(new Error(e && e.name === 'NotAllowedError' ? 'blocked' : 'offline')); });
  trackTimer = setInterval(() => {
    if (!live()) { cleanup(); return; }
    if (started && end != null && el.currentTime >= end + 0.25) finish();
  }, 100);
  setTimeout(() => { if (live() && !started && !finished) finish(new Error('offline')); }, 20000);
}

/** Seconds into the playing track, or null when nothing is playing. */
export function trackTime() {
  return trackEl && !trackEl.paused ? trackEl.currentTime : null;
}

/**
 * Follow the playing track through notes [midi, start, dur]: calls
 * onNote(index) when the sung note changes (-1 between notes) and
 * onNote(-1) when playback stops. Returns a stop function.
 */
export function followTrack(notes, onNote) {
  let cur = -2, seen = false;
  const token = trackToken;
  const tick = () => {
    const t = token === trackToken ? trackTime() : null;
    if (t == null) {
      if (seen || !trackEl || token !== trackToken) { clearInterval(timer); if (cur !== -1) onNote(-1); }
      return;
    }
    seen = true;
    let i = -1;
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k];
      if (n[1] - 0.04 <= t && t < n[1] + n[2] + 0.06) { i = k; }
      if (n[1] > t) break;
    }
    if (i !== cur) { cur = i; onNote(i); }
  };
  const timer = setInterval(tick, 50);
  return () => { clearInterval(timer); };
}

export function stopTrack() {
  trackToken++;
  const cb = trackStateCb;
  trackStateCb = null;
  clearInterval(trackTimer);
  if (trackCleanup) { trackCleanup(); trackCleanup = null; }
  if (trackEl) { try { trackEl.pause(); } catch (e) { /* ignore */ } trackEl = null; }
  if (cb) cb('ended');
}

export function context() { return ctx; }
