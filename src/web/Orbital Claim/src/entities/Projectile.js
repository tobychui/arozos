import { Entity } from './Entity.js';
import { Vec2 } from '../core/Vec2.js';

/**
 * Bolts and missiles, for both sides.
 *
 * Bolts fly at where the target was when fired, so they can miss a fast mover —
 * that is exactly what makes swarmers awkward for single-target turrets.
 * Missiles steer toward their target instead, which is why they cost more and
 * fire slowly.
 *
 * `team` decides what it can hit, so the same class serves player turrets and
 * enemy ships without either needing to know about the other.
 */
export class Projectile extends Entity {
  constructor(opts) {
    super(opts.x, opts.y, 4);
    this.team = opts.team ?? 'player';
    this.kind = opts.kind ?? 'bolt';
    this.damage = opts.damage ?? 10;
    this.splash = opts.splash ?? 0;
    this.homing = opts.homing ?? false;
    this.speed = opts.speed ?? 620;
    this.target = opts.target ?? null;
    // Interceptors hunt an enemy projectile rather than a ship.
    this.prey = opts.prey ?? null;
    this.doomed = false;
    this.life = 3.5;

    const aim = this.target ? this.target.pos : { x: opts.x, y: opts.y - 1 };
    const dir = Vec2.norm(Vec2.sub(aim, this.pos));
    this.vel = Vec2.scale(dir, this.speed);
    this.angle = Math.atan2(dir.y, dir.x);
  }

  update(dt, world) {
    this.life -= dt;
    if (this.life <= 0) {
      this.destroy();
      return;
    }

    if (this.homing && this.target && this.target.alive) {
      const want = Vec2.norm(Vec2.sub(this.target.pos, this.pos));
      // Steer rather than snap, so missiles arc instead of tracking perfectly.
      this.vel.x += (want.x * this.speed - this.vel.x) * Math.min(1, dt * 4);
      this.vel.y += (want.y * this.speed - this.vel.y) * Math.min(1, dt * 4);
      this.angle = Math.atan2(this.vel.y, this.vel.x);
    }

    if (this.prey) {
      this._updateInterceptor(dt, world);
      return;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // An Aegis has locked this missile: it is already dead, it just has not
    // been reached yet. Disarming it at lock time is what makes interception
    // "always accurate" — it can never slip through and land its hit.
    if (this.doomed) return;

    if (this.team === 'player') {
      // Hit whatever is in the way, not just the original target: a bolt that
      // flies through a different ship should still connect.
      const hit = world.enemyAt(this.pos.x, this.pos.y, 8);
      if (hit) {
        world.applyDamage(hit, this.damage, this.splash, this.pos);
        world.spawnBlast(this.pos.x, this.pos.y, this.splash > 0 ? this.splash : 12);
        world.sound(this.splash > 0 ? 'impact' : 'hit', this.pos.x, this.pos.y);
        this.destroy();
      }
      return;
    }

    // Drones are legitimate targets, which is what makes repair interruptible.
    const hit = world.playerTargetAt(this.pos.x, this.pos.y, 2);
    if (hit) {
      if (this.splash > 0) world.damageStructures(this.pos, this.splash, this.damage);
      else hit.damage(this.damage);
      world.spawnBlast(this.pos.x, this.pos.y, this.splash > 0 ? this.splash : 12);
      world.sound('impact', this.pos.x, this.pos.y);
      this.destroy();
    }
  }

  /**
   * Perfect pursuit: re-aimed every tick, so it cannot miss. The prey was
   * disarmed at launch, so all that is left is to reach it and pop it.
   */
  _updateInterceptor(dt, world) {
    const prey = this.prey;
    if (!prey.alive) {
      this.destroy();
      return;
    }
    const to = Vec2.sub(prey.pos, this.pos);
    const d = Math.hypot(to.x, to.y);
    const step = this.speed * dt;
    if (d <= step + 6) {
      prey.destroy();
      world.spawnBlast(prey.pos.x, prey.pos.y, 14);
      world.sound('intercept', prey.pos.x, prey.pos.y);
      this.destroy();
      return;
    }
    this.vel = Vec2.scale(Vec2.norm(to), this.speed);
    this.angle = Math.atan2(to.y, to.x);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }
}
