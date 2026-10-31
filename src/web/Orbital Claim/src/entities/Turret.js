import { Structure } from './Structure.js';
import { Vec2 } from '../core/Vec2.js';

/**
 * Base class for every weapon.
 *
 * Subclasses vary the numbers and the projectile, not the logic: acquire a
 * target in range, rotate toward it, fire on a cooldown. Keeping targeting here
 * means the "which enemy?" policy is defined once and stays consistent.
 *
 * Fire rate scales with `supplyRatio`, so a browned-out grid means slower guns
 * rather than dead ones — the same graceful-degradation rule the miners use.
 */
export class Turret extends Structure {
  constructor(x, y, def, key) {
    super(x, y, def, key);
    this.range = def.range ?? 160;
    this.minRange = def.minRange ?? 0;
    // Not `damage`: that would shadow the inherited damage() method and make
    // the turret unkillable.
    this.attackDamage = def.damage ?? 10;
    this.fireRate = def.fireRate ?? 1;
    this.splash = def.splash ?? 0;
    this.projectileKind = def.projectile ?? 'bolt';

    // Minerals consumed per shot. Zero for energy weapons; missiles are
    // physical ordnance, so a battery you cannot afford to feed goes quiet.
    this.ammoCost = def.ammoCost ?? 0;
    this.starved = false;

    this.angle = -Math.PI / 2;
    this.cooldown = 0;
    this.target = null;
    this.turnSpeed = 7; // rad/sec
    this.recoil = 0;

    // Charge builds while a shot is on cooldown and dumps when it fires, so the
    // supply line visibly pulses once per shot rather than sitting at a
    // constant brightness.
    this.charge = 0;
  }

  /** Weapon stats live on this class, so extend the base upgrade handler. */
  applyUpgradeStats(u) {
    super.applyUpgradeStats(u);
    if (u.range !== undefined) this.range = u.range;
    if (u.minRange !== undefined) this.minRange = u.minRange;
    if (u.damage !== undefined) this.attackDamage = u.damage;
    if (u.fireRate !== undefined) this.fireRate = u.fireRate;
    if (u.splash !== undefined) this.splash = u.splash;
    if (u.ammoCost !== undefined) this.ammoCost = u.ammoCost;
  }

  /** Nearest valid enemy. Cheap, predictable, and easy for players to read. */
  acquire(world) {
    const enemies = world.enemiesInRange(this.pos.x, this.pos.y, this.range);
    let best = null;
    let bestD2 = Infinity;
    for (const e of enemies) {
      const d2 = Vec2.dist2(this.pos, e.pos);
      if (this.minRange && d2 < this.minRange * this.minRange) continue;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  update(dt, world) {
    super.update(dt, world);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 6);
    if (!this.powered) {
      this.targetActivity = this.isBuilt ? 0 : 1;
      return;
    }
    // A turret with nothing to shoot idles; one that is engaging pulls hard.
    this.targetActivity = this.target ? 1 : 0;

    // Drop a target that died or slipped out of range.
    if (this.target && (!this.target.alive || !Vec2.within(this.pos, this.target.pos, this.range))) {
      this.target = null;
    }
    if (!this.target) this.target = this.acquire(world);

    this.cooldown -= dt * this.supplyRatio;
    if (!this.target) return;

    // Rotate toward the target, taking the shorter way round.
    const want = Vec2.angle(this.pos, this.target.pos);
    let diff = want - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = this.turnSpeed * dt;
    this.angle += Math.abs(diff) < step ? diff : Math.sign(diff) * step;

    this.engage(dt, world, Math.abs(diff) < 0.25);
  }

  /**
   * Deliver damage. Split out so weapon types differ only here: projectile
   * turrets fire on a cooldown, beam turrets apply damage continuously.
   * @param {boolean} aimed whether the barrel has caught up with the target
   */
  engage(dt, world, aimed) {
    if (this.cooldown > 0 || !aimed) return;
    // Check ammo before committing the shot; if we cannot pay, hold the
    // cooldown at zero so it fires the instant minerals come back.
    if (this.ammoCost > 0 && !world.economy.spend(this.ammoCost)) {
      this.starved = true;
      return;
    }
    this.starved = false;
    this.cooldown = 1 / this.fireRate;
    this.fire(world);
  }

  fire(world) {
    this.recoil = 1;
    world.spawnProjectile({
      kind: this.projectileKind,
      x: this.pos.x + Math.cos(this.angle) * this.radius,
      y: this.pos.y + Math.sin(this.angle) * this.radius,
      target: this.target,
      damage: this.attackDamage,
      splash: this.splash,
    });
  }
}
