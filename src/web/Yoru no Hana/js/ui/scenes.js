/**
 * Every screen other than the title: difficulty / heroine / stage / card
 * selection, the game itself (with pause, continue and result overlays),
 * story pages (prologue, endings, credits), name entry, scores, the music
 * room, character profiles, settings and the manual.
 */
import { W, H, PF } from '../core/view.js';
import { TAU, rgba, mix, fmtScore, fmtInt, clamp, FONT_SERIF } from '../core/util.js';
import { Menu, text, wrapSpans, wrapText, paragraph, panel } from './widgets.js';
import { drawFrame, drawHud } from './hud.js';
import { Game } from '../game/game.js';
import { CAST, PLAYERS, SHEET_ORDER, DIFFICULTIES } from '../data/characters.js';
import { SHOTS } from '../game/player.js';
import { STAGES } from '../stages/index.js';
import { PROLOGUE, PROLOGUE_CHAR, ENDINGS, CREDITS } from '../data/story.js';
import { SONGS } from '../audio/songs.js';
import { DEFAULT_SETTINGS } from '../core/save.js';
import { MANUAL } from '../data/manual.js';
import { t, typeRate, LANGS, langName, systemLang } from '../core/i18n.js';

/** Overlay titles and subtitles: English strings translated when drawn, or functions. */
const str = (v) => (typeof v === 'function' ? v() : t(v || ''));

// ------------------------------------------------------------------ select --
export class SelectScene {
  constructor(app, { mode = 'story' } = {}) {
    this.app = app;
    this.mode = mode;
    this.step = 'diff';
    this.t = 0;
    this.diff = app.lastDiff ?? 0; // first visit: the beginner difficulty
    this.char = app.lastChar ?? 0;
    this.diffMenu = new Menu(DIFFICULTIES.map((dd, i) => ({ label: dd.name, i })), { start: this.diff });
  }

  get diffId() {
    return DIFFICULTIES[this.diff].id;
  }

  enter() {}

  buildStageMenu() {
    const charId = PLAYERS[this.char];
    const reached = this.app.save.reached(charId, this.diffId);
    this.stageMenu = new Menu(STAGES.map((s, i) => ({ label: `${t('Stage {n}', { n: s.no })}  ${s.jp}`, sub: s.name, i, disabled: i + 1 > reached })), { start: 0 });
  }

  buildCardMenu() {
    const save = this.app.save;
    const charId = PLAYERS[this.char];
    const items = [];
    STAGES.forEach((s) => {
      for (const [def, midboss] of [[s.midboss, true], [s.boss, false]]) {
        if (!def) continue;
        def.cards.forEach((c, index) => {
          if (!c.name) return;
          const id = c.id || def.id + ':' + index;
          const seen = save.cardSeen(id);
          const st = save.cardStat(id, charId, this.diffId);
          items.push({ label: seen ? c.name : '？？？？？？？？', stage: s.no, midboss, index, disabled: !seen, stat: st, who: def.char });
        });
      }
    });
    this.cardMenu = new Menu(items, { start: 0 });
    this.cardScroll = 0;
  }

  start(extra = {}) {
    const app = this.app;
    app.lastDiff = this.diff;
    app.lastChar = this.char;
    const opts = { mode: this.mode, diff: this.diff, char: PLAYERS[this.char], stage: 1, ...extra };
    if (this.mode === 'story') {
      app.open('story', {
        pages: [...PROLOGUE, PROLOGUE_CHAR[opts.char]],
        heading: t('Prologue'),
        tint: CAST[opts.char].color,
        music: 'title',
        then: () => app.open('game', opts),
      });
    } else app.open('game', opts);
  }

  update() {
    const app = this.app;
    const inp = app.input;
    this.t++;
    app.backdrop.update();
    if (this.step === 'diff') {
      const r = this.diffMenu.update(app);
      this.diff = this.diffMenu.i;
      if (r === 'cancel') app.open('title');
      else if (r) {
        this.step = 'char';
        this.t = 0;
      }
    } else if (this.step === 'char') {
      if (inp.repeat('left') || inp.repeat('right') || inp.repeat('up') || inp.repeat('down')) {
        this.char = 1 - this.char;
        app.sfx.play('select');
      }
      if (inp.mouse.clicked) {
        const side = inp.mouse.x < W / 2 ? 0 : 1;
        if (side !== this.char) {
          this.char = side;
          app.sfx.play('select');
          inp.mouse.clicked = false;
        } else {
          inp.mouse.clicked = false;
          this.confirmChar();
          return;
        }
      }
      if (inp.pressed('confirm')) {
        app.sfx.play('ok');
        inp.consume();
        this.confirmChar();
      } else if (inp.pressed('cancel')) {
        app.sfx.play('back');
        inp.consume();
        this.step = 'diff';
      }
    } else if (this.step === 'stage') {
      const r = this.stageMenu.update(app);
      if (r === 'cancel') this.step = 'char';
      else if (r) this.start({ stage: r.i + 1 });
    } else if (this.step === 'card') {
      const r = this.cardMenu.update(app);
      if (r === 'cancel') this.step = 'char';
      else if (r) this.start({ stage: r.stage, card: { midboss: r.midboss, index: r.index } });
    }
  }

  confirmChar() {
    if (this.mode === 'practice') {
      this.buildStageMenu();
      this.step = 'stage';
    } else if (this.mode === 'card') {
      this.buildCardMenu();
      this.step = 'card';
    } else this.start();
  }

