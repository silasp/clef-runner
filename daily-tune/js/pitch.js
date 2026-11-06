// YIN pitch detector (de Cheveigné & Kawahara, 2002), tuned to be cheap
// enough for an old iPhone: optional decimation and a bounded lag range.
// Pure function — works on any Float32Array.

/**
 * @param {Float32Array} buf  time-domain samples
 * @param {number} sampleRate
 * @param {object} [opts]
 * @param {number} [opts.minFreq=60]
 * @param {number} [opts.maxFreq=1100]
 * @param {number} [opts.threshold=0.15]
 * @param {number} [opts.decimate=1]  use every Nth sample (2 halves the cost)
 * @param {number} [opts.minRms=0.01] silence gate
 * @returns {{freq:number, clarity:number, rms:number}|null}
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const { minFreq = 60, maxFreq = 1100, threshold = 0.15, decimate = 1, minRms = 0.01 } = opts;
  const step = Math.max(1, decimate | 0);
  const n = Math.floor(buf.length / step);
  const sr = sampleRate / step;
  let rms = 0;
  for (let i = 0; i < n; i++) { const v = buf[i * step]; rms += v * v; }
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return null;

  const tauMin = Math.max(2, Math.floor(sr / maxFreq));
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sr / minFreq));
  const W = n - tauMax;
  if (W <= 0 || tauMax <= tauMin) return null;

  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const diff = buf[i * step] - buf[(i + tau) * step];
      s += diff * diff;
    }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? d[tau] * tau / running : 1;
  }
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) {
    // no dip under threshold: take global minimum if it is reasonably clear
    let best = tauMin;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] > 0.35) return null;
    tauEst = best;
  }
  // parabolic interpolation
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < tauMax) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
  }
  return { freq: sr / betterTau, clarity: 1 - cmnd[tauEst], rms };
}
