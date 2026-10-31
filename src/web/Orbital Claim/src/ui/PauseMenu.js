import { formatTime } from '../systems/modes/Mode.js';

/** 24x24 stroke icons, drawn here rather than borrowed from an icon font. */
const ICONS = {
  resume: 'M8 5.5v13l10.5-6.5z',
  audio: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z M15.5 9a4.5 4.5 0 0 1 0 6 M18 6.5a8 8 0 0 1 0 11',
  graphics: 'M3.5 5h17v11h-17z M9 20h6 M12 16v4',
  gameplay: 'M4 7h9 M17 7h3 M15 4.8v4.4 M4 17h3 M11 17h9 M9 14.8v4.4',
  creative: 'M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z M4.5 7.7L12 12l7.5-4.3 M12 12v8.5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.4 9.2a2.7 2.7 0 1 1 3.3 2.6c-.5.15-.7.5-.7 1v.6 M12 16.4v.4',
  restart: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4.5v4h4',
  title: 'M4 11l8-6.5 8 6.5 M6.5 9.5V19h11V9.5 M10 19v-5h4v5',
  exit: 'M13.5 4.5h-7v15h7 M10.5 12H20 M16.5 8.5L20 12l-3.5 3.5',
  back: 'M14.5 6l-6 6 6 6',
  next: 'M9.5 6l6 6-6 6',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => (v <= 0 ? 'Off' : `${Math.round(v * 100)}%`);

/**
 * The Esc menu.
 *
 * One card that swaps between pages — the menu itself, Audio, Graphics,
 * Gameplay, the sandbox rules and a confirmation step — rather than stacked
 * dialogs, so Esc always means one step back: a page returns to the menu and
 * the menu resumes the game.
 *
 * Settings rows are data: each has a getter and a setter, and a page's markup
 * is rebuilt from its rows when it is shown. The same row type therefore works
 * for a saved preference and for live world state such as the sandbox
 * switches, and the menu never holds a copy of a value that could go stale.
 *
 * Opened from the title screen there is no run to pause, so it offers only the
 * settings pages.
 */
export class PauseMenu {
  /**
   * @param {HTMLElement} root the #pause overlay
   * @param {import('../Game.js').Game} game
   */
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.isOpen = false;
    this.page = 'main';
    this._specs = [];
    this._confirm = null;
    this._status = '';

    root.innerHTML = '<div class="pm-card" role="dialog" aria-modal="true" aria-labelledby="pm-title"></div>';
    this.card = root.querySelector('.pm-card');

    this.help = document.createElement('div');
    this.help.id = 'pm-help';
    this.help.innerHTML = `
      <div class="pm-help-bar">
        <button class="pm-btn" data-act="help-close">${icon('back')} Back to menu</button>
        <span>How to play</span>
      </div>`;
    document.body.appendChild(this.help);
    this.help.querySelector('button').addEventListener('click', () => this.closeHelp());

    // The guide lives in its own page; opened from here it reports Esc and its
    // footer link back over postMessage instead of navigating the frame.
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== this._frame?.contentWindow) return;
      if (e.data?.type === 'orbitalclaim:close-help') this.closeHelp();
    });

    this._bind();
  }

  // ------------------------------------------------------------ open/close

  open() {
    if (this.isOpen) return;
    const g = this.game;
    this.isOpen = true;
    this.inRun = g.inRun;
    if (this.inRun) {
      g.loop.setPaused(true);
      document.body.classList.add('paused');
      g.sound.setHum(0);
    }
    // Keeps Tab inside the menu rather than wandering onto the HUD behind it.
    document.getElementById('hud').inert = true;
    document.getElementById('menu').inert = true;
    this.root.classList.add('show');
    this._status = '';
    this.show('main');
    g.sound.play('open');
  }

  /** @param {{resume?:boolean}} [opt] resume=false leaves the game paused */
  close({ resume = true } = {}) {
    if (!this.isOpen) return;
    this.closeHelp(false);
    this.isOpen = false;
    this.root.classList.remove('show');
    document.getElementById('hud').inert = false;
    document.getElementById('menu').inert = false;
    if (resume && this.inRun && this.game.inRun) {
      this.game.loop.setPaused(false);
      document.body.classList.remove('paused');
    }
    this.game.sound.play('close');
  }

  /** Esc: one step back. */
  back() {
    if (this.help.classList.contains('show')) this.closeHelp();
    else if (this.page === 'confirm') this.show(this._confirm.from);
    else if (this.page !== 'main') this.show('main');
    else this.close();
  }

  show(page) {
    this.page = page;
    this._render();
    const first = this.card.querySelector(page === 'confirm' ? '[data-act="cancel"]'
      : '[data-act="resume"], [data-act="close"], [data-i], button');
    first?.focus({ preventScroll: true });
    this.card.scrollTop = 0;
  }

  /** Ask before something that loses the run, then come back to `from`. */
  confirm(opts) {
    this._confirm = { from: this.page, ...opts };
    this.show('confirm');
  }

  openHelp() {
    if (!this._frame) {
      this._frame = document.createElement('iframe');
      this._frame.title = 'How to play';
      this._frame.src = 'tutorial.html?embedded=1';
      this.help.appendChild(this._frame);
    }
    this.help.classList.add('show');
    this._frame.focus();
  }

  closeHelp(refocus = true) {
    if (!this.help.classList.contains('show')) return;
    this.help.classList.remove('show');
    if (refocus) this.card.querySelector('[data-act="help"]')?.focus();
  }

  // ----------------------------------------------------------------- pages

  _render() {
    this._specs = [];
    const p = this.page;
    this.card.innerHTML = p === 'main' ? this._mainHtml()
      : p === 'confirm' ? this._confirmHtml()
      : this._pageHtml(p);
  }

  /** Re-render the current page, keeping keyboard focus where it was. */
  _rerender() {
    const a = document.activeElement;
    let sel = null;
    if (a && this.card.contains(a)) {
      const host = a.closest('[data-i]');
      if (a.dataset.o != null && host) {
        sel = host === a ? `[data-i="${a.dataset.i}"][data-o="${a.dataset.o}"]`
          : `[data-i="${host.dataset.i}"] [data-o="${a.dataset.o}"]`;
      } else if (a.dataset.i != null) sel = `[data-i="${a.dataset.i}"]`;
      else if (a.dataset.act) sel = `[data-act="${a.dataset.act}"]`;
      else if (a.dataset.go) sel = `[data-go="${a.dataset.go}"]`;
    }
    this._render();
    if (sel) this.card.querySelector(sel)?.focus({ preventScroll: true });
  }

  _mainHtml() {
    const g = this.game;
    const exit = this._canExit()
      ? `<button class="pm-btn span2 ghost" data-act="exit">${icon('exit')} Exit game</button>` : '';

    if (!this.inRun) {
      return `
        <div class="pm-head"><h2 id="pm-title">Settings</h2></div>
        <div class="pm-grid">
          ${this._navBtn('audio', 'Audio')}
          ${this._navBtn('graphics', 'Graphics')}
          ${this._navBtn('gameplay', 'Gameplay', 'span2')}
          <div class="pm-sep"></div>
          <button class="pm-btn primary span2" data-act="close">Done</button>
          ${exit}
        </div>`;
    }

    const w = g.world;
    const mode = g.mode;
    const sub = [g.modeName];
    if (mode.creative) sub.push('creative tools on');
    if (mode.remaining !== undefined) sub.push(`${formatTime(mode.remaining)} left`);
    const stats = [
      ['Time', formatTime(mode.elapsed)],
      ['Wave', w.waves.waveIndex || '–'],
      ['Kills', w.kills],
      ['Structures', w.liveStructures.length],
    ];
    if (mode.target !== undefined) {
      stats.push(['Mined', `${Math.floor(w.economy.totalMined)} / ${mode.target}`]);
    }

    return `
      <div class="pm-head">
        <h2 id="pm-title">Paused</h2>
        <p class="pm-sub">${esc(sub.join(' · '))}</p>
        <div class="pm-stats">
          ${stats.map(([k, v]) => `<span>${k}<b>${esc(v)}</b></span>`).join('')}
        </div>
      </div>
      <div class="pm-grid">
        <button class="pm-btn primary span2" data-act="resume">${icon('resume')} Resume</button>
        ${this._navBtn('audio', 'Audio')}
        ${this._navBtn('graphics', 'Graphics')}
        ${this._navBtn('gameplay', 'Gameplay')}
        ${this._navBtn('creative', mode.isSandbox ? 'Sandbox rules' : 'Creative tools')}
        <button class="pm-btn" data-act="help">${icon('help')} How to play</button>
        <button class="pm-btn" data-act="restart">${icon('restart')} Restart run</button>
        <div class="pm-sep"></div>
        <button class="pm-btn span2" data-act="title">${icon('title')} Quit to title</button>
        ${exit}
      </div>
      <p class="pm-keys"><kbd>Esc</kbd> resume</p>`;
  }

  _navBtn(page, label, cls = '') {
    return `<button class="pm-btn ${cls}" data-go="${page}">${icon(page)} ${label}
      <i class="chev">${icon('next')}</i></button>`;
  }

  _confirmHtml() {
    const c = this._confirm;
    return `
      <div class="pm-head">
        <h2 id="pm-title">${esc(c.title)}</h2>
        <p class="pm-sub pm-msg">${esc(c.text)}</p>
      </div>
      <div class="pm-foot">
        <button class="pm-btn ghost" data-act="cancel">Cancel</button>
        <button class="pm-btn ${c.danger ? 'danger' : 'primary'}" data-act="ok">${esc(c.ok)}</button>
      </div>`;
  }

  _pageHtml(page) {
    const def = this._pageDef(page);
    this._specs = def.rows.filter((r) => !r.inRun || this.inRun);
    const rows = this._specs.map((r, i) => this._rowHtml(r, i)).join('');
    return `
      <div class="pm-head">
        <h2 id="pm-title">${esc(def.title)}</h2>
        ${def.sub ? `<p class="pm-sub">${esc(def.sub)}</p>` : ''}
      </div>
      <div class="pm-rows">${rows}</div>
      ${this._status ? `<p class="pm-status" role="status">${esc(this._status)}</p>` : ''}
      <div class="pm-foot">
        ${def.defaults ? '<button class="pm-btn ghost" data-act="defaults">Restore defaults</button>' : ''}
        <button class="pm-btn primary" data-act="back">${icon('back')} Done</button>
      </div>`;
  }

  _rowHtml(r, i) {
    const label = `<span class="lb" id="pm-l${i}"><b>${esc(r.label ?? '')}</b>${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span>`;
    switch (r.type) {
      case 'section':
        return `<div class="pm-sec">${esc(r.label)}</div>`;
      case 'note':
        return `<p class="pm-note">${esc(r.text)}</p>`;
      case 'range': {
        const v = r.get();
        return `<label class="pm-row">${label}<span class="pm-range">
          <input type="range" data-i="${i}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"
                 aria-labelledby="pm-l${i}"><output>${esc(r.fmt(v))}</output></span></label>`;
      }
      case 'switch': {
        const on = !!r.get();
        return `<button class="pm-row pm-toggle" role="switch" aria-checked="${on}" data-i="${i}"
                  aria-labelledby="pm-l${i}">${label}<span class="pm-switch"></span></button>`;
      }
      case 'seg': {
        const cur = r.get();
        return `<div class="pm-row">${label}
          <span class="pm-seg" role="radiogroup" aria-labelledby="pm-l${i}" data-i="${i}">
            ${r.options.map(([v, text], o) => `<button role="radio" data-o="${o}"
              aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}">${esc(text)}</button>`).join('')}
          </span></div>`;
      }
      case 'actions':
        return `<div class="pm-acts">${r.items.map((a, o) => `
          <button class="pm-btn small ${a.danger ? 'danger' : ''}" data-i="${i}" data-o="${o}"
            ${a.disabled?.() ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}</div>`;
      default:
        return '';
    }
  }

  /** Rows for each settings page. */
  _pageDef(page) {
    const g = this.game;
    const s = g.settings;
    const pref = (key) => ({ get: () => s.get(key), set: (v) => s.set(key, v) });

    if (page === 'audio') {
      return {
        title: 'Audio',
        defaults: ['masterVolume', 'combatVolume', 'uiVolume', 'muted'],
        rows: [
          { type: 'range', label: 'Master volume', min: 0, max: 1, step: 0.05, fmt: pct,
            preview: 'confirm', ...pref('masterVolume') },
          { type: 'range', label: 'Combat & world', hint: 'Weapons, explosions, construction',
            min: 0, max: 1, step: 0.05, fmt: pct, preview: 'kill', ...pref('combatVolume') },
          { type: 'range', label: 'Interface & alerts', hint: 'Buttons, wave sirens, warnings',
            min: 0, max: 1, step: 0.05, fmt: pct, preview: 'confirm', ...pref('uiVolume') },
          { type: 'switch', label: 'Mute all sound', hint: 'M toggles this during a run',
            ...pref('muted') },
        ],
      };
    }

    if (page === 'graphics') {
      return {
        title: 'Graphics',
        defaults: ['renderScale', 'stars', 'effects', 'links', 'showFps', 'showControls'],
        rows: [
          { type: 'range', label: 'Render resolution', hint: 'Lower is faster on large or high-DPI screens',
            min: 0.5, max: 1, step: 0.25, fmt: pct, ...pref('renderScale') },
          { type: 'seg', label: 'Starfield', options: [['dense', 'Dense'], ['sparse', 'Sparse'], ['off', 'Off']],
            ...pref('stars') },
          { type: 'seg', label: 'Effects', hint: 'Explosion debris and beam glow',
            options: [['full', 'Full'], ['reduced', 'Reduced']], ...pref('effects') },
          { type: 'seg', label: 'Power links', hint: 'G hides and shows them',
            options: [['animated', 'Animated'], ['static', 'Static'], ['hidden', 'Hidden']], ...pref('links') },
          { type: 'switch', label: 'Frame rate counter', ...pref('showFps') },
          { type: 'switch', label: 'Controls panel', hint: 'The key reference on the right', ...pref('showControls') },
        ],
      };
    }

    if (page === 'gameplay') {
      return {
        title: 'Gameplay',
        defaults: ['panSpeed', 'pauseOnBlur'],
        rows: [
          { type: 'seg', label: 'Game speed', hint: 'Applies when you resume', inRun: true,
            options: [[0.5, '0.5x'], [1, '1x'], [2, '2x'], [3, '3x']],
            get: () => g.speed, set: (v) => g.setSpeed(v, false) },
          { type: 'range', label: 'Keyboard pan speed', hint: 'WASD and the arrow keys',
            min: 0.5, max: 2, step: 0.25, fmt: (v) => `${v}x`, ...pref('panSpeed') },
          { type: 'switch', label: 'Pause when the window loses focus',
            hint: 'Opens this menu when you click away', ...pref('pauseOnBlur') },
        ],
      };
    }

    // page === 'creative'
    const mode = g.mode;
    if (!mode.isSandbox && !mode.creative) {
      return {
        title: 'Creative tools',
        rows: [
          { type: 'note', text: 'Creative tools give this run the sandbox switches and the enemy '
            + 'spawner: infinite minerals, instant building, unlimited power and more.' },
          { type: 'note', text: 'The run stops counting towards your personal best, even if you '
            + 'turn the switches off again afterwards.' },
          { type: 'actions', items: [{
            label: 'Turn on creative tools', danger: true,
            run: () => this.confirm({
              title: 'Turn on creative tools?',
              text: `This ${g.modeName} run will not record a personal best.`,
              ok: 'Turn on', danger: true,
              run: () => {
                g.enableCreative();
                this._status = 'Creative tools are on. The spawner panel is on the left.';
              },
            }),
          }] },
        ],
      };
    }

    const w = g.world;
    return {
      title: mode.isSandbox ? 'Sandbox rules' : 'Creative tools',
      sub: mode.isSandbox ? null : `${g.modeName} · no personal best for this run`,
      rows: [
        { type: 'switch', label: 'Infinite minerals',
          get: () => w.economy.infinite, set: (v) => { w.economy.infinite = v; }, rerender: true },
        { type: 'switch', label: 'Instant build', hint: 'Also finishes anything under construction',
          get: () => w.instantBuild, set: (v) => g.setInstantBuild(v) },
        { type: 'switch', label: 'Unlimited power',
          get: () => w.grid.unlimited, set: (v) => { w.grid.unlimited = v; } },
        { type: 'switch', label: 'Hold the wave timer', hint: 'Waves only come when called',
          get: () => w.waves.frozen, set: (v) => { w.waves.frozen = v; } },
        { type: 'switch', label: 'Invincible structures', hint: 'Enemy fire does no damage',
          get: () => w.invincible, set: (v) => w.setInvincible(v) },
        { type: 'section', label: 'Actions' },
        { type: 'actions', items: [
          { label: 'Call next wave', disabled: () => w.waves.state !== 'building',
            run: () => { w.waves.callWaveNow(); return `Wave ${w.waves.nextWaveNumber} launches when you resume.`; } },
          { label: 'Clear enemies', run: () => g.clearEnemies() },
          { label: 'Repair all', run: () => g.repairAll() },
          { label: '+1,000 minerals', disabled: () => w.economy.infinite,
            run: () => { w.economy.refund(1000); return `${Math.floor(w.economy.minerals)} minerals in the bank.`; } },
        ] },
      ],
    };
  }

  // ----------------------------------------------------------------- events

  _bind() {
    this.root.addEventListener('click', (e) => {
      const el = e.target.closest('button');
      if (!el || !this.card.contains(el) || el.disabled) return;
      if (el.dataset.go) {
        this._status = '';
        this.show(el.dataset.go);
        return;
      }
      if (el.dataset.act) {
        this._act(el.dataset.act);
        return;
      }
      const host = el.closest('[data-i]');
      const spec = host && this._specs[+host.dataset.i];
      if (!spec) return;

      if (spec.type === 'switch') {
        const on = !spec.get();
        spec.set(on);
        if (spec.rerender) this._rerender();
        else el.setAttribute('aria-checked', String(!!spec.get()));
      } else if (spec.type === 'seg') {
        spec.set(spec.options[+el.dataset.o][0]);
        const cur = spec.get();
        host.querySelectorAll('[data-o]').forEach((b) => {
          const on = spec.options[+b.dataset.o][0] === cur;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
        });
      } else if (spec.type === 'actions') {
        const msg = spec.items[+el.dataset.o].run();
        if (this.page !== 'confirm') {
          if (typeof msg === 'string') this._status = msg;
          this._rerender();
        }
      }
    });

    this.root.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches('input[type="range"][data-i]')) return;
      const spec = this._specs[+el.dataset.i];
      spec.set(+el.value);
      el.nextElementSibling.textContent = spec.fmt(+el.value);
    });

    // A sample on release, so a volume can be judged without leaving the menu.
    this.root.addEventListener('change', (e) => {
      const spec = e.target.matches('input[type="range"][data-i]') && this._specs[+e.target.dataset.i];
      if (spec?.preview) this.game.sound.play(spec.preview);
    });

    // Clicking the dimmed backdrop outside the card resumes, like Esc.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root && this.page === 'main') this.close();
    });
  }

  _act(act) {
    const g = this.game;
    switch (act) {
      case 'resume':
      case 'close':
        this.close();
        break;
      case 'back':
        this._status = '';
        this.show('main');
        break;
      case 'defaults':
        g.settings.reset(this._pageDef(this.page).defaults);
        this._rerender();
        break;
      case 'help':
        this.openHelp();
        break;
      case 'restart':
        this.confirm({
          title: 'Restart this run?', ok: 'Restart', danger: true,
          text: `A fresh ${g.modeName} run starts on a new map. Progress in this one is lost.`,
          run: () => g.start(g.mode.key),
        });
        break;
      case 'title':
        this.confirm({
          title: 'Quit to title?', ok: 'Quit', danger: true,
          text: 'This run ends here and does not record a personal best.',
          run: () => g.quitToTitle(),
        });
        break;
      case 'exit':
        this.confirm({
          title: 'Exit Orbital Claim?', ok: 'Exit', danger: true,
          text: this.inRun ? 'The window closes and this run is lost.' : 'The window closes.',
          run: () => window.ao_module_close(),
        });
        break;
      case 'cancel':
        this.show(this._confirm.from);
        break;
      case 'ok': {
        const c = this._confirm;
        c.run();
        // Restart and quit close the menu themselves; anything else returns.
        if (this.isOpen && this.page === 'confirm') this.show(c.from);
        break;
      }
      default:
        break;
    }
  }

  /** Only inside an ArozOS desktop window is there a window to close. */
  _canExit() {
    return !!window.ao_module_virtualDesktop && typeof window.ao_module_close === 'function';
  }
}
