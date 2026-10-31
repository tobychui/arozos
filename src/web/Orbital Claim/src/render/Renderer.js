import { Vec2 } from '../core/Vec2.js';

/**
 * Canvas 2D renderer.
 *
 * Draws in fixed layers (starfield → grid links → asteroids → structures →
 * projectiles → effects → overlays) so depth is predictable without sorting.
 * Everything is culled against the camera's view rect first; with a thousand
 * rocks on screen the cull is the difference between 60 fps and a slideshow.
 */
export class Renderer {
  constructor(canvas, assets, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.camera = camera;
    this.stars = this._makeStars(320);

    // Graphics settings, applied by the Game from the player's preferences.
    this.pixelScale = 1;          // fraction of the device pixel ratio
    this.linkMode = 'animated';   // 'animated' | 'static' | 'hidden'
    this.fxFull = true;           // false drops debris puffs and glow passes
  }

  /** @param {'dense'|'sparse'|'off'} level */
  setStarDensity(level) {
    this.stars = this._makeStars({ dense: 320, sparse: 110, off: 0 }[level] ?? 320);
  }

  _makeStars(n) {
    const stars = [];
    for (let i = 0; i < n; i++) {
      stars.push({
        x: (Math.random() - 0.5) * 4200,
        y: (Math.random() - 0.5) * 4200,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random() * 0.5 + 0.2,
        // Parallax depth: nearer stars drift more as the camera moves.
        depth: 0.25 + Math.random() * 0.5,
      });
    }
    return stars;
  }

