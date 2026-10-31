/**
 * Player preferences: audio, graphics and gameplay switches.
 *
 * Stored next to the personal bests through SaveGame, so a blocked or full
 * localStorage just means defaults for the session, never a crash. A change is
 * persisted and announced; the Game applies it to whichever system owns it,
 * so nothing below the Game needs to know preferences exist.
 */
export const DEFAULTS = {
  masterVolume: 0.8,
  combatVolume: 0.7,
  uiVolume: 0.8,
  muted: false,

  renderScale: 1,         // fraction of the device pixel ratio
  stars: 'dense',         // 'dense' | 'sparse' | 'off'
  effects: 'full',        // 'full' | 'reduced'
  links: 'animated',      // 'animated' | 'static' | 'hidden'
  showFps: true,
  showControls: true,

  pauseOnBlur: true,
  panSpeed: 1,
};

export class Settings {
  /** @param {import('./SaveGame.js').SaveGame} save */
  constructor(save) {
    this.save = save;
    this.values = { ...DEFAULTS };
    const stored = save.getPref('settings', null);
    // Only keep stored values of the expected type, so a hand-edited or older
    // save cannot feed a string into a volume.
    for (const key of Object.keys(DEFAULTS)) {
      if (stored && typeof stored[key] === typeof DEFAULTS[key]) this.values[key] = stored[key];
    }
    this._listeners = [];
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (!(key in DEFAULTS) || this.values[key] === value) return;
    this.values[key] = value;
    this.save.setPref('settings', { ...this.values });
    for (const fn of this._listeners) fn(key, value);
  }

  /** Put the given keys (or everything) back to their defaults. */
  reset(keys = Object.keys(DEFAULTS)) {
    for (const key of keys) this.set(key, DEFAULTS[key]);
  }

  onChange(fn) {
    this._listeners.push(fn);
  }
}
