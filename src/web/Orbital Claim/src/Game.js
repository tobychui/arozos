import { Loop } from './core/Loop.js';
import { Camera } from './core/Camera.js';
import { Input } from './core/Input.js';
import { Assets } from './core/Assets.js';
import { Renderer } from './render/Renderer.js';
import { World } from './world/World.js';
import { Hud } from './ui/Hud.js';
import { Minimap } from './ui/Minimap.js';
import { SaveGame } from './systems/SaveGame.js';
import { Settings } from './systems/Settings.js';
import { Sound } from './systems/Sound.js';
import { StatsRecorder } from './systems/StatsRecorder.js';
import { RunCharts } from './ui/RunCharts.js';
import { PauseMenu } from './ui/PauseMenu.js';
import { TitleScene } from './ui/TitleScene.js';
import { SurvivalMode } from './systems/modes/SurvivalMode.js';
import { MiningMode } from './systems/modes/MiningMode.js';
import { SandboxMode } from './systems/modes/SandboxMode.js';
import { formatTime } from './systems/modes/Mode.js';

const MODE_CLASSES = {
  survival: SurvivalMode,
  mining: MiningMode,
  sandbox: SandboxMode,
};

const MODE_NAMES = {
  survival: 'Survival',
  mining: 'Mining Race',
  sandbox: 'Sandbox',
};

/**
 * Top-level orchestrator.
 *
 * Owns the loop, wires input intent to world actions, and holds UI-only state
 * (what is selected, what is queued for building). Deliberately the only place
 * that knows about all the pieces, so everything below it stays independent.
 */
export class Game {
  constructor(canvas, hudRoot) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;

    this.assets = new Assets();
    this.camera = new Camera(canvas);
    this.input = new Input(canvas, this.camera);
    this.save = new SaveGame();
    this.settings = new Settings(this.save);
    this.sound = new Sound();

    this.world = null;
    this.renderer = null;
    this.hud = null;
    this.mode = null;
    this.menu = null;
    // True from a mode's start until the player leaves it for the title. The
    // finished world stays on screen behind the title, but must not take keys.
    this.inRun = false;

    this.buildKey = null;   // structure queued for placement
    // Sandbox: enemy type queued for spawning by clicking the map.
    this.spawnKey = null;
    this.spawnCount = 1;
    this.selected = null;
    // Recycle mode: clicking sells outright and stays active, so tearing down
    // an obsolete run of relays is one click each rather than select-then-sell.
    this.sellMode = false;
    // Global launcher cut-off: missiles cost minerals, so silencing every bay at
    // once is the quickest way to stop bleeding income in a lull.
    this.launchersDisabled = false;
    this.speed = 1;
    // Must match the Hud's build-bar order: the number keys index into this.
    this.buildOrder = ['miner', 'solar', 'battery', 'relay',
                       'laser', 'pulser', 'missileBay', 'repair'];

