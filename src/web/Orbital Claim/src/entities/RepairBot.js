import { Entity } from './Entity.js';
import { Vec2 } from '../core/Vec2.js';

/**
 * Repair drone launched by a repair station.
 *
 * A simple state machine: sit docked until something nearby is damaged, fly to
 * it, hold station and mend it, then come home. Drones are physical and can be
 * shot down, which is the interesting part — repair is no longer a guaranteed
 * aura, it is a fragile supply line that an attacker can cut.
 */
export class RepairBot extends Entity {
  /** @param {import('./RepairStation.js').RepairStation} station */
  constructor(station) {
    super(station.pos.x, station.pos.y, 7);
    this.team = 'player';
    this.station = station;
    this.sprite = 'repair-bot';

    const def = station.def;
    this.maxHp = def.botHp ?? 40;
    this.hp = this.maxHp;
    this.speed = def.botSpeed ?? 105;

    this.state = 'docked'; // docked | outbound | working | returning
    this.target = null;
    this.angle = -Math.PI / 2;
    this.hitFlash = 0;
    this.beam = 0;

    // Self-preservation: a badly damaged drone breaks off and comes home to be
    // patched up rather than being picked off finishing a job. Losing one costs
    // a full rebuild timer, so retreating is nearly always the better trade.
    this.recallAt = def.botRecallAt ?? 0.2;
    this.rechargeRate = def.botRechargeRate ?? 14;
    this.charging = false;

    // Drones idle in a slow orbit around their station so a full pad reads as
    // "ready" rather than as a single stacked sprite.
    this.orbit = Math.random() * Math.PI * 2;
    // Separate angle for orbiting a repair target, seeded on arrival from the
    // approach bearing so the drone eases into the circle instead of snapping.
    this.workOrbit = 0;
    this.workDir = Math.random() < 0.5 ? -1 : 1;
  }

  /** Radius the drone holds while working on `target`. */
  _standoff(target) {
    return target.radius + 16;
  }

  get docked() {
    return this.state === 'docked';
  }

  /**
   * Repair per second for this drone.
   *
   * Read live off the station rather than cached at construction, so an upgrade
   * takes effect on drones already in the air. The station's total output is
   * split across the fleet: Fleet upgrades spread the same throughput over more
   * targets, Nanites raises the throughput itself.
   */
  get healRate() {
    return this.station.healRate / Math.max(1, this.station.botCount);
  }

  _moveTo(pt, dt) {
    const d = Vec2.dist(this.pos, pt);
    if (d < 1) return 0;
    const step = Math.min(d, this.speed * dt);
    const dir = Vec2.norm(Vec2.sub(pt, this.pos));
    this.pos.x += dir.x * step;
    this.pos.y += dir.y * step;
    this.angle = Math.atan2(dir.y, dir.x);
    return d - step;
  }

  update(dt, world) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.beam = Math.max(0, this.beam - dt * 3);

    // Losing the station strands the drone; it retires rather than orbiting a
    // crater forever.
    if (!this.station.alive) {
      this.destroy();
      return;
    }

    // A target that died or got fully healed frees the drone immediately.
    if (this.target && (!this.target.alive || this.target.hp >= this.target.maxHp)) {
      this.target = null;
      if (this.state !== 'docked') this.state = 'returning';
    }

    // Break off and run for home once badly hurt. Checked before the state
    // machine so it overrides whatever the drone was doing.
    if (this.hp < this.maxHp * this.recallAt &&
        this.state !== 'docked' && this.state !== 'returning') {
      this.target = null;
      this.state = 'returning';
    }

    switch (this.state) {
      case 'docked': {
        this.orbit += dt * 0.9;
        const r = this.station.radius + 9;
        this.pos.x = this.station.pos.x + Math.cos(this.orbit) * r;
        this.pos.y = this.station.pos.y + Math.sin(this.orbit) * r;
        this.angle = this.orbit + Math.PI / 2;

        // Recharge on the pad. Draws on the station's supply, so a browned-out
        // grid patches its drones slowly.
        this.charging = this.hp < this.maxHp;
        if (this.charging) {
          if (this.station.powered) {
            this.hp = Math.min(
              this.maxHp,
              this.hp + this.rechargeRate * this.station.supplyRatio * dt
            );
          }
          // Stay home until fully patched: redeploying at 30% just loses it.
          break;
        }

        // Only launch if the station is actually powered.
        if (this.station.powered) {
          const t = this.station.claimTarget(this, world);
          if (t) {
            this.target = t;
            this.state = 'outbound';
          }
        }
        break;
      }

      case 'outbound': {
        if (!this.target) {
          this.state = 'returning';
          break;
        }
        const stand = this._standoff(this.target);
        const remaining = this._moveTo(this.target.pos, dt);
        if (remaining <= stand) {
          // Seed the work orbit from where we actually arrived.
          this.workOrbit = Math.atan2(
            this.pos.y - this.target.pos.y,
            this.pos.x - this.target.pos.x
          );
          this.state = 'working';
        }
        break;
      }

      case 'working': {
        if (!this.target) {
          this.state = 'returning';
          break;
        }
        // Circle the target while mending rather than hovering on one spot: it
        // reads as active work, and matches how the drones behave when docked.
        const stand = this._standoff(this.target);
        // Constant linear speed, so tight orbits around a small structure do
        // not spin absurdly fast compared to a wide one around the hub.
        this.workOrbit += this.workDir * (this.speed * 0.45 / stand) * dt;

        const want = {
          x: this.target.pos.x + Math.cos(this.workOrbit) * stand,
          y: this.target.pos.y + Math.sin(this.workOrbit) * stand,
        };
        // Ease onto the ring instead of teleporting, which keeps the arrival
        // and any target drift smooth.
        const k = Math.min(1, dt * 6);
        this.pos.x += (want.x - this.pos.x) * k;
        this.pos.y += (want.y - this.pos.y) * k;

        // Face along the direction of travel, banked toward the hull.
        this.angle = this.workOrbit + this.workDir * Math.PI / 2;
        this.target.heal(this.healRate * this.station.supplyRatio * dt);
        this.beam = 1;
        break;
      }

      case 'returning': {
        const remaining = this._moveTo(this.station.pos, dt);
        if (remaining <= this.station.radius + 10) this.state = 'docked';
        break;
      }
    }
  }

  damage(amount) {
    if (!this.alive) return;
    this.hitFlash = 1;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy();
    }
  }

  destroy() {
    super.destroy();
    this.station?.onBotLost?.(this);
  }
}
