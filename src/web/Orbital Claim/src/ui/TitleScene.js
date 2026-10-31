const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Raider types: sprite, hull, cruise speed and size, at scale 1. */
const RAIDERS = {
  fighter: { sprite: 'fighter', hp: 40, speed: 75, size: 30, hit: 13 },
  swarmer: { sprite: 'swarmer', hp: 16, speed: 115, size: 22, hit: 9 },
};

/**
 * Animated backdrop for the title screen.
 *
 * A small, self-running picture of the game: a ringed planet low in one corner
 * whose ring is the asteroid field, an outpost wired together by flowing power
 * links with its miner working a rock, and now and then a raid that comes at
 * the outpost and is cut down by its guns. It borrows the game's sprites but
 * none of its systems, so it runs before any World exists and never touches
 * one.
 *
 * Kept quiet on purpose: everything is dim, the middle of the screen is
 * darkened behind the title and the mode cards, and nothing runs while the
 * title is hidden. With reduced motion requested it draws one still frame.
 */
export class TitleScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/Assets.js').Assets} assets
   */
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;

    // Mirrors of the player's graphics settings, kept current by the Game.
    this.pixelScale = 1;
    this.starDensity = 'dense';
    this.fxFull = true;

    this.running = false;
    this.time = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);
    this._motion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    window.addEventListener('resize', () => {
      if (this.running) this.resize();
    });
  }

  get still() {
    return !!this._motion?.matches;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    if (this.still) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  /** @param {'dense'|'sparse'|'off'} level */
  setStarDensity(level) {
    this.starDensity = level;
    if (this.w) this._makeStars();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;   // hidden: laid out again on the next start
    this.w = w;
    this.h = h;
    this.dpr = (window.devicePixelRatio || 1) * this.pixelScale;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this._layout();
    if (this.still) this._draw();
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    // Clamped, so coming back to a backgrounded tab does not jump the scene.
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._update(dt);
    this._draw();
  }

  // ------------------------------------------------------------------ layout

  _layout() {
    const { w, h } = this;
    // Scene scale: everything is sized for an 800px-tall window, and shrinks on
    // narrow ones so the outpost stays clear of the title.
    const k = Math.max(0.55, Math.min(1.3, Math.min(w, h) / 800, w / 1300));
    this.k = k;

    const r = Math.max(w, h) * 0.3;
    this.planet = { x: w * 0.12, y: h + r * 0.1, r };
    this.ring = { rx: r * 1.8, ry: r * 0.36, tilt: -0.2 };

    this.rocks = [];
    const count = Math.round(70 * Math.min(1.4, w / 1280 + 0.25));
    for (let i = 0; i < count; i++) {
      this.rocks.push({
        th: rand(0, TAU),
        // Two uniform draws make a soft-edged band instead of a hard stripe.
        dr: (rand(-1, 1) + rand(-1, 1)) * 0.06,
        speed: rand(0.012, 0.022),
        size: rand(7, 20) * k,
        rot: rand(0, TAU),
        spin: rand(-0.4, 0.4),
        sprite: pick(['asteroid-a', 'asteroid-b', 'asteroid-c']),
      });
    }

    // The outpost sits in the top right corner, clear of the title line.
    const ox = w - 210 * k;
    const oy = Math.max(105 * k, h * 0.17);
    const at = (dx, dy, extra = {}) => ({ x: ox + dx * k, y: oy + dy * k, angle: -Math.PI / 2, ...extra });
    const b = {
      solar: at(0, 0, { sprite: 'solar-4' }),
      relay: at(-95, 55, { sprite: 'relay' }),
      laser: at(-60, -70, { sprite: 'laser', range: 260 * k, turn: 5, heat: 0 }),
      pulser: at(-170, 40, { sprite: 'pulser', range: 320 * k, turn: 7, cd: 0, barrel: 0 }),
      miner: at(85, -40, { sprite: 'miner' }),
    };
    this.base = b;
    this.structures = Object.values(b);
    this.links = [[b.solar, b.relay], [b.solar, b.laser], [b.solar, b.miner], [b.relay, b.pulser]];
    this.ore = at(170, -88, { sprite: 'asteroid-b', size: 46 * k, angle: 0 });

    this.enemies = [];
    this.bolts = [];
    this.effects = [];
    this.comets = [];
    this.raidIn = 2.5;
    this.cometIn = rand(2, 5);

    this._makeStars();
    this._paintNebula();
    this._paintPlanet();
    this._paintVignette();
  }

  _makeStars() {
    const { w, h } = this;
    const density = { dense: 1, sparse: 0.4, off: 0 }[this.starDensity] ?? 1;
    const n = Math.round((w * h) / 4200 * density);
    this.stars = [];
    for (let i = 0; i < n; i++) {
      const layer = i % 3; // far, middle, near
      this.stars.push({
        x: rand(0, w),
        y: rand(0, h),
        layer,
        size: [0.8, 1.2, 1.7][layer] * rand(0.75, 1.2),
        a: rand(0.25, 0.8),
        tw: rand(0.6, 2.2),
        ph: rand(0, TAU),
        color: Math.random() < 0.12 ? '#ffe2b8' : Math.random() < 0.2 ? '#a8f0ff' : '#cfe6ff',
      });
    }
  }

  /** An offscreen canvas the size of the view, with the dpr transform set. */
  _layer(scale = 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.w * this.dpr * scale));
    c.height = Math.max(1, Math.round(this.h * this.dpr * scale));
    const g = c.getContext('2d');
    g.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, 0, 0);
    return { c, g };
  }

  /** Soft colour clouds, at half resolution since they are all gradient. */
  _paintNebula() {
    const { w, h } = this;
    const s = Math.min(w, h);
    const { c, g } = this._layer(0.5);
    for (const [x, y, r, rgb, a] of [
      [w * 0.8, h * 0.22, s * 0.75, '79,209,224', 0.11],
      [w * 0.22, h * 0.15, s * 0.6, '106,76,255', 0.08],
      [w * 0.58, h * 0.92, s * 0.7, '46,160,140', 0.06],
    ]) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${rgb},${a})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    this.nebula = c;
  }

  _paintPlanet() {
    const { x, y, r } = this.planet;
    const { c, g } = this._layer();

    // Atmosphere haze beyond the limb.
    const halo = g.createRadialGradient(x, y, r * 0.98, x, y, r * 1.12);
    halo.addColorStop(0, 'rgba(79,209,224,0.2)');
    halo.addColorStop(1, 'rgba(79,209,224,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, r * 1.12, 0, TAU);
    g.fill();

    // Lit from the upper right, which is the side facing the title.
    const lx = x + r * 0.45;
    const ly = y - r * 0.55;
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.clip();
    const body = g.createRadialGradient(lx, ly, r * 0.05, x, y, r);
    body.addColorStop(0, '#2b6a7a');
    body.addColorStop(0.45, '#123544');
    body.addColorStop(1, '#060f17');
    g.fillStyle = body;
    g.fillRect(x - r, y - r, r * 2, r * 2);

    // Cloud bands, tilted with the ring.
    g.translate(x, y);
    g.rotate(this.ring.tilt);
    for (let i = 0; i < 16; i++) {
      const light = Math.random() < 0.5;
      g.fillStyle = light
        ? `rgba(120,220,230,${rand(0.04, 0.1)})`
        : `rgba(4,14,22,${rand(0.08, 0.18)})`;
      g.beginPath();
      g.ellipse(rand(-r * 0.2, r * 0.2), rand(-r, r), r * 1.2, rand(r * 0.012, r * 0.05), 0, 0, TAU);
      g.fill();
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Night side.
    const shade = g.createLinearGradient(lx, ly, x - r * 0.7, y + r * 0.7);
    shade.addColorStop(0, 'rgba(2,4,10,0)');
    shade.addColorStop(0.5, 'rgba(2,4,10,0.55)');
    shade.addColorStop(1, 'rgba(2,4,10,0.94)');
    g.fillStyle = shade;
    g.fillRect(x - r, y - r, r * 2, r * 2);

    // Lights of claimed ground, only where it is dark enough to see them.
    const ux = 0.63;
    const uy = -0.77;
    for (let i = 0; i < 90; i++) {
      const a = rand(0, TAU);
      const d = Math.sqrt(Math.random()) * r * 0.97;
      const dx = Math.cos(a) * d;
      const dy = Math.sin(a) * d;
      if ((dx * ux + dy * uy) / r > -0.15) continue;
      g.fillStyle = `rgba(126,240,192,${rand(0.25, 0.7)})`;
      g.fillRect(x + dx, y + dy, 1.3, 1.3);
    }
    g.restore();

    // Sunlit limb.
    const mid = Math.atan2(uy, ux);
    g.lineCap = 'round';
    for (const [width, alpha] of [[9, 0.07], [2.2, 0.5]]) {
      g.strokeStyle = `rgba(170,240,255,${alpha})`;
      g.lineWidth = width;
      g.beginPath();
      g.arc(x, y, r, mid - 1.15, mid + 1.15);
      g.stroke();
    }
    this.planetLayer = c;
  }

  /** Darkens the middle behind the title text and the corners, once. */
  _paintVignette() {
    const { w, h } = this;
    const { c, g } = this._layer(0.25);
    const R = Math.hypot(w, h) / 2;
    const grad = g.createRadialGradient(w / 2, h * 0.48, 0, w / 2, h * 0.48, R);
    grad.addColorStop(0, 'rgba(3,5,10,0.55)');
    grad.addColorStop(0.32, 'rgba(3,5,10,0.32)');
    grad.addColorStop(0.62, 'rgba(3,5,10,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    this.vignette = c;
  }

  // ------------------------------------------------------------------ update

  _update(dt) {
    this.time += dt;
    const { w } = this;

    for (const st of this.stars) {
      st.x -= [3, 7, 13][st.layer] * dt;
      if (st.x < -2) st.x += w + 4;
    }
    for (const r of this.rocks) {
      r.th += r.speed * dt;
      r.rot += r.spin * dt;
    }
    this.ore.angle += 0.05 * dt;

    this._updateRaid(dt);

    for (const fx of this.effects) fx.life -= dt;
    this.effects = this.effects.filter((fx) => fx.life > 0);

    this.cometIn -= dt;
    if (this.cometIn <= 0) {
      this.cometIn = rand(5, 11);
      const a = Math.PI * 0.78 + rand(-0.12, 0.12);
      const speed = rand(600, 850);
      this.comets.push({
        x: rand(this.w * 0.25, this.w * 1.05), y: -20,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1.6, max: 1.6,
      });
    }
    for (const cm of this.comets) {
      cm.x += cm.vx * dt;
      cm.y += cm.vy * dt;
      cm.life -= dt;
    }
    this.comets = this.comets.filter((cm) => cm.life > 0);
  }

  _spawnRaid() {
    const k = this.k;
    const { w, h } = this;
    const swarm = Math.random() < 0.4;
    const n = swarm ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
    // One approach for the whole group, from off the right or the top edge.
    const fromTop = Math.random() < 0.35;
    const sx = fromTop ? rand(w * 0.65, w) : w + 50;
    const sy = fromTop ? -50 : rand(h * 0.02, h * 0.55);
    for (let i = 0; i < n; i++) {
      const type = swarm && i > 0 ? RAIDERS.swarmer : pick([RAIDERS.fighter, RAIDERS.swarmer]);
      this.enemies.push({
        ...type,
        x: sx + rand(-50, 50) * k,
        y: sy + rand(-50, 50) * k,
        vx: 0, vy: 0, angle: Math.PI,
        speed: type.speed * k,
        size: type.size * k,
        hit: type.hit * k,
        stand: rand(150, 205) * k,
        dir: Math.random() < 0.5 ? -1 : 1,
        cd: rand(0.6, 1.6),
        flash: 0,
      });
    }
  }

  _updateRaid(dt) {
    const b = this.base;
    const k = this.k;
    if (!this.enemies.length) {
      this.raidIn -= dt;
      if (this.raidIn <= 0) {
        this.raidIn = rand(7, 11);
        this._spawnRaid();
      }
    }

    for (const e of this.enemies) {
      // Close on the outpost, then hold at gun range and circle it.
      const dx = b.solar.x - e.x;
      const dy = b.solar.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      let vx = (dx / d) * e.speed;
      let vy = (dy / d) * e.speed;
      if (d < e.stand) {
        vx = (-dy / d) * e.speed * 0.45 * e.dir;
        vy = (dx / d) * e.speed * 0.45 * e.dir;
      }
      const ease = Math.min(1, dt * 2);
      e.vx += (vx - e.vx) * ease;
      e.vy += (vy - e.vy) * ease;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.angle = Math.atan2(e.vy, e.vx);
      e.flash = Math.max(0, e.flash - dt * 4);

      e.cd -= dt;
      if (d < e.stand * 1.2 && e.cd <= 0) {
        e.cd = rand(1.1, 1.8);
        const t = pick(this.structures);
        this._bolt(e.x, e.y, t.x, t.y, 'enemy');
      }
    }

    // The laser cuts whatever it has swung onto.
    const laser = b.laser;
    const cutting = this._aim(laser, dt);
    if (cutting) {
      laser.target.hp -= 26 * dt;
      laser.target.flash = Math.max(laser.target.flash, 0.5);
    }
    laser.heat += ((cutting ? 1 : 0) - laser.heat) * Math.min(1, dt * 12);

    // The pulser throws bolts from alternating barrels.
    const pulser = b.pulser;
    pulser.cd -= dt;
    if (this._aim(pulser, dt) && pulser.cd <= 0) {
      pulser.cd = 0.42;
      pulser.barrel ^= 1;
      const off = (pulser.barrel ? 5 : -5) * k;
      const px = pulser.x + Math.cos(pulser.angle) * 16 * k - Math.sin(pulser.angle) * off;
      const py = pulser.y + Math.sin(pulser.angle) * 16 * k + Math.cos(pulser.angle) * off;
      this._bolt(px, py, pulser.target.x, pulser.target.y, 'player');
    }

    for (const p of this.bolts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.team === 'player') {
        for (const e of this.enemies) {
          if (Math.hypot(e.x - p.x, e.y - p.y) < e.hit) {
            e.hp -= 9;
            e.flash = 1;
            p.life = 0;
            this._blast(p.x, p.y, 10 * k);
            break;
          }
        }
      } else if (Math.hypot(p.tx - p.x, p.ty - p.y) < 10 * k) {
        p.life = 0;
        this._blast(p.x, p.y, 11 * k);
      }
    }
    this.bolts = this.bolts.filter((p) => p.life > 0);

    for (const e of this.enemies) {
      if (e.hp > 0) continue;
      this._blast(e.x, e.y, e.size * 1.1);
      if (this.fxFull) this.effects.push({ kind: 'ring', x: e.x, y: e.y, r: e.size * 2, life: 0.5, max: 0.5 });
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  /** Turn a turret toward the nearest raider in range; true once aimed. */
  _aim(tur, dt) {
    const near = (e) => Math.hypot(e.x - tur.x, e.y - tur.y);
    if (tur.target && (tur.target.hp <= 0 || near(tur.target) > tur.range)) tur.target = null;
    if (!tur.target) {
      let best = Infinity;
      for (const e of this.enemies) {
        const d = near(e);
        if (d < tur.range && d < best) {
          best = d;
          tur.target = e;
        }
      }
    }
    if (!tur.target) {
      // Idle guns sweep slowly, so the outpost never looks frozen.
      tur.angle += Math.sin(this.time * 0.4 + tur.x) * 0.3 * dt;
      return false;
    }
    let diff = Math.atan2(tur.target.y - tur.y, tur.target.x - tur.x) - tur.angle;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    const step = tur.turn * dt;
    tur.angle += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
    return Math.abs(diff) < 0.2;
  }

  _bolt(x, y, tx, ty, team) {
    const d = Math.hypot(tx - x, ty - y) || 1;
    const speed = (team === 'player' ? 520 : 380) * this.k;
    this.bolts.push({
      x, y, tx, ty, team,
      vx: ((tx - x) / d) * speed, vy: ((ty - y) / d) * speed,
      angle: Math.atan2(ty - y, tx - x), life: 1.3,
    });
  }

  _blast(x, y, r) {
    this.effects.push({ kind: 'blast', x, y, r, life: 0.35, max: 0.35 });
  }

  // -------------------------------------------------------------------- draw

  _draw() {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const t = this.time;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);

    // Nebula drifts a few pixels, which is enough to make the sky feel alive.
    // Drawn oversize so the drift never uncovers an edge.
    ctx.drawImage(this.nebula, Math.sin(t * 0.05) * 14 - 20, Math.cos(t * 0.04) * 10 - 20, w + 40, h + 40);

    for (const st of this.stars) {
      ctx.globalAlpha = st.a * (0.72 + 0.28 * Math.sin(t * st.tw + st.ph));
      ctx.fillStyle = st.color;
      ctx.fillRect(st.x, st.y, st.size, st.size);
    }
    ctx.globalAlpha = 1;

    this._drawComets(ctx);

    // The ring passes behind the planet and in front of it.
    this._drawRing(ctx, false);
    this._drawRocks(ctx, false);
    ctx.drawImage(this.planetLayer, 0, 0, w, h);
    this._drawRing(ctx, true);
    this._drawRocks(ctx, true);

    this._drawOutpost(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0, w, h);
  }

  _sprite(id, x, y, size, angle = 0, alpha = 1) {
    const img = this.assets.get(id);
    if (!img) return;
    const ctx = this.ctx;
    const c = Math.cos(angle) * this.dpr;
    const s = Math.sin(angle) * this.dpr;
    ctx.setTransform(c, s, -s, c, x * this.dpr, y * this.dpr);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  }

  _drawComets(ctx) {
    ctx.lineCap = 'round';
    for (const cm of this.comets) {
      const a = Math.min(1, cm.life / cm.max * 1.6);
      const n = Math.hypot(cm.vx, cm.vy);
      const len = 150 * this.k;
      const tx = cm.x - (cm.vx / n) * len;
      const ty = cm.y - (cm.vy / n) * len;
      const grad = ctx.createLinearGradient(cm.x, cm.y, tx, ty);
      grad.addColorStop(0, `rgba(225,250,255,${0.85 * a})`);
      grad.addColorStop(1, 'rgba(79,209,224,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cm.x, cm.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  }

  /** Dust lanes of the ring: the near half or the far half. */
  _drawRing(ctx, front) {
    const { x, y } = this.planet;
    const { rx, ry, tilt } = this.ring;
    const [a0, a1] = front ? [0, Math.PI] : [Math.PI, TAU];
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const [f, width, alpha] of [[0.86, 10, 0.035], [0.95, 3, 0.09], [1.0, 14, 0.04], [1.07, 2, 0.08], [1.14, 6, 0.03]]) {
      ctx.globalAlpha = front ? alpha * 1.4 : alpha;
      ctx.strokeStyle = '#9fe6ee';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse(x, y, rx * f, ry * f, tilt, a0, a1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawRocks(ctx, front) {
    const { x, y } = this.planet;
    const { rx, ry, tilt } = this.ring;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    for (const r of this.rocks) {
      const sin = Math.sin(r.th);
      if ((sin > 0) !== front) continue;
      const lx = Math.cos(r.th) * rx * (1 + r.dr);
      const ly = sin * ry * (1 + r.dr);
      const px = x + lx * ct - ly * st;
      const py = y + lx * st + ly * ct;
      // Nearer rocks are bigger and brighter: cheap depth for a flat ring.
      const near = (sin + 1) / 2;
      const size = r.size * (0.65 + 0.55 * near);
      if (px < -size || py < -size || px > this.w + size || py > this.h + size) continue;
      this._sprite(r.sprite, px, py, size, r.rot, 0.35 + 0.55 * near);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  _drawOutpost(ctx) {
    const { dpr, k } = this;
    const t = this.time;
    const b = this.base;

    this._sprite(this.ore.sprite, this.ore.x, this.ore.y, this.ore.size, this.ore.angle, 0.85);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    // Power links, with charge flowing out from the solar as in the game.
    for (const [from, to] of this.links) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(79,209,224,0.35)';
      ctx.lineWidth = 2.4 * k;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190,250,255,0.6)';
      ctx.lineWidth = 1.3 * k;
      ctx.setLineDash([5 * k, 13 * k]);
      ctx.lineDashOffset = -((t * 60 * k) % (18 * k));
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Mining beam, flashing each time ore is banked.
    const phase = (t % 1.4) / 1.4;
    const flash = Math.max(0, 1 - phase * 3) ** 2;
    ctx.strokeStyle = `rgba(126,240,192,${0.18 + flash * 0.3})`;
    ctx.lineWidth = (1.6 + flash * 1.6) * k;
    ctx.beginPath();
    ctx.moveTo(b.miner.x, b.miner.y);
    ctx.lineTo(this.ore.x, this.ore.y);
    ctx.stroke();
    if (flash > 0.01 && this.fxFull) {
      ctx.fillStyle = `rgba(190,255,225,${flash * 0.35})`;
      ctx.beginPath();
      ctx.arc(this.ore.x, this.ore.y, this.ore.size * 0.3 + flash * 6 * k, 0, TAU);
      ctx.fill();
    }

    const size = 42 * k;
    for (const s of this.structures) {
      const turret = s.range !== undefined;
      this._sprite(s.sprite, s.x, s.y, size, turret ? s.angle + Math.PI / 2 : 0);
    }

    // Laser beam, glow then core, as the game draws it.
    const laser = b.laser;
    if (laser.heat > 0.02 && laser.target) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      const mx = laser.x + Math.cos(laser.angle) * 18 * k;
      const my = laser.y + Math.sin(laser.angle) * 18 * k;
      const tx = laser.target.x + rand(-1.2, 1.2);
      const ty = laser.target.y + rand(-1.2, 1.2);
      for (const [width, color] of this.fxFull
        ? [[6, `rgba(79,209,224,${0.18 * laser.heat})`], [1.8, `rgba(210,250,255,${0.85 * laser.heat})`]]
        : [[1.8, `rgba(210,250,255,${0.85 * laser.heat})`]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * laser.heat * k;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }

    for (const e of this.enemies) {
      this._sprite(e.sprite, e.x, e.y, e.size, e.angle + Math.PI / 2);
      if (e.flash > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = e.flash * 0.45;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * 0.42, 0, TAU);
        ctx.fill();
      }
    }

    for (const p of this.bolts) {
      if (p.team === 'player') {
        this._sprite('bolt', p.x, p.y, 12 * k, p.angle + Math.PI / 2);
        continue;
      }
      // Enemy fire is drawn rather than sprited, red like in the game.
      const c = Math.cos(p.angle) * dpr;
      const s = Math.sin(p.angle) * dpr;
      ctx.setTransform(c, s, -s, c, p.x * dpr, p.y * dpr);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff5a4d';
      ctx.fillRect(-6 * k, -1.5 * k, 12 * k, 3 * k);
    }

    for (const fx of this.effects) {
      const f = fx.life / fx.max;
      if (fx.kind === 'ring') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = f * 0.7;
        ctx.strokeStyle = '#ffd08a';
        ctx.lineWidth = 1 + f * 3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * (0.2 + (1 - f) * 0.9), 0, TAU);
        ctx.stroke();
        continue;
      }
      this._sprite('blast', fx.x, fx.y, fx.r * 2 * (1.4 - f * 0.4), 0, f);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }
}
