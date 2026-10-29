// Lantern Wheel: animated backdrop (stars, drifting sky lanterns, lake shimmer).

export function startSky(canvas) {
  const g = canvas.getContext('2d');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  let stars = [];
  let lanterns = [];
  const hues = ['255,150,90', '255,200,100', '255,120,140'];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round((W * H) / 7000) }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.75,
      r: 0.3 + Math.random() * 0.9,
      p: Math.random() * 6.28,
    }));
    lanterns = Array.from({ length: Math.max(6, Math.round(W / 90)) }, () => newLantern(true));
  }

  function newLantern(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 20,
      s: 2 + Math.random() * 4,
      v: 6 + Math.random() * 12,
      sway: Math.random() * 6.28,
      c: hues[Math.floor(Math.random() * hues.length)],
    };
  }

  function frame(now) {
    const t = now / 1000;
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      g.fillStyle = `rgba(255,240,220,${0.25 + 0.35 * Math.sin(t * 0.8 + s.p)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, 6.283);
      g.fill();
    }
    for (const l of lanterns) {
      if (!reduced) {
        l.y -= l.v * 0.016;
        l.x += Math.sin(t * 0.5 + l.sway) * 0.08;
      }
      if (l.y < -20) Object.assign(l, newLantern(false));
      const glow = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.s * 4);
      glow.addColorStop(0, `rgba(${l.c},0.35)`);
      glow.addColorStop(1, `rgba(${l.c},0)`);
      g.fillStyle = glow;
      g.fillRect(l.x - l.s * 4, l.y - l.s * 4, l.s * 8, l.s * 8);
      g.fillStyle = `rgba(${l.c},0.85)`;
      g.beginPath();
      g.ellipse(l.x, l.y, l.s * 0.7, l.s, 0, 0, 6.283);
      g.fill();
    }
    // lake shimmer
    const lake = H * 0.82;
    for (let k = 0; k < 14; k++) {
      const y = lake + k * ((H - lake) / 14);
      const x = ((t * 18 * (k % 2 ? 1 : -1) + k * 97) % (W + 200)) - 100;
      g.fillStyle = `rgba(255,200,140,${0.05 + 0.04 * Math.sin(t + k)})`;
      g.fillRect(x, y, 60 + (k % 3) * 30, 1.5);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
}
