import { Enemy } from '../Enemy.js';

/**
 * Missile ship — outranges a basic laser.
 *
 * Deliberately a counter to the cheapest possible defence: it parks outside
 * laser reach and shells your structures, so answering it needs pulsers,
 * missile batteries, or something to push it off.
 */
export class MissileShip extends Enemy {
  constructor(x, y, def) {
    super(x, y, def, 'missileShip');
  }

  attack(world, dt) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 1 / this.fireRate;
    world.spawnProjectile({
      kind: 'missile',
      team: 'enemy',
      x: this.pos.x,
      y: this.pos.y,
      target: this.target,
      damage: this.attackDamage,
      speed: 200,
      homing: true,
    });
  }
}
