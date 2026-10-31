import { Enemy } from '../Enemy.js';

/**
 * Ring ship — a regenerating shield on a slow hull.
 *
 * Counters chip damage: a thin screen of cheap turrets never out-paces the
 * regen, so these need concentrated burst to break through. The shield ring is
 * drawn separately so you can see whether you are actually winning.
 */
export class RingShip extends Enemy {
  constructor(x, y, def) {
    super(x, y, def, 'ringShip');
    this.ringSpin = 0;
  }

  update(dt, world) {
    this.ringSpin += dt * 1.6;
    super.update(dt, world);
  }

  get shieldFraction() {
    return this.maxShield ? this.shield / this.maxShield : 0;
  }
}