  render(ctx, px) {
    const app = this.app;
    app.backdrop.render(ctx, px, 0.55);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const heading = t({ story: 'Start', practice: 'Practice Start', card: 'Card Practice' }[this.mode]);
    text(ctx, heading, 24, 36, { size: 22, display: true, bold: true, color: '#e8dcff', glow: '#9070ff', maxWidth: W - 48 });
    const hint = (s) => text(ctx, t(s), 24, 58, { size: 12, serif: true, color: '#b8a8e0', maxWidth: W - 48 });
    if (this.step === 'diff') {
      hint('Choose the depth of the night');
      const cols = ['#7fe08a', '#7fc8ff', '#ffb04a', '#ff5a8a'];
      this.diffMenu.rects = [];
      const pw = 420;
      DIFFICULTIES.forEach((dd, i) => {
        const sel = i === this.diff;
        const y = 104 + i * 86;
        const x = W / 2 - pw / 2;
        this.diffMenu.rects[i] = { x, y, w: pw, h: 76 };
        ctx.globalAlpha = sel ? 1 : 0.72;
        panel(ctx, x, y, pw, 76, cols[i], sel ? 0.9 : 0.8);
        // the kanji column is 100 px wide: 真夜中 shrinks to fit it
        text(ctx, dd.jp, x + 52, y + 49, { size: 30, serif: true, bold: true, align: 'center', color: cols[i], glow: sel ? cols[i] : null, maxWidth: 88 });
        text(ctx, dd.name, x + 108, y + 31, { size: 20, display: true, bold: true, color: '#ffffff', maxWidth: pw - 122 });
        paragraph(ctx, dd.desc, x + 108, y + 51, pw - 122, { size: 12, serif: true, color: '#c8bce8', maxLines: 2, lineHeight: 15 });
        ctx.globalAlpha = 1;
      });
    } else if (this.step === 'char') {
      hint('Choose your heroine');
      PLAYERS.forEach((id, i) => {
        const c = CAST[id];
        const sel = i === this.char;
        const cx = i === 0 ? 170 : 470;
        const spr = app.charArt.portrait(id, 250);
        ctx.setTransform(px, 0, 0, px, cx * px, 192 * px);
        ctx.globalAlpha = sel ? 1 : 0.4;
        const s = sel ? 1 + Math.sin(this.t * 0.05) * 0.01 : 0.92;
        ctx.drawImage(spr.img, (-spr.w / 2) * s, (-spr.h / 2) * s, spr.w * s, spr.h * s);
        ctx.setTransform(px, 0, 0, px, 0, 0);
        const sh = SHOTS[id];
        const py = 326;
        panel(ctx, cx - 150, py, 300, 120, c.color, sel ? 0.88 : 0.5);
        text(ctx, c.sub, cx + 136, py + 24, { size: 13, serif: true, align: 'right', color: rgba(c.color, 1), maxWidth: 84 });
        text(ctx, c.name, cx - 136, py + 24, { size: 17, display: true, bold: true, color: sel ? '#ffffff' : '#a090c0', maxWidth: 182 });
        text(ctx, c.title, cx - 136, py + 42, { size: 11.5, serif: true, color: '#d8c8f0', maxWidth: 272 });
        text(ctx, t('Shot: {name}', { name: sh.shotName }), cx - 136, py + 62, { size: 11.5, serif: true, bold: true, color: '#ffffff', maxWidth: 272 });
        paragraph(ctx, sh.shotDesc, cx - 136, py + 77, 272, { size: 11, serif: true, color: '#c0b4e0', maxLines: 2, lineHeight: 13 });
        text(ctx, t('Bomb: 「{name}」', { name: sh.bombName }), cx - 136, py + 110, { size: 11.5, serif: true, bold: true, color: '#ffe0a0', maxWidth: 272 });
        ctx.globalAlpha = 1;
      });
    } else if (this.step === 'stage') {
      hint('Choose a stage (reach a stage in Start to unlock it here)');
      this.stageMenu.render(ctx, 120, 120, { gap: 40, size: 18, width: 380 });
      this.stageMenu.items.forEach((it, i) => {
        text(ctx, it.disabled ? '' : it.sub, 120, 120 + i * 40 + 15, { size: 11.5, serif: true, color: '#a898d0', maxWidth: 380 });
      });
    } else if (this.step === 'card') {
      hint('Cards you have seen in any run can be practised here (one life, no bombs)');
      const m = this.cardMenu;
      const rows = 13;
      if (m.i < this.cardScroll) this.cardScroll = m.i;
      if (m.i >= this.cardScroll + rows) this.cardScroll = m.i - rows + 1;
      const view = { ...m, items: m.items.slice(this.cardScroll, this.cardScroll + rows), i: m.i - this.cardScroll, t: m.t };
      Menu.prototype.render.call(view, ctx, 74, 96, { gap: 27, size: 13, width: 460 });
      m.rects = [];
      view.rects.forEach((r, k) => (m.rects[k + this.cardScroll] = r));
      view.items.forEach((it, k) => {
        const y = 96 + k * 27;
        text(ctx, t('St.{n}', { n: it.stage }), 22, y, { size: 11, color: '#8a7ab0', maxWidth: 46 });
        text(ctx, `${it.stat[0]}/${it.stat[1]}`, W - 18, y, { size: 11, align: 'right', color: '#c0b0e0', maxWidth: 40 });
      });
      if (!m.items.some((it) => !it.disabled)) text(ctx, t('No cards seen yet. Play Start or Practice first!'), W / 2, 250, { size: 14, serif: true, align: 'center', color: '#ffd0a0', maxWidth: W - 60 });
    }
    text(ctx, t('Z / Enter: choose    X / Esc: back'), W - 16, H - 14, { size: 11, align: 'right', color: '#7a6aa0', maxWidth: W - 32 });
  }
}

