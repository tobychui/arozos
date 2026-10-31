/**
 * localStorage persistence for personal bests and preferences.
 *
 * Everything is wrapped in try/catch: localStorage throws in private-browsing
 * modes and when quota is exhausted, and a saved score is never important
 * enough to take the game down with it.
 */
const KEY = 'orbitalclaim.v1';

export class SaveGame {
  constructor() {
    this.data = this._read();
  }

  _read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { bests: {}, prefs: {} };
      const parsed = JSON.parse(raw);
      return {
        bests: parsed.bests ?? {},
        prefs: parsed.prefs ?? {},
      };
    } catch {
      return { bests: {}, prefs: {} };
    }
  }

  _write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  bestFor(modeKey) {
    return this.data.bests[modeKey] ?? null;
  }

  /**
   * Record a score if it beats the stored one.
   * @param {string} modeKey
   * @param {{metric:string, value:number, higherIsBetter:boolean}} score
   * @returns {boolean} true when this run set a new best
   */
  recordScore(modeKey, score) {
    if (!score) return false;
    const prev = this.data.bests[modeKey];
    const better =
      !prev ||
      prev.metric !== score.metric ||
      (score.higherIsBetter ? score.value > prev.value : score.value < prev.value);

    if (!better) return false;
    this.data.bests[modeKey] = {
      metric: score.metric,
      value: score.value,
      at: Date.now(),
    };
    this._write();
    return true;
  }

  getPref(key, fallback) {
    return this.data.prefs[key] ?? fallback;
  }

  setPref(key, value) {
    this.data.prefs[key] = value;
    this._write();
  }

  clear() {
    this.data = { bests: {}, prefs: {} };
    this._write();
  }
}
