import { Structure } from './Structure.js';
import { RepairBot } from './RepairBot.js';
import { Vec2 } from '../core/Vec2.js';

/**
 * Repair station — a drone carrier.
 *
 * Rather than healing everything in an aura, it launches four drones that fly
 * to damaged structures and mend them individually. That makes repair a
 * physical, interruptible thing: drones travel, they take time to arrive, and
 * an attacker can shoot them down.
 *
 * Lost drones are rebuilt on a timer, and rebuilding draws power — so a station
 * that keeps losing drones is a visible, ongoing cost rather than a silent one.
 */
export class RepairStation extends Structure {
  constructor(x, y, def) {
    super(x, y, def, 'repair');
    this.range = def.range ?? 260;
    this.healRate = def.healRate ?? 16;
    this.botCount = def.botCount ?? 4;
    this.botRebuildTime = def.botRebuildTime ?? 6;

    /** @type {RepairBot[]} live drones, docked or deployed */
    this.bots = [];
    this.rebuildQueue = [];   // timers for drones being rebuilt
    this._spawned = false;
    this._scanTimer = 0;
    this._damaged = [];
  }

  get deployed() {
    return this.bots.filter((b) => !b.docked).length;
  }

  /**
   * Fleet and Nanites both change numbers the live drones read, so push the new
   * values onto every drone already in the air rather than waiting for them to
   * be rebuilt.
   */
  applyUpgradeStats(u) {
    super.applyUpgradeStats(u);
    if (u.range !== undefined) this.range = u.range;
    if (u.healRate !== undefined) this.healRate = u.healRate;
    if (u.botCount !== undefined) this.botCount = u.botCount;
    if (u.botRebuildTime !== undefined) this.botRebuildTime = u.botRebuildTime;

    for (const b of this.bots) {
      if (u.botHp !== undefined) {
        // Keep proportional damage rather than free-healing the fleet.
        const frac = b.hp / b.maxHp;
        b.maxHp = u.botHp;
        b.hp = Math.max(1, u.botHp * frac);
      }
      if (u.botSpeed !== undefined) b.speed = u.botSpeed;
      if (u.botRechargeRate !== undefined) b.rechargeRate = u.botRechargeRate;
    }
  }

  /** Called by RepairBot.destroy(). */
  onBotLost(bot) {
    this.bots = this.bots.filter((b) => b !== bot);
    this.rebuildQueue.push(this.botRebuildTime);
  }

  _spawnBot(world) {
    const bot = new RepairBot(this);
    this.bots.push(bot);
    world.bots.push(bot);
  }

  /**
   * Hand a drone something to fix.
   *
   * Targets are claimed one drone at a time so four drones do not all pile onto
   * the same building while everything else burns.
   */
  claimTarget(bot, world) {
    if (!this._damaged.length) return null;
    const taken = new Set(this.bots.map((b) => b.target).filter(Boolean));

    let best = null;
    let bestScore = Infinity;
    for (const s of this._damaged) {
      if (!s.alive || s.hp >= s.maxHp) continue;
      if (taken.has(s)) continue;
      // Prefer close and badly hurt.
      const score = Vec2.dist(bot.pos, s.pos) * (0.4 + (s.hp / s.maxHp) * 0.6);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  update(dt, world) {
    super.update(dt, world);

    // Top the fleet up to strength. Doubles as the initial launch and as the
    // way a Fleet upgrade's extra drones appear, without a separate code path.
    // Drones queued for rebuild count toward strength so losses are not
    // double-replaced.
    if (this.isBuilt) {
      const pending = this.bots.length + this.rebuildQueue.length;
      for (let i = pending; i < this.botCount; i++) this._spawnBot(world);
    }

    if (!this.powered) {
      this.targetActivity = this.isBuilt ? 0 : 1;
      return;
    }

    // Rebuild lost drones. This is what the station spends its power on when
    // it is not repairing.
    for (let i = this.rebuildQueue.length - 1; i >= 0; i--) {
      this.rebuildQueue[i] -= dt * this.supplyRatio;
      if (this.rebuildQueue[i] <= 0) {
        this.rebuildQueue.splice(i, 1);
        this._spawnBot(world);
      }
    }

    this._scanTimer -= dt;
    if (this._scanTimer <= 0) {
      this._scanTimer = 0.4;
      this._damaged = world
        .structuresInRange(this.pos.x, this.pos.y, this.range)
        .filter((s) => s !== this && s.alive && s.hp < s.maxHp);
    }

    // Drawing power whenever drones are out, being rebuilt, or recharging on
    // the pad — a station nursing a damaged flight is a real load, not idle.
    this.charging = this.bots.some((b) => b.charging);
    this.targetActivity =
      this.deployed > 0 || this.rebuildQueue.length > 0 || this.charging ? 1 : 0;
  }
}
