/**
 * Base class for a game mode.
 *
 * A mode owns win/lose conditions and the objective readout, and nothing else.
 * The world does not know which mode it is running under — it only reports that
 * the hub was lost — so modes stay swappable and easy to add.
 */
export class Mode {
  /**
   * @param {import('../../world/World.js').World} world
   * @param {object} cfg entry from entities.json → modes
   */
  constructor(world, cfg = {}) {
    this.world = world;
    this.cfg = cfg;
    this.state = 'playing'; // 'playing' | 'won' | 'lost'
    this.elapsed = 0;
    this.reason = '';
    // Creative tools were switched on from the Esc menu: the run plays on but
    // no longer records a personal best.
    this.creative = false;
  }

  get finished() {
    return this.state !== 'playing';
  }

  /** Where this run's personal best is kept. Difficulties keep their own. */
  get recordKey() {
    return this.key;
  }

  update(dt) {
    if (this.finished) return;
    this.elapsed += dt;
    // Every mode ends when nothing is left standing; subclasses add their own
    // conditions on top.
    if (this.world.gameOver) this.lose('All structures destroyed');
  }

  win(reason) {
    if (this.finished) return;
    this.state = 'won';
    this.reason = reason;
  }

  lose(reason) {
    if (this.finished) return;
    this.state = 'lost';
    this.reason = reason;
  }

  /**
   * HUD objective readout.
   * @returns {{label:string, value:string, progress:number, warn:boolean}}
   */
  objective() {
    return { label: '', value: '', progress: 0, warn: false };
  }

  /** Rows shown on the end-of-run overlay. */
  summary() {
    return [];
  }

  /** Value stored as this mode's personal best, or null to skip. */
  score() {
    return null;
  }
}

/** mm:ss for the HUD and summaries. */
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
