// Microphone capture: YIN pitch tracking every animation frame, plus
// (optionally) the browser's speech recogniser for the lyrics. On iOS the
// two can fight over the mic; if speech fails we simply carry on with
// pitch only and report lyrics as unavailable.

import { detectPitch } from './pitch.js';
import { freqToMidi } from './music.js';
import { unlock, setSession } from './audio.js';

let stream = null;

export function hasMic() {
  return typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function hasSpeech() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

async function getStream() {
  if (stream && stream.getTracks().some(t => t.readyState === 'live')) return stream;
  // iOS: a 'playback' audio session refuses the microphone
  setSession('play-and-record');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    setSession('playback');
    unlock();
    throw e;
  }
  unlock();   // opening the mic can interrupt the audio context on iOS
  return stream;
}

/** Close the microphone (and give iOS back its loud, silent-switch-proof playback). */
export function releaseMic() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  setSession('playback');
  unlock();
}

/** A short, human reason for a microphone failure. */
export function micError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The microphone is blocked for this site. Allow it in your browser\'s site settings (on iPhone: Settings › your browser › Microphone), then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone found.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The microphone is busy (another app or call?). Close it and try again.';
  return `Microphone unavailable${n ? ` (${n})` : ''}.`;
}

/**
 * Start listening.
 * @param {object} o
 * @param {number} o.minMidi lowest plausible note for this part
 * @param {number} o.maxMidi highest plausible note
 * @param {boolean} [o.speech] also run speech recognition
 * @param {function} [o.onFrame] ({t, midi, rms}) live callback
 * @returns {Promise<{stop: () => Promise<{frames, transcript, speechOk}>}>}
 */
export async function listen(o) {
  const ac = unlock();
  const s = await getStream();
  const src = ac.createMediaStreamSource(s);
  const an = ac.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const frames = [];
  const t0 = performance.now();
  const minFreq = 440 * Math.pow(2, (o.minMidi - 4 - 69) / 12);
  const maxFreq = 440 * Math.pow(2, (o.maxMidi + 5 - 69) / 12);
  // old phones: decimate when the sample rate is high
  const decimate = ac.sampleRate > 30000 ? 2 : 1;
  let running = true;
  let lastTick = 0;

  const tick = now => {
    if (!running) return;
    // ~30 analyses per second is plenty and keeps the iPhone SE cool
    if (now - lastTick >= 30) {
      lastTick = now;
      an.getFloatTimeDomainData(buf);
      const r = detectPitch(buf, ac.sampleRate, { minFreq, maxFreq, decimate, minRms: 0.008 });
      const f = { t: (now - t0) / 1000, midi: r && r.clarity > 0.6 ? freqToMidi(r.freq) : null, rms: r ? r.rms : 0 };
      frames.push(f);
      if (o.onFrame) o.onFrame(f);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // speech
  let transcript = '';
  let speechOk = false;
  let rec = null;
  if (o.speech && hasSpeech()) {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = e => {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript + ' ';
        transcript = txt.trim();
        speechOk = true;
      };
      rec.onerror = () => { /* pitch-only fallback */ };
      rec.start();
      speechOk = true;
    } catch (e) {
      rec = null; speechOk = false;
    }
  }

  return {
    stop: () => new Promise(resolve => {
      running = false;
      try { src.disconnect(); } catch (e) { /* ignore */ }
      const finish = () => resolve({ frames, transcript, speechOk: speechOk && !!rec });
      if (rec) {
        rec.onend = finish;
        try { rec.stop(); } catch (e) { finish(); }
        setTimeout(finish, 900); // some browsers never fire onend
      } else finish();
    }),
  };
}