// -------------------------------------------------------------------- game --
export class GameScene {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.game = new Game(app, opts);
    this.game.onEvent = (n, d) => this.onEvent(n, d);
    this.overlay = null;
    this.settings = null;
    window.yoru = this.game;
  }

  enter() {
    this.app.setWindowTitle(`Yoru no Hana - ${CAST[this.opts.char].name}`);
  }

  exit() {
    this.app.music.duck(false);
    this.app.setWindowTitle('Yoru no Hana');
    if (window.yoru === this.game) window.yoru = null;
  }

  pause() {
    if (this.overlay) return;
    const app = this.app;
    app.sfx.play('pause');
    app.music.duck(true);
    this.overlay = {
      kind: 'pause',
      title: 'Paused',
      menu: new Menu([
        { label: () => t('Resume'), action: () => this.resume() },
        { label: () => t(this.opts.mode === 'story' ? 'Restart from Stage 1' : 'Retry'), action: () => app.open('game', this.opts, { fade: 20 }) },
        { label: () => t('Settings'), action: () => (this.settings = new SettingsPanel(app, () => (this.settings = null))) },
        { label: () => t('Quit to Title'), action: () => this.quit() },
      ]),
    };
  }

  resume() {
    this.overlay = null;
    this.app.music.duck(false);
    this.app.input.consume();
  }

  quit() {
    const g = this.game;
    this.app.music.duck(false);
    if (this.opts.mode === 'story' && g.score > 0) this.app.offerScore(g, () => this.app.open('title'));
    else this.app.open('title');
  }

  onEvent(name, data) {
    const app = this.app;
    const g = this.game;
    if (name === 'gameover') {
      app.music.duck(true);
      const items = [];
      if (this.opts.mode === 'story') items.push({ label: () => t('Continue  ({n} used)', { n: g.continues }), action: () => { g.continueRun(); this.resume(); } });
      else items.push({ label: () => t('Retry'), action: () => app.open('game', this.opts, { fade: 20 }) });
      items.push({ label: () => t('Quit to Title'), action: () => this.quit() });
      this.overlay = { kind: 'gameover', title: 'Game Over', sub: this.opts.mode === 'story' ? 'Continuing resets your score and leads to a different ending.' : '', menu: new Menu(items), noCancel: true };
    } else if (name === 'ending') {
      app.save.markEnding(g.charId, data.good ? 'good' : 'bad');
      const afterScore = () => app.open('title');
      const afterStory = () => {
        if (data.good) app.open('credits', { then: () => app.offerScore(g, afterScore, 7) });
        else app.offerScore(g, afterScore, 7);
      };
      openEnding(app, g.charId, data.good, afterStory);
    } else if (name === 'practiceDone' || name === 'cardDone') {
      const ok = name === 'practiceDone' || data.captured;
      this.overlay = {
        kind: 'result',
        title: name === 'practiceDone' ? 'Practice Clear' : data.captured ? 'Card Captured!' : 'Card Failed',
        sub: name === 'practiceDone' ? () => t('Score {n}', { n: fmtInt(g.score) }) : '',
        good: ok,
        menu: new Menu([
          { label: () => t('Retry'), action: () => app.open('game', this.opts, { fade: 20 }) },
          { label: () => t(name === 'cardDone' ? 'Choose Another Card' : 'Quit to Title'), action: () => (name === 'cardDone' ? app.open('select', { mode: 'card' }) : app.open('title')) },
        ]),
        noCancel: true,
      };
    } else if (name === 'talkDone') {
      // the debug menu's story viewer: go on to the next stage's dialogue, or to the ending
      const o = this.opts;
      const items = [{ label: () => t('Watch Again'), action: () => app.open('game', o, { fade: 20 }) }];
      if (o.stage < STAGES.length) items.push({ label: () => t('Next Stage'), action: () => app.open('game', { ...o, stage: o.stage + 1 }, { fade: 20 }) });
      else items.push({ label: () => t('Read the Ending'), action: () => openEnding(app, o.char, true, () => app.open('title')) });
      items.push({ label: () => t('Quit to Title'), action: () => app.open('title') });
      this.overlay = { kind: 'result', title: 'Dialogue Finished', sub: () => `${CAST[o.char].name}  ·  ${t('Stage {n}', { n: o.stage })}`, menu: new Menu(items), noCancel: true };
    }
  }

  update() {
    const app = this.app;
    const inp = app.input;
    if (this.settings) {
      this.settings.update();
      return;
    }
    if (this.overlay) {
      const r = this.overlay.menu.update(app);
      if (r === 'cancel') {
        if (!this.overlay.noCancel) this.resume();
      } else if (r && r.action) r.action();
      return;
    }
    if (inp.pressed('pause') || app.autoPause) {
      app.autoPause = false;
      this.pause();
      inp.consume();
      return;
    }
    this.stepGame(inp);
  }

  /** One frame of play at the debug menu's game speed. */
  stepGame(inp) {
    const speed = this.app.save.data.cheats.speed || 1;
    if (speed < 1) {
      // slow motion: skip frames, but never drop a press
      this.slow = (this.slow || 0) + speed;
      const press = inp.pressed('shoot') || inp.pressed('bomb') || inp.pressed('confirm') || inp.mouse.clicked;
      if (this.slow < 1 && !press) return;
      this.slow = Math.max(0, this.slow - 1);
      this.game.update(inp);
      return;
    }
    for (let i = 0; i < speed; i++) {
      if (i) inp.consume(); // a press counts once, not once per step
      this.game.update(inp);
      if (this.overlay || this.game.state !== 'play') break;
    }
  }

  render(ctx, px) {
    const app = this.app;
    drawFrame(ctx, px, app.titleArt);
    this.game.render();
    drawHud(ctx, this.game, px, app.input, app.loop.fps);
    if (this.overlay) {
      ctx.setTransform(px, 0, 0, px, 0, 0);
      ctx.fillStyle = 'rgba(6,3,20,0.82)';
      ctx.fillRect(PF.x, PF.y, PF.w, PF.h);
      const o = this.overlay;
      const cx = PF.x + PF.w / 2;
      text(ctx, str(o.title), cx, 160, { size: 28, display: true, bold: true, align: 'center', color: o.kind === 'gameover' ? '#ff9ab0' : '#ffffff', glow: o.good ? '#ffd080' : '#9070ff', maxWidth: PF.w - 30 });
      if (o.sub) paragraph(ctx, str(o.sub), cx, 186, 300, { size: 12, serif: true, align: 'center', color: '#d0c4f0', maxLines: 3, lineHeight: 15 });
      o.menu.render(ctx, cx, 240, { gap: 30, size: 16, width: 280, align: 'center' });
    }
    if (this.settings) this.settings.render(ctx, px);
  }
}

