/**
 * localStorage persistence: settings, high scores, how far each heroine got
 * on each difficulty (practice unlocks), card capture history, endings and
 * the music room. Every access is wrapped in try/catch: storage throws in
 * private windows or when full, and a score is never worth a crash.
 */
const KEY = 'yorunohana.v1';

export const DEFAULT_SETTINGS = {
  master: 0.8,
  music: 0.7,
  sfx: 0.6,
  startLives: 3,
  shake: true,
  bgDetail: 'high',
  hitbox: 'focus',
  renderScale: 1,
  touchSensitivity: 1.2,
};

function blank() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    scores: {},
    reached: {},
    cards: {},
    endings: {},
    music: {},
    name: '',
  };
}

export class Save {
  constructor() {
    this.data = this._read();
  }

  _read() {
    try {
      const raw = localStorage.getItem(KEY);
      const d = blank();
      if (!raw) return d;
      const p = JSON.parse(raw);
      for (const k of Object.keys(d)) if (p[k] !== undefined) d[k] = p[k];
      d.settings = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
      return d;
    } catch {
      return blank();
    }
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  get settings() {
    return this.data.settings;
  }

  set(key, value) {
    this.data.settings[key] = value;
    this.write();
  }

  // --------------------------------------------------------------- scores --
  scoreKey(char, diff) {
    return char + '/' + diff;
  }

  scores(char, diff) {
    return this.data.scores[this.scoreKey(char, diff)] || [];
  }

  /** 0-based rank the score would take in the top 10, or -1. */
  rankFor(char, diff, score) {
    const l = this.scores(char, diff);
    let i = 0;
    while (i < l.length && l[i].score >= score) i++;
    return i < 10 ? i : -1;
  }

  addScore(char, diff, entry) {
    const k = this.scoreKey(char, diff);
    const l = (this.data.scores[k] || []).slice();
    l.push(entry);
    l.sort((a, b) => b.score - a.score);
    this.data.scores[k] = l.slice(0, 10);
    this.write();
  }

  hiScore(char, diff) {
    const l = this.scores(char, diff);
    return l.length ? l[0].score : 0;
  }

  // ------------------------------------------------------------- progress --
  reached(char, diff) {
    return this.data.reached[this.scoreKey(char, diff)] || 1;
  }

  setReached(char, diff, stage) {
    const k = this.scoreKey(char, diff);
    if ((this.data.reached[k] || 1) < stage) {
      this.data.reached[k] = stage;
      this.write();
    }
  }

  /** card id -> {seen:bool, "char/diff": [captures, attempts]} */
  cardStat(id, char, diff) {
    const c = this.data.cards[id];
    return (c && c[this.scoreKey(char, diff)]) || [0, 0];
  }

  cardSeen(id) {
    return !!this.data.cards[id];
  }

  recordCard(id, char, diff, captured) {
    const c = this.data.cards[id] || (this.data.cards[id] = {});
    const k = this.scoreKey(char, diff);
    const s = c[k] || [0, 0];
    s[1]++;
    if (captured) s[0]++;
    c[k] = s;
    this.write();
  }

  markEnding(char, kind) {
    this.data.endings[char + '/' + kind] = true;
    this.write();
  }

  hearSong(id) {
    if (!this.data.music[id]) {
      this.data.music[id] = true;
      this.write();
    }
  }

  reset() {
    const s = this.data.settings;
    this.data = blank();
    this.data.settings = s;
    this.write();
  }
}
