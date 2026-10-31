import { Turret } from './Turret.js';
import { Vec2 } from '../core/Vec2.js';

/**
 * Pulser — the long-range bolt thrower, at a steep power cost.
 *
 * Where the laser is the reliable close-in answer, the Pulser is about reach.
 * Its first two upgrade paths push range further and differ in how the damage
 * lands:
 *  - Lance trades rate of fire for heavy, fast slugs — burst for shields, and
 *    fast enough that distant targets have less time to dodge.
 *  - Barrage adds barrels for a dense stream of bolts that thins packs at range.
 *
 * The third, Aegis, is the odd one out: it stops shooting ships entirely and
 * becomes point defence, launching interceptors at incoming enemy missiles.
 * Interception never misses — the upgrades buy a shorter recharge interval
 * rather than accuracy — but every intercept is paid for in power: the
 * launcher draws its full rating for the whole recharge.
 *
 * Cycles through its barrels so the muzzle flash reads as a rapid stream rather
 * than a single stuttering point.
 */
export class Pulser extends Turret {
  constructor(x, y, def) {
    super(x, y, def, 'pulser');
    this.barrel = 0;
    this.barrels = def.barrels ?? 2;
    // Spacing between barrel muzzles in world units; matches the sprite.
    this.barrelGap = def.barrelGap ?? 10;
    this.projectileSpeed = def.projectileSpeed ?? undefined;
    this.turnSpeed = 9;

    /** Aegis path: targets enemy missiles instead of ships. */
    this.intercept = false;
    this.intercepts = 0;
  }

  applyUpgradeStats(u) {
    super.applyUpgradeStats(u);
    if (u.projectile !== undefined) this.projectileKind = u.projectile;
    if (u.projectileSpeed !== undefined) this.projectileSpeed = u.projectileSpeed;
    if (u.barrels !== undefined) this.barrels = u.barrels;
    if (u.barrelGap !== undefined) this.barrelGap = u.barrelGap;
    if (u.idleFactor !== undefined) this.idleFactor = u.idleFactor;
    if (u.intercept) {
      this.intercept = true;
      this.target = null;
      // Missiles cross the arc quickly; the launcher has to keep up.
      this.turnSpeed = 16;
    }
  }

  /** Seconds between intercepts at full power. */
  get interval() {
    return 1 / this.fireRate;
  }

  /** Recharging after an intercept — the expensive part. */
  get recharging() {
    return this.intercept && this.cooldown > 0;
  }

  acquire(world) {
    if (!this.intercept) return super.acquire(world);
    // Nearest incoming missile nobody else has already locked.
    let best = null;
    let bestD2 = this.range * this.range;
    for (const p of world.projectiles) {
      if (!p.alive || p.doomed || p.team !== 'enemy' || p.kind !== 'missile') continue;
      const d2 = Vec2.dist2(this.pos, p.pos);
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  update(dt, world) {
    // Another launcher got there first; look for something else.
    if (this.intercept && this.target?.doomed) this.target = null;
    super.update(dt, world);
    // Draw tracks the recharge, not whether a missile is in view: a charged
    // launcher waits cheaply, and the bill arrives with each intercept.
    if (this.intercept && this.powered) this.targetActivity = this.recharging ? 1 : 0;
  }

  fire(world) {
    this.barrel = (this.barrel + 1) % this.barrels;
    const off = (this.barrel - (this.barrels - 1) / 2) * this.barrelGap;
    const perp = this.angle + Math.PI / 2;
    const x = this.pos.x + Math.cos(this.angle) * this.radius + Math.cos(perp) * off;
    const y = this.pos.y + Math.sin(this.angle) * this.radius + Math.sin(perp) * off;
    this.recoil = 1;

    if (this.intercept) {
      const prey = this.target;
      prey.doomed = true;
      world.spawnProjectile({
        kind: this.projectileKind, x, y, target: prey, prey,
        damage: 0, speed: this.projectileSpeed,
      });
      this.intercepts++;
      this.target = null;
      return;
    }

    world.spawnProjectile({
      kind: this.projectileKind, x, y,
      target: this.target,
      damage: this.attackDamage,
      splash: this.splash,
      speed: this.projectileSpeed,
    });
  }
}