// ------------------------------------------------------------------- story --
export class StoryScene {
  constructor(app, o) {
    this.app = app;
    this.o = o;
    this.i = 0;
    this.t = 0;
    this.fin = false;
  }

  enter() {
    if (this.o.music) this.app.playMusic(this.o.music);
  }

  update() {
    const app = this.app;
    const inp = app.input;
    this.t++;
    app.backdrop.update();
    const page = this.o.pages[this.i];
    const full = this.t * typeRate(1.2) >= (page ? page.length : 0);
    const adv = inp.pressed('confirm') || inp.pressed('shoot') || inp.mouse.clicked;
    if (inp.held('skip') && this.t % 6 === 0) this.next();
    else if (adv) {
      if (!full) this.t = 99999;
      else this.next();
      inp.consume();
    } else if (inp.pressed('cancel') && this.o.skippable !== false && !this.o.footer) {
      inp.consume();
      this.finish();
    }
  }

  next() {
    if (this.i < this.o.pages.length - 1) {
      this.i++;
      this.t = 0;
      this.app.sfx.play('talk');
    } else if (this.o.footer && !this.fin) {
      this.fin = true;
      this.t = 0;
      this.i = this.o.pages.length;
    } else this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.o.then();
  }

  render(ctx, px) {
    const app = this.app;
    // an ending's own painting (assets/ending<n>.png) is dimmed less than the title painting
    app.backdrop.render(ctx, px, this.o.art ? 0.6 : 0.72, this.o.art);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const tint = this.o.tint || '#a080ff';
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 420);
    g.addColorStop(0, rgba(tint, 0.12));
    g.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (this.o.heading) text(ctx, this.o.heading, W / 2, 70, { size: 20, display: true, bold: true, align: 'center', color: mix(tint, '#ffffff', 0.5), glow: tint, maxWidth: W - 60 });
    if (this.fin) {
      const a = Math.min(1, this.t / 40);
      ctx.globalAlpha = a;
      text(ctx, this.o.footer, W / 2, H / 2, { size: 24, display: true, bold: true, align: 'center', glow: tint, maxWidth: W - 60 });
      if (this.o.hint) text(ctx, this.o.hint, W / 2, H / 2 + 40, { size: 13, serif: true, align: 'center', color: '#ffd8a8', maxWidth: W - 60 });
      ctx.globalAlpha = 1;
    } else {
      const page = this.o.pages[this.i];
      const shown = Math.floor(this.t * typeRate(1.2));
      ctx.font = `17px ${FONT_SERIF}`;
      const spans = wrapSpans(ctx, page, 480);
      const y0 = H / 2 - (spans.length * 30) / 2 + 10;
      spans.forEach(([a, e], k) => {
        if (shown > a) text(ctx, page.slice(a, Math.min(e, shown)), W / 2 - 240, y0 + k * 30, { size: 17, serif: true, color: '#f4eeff' });
      });
      text(ctx, `${this.i + 1} / ${this.o.pages.length}`, W / 2, H - 50, { size: 11, align: 'center', color: '#8a7ab0' });
    }
    text(ctx, t('Z: next    Ctrl: skip'), W - 16, H - 14, { size: 11, align: 'right', color: '#6a5a90', maxWidth: W - 32 });
  }
}

export class CreditsScene {
  constructor(app, o) {
    this.app = app;
    this.o = o;
    this.t = 0;
  }

  enter() {
    this.app.playMusic('ending');
  }

  update() {
    const app = this.app;
    this.t++;
    app.backdrop.update();
    const inp = app.input;
    const end = CREDITS.length * 70 + 500;
    if (this.t > end || ((inp.pressed('confirm') || inp.mouse.clicked) && this.t > 120)) {
      inp.consume();
      if (!this.done) {
        this.done = true;
        this.o.then();
      }
    }
  }

