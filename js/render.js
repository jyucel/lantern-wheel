// Lantern Wheel: board renderer and pointer input.
//
// Draws the wheel, docks and lanterns on a <canvas>, animates spins (spring),
// lantern transfers (arcing flights) and pier slides, and turns pointer input
// into move ids. Game state is never changed here: actions are reported via
// `onAction(ids)` and the controller applies them.

import { EMPTY } from './engine.js';

export const COLORS = [
  { name: 'Ember', hex: '#ff6a5c', light: '#ffc0a8', dark: '#b8303a' },
  { name: 'Marigold', hex: '#ffc23d', light: '#fff0b0', dark: '#c27d0e' },
  { name: 'Jade', hex: '#3ed69a', light: '#b6f7d8', dark: '#138a5e' },
  { name: 'Lagoon', hex: '#43b8ff', light: '#bfe9ff', dark: '#1767b8' },
  { name: 'Orchid', hex: '#b48cff', light: '#e4d6ff', dark: '#6a45c9' },
  { name: 'Peony', hex: '#ff78bd', light: '#ffc9e5', dark: '#bd3c85' },
];

const TAU = Math.PI * 2;
const GOLD = '#f4c46a';
const SLOT = 0.95; // distance between dock slots
const DOCK_GAP = 1.05; // wheel rim to first dock slot
const L_W = 0.62; // lantern width
const L_H = 0.78; // lantern height
const SPRING_K = 240;
const SPRING_D = 25;
const FLY = 0.26; // seconds per lantern flight
const TAP_SLOP = 9;

