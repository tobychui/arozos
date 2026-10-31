import { Entity } from './Entity.js';
import { Vec2 } from '../core/Vec2.js';

/**
 * Base class for every hostile ship.
 *
 * Shared behaviour: pick the nearest player structure, close on it, stop at
 * weapon range, shoot. Subclasses override only what makes them distinct — how
 * they pick a target, what happens on arrival, or what they do while closing.
 *
 * Targeting deliberately prefers the *nearest* structure rather than always
 * diving for the hub. That is what makes your outlying miners genuinely
 * vulnerable, and why a defensive perimeter has to cover your economy and not
 * just your base.
 */
export class Enemy extends Entity {
  /**
   * @param {number} x @param {number} y
   * @param {object} def entry from entities.json → enemies
   * @param {string} key def key
   */
  constructor(x, y, def, key) {
    super(x, y, def.radius ?? 12);
    this.team = 'enemy';
    this.key = key;
    this.def = def;
    this.name = def.name;
    this.sprite = def.sprite;

    this.maxHp = def.hp ?? 50;
    this.hp = this.maxHp;
    this.maxShield = def.shield ?? 0;
    this.shield = this.maxShield;
    this.shieldRegen = def.shieldRegen ?? 0;

    this.speed = def.speed ?? 50;
    // Named `attackDamage`, not `damage`: an instance property called `damage`
    // would shadow the inherited damage() method and silently make every ship
    // invulnerable.
    this.attackDamage = def.damage ?? 5;
    this.fireRate = def.fireRate ?? 1;
    this.range = def.range ?? 90;
    this.bounty = def.bounty ?? 5;

    this.angle = 0;
    this.cooldown = Math.random() * 0.8; // stagger so packs do not volley as one
    this.target = null;
    this._retarget = 0;
    this.hitFlash = 0;
  }

  /** Nearest live structure, or null if the player has nothing left. */
  findTarget(world) {
    let best = null;
    let bestD2 = Infinity;
    for (const s of world.structures) {
      if (!s.alive) continue;
      const d2 = Vec2.dist2(this.pos, s.pos);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = s;
      }
    }
    return best;
  }

  /** Steer toward a point at full speed. */
  moveToward(pt, dt) {
    const dir = Vec2.norm(Vec2.sub(pt, this.pos));
    this.pos.x += dir.x * this.speed * dt;
    this.pos.y += dir.y * this.speed * dt;
    this.angle = Math.atan2(dir.y, dir.x);
  }

  /** Called when in range of the current target. */
  attack(world, dt) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 1 / this.fireRate;
    // Ships default to bolts; a `projectile: "missile"` entry in the data swaps
    // in slow homing ordnance instead — which an Aegis pulser can shoot down.
    const missile = this.def.projectile === 'missile';
    world.spawnProjectile({
      kind: missile ? 'missile' : 'bolt',
      team: 'enemy',
      x: this.pos.x + Math.cos(this.angle) * this.radius,
      y: this.pos.y + Math.sin(this.angle) * this.radius,
      target: this.target,
      damage: this.attackDamage,
      splash: missile ? this.def.missileSplash ?? 0 : 0,
      speed: this.def.projectileSpeed ?? (missile ? 200 : 420),
      homing: missile,
    });
  }

  update(dt, world) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.shield < this.maxShield && this.shieldRegen) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegen * dt);
    }

    // Re-acquire periodically rather than every frame; targets die often and
    // scanning the whole structure list is the expensive part.
    this._retarget -= dt;
    if (!this.target || !this.target.alive || this._retarget <= 0) {
      this._retarget = 0.5;
      this.target = this.findTarget(world);
    }

    if (!this.target) {
      // Nothing left to attack — drift toward the origin so the field clears.
      this.moveToward({ x: 0, y: 0 }, dt);
      return;
    }

    const d = Vec2.dist(this.pos, this.target.pos);
    const stand = this.range + this.target.radius * 0.5;
    if (d > stand) this.moveToward(this.target.pos, dt);
    else {
      this.angle = Vec2.angle(this.pos, this.target.pos);
      this.attack(world, dt);
    }
  }

  /** Shields soak first; damage spills into hull once they are down. */
  damageBy(amount) {
    if (!this.alive) return;
    this.hitFlash = 1;
    if (this.shield > 0) {
      const soaked = Math.min(this.shield, amount);
      this.shield -= soaked;
      amount -= soaked;
      if (amount <= 0) return;
    }
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy();
    }
  }

  // Projectiles call `damage()` generically on whatever they hit.
  damage(amount) {
    this.damageBy(amount);
  }
}