  render(ctx, px) {
    // assets/roll.png (a dawn painting, calm on the right) needs less dimming than the title painting
    const art = this.app.titleArt.credits;
    this.app.backdrop.render(ctx, px, art ? 0.18 : 0.3, art);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    CREDITS.forEach(([a, b], i) => {
      const y = H + 40 + i * 70 - this.t * 0.6;
      if (y < -40 || y > H + 60) return;
      const fade = clamp(Math.min(y - 30, H - 30 - y) / 60, 0, 1);
      ctx.globalAlpha = fade;
      text(ctx, a, W - 170, y, { size: i === 0 ? 30 : 16, display: true, bold: true, align: 'center', glow: '#b090ff', maxWidth: 310 });
      if (b) text(ctx, b, W - 170, y + 22, { size: 12.5, serif: true, align: 'center', color: '#e0d0ff', maxWidth: 310 });
      ctx.globalAlpha = 1;
    });
  }
}

// -------------------------------------------------------------- name entry --
const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-_!? '.split('');

export class NameEntryScene {
  constructor(app, o) {
    this.app = app;
    this.o = o;
    this.name = (app.save.data.name || '').slice(0, 8);
    this.sel = 0;
    this.t = 0;
    this.cols = 13;
  }

  enter() {
    this.app.input.textMode = true;
  }

  exit() {
    this.app.input.textMode = false;
  }

  commit() {
    const app = this.app;
    const name = this.name.trim() || 'Nameless';
    app.save.data.name = name;
    app.save.addScore(this.o.char, this.o.diff, {
      name, score: this.o.score, stage: this.o.stage, cont: this.o.cont, date: new Date().toISOString().slice(0, 10),
    });
    app.sfx.play('cardBonus');
    this.o.then();
  }

  update() {
    const app = this.app;
    const inp = app.input;
    this.t++;
    app.backdrop.update();
    for (const ch of inp.typed) {
      if (ch === '\b') this.name = this.name.slice(0, -1);
      else if (this.name.length < 8 && NAME_CHARS.includes(ch)) this.name += ch;
    }
    const n = NAME_CHARS.length + 2;
    const c = this.cols;
    if (inp.repeat('left')) this.sel = (this.sel - 1 + n) % n;
    if (inp.repeat('right')) this.sel = (this.sel + 1) % n;
    if (inp.repeat('up')) this.sel = (this.sel - c + n) % n;
    if (inp.repeat('down')) this.sel = (this.sel + c) % n;
    if (inp.keys.has('Enter') && this.t > 10) {
      inp.keys.delete('Enter');
      this.commit();
      return;
    }
    // the keyboard types directly; the grid is for gamepads, mice and touch
    let pick = inp.pressed('shoot') && inp.lastDevice === 'gamepad';
    if (inp.mouse.clicked && this.rects) {
      for (let k = 0; k < this.rects.length; k++) {
        const r = this.rects[k];
        if (inp.mouse.x >= r.x && inp.mouse.x <= r.x + r.w && inp.mouse.y >= r.y && inp.mouse.y <= r.y + r.h) {
          this.sel = k;
          pick = true;
        }
      }
    }
    if (pick) {
      if (this.sel < NAME_CHARS.length) {
        if (this.name.length < 8) this.name += NAME_CHARS[this.sel];
        app.sfx.play('select');
      } else if (this.sel === NAME_CHARS.length) {
        this.name = this.name.slice(0, -1);
        app.sfx.play('back');
      } else this.commit();
    }
    if (inp.pressed('bomb') && inp.lastDevice === 'gamepad') this.name = this.name.slice(0, -1);
  }

  render(ctx, px) {
    this.app.backdrop.render(ctx, px, 0.7);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const o = this.o;
    text(ctx, t('New High Score'), W / 2, 70, { size: 26, display: true, bold: true, align: 'center', glow: '#ffd080', maxWidth: W - 60 });
    text(ctx, `${CAST[o.char].name}  ·  ${DIFFICULTIES.find((dd) => dd.id === o.diff).name}  ·  ${t('rank {n}', { n: o.rank + 1 })}`, W / 2, 98, { size: 13, serif: true, align: 'center', color: '#d8c8f0', maxWidth: W - 60 });
    text(ctx, fmtScore(o.score), W / 2, 134, { size: 24, display: true, bold: true, align: 'center', color: '#ffe68a' });
    panel(ctx, W / 2 - 120, 152, 240, 40, '#ffd080');
    const cursor = Math.floor(this.t / 20) % 2 ? '_' : ' ';
    text(ctx, this.name + (this.name.length < 8 ? cursor : ''), W / 2, 180, { size: 22, bold: true, align: 'center' });
    this.rects = [];
    const c = this.cols;
    const all = [...NAME_CHARS, t('Del'), t('End')];
    all.forEach((ch, k) => {
      const col = k % c;
      const row = Math.floor(k / c);
      const x = W / 2 - (c * 30) / 2 + col * 30 + 15;
      const y = 236 + row * 30;
      const wide = ch.length > 1;
      this.rects[k] = { x: x - 14, y: y - 20, w: wide ? 50 : 28, h: 28 };
      const sel = k === this.sel;
      if (sel) {
        ctx.fillStyle = 'rgba(255,220,140,0.3)';
        ctx.fillRect(x - 14, y - 20, wide ? 50 : 28, 28);
      }
      text(ctx, ch === ' ' ? '␣' : ch, wide ? x + 10 : x, y, { size: 15, align: 'center', bold: sel, color: sel ? '#ffffff' : '#b8a8e0' });
    });
    text(ctx, t('Type a name, or pick letters with the arrows and Z. Enter to finish.'), W / 2, H - 20, { size: 11, align: 'center', color: '#8a7ab0', maxWidth: W - 32 });
  }
}