export function wheelRadius(seats) {
  return Math.max(1.65, (seats * 1.2) / TAU);
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

export class BoardView {
  constructor(canvas, { onAction, onInvalid } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction || (() => {});
    this.onInvalid = onInvalid || (() => {});
    this.glyphs = true;
    this.inputEnabled = true;
    this.level = null;
    this.time = 0;
    this.raf = 0;
    this.particles = [];
    this.bindInput();
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (this.level && this.raf) this.layout();
      }).observe(canvas);
    }
  }

  // ---- setup ------------------------------------------------------------------

  setLevel(level, game) {
    this.level = level;
    this.game = game;
    this.resetAnimation();
    this.layout();
  }

  resetAnimation() {
    this.rot = { off: 0, vel: 0 };
    this.flights = [];
    this.slides = this.level.docks.map(() => ({ off: 0, vel: 0 }));
    this.shakes = new Map();
    this.glow = this.level.docks.map(() => 0);
    this.drag = null;
    this.press = null;
    this.hint = null;
    this.winT = null;
    this.particles = [];
  }

  layout() {
    if (!this.level) return;
    const rect = this.canvas.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    Object.assign(this, { W, H, dpr });
    this.R = wheelRadius(this.level.seats);

    // Try the board upright and turned a quarter; keep whichever is larger.
    const fit = (base) => {
      this.base = base;
      let minX = -this.R - 0.6;
      let maxX = this.R + 0.6;
      let minY = minX;
      let maxY = maxX;
      this.level.docks.forEach((d, i) => {
        for (const end of [-0.6, d.cap - 1 + 0.6]) {
          const [x, y] = this.dockPoint(i, end);
          minX = Math.min(minX, x - 0.55);
          maxX = Math.max(maxX, x + 0.55);
          minY = Math.min(minY, y - 0.55);
          maxY = Math.max(maxY, y + 0.55);
        }
      });
      const s = Math.min(W / (maxX - minX), H / (maxY - minY));
      return { base, s, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    };
    let best = fit(0);
    const alt = fit(Math.PI / 2);
    if (alt.s > best.s * 1.1) best = alt;
    this.base = best.base;
    this.s = Math.min(best.s * 0.95, Math.min(W, H) / 4.2, 110);
    this.ox = W / 2 - best.cx * this.s;
    this.oy = H / 2 - best.cy * this.s;
    this.buildSprites();
  }

  setGlyphs(on) {
    this.glyphs = on;
    if (this.level) this.buildSprites();
  }

  // ---- geometry (units; wheel centre at the origin) -------------------------------

  seatAngle(k, extra = 0) {
    return this.base - Math.PI / 2 + (k * TAU) / this.level.seats + extra;
  }

  seatPoint(k, extra = 0) {
    const a = this.seatAngle(k, extra);
    return [Math.cos(a) * this.R, Math.sin(a) * this.R];
  }

  /** Centre of slot j of dock i (j = 0 is nearest the wheel; may be fractional). */
  dockPoint(i, j) {
    const a = this.seatAngle(this.level.docks[i].at);
    const r = this.R + DOCK_GAP + j * SLOT;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  /** Slot index at which element e of a dock's array is drawn. */
  slotOf(i, e, len) {
    const d = this.level.docks[i];
    // towers rest against their far end (top = nearest the wheel); piers fill from the wheel outward
    return d.kind === 'tower' ? d.cap - 1 - e : e;
  }

  px(x, y) {
    return [this.ox + x * this.s, this.oy + y * this.s];
  }

  units(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left - this.ox) / this.s, (clientY - r.top - this.oy) / this.s];
  }

  /** Client coordinates of a move's target (for the tutorial pointer). */
  clientPointFor(id) {
    const r = this.canvas.getBoundingClientRect();
    let u;
    if (id[0] === 'd') u = this.dockPoint(Number(id.slice(1)), 0.6);
    else u = this.seatPoint(0, 0).map((v) => v * 0.0);
    const [x, y] = this.px(u[0], u[1]);
    return { x: r.left + x, y: r.top + y };
  }

  hitTest(ux, uy) {
    const L = this.level;
    // docks: anywhere along the column, slightly generous
    let best = null;
    L.docks.forEach((d, i) => {
      const a = this.seatAngle(d.at);
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const along = ux * ax + uy * ay - (this.R + DOCK_GAP);
      const across = Math.abs(-ux * ay + uy * ax);
      if (along > -0.75 && along < (d.cap - 1) * SLOT + 0.7 && across < 0.68) {
        if (!best || across < best.d) best = { type: 'dock', index: i, d: across };
      }
    });
    if (best) return best;
    if (Math.hypot(ux, uy) < this.R + 0.75) return { type: 'wheel' };
    return null;
  }

  // ---- sprites ------------------------------------------------------------------------

  buildSprites() {
    const s = this.s;
    const w = L_W * s;
    const h = L_H * s;
    const pad = s * 0.45;
    this.sprites = COLORS.map((c, i) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((w + pad * 2) * this.dpr);
      cv.height = Math.ceil((h + pad * 2) * this.dpr);
      const g = cv.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const cx = w / 2 + pad;
      const cy = h / 2 + pad;
      // glow
      const glow = g.createRadialGradient(cx, cy, w * 0.2, cx, cy, w * 0.5 + pad);
      glow.addColorStop(0, hexA(c.hex, 0.55));
      glow.addColorStop(1, hexA(c.hex, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, w + pad * 2, h + pad * 2);
      // paper body
      const body = g.createRadialGradient(cx - w * 0.15, cy - h * 0.12, w * 0.05, cx, cy, w * 0.7);
      body.addColorStop(0, c.light);
      body.addColorStop(0.5, c.hex);
      body.addColorStop(1, c.dark);
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(cx, cy, w / 2, h / 2 - h * 0.06, 0, 0, TAU);
      g.fill();
      // ribs
      g.strokeStyle = hexA('#000000', 0.16);
      g.lineWidth = Math.max(1, s * 0.025);
      for (const k of [-0.5, 0, 0.5]) {
        g.beginPath();
        g.ellipse(cx, cy, (w / 2) * Math.abs(k) + 0.01, h / 2 - h * 0.08, 0, 0, TAU);
        g.stroke();
      }
      // caps
      g.fillStyle = '#3a2a1c';
      const capW = w * 0.56;
      const capH = h * 0.11;
      g.beginPath();
      g.roundRect(cx - capW / 2, cy - h / 2, capW, capH, capH * 0.4);
      g.roundRect(cx - capW / 2, cy + h / 2 - capH, capW, capH, capH * 0.4);
      g.fill();
      // highlight
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(cx - w * 0.17, cy - h * 0.16, w * 0.1, h * 0.17, -0.2, 0, TAU);
      g.fill();
      if (this.glyphs) drawGlyph(g, i, cx, cy + h * 0.02, w * 0.2);
      return cv;
    });
  }

  // ---- input --------------------------------------------------------------------------

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', () => {
      this.press = null;
      this.drag = null;
    });
    c.addEventListener('pointerleave', () => {
      if (!this.press) this.hover = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.inputEnabled || !this.level) return;
        e.preventDefault();
        if (this.wheelLock && performance.now() - this.wheelLock < 130) return;
        this.wheelLock = performance.now();
        this.spin(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  pointerDown(e) {
    if (!this.inputEnabled || !this.level || this.press) return;
    const [ux, uy] = this.units(e.clientX, e.clientY);
    const hit = this.hitTest(ux, uy);
    if (!hit) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.press = { id: e.pointerId, hit, x0: e.clientX, y0: e.clientY, moved: false, last: Math.atan2(uy, ux), delta: 0 };
  }

  pointerMove(e) {
    const [ux, uy] = this.units(e.clientX, e.clientY);
    if (!this.press) {
      if (e.pointerType === 'mouse' && this.level) {
        this.hover = this.inputEnabled ? this.hitTest(ux, uy) : null;
        this.canvas.style.cursor = this.hover ? (this.hover.type === 'wheel' ? 'grab' : 'pointer') : 'default';
      }
      return;
    }
    const p = this.press;
    if (e.pointerId !== p.id) return;
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > TAP_SLOP) {
      p.moved = true;
      if (p.hit.type === 'wheel') this.drag = { delta: 0 };
    }
    if (this.drag) {
      const a = Math.atan2(uy, ux);
      if (Math.hypot(ux, uy) > 0.35) {
        p.delta += angDiff(a, p.last);
        p.last = a;
      }
      this.drag.delta = this.level.oneway && p.delta < 0 ? p.delta * 0.18 : p.delta;
      this.rot.off = this.drag.delta;
      this.rot.vel = 0;
      this.flights = [];
    }
  }

  pointerUp(e) {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    this.press = null;
    if (!p.moved) {
      if (p.hit.type === 'dock') this.onAction([`d${p.hit.index}`], {});
      return;
    }
    if (this.drag) {
      this.drag = null;
      const step = TAU / this.level.seats;
      let k = Math.round(p.delta / step);
      const n = this.level.seats;
      if (this.level.oneway) {
        if (k < 0 || p.delta < -step * 0.35) {
          this.onInvalid('oneway');
          return;
        }
        k %= n;
      } else {
        k = ((k % n) + n) % n;
        if (k > n / 2) k -= n;
      }
      if (!k) return;
      const raw = Math.round(p.delta / step);
      this.pendingResidual = p.delta - raw * step;
      this.onAction(new Array(Math.abs(k)).fill(k > 0 ? 'cw' : 'ccw'), { drag: true });
      this.pendingResidual = null;
    }
  }

  spin(dir) {
    if (dir < 0 && this.level.oneway) return this.onInvalid('oneway');
    this.onAction([dir > 0 ? 'cw' : 'ccw'], {});
  }

  shake(i) {
    this.shakes.set(i, this.time);
  }

  // ---- animation ----------------------------------------------------------------------

  /**
   * Animate an action that was just applied. `prev` is the state before the
   * action; for undo, pass reverse=true and prev = the state after it.
   */
  animate(ids, prev, { reverse = false } = {}) {
    this.flights = [];
    const seq = reverse ? ids.slice().reverse() : ids;
    const step = TAU / this.level.seats;
    let state = prev;
    for (const id of seq) {
      if (id === 'cw' || id === 'ccw') {
        const dir = (id === 'cw' ? 1 : -1) * (reverse ? -1 : 1);
        this.rot.off -= dir * step;
      } else {
        this.animateDock(Number(id.slice(1)), state);
      }
    }
    if (this.pendingResidual !== null && this.pendingResidual !== undefined) {
      this.rot.off = this.pendingResidual;
      this.rot.vel = 0;
    }
  }

  animateDock(i, before) {
    const d = this.level.docks[i];
    const after = this.game.state;
    const len0 = before.docks[i].length;
    const len1 = after.docks[i].length;
    const seat = d.at;
    if (len1 > len0) {
      // a lantern went from the seat onto the dock
      const e = len1 - 1; // pushed on top (tower) or joined at the back (pier)
      const slot = this.slotOf(i, e, len1);
      this.flights.push({ color: after.docks[i][e], from: () => this.seatPoint(seat, this.rot.off), to: () => this.dockPoint(i, slot), hide: { dock: i, e }, t: 0 });
    } else if (len1 < len0) {
      // a lantern went from the dock onto the seat
      const e = d.kind === 'tower' ? len0 - 1 : 0;
      const slot = this.slotOf(i, e, len0);
      this.flights.push({ color: after.wheel[seat], from: () => this.dockPoint(i, slot), to: () => this.seatPoint(seat, this.rot.off), hide: { seat }, t: 0 });
      if (d.kind === 'pier') {
        this.slides[i].off = 1; // the rest of the queue moves up one slot
        this.slides[i].vel = 0;
      }
    }
  }

  showHint(id, persistent = false) {
    this.hint = id ? { id, t0: this.time, persistent } : null;
  }

  celebrate() {
    this.winT = this.time;
    this.level.docks.forEach((_, i) => this.burst(i, 22));
  }

  burst(i, count = 14) {
    const d = this.game.state.docks[i];
    if (!d.length) return;
    const color = COLORS[d[0]].hex;
    const cap = this.level.docks[i].cap;
    for (let k = 0; k < count; k++) {
      const [ux, uy] = this.dockPoint(i, Math.random() * (cap - 1));
      const [x, y] = this.px(ux, uy);
      const a = Math.random() * TAU;
      const sp = (30 + Math.random() * 110) * (this.s / 60);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.8 + Math.random() * 0.7, age: 0, size: 1.5 + Math.random() * 2.5, color });
    }
  }

  start() {
    if (this.raf) return;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get busy() {
    return this.flights.length > 0 || Math.abs(this.rot.off) > 0.002 || this.slides.some((s) => Math.abs(s.off) > 0.01);
  }

  update(dt) {
    this.time += dt;
    if (!this.level) return;
    const spring = (o) => {
      o.vel += (-SPRING_K * o.off - SPRING_D * o.vel) * dt;
      o.off += o.vel * dt;
      if (Math.abs(o.off) < 0.0008 && Math.abs(o.vel) < 0.005) o.off = o.vel = 0;
    };
    if (!this.drag) spring(this.rot);
    this.slides.forEach(spring);
    for (const f of this.flights) f.t += dt / FLY;
    this.flights = this.flights.filter((f) => f.t < 1);
    this.level.docks.forEach((_, i) => {
      const target = this.dockDone(i) ? 1 : 0;
      this.glow[i] += (target - this.glow[i]) * Math.min(1, dt * 5);
    });
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 50 * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  dockDone(i) {
    const st = this.game.state;
    const d = st.docks[i];
    if (!d.length || !d.every((c) => c === d[0])) return false;
    let total = 0;
    for (const c of st.wheel) if (c === d[0]) total++;
    for (const dd of st.docks) for (const c of dd) if (c === d[0]) total++;
    return total === d.length;
  }

  // ---- drawing ------------------------------------------------------------------------

  draw() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (!this.level) return;
    const s = this.s;
    const L = this.level;
    const st = this.game.state;
    const [cx, cy] = this.px(0, 0);
    const R = this.R * s;
    const off = this.rot.off;
    const winPulse = this.winT === null ? 0 : Math.max(0, 1 - (this.time - this.winT) / 1.4);
    const hidden = (pred) => this.flights.some((f) => pred(f.hide));

    // docks
    L.docks.forEach((d, i) => {
      const t0 = this.shakes.get(i);
      let shake = 0;
      if (t0 !== undefined) {
        const t = this.time - t0;
        if (t > 0.5) this.shakes.delete(i);
        else shake = Math.sin(t * 46) * Math.exp(-t * 7) * 0.12;
      }
      const a = this.seatAngle(d.at);
      const hot = this.isHot('dock', i);
      g.save();
      g.translate(...this.px(...this.dockPoint(i, (d.cap - 1) / 2)));
      g.rotate(a);
      g.translate(0, shake * s);
      const len = (d.cap - 1) * SLOT * s + s * 1.05;
      const wid = s * 0.98;
      const glow = this.glow[i];
      // body
      g.fillStyle = d.kind === 'pier' ? '#3b2a22' : '#2b2546';
      g.strokeStyle = glow > 0.05 ? hexA(COLORS[st.docks[i][0] ?? 0].hex, 0.5 + 0.5 * glow) : hot ? '#ffe0a0' : 'rgba(244,196,106,0.45)';
      g.lineWidth = Math.max(1.5, s * 0.05);
      g.beginPath();
      g.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.32);
      g.fill();
      g.stroke();
      if (d.kind === 'pier') {
        // planks and flow chevrons pointing at the wheel
        g.strokeStyle = 'rgba(255,220,170,0.12)';
        g.lineWidth = Math.max(1, s * 0.02);
        for (let k = -2; k <= 2; k++) {
          g.beginPath();
          g.moveTo(-len / 2 + wid * 0.2, (k * wid) / 6);
          g.lineTo(len / 2 - wid * 0.2, (k * wid) / 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(255,214,150,0.55)';
        for (let k = 0; k < d.cap - 1; k++) {
          const x = -len / 2 + s * 0.52 + (k + 0.5) * SLOT * s;
          chevron(g, x, wid * 0.4, Math.PI, s * 0.09);
          chevron(g, x, -wid * 0.4, Math.PI, s * 0.09);
        }
      } else {
        // tower: slot cups
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < d.cap; k++) {
          const x = -len / 2 + s * 0.52 + k * SLOT * s;
          g.beginPath();
          g.ellipse(x, 0, s * 0.34, s * 0.3, 0, 0, TAU);
          g.fill();
        }
        // weight mark at the far (bottom) end
        g.fillStyle = 'rgba(244,196,106,0.5)';
        g.fillRect(len / 2 - s * 0.1, -wid * 0.3, s * 0.05, wid * 0.6);
      }
      if (d.gate !== undefined) {
        const c = COLORS[d.gate];
        g.fillStyle = c.hex;
        g.beginPath();
        g.roundRect(-len / 2 - s * 0.05, -wid / 2 - s * 0.05, s * 0.2, wid + s * 0.1, s * 0.08);
        g.fill();
        g.strokeStyle = c.hex;
        g.lineWidth = Math.max(2, s * 0.06);
        g.beginPath();
        g.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.32);
        g.stroke();
      }
      g.restore();
    });

    // wheel: rim, spokes, gondolas
    g.save();
    g.strokeStyle = 'rgba(244,196,106,0.5)';
    g.lineWidth = Math.max(2, s * 0.11);
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(244,196,106,0.2)';
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath();
    g.arc(cx, cy, R * 0.55, 0, TAU);
    g.stroke();
    g.lineWidth = Math.max(1, s * 0.035);
    g.beginPath();
    for (let k = 0; k < L.seats; k++) {
      const a = this.seatAngle(k, off);
      g.moveTo(cx + Math.cos(a) * s * 0.35, cy + Math.sin(a) * s * 0.35);
      g.lineTo(cx + Math.cos(a) * (R - s * 0.36), cy + Math.sin(a) * (R - s * 0.36));
    }
    g.stroke();
    // hub
    const hub = g.createRadialGradient(cx - s * 0.1, cy - s * 0.1, s * 0.05, cx, cy, s * 0.42);
    hub.addColorStop(0, '#fff1c8');
    hub.addColorStop(1, '#b9822f');
    g.fillStyle = hub;
    g.beginPath();
    g.arc(cx, cy, s * 0.36, 0, TAU);
    g.fill();
    if (L.oneway) {
      g.strokeStyle = '#2b2041';
      g.lineWidth = Math.max(1.5, s * 0.06);
      g.beginPath();
      g.arc(cx, cy, s * 0.2, -Math.PI * 0.8, Math.PI * 0.45);
      g.stroke();
      g.fillStyle = '#2b2041';
      const ae = Math.PI * 0.45;
      chevron(g, cx + Math.cos(ae) * s * 0.2, cy + Math.sin(ae) * s * 0.2, ae + Math.PI / 2, s * 0.13);
    }
    // gondola cups (fixed world seats highlight where a dock faces)
    const faced = new Set(L.docks.map((d) => d.at));
    for (let k = 0; k < L.seats; k++) {
      const [x, y] = this.px(...this.seatPoint(k));
      if (faced.has(k)) {
        g.strokeStyle = 'rgba(255,224,160,0.35)';
        g.lineWidth = Math.max(1, s * 0.04);
        g.beginPath();
        g.arc(x, y, s * 0.5, 0, TAU);
        g.stroke();
      }
    }
    for (let k = 0; k < L.seats; k++) {
      const [x, y] = this.px(...this.seatPoint(k, off));
      g.fillStyle = 'rgba(20,14,40,0.75)';
      g.strokeStyle = 'rgba(244,196,106,0.7)';
      g.lineWidth = Math.max(1, s * 0.04);
      g.beginPath();
      g.arc(x, y, s * 0.36, 0, TAU);
      g.fill();
      g.stroke();
    }
    g.restore();

    // lanterns in docks
    L.docks.forEach((d, i) => {
      const arr = st.docks[i];
      const slide = this.slides[i].off;
      arr.forEach((c, e) => {
        if (hidden((h) => h.dock === i && h.e === e)) return;
        const slot = this.slotOf(i, e, arr.length) + (d.kind === 'pier' ? slide : 0);
        this.drawLantern(g, c, ...this.dockPoint(i, slot), 1 + winPulse * 0.1 * Math.sin(this.time * 9 + i + e));
      });
    });
    // lanterns on the wheel
    st.wheel.forEach((c, k) => {
      if (c === EMPTY || hidden((h) => h.seat === k)) return;
      this.drawLantern(g, c, ...this.seatPoint(k, off), 1);
    });
    // flights
    for (const f of this.flights) {
      const e = easeInOut(Math.min(1, f.t));
      const [x0, y0] = f.from();
      const [x1, y1] = f.to();
      const lift = Math.sin(e * Math.PI) * 0.35;
      this.drawLantern(g, f.color, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e - lift, 1 + 0.15 * Math.sin(e * Math.PI));
    }

    this.drawHint(g);

    if (this.particles.length) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        const a = 1 - p.age / p.life;
        g.fillStyle = hexA(p.color, a);
        g.beginPath();
        g.arc(p.x, p.y, p.size * (s / 60) * (0.5 + a * 0.5), 0, TAU);
        g.fill();
      }
      g.restore();
    }
  }

  drawLantern(g, color, ux, uy, scale) {
    const img = this.sprites[color];
    const [x, y] = this.px(ux, uy);
    const w = (img.width / this.dpr) * scale;
    const h = (img.height / this.dpr) * scale;
    // a gentle sway keeps the scene alive
    g.drawImage(img, x - w / 2, y - h / 2 + Math.sin(this.time * 1.6 + ux * 2 + uy) * this.s * 0.025, w, h);
  }

  isHot(type, index) {
    if (this.press && !this.press.moved) return this.press.hit.type === type && this.press.hit.index === index;
    return this.hover && this.hover.type === type && this.hover.index === index;
  }

  drawHint(g) {
    if (!this.hint) return;
    const t = this.time - this.hint.t0;
    if (!this.hint.persistent && t > 3.2) {
      this.hint = null;
      return;
    }
    const s = this.s;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    const id = this.hint.id;
    g.save();
    g.strokeStyle = `rgba(255,240,200,${0.5 + 0.5 * pulse})`;
    g.lineWidth = Math.max(2, s * 0.07);
    if (id[0] === 'd') {
      const i = Number(id.slice(1));
      const d = this.level.docks[i];
      g.translate(...this.px(...this.dockPoint(i, (d.cap - 1) / 2)));
      g.rotate(this.seatAngle(d.at));
      const len = (d.cap - 1) * SLOT * s + s * 1.35;
      const wid = s * 1.3;
      g.beginPath();
      g.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.35);
      g.stroke();
    } else {
      const dir = id === 'cw' ? 1 : -1;
      const [cx, cy] = this.px(0, 0);
      const R = (this.R + 0.75) * s;
      const a0 = this.base - Math.PI / 2 - dir * 0.8;
      const sweep = dir * (1.1 + 0.25 * pulse);
      g.beginPath();
      g.arc(cx, cy, R, a0, a0 + sweep, dir < 0);
      g.stroke();
      const ae = a0 + sweep;
      g.fillStyle = g.strokeStyle;
      chevron(g, cx + Math.cos(ae) * R, cy + Math.sin(ae) * R, ae + (dir * Math.PI) / 2, s * 0.22);
    }
    g.restore();
  }
}