    this.loop = new Loop(
      (dt) => this.update(dt),
      (alpha) => this.render(alpha)
    );
  }

  /** Load shared assets, then hand control to the menu. */
  async init() {
    this.data = await fetch('assets/entities.json').then((r) => {
      if (!r.ok) throw new Error(`entities.json: HTTP ${r.status}`);
      return r.json();
    });
    await this.assets.load('assets/sprites.svg');

    this.renderer = new Renderer(this.canvas, this.assets, this.camera);
    this.menu = new PauseMenu(document.getElementById('pause'), this);
    this.titleScene = new TitleScene(document.getElementById('title-bg'), this.assets);
    this._bindInput();
    this._bindResize();
    this._bindOverlay();
    this._bindSettings();
    this._bindAudio();
    this.renderer.resize();
    this._buildMenu();
    return this;
  }

  _bindOverlay() {
    // Bound once, rather than per run, so repeated games do not stack handlers.
    document.getElementById('again').addEventListener('click', () => {
      this.start(this.mode?.key ?? 'survival', this.mode?.difficulty);
    });
    document.getElementById('tomenu').addEventListener('click', () => this.quitToTitle());
    document.getElementById('title-settings').addEventListener('click', () => this.menu.open());
  }

  /** Apply every saved preference now, and each change as it is made. */
  _bindSettings() {
    const apply = (key, v) => {
      const body = document.body.classList;
      switch (key) {
        case 'masterVolume': this.sound.setVolume('master', v); break;
        case 'combatVolume': this.sound.setVolume('world', v); break;
        case 'uiVolume': this.sound.setVolume('ui', v); break;
        case 'muted': this.sound.setMuted(v); break;
        case 'renderScale':
          this.renderer.pixelScale = v;
          this.renderer.resize();
          this.titleScene.pixelScale = v;
          if (this.titleScene.running) this.titleScene.resize();
          break;
        case 'stars':
          this.renderer.setStarDensity(v);
          this.titleScene.setStarDensity(v);
          break;
        case 'effects':
          this.renderer.fxFull = v !== 'reduced';
          this.titleScene.fxFull = v !== 'reduced';
          break;
        case 'links': this.renderer.linkMode = v; break;
        case 'showFps': body.toggle('no-fps', !v); break;
        case 'showControls': body.toggle('no-controls', !v); break;
        case 'panSpeed': this.input.panSpeed = v; break;
        default: break;
      }
    };
    for (const [key, v] of Object.entries(this.settings.values)) apply(key, v);
    this.settings.onChange(apply);
  }

  _bindAudio() {
    // Browsers only start audio from a user gesture, so every press offers.
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // One quiet tick for every button, so the interface answers back.
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button, a');
      if (b && !b.disabled) this.sound.play('click');
    });

    // Leaving the window mid-wave should not cost the run.
    const away = () => {
      if (this.settings.get('pauseOnBlur') && this.inRun && !this.mode?.finished && !this.menu.isOpen) {
        this.menu.open();
      }
    };
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) away();
    });
  }

  get modeName() {
    const name = MODE_NAMES[this.mode?.key] ?? this.mode?.name ?? '';
    return this.mode?.difficultyName ? `${name} (${this.mode.difficultyName})` : name;
  }

  /**
   * A mode's settings with its difficulty laid over them. Modes without
   * difficulties come back as they are, with no difficulty key.
   */
  _modeConfig(modeKey, difficulty) {
    const base = this.data.modes?.[modeKey] ?? {};
    const diffs = base.difficulties;
    if (!diffs) return base;
    const key = diffs[difficulty] ? difficulty : base.defaultDifficulty ?? 'normal';
    return { ...base, ...diffs[key], difficulty: key };
  }

  /** Sandbox runs and runs with creative tools switched on. */
  get creative() {
    return !!(this.mode?.isSandbox || this.mode?.creative);
  }

  /** Leave the current run for the title screen. Nothing is recorded. */
  quitToTitle() {
    this.inRun = false;
    this.menu.close({ resume: false });
    this.runCharts?.destroy();
    this.runCharts = null;
    document.getElementById('over').classList.remove('show');
    this.loop.setPaused(true);
    this.sound.setHum(0);
    this._buildMenu();
  }

  // -------------------------------------------------------------------- menu

  _buildMenu() {
    const menu = document.getElementById('menu');
    const list = menu.querySelector('#mode-list');
    list.innerHTML = '';

    for (const [key, cfg] of Object.entries(this.data.modes ?? {})) {
      if (!MODE_CLASSES[key]) continue; // 'missions' is not built yet
      if (cfg.difficulties) {
        list.appendChild(this._difficultyCard(key, cfg));
        continue;
      }
      const best = this.save.bestFor(key);
      const debug = key === 'sandbox';
      const btn = document.createElement('button');
      btn.className = debug ? 'mode debug' : 'mode';
      btn.innerHTML = `
        <span class="mn">${MODE_NAMES[key] ?? key}</span>
        <span class="md">${cfg.goal ?? ''}</span>
        <span class="mb">${debug ? 'Debug tools · no score'
          : best ? `Best: ${this._formatBest(best)}` : 'No record yet'}</span>
      `;
      btn.addEventListener('click', () => this.start(key));
      list.appendChild(btn);
    }
    menu.classList.add('show');
    // After showing, so the scene can measure the screen.
    this.titleScene.start();
  }

  /**
   * A mode card with one start button per difficulty, each showing its quota,
   * clock and personal best — picking a difficulty is starting the run, so
   * there is no selection to remember.
   */
  _difficultyCard(key, cfg) {
    const card = document.createElement('div');
    card.className = 'mode has-diff';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', MODE_NAMES[key] ?? key);
    const diffs = Object.entries(cfg.difficulties).filter(([k]) => !k.startsWith('$'));
    card.innerHTML = `
      <span class="mn">${MODE_NAMES[key] ?? key}</span>
      <span class="md">${cfg.goal ?? ''}</span>
      <span class="diffs">
        ${diffs.map(([dk, d]) => {
          const best = this.save.bestFor(MiningMode.recordKeyFor(dk));
          return `<button class="diff diff-${dk}" data-diff="${dk}"
              title="${d.name}: bank ${d.target.toLocaleString()} minerals in ${formatTime(d.time)}">
            <b>${d.name}</b>
            <i>${(d.target / 1000).toLocaleString()}k · ${formatTime(d.time)}</i>
            <em>${best ? this._formatBest(best) : '—'}</em>
          </button>`;
        }).join('')}
      </span>`;
    card.querySelectorAll('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => this.start(key, b.dataset.diff));
    });
    return card;
  }

  _formatBest(best) {
    if (!best) return '—';
    return best.metric === 'time' ? formatTime(best.value) : `wave ${best.value}`;
  }

  // ------------------------------------------------------------------- start

  /**
   * @param {string} modeKey
   * @param {string} [difficulty] for modes that have difficulties; the mode's
   *   default otherwise
   */
  start(modeKey, difficulty) {
    this.menu.close({ resume: false });
    this.titleScene.stop();
    document.getElementById('menu').classList.remove('show');
    document.getElementById('over').classList.remove('show');

    this.runCharts?.destroy();
    this.runCharts = null;
    const cfg = this._modeConfig(modeKey, difficulty);
    this.world = new World(this.data, Math.floor(Math.random() * 100000), {
      startMinerals: cfg.startMinerals,
      field: {
        clusters: cfg.clusters,
        richness: cfg.oreRichness,
        homeRocks: cfg.homeRocks,
        // A quota must always be payable from the field, with room to spare
        // for rocks lost to raids or too exposed to work.
        minOre: cfg.target ? cfg.target * (cfg.oreMargin ?? 2) : 0,
      },
      waves: { hp: cfg.enemyHp, count: cfg.enemyCount, window: cfg.buildWindow },
    });
    this.world.onSound = (cue, x, y) => this._worldSound(cue, x, y);
    this.world.waves.onWaveStart = () => this.sound.play('waveStart');
    this.world.waves.onWaveClear = () => this.sound.play('waveClear');
    this.stats = new StatsRecorder(this.world);
    const Cls = MODE_CLASSES[modeKey] ?? SurvivalMode;
    this.mode = new Cls(this.world, cfg);
    this.inRun = true;

    this.hud = new Hud(this.hudRoot, this.world, this.data);
    this.hud.onMenu = () => this.menu.open();
    this.hud.onBuildSelect = (key) => this.toggleBuild(key);
    this.hud.onSell = (s) => this.sell(s);
    this.hud.onCallWave = () => this.world.waves.callWaveNow();
    this.hud.onToggleRecycle = () => this.toggleSellMode();
    this.hud.onRecycleDead = () => this.recycleDeadMiners();
    this.hud.onSetSpeed = (m) => this.setSpeed(m);
    this.hud.onToggleDisabled = (s) => this.toggleDisabled(s);
    this.hud.onToggleAllLaunchers = () => this.toggleAllLaunchers();
    this.hud.onUpgrade = (s, pathKey) => this.upgrade(s, pathKey);
    this.hud.onLocateIsolated = () => this.locateIsolated();
    this._locateIdx = 0;
    if (this.mode.isSandbox) this._bindSandbox();

    // Rebuilt per run: the Hud recreates its DOM, so the old canvas is gone.
    this.minimap = new Minimap(
      document.getElementById('minimap'), this.world, this.camera
    );

    this.buildKey = null;
    this.spawnKey = null;
    this.spawnCount = 1;
    this.selected = null;
    // A restart from the Esc menu can come straight out of recycle mode; the
    // new run must not open with a click that sells.
    this.sellMode = false;
    this.launchersDisabled = false;
    document.body.classList.remove('selling');
    this.camera.centerOn(0, 0);
    this.camera.setBounds(-2400, -2400, 2400, 2400);

    this.loop.setPaused(false);
    document.body.classList.remove('paused');
    this.loop.start();
  }

  _bindResize() {
    const onResize = () => this.renderer.resize();
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(this.canvas);
  }

  _bindInput() {
    this.input.on('click', (world) => this.onClick(world));
    this.input.on('rightclick', () => this.cancel());
    this.input.on('key', (k, e) => this.onKey(k, e));
  }

  // ------------------------------------------------------------------- input

  onClick(worldPos) {
    if (!this.world || this.mode?.finished) return;
    if (this.buildKey) {
      this.tryPlace(worldPos.x, worldPos.y);
      return;
    }
    if (this.spawnKey) {
      this.spawnEnemiesAt(this.spawnKey, worldPos.x, worldPos.y, this.spawnCount);
      if (!this.input.isDown('shift')) this.setSpawn(null);
      return;
    }
    if (this.sellMode) {
      const hit = this.world.structureAt(worldPos.x, worldPos.y, 6);
      if (hit) this.sell(hit);
      return;
    }
    // Structures win ties, then asteroids — so clicking a miner sitting over a
    // rock selects the miner, which is nearly always what was meant.
    this.select(
      this.world.structureAt(worldPos.x, worldPos.y, 6) ||
      this.world.asteroidAt(worldPos.x, worldPos.y, 6)
    );
  }

  onKey(k, e) {
    // The menu takes every key while it is open; Esc steps back through it.
    if (this.menu.isOpen) {
      if (k === 'escape') this.menu.back();
      return;
    }
    if (!this.world || !this.inRun || this.mode?.finished) return;
    if (k === 'escape') {
      // Esc first drops whatever tool is armed, so backing out of a placement
      // never lands in the menu by surprise.
      if (this.buildKey || this.spawnKey || this.sellMode) this.cancel();
      else this.menu.open();
      return;
    }
    const n = parseInt(k, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= this.buildOrder.length) {
      this.toggleBuild(this.buildOrder[n - 1]);
      return;
    }
    if (k === ' ') {
      // Otherwise a focused HUD button would also be clicked by the same press.
      e?.preventDefault();
      const paused = this.loop.togglePause();
      document.body.classList.toggle('paused', paused);
    }
    if (k === 'g') {
      // G hides the links and brings back whichever style was showing.
      const cur = this.settings.get('links');
      if (cur !== 'hidden') this._shownLinks = cur;
      this.settings.set('links', cur === 'hidden' ? this._shownLinks ?? 'animated' : 'hidden');
    }
    if (k === 'm') {
      const muted = !this.settings.get('muted');
      this.settings.set('muted', muted);
      this.flashText(muted ? 'Sound off (M)' : 'Sound on (M)');
    }
    if (k === 'enter') this.world.waves.callWaveNow();
    if (k === 'delete' && this.selected) this.sell(this.selected);
    if (k === 'x') {
      // X sells the current selection, or arms recycle mode when nothing is
      // selected — so it works whichever way you reach for it.
      if (this.selected && this.selected.key) {
        this.sell(this.selected);
      } else {
        this.toggleSellMode();
      }
    }
  }

  /**
   * @param {number} mult
   * @param {boolean} [resume] the top bar's speed buttons also unpause; the
   *   Esc menu passes false, since the game must stay paused behind it
   */
  setSpeed(mult, resume = true) {
    this.speed = mult;
    this.loop.speed = mult;
    if (resume && this.loop.paused) {
      this.loop.setPaused(false);
      document.body.classList.remove('paused');
    }
  }

  /**
   * @param {object} s
   * @param {string|null} [pathKey] which branch, when the structure offers a
   *   choice. Ignored while an upgrade is running — then this cancels instead.
   */
  upgrade(s, pathKey = null) {
    if (!s) return;
    if (s.upgrading) {
      s.cancelUpgrade(this.world.economy);
      this.flashText('Upgrade cancelled');
      this.sound.play('sell');
      return;
    }
    if (!s.canUpgrade) return;
    const opt = pathKey
      ? s.upgradeOptions.find((o) => o.pathKey === pathKey)
      : s.upgradeOptions[0];
    if (!opt) return;
    if (!s.startUpgrade(this.world.economy, pathKey)) {
      this.flashText('Not enough minerals');
      this.sound.play('error');
      return;
    }
    this.sound.play('confirm');
    if (this.world.instantBuild) {
      s.finishUpgrade();
      this.flashText(`${opt.tier.name} installed`);
      return;
    }
    this.flashText(`${opt.tier.name} started`);
  }

  /**
   * Pan to a group of structures cut off from every power source and make them
   * blink. Repeated clicks step through the groups, so several stranded
   * sections can each be found in turn.
   */
  locateIsolated() {
    const groups = this.world.grid.islands
      .filter((isle) => !isle.hasSource)
      .map((isle) => isle.order.filter((s) => s.alive))
      .filter((g) => g.length);
    if (!groups.length) return;

    const group = groups[this._locateIdx++ % groups.length];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of group) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minY = Math.min(minY, s.pos.y); maxY = Math.max(maxY, s.pos.y);
    }
    // Zoom out only if the group would not otherwise fit; never zoom in, which
    // would feel like the click had grabbed the camera.
    const cam = this.camera;
    const pad = 160;
    const fit = Math.min(cam.width / (maxX - minX + pad), cam.height / (maxY - minY + pad));
    if (fit > 0) cam.targetZoom = Math.max(cam.minZoom, Math.min(cam.targetZoom, fit));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (this.loop.paused) {
      // The camera only eases inside update(), so snap rather than stall.
      cam.zoom = cam.targetZoom;
      cam.centerOn(cx, cy);
    } else {
      cam.targetX = cx;
      cam.targetY = cy;
    }

    // Wall-clock rather than world time, so the blink still plays while paused.
    const until = performance.now() + 2200;
    for (const s of group) s.locateUntil = until;
    if (groups.length > 1) this.flashText(`Isolated group ${(this._locateIdx - 1) % groups.length + 1} of ${groups.length}`);
  }

  toggleDisabled(s) {
    if (!s) return;
    s.disabled = !s.disabled;
  }

  toggleAllLaunchers() {
    this.launchersDisabled = !this.launchersDisabled;
    for (const s of this.world.structures) {
      if (s.alive && s.isLauncher) s.disabled = this.launchersDisabled;
    }
  }

  recycleDeadMiners() {
    const { count, refund } = this.world.recycleDeadMiners();
    if (count) this.sound.play('sell');
    this.flashText(count
      ? `Recycled ${count} exhausted miner${count === 1 ? '' : 's'} · +${refund}`
      : 'No exhausted miners to recycle');
  }

  toggleSellMode() {
    this.sellMode = !this.sellMode;
    if (this.sellMode) {
      this.spawnKey = null;
      this.buildKey = null;
      this.hud?.setActiveBuild(null);
      this.select(null);
    }
    document.body.classList.toggle('selling', this.sellMode);
  }

  toggleBuild(key) {
    this.buildKey = this.buildKey === key ? null : key;
    this.hud?.setActiveBuild(this.buildKey);
    if (this.buildKey) {
      this.spawnKey = null;
      this.select(null);
    }
  }

  // ----------------------------------------------------------------- sandbox

  _bindSandbox() {
    this.hud.buildSandbox({
      onSpawnSelect: (type) => this.setSpawn(this.spawnKey === type ? null : type),
      onSpawnCount: (n) => { this.spawnCount = n; },
      onCallWave: () => this.world.waves.callWaveNow(),
      onToggleWaveTimer: () => { this.world.waves.frozen = !this.world.waves.frozen; },
      onTogglePower: () => { this.world.grid.unlimited = !this.world.grid.unlimited; },
      onClearEnemies: () => this.clearEnemies(),
      onRepairAll: () => this.repairAll(),
    });
  }

  /** Arm (or with null, disarm) the enemy spawner. */
  setSpawn(type) {
    this.spawnKey = type;
    if (type) {
      this.buildKey = null;
      this.hud?.setActiveBuild(null);
      if (this.sellMode) this.toggleSellMode();
      this.select(null);
    }
  }

  /** Spawn a cluster around a point; a single ship lands exactly on it. */
  spawnEnemiesAt(type, x, y, count = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = count > 1 ? 14 + Math.random() * 46 : 0;
      this.world.spawnEnemy(type, x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }

  /** @returns {string} what happened, for the HUD or the Esc menu */
  clearEnemies() {
    const w = this.world;
    const n = w.enemies.filter((e) => e.alive).length;
    // Removed outright rather than killed: no bounty, and exploders do not
    // detonate on the way out. Flagged dead so turrets drop them as targets.
    for (const e of w.enemies) e.alive = false;
    w.enemies.length = 0;
    for (const p of w.projectiles) if (p.team === 'enemy') p.alive = false;
    w.waves.queue.length = 0;
    const msg = `Cleared ${n} enem${n === 1 ? 'y' : 'ies'}`;
    this.flashText(msg);
    return msg;
  }

  /** @returns {string} */
  repairAll() {
    for (const s of this.world.structures) if (s.alive) s.hp = s.maxHp;
    const msg = 'All structures repaired';
    this.flashText(msg);
    return msg;
  }

  /**
   * Switch a Survival or Mining run over to the sandbox toolset. One way: the
   * run stops counting towards a personal best even if the switches go back.
   */
  enableCreative() {
    if (this.creative) return;
    this.mode.creative = true;
    this.world.economy.infinite = true;
    this.setInstantBuild(true);
    this._bindSandbox();
  }

  setInstantBuild(on) {
    const w = this.world;
    w.instantBuild = on;
    if (!on) return;
    // Switching it on also finishes whatever is already under way, or those
    // sites would be the only slow builds left in an instant world.
    for (const s of w.structures) {
      if (!s.alive) continue;
      s.buildProgress = 1;
      if (s.upgrading) s.finishUpgrade();
    }
  }

  cancel() {
    if (this.spawnKey) {
      this.setSpawn(null);
    } else if (this.sellMode) {
      this.toggleSellMode();
    } else if (this.buildKey) {
      this.buildKey = null;
      this.hud?.setActiveBuild(null);
    } else {
      this.select(null);
    }
  }

  select(s) {
    if (this.selected) this.selected.selected = false;
    this.selected = s || null;
    if (this.selected) this.selected.selected = true;
  }

  tryPlace(x, y) {
    const check = this.world.canPlaceAt(this.buildKey, x, y);
    if (!check.ok) {
      this.flash(check.reason);
      return;
    }
    if (!this.world.placeStructure(this.buildKey, x, y)) {
      this.flash('minerals');
      return;
    }
    this.sound.play('place');
    // Shift keeps the tool active for laying out several in a row.
    if (!this.input.isDown('shift')) this.cancel();
  }

  sell(s) {
    if (!s) return;
    if (this.world.liveStructures.length <= 1) {
      this.flashText('Cannot sell your last structure');
      this.sound.play('error');
      return;
    }
    if (this.selected === s) this.select(null);
    if (this.world.sellStructure(s)) this.sound.play('sell');
  }

  flash(reason) {
    const msg = {
      minerals: 'Not enough minerals',
      blocked: 'Too close to another structure',
      asteroid: 'Cannot build on an asteroid',
      range: 'Outside the operating area',
    }[reason] || 'Cannot build there';
    this.flashText(msg);
    this.sound.play('error');
  }

  /** Transient message in the warning strip. */
  flashText(msg) {
    const warn = this.hudRoot?.querySelector('#warn');
    if (!warn) return;
    warn.querySelector('.err')?.remove();
    warn.insertAdjacentHTML('afterbegin', `<div class="w err">${msg}</div>`);
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => warn.querySelector('.err')?.remove(), 1800);
  }

  // -------------------------------------------------------------------- over

  _endRun() {
    const over = document.getElementById('over');
    if (over.classList.contains('show')) return;

    this.stats.finish();
    const won = this.mode.state === 'won';
    // A run that used creative tools proves nothing, so it never sets a best.
    const isBest = !this.mode.creative && this.save.recordScore(this.mode.recordKey, this.mode.score());
    const best = this.save.bestFor(this.mode.recordKey);
    this.sound.setHum(0);
    this.sound.play(won ? 'win' : 'lose');

    over.querySelector('#over-title').textContent = won ? 'Quota met' : 'Run over';
    over.querySelector('#over-title').className = won ? 'win' : '';
    over.querySelector('#over-reason').textContent = this.mode.reason;
    const w = this.world;
    over.querySelector('#over-rows').innerHTML = [
      ...this.mode.summary(),
      ['Enemies killed', String(w.kills)],
      ['Structures built', String(w.structuresBuilt)],
      ['Structures destroyed', String(w.structuresLost)],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
    const noRecord = this.mode.creative ? 'Creative tools were on, so this run is not recorded. ' : '';
    over.querySelector('#over-best').innerHTML = best
      ? `${isBest ? '<em>New personal best!</em> ' : noRecord}Best: <b>${this._formatBest(best)}</b>`
      : noRecord;

    over.classList.add('show');
    over.scrollTop = 0;
    this.loop.setPaused(true);
    // After the overlay is visible, so the charts can measure their width.
    this.runCharts = new RunCharts(over.querySelector('#over-charts'), this.stats, w);
  }

  update(dt) {
    if (!this.world) return;
    this.input.applyKeyboardPan(dt);
    this.camera.update(dt);
    this.world.update(dt);
    this.stats.update(dt);
    this.mode.update(dt);
    if (this.selected && !this.selected.alive) this.select(null);
    this.hud.update(this);
    if (this.mode.finished) this._endRun();
  }

  render() {
    // Behind the title the old world is covered by the title scene, so drawing
    // it would only cost frames.
    if (!this.world || !this.inRun) return;
    this.renderer.render(this.world, {
      buildKey: this.buildKey,
      spawnKey: this.spawnKey,
      spawnCount: this.spawnCount,
      sellMode: this.sellMode,
      pointer: this.input.overCanvas ? this.input.world : null,
    });
    this.minimap?.render();
    this._updateHum();
  }

  // ------------------------------------------------------------------- sound

  /**
   * Play a world event at the loudness of where it happened: full volume on
   * screen, fading out over about half a screen beyond the edge, and panned
   * left or right with its position. Zoomed far out, everything is a little
   * quieter, since far more is happening on screen at once.
   */
  _worldSound(cue, x, y) {
    const cam = this.camera;
    const w = cam.width;
    const h = cam.height;
    const s = cam.toScreen(x, y);
    const outX = Math.max(0, Math.abs(s.x - w / 2) - w / 2);
    const outY = Math.max(0, Math.abs(s.y - h / 2) - h / 2);
    const fade = Math.max(0, 1 - Math.hypot(outX, outY) / (Math.max(w, h) * 0.6));
    const zoom = 0.55 + 0.45 * Math.min(1, cam.zoom);
    const pan = Math.max(-1, Math.min(1, (s.x - w / 2) / (w / 2))) * 0.6;
    this.sound.play(cue, fade * zoom, pan);
  }

  /** The laser drone follows how many beams are cutting on screen. */
  _updateHum() {
    if (!this.sound.ctx) return;
    let level = 0;
    if (this.inRun && !this.loop.paused) {
      const view = this.camera.viewRect(0);
      for (const s of this.world.structures) {
        if (!s.isBeam || s.beamHeat < 0.05 || !s.alive) continue;
        if (s.pos.x < view.minX || s.pos.x > view.maxX || s.pos.y < view.minY || s.pos.y > view.maxY) continue;
        level += s.beamHeat;
      }
    }
    this.sound.setHum(Math.min(1, level / 4));
  }
}
