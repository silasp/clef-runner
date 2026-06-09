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

  const CITIES = [
    { name: 'Paris', flag: '🗼', landmark: eiffel },
    { name: 'London', flag: '🎡', landmark: bigBen },
    { name: 'New York', flag: '🗽', landmark: liberty },
    { name: 'Tokyo', flag: '🗾', landmark: tokyoTower },
    { name: 'Sydney', flag: '🌉', landmark: operaHouse },
  ];

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
      key: 'city', label: () => (scene.city ? scene.city.flag + ' ' + scene.city.name : '🌆 City Lights'),
      emojis: ['🌆', '🎉', '🥳', '🎵', '✨', '🎊'],
      onShow() { scene.city = pick(CITIES); },
      bg(t) {
        vgrad(['#142244', '#3a3f7a', '#ff9e7a']);
        disc(W * 0.78, H * 0.32, MIN() * 0.09, '#fff3d0', '#ff8e5a');
        stars(t * 0.4);
        // back skyline
        drawSkyline(H * 0.72, '#26315c', 0.04, t);
        // front skyline
        drawSkyline(H * 0.8, '#161d3a', 0.06, t + 10);
        if (scene.city) scene.city.landmark(t);
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

  // ---- landmark silhouettes (drawn near the horizon for the city theme) ----
  function eiffel() {
    const cx = W * 0.5, baseY = H * 0.8, h = MIN() * 0.5;
    ctx.fillStyle = '#0d1430'; ctx.strokeStyle = '#0d1430'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - h * 0.22, baseY); ctx.lineTo(cx - h * 0.05, baseY - h);
    ctx.lineTo(cx + h * 0.05, baseY - h); ctx.lineTo(cx + h * 0.22, baseY);
    ctx.moveTo(cx - h * 0.14, baseY - h * 0.4); ctx.lineTo(cx + h * 0.14, baseY - h * 0.4);
    ctx.moveTo(cx - h * 0.09, baseY - h * 0.65); ctx.lineTo(cx + h * 0.09, baseY - h * 0.65);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - h * 0.22, baseY); ctx.quadraticCurveTo(cx, baseY - h * 0.18, cx + h * 0.22, baseY); ctx.stroke();
  }
  function bigBen() {
    const cx = W * 0.5, baseY = H * 0.8, h = MIN() * 0.46, w = h * 0.16;
    ctx.fillStyle = '#0d1430';
    ctx.fillRect(cx - w / 2, baseY - h, w, h);
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(cx, baseY - h + w * 0.7, w * 0.32, 0, 7); ctx.fill();
    ctx.fillStyle = '#0d1430'; tri(cx, baseY - h, w * 1.1, w * 0.9, '#0d1430');
  }
  function liberty() {
    const cx = W * 0.5, baseY = H * 0.8, h = MIN() * 0.42;
    ctx.fillStyle = '#13352f';
    ctx.fillRect(cx - h * 0.06, baseY - h * 0.7, h * 0.12, h * 0.7); // body
    ctx.beginPath(); ctx.arc(cx, baseY - h * 0.74, h * 0.07, 0, 7); ctx.fill(); // head
    ctx.fillRect(cx + h * 0.02, baseY - h, h * 0.04, h * 0.3); // arm
    tri(cx + h * 0.04, baseY - h, h * 0.1, h * 0.12, '#ffcf5a'); // torch
    ctx.fillStyle = '#13352f'; ctx.fillRect(cx - h * 0.18, baseY - h * 0.06, h * 0.36, h * 0.06); // base
  }
  function tokyoTower() {
    const cx = W * 0.5, baseY = H * 0.8, h = MIN() * 0.5;
    ctx.strokeStyle = '#c0392b'; ctx.fillStyle = '#c0392b'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - h * 0.2, baseY); ctx.lineTo(cx, baseY - h);
    ctx.lineTo(cx + h * 0.2, baseY);
    ctx.moveTo(cx - h * 0.1, baseY - h * 0.5); ctx.lineTo(cx + h * 0.1, baseY - h * 0.5);
    ctx.stroke();
    ctx.fillRect(cx - 3, baseY - h - h * 0.1, 6, h * 0.1);
  }
  function operaHouse() {
    const cx = W * 0.5, baseY = H * 0.8, w = MIN() * 0.5;
    ctx.fillStyle = '#eef3ff';
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(cx - w * 0.3 + i * w * 0.2, baseY); ctx.scale(1, 1.4);
      ctx.beginPath(); ctx.arc(0, 0, w * 0.16 - i * w * 0.012, Math.PI, 0); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = '#13243f'; ctx.fillRect(cx - w * 0.42, baseY, w * 0.84, H * 0.2);
  }

  function drawSkyline(topY, color, density, t) {
    ctx.fillStyle = color;
    let x = 0;
    let i = 0;
    while (x < W) {
      const bw = W * (0.04 + ((i * 37) % 5) * 0.012);
      const bh = (topY) * (0.25 + ((i * 53) % 7) / 10);
      const by = H - bh;
      ctx.fillRect(x, by, bw - 2, bh);
      // lit windows
      ctx.fillStyle = 'rgba(255,221,130,0.7)';
      for (let wy = by + 6; wy < H - 6; wy += 12) {
        for (let wx = x + 4; wx < x + bw - 6; wx += 9) {
          if (((wx + wy + i) * 13 % 7) < 3) ctx.fillRect(wx, wy, 4, 6);
        }
      }
      ctx.fillStyle = color;
      x += bw; i++;
    }
  }

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

  function startOne(opts) {
    theme = opts.theme ? (THEMES.find((x) => x.key === opts.theme) || pick(THEMES)) : pick(THEMES);
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
  };
})(window.App = window.App || {});
