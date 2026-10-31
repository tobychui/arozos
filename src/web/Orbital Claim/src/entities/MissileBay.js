import { Turret } from './Turret.js';

/**
 * Missile battery — long-range splash with a dead zone up close.
 *
 * The minimum range is the interesting constraint: batteries cannot defend
 * themselves, so they have to sit behind a screen of lasers. That turns "where
 * do I put my best gun?" into a layout problem rather than an obvious answer.
 */
export class MissileBay extends Turret {
  constructor(x, y, def) {
    super(x, y, def, 'missileBay');
    this.turnSpeed = 3;
    this.tube = 0;
  }

  /** Prefer the closest target that is still outside the dead zone. */
  acquire(world) {
    return super.acquire(world);
  }

  fire(world) {
    this.tube ^= 1;
    const perp = this.angle + Math.PI / 2;
    const off = this.tube ? 7 : -7;
    world.spawnProjectile({
      kind: 'missile',
      x: this.pos.x + Math.cos(perp) * off,
      y: this.pos.y + Math.sin(perp) * off,
      target: this.target,
      damage: this.attackDamage,
      splash: this.splash,
      speed: 220,
      homing: true,
    });
    this.recoil = 1;
  }
}
