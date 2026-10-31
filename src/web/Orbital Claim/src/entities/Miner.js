import { Structure } from './Structure.js';

/**
 * Mineral miner.
 *
 * Works every asteroid within range at once, but splits a fixed total rate
 * across them rather than multiplying it. Siting one miner over a dense cluster
 * is therefore about longevity (the cluster drains slower per rock, and you
 * keep yielding as individual rocks die) rather than raw throughput — which
 * keeps placement interesting without making a single spot strictly optimal.
 *
 * Visually each worked rock holds a steady extraction beam that flashes once
 * per unit of ore banked, then fades. The flash rate is the yield, so a miner
 * on a rich cluster strobes while one on a nearly-dead rock blinks slowly.
 */
export class Miner extends Structure {
  constructor(x, y, def) {
    super(x, y, def, 'miner');
    this.range = def.range ?? 130;
    this.mineRate = def.mineRate ?? 4;

    this.targets = [];
    this.yieldRate = 0;   // ore/sec actually produced, for the HUD

    /** @type {{a: import('./Asteroid.js').Asteroid, flash: number}[]} */
    this.beams = [];
    this.orePerFlash = 1.2;
    this.flashDecay = 2.8;   // flashes/sec of fade
    this._oreSinceFlash = 0;
    this._rotation = 0;
    this._scanTimer = 0;
  }

  applyUpgradeStats(u) {
    super.applyUpgradeStats(u);
    if (u.mineRate !== undefined) this.mineRate = u.mineRate;
    if (u.range !== undefined) this.range = u.range;
  }

  /** Keep the beam list in step with the current target list. */
  _syncBeams() {
    const kept = new Map(this.beams.map((b) => [b.a, b]));
    this.beams = this.targets.map((a) => kept.get(a) ?? { a, flash: 0 });
  }

  update(dt, world) {
    super.update(dt, world);
    this.yieldRate = 0;

    // Beams fade whether or not we still have power, so cutting supply reads as
    // the beams dimming out rather than snapping off.
    for (const b of this.beams) {
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * this.flashDecay);
    }

    if (!this.powered) {
      this.targetActivity = this.isBuilt ? 0 : 1;
      return;
    }

    // Rescanning every frame is wasteful and the field changes slowly.
    this._scanTimer -= dt;
    if (this._scanTimer <= 0) {
      this._scanTimer = 0.25;
      this.targets = world
        .asteroidsInRange(this.pos.x, this.pos.y, this.range)
        .filter((a) => !a.depleted);
      this._syncBeams();
    }

    // Nothing left to chew on means nothing to draw for.
    this.targetActivity = this.targets.length ? 1 : 0;
    if (!this.targets.length) return;

    const share = (this.mineRate * this.supplyRatio) / this.targets.length;
    let mined = 0;
    for (const a of this.targets) {
      if (a.depleted) continue;
      mined += a.extract(share * dt);
      a.minersInRange++;
    }

    if (mined <= 0) return;

    world.economy.addMinerals(mined);
    this.yieldRate = mined / dt;

    // One flash per fixed amount of ore, round-robin across the rocks being
    // worked. `while` rather than `if` so a very high yield still fires every
    // flash it earned instead of silently dropping them.
    this._oreSinceFlash += mined;
    let guard = 0;
    while (this._oreSinceFlash >= this.orePerFlash && guard++ < 6) {
      this._oreSinceFlash -= this.orePerFlash;
      const b = this.beams[this._rotation++ % this.beams.length];
      if (b && !b.a.depleted) b.flash = 1;
    }
  }
}
