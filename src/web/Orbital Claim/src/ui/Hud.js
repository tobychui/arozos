/**
 * DOM heads-up display.
 *
 * Kept in DOM rather than drawn to canvas so it stays crisp at any DPI, is
 * styleable in CSS, and is accessible to the browser's own text handling. The
 * canvas is for the world; the HUD is a document.
 */
export class Hud {
  constructor(root, world, data) {
    this.root = root;
    this.world = world;
    this.data = data;
    this.onBuildSelect = null;
    this.onSell = null;
    this._buildButtons = new Map();
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="res" id="res-min" title="Minerals">
          <svg viewBox="0 0 24 24"><use href="assets/sprites.svg#icon-mineral"/></svg>
          <span class="val">0</span><span class="sub"></span>
        </div>
        <div class="res" id="res-pow" title="Power supply vs demand">
          <svg viewBox="0 0 24 24"><use href="assets/sprites.svg#icon-power"/></svg>
          <span class="val">0 / 0</span><span class="sub"></span>
        </div>
        <div class="objective" id="objective">
          <div class="ob-top"><span class="ob-l"></span><span class="ob-v"></span></div>
          <div class="ob-bar"><i></i></div>
        </div>
        <div class="spacer"></div>
        <div class="wave" id="wave">
          <div class="wv-main"><span class="wv-n">Wave 1</span> <span class="wv-t"></span></div>
          <div class="wv-comp"></div>
          <button class="wv-call" id="callwave">Call wave now</button>
        </div>
        <div class="spacer"></div>
        <div class="speeds" id="speeds"></div>
        <div class="res" id="stat-fps"><span class="sub">-- fps</span></div>
        <button class="menu-btn" id="menubtn" title="Menu (Esc)" aria-label="Menu">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14 M5 12h14 M5 17h14"/></svg>
        </button>
      </div>

      <div class="hud-warn" id="warn"></div>

      <div class="hud-bottom">
        <div class="buildcol">
          <div class="buildbar" id="buildbar"></div>
          <div class="toolrow">
            <button class="recycle" id="recycle">
              <kbd>X</kbd> Recycle mode
              <span class="rc-hint">click structures to sell them</span>
            </button>
            <button class="recycle" id="recycle-dead"
                    title="Sell every miner whose asteroids are exhausted">
              Sweep dead miners
            </button>
          </div>
        </div>
        <div class="hud-right">
          <div class="inspect" id="inspect"></div>
          <canvas id="minimap" width="160" height="160" title="Click to jump the camera"></canvas>
        </div>
      </div>
    `;

    const bar = this.root.querySelector('#buildbar');
    // Grouped by role: economy, power, then defence.
    const order = ['miner', 'solar', 'battery', 'relay',
                   'laser', 'pulser', 'missileBay', 'repair'];

    order.forEach((key, i) => {
      const def = this.data.buildings[key];
      if (!def) return;
      const btn = document.createElement('button');
      btn.className = 'bbtn';
      btn.dataset.key = key;
      btn.innerHTML = `
        <kbd>${i + 1}</kbd>
        <svg viewBox="0 0 64 64"><use href="assets/sprites.svg#${def.sprite}"/></svg>
        <span class="nm">${def.name}</span>
        <span class="cost">${def.cost}</span>
      `;
      btn.title = `${def.name} — ${def.desc || ''}`;
      btn.addEventListener('click', () => this.onBuildSelect?.(key));
      bar.appendChild(btn);
      this._buildButtons.set(key, btn);
    });

    this.elMin = this.root.querySelector('#res-min .val');
    this.elMinSub = this.root.querySelector('#res-min .sub');
    this.elPow = this.root.querySelector('#res-pow .val');
    this.elPowSub = this.root.querySelector('#res-pow .sub');
    this.elFps = this.root.querySelector('#stat-fps .sub');
    this.elWarn = this.root.querySelector('#warn');
    // Delegated, because the warning markup is rebuilt whenever its text changes.
    this.elWarn.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="locate-isolated"]')) this.onLocateIsolated?.();
    });
    this.elInspect = this.root.querySelector('#inspect');

    this.elRecycle = this.root.querySelector('#recycle');
    this.elRecycle.addEventListener('click', () => this.onToggleRecycle?.());
    this.root.querySelector('#recycle-dead')
      .addEventListener('click', () => this.onRecycleDead?.());

    // Play speed. 0.5x is genuinely useful during a heavy wave, and the faster
    // steps let you skip the quiet stretches of a build window.
    this._speedBtns = new Map();
    const speeds = this.root.querySelector('#speeds');
    for (const m of [0.5, 1, 2, 3]) {
      const b = document.createElement('button');
      b.className = 'spd';
      b.textContent = `${m}x`;
      b.addEventListener('click', () => this.onSetSpeed?.(m));
      speeds.appendChild(b);
      this._speedBtns.set(m, b);
    }

    this.elObj = this.root.querySelector('#objective');
    this.elObjL = this.root.querySelector('.ob-l');
    this.elObjV = this.root.querySelector('.ob-v');
    this.elObjBar = this.root.querySelector('.ob-bar i');

    this.elWave = this.root.querySelector('#wave');
    this.elWaveN = this.root.querySelector('.wv-n');
    this.elWaveT = this.root.querySelector('.wv-t');
    this.elWaveComp = this.root.querySelector('.wv-comp');
    this.elCall = this.root.querySelector('#callwave');
    this.elCall.addEventListener('click', () => this.onCallWave?.());
    this.root.querySelector('#menubtn').addEventListener('click', () => this.onMenu?.());
  }

  _updateObjective(mode) {
    if (!mode) return;
    const o = mode.objective();
    this.elObjL.textContent = o.label;
    this.elObjV.textContent = o.value;
    this.elObjBar.style.width = `${Math.round(o.progress * 100)}%`;
    this.elObj.classList.toggle('warn', !!o.warn);
  }

  _updateWave() {
    const w = this.world.waves;
    if (!w) return;
    const building = w.state === 'building';

    this.elWave.classList.toggle('active', !building);
    this.elWaveN.textContent = building
      ? `Wave ${w.nextWaveNumber}`
      : `Wave ${w.waveIndex}`;
    this.elWaveT.textContent = building
      ? w.frozen ? 'on hold' : `in ${Math.ceil(w.timer)}s`
      : `${this.world.enemies.length} hostile${this.world.enemies.length === 1 ? '' : 's'}`;

    // Composition is shown up front so preparing is informed, not guesswork.
    if (building) {
      const comp = w.nextComposition;
      this.elWaveComp.innerHTML = comp
        .map(({ type, count }) => {
          const def = this.data.enemies[type];
          if (!def) return '';
          return `<span class="ce" title="${def.name}">
            <svg viewBox="0 0 64 64"><use href="assets/sprites.svg#${def.sprite}"/></svg>
            <b>${count}</b></span>`;
        })
        .join('');
      this.elCall.style.display = '';
    } else {
      this.elWaveComp.innerHTML = '';
      this.elCall.style.display = 'none';
    }
  }

  /**
   * Debug panel for sandbox mode: an enemy spawner plus world switches.
   * Built once; `_updateSandbox` only flips classes and labels per frame.
   */
  buildSandbox(h) {
    const el = document.createElement('div');
    el.className = 'sandbox';
    const enemies = Object.entries(this.data.enemies ?? {});
    el.innerHTML = `
      <div class="sb-t" title="Collapse / expand">Sandbox <span>debug</span><i>–</i></div>
      <div class="sb-l">Spawn enemy <em>click map · shift = keep</em></div>
      <div class="sb-grid">
        ${enemies.map(([key, def]) => `
          <button class="sb-en" data-spawn="${key}" title="${def.name} — ${def.desc || ''}">
            <svg viewBox="0 0 64 64"><use href="assets/sprites.svg#${def.sprite}"/></svg>
            <span>${def.name}</span>
          </button>`).join('')}
      </div>
      <div class="sb-cnt">
        <span class="sb-l">Count</span>
        ${[1, 5, 10, 25].map((n) => `<button class="spd" data-count="${n}">×${n}</button>`).join('')}
      </div>
      <div class="sb-l">World</div>
      <div class="sb-acts">
        <button class="tgl" data-act="call">Call next wave</button>
        <button class="tgl" data-act="timer"></button>
        <button class="tgl" data-act="power"></button>
        <button class="tgl" data-act="clear">Clear enemies</button>
        <button class="tgl" data-act="repair">Repair all</button>
      </div>`;
    this.root.appendChild(el);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.sb-t')) {
        const min = el.classList.toggle('min');
        el.querySelector('.sb-t i').textContent = min ? '+' : '–';
        return;
      }
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.spawn) h.onSpawnSelect?.(b.dataset.spawn);
      else if (b.dataset.count) h.onSpawnCount?.(+b.dataset.count);
      else ({
        call: h.onCallWave, timer: h.onToggleWaveTimer, power: h.onTogglePower,
        clear: h.onClearEnemies, repair: h.onRepairAll,
      })[b.dataset.act]?.();
    });

    this._sb = {
      spawn: [...el.querySelectorAll('[data-spawn]')],
      count: [...el.querySelectorAll('[data-count]')],
      timer: el.querySelector('[data-act="timer"]'),
      power: el.querySelector('[data-act="power"]'),
    };
  }

  _updateSandbox(game) {
    const sb = this._sb;
    for (const b of sb.spawn) b.classList.toggle('active', b.dataset.spawn === game.spawnKey);
    for (const b of sb.count) b.classList.toggle('on', +b.dataset.count === game.spawnCount);
    const held = this.world.waves.frozen;
    sb.timer.textContent = held ? 'Wave timer: held' : 'Wave timer: running';
    sb.timer.classList.toggle('on', held);
    const inf = this.world.grid.unlimited;
    sb.power.textContent = inf ? 'Power: unlimited' : 'Power: normal';
    sb.power.classList.toggle('on', inf);
  }

  setActiveBuild(key) {
    for (const [k, btn] of this._buildButtons) {
      btn.classList.toggle('active', k === key);
    }
  }

  update(game) {
    const w = this.world;
    const eco = w.economy;

    this.elMin.textContent = eco.infinite ? '∞' : `${Math.floor(eco.minerals)}`;
    this.elMinSub.textContent = `+${eco.incomePerSec.toFixed(1)}/s`;

    const g = w.grid;
    this.elPow.textContent = `${Math.round(g.supply)} / ${Math.round(g.demand)}`;
    // Batteries cover a deficit before the ratio drops, so show the buffer:
    // that is the difference between "fine" and "about to slow down".
    const bat = g.storedEnergy;
    this.elPowSub.textContent = g.unlimited ? 'unlimited' : g.overdrawn
      ? `${Math.round(g.ratio * 100)}%`
      : bat.cap > 0
        ? `bat ${Math.round((bat.stored / bat.cap) * 100)}%`
        : 'ok';
    this.elPowSub.classList.toggle('bad', g.overdrawn || (bat.cap > 0 && bat.stored / bat.cap < 0.2));

    this.elFps.textContent = `${game.loop.fps} fps`;
    this.elRecycle.classList.toggle('on', !!game.sellMode);
    for (const [m, b] of this._speedBtns) b.classList.toggle('on', game.speed === m);
    this._updateWave();
    this._updateObjective(game.mode);
    if (this._sb) this._updateSandbox(game);

    // Affordability feedback on the build bar.
    for (const [k, btn] of this._buildButtons) {
      const def = this.data.buildings[k];
      btn.classList.toggle('poor', !eco.canAfford(def.cost ?? 0));
    }

    const warnings = [];
    // Two different problems that used to look identical. An island with no
    // generator is not "overdrawn" — it is cut off, and the fix is a relay, not
    // a solar. They are also counted together rather than listed one per island,
    // because a scattered base produced a wall of near-identical warnings.
    let stranded = 0;
    for (const isle of g.islands) {
      if (!isle.hasSource) {
        stranded += isle.order.length;
        continue;
      }
      if (!isle.overdrawn) continue;
      warnings.push(g.islands.length > 1
        ? `Grid #${isle.id + 1} is overdrawn (${Math.round(isle.ratio * 100)}%) — add a Solar Station to it.`
        : 'Power overdrawn — everything is running slow. Build a Solar Station.');
    }
    if (stranded > 0) {
      // Clickable: a stranded relay at the edge of a big base is otherwise a
      // hunt across the whole map.
      warnings.push({
        act: 'locate-isolated',
        text: stranded === 1
          ? 'One structure is isolated — link it to your grid with a relay.'
          : `${stranded} structures are isolated — link them to your grid with relays.`,
      });
    }
    const txt = warnings.map((w) => w.text ?? w).join('|');
    if (txt !== this._warnText) {
      this._warnText = txt;
      this.elWarn.innerHTML = warnings.map((w) => w.act
        ? `<div class="w link" data-act="${w.act}" title="Show me">${w.text} <u>Show</u></div>`
        : `<div class="w">${w}</div>`).join('');
    }

    this._renderInspect(game.selected, game);
  }

  /**
   * Row definitions for the inspect panel.
   *
   * Each row carries a getter rather than a baked string, so the panel's DOM can
   * be built once per selection and then refreshed in place. Rebuilding the
   * markup every frame destroys and recreates the buttons ~60x/second, which
   * means a mousedown and its mouseup land on different elements and the click
   * never fires — that is exactly why the Sell button used to do nothing.
   */
  _rowSpecs(s) {
    if (s.maxOre !== undefined) {
      return [
        { label: 'Ore left', get: () => `${Math.ceil(s.ore)} / ${s.maxOre}` },
        { label: 'Remaining', get: () => `${s.percentLeft}%` },
        { label: 'Miners', get: () => `${s.minersInRange}` },
        { label: 'Status', get: () => s.depleted ? 'depleted'
            : s.percentLeft < 25 ? 'running dry' : 'workable' },
      ];
    }

    const rows = [{ label: 'Hull', get: () => `${Math.ceil(s.hp)} / ${s.maxHp}` }];
    if (s.powerDraw) rows.push({ label: 'Draw', get: () => s.currentDraw.toFixed(1) });
    if (s.powerOutput) rows.push({ label: 'Output', get: () => (s.currentOutput ?? 0).toFixed(1) });
    if (s.range) rows.push({ label: 'Range', get: () => `${s.range}` });
    if (s.key === 'miner') {
      rows.push({ label: 'Yield', get: () => `${s.yieldRate.toFixed(1)}/s` });
      rows.push({ label: 'Rocks', get: () => `${s.targets?.length ?? 0}` });
    }
    if (s.ammoCost) rows.push({ label: 'Per shot', get: () => `${s.ammoCost} min` });
    if (s.key === 'pulser') {
      // Built once per selection, so these must read sensibly before and after
      // the Aegis path switches the turret from shooting ships to missiles.
      rows.push({ label: 'Rate', get: () => s.intercept
        ? `1 per ${s.interval.toFixed(1)}s`
        : `${s.fireRate.toFixed(1)}/s` });
      rows.push({ label: 'Intercepts', get: () => s.intercept ? `${s.intercepts}` : '—' });
    }
    if (s.key === 'battery') {
      rows.push({ label: 'Charge', get: () => `${Math.round(s.stored)} / ${s.capacity}` });
      rows.push({ label: 'Flow', get: () => s._discharging ? `-${s._discharging.toFixed(1)}`
        : s._charging ? `+${s._charging.toFixed(1)}` : 'idle' });
    }
    if (s.key === 'repair') {
      rows.push({ label: 'Drones', get: () => `${s.bots.length} / ${s.botCount}` });
      rows.push({ label: 'Deployed', get: () => `${s.deployed}` });
      rows.push({ label: 'Charging', get: () => `${s.bots.filter((b) => b.charging).length}` });
      rows.push({ label: 'Rebuilding', get: () => `${s.rebuildQueue.length}` });
    }
    if (s.upgrades?.length || s.upgradePaths) {
      rows.push({ label: 'Level', get: () => `${s.level} / ${s.maxLevel}` });
    }
    if (s.upgradePaths) {
      rows.push({ label: 'Path', get: () => s.pathName || 'open' });
    }
    rows.push({ label: 'Links', get: () => `${s.links.size} / ${s.maxLinks}` });
    rows.push({ label: 'Grid', get: () => s.gridId != null ? `#${s.gridId + 1}` : '—' });
    rows.push({
      label: 'Status',
      get: () => !s.isBuilt ? 'building'
        : s.upgrading ? `upgrading ${Math.round(s.upgradeProgress * 100)}%`
        : s.disabled ? 'disabled'
        : !s.connected ? 'no power'
        : s.starved ? 'no minerals'
        : s.recharging ? 'recharging'
        : 'online',
    });
    return rows;
  }

  _buildInspect(s) {
    const isAsteroid = s.maxOre !== undefined;
    this._specs = this._rowSpecs(s);

    const head = isAsteroid
      ? { name: 'Asteroid', desc: 'Mineable rock. Depletes as it is worked.' }
      : { name: s.name, desc: s.def.desc || '' };

    this.elInspect.innerHTML = `
      <div class="ins-head">
        <svg viewBox="0 0 64 64"><use href="assets/sprites.svg#${s.sprite}"/></svg>
        <div>
          <div class="nm">${head.name}</div>
          <div class="dsc">${head.desc}</div>
        </div>
      </div>
      ${isAsteroid ? '<div class="ore-bar"><i></i></div>' : ''}
      <div class="ins-rows">
        ${this._specs.map((r) => `<div><span>${r.label}</span><b></b></div>`).join('')}
      </div>
      ${!isAsteroid && (s.upgrades?.length || s.upgradePaths)
        ? '<div class="upg-list"></div>' : ''}
      ${!isAsteroid && s.isLauncher ? `
        <div class="ins-btns">
          <button class="tgl" data-act="one"></button>
          <button class="tgl" data-act="all"></button>
        </div>` : ''}
      ${!isAsteroid ? '<button class="sell" data-act="sell"></button>' : ''}
    `;

    this._valueEls = [...this.elInspect.querySelectorAll('.ins-rows b')];
    this._oreBar = this.elInspect.querySelector('.ore-bar i');
    this._sellBtn = this.elInspect.querySelector('[data-act="sell"]');
    this._oneBtn = this.elInspect.querySelector('[data-act="one"]');
    this._allBtn = this.elInspect.querySelector('[data-act="all"]');
    this._upgList = this.elInspect.querySelector('.upg-list');
    this._upgSig = null;

    // Attached once, so the elements survive long enough to receive a click.
    this._sellBtn?.addEventListener('click', () => this.onSell?.(s));
    this._oneBtn?.addEventListener('click', () => this.onToggleDisabled?.(s));
    this._allBtn?.addEventListener('click', () => this.onToggleAllLaunchers?.());
  }

  _refreshInspect(s, game) {
    for (let i = 0; i < this._specs.length; i++) {
      const txt = this._specs[i].get();
      if (this._valueEls[i].textContent !== txt) this._valueEls[i].textContent = txt;
    }
    if (this._oreBar) this._oreBar.style.width = `${s.percentLeft}%`;
    if (this._sellBtn) this._sellBtn.innerHTML = `Sell &nbsp;+${s.refundValue()}`;
    if (this._oneBtn) {
      this._oneBtn.textContent = s.disabled ? 'Enable this' : 'Disable this';
      this._oneBtn.classList.toggle('on', !!s.disabled);
    }
    if (this._allBtn) {
      const all = game?.launchersDisabled;
      this._allBtn.textContent = all ? 'Enable all' : 'Disable all';
      this._allBtn.classList.toggle('on', !!all);
    }
    if (this._upgList) this._refreshUpgrades(s);
  }

  /**
   * Upgrade buttons.
   *
   * The set of options changes shape as a structure commits to a branch (two
   * choices, then one), so the markup is rebuilt only when that shape actually
   * changes — rebuilding every frame would destroy the buttons between mousedown
   * and mouseup and swallow the click.
   */
  _refreshUpgrades(s) {
    const eco = this.world.economy;
    const opts = s.upgrading ? [] : s.upgradeOptions;
    const sig = [s.upgrading, s.level, s.upgradePath, opts.map((o) => o.pathKey).join(',')].join('|');

    if (sig !== this._upgSig) {
      this._upgSig = sig;
      if (s.upgrading) {
        // Stays clickable: a solar generates nothing mid-upgrade, so cancelling
        // must remain available or a single-generator island can stall for good.
        this._upgList.innerHTML =
          '<button class="upg busy" data-i="cancel"><span>Cancel upgrade</span><b></b></button>';
      } else if (!opts.length) {
        this._upgList.innerHTML = '<button class="upg" disabled><span>Fully upgraded</span></button>';
      } else {
        this._upgList.innerHTML = opts.map((o, i) => `
          <button class="upg" data-i="${i}" title="${o.tier.desc || ''}">
            <span>${o.pathName ? `<em>${o.pathName}</em> ` : ''}${o.tier.name}</span>
            <b>${o.tier.cost}</b>
          </button>`).join('');
      }
      // Rebound once per shape change, so the elements outlive a click.
      for (const btn of this._upgList.querySelectorAll('button[data-i]')) {
        const key = btn.dataset.i;
        btn.addEventListener('click', () => {
          if (key === 'cancel') this.onUpgrade?.(s, null);
          else this.onUpgrade?.(s, opts[+key]?.pathKey ?? null);
        });
      }
    }

    if (s.upgrading) {
      const b = this._upgList.querySelector('b');
      if (b) b.textContent = `${Math.round(s.upgradeProgress * 100)}%`;
      return;
    }
    // Affordability can change every frame; that is just an attribute flip.
    this._upgList.querySelectorAll('button[data-i]').forEach((btn, i) => {
      btn.disabled = !eco.canAfford(opts[i]?.tier.cost ?? 0);
    });
  }

  _renderInspect(s, game) {
    if (!s || !s.alive) {
      if (this._inspectFor) {
        this.elInspect.innerHTML = '';
        this.elInspect.classList.remove('on');
        this._inspectFor = null;
      }
      return;
    }
    if (s !== this._inspectFor) {
      this._buildInspect(s);
      this._inspectFor = s;
      this.elInspect.classList.add('on');
    }
    this._refreshInspect(s, game);
  }
}
