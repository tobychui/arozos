import { Mode, formatTime } from './Mode.js';

/**
 * Sandbox — a debugging playground.
 *
 * Infinite minerals, instant construction and upgrades, unlimited power and a
 * held wave timer, plus an enemy spawner in the HUD. It ends only when every
 * structure is destroyed, and records no score. Each switch lives on the
 * system it affects (economy, grid, waves, world), so the sandbox does not
 * need special cases in the game logic.
 */
export class SandboxMode extends Mode {
  constructor(world, cfg) {
    super(world, cfg);
    this.key = 'sandbox';
    this.name = 'Sandbox';
    this.isSandbox = true;

    world.economy.infinite = true;
    world.instantBuild = true;
    world.grid.unlimited = true;
    world.waves.frozen = true;
  }

  // Losing every structure still ends the run, as in every other mode — the
  // base Mode.update handles it, and the sandbox adds no conditions of its own.

  summary() {
    return [['Time', formatTime(this.elapsed)]];
  }

  objective() {
    const n = this.world.enemies.length;
    return {
      label: 'Sandbox',
      value: `${n} hostile${n === 1 ? '' : 's'}`,
      progress: 0,
      warn: n > 0,
    };
  }
}
