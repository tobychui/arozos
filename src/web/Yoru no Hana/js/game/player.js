/**
 * The heroine: movement, shots, options, bombs, death and respawn.
 *
 * Akari  - wide, with homing embers from her lantern options; her bomb sends
 *          eight lanterns out to sweep the field and burst.
 * Shizuku - narrow and strong; focused, her mirrors become piercing beams.
 *          Her bomb is a moon on the water whose ripples wash the screen.
 *
 * Getting hit opens a short death-bomb window; bombing inside it saves the
 * life. Power (1.00 - 4.00) decides how many options fly with her.
 */
import { TAU, clamp, lerp, rgba } from '../core/util.js';
import { PF } from '../core/view.js';

export const SHOTS = {
  akari: {
    speed: 4.6,
    focusSpeed: 2.0,
    shotName: 'Lantern Shot',
    shotDesc: 'Wide. Lantern options fire homing embers; focus to aim them straight.',
    bombName: 'Thousand Lantern Night',
    unfocused: [[[0, -26]], [[-22, 2], [22, 2]], [[-24, 4], [0, -26], [24, 4]], [[-30, 6], [-13, -18], [13, -18], [30, 6]]],
    focused: [[[0, -22]], [[-10, -20], [10, -20]], [[-13, -16], [0, -26], [13, -16]], [[-17, -12], [-6, -24], [6, -24], [17, -12]]],
  },
  shizuku: {
    speed: 4.1,
    focusSpeed: 1.8,
    shotName: 'Mirror Shot',
    shotDesc: 'Strong forward fire. Focused, the mirrors turn into piercing beams.',
    bombName: 'Moon on the Water',
    unfocused: [[[0, 22]], [[-20, 10], [20, 10]], [[-22, 10], [0, 22], [22, 10]], [[-30, 4], [-14, 18], [14, 18], [30, 4]]],
    focused: [[[0, -24]], [[-9, -22], [9, -22]], [[-12, -18], [0, -26], [12, -18]], [[-15, -14], [-5, -24], [5, -24], [15, -14]]],
  },
};

export class Player {
  constructor(G, id) {
    this.G = G;
    this.id = id;
    this.def = SHOTS[id];
    this.x = PF.w / 2;
    this.y = PF.h - 48;
    this.hitR = 2.3;
    this.state = 'alive';
    this.timer = 0;
    this.invuln = 120;
    this.focus = false;
    this.focusK = 0;
    this.lean = 0;
    this.shotT = 0;
    this.bombT = 0;
    this.bombLen = 1;
    this.bombObjs = [];
    this.ripples = [];
    this.opts = [];
    this.shots = [];
    this.beams = [];
    this.t = 0;
  }

  get alive() {
    return this.state === 'alive' || this.state === 'hit';
  }

  canBeHit() {
    return this.state === 'alive' && this.invuln <= 0 && this.bombT <= 0 && !this.G.godMode && !this.G.cheat('invincible');
  }

  get optionCount() {
    return clamp(Math.floor(this.G.power), 1, 4);
  }

  hit() {
    if (!this.canBeHit()) return;
    this.state = 'hit';
    this.timer = this.G.diff.deathBomb;
    this.G.sfx('playerDie');
    this.G.fx.burst(this.x, this.y, '#ffffff', 50, 12);
  }

  die() {
    const G = this.G;
    this.state = 'dead';
    this.timer = 50;
    G.fx.explode(this.x, this.y, G.cast.color, true);
    G.fx.shake(6, 24);
    G.fx.flash('#ffffff', 0.5);
    G.onPlayerDeath(this.x, this.y);
  }

