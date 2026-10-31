import { Mode, formatTime } from './Mode.js';

/**
 * Survival — endless escalating waves.
 *
 * There is no win condition, only how far you got. The wave director already
 * scales past its scripted list, so this mode is mostly about presenting that
 * as a score and letting the run end cleanly.
 */
export class SurvivalMode extends Mode {
  constructor(world, cfg) {
    super(world, cfg);
    this.key = 'survival';
    this.name = 'Survival';
  }

  objective() {
    const w = this.world.waves;
    const active = w.state === 'active';
    return {
      label: 'Survive',
      value: active ? `Wave ${w.waveIndex}` : `Wave ${w.nextWaveNumber} incoming`,
      // No finish line, so the bar tracks progress through the scripted waves
      // and then simply sits full.
      progress: Math.min(1, w.waveIndex / (w.list.length || 10)),
      warn: active,
    };
  }

  summary() {
    return [
      ['Waves survived', String(Math.max(0, this.world.waves.waveIndex - (this.state === 'lost' ? 1 : 0)))],
      ['Time', formatTime(this.elapsed)],
      ['Minerals extracted', String(Math.floor(this.world.economy.totalMined))],
    ];
  }

  score() {
    const waves = Math.max(0, this.world.waves.waveIndex - (this.state === 'lost' ? 1 : 0));
    // Losing wave 1 is not a record worth keeping.
    if (waves <= 0) return null;
    return { metric: 'wave', value: waves, higherIsBetter: true };
  }
}
