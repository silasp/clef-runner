// Singing assessment end-to-end: synthesises a sung phrase into a WAV,
// feeds it to Chromium as a fake microphone and checks the app scores it.
// Usage: serve the folder, then `node tests/e2e/sing.mjs [tagIndex] [part]`.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { prepareTags } from '../../js/curriculum.js';
import { applyCorrections } from '../../js/corrections.js';
import { midiToFreq } from '../../js/music.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const idx = Number(process.argv[2] || 0);
const part = process.argv[3] || 'Lead';
const raw = JSON.parse(readFileSync(new URL('../../data/tags.json', import.meta.url)));
// the app applies the repo's corrections (and strips rests) before learning: do the same
const fixes = JSON.parse(readFileSync(new URL('../../data/corrections.json', import.meta.url)));
const tag = prepareTags(applyCorrections(raw.tags, fixes))[idx];
const phrase = tag.phrases[part][0];
const wrong = process.env.WRONG === '1';

// --- synth a vowel-ish voice singing the phrase (evenly timed: rhythm shouldn't matter)
const sr = 48000;
const seg = [];
const pushTone = (midi, dur) => {
  const f = midiToFreq(midi);
  const n = Math.round(dur * sr);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 1200, (n - i) / 1200);
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5 * i / sr);
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * vib * h * i / sr) * [1, .6, .4, .25, .15, .1][h - 1];
    seg.push(0.18 * env * v);
  }
};
const silence = d => { for (let i = 0; i < d * sr; i++) seg.push(0); };
silence(1.6);
for (const [m] of phrase) pushTone(wrong ? m + 3 : m, 0.45), silence(0.06);
silence(3);
const pcm = Buffer.alloc(44 + seg.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + seg.length * 2, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(seg.length * 2, 40);
seg.forEach((v, i) => pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
const wav = join(mkdtempSync(join(tmpdir(), 'dt-')), 'voice.wav');
writeFileSync(wav, pcm);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// headless Chromium has no speech service: test pitch only
await page.addInitScript(() => localStorage.setItem('daily-tag:v1', JSON.stringify({ settings: { speech: false } })));
// a stand-in for iOS's audio session: like iOS, it refuses the mic while set to 'playback'
await page.addInitScript(() => {
  const log = [];
  let type = 'auto';
  navigator.audioSession = { get type() { return type; }, set type(v) { type = v; log.push(v); } };
  window.__sessionLog = log;
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = c => (type === 'playback'
    ? Promise.reject(Object.assign(new Error('audio session is playback'), { name: 'InvalidStateError' })) : gum(c));
});
await page.goto(`${BASE}#drill/sing/${tag.id}/${part}/0`);
await page.waitForSelector('[data-act=rec]');
await page.click('[data-act=rec]');
await page.waitForSelector('.feedback:not([hidden])', { timeout: 60000 });
const fb = await page.textContent('.feedback');
const pct = Number((fb.match(/Pitch (\d+)%/) || [])[1]);
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/sing-${wrong ? 'wrong' : 'right'}.png` });
console.log(`${tag.title} / ${part} phrase 1 (${phrase.length} notes): pitch ${pct}%  — ${fb.replace(/\s+/g, ' ').trim()}`);
if (wrong) assert.ok(pct < 60, 'singing a minor third off should not pass (grade < 60% = fail)');
else assert.ok(pct >= 80, 'a correctly sung phrase should score well');
const sessions = await page.evaluate(() => window.__sessionLog);
assert.ok(sessions.includes('play-and-record'), 'records with a play-and-record session: ' + sessions);
assert.equal(sessions[sessions.length - 1], 'playback', 'back to playback once the mic closes: ' + sessions);
assert.deepEqual(errors, []);
await browser.close();
