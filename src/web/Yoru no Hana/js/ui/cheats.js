/**
 * The F3 debug menu, drawn over whatever screen is open (which waits while
 * it is up). Four parts:
 *   - cheats for play (invincible, lives, bombs, power, hitboxes, game
 *     speed), kept in the save (data.cheats) until switched off;
 *   - actions on the running game (skip to the boss, clear the card, skip
 *     the stage, refill);
 *   - a story viewer: any heroine's prologue, the boss dialogue of any
 *     stage, both endings, the credits, or a story run from any stage;
 *   - unlocks for practice stages, card practice, the music room and endings.
 * A run that used a cheat or an action keeps no score and captures no cards.
 */
import { W, H } from '../core/view.js';
import { t } from '../core/i18n.js';
import { Menu, text, panel } from './widgets.js';
import { openEnding } from './scenes.js';
import { CAST, PLAYERS, DIFFICULTIES } from '../data/characters.js';
import { PROLOGUE, PROLOGUE_CHAR } from '../data/story.js';
import { STAGES } from '../stages/index.js';
import { SONGS } from '../audio/songs.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const ROWS = 15;
const GAP = 22;

export class CheatMenu {
  constructor(app) {
    this.app = app;
    this.t = 0;
    this.toast = null;
    this.scroll = 0;
    // what the story viewer shows, remembered while the app runs
    const pick = app.cheatPick || (app.cheatPick = { char: app.lastChar ?? 0, diff: app.lastDiff ?? 0, stage: 1 });

    const c = () => app.save.data.cheats;
    const setCheat = (k, v) => {
      c()[k] = v;
      app.save.write();
    };
    const flag = (k, label) => ({
      label: () => t(label),
      value: () => t(c()[k] ? 'On' : 'Off'),
      action: () => setCheat(k, !c()[k]),
      left: () => setCheat(k, !c()[k]),
      right: () => setCheat(k, !c()[k]),
    });
    const stepSpeed = (dir) => {
      const i = Math.max(0, SPEEDS.indexOf(c().speed || 1));
      setCheat('speed', SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))]);
    };
    const header = (label) => ({ header: true, disabled: true, label: () => t(label) });
    const game = () => this.game();
    const onGame = (label, fn) => ({
      label: () => t(label),
      get disabled() {
        return !game();
      },
      action: () => {
        if (fn(game())) this.close();
        else this.say('Not available right now');
      },
    });
    const cycle = (label, get, set, n, name) => ({
      label: () => t(label),
      value: () => name(get()),
      left: () => set((get() + n - 1) % n),
      right: () => set((get() + 1) % n),
    });
    const story = (label, fn) => ({
      label: () => t(label),
      action: () => {
        this.close();
        fn(PLAYERS[pick.char]);
      },
    });
    const unlock = (label, fn) => ({
      label: () => t(label),
      action: () => {
        fn();
        app.save.write();
        this.say('Unlocked');
      },
    });

    this.menu = new Menu([
      header('Cheats'),
      flag('invincible', 'Invincible (no hit damage)'),
      flag('lives', 'Infinite lives'),
      flag('bombs', 'Infinite bombs'),
      flag('power', 'Full power'),
      flag('hitbox', 'Show hitboxes'),
      {
        label: () => t('Game speed'),
        value: () => `${c().speed || 1}x`,
        action: () => stepSpeed(c().speed >= 4 ? -4 : 1),
        left: () => stepSpeed(-1),
        right: () => stepSpeed(1),
      },
      { label: () => t('Turn all cheats off'), action: () => { for (const k of Object.keys(c())) setCheat(k, k === 'speed' ? 1 : false); this.say('Cheats off'); } },
      header('This run'),
      onGame('Skip to the boss', (g) => g.skipToBoss()),
      onGame('Clear the current card', (g) => g.clearCard()),
      onGame('Skip this stage', (g) => g.skipStage()),
      onGame('Refill lives, bombs and power', (g) => g.refill()),
      header('Story check'),
      cycle('Heroine', () => pick.char, (v) => (pick.char = v), PLAYERS.length, (v) => CAST[PLAYERS[v]].name),
      cycle('Difficulty', () => pick.diff, (v) => (pick.diff = v), DIFFICULTIES.length, (v) => DIFFICULTIES[v].name),
      cycle('Stage', () => pick.stage - 1, (v) => (pick.stage = v + 1), STAGES.length, (v) => String(v + 1)),
      story('Play the story from this stage', (char) => app.open('game', { mode: 'story', diff: pick.diff, char, stage: pick.stage, cheatStart: pick.stage > 1 })),
      story('Watch this stage\'s dialogue', (char) => app.open('game', { mode: 'talk', diff: pick.diff, char, stage: pick.stage })),
      story('Read the prologue', (char) => app.open('story', { pages: [...PROLOGUE, PROLOGUE_CHAR[char]], heading: t('Prologue'), tint: CAST[char].color, music: 'title', then: () => app.open('title') })),
      story('Read the good ending', (char) => openEnding(app, char, true, () => app.open('title'))),
      story('Read the bad ending', (char) => openEnding(app, char, false, () => app.open('title'))),
      story('Watch the credits', () => app.open('credits', { then: () => app.open('title') })),
      header('Unlocks'),
      unlock('Unlock every practice stage', () => this.unlockStages()),
      unlock('Unlock every card for practice', () => this.unlockCards()),
      unlock('Unlock the whole music room', () => this.unlockMusic()),
      unlock('Unlock everything', () => {
        this.unlockStages();
        this.unlockCards();
        this.unlockMusic();
        this.unlockEndings();
      }),
      { label: () => t('Close'), action: () => this.close() },
    ], { start: 1, wrap: true });
  }

  /** The running game, if the open screen is one the actions can work on. */
  game() {
    const sc = this.app.scene;
    const g = sc && sc.game;
    return g && g.state === 'play' && g.mode !== 'talk' ? g : null;
  }

  say(msg) {
    this.toast = { text: msg, t: 150 };
  }

  close() {
    this.app.cheatMenu = null;
    this.app.input.consume();
  }

  unlockStages() {
    for (const ch of PLAYERS) for (const dd of DIFFICULTIES) this.app.save.setReached(ch, dd.id, STAGES.length);
  }

  unlockCards() {
    const cards = this.app.save.data.cards;
    for (const s of STAGES) {
      for (const def of [s.midboss, s.boss]) {
        if (!def) continue;
        def.cards.forEach((c, i) => {
          const id = c.id || def.id + ':' + i;
          if (c.name && !cards[id]) cards[id] = {};
        });
      }
    }
  }

  unlockMusic() {
    for (const s of SONGS) this.app.save.data.music[s.id] = true;
  }

  unlockEndings() {
    for (const ch of PLAYERS) for (const kind of ['good', 'bad']) this.app.save.data.endings[`${ch}/${kind}`] = true;
  }

  update() {
    this.t++;
    if (this.toast && --this.toast.t <= 0) this.toast = null;
    const r = this.menu.update(this.app);
    if (r === 'cancel') this.close();
    else if (r && r.action) r.action();
  }

  render(ctx, px) {
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.fillStyle = 'rgba(4,2,14,0.6)';
    ctx.fillRect(0, 0, W, H);
    const x = 110;
    const y = 18;
    const w = W - 220;
    const h = H - 36;
    panel(ctx, x, y, w, h, '#ff8ac8', 0.94);
    text(ctx, t('Debug Menu'), x + 18, y + 30, { size: 18, display: true, bold: true, color: '#ffd0ec', glow: '#ff5ab0', maxWidth: w - 90 });
    text(ctx, 'F3', x + w - 18, y + 30, { size: 12, display: true, bold: true, align: 'right', color: '#c090b0' });
    const g = this.app.scene && this.app.scene.game;
    if (g && g.cheated) text(ctx, t('This run keeps no score.'), x + 18, y + 48, { size: 10.5, serif: true, color: '#e0a0c8', maxWidth: w - 36 });

    // a scrolling list; section headers are disabled items drawn as captions
    const m = this.menu;
    if (m.i < this.scroll + 1) this.scroll = Math.max(0, m.i - 1);
    if (m.i >= this.scroll + ROWS) this.scroll = m.i - ROWS + 1;
    const top = y + 74;
    const view = { ...m, items: m.items.slice(this.scroll, this.scroll + ROWS), i: m.i - this.scroll, t: m.t };
    Menu.prototype.render.call(view, ctx, x + 34, top, { gap: GAP, size: 13, width: w - 64, color: '#ff9ad8' });
    m.rects = [];
    view.rects.forEach((r, k) => (m.rects[k + this.scroll] = view.items[k].header ? null : r));
    view.items.forEach((it, k) => {
      if (!it.header) return;
      // cover the greyed menu label with the caption
      const yy = top + k * GAP;
      ctx.fillStyle = 'rgba(10,6,26,1)';
      ctx.fillRect(x + 8, yy - 14, w - 16, GAP - 2);
      text(ctx, it.label(), x + 18, yy, { size: 11, display: true, bold: true, color: '#ff8ac8', maxWidth: w - 36 });
      ctx.fillStyle = 'rgba(255,138,200,0.35)';
      ctx.fillRect(x + 18, yy + 4, w - 36, 1);
    });
    if (this.scroll > 0) text(ctx, '▲', x + w - 18, top - 16, { size: 10, align: 'right', color: '#c090b0' });
    if (this.scroll + ROWS < m.items.length) text(ctx, '▼', x + w - 18, top + ROWS * GAP - 12, { size: 10, align: 'right', color: '#c090b0' });

    if (this.toast) {
      ctx.globalAlpha = Math.min(1, this.toast.t / 20);
      text(ctx, t(this.toast.text), x + w / 2, y + h - 34, { size: 13, serif: true, bold: true, align: 'center', color: '#ffe8a0', maxWidth: w - 36 });
      ctx.globalAlpha = 1;
    }
    text(ctx, t('↑ ↓ choose    ← → change    Z: use    F3 / X: close'), x + w / 2, y + h - 12, { size: 10.5, align: 'center', color: '#a07a98', maxWidth: w - 24 });
  }
}
