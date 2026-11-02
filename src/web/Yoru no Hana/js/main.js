/**
 * Boot and the app shell: services shared by every screen (view, input,
 * audio, saves, art, language), scene switching with a fade, the F3 debug
 * menu and the ArozOS window hooks. Scenes implement update() and
 * render(ctx, px), plus optional enter() / exit().
 */
import { View } from './core/view.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { Save } from './core/save.js';
import { AudioEngine } from './audio/audio.js';
import { Sfx } from './audio/sfx.js';
import { Music } from './audio/music.js';
import { Art } from './gfx/art.js';
import { CharArt } from './gfx/charart.js';
import { TitleArt } from './gfx/titleart.js';
import { resetFrameCache } from './ui/hud.js';
import { Backdrop, TitleScene } from './ui/title.js';
import {
  SelectScene, GameScene, StoryScene, CreditsScene, NameEntryScene, ScoresScene,
  MusicRoomScene, GalleryScene, SettingsScene, HowToScene,
} from './ui/scenes.js';
import { STAGES } from './stages/index.js';
import { CheatMenu } from './ui/cheats.js';
import { resolveLang, setUiStrings } from './core/i18n.js';
import { applyDataLocale } from './data/locale.js';
import { setUiFont } from './core/util.js';

const SCENES = {
  title: (app, o) => new TitleScene(app, o && o.start),
  select: (app, o) => new SelectScene(app, o),
  game: (app, o) => new GameScene(app, o),
  story: (app, o) => new StoryScene(app, o),
  credits: (app, o) => new CreditsScene(app, o),
  name: (app, o) => new NameEntryScene(app, o),
  scores: (app) => new ScoresScene(app),
  music: (app) => new MusicRoomScene(app),
  gallery: (app) => new GalleryScene(app),
  settings: (app) => new SettingsScene(app),
  howto: (app) => new HowToScene(app),
};

class App {
  constructor(canvas) {
    this.view = new View(canvas);
    this.input = new Input(this.view);
    this.save = new Save();
    this.audio = new AudioEngine();
    this.sfx = new Sfx(this.audio);
    this.music = new Music(this.audio);
    this.music.onSong = (id) => this.save.hearSong(id);
    this.art = new Art(this.view);
    this.charArt = new CharArt(this.art);
    this.titleArt = new TitleArt();
    this.backdrop = new Backdrop(this.titleArt);
    this.scene = null;
    this.fade = null;
    this.cheatMenu = null;
    this.lang = null;
    this._langSeq = 0;
    this._locales = {};
    this.autoPause = false;
    this.inDesktop = typeof ao_module_virtualDesktop !== 'undefined' && !!ao_module_virtualDesktop;
    this.loop = new Loop(() => this.update(), () => this.render());
    this.input.onFirstGesture = () => {
      if (this.audio.unlock()) {
        this.applySettings();
        setTimeout(() => this.music.resume(), 30);
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause = true;
    });
    window.addEventListener('blur', () => (this.autoPause = true));
    this.applySettings();
  }

  applySettings() {
    const s = this.save.settings;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    if (this.view.renderScale !== s.renderScale) this.view.setRenderScale(s.renderScale);
    this.applyLanguage();
  }

  /**
   * Switch to the language the setting stands for: locale/<id>.json is
   * fetched once and laid over the English data. A file that fails to load
   * leaves the current language in place.
   */
  async applyLanguage() {
    const id = resolveLang(this.save.settings.lang);
    if (id === this.lang) return;
    const seq = ++this._langSeq;
    let table = {};
    if (id !== 'en-us') {
      if (!this._locales[id]) {
        this._locales[id] = fetch(`locale/${id}.json`).then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      }
      try {
        table = await this._locales[id];
      } catch (err) {
        delete this._locales[id];
        console.warn('[Yoru no Hana] language failed to load:', id, err);
        if (this.lang === null) this.applyTable('en-us', {});
        return;
      }
    }
    if (seq === this._langSeq) this.applyTable(id, table);
  }

  applyTable(id, table) {
    this.lang = id;
    setUiStrings(id, table.ui);
    applyDataLocale(table);
    setUiFont(id);
    document.documentElement.lang = id;
  }

  playMusic(id, restart = false) {
    this.music.play(id, { restart });
  }

