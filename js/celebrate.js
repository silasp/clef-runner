/* celebrate.js — full-screen milestone celebration overlay.
   A colourful animated note fountain cascades over one of many exotic themed
   backgrounds (deep space, the pyramids, a concert hall, under the sea, a
   fireworks night, world capitals, a golden fanfare stage, the northern lights,
   a tropical beach). Each show picks a random theme + encouraging message so the
   experience stays varied and moreish. Pure Canvas — no dependencies. */
(function (App) {
  'use strict';

  const NOTE_GLYPHS = ['♪', '♫', '♬', '♩', '𝅘𝅥𝅮', '🎵', '🎶', '🎼'];
  const KICKERS = ['MILESTONE', 'ACHIEVEMENT UNLOCKED', 'LEVEL UP', 'BRAVO', 'WOW!', 'INCREDIBLE', 'NEW HEIGHTS', 'TAKE A BOW'];
  const MESSAGES = [
    "You're on fire!", 'Keep the rhythm going!', 'Sight-reading superstar!',
    "The notes don't stand a chance!", 'A maestro in the making!', 'Pitch-perfect progress!',
    'Your eyes are racing the staff!', 'Encore! Encore!', "That's the sound of mastery!",
    'Absolutely unstoppable!', 'Bravo, virtuoso!', 'The crowd goes wild!',
    'Reading like a pro!', 'Music to our ears!', "You've got the magic touch!",
    'Climbing the clefs!', 'A legendary performance!', 'Tempo titan!',
    'Total note ninja!', 'Simply spectacular!', 'The staff bows to you!',
    'Hitting every beat!', "You're composing greatness!", 'Standing ovation!',
  ];

  // ---- module state -------------------------------------------------------
  let root, canvas, ctx, kickerEl, titleEl, subEl, locEl;
  let raf = 0, active = false, startT = 0, durMs = 5000, onCloseCb = null;
  let W = 0, H = 0, dpr = 1, theme = null, lastFrame = 0;
  const particles = [];
  const bursts = [];          // firework explosions
  const queue = [];           // pending shows when one is already on screen
  const scene = { stars: [], bubbles: [], skyline: [], city: null };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ---- canvas helpers -----------------------------------------------------
  function vgrad(stops) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function disc(x, y, r, c0, c1) {
    const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  function tri(cx, baseY, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx, baseY - h);
    ctx.lineTo(cx - w / 2, baseY);
    ctx.lineTo(cx + w / 2, baseY);
    ctx.closePath(); ctx.fill();
  }
  function stars(t) {
    ctx.save();
    scene.stars.forEach((s) => {
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = s.c;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 7); ctx.fill();
    });
    ctx.restore();
  }

  // ---- themes -------------------------------------------------------------
  const MIN = () => Math.min(W, H);

  // The world-cities theme (hundreds of locations) is defined lower down as
  // `cityTheme`, built from the PLACES catalog + the LANDMARKS silhouette library.

  const THEMES = [
    {
      key: 'space', label: () => '🚀 Deep Space',
      emojis: ['🚀', '🪐', '⭐', '🌟', '🛸', '☄️'],
      bg(t) {
        vgrad(['#0b0224', '#1b0a3a', '#2a0f4f']);
        stars(t);
        const px = W * 0.82, py = H * 0.28, r = MIN() * 0.12;
        disc(px, py, r, '#ffcf8f', '#8a2bd6');
        ctx.save(); ctx.translate(px, py); ctx.rotate(-0.5); ctx.scale(1, 0.32);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, 7); ctx.stroke(); ctx.restore();
        // shooting star sweeping across
        const sp = (t * 0.35) % 1.6;
        if (sp < 1) {
          const sx = sp * W * 1.2 - W * 0.1, sy = H * 0.18 + sp * H * 0.2;
          const gr = ctx.createLinearGradient(sx - 90, sy - 30, sx, sy);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, '#fff');
          ctx.strokeStyle = gr; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(sx - 90, sy - 30); ctx.lineTo(sx, sy); ctx.stroke();
        }
      },
    },
    {
      key: 'pyramids', label: () => '🐪 The Pyramids of Giza',
      emojis: ['🐪', '☀️', '🏜️', '🪙', '🎶', '✨'],
      bg(t) {
        vgrad(['#ffe6a8', '#f7b65a', '#e07b39']);
        disc(W * 0.5, H * 0.4, MIN() * 0.14, '#fff6cf', '#ffb24a');
        const baseY = H * 0.9;
        tri(W * 0.32, baseY, MIN() * 0.5, MIN() * 0.42, '#6b3a1c');
        tri(W * 0.62, baseY, MIN() * 0.64, MIN() * 0.54, '#7d4621');
        tri(W * 0.85, baseY, MIN() * 0.4, MIN() * 0.34, '#5b2f17');
        ctx.fillStyle = '#d99a55'; ctx.fillRect(0, baseY, W, H - baseY);
        // heat shimmer specks
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i < 6; i++) {
          const x = (i / 6 + t * 0.02) % 1 * W;
          ctx.fillRect(x, baseY + 6 + (i % 3) * 8, 30, 2);
        }
      },
    },
    {
      key: 'concert', label: () => '🎻 The Concert Hall',
      emojis: ['🎻', '🎷', '🎺', '🎹', '👏', '🌹'],
      bg(t) {
        vgrad(['#2a0d14', '#4a121f', '#1c0710']);
        // sweeping spotlights from the top
        for (let i = 0; i < 3; i++) {
          const cx = W * (0.25 + 0.25 * i) + Math.sin(t * 0.8 + i) * W * 0.08;
          const grd = ctx.createLinearGradient(W / 2, 0, cx, H);
          grd.addColorStop(0, 'rgba(255,225,150,0.30)');
          grd.addColorStop(1, 'rgba(255,225,150,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.moveTo(W / 2, -10);
          ctx.lineTo(cx - W * 0.16, H); ctx.lineTo(cx + W * 0.16, H);
          ctx.closePath(); ctx.fill();
        }
        // stage floor + curtain folds
        ctx.fillStyle = '#120308'; ctx.fillRect(0, H * 0.82, W, H * 0.18);
        ctx.fillStyle = 'rgba(120,18,34,0.5)';
        for (let i = 0; i < 10; i++) {
          const x = i / 10 * W;
          ctx.beginPath(); ctx.moveTo(x, 0);
          ctx.quadraticCurveTo(x + W * 0.05, H * 0.2, x, H * 0.42);
          ctx.lineTo(x + W * 0.05, H * 0.42);
          ctx.quadraticCurveTo(x + W * 0.05, H * 0.2, x + W * 0.1, 0);
          ctx.closePath(); ctx.fill();
        }
      },
    },
    {
      key: 'sea', label: () => '🐠 Under the Sea',
      emojis: ['🐠', '🐟', '🐙', '🐚', '🫧', '🐬', '🎵'],
      bg(t) {
        vgrad(['#063a5e', '#0a5b86', '#0e87b8']);
        // god rays
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const x = W * (0.1 + i * 0.25) + Math.sin(t * 0.3 + i) * 20;
          const grd = ctx.createLinearGradient(x, 0, x + W * 0.12, H);
          grd.addColorStop(0, 'rgba(180,240,255,0.18)');
          grd.addColorStop(1, 'rgba(180,240,255,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.18, 0);
          ctx.lineTo(x + W * 0.30, H); ctx.lineTo(x + W * 0.06, H); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        // rising bubbles
        ctx.fillStyle = 'rgba(220,250,255,0.5)';
        scene.bubbles.forEach((b) => {
          const y = (b.y - t * b.sp) % 1; const yy = (y < 0 ? y + 1 : y) * H;
          ctx.beginPath(); ctx.arc(b.x * W + Math.sin(yy * 0.03) * 12, H - yy, b.r, 0, 7); ctx.stroke();
          ctx.beginPath(); ctx.arc(b.x * W + Math.sin(yy * 0.03) * 12, H - yy, b.r, 0, 7);
          ctx.strokeStyle = 'rgba(220,250,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
        });
        // seabed
        ctx.fillStyle = '#0a2e3f';
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 8) ctx.lineTo(x, H * 0.9 + Math.sin(x * 0.01 + t) * 8);
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      },
    },
    {
      key: 'fireworks', label: () => '🎆 Fireworks Night',
      emojis: ['🎆', '🎇', '✨', '🎵', '🎶', '🌟'],
      spawnBursts: true,
      bg(t) {
        vgrad(['#05010f', '#0a0420', '#120a30']);
        stars(t);
        // distant city glow on the horizon
        ctx.fillStyle = 'rgba(40,20,70,0.8)'; ctx.fillRect(0, H * 0.85, W, H * 0.15);
        ctx.fillStyle = 'rgba(255,210,120,0.15)';
        for (let i = 0; i < 30; i++) ctx.fillRect((i / 30) * W, H * 0.86 + (i % 4) * 5, 6, 14);
      },
    },
    {
      key: 'fanfare', label: () => '🎺 Grand Fanfare',
      emojis: ['🎺', '🎷', '🏆', '🥇', '👑', '✨'],
      bg(t) {
        vgrad(['#3a2400', '#7a4d00', '#caa12a']);
        // rotating sunburst rays
        ctx.save(); ctx.translate(W / 2, H * 0.42);
        const n = 18;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + t * 0.25;
          ctx.fillStyle = i % 2 ? 'rgba(255,236,170,0.18)' : 'rgba(255,210,90,0.10)';
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, MIN(), a, a + Math.PI / n); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        disc(W / 2, H * 0.42, MIN() * 0.13, '#fff6d0', '#ffce5a');
      },
    },
    {
      key: 'aurora', label: () => '🌌 The Northern Lights',
      emojis: ['🌌', '❄️', '⛷️', '🎵', '✨', '🦌'],
      bg(t) {
        vgrad(['#020616', '#06122e', '#0a2233']);
        stars(t);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const cols = ['rgba(60,255,170,0.16)', 'rgba(120,140,255,0.14)', 'rgba(220,110,255,0.12)'];
        cols.forEach((c, k) => {
          ctx.fillStyle = c; ctx.beginPath();
          const baseY = H * (0.18 + k * 0.1);
          ctx.moveTo(0, baseY);
          for (let x = 0; x <= W; x += W / 24) ctx.lineTo(x, baseY + Math.sin(x * 0.012 + t * 1.2 + k) * 40);
          for (let x = W; x >= 0; x -= W / 24) ctx.lineTo(x, baseY + 80 + Math.sin(x * 0.012 + t + k) * 40);
          ctx.closePath(); ctx.fill();
        });
        ctx.restore();
        // snowy ground
        ctx.fillStyle = '#dfe9ff'; ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 6) ctx.lineTo(x, H * 0.86 + Math.sin(x * 0.008) * 10);
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      },
    },
    {
      key: 'beach', label: () => '🏝️ Tropical Beach',
      emojis: ['🏝️', '🌴', '🐚', '🍹', '☀️', '🎵', '🏖️'],
      bg(t) {
        vgrad(['#79c8ff', '#bfe9ff', '#fff2c4']);
        disc(W * 0.2, H * 0.28, MIN() * 0.1, '#fff6d0', '#ffd35a');
        // sea
        ctx.fillStyle = '#1c9fd0'; ctx.fillRect(0, H * 0.55, W, H * 0.2);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const y = H * 0.58 + i * H * 0.03;
          ctx.beginPath();
          for (let x = 0; x <= W; x += W / 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + t * 2 + i) * 3);
          ctx.stroke();
        }
        // sand
        ctx.fillStyle = '#f6e2a8'; ctx.beginPath(); ctx.moveTo(0, H);
        ctx.quadraticCurveTo(W * 0.5, H * 0.68, W, H * 0.74); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
        // palm
        ctx.strokeStyle = '#6b4322'; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(W * 0.82, H); ctx.quadraticCurveTo(W * 0.86, H * 0.6, W * 0.8, H * 0.5); ctx.stroke();
        ctx.fillStyle = '#1f9d55';
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i - 2.5) * 0.5 + Math.sin(t + i) * 0.04;
          ctx.save(); ctx.translate(W * 0.8, H * 0.5); ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(MIN() * 0.12, 0, MIN() * 0.12, 10, 0, 0, 7); ctx.fill(); ctx.restore();
        }
      },
    },
  ];

  // =========================================================================
  // WORLD CITIES THEME — hundreds of locations.
  // A hand-authored library of distinct landmark silhouettes (LANDMARKS) for the
  // iconic places, plus a deterministic procedural skyline seeded by city name so
  // every long-tail city renders a unique silhouette. Sky palette is randomised
  // per show. All vector — offline, no assets, no licensing.
  // =========================================================================

  // deterministic per-city RNG so each city's skyline is unique but stable
  function hashStr(s) { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // sky palettes (day / sunset / dusk / night / golden / teal / purple night)
  const SKY = [
    { stops: ['#7ec8ff', '#bfe9ff', '#eef7ff'], night: false, sun: '#fff6d0', sun2: '#ffd35a', acc: '#ffd98a' },
    { stops: ['#2a2350', '#7a3f6a', '#ff9e5e'], night: false, sun: '#fff0c0', sun2: '#ff7e4a', acc: '#ffd9a0' },
    { stops: ['#142244', '#3a4a7a', '#ffb08a'], night: false, sun: '#ffe9c0', sun2: '#ff9e7a', acc: '#ffe1a0' },
    { stops: ['#05030f', '#0a0a24', '#141436'], night: true, acc: '#ffe1a0' },
    { stops: ['#3a2a00', '#b9772a', '#ffd27a'], night: false, sun: '#fff6d0', sun2: '#ffbe5a', acc: '#fff0c0' },
    { stops: ['#04303a', '#0a6b6b', '#28c0a8'], night: false, sun: '#eafff6', sun2: '#7fe6c8', acc: '#d6fff0' },
    { stops: ['#1a0830', '#3a1060', '#b14a9a'], night: true, acc: '#ffd0f0' },
  ];

  // landmark silhouette colour + warm accent (set per show from the palette)
  let LMC = 'rgba(9,11,20,0.88)';
  let LMA = '#ffe1a0';
  function box(x, y, w, h) { ctx.fillStyle = LMC; ctx.fillRect(x, y, w, h); }
  function peak(cx, by, w, h) { tri(cx, by, w, h, LMC); }
  function semi(cx, by, r, sx) { ctx.save(); ctx.translate(cx, by); ctx.scale(1, sx || 1); ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.restore(); }
  function onion(cx, by, w, h) { ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - w / 2, by); ctx.quadraticCurveTo(cx - w * 0.62, by - h * 0.55, cx, by - h); ctx.quadraticCurveTo(cx + w * 0.62, by - h * 0.55, cx + w / 2, by); ctx.closePath(); ctx.fill(); box(cx - 1.5, by - h - h * 0.22, 3, h * 0.22); }
  function lights(x, y, w, h) { ctx.fillStyle = LMA; for (let yy = y + 6; yy < y + h - 3; yy += 11) for (let xx = x + 5; xx < x + w - 4; xx += 8) if ((((xx * 3 + yy * 7) % 5)) < 2) ctx.fillRect(xx, yy, 3, 4); }
  function moon() { disc(W * 0.8, H * 0.26, MIN() * 0.07, '#fdf6d8', '#cfd6e8'); }
  function sun(pal) { disc(W * 0.8, H * 0.28, MIN() * 0.085, pal.sun || '#fff3d0', pal.sun2 || '#ff9e5a'); }

  // ---- landmark silhouettes (cx = centre, by = ground line, S = size unit) ----
  const LANDMARKS = {
    eiffel(cx, by, S) {
      const h = S * 1.05; ctx.strokeStyle = LMC; ctx.fillStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.014);
      ctx.beginPath();
      ctx.moveTo(cx - h * 0.22, by); ctx.lineTo(cx - h * 0.05, by - h); ctx.lineTo(cx + h * 0.05, by - h); ctx.lineTo(cx + h * 0.22, by);
      ctx.moveTo(cx - h * 0.15, by - h * 0.38); ctx.lineTo(cx + h * 0.15, by - h * 0.38);
      ctx.moveTo(cx - h * 0.09, by - h * 0.66); ctx.lineTo(cx + h * 0.09, by - h * 0.66);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - h * 0.22, by); ctx.quadraticCurveTo(cx, by - h * 0.16, cx + h * 0.22, by); ctx.stroke();
      box(cx - 1.5, by - h - h * 0.05, 3, h * 0.05);
    },
    bigben(cx, by, S) {
      const h = S * 0.95, w = h * 0.16; box(cx - w / 2, by - h, w, h); lights(cx - w / 2, by - h * 0.45, w, h * 0.45);
      ctx.fillStyle = LMA; ctx.beginPath(); ctx.arc(cx, by - h + w * 0.75, w * 0.3, 0, 7); ctx.fill();
      peak(cx, by - h, w * 1.15, w * 0.95);
    },
    towerbridge(cx, by, S) {
      const w = S * 1.3, th = S * 0.7, tw = S * 0.16; const lx = cx - w * 0.3, rx = cx + w * 0.3;
      box(cx - w / 2, by - S * 0.12, w, S * 0.06); // deck
      [lx, rx].forEach((x) => { box(x - tw / 2, by - th, tw, th); peak(x, by - th, tw * 1.2, tw * 0.7); });
      ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.02);
      ctx.beginPath(); ctx.moveTo(lx, by - th * 0.55); ctx.lineTo(rx, by - th * 0.55); ctx.stroke(); // high walkway
      ctx.beginPath(); ctx.moveTo(cx - w / 2, by - S * 0.12); ctx.quadraticCurveTo(lx, by + S * 0.05, lx, by - th * 0.4); ctx.moveTo(rx, by - th * 0.4); ctx.quadraticCurveTo(rx, by + S * 0.05, cx + w / 2, by - S * 0.12); ctx.stroke();
    },
    liberty(cx, by, S) {
      const h = S * 0.92; box(cx - S * 0.13, by - h * 0.14, S * 0.26, h * 0.14); // pedestal
      box(cx - S * 0.06, by - h * 0.75, S * 0.12, h * 0.61); // robe
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(cx, by - h * 0.8, S * 0.06, 0, 7); ctx.fill(); // head
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.26; box(cx + Math.cos(a) * S * 0.08 - 1, by - h * 0.8 + Math.sin(a) * S * 0.08 - 1, 2.5, S * 0.05); } // crown
      box(cx + S * 0.03, by - h, S * 0.035, h * 0.28); // raised arm
      ctx.fillStyle = LMA; ctx.beginPath(); ctx.arc(cx + S * 0.045, by - h - S * 0.01, S * 0.035, 0, 7); ctx.fill(); // torch
    },
    tokyotower(cx, by, S) {
      const h = S * 1.05; ctx.strokeStyle = LMC; ctx.fillStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.016);
      ctx.beginPath(); ctx.moveTo(cx - h * 0.2, by); ctx.lineTo(cx, by - h); ctx.lineTo(cx + h * 0.2, by);
      ctx.moveTo(cx - h * 0.11, by - h * 0.45); ctx.lineTo(cx + h * 0.11, by - h * 0.45); ctx.stroke();
      box(cx - h * 0.13, by - h * 0.62, h * 0.26, h * 0.08); // observation deck
      box(cx - 2, by - h - h * 0.12, 4, h * 0.12);
    },
    skytree(cx, by, S) {
      const h = S * 1.15; box(cx - S * 0.03, by - h, S * 0.06, h);
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(cx, by - h * 0.62, S * 0.09, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, by - h * 0.82, S * 0.06, 0, 7); ctx.fill();
    },
    operahouse(cx, by, S) {
      const w = S * 1.1; box(cx - w * 0.46, by - S * 0.06, w * 0.92, S * 0.06);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(cx - w * 0.28 + i * w * 0.19, by - S * 0.04); ctx.scale(1, 1.5); ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(0, 0, w * 0.15 - i * w * 0.012, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.restore(); }
    },
    harbourbridge(cx, by, S) {
      const w = S * 1.4; box(cx - w / 2, by - S * 0.1, w, S * 0.05);
      ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(3, S * 0.03);
      ctx.beginPath(); ctx.moveTo(cx - w / 2, by - S * 0.1); ctx.quadraticCurveTo(cx, by - S * 0.62, cx + w / 2, by - S * 0.1); ctx.stroke();
      ctx.lineWidth = Math.max(1, S * 0.01);
      for (let i = 1; i < 10; i++) { const x = cx - w / 2 + (w * i) / 10; const yT = by - S * 0.1 - (S * 0.52) * Math.sin((i / 10) * Math.PI); ctx.beginPath(); ctx.moveTo(x, by - S * 0.1); ctx.lineTo(x, yT); ctx.stroke(); }
    },
    christredeemer(cx, by, S) {
      peak(cx, by, S * 1.0, S * 0.5); // hill
      const top = by - S * 0.5, h = S * 0.5; box(cx - S * 0.03, top - h, S * 0.06, h * 0.9); // body
      box(cx - S * 0.26, top - h * 0.78, S * 0.52, S * 0.04); // outstretched arms
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(cx, top - h, S * 0.045, 0, 7); ctx.fill();
    },
    colosseum(cx, by, S) {
      const w = S * 1.1, h = S * 0.5; ctx.fillStyle = LMC;
      ctx.beginPath(); ctx.ellipse(cx, by - h, w / 2, h, 0, Math.PI, 0); ctx.lineTo(cx + w / 2, by); ctx.ellipse(cx, by, w / 2, h * 0.4, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
      // arch openings (cut with accent so it reads as arches)
      ctx.fillStyle = LMA; for (let r = 0; r < 2; r++) for (let i = 0; i < 9; i++) { const x = cx - w * 0.42 + i * w * 0.105; ctx.fillRect(x, by - h * 0.7 + r * h * 0.5, w * 0.045, h * 0.32); }
    },
    leaningtower(cx, by, S) {
      ctx.save(); ctx.translate(cx, by); ctx.rotate(0.12); const h = S * 0.8, w = S * 0.16;
      for (let i = 0; i < 6; i++) { box(-w / 2, -h + i * (h / 6), w, h / 6 - 2); }
      ctx.restore();
    },
    tajmahal(cx, by, S) {
      box(cx - S * 0.5, by - S * 0.12, S * 1.0, S * 0.12); // plinth
      [-0.42, 0.42].forEach((d) => box(cx + d * S - S * 0.02, by - S * 0.62, S * 0.04, S * 0.5)); // outer minarets
      [-0.24, 0.24].forEach((d) => box(cx + d * S - S * 0.018, by - S * 0.55, S * 0.036, S * 0.43));
      box(cx - S * 0.22, by - S * 0.38, S * 0.44, S * 0.26); // main building
      onion(cx, by - S * 0.38, S * 0.34, S * 0.42); // central dome
      [-0.16, 0.16].forEach((d) => onion(cx + d * S, by - S * 0.36, S * 0.12, S * 0.14));
    },
    burjkhalifa(cx, by, S) {
      const h = S * 1.3; for (let i = 0; i < 5; i++) { const w = S * (0.22 - i * 0.035); box(cx - w / 2, by - h * (0.2 + i * 0.16), w, h * 0.18); }
      box(cx - 2, by - h, 4, h * 0.2); lights(cx - S * 0.11, by - h * 0.6, S * 0.22, h * 0.5);
    },
    spaceneedle(cx, by, S) {
      const h = S * 1.0; ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(3, S * 0.025);
      ctx.beginPath(); ctx.moveTo(cx - S * 0.06, by); ctx.lineTo(cx - S * 0.02, by - h * 0.7); ctx.moveTo(cx + S * 0.06, by); ctx.lineTo(cx + S * 0.02, by - h * 0.7); ctx.stroke();
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.ellipse(cx, by - h * 0.72, S * 0.18, S * 0.06, 0, 0, 7); ctx.fill();
      box(cx - 1.5, by - h, 3, h * 0.28);
    },
    goldengate(cx, by, S) {
      const w = S * 1.4, th = S * 0.75; const lx = cx - w * 0.28, rx = cx + w * 0.28;
      box(cx - w / 2, by - S * 0.14, w, S * 0.04);
      [lx, rx].forEach((x) => { box(x - S * 0.02, by - th, S * 0.04, th); box(x - S * 0.05, by - th * 0.7, S * 0.1, S * 0.03); });
      ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.018);
      ctx.beginPath(); ctx.moveTo(cx - w / 2, by - S * 0.18); ctx.quadraticCurveTo(lx, by - th * 0.45, lx, by - th); ctx.moveTo(lx, by - th); ctx.quadraticCurveTo(cx, by - th * 0.4, rx, by - th); ctx.moveTo(rx, by - th); ctx.quadraticCurveTo(cx + w / 2, by - th * 0.45, cx + w / 2, by - S * 0.18); ctx.stroke();
    },
    brandenburg(cx, by, S) {
      const w = S * 0.9, h = S * 0.5; box(cx - w / 2, by - h, w, h * 0.18); // entablature
      for (let i = 0; i < 6; i++) box(cx - w / 2 + i * (w / 5.5) + w * 0.02, by - h * 0.82, w * 0.06, h * 0.82); // columns
      box(cx - S * 0.05, by - h - S * 0.16, S * 0.1, S * 0.05); // quadriga base
      box(cx - S * 0.06, by - h - S * 0.13, S * 0.12, S * 0.02);
    },
    stbasils(cx, by, S) {
      box(cx - S * 0.3, by - S * 0.3, S * 0.6, S * 0.3);
      onion(cx, by - S * 0.5, S * 0.22, S * 0.34);
      [-0.34, -0.18, 0.18, 0.34].forEach((d, i) => onion(cx + d * S, by - S * 0.3 - (i % 2 ? S * 0.04 : 0), S * 0.14, S * 0.22 + (i % 2 ? S * 0.04 : 0)));
    },
    sagrada(cx, by, S) {
      box(cx - S * 0.32, by - S * 0.3, S * 0.64, S * 0.3);
      [-0.26, -0.1, 0.1, 0.26].forEach((d, i) => { const h = S * (0.62 + (i === 1 || i === 2 ? 0.18 : 0)); const x = cx + d * S; ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(x - S * 0.05, by - S * 0.3); ctx.quadraticCurveTo(x, by - h, x + S * 0.05, by - S * 0.3); ctx.fill(); });
    },
    petronas(cx, by, S) {
      const h = S * 1.15; [-0.2, 0.2].forEach((d) => { const x = cx + d * S; for (let i = 0; i < 5; i++) { const w = S * (0.16 - i * 0.022); box(x - w / 2, by - h * (0.18 + i * 0.16), w, h * 0.17); } box(x - 1.5, by - h, 3, h * 0.16); lights(x - S * 0.07, by - h * 0.55, S * 0.14, h * 0.45); });
      ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.02); ctx.beginPath(); ctx.moveTo(cx - S * 0.2, by - h * 0.5); ctx.lineTo(cx + S * 0.2, by - h * 0.5); ctx.stroke(); // skybridge
    },
    cntower(cx, by, S) {
      const h = S * 1.25; box(cx - S * 0.03, by - h * 0.78, S * 0.06, h * 0.78);
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.ellipse(cx, by - h * 0.72, S * 0.12, S * 0.05, 0, 0, 7); ctx.fill();
      box(cx - 1.5, by - h, 3, h * 0.22);
    },
    gatewayarch(cx, by, S) {
      ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(4, S * 0.05); ctx.beginPath();
      ctx.moveTo(cx - S * 0.4, by); ctx.quadraticCurveTo(cx, by - S * 0.95, cx + S * 0.4, by); ctx.stroke();
    },
    sphinxpyramid(cx, by, S) {
      peak(cx + S * 0.18, by, S * 0.95, S * 0.62); peak(cx - S * 0.4, by, S * 0.6, S * 0.4);
      box(cx - S * 0.05, by - S * 0.14, S * 0.34, S * 0.14); // sphinx body
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(cx - S * 0.07, by - S * 0.18, S * 0.06, 0, 7); ctx.fill(); // sphinx head
    },
    parthenon(cx, by, S) {
      const w = S * 0.9, h = S * 0.5; box(cx - w / 2, by - h * 0.3, w, h * 0.1);
      for (let i = 0; i < 8; i++) box(cx - w / 2 + i * (w / 7.5) + w * 0.02, by - h * 0.85, w * 0.05, h * 0.55);
      box(cx - w / 2, by - h, w, h * 0.16); peak(cx, by - h, w, h * 0.28); // pediment
    },
    atomium(cx, by, S) {
      const r = S * 0.1, pts = [[0, -0.55], [-0.32, -0.28], [0.32, -0.28], [-0.32, 0.0], [0.32, 0.0], [0, -0.28], [0, 0.05]];
      ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.02);
      ctx.beginPath(); ctx.moveTo(cx, by - S * 0.05); ctx.lineTo(cx, by - S * 0.55); ctx.stroke();
      pts.forEach((p) => { ctx.fillStyle = LMC; ctx.beginPath(); ctx.arc(cx + p[0] * S, by + p[1] * S - S * 0.05, r, 0, 7); ctx.fill(); });
    },
    greatwall(cx, by, S) {
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(0, by);
      for (let x = 0; x <= W; x += W / 10) ctx.lineTo(x, by - S * 0.18 - S * 0.16 * Math.abs(Math.sin(x * 0.01)));
      ctx.lineTo(W, by); ctx.closePath(); ctx.fill();
      for (let i = 1; i < 6; i++) { const x = (W * i) / 6; box(x - S * 0.04, by - S * 0.36, S * 0.08, S * 0.2); }
    },
    capitoldome(cx, by, S) {
      box(cx - S * 0.4, by - S * 0.22, S * 0.8, S * 0.22);
      for (let i = 0; i < 9; i++) box(cx - S * 0.36 + i * S * 0.09, by - S * 0.34, S * 0.03, S * 0.12);
      semi(cx, by - S * 0.34, S * 0.18, 1.4); box(cx - 2, by - S * 0.62, 4, S * 0.08);
    },
    obelisk(cx, by, S) {
      const h = S * 0.95; ctx.fillStyle = LMC; ctx.beginPath();
      ctx.moveTo(cx - S * 0.04, by); ctx.lineTo(cx - S * 0.028, by - h * 0.88); ctx.lineTo(cx, by - h); ctx.lineTo(cx + S * 0.028, by - h * 0.88); ctx.lineTo(cx + S * 0.04, by); ctx.closePath(); ctx.fill();
    },
    taipei101(cx, by, S) {
      const h = S * 1.2; box(cx - S * 0.06, by - h * 0.28, S * 0.12, h * 0.28);
      for (let i = 0; i < 8; i++) { const w = S * 0.16; ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - w / 2, by - h * (0.28 + i * 0.09)); ctx.lineTo(cx + w / 2, by - h * (0.28 + i * 0.09)); ctx.lineTo(cx + w * 0.4, by - h * (0.28 + i * 0.09 + 0.085)); ctx.lineTo(cx - w * 0.4, by - h * (0.28 + i * 0.09 + 0.085)); ctx.closePath(); ctx.fill(); }
      box(cx - 1.5, by - h, 3, h * 0.06);
    },
    orientalpearl(cx, by, S) {
      const h = S * 1.15; ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(3, S * 0.03);
      ctx.beginPath(); ctx.moveTo(cx, by); ctx.lineTo(cx, by - h); ctx.stroke();
      ctx.fillStyle = LMC; [[0.42, 0.13], [0.66, 0.09], [0.9, 0.05]].forEach(([yy, rr]) => { ctx.beginPath(); ctx.arc(cx, by - h * yy, S * rr, 0, 7); ctx.fill(); });
    },
    neuschwanstein(cx, by, S) {
      peak(cx, by, S * 1.5, S * 0.35); const base = by - S * 0.3;
      box(cx - S * 0.28, base - S * 0.3, S * 0.56, S * 0.3);
      [-0.24, 0.0, 0.26].forEach((d, i) => { const x = cx + d * S, th = S * (0.5 + (i === 2 ? 0.18 : 0)); box(x - S * 0.06, base - th, S * 0.12, th); peak(x, base - th, S * 0.14, S * 0.16); });
    },
    windmill(cx, by, S) {
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - S * 0.16, by); ctx.lineTo(cx - S * 0.1, by - S * 0.5); ctx.lineTo(cx + S * 0.1, by - S * 0.5); ctx.lineTo(cx + S * 0.16, by); ctx.closePath(); ctx.fill();
      peak(cx, by - S * 0.5, S * 0.28, S * 0.14);
      ctx.save(); ctx.translate(cx, by - S * 0.5); ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(3, S * 0.03);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * S * 0.3, Math.sin(a) * S * 0.3); ctx.stroke(); } ctx.restore();
    },
    bluemosque(cx, by, S) {
      box(cx - S * 0.34, by - S * 0.32, S * 0.68, S * 0.32);
      onion(cx, by - S * 0.32, S * 0.4, S * 0.34); semi(cx, by - S * 0.32, S * 0.2, 0.9);
      [-0.4, -0.2, 0.2, 0.4].forEach((d) => { const x = cx + d * S; box(x - S * 0.022, by - S * 0.7, S * 0.044, S * 0.7); ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(x - S * 0.03, by - S * 0.7); ctx.lineTo(x, by - S * 0.8); ctx.lineTo(x + S * 0.03, by - S * 0.7); ctx.fill(); });
    },
    tablemountain(cx, by, S) {
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - S * 0.7, by); ctx.lineTo(cx - S * 0.55, by - S * 0.46); ctx.lineTo(cx + S * 0.55, by - S * 0.5); ctx.lineTo(cx + S * 0.7, by); ctx.closePath(); ctx.fill();
    },
    matterhorn(cx, by, S) {
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - S * 0.55, by); ctx.lineTo(cx - S * 0.05, by - S * 0.85); ctx.lineTo(cx + S * 0.12, by - S * 0.72); ctx.lineTo(cx + S * 0.55, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eef3ff'; ctx.beginPath(); ctx.moveTo(cx - S * 0.05, by - S * 0.85); ctx.lineTo(cx - S * 0.14, by - S * 0.6); ctx.lineTo(cx + S * 0.05, by - S * 0.64); ctx.lineTo(cx + S * 0.12, by - S * 0.72); ctx.closePath(); ctx.fill();
    },
    hollywood(cx, by, S) {
      peak(cx, by, S * 1.7, S * 0.4); ctx.fillStyle = '#f2f2f2'; ctx.font = `800 ${S * 0.16}px ui-sans-serif,system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('HOLLYWOOD', cx, by - S * 0.28);
    },
    steppyramid(cx, by, S) {
      for (let i = 0; i < 5; i++) { const w = S * (0.8 - i * 0.14); box(cx - w / 2, by - S * (0.09 + i * 0.09), w, S * 0.09); }
      box(cx - S * 0.05, by - S * 0.56, S * 0.1, S * 0.1); // temple on top
    },
    gatewayindia(cx, by, S) {
      const w = S * 0.7, h = S * 0.6; box(cx - w / 2, by - h, w, h);
      ctx.fillStyle = LMA; ctx.beginPath(); ctx.moveTo(cx - w * 0.18, by); ctx.lineTo(cx - w * 0.18, by - h * 0.6); ctx.quadraticCurveTo(cx, by - h * 0.85, cx + w * 0.18, by - h * 0.6); ctx.lineTo(cx + w * 0.18, by); ctx.closePath(); ctx.fill();
      [-0.5, 0.5].forEach((d) => box(cx + d * w - S * 0.03, by - h - S * 0.06, S * 0.06, S * 0.08));
    },
    marinabay(cx, by, S) {
      [-0.26, 0, 0.26].forEach((d) => box(cx + d * S - S * 0.05, by - S * 0.8, S * 0.1, S * 0.8));
      ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - S * 0.4, by - S * 0.84); ctx.quadraticCurveTo(cx, by - S * 0.98, cx + S * 0.4, by - S * 0.84); ctx.lineTo(cx + S * 0.36, by - S * 0.78); ctx.lineTo(cx - S * 0.36, by - S * 0.78); ctx.closePath(); ctx.fill();
    },
    campanile(cx, by, S) {
      const h = S * 0.95, w = S * 0.13; box(cx - w / 2, by - h, w, h); lights(cx - w / 2, by - h * 0.85, w, h * 0.6);
      box(cx - w * 0.6, by - h * 0.92, w * 1.2, h * 0.06); peak(cx, by - h, w, w * 1.1);
    },
    duomo(cx, by, S) {
      box(cx - S * 0.3, by - S * 0.34, S * 0.6, S * 0.34); ctx.fillStyle = LMC;
      ctx.beginPath(); ctx.moveTo(cx - S * 0.22, by - S * 0.34); ctx.quadraticCurveTo(cx, by - S * 0.78, cx + S * 0.22, by - S * 0.34); ctx.closePath(); ctx.fill();
      box(cx - S * 0.03, by - S * 0.86, S * 0.06, S * 0.1);
      box(cx + S * 0.34, by - S * 0.7, S * 0.1, S * 0.7); // campanile
    },
    cathedral(cx, by, S) {
      box(cx - S * 0.3, by - S * 0.4, S * 0.6, S * 0.4); ctx.fillStyle = LMA; ctx.beginPath(); ctx.arc(cx, by - S * 0.3, S * 0.07, 0, 7); ctx.fill(); // rose window
      [-0.26, 0.26].forEach((d) => { const x = cx + d * S; box(x - S * 0.06, by - S * 0.66, S * 0.12, S * 0.66); ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(x - S * 0.07, by - S * 0.66); ctx.lineTo(x, by - S * 0.92); ctx.lineTo(x + S * 0.07, by - S * 0.66); ctx.fill(); });
    },
    castle(cx, by, S) {
      box(cx - S * 0.4, by - S * 0.45, S * 0.8, S * 0.45);
      [-0.4, 0.4].forEach((d) => { const x = cx + d * S; box(x - S * 0.08, by - S * 0.62, S * 0.16, S * 0.62); for (let i = 0; i < 3; i++) box(x - S * 0.08 + i * S * 0.06, by - S * 0.66, S * 0.04, S * 0.05); });
      ctx.fillStyle = LMA; ctx.beginPath(); ctx.moveTo(cx - S * 0.06, by); ctx.lineTo(cx - S * 0.06, by - S * 0.22); ctx.quadraticCurveTo(cx, by - S * 0.34, cx + S * 0.06, by - S * 0.22); ctx.lineTo(cx + S * 0.06, by); ctx.closePath(); ctx.fill();
    },
    pavilion(cx, by, S) {
      for (let i = 0; i < 3; i++) { const w = S * (0.5 - i * 0.1), y = by - S * (0.14 + i * 0.16); box(cx - w / 2, y, w, S * 0.14); ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - w * 0.62, y); ctx.lineTo(cx, y - S * 0.1); ctx.lineTo(cx + w * 0.62, y); ctx.closePath(); ctx.fill(); }
      box(cx - 2, by - S * 0.62, 4, S * 0.05);
    },
    pagoda(cx, by, S) {
      box(cx - S * 0.06, by - S * 0.1, S * 0.12, S * 0.1);
      for (let i = 0; i < 5; i++) { const w = S * (0.5 - i * 0.08), y = by - S * (0.1 + i * 0.14); ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.quadraticCurveTo(cx, y - S * 0.04, cx + w / 2, y); ctx.lineTo(cx + w * 0.36, y - S * 0.1); ctx.lineTo(cx - w * 0.36, y - S * 0.1); ctx.closePath(); ctx.fill(); }
    },
  };

  // generic-but-distinct civic features for long-tail cities (chosen by seed)
  const FEATURES = [
    function civicDome(cx, by, S) { box(cx - S * 0.3, by - S * 0.2, S * 0.6, S * 0.2); semi(cx, by - S * 0.2, S * 0.16, 1.3); box(cx - 1.5, by - S * 0.44, 3, S * 0.06); for (let i = 0; i < 6; i++) box(cx - S * 0.24 + i * S * 0.1, by - S * 0.3, S * 0.03, S * 0.1); },
    function clockTower(cx, by, S) { const h = S * 0.8, w = h * 0.18; box(cx - w / 2, by - h, w, h); lights(cx - w / 2, by - h * 0.4, w, h * 0.4); ctx.fillStyle = LMA; ctx.beginPath(); ctx.arc(cx, by - h + w * 0.7, w * 0.3, 0, 7); ctx.fill(); peak(cx, by - h, w * 1.1, w * 0.7); },
    function modernSpire(cx, by, S) { const h = S * 1.0; ctx.fillStyle = LMC; ctx.beginPath(); ctx.moveTo(cx - S * 0.1, by); ctx.lineTo(cx - S * 0.04, by - h * 0.8); ctx.lineTo(cx, by - h); ctx.lineTo(cx + S * 0.04, by - h * 0.8); ctx.lineTo(cx + S * 0.1, by); ctx.closePath(); ctx.fill(); lights(cx - S * 0.07, by - h * 0.7, S * 0.14, h * 0.6); },
    function stadium(cx, by, S) { ctx.fillStyle = LMC; ctx.beginPath(); ctx.ellipse(cx, by - S * 0.04, S * 0.55, S * 0.26, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = LMA; ctx.beginPath(); ctx.ellipse(cx, by - S * 0.12, S * 0.4, S * 0.12, 0, Math.PI, 0); ctx.fill(); },
    function towerCluster(cx, by, S) { [-0.34, -0.12, 0.12, 0.34].forEach((d, i) => { const w = S * 0.18, h = S * (0.55 + (i % 2 ? 0.3 : 0.05)); box(cx + d * S - w / 2, by - h, w, h); lights(cx + d * S - w / 2, by - h * 0.9, w, h * 0.8); }); },
    function riverBridge(cx, by, S) { box(0, by - S * 0.04, W, S * 0.02); ctx.strokeStyle = LMC; ctx.lineWidth = Math.max(2, S * 0.02); for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(cx + k * S * 0.5, by + S * 0.12, S * 0.28, Math.PI, 0); ctx.stroke(); } },
    function obeliskF(cx, by, S) { LANDMARKS.obelisk(cx, by, S); box(cx - S * 0.16, by - S * 0.05, S * 0.32, S * 0.05); },
    function pagodaF(cx, by, S) { LANDMARKS.pagoda(cx, by, S); },
  ];

  // ---- deterministic, per-city procedural skyline -------------------------
  function drawSkyline(topRef, alpha, rnd) {
    ctx.fillStyle = `rgba(6,8,16,${alpha})`;
    let x = 0;
    const band = H - topRef;
    while (x < W) {
      const bw = W * (0.035 + rnd() * 0.05);
      const bh = band * (0.35 + rnd() * 1.15);
      const by = H - bh;
      ctx.fillRect(x, by, bw - 2, bh);
      if (rnd() < 0.25) ctx.fillRect(x + bw * 0.4, by - bh * 0.12, bw * 0.12, bh * 0.12); // antenna/spire
      x += bw;
    }
    // a sparse scatter of warm lit windows over the same band
    ctx.fillStyle = LMA;
    const lr = mulberry32((alpha * 99991 + topRef) | 0);
    for (let i = 0; i < W / 6; i++) { if (lr() < 0.10) ctx.fillRect(lr() * W, topRef + lr() * band * 1.4, 3, 4); }
  }

  // ---- world cities catalog (city, country, flag, landmark key | undefined) --
  // No key → a unique procedural skyline + a seeded civic feature.
  const PLACES = [
    ['Paris', 'France', '🇫🇷', 'eiffel'], ['Lyon', 'France', '🇫🇷'], ['Marseille', 'France', '🇫🇷'], ['Nice', 'France', '🇫🇷'], ['Bordeaux', 'France', '🇫🇷'],
    ['London', 'United Kingdom', '🇬🇧', 'bigben'], ['London', 'United Kingdom', '🇬🇧', 'towerbridge'], ['Edinburgh', 'Scotland', '🏴', 'castle'], ['Manchester', 'United Kingdom', '🇬🇧'], ['Liverpool', 'United Kingdom', '🇬🇧'], ['Dublin', 'Ireland', '🇮🇪'],
    ['Berlin', 'Germany', '🇩🇪', 'brandenburg'], ['Munich', 'Germany', '🇩🇪', 'neuschwanstein'], ['Hamburg', 'Germany', '🇩🇪'], ['Cologne', 'Germany', '🇩🇪', 'cathedral'], ['Frankfurt', 'Germany', '🇩🇪'],
    ['Rome', 'Italy', '🇮🇹', 'colosseum'], ['Milan', 'Italy', '🇮🇹', 'cathedral'], ['Venice', 'Italy', '🇮🇹', 'campanile'], ['Florence', 'Italy', '🇮🇹', 'duomo'], ['Pisa', 'Italy', '🇮🇹', 'leaningtower'], ['Naples', 'Italy', '🇮🇹'], ['Turin', 'Italy', '🇮🇹'],
    ['Vatican City', 'Vatican', '🇻🇦', 'duomo'],
    ['Madrid', 'Spain', '🇪🇸'], ['Barcelona', 'Spain', '🇪🇸', 'sagrada'], ['Seville', 'Spain', '🇪🇸'], ['Valencia', 'Spain', '🇪🇸'],
    ['Lisbon', 'Portugal', '🇵🇹'], ['Porto', 'Portugal', '🇵🇹'],
    ['Amsterdam', 'Netherlands', '🇳🇱', 'windmill'], ['Rotterdam', 'Netherlands', '🇳🇱'], ['Brussels', 'Belgium', '🇧🇪', 'atomium'], ['Bruges', 'Belgium', '🇧🇪'],
    ['Vienna', 'Austria', '🇦🇹', 'cathedral'], ['Prague', 'Czechia', '🇨🇿', 'castle'], ['Budapest', 'Hungary', '🇭🇺'], ['Warsaw', 'Poland', '🇵🇱'], ['Kraków', 'Poland', '🇵🇱'],
    ['Athens', 'Greece', '🇬🇷', 'parthenon'], ['Santorini', 'Greece', '🇬🇷'],
    ['Moscow', 'Russia', '🇷🇺', 'stbasils'], ['Saint Petersburg', 'Russia', '🇷🇺'], ['Kyiv', 'Ukraine', '🇺🇦'],
    ['Stockholm', 'Sweden', '🇸🇪'], ['Oslo', 'Norway', '🇳🇴'], ['Copenhagen', 'Denmark', '🇩🇰'], ['Helsinki', 'Finland', '🇫🇮'], ['Reykjavik', 'Iceland', '🇮🇸'],
    ['Zürich', 'Switzerland', '🇨🇭'], ['Geneva', 'Switzerland', '🇨🇭'], ['Zermatt', 'Switzerland', '🇨🇭', 'matterhorn'],
    ['Istanbul', 'Türkiye', '🇹🇷', 'bluemosque'], ['Ankara', 'Türkiye', '🇹🇷'],
    ['New York', 'USA', '🇺🇸', 'liberty'], ['Los Angeles', 'USA', '🇺🇸', 'hollywood'], ['San Francisco', 'USA', '🇺🇸', 'goldengate'], ['Chicago', 'USA', '🇺🇸'], ['Seattle', 'USA', '🇺🇸', 'spaceneedle'],
    ['Washington', 'USA', '🇺🇸', 'capitoldome'], ['Boston', 'USA', '🇺🇸'], ['Las Vegas', 'USA', '🇺🇸'], ['Miami', 'USA', '🇺🇸'], ['St. Louis', 'USA', '🇺🇸', 'gatewayarch'], ['New Orleans', 'USA', '🇺🇸'], ['Houston', 'USA', '🇺🇸'], ['Philadelphia', 'USA', '🇺🇸'], ['Honolulu', 'USA', '🇺🇸'],
    ['Toronto', 'Canada', '🇨🇦', 'cntower'], ['Vancouver', 'Canada', '🇨🇦'], ['Montréal', 'Canada', '🇨🇦'], ['Ottawa', 'Canada', '🇨🇦'],
    ['Mexico City', 'Mexico', '🇲🇽'], ['Chichén Itzá', 'Mexico', '🇲🇽', 'steppyramid'], ['Cancún', 'Mexico', '🇲🇽'], ['Guadalajara', 'Mexico', '🇲🇽'],
    ['Rio de Janeiro', 'Brazil', '🇧🇷', 'christredeemer'], ['São Paulo', 'Brazil', '🇧🇷'], ['Brasília', 'Brazil', '🇧🇷'], ['Salvador', 'Brazil', '🇧🇷'],
    ['Buenos Aires', 'Argentina', '🇦🇷', 'obelisk'], ['Lima', 'Peru', '🇵🇪'], ['Cusco', 'Peru', '🇵🇪'], ['Santiago', 'Chile', '🇨🇱'], ['Bogotá', 'Colombia', '🇨🇴'], ['Cartagena', 'Colombia', '🇨🇴'], ['Havana', 'Cuba', '🇨🇺'], ['Quito', 'Ecuador', '🇪🇨'], ['Montevideo', 'Uruguay', '🇺🇾'],
    ['Tokyo', 'Japan', '🇯🇵', 'tokyotower'], ['Tokyo', 'Japan', '🇯🇵', 'skytree'], ['Osaka', 'Japan', '🇯🇵', 'castle'], ['Kyoto', 'Japan', '🇯🇵', 'pavilion'], ['Yokohama', 'Japan', '🇯🇵'], ['Sapporo', 'Japan', '🇯🇵'], ['Nara', 'Japan', '🇯🇵', 'pagoda'],
    ['Beijing', 'China', '🇨🇳', 'greatwall'], ['Shanghai', 'China', '🇨🇳', 'orientalpearl'], ['Hong Kong', 'China', '🇭🇰'], ['Guangzhou', 'China', '🇨🇳'], ["Xi'an", 'China', '🇨🇳', 'pagoda'], ['Shenzhen', 'China', '🇨🇳'], ['Chengdu', 'China', '🇨🇳'],
    ['Taipei', 'Taiwan', '🇹🇼', 'taipei101'], ['Seoul', 'South Korea', '🇰🇷'], ['Busan', 'South Korea', '🇰🇷'],
    ['Singapore', 'Singapore', '🇸🇬', 'marinabay'], ['Kuala Lumpur', 'Malaysia', '🇲🇾', 'petronas'],
    ['Bangkok', 'Thailand', '🇹🇭', 'pavilion'], ['Chiang Mai', 'Thailand', '🇹🇭'], ['Hanoi', 'Vietnam', '🇻🇳'], ['Ho Chi Minh City', 'Vietnam', '🇻🇳'], ['Siem Reap', 'Cambodia', '🇰🇭', 'pagoda'],
    ['Jakarta', 'Indonesia', '🇮🇩'], ['Bali', 'Indonesia', '🇮🇩'], ['Manila', 'Philippines', '🇵🇭'],
    ['Mumbai', 'India', '🇮🇳', 'gatewayindia'], ['New Delhi', 'India', '🇮🇳'], ['Agra', 'India', '🇮🇳', 'tajmahal'], ['Jaipur', 'India', '🇮🇳', 'castle'], ['Bengaluru', 'India', '🇮🇳'], ['Kolkata', 'India', '🇮🇳'], ['Chennai', 'India', '🇮🇳'],
    ['Kathmandu', 'Nepal', '🇳🇵', 'pagoda'], ['Colombo', 'Sri Lanka', '🇱🇰'],
    ['Dubai', 'UAE', '🇦🇪', 'burjkhalifa'], ['Abu Dhabi', 'UAE', '🇦🇪', 'bluemosque'], ['Doha', 'Qatar', '🇶🇦'], ['Riyadh', 'Saudi Arabia', '🇸🇦'], ['Jeddah', 'Saudi Arabia', '🇸🇦'],
    ['Jerusalem', 'Israel', '🇮🇱', 'bluemosque'], ['Tel Aviv', 'Israel', '🇮🇱'], ['Amman', 'Jordan', '🇯🇴'], ['Beirut', 'Lebanon', '🇱🇧'], ['Tehran', 'Iran', '🇮🇷'],
    ['Cairo', 'Egypt', '🇪🇬', 'sphinxpyramid'], ['Giza', 'Egypt', '🇪🇬', 'sphinxpyramid'], ['Marrakesh', 'Morocco', '🇲🇦'], ['Casablanca', 'Morocco', '🇲🇦', 'bluemosque'],
    ['Cape Town', 'South Africa', '🇿🇦', 'tablemountain'], ['Johannesburg', 'South Africa', '🇿🇦'], ['Nairobi', 'Kenya', '🇰🇪'], ['Lagos', 'Nigeria', '🇳🇬'], ['Accra', 'Ghana', '🇬🇭'], ['Addis Ababa', 'Ethiopia', '🇪🇹'], ['Tunis', 'Tunisia', '🇹🇳'], ['Algiers', 'Algeria', '🇩🇿'], ['Dakar', 'Senegal', '🇸🇳'],
    ['Sydney', 'Australia', '🇦🇺', 'operahouse'], ['Sydney', 'Australia', '🇦🇺', 'harbourbridge'], ['Melbourne', 'Australia', '🇦🇺'], ['Brisbane', 'Australia', '🇦🇺'], ['Perth', 'Australia', '🇦🇺'],
    ['Auckland', 'New Zealand', '🇳🇿'], ['Wellington', 'New Zealand', '🇳🇿'], ['Queenstown', 'New Zealand', '🇳🇿', 'matterhorn'],
    // — more of the world (unique seeded skylines unless a landmark is noted) —
    ['Stuttgart', 'Germany', '🇩🇪'], ['Düsseldorf', 'Germany', '🇩🇪'], ['Dresden', 'Germany', '🇩🇪'],
    ['Birmingham', 'United Kingdom', '🇬🇧'], ['Glasgow', 'Scotland', '🏴'], ['Cardiff', 'Wales', '🏴'], ['Belfast', 'United Kingdom', '🇬🇧'],
    ['The Hague', 'Netherlands', '🇳🇱'], ['Antwerp', 'Belgium', '🇧🇪'], ['Luxembourg', 'Luxembourg', '🇱🇺'],
    ['Bratislava', 'Slovakia', '🇸🇰', 'castle'], ['Ljubljana', 'Slovenia', '🇸🇮'], ['Zagreb', 'Croatia', '🇭🇷'], ['Dubrovnik', 'Croatia', '🇭🇷', 'castle'],
    ['Belgrade', 'Serbia', '🇷🇸'], ['Bucharest', 'Romania', '🇷🇴'], ['Sofia', 'Bulgaria', '🇧🇬', 'cathedral'],
    ['Tallinn', 'Estonia', '🇪🇪'], ['Riga', 'Latvia', '🇱🇻'], ['Vilnius', 'Lithuania', '🇱🇹'],
    ['Bilbao', 'Spain', '🇪🇸'], ['Málaga', 'Spain', '🇪🇸'], ['Genoa', 'Italy', '🇮🇹'], ['Bologna', 'Italy', '🇮🇹'], ['Verona', 'Italy', '🇮🇹'],
    ['Toulouse', 'France', '🇫🇷'], ['Strasbourg', 'France', '🇫🇷', 'cathedral'], ['Nantes', 'France', '🇫🇷'],
    ['Gothenburg', 'Sweden', '🇸🇪'], ['Bergen', 'Norway', '🇳🇴'], ['Bern', 'Switzerland', '🇨🇭'], ['Salzburg', 'Austria', '🇦🇹', 'castle'],
    ['Gdańsk', 'Poland', '🇵🇱'], ['Thessaloniki', 'Greece', '🇬🇷'], ['Valletta', 'Malta', '🇲🇹'], ['Monaco', 'Monaco', '🇲🇨'],
    ['Sarajevo', 'Bosnia', '🇧🇦'], ['Tirana', 'Albania', '🇦🇱'], ['Skopje', 'N. Macedonia', '🇲🇰'],
    ['San Diego', 'USA', '🇺🇸'], ['Dallas', 'USA', '🇺🇸'], ['Atlanta', 'USA', '🇺🇸'], ['Denver', 'USA', '🇺🇸'], ['Phoenix', 'USA', '🇺🇸'], ['Austin', 'USA', '🇺🇸'], ['Portland', 'USA', '🇺🇸'], ['Nashville', 'USA', '🇺🇸'], ['Detroit', 'USA', '🇺🇸'], ['Pittsburgh', 'USA', '🇺🇸'],
    ['Calgary', 'Canada', '🇨🇦'], ['Québec City', 'Canada', '🇨🇦', 'castle'], ['Winnipeg', 'Canada', '🇨🇦'],
    ['Monterrey', 'Mexico', '🇲🇽'], ['Medellín', 'Colombia', '🇨🇴'], ['Caracas', 'Venezuela', '🇻🇪'], ['La Paz', 'Bolivia', '🇧🇴'], ['Asunción', 'Paraguay', '🇵🇾'], ['Panama City', 'Panama', '🇵🇦'], ['San José', 'Costa Rica', '🇨🇷'], ['Guatemala City', 'Guatemala', '🇬🇹'], ['Santo Domingo', 'Dominican Rep.', '🇩🇴'], ['San Juan', 'Puerto Rico', '🇵🇷'],
    ['Nagoya', 'Japan', '🇯🇵'], ['Fukuoka', 'Japan', '🇯🇵'], ['Incheon', 'South Korea', '🇰🇷'], ['Tianjin', 'China', '🇨🇳'], ['Wuhan', 'China', '🇨🇳'], ['Hangzhou', 'China', '🇨🇳'], ['Nanjing', 'China', '🇨🇳'], ['Macau', 'China', '🇲🇴'],
    ['Surabaya', 'Indonesia', '🇮🇩'], ['Cebu', 'Philippines', '🇵🇭'], ['Da Nang', 'Vietnam', '🇻🇳'], ['Phnom Penh', 'Cambodia', '🇰🇭'], ['Vientiane', 'Laos', '🇱🇦', 'pagoda'], ['Yangon', 'Myanmar', '🇲🇲', 'pagoda'],
    ['Dhaka', 'Bangladesh', '🇧🇩'], ['Karachi', 'Pakistan', '🇵🇰'], ['Lahore', 'Pakistan', '🇵🇰', 'bluemosque'], ['Islamabad', 'Pakistan', '🇵🇰'], ['Hyderabad', 'India', '🇮🇳'], ['Pune', 'India', '🇮🇳'], ['Ahmedabad', 'India', '🇮🇳'],
    ['Ulaanbaatar', 'Mongolia', '🇲🇳'], ['Tashkent', 'Uzbekistan', '🇺🇿', 'bluemosque'], ['Almaty', 'Kazakhstan', '🇰🇿'], ['Baku', 'Azerbaijan', '🇦🇿'], ['Tbilisi', 'Georgia', '🇬🇪'], ['Yerevan', 'Armenia', '🇦🇲'], ['Kuwait City', 'Kuwait', '🇰🇼'], ['Muscat', 'Oman', '🇴🇲', 'bluemosque'],
    ['Alexandria', 'Egypt', '🇪🇬'], ['Luxor', 'Egypt', '🇪🇬', 'obelisk'], ['Rabat', 'Morocco', '🇲🇦'], ['Fez', 'Morocco', '🇲🇦'], ['Mombasa', 'Kenya', '🇰🇪'], ['Kampala', 'Uganda', '🇺🇬'], ['Dar es Salaam', 'Tanzania', '🇹🇿'], ['Maputo', 'Mozambique', '🇲🇿'], ['Luanda', 'Angola', '🇦🇴'], ['Abidjan', 'Côte d’Ivoire', '🇨🇮'], ['Durban', 'South Africa', '🇿🇦'], ['Pretoria', 'South Africa', '🇿🇦'],
    ['Adelaide', 'Australia', '🇦🇺'], ['Canberra', 'Australia', '🇦🇺'], ['Gold Coast', 'Australia', '🇦🇺'], ['Hobart', 'Australia', '🇦🇺'], ['Christchurch', 'New Zealand', '🇳🇿'], ['Suva', 'Fiji', '🇫🇯'], ['Papeete', 'Tahiti', '🇵🇫'],
  ].map((p) => ({ city: p[0], country: p[1], flag: p[2], kind: p[3] }));

  const cityTheme = {
    key: 'city', emojis: ['🎉', '🥳', '🎊', '🎵', '✨', '🌍'],
    label() { const p = scene.place; return p ? `${p.flag} ${p.city}, ${p.country}` : '🌍 World Tour'; },
    onShow() {
      scene.place = pick(PLACES);
      scene.palette = pick(SKY);
      scene.seed = hashStr(scene.place.city + '|' + scene.place.country);
      LMA = scene.palette.acc || '#ffe1a0';
      const k = scene.place.kind;
      scene.landmark = (k && LANDMARKS[k]) ? LANDMARKS[k] : null;
    },
    bg(t) {
      const pal = scene.palette || SKY[0];
      vgrad(pal.stops);
      if (pal.night) { stars(t); moon(); } else { sun(pal); }
      // two seeded skylines for depth — unique per city, stable across frames
      drawSkyline(H * 0.70, 0.30, mulberry32(scene.seed ^ 0x9e3779b9));
      drawSkyline(H * 0.82, 0.55, mulberry32(scene.seed ^ 0x85ebca6b));
      // hero landmark (bespoke) or a seeded civic feature for long-tail cities
      const cx = W * 0.5, by = H * 0.83, S = MIN() * 0.5;
      if (scene.landmark) scene.landmark(cx, by, S);
      else FEATURES[scene.seed % FEATURES.length](cx, by, S);
    },
  };

  // ---- particles (the note fountain + cascade) ----------------------------
  function glyphPool() { return NOTE_GLYPHS.concat(theme && theme.emojis ? theme.emojis : []); }

  function spawnFountain() {
    const g = glyphPool();
    particles.push({
      x: rand(W * 0.1, W * 0.9), y: H + 20,
      vx: rand(-160, 160), vy: rand(-820, -480),
      ay: 760, rot: rand(0, 7), vr: rand(-4, 4),
      size: rand(20, 44), hue: (Math.random() * 360) | 0,
      glyph: pick(g), life: 0, max: rand(2.2, 3.6),
    });
  }
  function spawnCascade() {
    const g = glyphPool();
    particles.push({
      x: rand(0, W), y: rand(-60, -10),
      vx: rand(-30, 30), vy: rand(70, 170),
      ay: 30, rot: rand(0, 7), vr: rand(-3, 3),
      size: rand(16, 34), hue: (Math.random() * 360) | 0,
      glyph: pick(g), life: 0, max: rand(3.5, 6),
    });
  }
  function spawnBurst() {
    const x = rand(W * 0.2, W * 0.8), y = rand(H * 0.15, H * 0.5);
    const hue = (Math.random() * 360) | 0, n = 26 + ((Math.random() * 14) | 0);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, s = rand(120, 260);
      parts.push({ a, s, hue: (hue + rand(-30, 30)) | 0 });
    }
    bursts.push({ x, y, age: 0, parts });
  }

  function step(dt) {
    // top up the fountain + cascade toward a cap that scales with screen area
    const cap = Math.min(190, Math.round((W * H) / 9000));
    for (let i = 0; i < 4 && particles.length < cap; i++) spawnFountain();
    for (let i = 0; i < 2 && particles.length < cap; i++) spawnCascade();

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      p.vy += p.ay * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.life > p.max || p.y > H + 60) particles.splice(i, 1);
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.age += dt;
      if (b.age > 1.4) bursts.splice(i, 1);
    }
  }

  function drawParticles() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    particles.forEach((p) => {
      const fade = p.life > p.max - 0.6 ? Math.max(0, (p.max - p.life) / 0.6) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.font = `${p.size}px "Bravura","Noto Music",ui-sans-serif,system-ui,"Apple Color Emoji","Segoe UI Emoji"`;
      // emoji render in their own colour; plain note glyphs get a vivid hue
      if (p.glyph.length <= 2 && p.glyph.charCodeAt(0) < 0x2600) {
        ctx.shadowColor = `hsl(${p.hue} 90% 60%)`; ctx.shadowBlur = 8;
        ctx.fillStyle = `hsl(${p.hue} 95% 62%)`;
      }
      ctx.fillText(p.glyph, 0, 0);
      ctx.restore();
    });
  }

  function drawBursts() {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    bursts.forEach((b) => {
      const r = b.age * 1; const fade = Math.max(0, 1 - b.age / 1.4);
      b.parts.forEach((q) => {
        const d = q.s * b.age, gx = b.x + Math.cos(q.a) * d, gy = b.y + Math.sin(q.a) * d + 60 * b.age * b.age;
        ctx.globalAlpha = fade;
        ctx.fillStyle = `hsl(${q.hue} 95% 65%)`;
        ctx.beginPath(); ctx.arc(gx, gy, 3, 0, 7); ctx.fill();
      });
    });
    ctx.restore();
  }

  // ---- lifecycle ----------------------------------------------------------
  function ensureDom() {
    root = document.getElementById('celebrate');
    if (!root) return false;
    canvas = document.getElementById('celebrateCanvas');
    ctx = canvas.getContext('2d');
    kickerEl = document.getElementById('celKicker');
    titleEl = document.getElementById('celTitle');
    subEl = document.getElementById('celSub');
    locEl = document.getElementById('celLoc');
    // tap anywhere (after a short grace) or the button to continue
    root.addEventListener('pointerdown', () => { if (active && performance.now() - startT > 500) close(); });
    const btn = document.getElementById('celGo');
    if (btn) btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (active) close(); });
    window.addEventListener('resize', () => { if (active) resize(); });
    return true;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    buildScene();
  }

  function buildScene() {
    scene.stars = [];
    for (let i = 0; i < 90; i++) scene.stars.push({ x: Math.random(), y: Math.random() * 0.8, r: rand(0.6, 2.2), tw: rand(1, 4), ph: rand(0, 7), c: Math.random() < 0.2 ? '#ffe9a8' : '#fff' });
    scene.bubbles = [];
    for (let i = 0; i < 28; i++) scene.bubbles.push({ x: Math.random(), y: Math.random(), r: rand(2, 7), sp: rand(0.05, 0.18) });
  }

  function frame(now) {
    if (!active) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    const t = (now - startT) / 1000;
    ctx.clearRect(0, 0, W, H);
    try { theme.bg(t); } catch (e) { vgrad(['#101426', '#1b2440']); }
    if (theme.spawnBursts && Math.random() < dt * 2.2) spawnBurst();
    step(dt);
    drawBursts();
    drawParticles();
    if (now - startT > durMs) { close(); return; }
    raf = requestAnimationFrame(frame);
  }

  // Weighted toward the world-cities theme (hundreds of locations) so the global
  // tour shows up often, with the fantasy scenes sprinkled in.
  function pickTheme() { return Math.random() < 0.6 ? cityTheme : THEMES[(Math.random() * THEMES.length) | 0]; }

  function startOne(opts) {
    const all = THEMES.concat(cityTheme);
    theme = opts.theme ? (all.find((x) => x.key === opts.theme) || pickTheme()) : pickTheme();
    if (theme.onShow) theme.onShow();
    kickerEl.textContent = opts.kicker || pick(KICKERS);
    titleEl.textContent = opts.title || 'MILESTONE!';
    subEl.textContent = opts.sub || pick(MESSAGES);
    locEl.textContent = theme.label();
    particles.length = 0; bursts.length = 0;
    active = true; startT = performance.now(); lastFrame = 0;
    durMs = opts.durationMs || 5200; onCloseCb = opts.onClose || null;
    root.classList.add('active');
    resize();
    // a few firework bursts to open with
    for (let i = 0; i < 3; i++) spawnBurst();
    if (App.Audio && App.Audio.isEnabled && App.Audio.isEnabled()) { try { App.Audio.fanfare(); } catch (e) {} }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function close() {
    if (!active) return;
    active = false;
    root.classList.remove('active');
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const cb = onCloseCb; onCloseCb = null;
    if (cb) { try { cb(); } catch (e) {} }
    if (queue.length) { const next = queue.shift(); setTimeout(() => show(next), 400); }
  }

  function show(opts) {
    opts = opts || {};
    if (!root && !ensureDom()) { if (opts.onClose) opts.onClose(); return; }
    if (active) { queue.push(opts); return; } // one at a time; queue the rest
    startOne(opts);
  }

  App.Celebrate = {
    show,
    isActive: () => active,
    THEMES, // exposed for a debug preview
    _debug: { LANDMARKS, FEATURES, PLACES, SKY, cityTheme },
  };
})(window.App = window.App || {});