  resize() {
    const dpr = (window.devicePixelRatio || 1) * this.pixelScale;
    this.camera.pixelRatio = dpr;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Draw a rasterised sprite centred at world (x,y). */
  sprite(id, x, y, size, angle = 0, alpha = 1) {
    const img = this.assets.get(id);
    const ctx = this.ctx;
    if (!img) {
      ctx.fillStyle = '#f0f';
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  render(world, ui) {
    const ctx = this.ctx;
    const cam = this.camera;
    const view = cam.viewRect();

    ctx.save();
    const dpr = cam.pixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, cam.width, cam.height);

    this._drawStars(ctx, cam);

    ctx.save();
    cam.applyTransform(ctx);

    this._drawFieldEdge(ctx, world);
    if (this.linkMode !== 'hidden') this._drawLinks(ctx, world);
    this._drawAsteroids(ctx, world, view);
    this._drawStructures(ctx, world, view);
    this._drawBots(ctx, world);
    this._drawEnemies(ctx, world, view);
    this._drawWaveTelegraph(ctx, world);
    this._drawProjectiles(ctx, world);
    this._drawEffects(ctx, world);
    if (ui) this._drawPlacement(ctx, world, ui);
    if (ui?.spawnKey) this._drawSpawnGhost(ctx, world, ui);
    if (ui?.sellMode) this._drawSellHover(ctx, world, ui);

    ctx.restore();
    ctx.restore();
  }

  _drawStars(ctx, cam) {
    ctx.save();
    for (const s of this.stars) {
      const x = (s.x - cam.x * s.depth) * cam.zoom + cam.width / 2;
      const y = (s.y - cam.y * s.depth) * cam.zoom + cam.height / 2;
      if (x < -10 || y < -10 || x > cam.width + 10 || y > cam.height + 10) continue;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfe6ff';
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawFieldEdge(ctx, world) {
    ctx.save();
    ctx.strokeStyle = 'rgba(79,209,224,0.10)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, world.fieldRadius + 260, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Power grid.
   *
   * Links that carry power are drawn from the grid's spanning tree, so we know
   * both how much crosses each one and which way it flows. Thickness and
   * brightness track load; a dashed overlay animates along the flow direction
   * so you can see energy moving toward whatever is drawing it. Redundant
   * links (in range, but not the route home) stay thin and dark.
   */
  _drawLinks(ctx, world) {
    const grid = world.grid;
    const t = world.time;
    const drawn = new Set();
    // Static links keep thickness and colour, so load still reads at a glance,
    // but drop the moving charge and the build-site pulse.
    const animated = this.linkMode === 'animated';

    ctx.save();
    ctx.lineCap = 'round';

    // Tree edges: these are the ones actually delivering power.
    for (const s of world.structures) {
      if (!s.alive || !s.gridParent) continue;
      const p = s.gridParent;
      const key = `${Math.min(s.id, p.id)}:${Math.max(s.id, p.id)}`;
      drawn.add(key);

      // Signed: negative means the subtree below is consuming (power flows
      // down), positive means it is producing (a solar exporting upward).
      const flow = s.flowToParent ?? 0;
      const load = Math.abs(flow);
      const exporting = flow > 0;
      // Absolute reference rather than relative to the busiest link, so a quiet
      // base looks quiet instead of everything normalising to "thick".
      const f = Math.min(1, load / 26);
      const width = 1.3 + f * 3.6;
      // Per island, not global: a severed section browns out on its own, and
      // must not be tinted healthy just because the main base is fine.
      const isle = s.island;
      const dead = !s.connected;
      const overdrawn = !dead && !!isle?.overdrawn;

      // Base conductor.
      ctx.lineWidth = width;
      ctx.strokeStyle = dead
        ? 'rgba(130,145,165,0.22)'
        : overdrawn
          ? `rgba(255,198,92,${0.3 + f * 0.45})`
          : `rgba(79,209,224,${0.22 + f * 0.5})`;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.lineTo(s.pos.x, s.pos.y);
      ctx.stroke();

      if (load <= 0.01 || dead || !animated) continue;

      // Flowing charge, drawn along the direction power actually travels: down
      // from the parent into a consuming branch, or up out of a producing one.
      // Exported power is tinted mint so a solar feeding the grid is instantly
      // distinguishable from a consumer being fed.
      const speed = 34 + f * 90;
      const ax = exporting ? s.pos.x : p.pos.x;
      const ay = exporting ? s.pos.y : p.pos.y;
      const bx = exporting ? p.pos.x : s.pos.x;
      const by = exporting ? p.pos.y : s.pos.y;

      ctx.lineWidth = Math.max(1, width * 0.55);
      ctx.strokeStyle = overdrawn
        ? `rgba(255,226,170,${0.35 + f * 0.5})`
        : exporting
          ? `rgba(170,255,215,${0.35 + f * 0.55})`
          : `rgba(190,250,255,${0.3 + f * 0.55})`;
      ctx.setLineDash([5, 13]);
      ctx.lineDashOffset = -((t * speed) % 18);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // A structure under construction pulses its supply line, so build sites
      // are obvious without hunting for the progress ring.
      if (!s.isBuilt) {
        const blink = 0.5 + 0.5 * Math.sin(t * 9);
        ctx.lineWidth = width * 1.5;
        ctx.strokeStyle = `rgba(126,240,192,${0.18 + blink * 0.4})`;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p.pos.x, p.pos.y);
        ctx.lineTo(s.pos.x, s.pos.y);
        ctx.stroke();
      }
    }

    // Redundant / unpowered links.
    ctx.setLineDash([]);
    ctx.lineWidth = 1.1;
    for (const s of world.structures) {
      if (!s.alive) continue;
      for (const n of s.links) {
        const key = `${Math.min(s.id, n.id)}:${Math.max(s.id, n.id)}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        ctx.strokeStyle = s.connected && n.connected
          ? 'rgba(79,209,224,0.12)'
          : 'rgba(120,140,165,0.16)';
        ctx.beginPath();
        ctx.moveTo(s.pos.x, s.pos.y);
        ctx.lineTo(n.pos.x, n.pos.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawAsteroids(ctx, world, view) {
    for (const a of world.asteroids) {
      if (a.pos.x < view.minX || a.pos.x > view.maxX) continue;
      if (a.pos.y < view.minY || a.pos.y > view.maxY) continue;

      // Depleted rocks fade out but stay as navigational landmarks.
      const alpha = a.depleted ? 0.22 : 0.55 + 0.45 * a.fraction;
      this.sprite(a.sprite, a.pos.x, a.pos.y, a.radius * 2.4, a.angle, alpha);

      if (a.selected) {
        ctx.save();
        ctx.strokeStyle = '#7ef0c0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.pos.x, a.pos.y, a.radius + 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (!a.depleted && a.minersInRange > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(126,240,192,0.5)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(a.pos.x, a.pos.y, a.radius + 5, 0, Math.PI * 2 * a.fraction);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  _drawStructures(ctx, world, view) {
    for (const s of world.structures) {
      if (!s.alive) continue;
      if (s.pos.x < view.minX || s.pos.x > view.maxX) continue;
      if (s.pos.y < view.minY || s.pos.y > view.maxY) continue;

      // Mining: a steady extraction beam per worked rock, which flashes once
      // each time ore is banked and fades. The flash rate is the yield.
      if (s.key === 'miner' && s.beams?.length) {
        ctx.save();
        ctx.lineCap = 'round';
        for (const b of s.beams) {
          if (b.a.depleted) continue;
          // Ease the fade so the tail of the flash lingers instead of ramping
          // down linearly, which reads as a pulse rather than a dimmer.
          const f = b.flash * b.flash;

          // Steady conductor, always present while the beam is live.
          ctx.strokeStyle = `rgba(126,240,192,${0.16 + f * 0.24})`;
          ctx.lineWidth = 1.6 + f * 1.4;
          ctx.beginPath();
          ctx.moveTo(s.pos.x, s.pos.y);
          ctx.lineTo(b.a.pos.x, b.a.pos.y);
          ctx.stroke();

          if (f <= 0.01) continue;

          // Bright core on the flash.
          ctx.strokeStyle = `rgba(200,255,230,${f * 0.75})`;
          ctx.lineWidth = 1 + f * 2.2;
          ctx.beginPath();
          ctx.moveTo(s.pos.x, s.pos.y);
          ctx.lineTo(b.a.pos.x, b.a.pos.y);
          ctx.stroke();

          // Bloom at the rock end so the ore visibly comes from somewhere.
          if (!this.fxFull) continue;
          ctx.fillStyle = `rgba(190,255,225,${f * 0.4})`;
          ctx.beginPath();
          ctx.arc(b.a.pos.x, b.a.pos.y, b.a.radius * 0.5 + f * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (s.key === 'repair' && s.beams?.length) {
        ctx.save();
        ctx.strokeStyle = 'rgba(126,240,192,0.45)';
        ctx.lineWidth = 2;
        for (const t of s.beams) {
          ctx.beginPath();
          ctx.moveTo(s.pos.x, s.pos.y);
          ctx.lineTo(t.pos.x, t.pos.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      const size = s.radius * 2.3;
      const building = !s.isBuilt;
      const angle = s instanceof Object && s.angle !== undefined && s.range
        ? s.angle + Math.PI / 2
        : 0;

      // Disabled structures are dimmed so a switched-off battery of launchers
      // reads as off at a glance, not just via its badge.
      const alpha = building ? 0.45 : s.disabled ? 0.38 : 1;
      this.sprite(s.sprite, s.pos.x, s.pos.y, size, angle, alpha);

      if (building) {
        ctx.save();
        ctx.strokeStyle = '#4fd1e0';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius + 7, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * s.buildProgress);
        ctx.stroke();
        ctx.restore();
      }

      // Tier rings. One per level on paths whose silhouette does not otherwise
      // change, so a Focused Beam or a Deep Bore is readable at a glance
      // without hunting through the inspect panel.
      if (s.rings > 0 && s.isBuilt) {
        const mint = s.key === 'repair' || s.key === 'miner';
        const rgb = mint ? '126,240,192' : '79,209,224';
        const breathe = 0.72 + 0.28 * Math.sin(world.time * 2 + s.id);
        ctx.save();
        // Hugged tight to the hull, and deliberately inside the build (+7),
        // upgrade (+9) and selection (+10) rings — further out they read as a
        // progress arc rather than a tier badge.
        for (let i = 0; i < s.rings; i++) {
          ctx.strokeStyle = `rgba(${rgb},${(0.55 - i * 0.12) * breathe})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.pos.x, s.pos.y, s.radius + 1.5 + i * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Upgrade in progress. Mint rather than cyan so it is not mistaken for
      // initial construction — the structure is live and working throughout.
      if (s.upgrading) {
        ctx.save();
        ctx.strokeStyle = 'rgba(126,240,192,0.22)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius + 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#7ef0c0';
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius + 9, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * s.upgradeProgress);
        ctx.stroke();
        // Rotating tick, so a stalled upgrade is visibly stalled.
        const a = world.time * 2.2;
        ctx.fillStyle = 'rgba(190,255,225,0.9)';
        ctx.beginPath();
        ctx.arc(s.pos.x + Math.cos(a) * (s.radius + 9),
                s.pos.y + Math.sin(a) * (s.radius + 9), 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Unpowered structures get a clear, non-fatal warning ring.
      if (s.isBuilt && !s.connected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,120,90,0.75)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // "Show me" highlight from the isolated-structure warning: a few hard
      // blinks plus a ring closing in on the target, so it stands out even in
      // a dense base.
      const locateLeft = (s.locateUntil ?? 0) - performance.now();
      if (locateLeft > 0) {
        const elapsed = 2200 - locateLeft;
        const on = (elapsed % 440) < 260;
        const sweep = (elapsed % 440) / 440;
        ctx.save();
        if (on) {
          ctx.fillStyle = 'rgba(255,200,120,0.28)';
          ctx.beginPath();
          ctx.arc(s.pos.x, s.pos.y, s.radius + 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,226,168,0.95)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(s.pos.x, s.pos.y, s.radius + 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(255,200,120,${0.7 * (1 - sweep)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius + 8 + 40 * (1 - sweep), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Cutting beam. Drawn before the turret body so the emitter sits on top
      // of it, and jittered slightly at the impact point so it reads as
      // burning into the hull rather than as a static line.
      if (s.isBeam && s.beamHeat > 0.02 && s.beamTarget?.alive) {
        const h = s.beamHeat;
        const t = s.beamTarget;
        const jitter = () => (Math.random() - 0.5) * 2.5;
        const mx = s.pos.x + Math.cos(s.angle) * s.radius;
        const my = s.pos.y + Math.sin(s.angle) * s.radius;
        const tx = t.pos.x + jitter();
        const ty = t.pos.y + jitter();

        ctx.save();
        ctx.lineCap = 'round';
        // Outer glow.
        if (this.fxFull) {
          ctx.strokeStyle = `rgba(79,209,224,${0.18 * h})`;
          ctx.lineWidth = 6 * h;
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
        // Bright core.
        ctx.strokeStyle = `rgba(210,250,255,${0.85 * h})`;
        ctx.lineWidth = 1.8 * h;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        // Impact bloom.
        ctx.fillStyle = `rgba(190,250,255,${0.5 * h})`;
        ctx.beginPath();
        ctx.arc(tx, ty, (3 + Math.random() * 2.5) * h, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Battery charge ring, so you can see the buffer draining before the
      // grid actually browns out.
      if (s.key === 'battery' && s.isBuilt) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,198,92,0.18)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
        if (s.fraction > 0) {
          ctx.strokeStyle = s._discharging ? '#ffc65c' : 'rgba(255,198,92,0.75)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(s.pos.x, s.pos.y, s.radius + 6, -Math.PI / 2,
                  -Math.PI / 2 + Math.PI * 2 * s.fraction);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Out of ammo, or switched off: a small badge at the top-left corner.
      // An icon stays legible when a dozen bays are on screen, where blinking
      // text turned into noise.
      if (s.starved || s.disabled) {
        const bx = s.pos.x - s.radius - 2;
        const by = s.pos.y - s.radius - 2;
        ctx.save();
        ctx.fillStyle = s.disabled ? 'rgba(20,26,36,0.92)' : 'rgba(38,14,14,0.92)';
        ctx.strokeStyle = s.disabled ? 'rgba(140,155,175,0.9)' : '#ff4d5e';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = s.disabled ? 'rgba(180,195,215,0.95)' : '#ff6b5c';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        if (s.disabled) {
          // Power symbol: a horizontal bar reads as "switched off".
          ctx.beginPath();
          ctx.moveTo(bx - 3.2, by);
          ctx.lineTo(bx + 3.2, by);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(bx - 3, by - 3);
          ctx.lineTo(bx + 3, by + 3);
          ctx.moveTo(bx + 3, by - 3);
          ctx.lineTo(bx - 3, by + 3);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (s.hp < s.maxHp) this._healthBar(ctx, s);
      if (s.selected) this._selection(ctx, s);
    }
  }

  _healthBar(ctx, s) {
    const w = s.radius * 2;
    const x = s.pos.x - w / 2;
    const y = s.pos.y - s.radius - 12;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, 4);
    const f = s.hp / s.maxHp;
    ctx.fillStyle = f > 0.5 ? '#7ef0c0' : f > 0.25 ? '#ffc65c' : '#ff5a4d';
    ctx.fillRect(x, y, w * f, 4);
    ctx.restore();
  }

  _selection(ctx, s) {
    ctx.save();
    ctx.strokeStyle = '#4fd1e0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, s.radius + 10, 0, Math.PI * 2);
    ctx.stroke();
    if (s.range) {
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, s.range, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Repair drones, plus the mend beam while they are working. */
  _drawBots(ctx, world) {
    for (const b of world.bots) {
      if (!b.alive) continue;

      // Recharge tether: a thin beam from the pad to a drone being patched up.
      // Distinct from the repair beam (dashed, amber-tinted) so "being healed"
      // does not look like "healing something".
      if (b.charging && b.station?.alive) {
        const pulse = 0.55 + 0.45 * Math.sin(world.time * 7 + b.id);
        ctx.save();
        ctx.strokeStyle = `rgba(255,198,92,${0.25 + pulse * 0.4})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 4]);
        ctx.lineDashOffset = -(world.time * 26) % 14;
        ctx.beginPath();
        ctx.moveTo(b.station.pos.x, b.station.pos.y);
        ctx.lineTo(b.pos.x, b.pos.y);
        ctx.stroke();
        ctx.restore();
      }

      if (b.beam > 0 && b.target?.alive) {
        ctx.save();
        ctx.strokeStyle = `rgba(126,240,192,${0.25 + b.beam * 0.45})`;
        ctx.lineWidth = 2 + b.beam;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.pos.x, b.pos.y);
        ctx.lineTo(b.target.pos.x, b.target.pos.y);
        ctx.stroke();
        ctx.restore();
      }

      this.sprite('repair-bot', b.pos.x, b.pos.y, b.radius * 3.2, b.angle + Math.PI / 2);

      if (b.hitFlash > 0) {
        ctx.save();
        ctx.globalAlpha = b.hitFlash * 0.55;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, b.radius * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (b.hp < b.maxHp) {
        const w = 14;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(b.pos.x - w / 2, b.pos.y - b.radius - 7, w, 2.5);
        ctx.fillStyle = '#7ef0c0';
        ctx.fillRect(b.pos.x - w / 2, b.pos.y - b.radius - 7, w * (b.hp / b.maxHp), 2.5);
        ctx.restore();
      }
    }
  }

  _drawEnemies(ctx, world, view) {
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (e.pos.x < view.minX || e.pos.x > view.maxX) continue;
      if (e.pos.y < view.minY || e.pos.y > view.maxY) continue;

      // Sprites are drawn nose-up, so rotate a quarter turn onto the heading.
      this.sprite(e.sprite, e.pos.x, e.pos.y, e.radius * 2.6, e.angle + Math.PI / 2);

      // White flash on hit, so damage registers even in a crowded fight.
      if (e.hitFlash > 0) {
        ctx.save();
        ctx.globalAlpha = e.hitFlash * 0.5;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.radius * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Shield ring — shows whether you are actually breaking through.
      if (e.maxShield && e.shield > 0) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,198,92,${0.35 + 0.45 * (e.shield / e.maxShield)})`;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -(e.ringSpin ?? 0) * 10;
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.radius + 7, 0, Math.PI * 2 * (e.shield / e.maxShield));
        ctx.stroke();
        ctx.restore();
      }

      // Arming tell for exploders: a brief warning you can react to.
      if (e.arming) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,90,77,${0.4 + 0.5 * Math.sin(world.time * 22)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.splash ?? 60, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (e.hp < e.maxHp) {
        const w = Math.max(18, e.radius * 2);
        const x = e.pos.x - w / 2;
        const y = e.pos.y - e.radius - 9;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x, y, w, 3);
        ctx.fillStyle = '#ff5a4d';
        ctx.fillRect(x, y, w * (e.hp / e.maxHp), 3);
        ctx.restore();
      }
    }
  }

  /**
   * Incoming-wave marker. Waves are telegraphed by bearing during the build
   * window, so preparing is a decision rather than a guess.
   */
  _drawWaveTelegraph(ctx, world) {
    const waves = world.waves;
    if (!waves || waves.state !== 'building') return;

    const r = world.fieldRadius + 250;
    const blink = 0.45 + 0.55 * Math.sin(world.time * 3.2);

    // One marker per approach vector: late waves come from several at once, and
    // showing only the first would be actively misleading.
    for (const a of waves.bearings) {
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI / 2);
      ctx.strokeStyle = `rgba(255,90,77,${0.35 + blink * 0.45})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-26, -14);
      ctx.lineTo(0, 20);
      ctx.lineTo(26, -14);
      ctx.stroke();
      ctx.restore();

      // Arc hinting at the spawn spread.
      ctx.save();
      ctx.strokeStyle = `rgba(255,90,77,${0.12 + blink * 0.14})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, r, a - 0.2, a + 0.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawProjectiles(ctx, world) {
    for (const p of world.projectiles) {
      if (!p.alive) continue;
      if (p.team === 'player') {
        // Interceptors trail a faint tracking line to their prey, so it is
        // clear which missile each Aegis launch has claimed.
        if (p.prey?.alive) {
          ctx.save();
          ctx.strokeStyle = 'rgba(126,240,192,0.28)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(p.pos.x, p.pos.y);
          ctx.lineTo(p.prey.pos.x, p.prey.pos.y);
          ctx.stroke();
          ctx.restore();
        }
        this.sprite(p.kind, p.pos.x, p.pos.y, p.kind === 'missile' || p.kind === 'slug' ? 16 : 12,
                    p.angle + Math.PI / 2);
        continue;
      }
      // Locked by an Aegis: a mint reticle marks it as already handled.
      if (p.doomed) {
        ctx.save();
        ctx.strokeStyle = 'rgba(126,240,192,0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // Enemy fire is drawn rather than sprited so it reads red at a glance;
      // tinting a rasterised sprite on a 2D canvas is not worth the cost.
      ctx.save();
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.kind === 'missile' ? '#ffc65c' : '#ff5a4d';
      ctx.fillRect(-6, -1.6, 12, 3.2);
      ctx.fillStyle = 'rgba(255,240,230,0.9)';
      ctx.fillRect(-2, -0.9, 5, 1.8);
      ctx.restore();
    }
  }

  _drawEffects(ctx, world) {
    for (const fx of world.effects) {
      if (fx.delay > 0) continue;          // staggered puff, not started yet
      if (fx.minor && !this.fxFull) continue;
      const t = fx.life / fx.maxLife;

      if (fx.kind === 'ring') {
        // Expanding shockwave: grows as it fades, which reads as a blast front.
        const grow = 1 - t;
        ctx.save();
        ctx.globalAlpha = t * 0.7;
        ctx.strokeStyle = '#ffd08a';
        ctx.lineWidth = 1 + t * 3.5;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.radius * (0.2 + grow * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      this.sprite('blast', fx.x, fx.y, fx.radius * 2 * (1.4 - t * 0.4), 0, t);
    }
  }

  /**
   * Recycle-mode hover: marks what is under the cursor and what it pays back,
   * so selling is a deliberate act rather than a guess.
   */
  _drawSellHover(ctx, world, ui) {
    if (!ui.pointer) return;
    const s = world.structureAt(ui.pointer.x, ui.pointer.y, 6);
    if (!s) return;

    // Everything is recyclable now, except the last thing standing — selling
    // that would end the run outright.
    const locked = world.liveStructures.length <= 1;
    const r = s.radius + 9;
    ctx.save();
    ctx.strokeStyle = locked ? 'rgba(120,135,155,0.8)' : '#ff5a4d';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(s.pos.x, s.pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = locked ? 'rgba(160,175,195,0.9)' : '#7ef0c0';
    ctx.fillText(locked ? 'last structure' : `+${s.refundValue()}`, s.pos.x, s.pos.y - r - 6);
    ctx.restore();
  }

  /** Sandbox: the enemy about to be spawned, and the scatter area for a group. */
  _drawSpawnGhost(ctx, world, ui) {
    const def = world.data.enemies?.[ui.spawnKey];
    if (!def || !ui.pointer) return;
    const { x, y } = ui.pointer;
    const r = def.radius ?? 12;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,90,77,0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(x, y, ui.spawnCount > 1 ? 60 + r : r + 6, 0, Math.PI * 2);
    ctx.stroke();
    if (ui.spawnCount > 1) {
      ctx.setLineDash([]);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff9a8b';
      ctx.fillText(`×${ui.spawnCount}`, x, y - 66 - r);
    }
    ctx.restore();
    this.sprite(def.sprite, x, y, r * 2.4, 0, 0.6);
  }

  /** Ghost of the structure being placed, plus the links it would form. */
  _drawPlacement(ctx, world, ui) {
    if (!ui.buildKey || !ui.pointer) return;
    const def = world.defFor(ui.buildKey);
    if (!def) return;

    const { x, y } = ui.pointer;
    const check = world.canPlaceAt(ui.buildKey, x, y);
    const ok = check.ok;
    // Allowed, but nothing will reach it: the site is legal and stays at 0%
    // until a relay arrives. Warn rather than block.
    const offGrid = ok && check.offGrid;

    const links = world.grid.previewLinks(x, y, world.structures.filter((s) => s.alive));
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ok ? 'rgba(79,209,224,0.5)' : 'rgba(255,90,77,0.4)';
    for (const s of links) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(s.pos.x, s.pos.y);
      ctx.stroke();
    }

    if (def.range) {
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = ok ? '#4fd1e0' : '#ff5a4d';
      ctx.beginPath();
      ctx.arc(x, y, def.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Link radius, so players can see how far the grid will reach.
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#7ef0c0';
    ctx.beginPath();
    ctx.arc(x, y, world.grid.linkRange, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    this.sprite(def.sprite, x, y, (def.radius ?? 18) * 2.3, 0, ok ? 0.7 : 0.3);

    // Off-grid sites get a dashed amber ring and nothing else — the ring reads
    // fine on its own, and a caption under the cursor was just noise.
    if (offGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,198,92,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, (def.radius ?? 18) + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (!ok) {
      ctx.save();
      ctx.strokeStyle = '#ff5a4d';
      ctx.lineWidth = 2.5;
      const r = (def.radius ?? 18) + 6;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r * 0.7, y - r * 0.7);
      ctx.lineTo(x + r * 0.7, y + r * 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }
}
