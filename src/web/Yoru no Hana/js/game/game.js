/**
 * One run: the heroine, everything on the playfield, the score and the
 * stage flow.
 *
 * Modes: 'story' plays stages 1-6 with dialogue and ends in an ending;
 * 'practice' plays one stage; 'card' replays one boss card with one life and
 * no bombs; 'talk' (the debug menu's story viewer) only plays a stage's boss
 * dialogue. The scene that owns the game (ui/scenes.js) listens to
 * `onEvent(name, data)` for game over, stage clears and the end of a run.
 *
 * Debug menu cheats (ui/cheats.js) are read through cheat(name); a run that
 * used one is `cheated` and keeps no score or card captures.
 *
 * Boss attacks are "cards": a nonspell has only hp and a timer; a named card
 * is declared with a cut-in and pays a bonus if it is cleared without
 * dying or bombing (a capture).
 */
import { TAU, clamp, fmtInt } from '../core/util.js';
import { PF } from '../core/view.js';
import { Rng } from '../core/rng.js';
import { Task, TaskList } from '../core/task.js';
import { BulletSystem, GRAZE_R } from './bullets.js';
import { LaserSystem } from './lasers.js';
import { ItemSystem, POC_Y } from './items.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { Enemy, Boss } from './enemies.js';
import { bind } from './danmaku.js';
import { Dialog } from './dialog.js';
import { CAST, DIFFICULTIES } from '../data/characters.js';
import { STAGES } from '../stages/index.js';
import { dialogue } from '../data/story.js';
import { makeBackground, CardBackground } from '../gfx/backgrounds.js';
import { drawFieldOverlay } from '../ui/hud.js';

const MAX_POWER = 4;
/** Boss hp in the stage files is multiplied by this (tuned so an attack lasts ~15 s at mid power). */
const BOSS_HP_SCALE = 2;

export class Game {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.mode = opts.mode;
    this.D = opts.diff;
    this.diff = DIFFICULTIES[opts.diff];
    this.charId = opts.char;
    this.cast = CAST[opts.char];
    this.rng = new Rng(opts.seed ?? (Date.now() >>> 0));
    this.art = app.art;
    this.charArt = app.charArt;
    this.bullets = new BulletSystem(this);
    this.lasers = new LaserSystem(this);
    this.items = new ItemSystem(this);
    this.fx = new FX(this);
    this.tasks = new TaskList();
    this.enemies = [];
    this.boss = null;
    this.player = new Player(this, opts.char);
    this.onEvent = () => {};

