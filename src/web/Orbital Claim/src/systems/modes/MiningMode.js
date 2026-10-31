import { Mode, formatTime } from './Mode.js';

/**
 * Mining race — bank a target amount of ore before the clock runs out.
 *
 * Counts *total extracted* rather than the current balance, so spending on
 * defence never sets you back. That matters: the mode would otherwise punish
 * you for the very thing it forces you to do, since waves still come.
 */
export class MiningMode extends Mode {
  constructor(world, cfg) {
    super(world, cfg);
    this.key = 'mining';
    this.name = 'Mining Race';
    this.target = cfg.target ?? 6000;
    this.timeLimit = cfg.time ?? 600;
  }

  get remaining() {
    return Math.max(0, this.timeLimit - this.elapsed);
  }

  update(dt) {
    super.update(dt);
    if (this.finished) return;

    if (this.world.economy.totalMined >= this.target) {
      this.win('Quota met');
    } else if (this.remaining <= 0) {
      this.lose('Out of time');
    }
  }

  objective() {
    const mined = Math.floor(this.world.economy.totalMined);
    return {
      label: `Extract ${this.target}`,
      value: `${mined} · ${formatTime(this.remaining)}`,
      progress: Math.min(1, mined / this.target),
      warn: this.remaining < 60,
    };
  }

  summary() {
    const mined = Math.floor(this.world.economy.totalMined);
    return [
      ['Extracted', `${mined} / ${this.target}`],
      ['Time taken', formatTime(this.elapsed)],
      ['Waves survived', String(this.world.waves.waveIndex)],
    ];
  }

  score() {
    // Only a completed run is worth recording, and faster is better.
    if (this.state !== 'won') return null;
    // Floor to match formatTime, so the summary and the recorded best agree.
    return { metric: 'time', value: Math.floor(this.elapsed), higherIsBetter: false };
  }
}