// ------------------------------------------------------------------ scores --
export class ScoresScene {
  constructor(app) {
    this.app = app;
    this.page = 0;
    this.t = 0;
  }

  update() {
    const app = this.app;
    const inp = app.input;
    this.t++;
    app.backdrop.update();
    const n = PLAYERS.length * DIFFICULTIES.length;
    if (inp.repeat('right') || inp.repeat('down')) {
      this.page = (this.page + 1) % n;
      app.sfx.play('select');
    }
    if (inp.repeat('left') || inp.repeat('up')) {
      this.page = (this.page - 1 + n) % n;
      app.sfx.play('select');
    }
    if (inp.mouse.clicked) {
      this.page = (this.page + (inp.mouse.x > W / 2 ? 1 : n - 1)) % n;
      app.sfx.play('select');
    }
    if (inp.pressed('cancel') || inp.pressed('confirm')) {
      app.sfx.play('back');
      inp.consume();
      app.open('title', { start: 3 });
    }
  }

  render(ctx, px) {
    const app = this.app;
    app.backdrop.render(ctx, px, 0.7);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const charId = PLAYERS[Math.floor(this.page / DIFFICULTIES.length)];
    const dd = DIFFICULTIES[this.page % DIFFICULTIES.length];
    const c = CAST[charId];
    text(ctx, t('Scores'), 24, 36, { size: 22, display: true, bold: true, color: '#e8dcff', glow: '#9070ff' });
    text(ctx, `‹  ${c.name}  ·  ${dd.name} ${dd.jp}  ›`, W / 2, 72, { size: 16, display: true, bold: true, align: 'center', color: mix(c.color, '#ffffff', 0.4), maxWidth: W - 80 });
    const list = app.save.scores(charId, dd.id);
    for (let i = 0; i < 10; i++) {
      const e = list[i];
      const y = 112 + i * 32;
      text(ctx, String(i + 1).padStart(2, ' '), 90, y, { size: 15, bold: true, align: 'right', color: '#a898d0' });
      text(ctx, e ? e.name : '--------', 110, y, { size: 15, color: e ? '#ffffff' : '#5a4a7a', maxWidth: 130 });
      text(ctx, e ? fmtScore(e.score) : fmtScore(0), 400, y, { size: 15, display: true, bold: true, align: 'right', color: e ? '#ffe68a' : '#5a4a7a', maxWidth: 150 });
      if (e) {
        text(ctx, e.stage > STAGES.length ? t('All Clear') : t('Stage {n}', { n: e.stage }), 418, y, { size: 12, display: true, color: '#c8b8f0', maxWidth: 100 });
        text(ctx, (e.cont ? `${e.cont}C  ` : '') + (e.date || ''), 528, y, { size: 11, color: '#8a7ab0', maxWidth: 96 });
      }
    }
    text(ctx, t('← → change page    X: back'), W - 16, H - 14, { size: 11, align: 'right', color: '#7a6aa0', maxWidth: W - 32 });
  }
}

// -------------------------------------------------------------- music room --
export class MusicRoomScene {
  constructor(app) {
    this.app = app;
    this.t = 0;
    const heard = app.save.data.music;
    this.menu = new Menu(SONGS.map((s, i) => ({ label: `${String(i + 1).padStart(2, '0')}. ${heard[s.id] ? s.title : '？？？？？'}`, song: s, disabled: !heard[s.id] })));
    this.playing = app.music.current ? app.music.current.id : null;
  }

  update() {
    const app = this.app;
    this.t++;
    app.backdrop.update();
    const r = this.menu.update(app);
    if (r === 'cancel') {
      app.open('title', { start: 4 });
    } else if (r) {
      app.playMusic(r.song.id, true);
      this.playing = r.song.id;
    }
  }

  render(ctx, px) {
    const app = this.app;
    app.backdrop.render(ctx, px, 0.7);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    text(ctx, t('Music Room'), 24, 36, { size: 22, display: true, bold: true, color: '#e8dcff', glow: '#9070ff' });
    this.menu.render(ctx, 50, 76, { gap: 21, size: 13, width: 310 });
    this.menu.items.forEach((it, i) => {
      if (it.song.id === this.playing) text(ctx, '♪', 30, 76 + i * 21, { size: 13, color: '#ffd080' });
    });
    const s = this.menu.items[this.menu.i].song;
    panel(ctx, 390, 76, 230, 300, '#b090ff');
    if (app.save.data.music[s.id]) {
      paragraph(ctx, s.title, 404, 102, 204, { size: 14, display: true, bold: true, color: '#ffffff', maxLines: 2, lineHeight: 17 });
      text(ctx, `${s.bpm} BPM`, 404, 138, { size: 10, color: '#a898d0' });
      paragraph(ctx, s.comment, 404, 160, 204, { size: 12.5, serif: true, color: '#e0d6ff', maxLines: 11, lineHeight: 18 });
    } else {
      text(ctx, t('Not heard yet.'), 404, 102, { size: 13, serif: true, color: '#8a7ab0' });
    }
    text(ctx, t('Z: play    X: back'), W - 16, H - 14, { size: 11, align: 'right', color: '#7a6aa0', maxWidth: W - 32 });
  }
}

// ----------------------------------------------------------------- gallery --
export class GalleryScene {
  constructor(app) {
    this.app = app;
    this.i = 0;
    this.t = 0;
  }