  bomb() {
    const G = this.G;
    if (!G.cheat('bombs')) G.bombs--;
    G.onBomb();
    G.sfx('bomb');
    G.fx.flash(G.cast.color, 0.45);
    G.fx.shake(5, 30);
    if (this.id === 'akari') {
      this.bombLen = this.bombT = 190;
      this.invuln = 250;
      this.bombObjs = [];
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 - Math.PI / 2;
        this.bombObjs.push({ x: this.x, y: this.y, a, r: 0, t: 0, tx: null, vx: 0, vy: 0 });
      }
    } else {
      this.bombLen = this.bombT = 170;
      this.invuln = 230;
      this.ripples = [];
      this.moonX = this.x;
      this.moonY = this.y;
    }
  }

  update(input) {
    const G = this.G;
    this.t++;
    if (this.invuln > 0) this.invuln--;

    if (this.state === 'dead') {
      if (--this.timer <= 0) {
        if (G.lives < 0) return;
        this.state = 'respawn';
        this.x = PF.w / 2;
        this.y = PF.h + 30;
        this.invuln = 220;
      }
      this.updateShots();
      this.updateBomb();
      return;
    }
    if (this.state === 'respawn') {
      this.y -= 3;
      if (this.y <= PF.h - 48) this.state = 'alive';
      this.updateOptions();
      this.updateShots();
      this.updateBomb();
      return;
    }
    if (this.state === 'hit') {
      if (input.pressed('bomb') && G.hasBomb && !G.noShoot) {
        this.state = 'alive';
        this.bomb();
      } else if (--this.timer <= 0) {
        this.die();
        return;
      }
    }

    // movement
    this.focus = input.held('focus');
    this.focusK = clamp(this.focusK + (this.focus ? 0.15 : -0.15), 0, 1);
    const sp = this.focus ? this.def.focusSpeed : this.def.speed;
    let dx = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    let dy = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    if (dx && dy) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    let mx = dx * sp;
    let my = dy * sp;
    const td = input.takeTouchDelta();
    if (td.x || td.y) {
      const sens = G.app.save.settings.touchSensitivity || 1.2;
      const lim = sp * 3;
      mx += clamp(td.x * sens, -lim, lim);
      my += clamp(td.y * sens, -lim, lim);
    }
    if (this.state === 'alive') {
      this.x = clamp(this.x + mx, 8, PF.w - 8);
      this.y = clamp(this.y + my, 16, PF.h - 16);
    }
    this.lean = lerp(this.lean, clamp(mx / sp, -1, 1), 0.2);
    this.updateOptions();

    // fire
    const firing = (input.held('shoot') || input.touch.active) && !G.noShoot && this.state === 'alive';
    if (firing) this.fire();
    else this.beams.length = 0;
    if (input.pressed('bomb') && this.state === 'alive' && G.hasBomb && this.bombT <= 0 && !G.noShoot) this.bomb();

    this.updateShots();
    this.updateBomb();
  }

  updateOptions() {
    const n = this.optionCount;
    const u = this.def.unfocused[n - 1];
    const f = this.def.focused[n - 1];
    const k = this.focusK;
    while (this.opts.length < n) this.opts.push({ x: this.x, y: this.y });
    this.opts.length = n;
    for (let i = 0; i < n; i++) {
      const tx = this.x + lerp(u[i][0], f[i][0], k);
      const ty = this.y + lerp(u[i][1], f[i][1], k);
      const o = this.opts[i];
      o.x = lerp(o.x, tx, 0.35);
      o.y = lerp(o.y, ty, 0.35);
    }
  }

  fire() {
    const G = this.G;
    this.shotT++;
    const t = this.shotT;
    if (t % 6 === 1) G.sfx('shot');
    const push = (x, y, vx, vy, dmg, spr, o = {}) => this.shots.push({ x, y, vx, vy, dmg, spr, r: o.r || 6, homing: o.homing || 0, t: 0, dead: false });
    this.beams.length = 0;
    if (this.id === 'akari') {
      if (t % 4 === 1) {
        push(this.x - 6, this.y - 10, 0, -13, 1.8, 'flame');
        push(this.x + 6, this.y - 10, 0, -13, 1.8, 'flame');
      }
      if (this.focus) {
        if (t % 4 === 3) for (const o of this.opts) push(o.x, o.y - 6, 0, -12, 2, 'flame');
      } else if (t % 6 === 3) {
        this.opts.forEach((o, i) => {
          const a = -Math.PI / 2 + (i - (this.opts.length - 1) / 2) * 0.35;
          push(o.x, o.y, Math.cos(a) * 7, Math.sin(a) * 7, 1.5, 'ember', { homing: 0.2, r: 7 });
        });
      }
    } else {
      if (t % 3 === 1) {
        push(this.x - 5, this.y - 12, 0, -15, 1.4, 'needle', { r: 5 });
        push(this.x + 5, this.y - 12, 0, -15, 1.4, 'needle', { r: 5 });
      }
      if (this.focus) {
        for (const o of this.opts) this.beams.push(o);
        this.applyBeams();
      } else if (t % 5 === 2) {
        this.opts.forEach((o, i) => {
          const spreadI = i - (this.opts.length - 1) / 2;
          const a = -Math.PI / 2 + spreadI * 0.12 + (spreadI === 0 ? 0 : Math.sign(spreadI) * 0.04);
          push(o.x, o.y, Math.cos(a) * 12, Math.sin(a) * 12, 1.9, 'wave', { r: 8 });
          push(o.x, o.y, Math.cos(a - 0.1) * 12, Math.sin(a - 0.1) * 12, 1.4, 'needle', { r: 5 });
        });
      }
    }
  }

  applyBeams() {
    const G = this.G;
    const targets = G.targets();
    for (const o of this.beams) {
      for (const e of targets) {
        if (e.y < o.y && Math.abs(e.x - o.x) < e.r + 7) {
          e.damage(0.45);
          if (this.t % 6 === 0) G.fx.spark(o.x + (Math.random() - 0.5) * 8, e.y + e.r * 0.5, '#9ff0ff', 1, 1.5);
        }
      }
    }
  }

  updateShots() {
    const G = this.G;
    const targets = G.targets();
    for (const s of this.shots) {
      s.t++;
      if (s.homing && targets.length) {
        if (!s.target || s.target.dead || s.t % 8 === 0) {
          let best = null;
          let bd = Infinity;
          for (const e of targets) {
            const d = (e.x - s.x) ** 2 + (e.y - s.y) ** 2;
            if (d < bd) {
              bd = d;
              best = e;
            }
          }
          s.target = best;
        }
        if (s.target) {
          const sp = Math.hypot(s.vx, s.vy);
          const cur = Math.atan2(s.vy, s.vx);
          const want = Math.atan2(s.target.y - s.y, s.target.x - s.x);
          let d = want - cur;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          const na = cur + clamp(d, -s.homing, s.homing);
          s.vx = Math.cos(na) * sp;
          s.vy = Math.sin(na) * sp;
        }
      }
      s.x += s.vx;
      s.y += s.vy;
      if (s.y < -20 || s.y > PF.h + 20 || s.x < -20 || s.x > PF.w + 20) {
        s.dead = true;
        continue;
      }
      for (const e of targets) {
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const rr = e.r + s.r;
        if (dx * dx + dy * dy < rr * rr) {
          e.damage(s.dmg);
          s.dead = true;
          if (Math.random() < 0.3) G.fx.spark(s.x, s.y - 4, this.id === 'akari' ? '#ffa040' : '#9ff0ff', 1, 1.5);
          break;
        }
      }
    }
    if (this.shots.some((s) => s.dead)) this.shots = this.shots.filter((s) => !s.dead);
  }

  updateBomb() {
    const G = this.G;
    if (this.bombT <= 0) return;
    this.bombT--;
    const age = this.bombLen - this.bombT;
    const targets = G.targets();
    if (this.id === 'akari') {
      for (const o of this.bombObjs) {
        o.t++;
        if (o.t < 45) {
          o.r += 3.2;
          o.a += 0.09;
          o.x = this.x + Math.cos(o.a) * o.r;
          o.y = this.y + Math.sin(o.a) * o.r;
        } else {
          if (!o.tgt || o.tgt.dead) o.tgt = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
          const tx = o.tgt ? o.tgt.x : this.x + Math.cos(o.a) * 120;
          const ty = o.tgt ? o.tgt.y : Math.max(40, this.y - 220);
          o.vx = lerp(o.vx, (tx - o.x) * 0.08, 0.1);
          o.vy = lerp(o.vy, (ty - o.y) * 0.08, 0.1);
          o.x += o.vx;
          o.y += o.vy;
        }
        G.bullets.cancel({ x: o.x, y: o.y, radius: 42 });
        for (const e of targets) if ((e.x - o.x) ** 2 + (e.y - o.y) ** 2 < (e.r + 40) ** 2) e.damage(0.55, true);
        if (age % 4 === 0) G.fx.spark(o.x, o.y, '#ffb050', 1, 2);
      }
      if (this.bombT === 1) {
        for (const o of this.bombObjs) {
          G.fx.explode(o.x, o.y, '#ff9a30');
          G.bullets.cancel({ x: o.x, y: o.y, radius: 90 });
          for (const e of targets) if ((e.x - o.x) ** 2 + (e.y - o.y) ** 2 < (e.r + 80) ** 2) e.damage(20, true);
        }
        G.sfx('boom');
        G.fx.shake(6, 20);
        this.bombObjs = [];
      }
    } else {
      if (age % 22 === 1 && age < 130) this.ripples.push({ r: 0 });
      for (const r of this.ripples) {
        r.r += 5.5;
        G.bullets.cancel({ x: this.moonX, y: this.moonY, radius: r.r });
      }
      this.ripples = this.ripples.filter((r) => r.r < 560);
      for (const e of targets) e.damage(1.25, true);
      if (age % 3 === 0) G.fx.spark(Math.random() * PF.w, Math.random() * PF.h, '#bfefff', 1, 1);
    }
  }

  // ------------------------------------------------------------- drawing --
  render(ctx, art, px) {
    const G = this.G;
    // shots (translucent so enemy bullets stay readable)
    ctx.globalAlpha = 0.62;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.shots) {
      const spr = art.shot(s.spr);
      ctx.setTransform(px, 0, 0, px, (PF.x + s.x) * px, (PF.y + s.y) * px);
      if (s.spr !== 'ember' && (s.vx || s.homing)) ctx.rotate(Math.atan2(s.vy, s.vx) + Math.PI / 2);
      ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    }
    for (const o of this.beams) {
      ctx.setTransform(px, 0, 0, px, (PF.x + o.x) * px, PF.y * px);
      const w = 9 + Math.sin(this.t * 0.8) * 1.5;
      const gr = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      gr.addColorStop(0, 'rgba(60,150,255,0)');
      gr.addColorStop(0.3, 'rgba(110,210,255,0.7)');
      gr.addColorStop(0.5, 'rgba(240,255,255,0.95)');
      gr.addColorStop(0.7, 'rgba(110,210,255,0.7)');
      gr.addColorStop(1, 'rgba(60,150,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(-w / 2, 0, w, o.y - 6);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.renderBomb(ctx, art, px);
    if (this.state === 'dead') return;

    // options
    for (const o of this.opts) {
      ctx.setTransform(px, 0, 0, px, (PF.x + o.x) * px, (PF.y + o.y) * px);
      if (this.id === 'akari') {
        const spr = art.bullet('lantern', '#ff7a2a');
        ctx.rotate(Math.sin(this.t * 0.1 + o.x) * 0.15);
        ctx.drawImage(spr.img, -spr.w * 0.3, -spr.h * 0.3, spr.w * 0.6, spr.h * 0.6);
      } else {
        const g = art.glow('#9fe8ff', 24);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(g.img, -12, -12, 24, 24);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#b8823a';
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#eaf8ff';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-2.5, -2.5 + Math.sin(this.t * 0.07) * 1.5, 2, 2);
      }
    }

    // body
    const blink = this.invuln > 0 && this.state !== 'hit' && Math.floor(this.t / 3) % 2 === 0;
    const spr = G.charArt.chibi(this.id, 46);
    ctx.setTransform(px, 0, 0, px, (PF.x + this.x) * px, (PF.y + this.y) * px);
    ctx.transform(1, 0, -this.lean * 0.12, 1, 0, 0);
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2 + 2 + Math.sin(this.t * 0.08) * 1, spr.w, spr.h);
    ctx.globalAlpha = 1;
  }

  renderBomb(ctx, art, px) {
    if (this.bombT <= 0) return;
    const age = this.bombLen - this.bombT;
    if (this.id === 'akari') {
      for (const o of this.bombObjs) {
        ctx.setTransform(px, 0, 0, px, (PF.x + o.x) * px, (PF.y + o.y) * px);
        ctx.globalCompositeOperation = 'lighter';
        const g = art.glow('#ff8a30', 64);
        const s = 84 + Math.sin(o.t * 0.3) * 8;
        ctx.globalAlpha = 0.8;
        ctx.drawImage(g.img, -s / 2, -s / 2, s, s);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        const spr = art.bullet('lantern', '#ff4a2a');
        ctx.rotate(Math.sin(o.t * 0.15) * 0.2);
        ctx.drawImage(spr.img, -spr.w * 0.8, -spr.h * 0.8, spr.w * 1.6, spr.h * 1.6);
      }
    } else {
      const k = Math.min(1, age / 30) * Math.min(1, this.bombT / 30);
      ctx.setTransform(px, 0, 0, px, (PF.x + this.moonX) * px, (PF.y + this.moonY) * px);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 * k;
      ctx.fillStyle = '#7fc8ff';
      ctx.fillRect(-PF.w * 2, -PF.h * 2, PF.w * 4, PF.h * 4);
      ctx.globalAlpha = k;
      const g = art.glow('#dff6ff', 64);
      const s = 150 + age * 0.4;
      ctx.drawImage(g.img, -s / 2, -s / 2 - 40, s, s);
      ctx.fillStyle = rgba('#f4fbff', 0.9 * k);
      ctx.beginPath();
      ctx.arc(0, -40, 34, 0, TAU);
      ctx.fill();
      for (const r of this.ripples) {
        ctx.strokeStyle = rgba('#bfefff', Math.max(0, 1 - r.r / 560) * k);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(0, 0, r.r, r.r * 0.9, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  renderHitbox(ctx, px, always) {
    if (!this.alive && this.state !== 'respawn') return;
    if (!this.focusK && !always) return;
    const k = always ? 1 : this.focusK;
    ctx.setTransform(px, 0, 0, px, (PF.x + this.x) * px, (PF.y + this.y) * px);
    ctx.globalAlpha = k;
    ctx.rotate(this.t * 0.05);
    ctx.strokeStyle = rgba('#ffffff', 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * TAU) / 5;
      ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
      ctx.arc(Math.cos(a) * 8, Math.sin(a) * 8, 2.4, a, a + TAU);
    }
    ctx.stroke();
    ctx.setTransform(px, 0, 0, px, (PF.x + this.x) * px, (PF.y + this.y) * px);
    ctx.fillStyle = '#ff3050';
    ctx.beginPath();
    ctx.arc(0, 0, this.hitR + 1.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, this.hitR, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