function chevron(g, x, y, dir, size) {
  g.save();
  g.translate(x, y);
  g.rotate(dir);
  g.beginPath();
  g.moveTo(size * 0.7, 0);
  g.lineTo(-size * 0.5, -size * 0.6);
  g.lineTo(-size * 0.2, 0);
  g.lineTo(-size * 0.5, size * 0.6);
  g.closePath();
  g.fill();
  g.restore();
}

/** Color-blind helper glyphs: dot, triangle, square, diamond, star, cross. */
export function drawGlyph(g, i, x, y, size) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = size * 0.34;
  g.lineJoin = 'round';
  g.beginPath();
  switch (i) {
    case 0:
      g.arc(0, 0, size * 0.55, 0, TAU);
      g.fill();
      break;
    case 1:
      g.moveTo(0, -size * 0.75);
      g.lineTo(size * 0.7, size * 0.5);
      g.lineTo(-size * 0.7, size * 0.5);
      g.closePath();
      g.fill();
      break;
    case 2:
      g.rect(-size * 0.52, -size * 0.52, size * 1.04, size * 1.04);
      g.fill();
      break;
    case 3:
      g.moveTo(0, -size * 0.8);
      g.lineTo(size * 0.62, 0);
      g.lineTo(0, size * 0.8);
      g.lineTo(-size * 0.62, 0);
      g.closePath();
      g.fill();
      break;
    case 4:
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? size * 0.36 : size * 0.85;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    default:
      g.moveTo(-size * 0.6, 0);
      g.lineTo(size * 0.6, 0);
      g.moveTo(0, -size * 0.6);
      g.lineTo(0, size * 0.6);
      g.stroke();
  }
  g.restore();
}