  update() {
    const app = this.app;
    const inp = app.input;
    this.t++;
    app.backdrop.update();
    const n = SHEET_ORDER.length;
    if (inp.repeat('right') || inp.repeat('down')) {
      this.i = (this.i + 1) % n;
      this.t = 0;
      app.sfx.play('select');
    }
    if (inp.repeat('left') || inp.repeat('up')) {
      this.i = (this.i - 1 + n) % n;
      this.t = 0;
      app.sfx.play('select');
    }
    if (inp.mouse.clicked) {
      this.i = (this.i + (inp.mouse.x > W / 2 ? 1 : n - 1)) % n;
      this.t = 0;
      app.sfx.play('select');
    }
    if (inp.pressed('cancel') || inp.pressed('confirm')) {
      app.sfx.play('back');
      inp.consume();
      app.open('title', { start: 5 });
    }
  }

  render(ctx, px) {
    const app = this.app;
    app.backdrop.render(ctx, px, 0.65);
    const id = SHEET_ORDER[this.i];
    const c = CAST[id];
    const a = Math.min(1, this.t / 15);
    // sheet portraits are square, drawn cards are tall: keep either clear of the text
    let spr = app.charArt.portrait(id, 360);
    if (spr.w > 300) spr = app.charArt.portrait(id, Math.round((360 * 300) / spr.w));
    ctx.setTransform(px, 0, 0, px, (170 - (1 - a) * 20) * px, 250 * px);
    // portraits mirrored to face the heroine in dialogue face the text here
    if (app.charArt.flipped.has('portrait:' + id)) ctx.scale(-1, 1);
    ctx.globalAlpha = a;
    ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    text(ctx, t('Characters'), 24, 36, { size: 22, display: true, bold: true, color: '#e8dcff', glow: '#9070ff' });
    const x = 330;
    const tw = W - x - 18;
    text(ctx, c.title, x, 92, { size: 12.5, serif: true, color: rgba(c.accent, 1), maxWidth: tw });
    text(ctx, c.name, x, 122, { size: 26, display: true, bold: true, glow: c.color, maxWidth: tw });
    text(ctx, c.sub, x, 146, { size: 15, serif: true, color: rgba(c.color, 1), maxWidth: tw });
    // the profile shrinks a little if it would run into the footer
    let size = 12.5;
    const fits = (sz) => c.profile.reduce((n, para) => n + wrapText(ctx, para, tw, { serif: true, size: sz }).length * sz * 1.38 + 8, 0) <= H - 84 - 176; // keep clear of the sprite in the corner
    while (size > 10.5 && !fits(size)) size -= 0.5;
    let y = 176;
    for (const para of c.profile) y = paragraph(ctx, para, x, y, tw, { size, serif: true, color: '#e8e0ff', lineHeight: size * 1.38 }) + 8;
    const chibi = app.charArt.chibi(id, 64);
    ctx.setTransform(px, 0, 0, px, (W - 50) * px, (H - 70 + Math.sin(this.t * 0.06) * 2) * px);
    ctx.drawImage(chibi.img, -chibi.w / 2, -chibi.h / 2, chibi.w, chibi.h);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.globalAlpha = 1;
    const cs = app.charArt;
    const sheetMsg = cs.status === 'ok'
      ? t('Sprite sheet: {a}, {b}', { a: t(cs.has('portrait', id) ? 'portrait' : 'drawn portrait'), b: t(cs.has('chibi', id) ? 'sprite' : 'drawn sprite') })
      : t('Sprite sheet: none (drawn art). See README.md to add assets/characters.png');
    text(ctx, sheetMsg, 24, H - 14, { size: 10, color: '#7a6aa0', maxWidth: W - 130 });
    text(ctx, `${this.i + 1} / ${SHEET_ORDER.length}   ← →`, W - 16, H - 14, { size: 11, align: 'right', color: '#7a6aa0' });
  }
}

// ---------------------------------------------------------------- settings --
export class SettingsPanel {
  constructor(app, onClose) {
    this.app = app;
    this.onClose = onClose;
    const s = () => app.save.settings;
    const set = (k, v) => {
      app.save.set(k, v);
      app.applySettings();
    };
    const vol = (k, label) => ({
      label: () => t(label),
      value: () => Math.round(s()[k] * 100) + '%',
      left: () => set(k, clamp(Math.round((s()[k] - 0.1) * 10) / 10, 0, 1)),
      right: () => set(k, clamp(Math.round((s()[k] + 0.1) * 10) / 10, 0, 1)),
    });
    const cycle = (k, label, opts, names) => ({
      label: () => t(label),
      value: () => t(names[Math.max(0, opts.indexOf(s()[k]))]),
      left: () => set(k, opts[(opts.indexOf(s()[k]) - 1 + opts.length) % opts.length]),
      right: () => set(k, opts[(opts.indexOf(s()[k]) + 1) % opts.length]),
    });
    // 'auto' follows the ArozOS system language; languages are named in their own script
    const langs = ['auto', ...LANGS.map((l) => l.id)];
    const lang = {
      ...cycle('lang', 'Language', langs, langs),
      value: () => (s().lang === 'auto' || !langs.includes(s().lang) ? `${t('System')} (${langName(systemLang())})` : langName(s().lang)),
    };
    this.menu = new Menu([
      lang,
      vol('master', 'Master Volume'),
      vol('music', 'Music Volume'),
      vol('sfx', 'Sound Volume'),
      cycle('startLives', 'Starting Lives', [1, 2, 3, 4, 5], ['1', '2', '3', '4', '5']),
      cycle('hitbox', 'Hitbox', ['focus', 'always'], ['While focused', 'Always']),
      cycle('shake', 'Screen Shake', [true, false], ['On', 'Off']),
      cycle('bgDetail', 'Background Detail', ['high', 'low'], ['High', 'Low']),
      cycle('renderScale', 'Render Resolution', [1, 0.75, 0.5], ['100%', '75%', '50%']),
      cycle('touchSensitivity', 'Touch Sensitivity', [0.8, 1, 1.2, 1.5, 2], ['0.8x', '1.0x', '1.2x', '1.5x', '2.0x']),
      { label: () => t('Reset Settings'), action: () => { Object.assign(app.save.data.settings, DEFAULT_SETTINGS); app.save.write(); app.applySettings(); } },
      { label: () => t('Erase Scores and Progress'), action: () => (this.confirm = new Menu([{ label: () => t('No, keep them'), action: () => (this.confirm = null) }, { label: () => t('Yes, erase everything'), action: () => { app.save.reset(); this.confirm = null; } }])) },
      { label: () => t('Back'), action: () => this.onClose() },
    ]);
    this.confirm = null;
  }

