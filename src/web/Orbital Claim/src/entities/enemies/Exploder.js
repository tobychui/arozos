import { Enemy } from '../Enemy.js';
import { Vec2 } from '../../core/Vec2.js';

/**
 * Exploder — a suicide bomber.
 *
 * Ignores weapon range entirely and rams whatever is closest, detonating for
 * heavy splash. It punishes undefended edges: anything that reaches your line
 * takes a building with it, so these have to die at distance.
 */
export class Exploder extends Enemy {
  constructor(x, y, def) {
    super(x, y, def, 'exploder');
    this.splash = def.splash ?? 90;
    this.fuse = 0;
    this.arming = false;
  }

  update(dt, world) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    this._retarget -= dt;
    if (!this.target || !this.target.alive || this._retarget <= 0) {
      this._retarget = 0.5;
      this.target = this.findTarget(world);
    }
    if (!this.target) {
      this.moveToward({ x: 0, y: 0 }, dt);
      return;
    }

    this.moveToward(this.target.pos, dt);

    // Arm just before contact so there is a brief, readable tell.
    const d = Vec2.dist(this.pos, this.target.pos);
    this.arming = d < this.target.radius + 46;
    if (d <= this.target.radius + this.radius) this.detonate(world);
  }

  detonate(world) {
    world.damageStructures(this.pos, this.splash, this.attackDamage);
    world.spawnBlast(this.pos.x, this.pos.y, this.splash);
    world.sound('detonate', this.pos.x, this.pos.y);
    this.destroy();
  }

  /** Dying to gunfire still sets it off, so clustering near one is a mistake. */
  damageBy(amount) {
    super.damageBy(amount);
    if (!this.alive && this._world) this.detonate(this._world);
  }
}