  /** Switch screens through a short fade to black. */
  open(name, opts = {}, { fade = 14 } = {}) {
    const make = () => SCENES[name](this, opts);
    if (!this.scene) {
      this._swap(make());
      return;
    }
    this.fade = { t: 0, n: fade, make, swapped: false };
  }

  _swap(scene) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = scene;
    this.autoPause = false;
    this.input.consume();
    if (scene.enter) scene.enter();
  }

  /** Offer the name entry screen when a story run made the top ten (never after cheats). */
  offerScore(g, then, stageOverride) {
    const rank = this.save.rankFor(g.charId, g.diff.id, g.score);
    if (rank < 0 || g.score <= 0 || g.cheated) {
      then();
      return;
    }
    this.open('name', {
      char: g.charId, diff: g.diff.id, score: g.score, rank, cont: g.continues,
      stage: stageOverride || g.stageNo, then,
    });
  }

  setWindowTitle(t) {
    if (typeof ao_module_setWindowTitle === 'function') {
      try {
        ao_module_setWindowTitle(t);
      } catch {
        /* not in a float window */
      }
    }
    document.title = t;
  }

  quit() {
    if (this.inDesktop && typeof ao_module_close === 'function') ao_module_close();
  }

  update() {
    this.input.update();
    if (this.input.pressed('debug')) {
      // F3: the debug menu, over any screen (which waits until it closes)
      this.cheatMenu = this.cheatMenu ? null : new CheatMenu(this);
      this.sfx.play(this.cheatMenu ? 'pause' : 'back');
      this.input.consume();
    } else if (this.cheatMenu) {
      this.cheatMenu.update();
    } else if (this.fade) {
      const f = this.fade;
      f.t++;
      if (!f.swapped && f.t >= f.n) {
        f.swapped = true;
        this._swap(f.make());
      }
      if (f.t >= f.n * 2) this.fade = null;
    } else if (this.scene) {
      this.scene.update();
    }
    this.input.endStep();
  }

  render() {
    const ctx = this.view.ctx;
    const px = this.view.px;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.scene) this.scene.render(ctx, px);
    if (this.fade) {
      const f = this.fade;
      const k = f.t < f.n ? f.t / f.n : 1 - (f.t - f.n) / f.n;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, k));
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.view.canvas.width, this.view.canvas.height);
      ctx.globalAlpha = 1;
    }
    if (this.cheatMenu) this.cheatMenu.render(ctx, px);
  }
}

/**
 * The bundled fonts (assets/fonts): Cinzel for Latin display text and a
 * subset of Shippori Mincho for Japanese and prose. Resolves when they are
 * ready or after `timeout` ms, whichever is first; fonts that arrive later
 * call `late` so cached sprites and the frame are redrawn with them.
 */
function loadFonts(timeout, late) {
  if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve();
  const faces = [
    ['YnH Cinzel', 'assets/fonts/Cinzel-VariableFont_wght.ttf', { weight: '400 900' }],
    ['YnH Mincho', 'assets/fonts/ShipporiMincho-Regular-subset.woff2', { weight: '400' }],
    ['YnH Mincho', 'assets/fonts/ShipporiMincho-Bold-subset.woff2', { weight: '700' }],
  ];
  const all = Promise.all(faces.map(([family, url, desc]) => new FontFace(family, `url("${url}")`, desc)
    .load()
    .then((f) => document.fonts.add(f))
    .catch((err) => console.warn('[Yoru no Hana] font failed to load:', url, err))));
  let timedOut = false;
  all.then(() => {
    if (timedOut) late();
  });
  return Promise.race([all, new Promise((res) => setTimeout(() => {
    timedOut = true;
    res();
  }, timeout))]);
}

async function boot() {
  const canvas = document.getElementById('screen');
  const app = new App(canvas);
  window.yoruApp = app;
  app.setWindowTitle('Yoru no Hana');
  await Promise.all([
    loadFonts(5000, () => {
      app.art.cache.clear();
      resetFrameCache();
    }),
    app.charArt.load('assets/'),
    app.titleArt.load('assets/'),
    app.applyLanguage(),
  ]);
  if (!STAGES.length) throw new Error('no stages');
  document.getElementById('boot').classList.add('hide');
  app.open('title');
  app.loop.start();
  canvas.focus();
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  b.classList.remove('hide');
  b.innerHTML = '<div class="t">夜の花</div><div class="err"></div>';
  b.querySelector('.err').textContent = 'Failed to start: ' + err.message;
});