  update() {
    const app = this.app;
    if (this.confirm) {
      const r = this.confirm.update(app);
      if (r === 'cancel') this.confirm = null;
      else if (r && r.action) r.action();
      return;
    }
    const r = this.menu.update(app);
    if (r === 'cancel') this.onClose();
    else if (r && r.action) r.action();
  }

  render(ctx, px) {
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.fillStyle = 'rgba(6,3,20,0.82)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, t('Settings'), W / 2, 54, { size: 24, display: true, bold: true, align: 'center', glow: '#9070ff' });
    this.menu.render(ctx, W / 2 - 170, 96, { gap: 27, size: 15, width: 340 });
    if (this.confirm) {
      panel(ctx, W / 2 - 160, 170, 320, 140, '#ff7a9a', 0.95);
      text(ctx, t('Erase all scores, progress and card history?'), W / 2, 205, { size: 13, serif: true, align: 'center', color: '#ffd0d8', maxWidth: 296 });
      this.confirm.render(ctx, W / 2, 248, { gap: 28, size: 15, width: 220, align: 'center' });
    }
    text(ctx, t('← → change    Z: choose    X: back'), W - 16, H - 14, { size: 11, align: 'right', color: '#7a6aa0', maxWidth: W - 32 });
  }
}

export class SettingsScene {
  constructor(app) {
    this.app = app;
    this.panel = new SettingsPanel(app, () => app.open('title', { start: 6 }));
  }

  update() {
    this.app.backdrop.update();
    this.panel.update();
  }

  render(ctx, px) {
    this.app.backdrop.render(ctx, px, 0);
    this.panel.render(ctx, px);
  }
}

// ------------------------------------------------------------------ manual --
export class HowToScene {
  constructor(app) {
    this.app = app;
    this.page = 0;
  }

  update() {
    const app = this.app;
    const inp = app.input;
    app.backdrop.update();
    if (inp.repeat('right') || inp.mouse.clicked) {
      if (this.page < MANUAL.length - 1) {
        this.page++;
        app.sfx.play('select');
      } else if (inp.mouse.clicked) {
        app.open('title', { start: 7 });
      }
    }
    if (inp.repeat('left') && this.page > 0) {
      this.page--;
      app.sfx.play('select');
    }
    if (inp.pressed('cancel') || inp.pressed('confirm')) {
      app.sfx.play('back');
      inp.consume();
      app.open('title', { start: 7 });
    }
  }

  render(ctx, px) {
    this.app.backdrop.render(ctx, px, 0.78);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const p = MANUAL[this.page];
    text(ctx, t('How to Play'), 24, 36, { size: 22, display: true, bold: true, color: '#e8dcff', glow: '#9070ff' });
    text(ctx, p.title, W / 2, 74, { size: 18, display: true, bold: true, align: 'center', color: '#ffe0b0' });
    // shrink the page text until every entry fits above the footer
    let size = 12.5;
    const height = (sz) => p.lines.reduce((n, [, v]) => n + wrapText(ctx, v, 430, { serif: true, size: sz }).length * Math.round(sz * 1.36) + 9, 0);
    while (size > 10 && height(size) > H - 40 - 100) size -= 0.5;
    let y = 104;
    for (const [k, v] of p.lines) {
      text(ctx, k, 32, y, { size: 13, display: true, bold: true, color: '#d8c0ff', maxWidth: 128 });
      y = paragraph(ctx, v, 172, y, 430, { size, serif: true, color: '#ece6ff', lineHeight: Math.round(size * 1.36) }) + 9;
    }
    text(ctx, `${this.page + 1} / ${MANUAL.length}   ${t('← → page    X: back')}`, W - 16, H - 14, { size: 11, align: 'right', color: '#7a6aa0', maxWidth: W - 32 });
    void TAU;
  }
}

/** Show one ending's pages (after a run, and the debug menu's story viewer). */
export function openEnding(app, char, good, then) {
  const e = ENDINGS[`${char}/${good ? 'good' : 'bad'}`];
  const art = app.titleArt.endings[e.no] || null;
  app.open('story', { pages: e.pages, heading: t('Ending No. {n}', { n: e.no }), footer: `「${e.title}」`, hint: e.hint, tint: e.tint, music: 'ending', art, then });
}
