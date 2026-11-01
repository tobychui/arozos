/**
 * Small enemies and the boss.
 *
 * An enemy moves by velocity (vx / vy) or in polar form (s, a, acc, w) and
 * runs its own script coroutine. It vanishes quietly once it has been on
 * screen and leaves again. Touching an enemy is as deadly as a bullet.
 *
 * The boss has no velocity of its own: card scripts steer it with the
 * non-blocking moveTo() (eased) or wander(). Damage is only taken while a
 * card is running and its start-up shield is down; bombs do half damage.
 */
import { TAU, ease, rgba } from '../core/util.js';
import { PF } from '../core/view.js';
import { ENEMY_KINDS, drawEnemy } from '../gfx/enemyart.js';
import { CAST } from '../data/characters.js';

export class Enemy {
  constructor(G, kind, x, y, o = {}) {
    const def = ENEMY_KINDS[kind] || ENEMY_KINDS.wisp;
    this.G = G;
    this.kind = kind;
    this.def = def;
    this.x = x;
    this.y = y;
    this.vx = o.vx || 0;
    this.vy = o.vy || 0;
    if (o.s !== undefined) {
      this.s = o.s;
      this.a = o.a ?? Math.PI / 2;
      this.acc = o.acc || 0;
      this.w = o.w || 0;
    }
    this.hp = this.maxHp = o.hp ?? def.hp;
    this.r = o.r ?? def.r;
    this.color = o.color || 'red';
    this.drops = o.drops ?? { power: 1 };
    this.score = o.score ?? Math.round(this.maxHp * 10 + 100);
    this.t = 0;
    this.flash = 0;
    this.dead = false;
    this.seen = false;
    this.invuln = o.invuln || 0;
    this.familiar = !!o.familiar;
    this.scale = o.scale || 1;
    this.task = null;
    this.data = o.data || {};
    this.thread = o.thread || false; // spiders hang from a thread
    this.anchorY = y;
  }

  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.invuln > 0) this.invuln--;
    if (this.task) this.task.step();
    if (this.dead) return;
    if (this.s !== undefined) {
      this.s += this.acc;
      this.a += this.w;
      this.x += Math.cos(this.a) * this.s;
      this.y += Math.sin(this.a) * this.s;
    } else {
      this.x += this.vx;
      this.y += this.vy;
    }
    const m = this.r + 8;
    const on = this.x > -m && this.x < PF.w + m && this.y > -m && this.y < PF.h + m;
    if (on && this.y > 0) this.seen = true;
    else if ((this.seen && !on) || this.t > 1800) {
      this.dead = true;
      this.silent = true;
      return;
    }
    const p = this.G.player;
    if (p.canBeHit()) {
      const rr = this.r * 0.6 + p.hitR;
      if ((p.x - this.x) ** 2 + (p.y - this.y) ** 2 < rr * rr) p.hit();
    }
  }

  damage(d) {
    if (this.dead || this.invuln > 0 || !this.seen) return;
    this.hp -= d;
    this.flash = 2;
    this.G.score += Math.round(d * 4);
    if (this.hp <= 0) {
      this.dead = true;
      this.G.onEnemyDie(this);
    }
  }

  kill(silent = false) {
    if (this.dead) return;
    this.dead = true;
    if (silent) this.silent = true;
    else this.G.onEnemyDie(this);
  }

  render(ctx, art, px) {
    const def = this.def;
    const f = def.frames > 1 ? Math.floor(this.t / 6) % def.frames : 0;
    const spr = drawEnemy(art, this.kind, this.color, f);
    if (this.thread) {
      ctx.setTransform(px, 0, 0, px, PF.x * px, PF.y * px);
      ctx.strokeStyle = 'rgba(230,220,255,0.55)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(this.x, -10);
      ctx.lineTo(this.x, this.y - 6);
      ctx.stroke();
    }
    ctx.setTransform(px, 0, 0, px, (PF.x + this.x) * px, (PF.y + this.y) * px);
    if (def.orient) ctx.rotate(Math.atan2(this.vy || Math.sin(this.a ?? 0) * (this.s ?? 1), this.vx || Math.cos(this.a ?? 0) * (this.s ?? 1)));
    else if (this.kind === 'star') ctx.rotate(this.t * 0.05);
    const s = this.scale;
    ctx.drawImage(spr.img, (-spr.w / 2) * s, (-spr.h / 2) * s, spr.w * s, spr.h * s);
    if (this.flash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(spr.img, (-spr.w / 2) * s, (-spr.h / 2) * s, spr.w * s, spr.h * s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

export class Boss {
  constructor(G, def) {
    this.G = G;
    this.def = def;
    this.cast = CAST[def.char];
    this.x = PF.w / 2;
    this.y = -60;
    this.r = 26;
    this.hp = 1;
    this.maxHp = 1;
    this.dead = false;
    this.invuln = 0;
    this.card = null;
    this.flash = 0;
    this.t = 0;
    this.mv = null;
    this.seen = true;
    this.isBoss = true;
    this.fighting = false;
    this.visible = true;
  }

  get color() {
    return this.cast.color;
  }

  /** Eased, non-blocking move. */
  moveTo(x, y, frames = 60, how = 'inOut') {
    this.mv = { sx: this.x, sy: this.y, tx: x, ty: y, t: 0, n: Math.max(1, frames), how };
  }

  get moving() {
    return !!this.mv;
  }

  /** Drift to a random spot near the player's column inside the upper band. */
  wander(frames = 60, xr = 70, y0 = 70, y1 = 150) {
    const G = this.G;
    const px = G.player.x;
    let tx = this.x + (px > this.x ? 1 : -1) * G.rng.range(10, xr);
    tx = Math.max(60, Math.min(PF.w - 60, tx));
    const ty = G.rng.range(y0, y1);
    this.moveTo(tx, ty, frames);
  }

  update() {
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.invuln > 0) this.invuln--;
    if (this.mv) {
      const m = this.mv;
      m.t++;
      const k = ease[m.how](Math.min(1, m.t / m.n));
      this.x = m.sx + (m.tx - m.sx) * k;
      this.y = m.sy + (m.ty - m.sy) * k;
      if (m.t >= m.n) this.mv = null;
    }
    const p = this.G.player;
    if (this.fighting && p.canBeHit()) {
      const rr = 14 + p.hitR;
      if ((p.x - this.x) ** 2 + (p.y - this.y) ** 2 < rr * rr) p.hit();
    }
  }

  get targetable() {
    return this.fighting && this.card && !this.card.survival && this.invuln <= 0 && this.hp > 0;
  }

  damage(d, bomb = false) {
    if (!this.targetable) return;
    if (bomb) d *= 0.5;
    this.hp -= d;
    if (this.hp < 0) this.hp = 0;
    this.flash = 2;
    this.G.score += Math.round(d * 4);
    if (this.t % 4 === 0) this.G.sfx(this.hp < this.maxHp * 0.15 ? 'hitLow' : 'hit');
  }

  render(ctx, art, px) {
    if (!this.visible) return;
    const G = this.G;
    const c = this.cast;
    // magic circle
    ctx.setTransform(px, 0, 0, px, (PF.x + this.x) * px, (PF.y + this.y) * px);
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.55 + Math.sin(this.t * 0.05) * 0.15;
    ctx.globalAlpha = pulse;
    ctx.rotate(this.t * 0.02);
    ctx.strokeStyle = rgba(c.color, 0.8);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 42, Math.sin(a) * 42, 7, 3, a, 0, TAU);
      ctx.stroke();
    }
    ctx.rotate(-this.t * 0.05);
    ctx.strokeStyle = rgba(c.accent, 0.6);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      const a2 = ((i + 2) * TAU) / 6;
      ctx.moveTo(Math.cos(a) * 34, Math.sin(a) * 34);
      ctx.lineTo(Math.cos(a2) * 34, Math.sin(a2) * 34);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (this.fighting && this.invuln > 0) {
      ctx.globalAlpha = Math.min(1, this.invuln / 30) * 0.6;
      const g = art.glow(c.color, 64);
      ctx.drawImage(g.img, -45, -45, 90, 90);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    // body
    const spr = G.charArt.chibi(this.def.char, 72);
    ctx.setTransform(px, 0, 0, px, (PF.x + this.x) * px, (PF.y + this.y + Math.sin(this.t * 0.06) * 2) * px);
    ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    if (this.flash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25;
      ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
