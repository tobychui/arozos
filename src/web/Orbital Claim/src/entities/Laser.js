import { Turret } from './Turret.js';

/**
 * Basic laser — a continuous cutting beam.
 *
 * Unlike the projectile turrets it never misses and never leads a target, so
 * it is the reliable answer to fast, weaving ships that bolts fly straight past.
 * The trade is that it wears a target down rather than bursting it: raw damage
 * per second is lower than the Pulser's, and it cannot overkill.
 *
 * Damage is applied per tick rather than per shot, so it scales smoothly with
 * `supplyRatio` — a browned-out laser visibly cuts slower instead of stuttering.
 */
export class Laser extends Turret {
  constructor(x, y, def) {
    super(x, y, def, 'laser');
    this.isBeam = true;
    this.dps = def.dps ?? 14;

    /** Target currently being cut, for the renderer. */
    this.beamTarget = null;
    /** 0..1 ramp so the beam fades in and out instead of popping. */
    this.beamHeat = 0;
  }

  applyUpgradeStats(u) {
    super.applyUpgradeStats(u);
    // Beams are rated in damage per second rather than per shot.
    if (u.dps !== undefined) this.dps = u.dps;
  }

  engage(dt, world, aimed) {
    // Only cut once the emitter has swung onto the target.
    if (!this.target || !aimed) {
      this.beamTarget = null;
      return;
    }
    this.beamTarget = this.target;
    this.target.damage?.(this.dps * this.supplyRatio * dt);
  }

  update(dt, world) {
    super.update(dt, world);

    // Losing power or the target drops the beam; the heat ramp is what makes
    // that read as a fade rather than a hard cut.
    if (!this.powered || !this.target) this.beamTarget = null;
    if (this.beamTarget && !this.beamTarget.alive) this.beamTarget = null;

    const want = this.beamTarget ? 1 : 0;
    this.beamHeat += (want - this.beamHeat) * Math.min(1, dt * 12);
  }
}
