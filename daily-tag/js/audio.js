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
  timeline.forEach(([m, s, d], i) => {
    voice(m, t0 + s, d, 0.28);
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
 * Call from a tap: play() starts inside the gesture (iOS), muted until
 * the seek to `start` lands. onState('loading' | 'playing' | 'ended' | 'error').
 */
export function playTrack(url, start = 0, end = null, onEnd, { onState } = {}) {
  stopTrack();
  const el = trackFor(url);
  const token = ++trackToken;
  trackEl = el;
  trackStateCb = onState || null;
  const live = () => token === trackToken;
  const state = s => { if (live() && onState) onState(s); };
  let finished = false;
  const finish = err => {
    if (finished) return;
    finished = true;
    if (live()) { clearInterval(trackTimer); try { el.pause(); } catch (e) { /* ignore */ } trackEl = null; trackStateCb = null; }
    if (onState) onState(err ? 'error' : 'ended');
    if (onEnd) onEnd(err);
  };
  const target = Math.max(0, start - 0.15);
  const seek = () => {
    if (!live()) return;
    try { el.currentTime = target; } catch (e) { /* not seekable yet */ }
  };
  el.muted = true;
  state(el.readyState >= 3 ? 'playing' : 'loading');
  if (el.readyState >= 1) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
  const onPlaying = () => {
    if (!live()) return;
    if (Math.abs(el.currentTime - target) > 0.4) { seek(); return; }
    el.muted = false;
    state('playing');
  };
  el.addEventListener('playing', onPlaying);
  el.addEventListener('seeked', onPlaying);
  el.addEventListener('error', () => live() && finish(new Error('offline')), { once: true });
  el.addEventListener('ended', () => live() && finish(), { once: true });
  const p = el.play();
  if (p && p.catch) p.catch(() => live() && finish(new Error('blocked')));
  clearInterval(trackTimer);
  trackTimer = setInterval(() => {
    if (!live()) { clearInterval(trackTimer); el.removeEventListener('playing', onPlaying); el.removeEventListener('seeked', onPlaying); return; }
    if (!el.muted && end != null && el.currentTime >= end + 0.25) finish();
  }, 100);
  // after 20 s with nothing, give up
  setTimeout(() => { if (live() && el.muted && !finished) finish(new Error('offline')); }, 20000);
}

export function stopTrack() {
  trackToken++;
  const cb = trackStateCb;
  trackStateCb = null;
  if (cb) cb('ended');
  clearInterval(trackTimer);
  if (trackEl) { try { trackEl.pause(); trackEl.muted = true; } catch (e) { /* ignore */ } trackEl = null; }
}

export function context() { return ctx; }