    const s = app.save.settings;
    const stage = opts.stage || 1;
    this.score = 0;
    this.hiScore = app.save.hiScore(this.charId, this.diff.id);
    this.lives = this.mode === 'card' ? 0 : this.startingLives();
    this.bombs = this.mode === 'card' ? 0 : this.diff.bombs;
    this.lifePieces = 0;
    this.bombPieces = 0;
    this.power = this.mode === 'story' ? 1 : this.mode === 'card' ? MAX_POWER : clamp(1 + (stage - 1) * 0.6, 1, MAX_POWER);
    this.grazeCount = 0;
    this.continues = 0;
    this.deaths = 0;
    this.bombsUsed = 0;
    this.frame = 0;
    this.stageNo = stage;
    this.noShoot = this.mode === 'talk';
    this.dialog = null;
    this.banners = [];
    this.cardInfo = null;
    this.cardTimer = 0;
    this.cardTimerMax = 1;
    this.capture = false;
    this.state = 'play';
    this.cardBg = null;
    this.cardBgK = 0;
    this.bossTitle = null;
    this.cutin = null;
    this.godMode = false;
    this.cheated = this.mode === 'talk' || !!opts.cheatStart;
    bind(this);
    this.startStage(stage);
  }

  sfx(name) {
    this.app.sfx.play(name);
  }

  /** A debug menu switch (save.data.cheats). */
  cheat(name) {
    return this.app.save.data.cheats[name];
  }

  get hasBomb() {
    return this.bombs > 0 || !!this.cheat('bombs');
  }

  /** Extra lives at the start of a run and after a continue (the setting counts the current life). */
  startingLives() {
    return clamp((this.app.save.settings.startLives | 0) - 1 + this.diff.extraLives, 0, 8);
  }

  music(id) {
    this.app.playMusic(id);
  }

  get pointValue() {
    return Math.floor((10000 + this.grazeCount * 10) / 10) * 10;
  }

  // ---------------------------------------------------------- stage flow --
  startStage(n) {
    this.stageNo = n;
    this.stage = STAGES[n - 1];
    this.bg = makeBackground(this.stage.bg, this);
    this.cardBg = null;
    this.cardBgK = 0;
    if (this.mode !== 'card') this.music(this.stage.music);
    this.stageTask = new Task(this.stageFlow());
    this.stageFrame = 0;
    if (this.mode === 'story') this.app.save.setReached(this.charId, this.diff.id, n);
  }

  *stageFlow() {
    if (this.mode === 'card') {
      yield* this.cardPractice();
      return;
    }
    if (this.mode === 'talk') {
      yield* this.talkFlow();
      return;
    }
    yield 40;
    this.banner({ kind: 'stage', life: 260 });
    yield* this.stage.script();
    yield* this.stageClear();
  }

  *stageClear() {
    yield 60;
    this.items.collectAll();
    const bonus = this.stageNo * 1000000 + Math.floor(this.power * 100) * 1000 + this.grazeCount * 500;
    this.score += bonus;
    this.banner({ kind: 'clear', bonus, life: 240 });
    yield 240;
    if (this.mode === 'story' && this.stageNo < STAGES.length) {
      this.startStage(this.stageNo + 1);
      return;
    }
    if (this.mode === 'story') {
      this.app.save.setReached(this.charId, this.diff.id, STAGES.length + 1);
      this.onEvent('ending', { good: this.continues === 0 });
    } else {
      this.onEvent('practiceDone', {});
    }
    this.state = 'done';
  }

  *cardPractice() {
    const c = this.opts.card;
    yield 30;
    const def = c.midboss ? this.stage.midboss : this.stage.boss;
    this.music(def.music || this.stage.music);
    const res = yield* this.bossFight(def, { only: c.index, practice: true });
    yield 60;
    this.state = 'done';
    this.onEvent('cardDone', { captured: res === 'captured' });
  }

  /** The story viewer: the boss arrives, both of her dialogues play, nothing is fought. */
  *talkFlow() {
    const def = this.stage.boss;
    yield 30;
    const b = new Boss(this, def);
    this.boss = b;
    b.x = def.fromX ?? PF.w / 2;
    b.y = -50;
    b.moveTo(PF.w / 2, def.y0 ?? 112, 70, 'out');
    yield 75;
    yield* this.talk('pre');
    this.noShoot = true;
    yield 40;
    this.sfx('bossDie');
    this.fx.explode(b.x, b.y, b.color, true);
    this.fx.flash('#ffffff', 0.6);
    b.visible = false;
    yield 90;
    this.boss = null;
    yield* this.talk('post');
    this.noShoot = true;
    yield 40;
    this.state = 'done';
    this.onEvent('talkDone', {});
  }

  *bossFight(def, o = {}) {
    const b = new Boss(this, def);
    this.boss = b;
    b.x = def.fromX ?? PF.w / 2;
    b.y = -50;
    b.moveTo(PF.w / 2, def.y0 ?? 112, 70, 'out');
    yield 75;
    const story = this.mode === 'story';
    if (o.dialog && story) yield* this.talk(o.dialog);
    if (!def.midboss) {
      if (!this.bossMusicOn) this.music(def.music);
      this.bossTitle = { char: def.char, t: 0 };
    }
    this.bossMusicOn = false;
    let last = null;
    for (let i = 0; i < def.cards.length; i++) {
      if (o.only !== undefined && i !== o.only) continue;
      last = yield* this.runCard(b, def.cards[i], i, def);
      if (last === 'timeout' && def.midboss) break;
    }
    this.cardBg = null;
    if (def.midboss && last === 'timeout') {
      b.fighting = false;
      b.moveTo(b.x, -90, 60, 'in');
      yield 60;
    } else {
      b.fighting = false;
      this.sfx(def.midboss ? 'bigKill' : 'bossDie');
      this.fx.explode(b.x, b.y, b.color, true);
      this.fx.flash('#ffffff', def.midboss ? 0.4 : 0.8);
      this.fx.shake(8, 40);
      this.items.drop(b.x, b.y, def.midboss ? { power: 6, point: 8, bomb: def.dropBomb ? 1 : 0 } : { power: 10, point: 16 });
      if (def.midboss && def.dropLife) this.items.spawn('life', b.x, b.y);
      b.visible = false;
      yield def.midboss ? 30 : 90;
    }
    this.boss = null;
    if (o.post && story) yield* this.talk(o.post);
    return o.practice ? (this._lastCapture ? 'captured' : last) : last;
  }

  *runCard(b, card, idx, def) {
    const id = card.id || def.id + ':' + idx;
    b.maxHp = b.hp = card.hp * BOSS_HP_SCALE * this.diff.bossHp;
    b.card = card;
    b.fighting = true;
    const T = Math.round(card.time * 60);
    this.cardTimer = T;
    this.cardTimerMax = T;
    b.invuln = card.name ? 80 : 40;
    this.capture = true;
    this._lastCapture = false;
    if (card.name) this.declareCard(b, card, id, def);
    const task = new Task(card.run(b), null);
    let result = null;
    for (;;) {
      if (this.state === 'play' && !this.dialog) {
        task.step();
        this.cardTimer--;
        const sec = Math.ceil(this.cardTimer / 60);
        if (this.cardTimer % 60 === 0 && sec <= 10 && sec > 0) this.sfx(sec <= 5 ? 'tickLow' : 'tick');
        if (!card.survival && b.hp <= 0) {
          result = 'kill';
          break;
        }
        if (this.cardTimer <= 0) {
          result = card.survival ? 'kill' : 'timeout';
          break;
        }
      }
      yield 1;
    }
    task.kill();
    this.tasks.killOwned(b);
    for (const e of this.enemies) if (e.familiar) e.kill(true);
    this.lasers.clear();
    this.bullets.cancel({ items: true, force: true });
    this.sfx('cancel');
    b.fighting = false;
    b.card = null;
    if (card.name) {
      const got = this.capture && result === 'kill';
      this._lastCapture = got;
      // a cheated run still marks the card as seen, but never as captured
      this.app.save.recordCard(id, this.charId, this.diff.id, got && !this.cheated);
      if (got) {
        const bonus = this.currentBonus();
        this.score += bonus;
        this.banner({ kind: 'bonus', text: 'Card Bonus', value: bonus, life: 150 });
        this.sfx('cardBonus');
        if (this.mode !== 'card') {
          this.items.spawn('bomb', b.x, b.y, { auto: true });
          if (idx === def.cards.length - 1 && !def.midboss) this.items.spawn('life', b.x, b.y, { auto: true });
        }
      } else {
        this.banner({ kind: 'bonus', text: 'Bonus Failed', life: 120 });
        this.sfx('cardFail');
      }
      this.cardInfo = null;
      this.cardBg = null;
    }
    if (result === 'kill' || !def.midboss) {
      const drop = card.name ? { power: 4, point: 10 } : { power: 6, point: 6 };
      for (const [kind, n] of Object.entries(drop)) {
        for (let i = 0; i < n; i++) this.items.spawn(kind, b.x + (this.rng.next() - 0.5) * 60, b.y + (this.rng.next() - 0.5) * 30, { auto: true });
      }
    }
    if (result === 'kill' && idx < def.cards.length - 1) this.fx.explode(b.x, b.y, b.color);
    if (idx < def.cards.length - 1 || !def.midboss) yield 45;
    return result;
  }

  declareCard(b, card, id, def) {
    const base = card.bonus ?? Math.round((1 + this.stageNo) * 1000000 * (1 + this.D * 0.4));
    this.cardInfo = { name: card.name, id, base, t: 0, hist: this.app.save.cardStat(id, this.charId, this.diff.id) };
    this.cardBg = new CardBackground(this, b.cast, def.cardStyle);
    this.cutin = { char: def.char, t: 0 };
    this.bullets.cancel({ items: false });
    this.sfx('cardDeclare');
  }

  currentBonus() {
    if (!this.cardInfo) return 0;
    const k = this.cardTimer / this.cardTimerMax;
    return Math.floor((this.cardInfo.base * (0.35 + 0.65 * k)) / 10) * 10;
  }

  *talk(key) {
    const lines = dialogue(this.charId, this.stageNo, key);
    if (!lines || !lines.length) return;
    this.noShoot = true;
    this.bullets.cancel({ items: true });
    this.dialog = new Dialog(this, lines);
    yield () => this.dialog.done;
    this.dialog = null;
    this.noShoot = false;
  }

  banner(b) {
    b.t = 0;
    this.banners.push(b);
  }

  // ---------------------------------------------------------------- events --
  spawnEnemy(kind, x, y, o = {}, script) {
    const e = new Enemy(this, kind, x, y, o);
    if (script) e.task = new Task(script(e), e);
    this.enemies.push(e);
    return e;
  }

  targets() {
    const out = [];
    for (const e of this.enemies) if (!e.dead && e.seen && e.invuln <= 0) out.push(e);
    if (this.boss && this.boss.targetable) out.push(this.boss);
    return out;
  }

  onEnemyDie(e) {
    this.score += e.score;
    this.items.drop(e.x, e.y, e.drops, e.r * 1.5);
    this.fx.explode(e.x, e.y, colorOf(e.color), e.r >= 20);
    this.sfx(e.r >= 20 ? 'bigKill' : 'kill');
    if (e.onDeath) e.onDeath(e);
  }

  graze(x, y) {
    this.grazeCount++;
    this.score += 200;
    this.fx.spark(x, y, '#ffffff', 2, 3);
    this.sfx('graze');
  }

  collect(it) {
    switch (it.kind) {
      case 'power':
      case 'bigPower':
      case 'full': {
        const before = this.power;
        if (before >= MAX_POWER) {
          this.score += 1000;
          this.sfx('item');
          break;
        }
        const add = it.kind === 'full' ? MAX_POWER : it.kind === 'bigPower' ? 1 : 0.02;
        this.power = Math.min(MAX_POWER, Math.round((this.power + add) * 100) / 100);
        if (Math.floor(this.power) > Math.floor(before)) this.sfx('power');
        if (this.power >= MAX_POWER) {
          this.sfx('powerMax');
          this.banner({ kind: 'note', text: 'Full Power', life: 90 });
          this.items.collectAll();
          this.bullets.cancel({ items: true });
        } else this.sfx('item');
        this.score += 10;
        break;
      }
      case 'point': {
        const pv = this.pointValue;
        const v = it.full ? pv : Math.floor((pv * clamp(1 - (it.y - POC_Y) / (PF.h * 1.1), 0.3, 1)) / 10) * 10;
        this.score += v;
        this.fx.text(it.x, it.y - 6, fmtInt(v), it.full ? '#ffe68a' : '#ffffff', 8, 30);
        this.sfx('item');
        break;
      }
      case 'cancel':
        this.score += 120;
        break;
      case 'life':
        this.lifePieces++;
        this.sfx('piece');
        if (this.lifePieces >= 3) {
          this.lifePieces = 0;
          if (this.lives < 8) this.lives++;
          this.sfx('extend');
          this.banner({ kind: 'note', text: 'Extend!', life: 100 });
        }
        break;
      case 'bomb':
        this.bombPieces++;
        this.sfx('piece');
        if (this.bombPieces >= 3) {
          this.bombPieces = 0;
          if (this.bombs < 8) this.bombs++;
          this.sfx('bombGet');
          this.banner({ kind: 'note', text: 'Bomb!', life: 80 });
        }
        break;
      default:
        break;
    }
  }

  onBomb() {
    this.capture = false;
    this.bombsUsed++;
  }

  onPlayerDeath(x, y) {
    this.capture = false;
    this.deaths++;
    this.bullets.cancel({ items: false });
    this.lasers.clear();
    const lost = Math.min(1, this.power - 1);
    this.power = Math.max(1, Math.round((this.power - 1) * 100) / 100);
    const n = Math.max(3, Math.round(lost * 12));
    for (let i = 0; i < n; i++) {
      this.items.spawn(i === 0 && lost >= 1 ? 'bigPower' : 'power', clamp(x + (this.rng.next() - 0.5) * 80, 10, PF.w - 10), y - 20, {
        vx: (this.rng.next() - 0.5) * 3,
        vy: -4 - this.rng.next() * 2,
      });
    }
    if (!this.cheat('lives')) this.lives--;
    if (this.lives < 0) {
      this.lives = -1;
      this.gameOverT = 50;
    } else {
      this.bombs = Math.max(this.bombs, this.diff.bombs);
    }
  }

  /** Called by the scene when the player picks Continue. */
  continueRun() {
    this.continues++;
    this.score = this.continues;
    this.lives = this.startingLives();
    this.bombs = this.diff.bombs;
    this.power = Math.max(this.power, 2);
    this.state = 'play';
    this.player.state = 'respawn';
    this.player.x = PF.w / 2;
    this.player.y = PF.h + 30;
    this.player.invuln = 240;
    this.bullets.cancel({ items: false, force: true });
  }

  // ---------------------------------------------------------------- update --
  update(input) {
    if (this.state !== 'play') return;
    const c = this.app.save.data.cheats;
    if (c.invincible || c.lives || c.bombs || c.power || c.speed < 1) this.cheated = true;
    if (c.power) this.power = MAX_POWER;
    this.frame++;
    this.stageFrame++;
    if (this.gameOverT) {
      if (--this.gameOverT <= 0) {
        this.gameOverT = 0;
        this.state = 'gameover';
        this.onEvent('gameover', {});
      }
    }
    if (this.dialog) this.dialog.update(input);
    if (!this.stageTask.done) this.stageTask.step();
    this.tasks.step();
    this.player.update(input);
    for (const e of this.enemies) e.update();
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.boss) this.boss.update();
    this.bullets.update();
    this.lasers.update();
    this.items.update();
    this.fx.update();
    this.bg.update();
    if (this.cardBg) {
      this.cardBg.update();
      this.cardBgK = Math.min(1, this.cardBgK + 0.03);
    } else this.cardBgK = Math.max(0, this.cardBgK - 0.03);
    if (this.cardInfo) this.cardInfo.t++;
    if (this.cutin) if (++this.cutin.t > 110) this.cutin = null;
    if (this.bossTitle) if (++this.bossTitle.t > 200) this.bossTitle = null;
    for (const b of this.banners) b.t++;
    if (this.banners.length) this.banners = this.banners.filter((b) => b.t < b.life);
    if (this.score > this.hiScore) this.hiScore = this.score;
  }

  // ---------------------------------------------------------------- render --
  render() {
    const v = this.app.view;
    const ctx = v.ctx;
    const px = v.px;
    const art = this.art;
    v.base();
    ctx.save();
    ctx.beginPath();
    ctx.rect(PF.x, PF.y, PF.w, PF.h);
    ctx.clip();
    const [sx, sy] = this.fx.offset;
    PF.x = 32 + sx;
    PF.y = 16 + sy;
    this.bg.render(ctx, px);
    if (this.cardBgK > 0 && this.cardBg) this.cardBg.render(ctx, px, this.cardBgK);
    else if (this.cardBgK > 0 && this.lastCardBg) this.lastCardBg.render(ctx, px, this.cardBgK);
    if (this.cardBg) this.lastCardBg = this.cardBg;
    this.fx.render(ctx, art, px, 'under');
    for (const e of this.enemies) e.render(ctx, art, px);
    if (this.boss) this.boss.render(ctx, art, px);
    this.items.render(ctx, art, px);
    this.player.render(ctx, art, px);
    this.lasers.render(ctx, art, px);
    this.bullets.render(ctx, art, px);
    this.fx.render(ctx, art, px, 'over');
    const debugBoxes = !!this.cheat('hitbox');
    if (debugBoxes) this.renderHitboxes(ctx, px);
    this.player.renderHitbox(ctx, px, debugBoxes || this.app.save.settings.hitbox === 'always');
    PF.x = 32;
    PF.y = 16;
    drawFieldOverlay(ctx, this, px);
    if (this.fx.flashA > 0) {
      v.base();
      ctx.globalAlpha = this.fx.flashA;
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(PF.x, PF.y, PF.w, PF.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // --------------------------------------------------- debug menu tools --
  /** The debug menu's hitbox view: what kills (magenta), what can be shot (yellow), grazes (cyan). */
  renderHitboxes(ctx, px) {
    ctx.setTransform(px, 0, 0, px, PF.x * px, PF.y * px);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,60,230,0.95)';
    ctx.beginPath();
    for (const b of this.bullets.list) {
      if (b.dead || b.hidden || b.harmless) continue;
      const r = b.r * b.scale;
      ctx.moveTo(b.x + r, b.y);
      ctx.arc(b.x, b.y, r, 0, TAU);
    }
    // touching an enemy or a fighting boss is as deadly as a bullet
    for (const e of this.enemies) {
      ctx.moveTo(e.x + e.r * 0.6, e.y);
      ctx.arc(e.x, e.y, e.r * 0.6, 0, TAU);
    }
    const b = this.boss;
    if (b && b.fighting && b.visible) {
      ctx.moveTo(b.x + 14, b.y);
      ctx.arc(b.x, b.y, 14, 0, TAU);
    }
    // filled as well: a bare outline vanishes inside a bullet's white core
    ctx.fillStyle = 'rgba(255,40,220,0.55)';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,90,0.8)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const e of this.targets()) {
      ctx.moveTo(e.x + e.r, e.y);
      ctx.arc(e.x, e.y, e.r, 0, TAU);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const l of this.lasers.list) {
      const k = LaserSystem.k(l);
      if (k < 0.6) continue;
      const c = Math.cos(l.a) * px;
      const s = Math.sin(l.a) * px;
      const hw = l.w * 0.32 * k;
      ctx.setTransform(c, s, -s, c, (PF.x + l.x) * px, (PF.y + l.y) * px);
      ctx.strokeStyle = 'rgba(255,60,230,0.95)';
      ctx.strokeRect(0, -hw, l.len, hw * 2);
    }
    const p = this.player;
    if (p.state !== 'dead') {
      ctx.setTransform(px, 0, 0, px, (PF.x + p.x) * px, (PF.y + p.y) * px);
      ctx.strokeStyle = 'rgba(120,240,255,0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, GRAZE_R, 0, TAU);
      ctx.stroke();
    }
  }

  /** Remove everything from the field, so a skip leaves nothing behind. */
  clearField() {
    this.tasks.clear();
    for (const e of this.enemies) {
      e.dead = true;
      e.silent = true;
    }
    this.enemies = [];
    this.boss = null;
    this.dialog = null;
    this.noShoot = false;
    this.cardInfo = null;
    this.cardBg = null;
    this.cutin = null;
    this.bossTitle = null;
    this.bossMusicOn = false;
    this.lasers.clear();
    this.bullets.cancel({ items: false, force: true });
  }

  /** Replace the stage script with `flow` (a generator) after clearing the field. */
  restartStageFlow(flow) {
    this.cheated = true;
    this.stageTask.kill();
    this.clearField();
    this.stageTask = new Task(flow);
  }

  skipToBoss() {
    if (this.mode === 'card' || this.mode === 'talk' || this.state !== 'play') return false;
    if (this.boss && !this.boss.def.midboss) return false;
    const g = this;
    this.restartStageFlow((function* () {
      yield 30;
      yield* g.bossFight(g.stage.boss, { dialog: 'pre', post: 'post' });
      yield* g.stageClear();
    })());
    return true;
  }

  skipStage() {
    if (this.mode === 'card' || this.mode === 'talk' || this.state !== 'play') return false;
    this.restartStageFlow(this.stageClear());
    return true;
  }

  /** End the running boss card as if it was beaten (or survived). */
  clearCard() {
    const b = this.boss;
    if (!b || !b.fighting || !b.card || this.state !== 'play') return false;
    this.cheated = true;
    if (b.card.survival) this.cardTimer = 1;
    else b.hp = 0;
    return true;
  }

  refill() {
    if (this.mode === 'talk' || this.state !== 'play') return false;
    this.cheated = true;
    this.lives = 8;
    this.bombs = 8;
    this.power = MAX_POWER;
    return true;
  }
}

function colorOf(c) {
  const map = { red: '#ff4a5a', orange: '#ff9a3a', yellow: '#ffd84a', green: '#5aff8a', cyan: '#5af0ff', blue: '#6a8aff', purple: '#b070ff', pink: '#ff70d0', white: '#ffffff', gray: '#a0a0b0' };
  return map[c] || c;
}
