import { SpatialHash } from '../core/SpatialHash.js';
import { PowerGrid } from '../systems/PowerGrid.js';
import { Economy } from '../systems/Economy.js';
import { Field } from './Field.js';
import { Vec2 } from '../core/Vec2.js';

import { Miner } from '../entities/Miner.js';
import { Solar } from '../entities/Solar.js';
import { Relay } from '../entities/Relay.js';
import { Laser } from '../entities/Laser.js';
import { Pulser } from '../entities/Pulser.js';
import { MissileBay } from '../entities/MissileBay.js';
import { RepairStation } from '../entities/RepairStation.js';
import { Battery } from '../entities/Battery.js';
import { Projectile } from '../entities/Projectile.js';

import { WaveDirector } from '../systems/WaveDirector.js';
import { Fighter } from '../entities/enemies/Fighter.js';
import { Swarmer } from '../entities/enemies/Swarmer.js';
import { MissileShip } from '../entities/enemies/MissileShip.js';
import { Exploder } from '../entities/enemies/Exploder.js';
import { RingShip } from '../entities/enemies/RingShip.js';
import { Mothership } from '../entities/enemies/Mothership.js';

/** Maps a data key to its class, so adding a building is a one-line change. */
const STRUCTURE_CLASSES = {
  miner: Miner,
  solar: Solar,
  relay: Relay,
  laser: Laser,
  pulser: Pulser,
  missileBay: MissileBay,
  repair: RepairStation,
  battery: Battery,
};

/** Same idea for hostiles: adding a ship type is a one-line change. */
const ENEMY_CLASSES = {
  fighter: Fighter,
  swarmer: Swarmer,
  missileShip: MissileShip,
  exploder: Exploder,
  ringShip: RingShip,
  mothership: Mothership,
};

/**
 * Owns every entity and steps the simulation.
 *
 * Separate spatial hashes for asteroids (static, built once) and for mobile
 * things (rebuilt each tick) — no point re-bucketing thousands of rocks that
 * never move.
 */
export class World {
  constructor(data, seed = 1337) {
    this.data = data;
    this.seed = seed;

    this.structures = [];
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.bots = [];        // repair drones, owned by their stations

    const field = Field.generate(seed, { radius: 1600 });
    this.asteroids = field.asteroids;
    this.fieldRadius = field.radius;

    this.asteroidHash = new SpatialHash(160);
    this.asteroidHash.rebuild(this.asteroids);
    // Enemy ships only. Projectiles must not live here: turret targeting
    // queries this by team, and an enemy bolt would otherwise look like a
    // valid thing to shoot at.
    this.enemyHash = new SpatialHash(128);

    this.grid = new PowerGrid(data.grid?.linkRange ?? 170);
    this.economy = new Economy(data.resources?.minerals);

    this.time = 0;
    // Sandbox: structures are finished the moment they are placed.
    this.instantBuild = false;
    // Sandbox: enemy fire does no damage to structures.
    this.invincible = false;
    this.onStructureDestroyed = null;
    // Sound events, as (cue, x, y). The world only says what happened where;
    // the Game decides how loud that is from where the camera is.
    this.onSound = null;
    this.gameOver = false;

    // Run statistics for the end-of-run report. Combat only: selling is not a
    // loss and clearing enemies in the sandbox is not a kill.
    this.kills = 0;
    this.structuresBuilt = 0;
    this.structuresLost = 0;

    this._placeStartingBase();
    this.waves = new WaveDirector(data, this);
  }

  /**
   * Opening position: a single fully-upgraded solar array.
   *
   * There is no command hub. Nothing is irreplaceable, so the run ends only when
   * the player has no structures left at all — which makes rebuilding from a
   * bad wave a genuine option rather than a formality.
   */
  _placeStartingBase() {
    const start = this.placeStructure('solar', 0, 0, true);
    if (!start) return;
    while (start.canUpgrade) {
      const u = start.nextUpgrade;
      start.applyUpgradeStats(u);
      start.level++;
    }
    // It was a gift, so selling it back should not pay out.
    start.invested = 0;
  }

  // ---------------------------------------------------------------- building

  defFor(key) {
    return this.data.buildings[key];
  }

  /**
   * @param {string} key building key
   * @param {boolean} free skip cost and build time (used for the starting hub)
   */
  placeStructure(key, x, y, free = false) {
    const def = this.defFor(key);
    if (!def) return null;
    const Cls = STRUCTURE_CLASSES[key];
    if (!Cls) return null;

    if (!free) {
      if (!this.economy.canAfford(def.cost ?? 0)) return null;
      this.economy.spend(def.cost ?? 0);
    }

    const s = new Cls(x, y, def);
    // The free starting solar counts too, so built and destroyed always reconcile.
    this.structuresBuilt++;
    if (free || this.instantBuild) {
      s.buildProgress = 1;
    }
    s.invulnerable = this.invincible;
    this.structures.push(s);
    this.grid.markDirty();
    return s;
  }

  /** Alive structures — the losing condition is this reaching zero. */
  get liveStructures() {
    return this.structures.filter((s) => s.alive);
  }

  setInvincible(on) {
    this.invincible = on;
    for (const s of this.structures) s.invulnerable = on;
  }

  sound(cue, x, y) {
    this.onSound?.(cue, x, y);
  }

  sellStructure(s) {
    if (!s || !s.alive) return false;
    // Selling the last structure would end the run outright. That is almost
    // never intended, least of all from a stray click in recycle mode.
    if (this.liveStructures.length <= 1) return false;
    this.economy.refund(s.refundValue());
    s.destroy();
    this._cleanupStructures();
    return true;
  }

  canPlaceAt(key, x, y) {
    const def = this.defFor(key);
    if (!def) return { ok: false, reason: 'unknown' };
    if (!this.economy.canAfford(def.cost ?? 0)) return { ok: false, reason: 'minerals' };

    const r = def.radius ?? 18;
    for (const s of this.structures) {
      if (s.alive && Vec2.dist(s.pos, { x, y }) < r + s.radius + 6) {
        return { ok: false, reason: 'blocked' };
      }
    }
    for (const a of this.asteroids) {
      if (!a.depleted && Vec2.dist(a.pos, { x, y }) < r + a.radius) {
        return { ok: false, reason: 'asteroid' };
      }
    }
    if (Math.hypot(x, y) > this.fieldRadius + 400) {
      return { ok: false, reason: 'range' };
    }
    // Out-of-reach placement is allowed deliberately. Construction needs power,
    // so an unconnected site simply sits at 0% until a relay reaches it — which
    // lets you stake out ground ahead of the grid rather than being blocked.
    const live = this.liveStructures;
    const offGrid = live.length > 0 && !this.grid.wouldConnect(x, y, live);
    return { ok: true, offGrid };
  }

  _cleanupStructures() {
    const before = this.structures.length;
    this.structures = this.structures.filter((s) => s.alive);
    if (this.structures.length !== before) this.grid.markDirty();
  }

  /**
   * Recycle every miner that has nothing left to work.
   *
   * A miner sitting on exhausted rock is pure upkeep: it draws power and pays
   * nothing back. Finding them by hand across a large field is tedious, so this
   * sweeps them in one action.
   *
   * @returns {{count:number, refund:number}}
   */
  recycleDeadMiners() {
    let count = 0;
    let refund = 0;
    for (const s of this.structures) {
      if (!s.alive || s.key !== 'miner' || !s.isBuilt) continue;
      // "Dead" means no un-depleted rock anywhere in range, not merely idle
      // this instant — a miner between scans still has work to do.
      const live = this.asteroidsInRange(s.pos.x, s.pos.y, s.range);
      if (live.length > 0) continue;
      refund += s.refundValue();
      this.sellStructure(s);
      count++;
    }
    return { count, refund };
  }

  // ----------------------------------------------------------------- queries

  asteroidsInRange(x, y, r) {
    return this.asteroidHash.query(x, y, r, (a) => !a.depleted);
  }

  structuresInRange(x, y, r) {
    return this.structures.filter((s) => s.alive && Vec2.within({ x, y }, s.pos, r));
  }

  enemiesInRange(x, y, r) {
    return this.enemyHash.query(x, y, r);
  }

  enemyAt(x, y, slack = 0) {
    for (const e of this.enemies) {
      if (e.alive && e.contains(x, y, slack)) return e;
    }
    return null;
  }

  structureAt(x, y, slack = 4) {
    for (let i = this.structures.length - 1; i >= 0; i--) {
      const s = this.structures[i];
      if (s.alive && s.contains(x, y, slack)) return s;
    }
    return null;
  }

  asteroidAt(x, y, slack = 6) {
    for (const a of this.asteroids) {
      if (a.contains(x, y, slack)) return a;
    }
    return null;
  }

  /** Anything hostile fire can hit: structures first, then drones. */
  playerTargetAt(x, y, slack = 2) {
    return this.structureAt(x, y, slack) || this.botAt(x, y, slack + 4);
  }

  botAt(x, y, slack = 0) {
    for (const b of this.bots) {
      if (b.alive && b.contains(x, y, slack)) return b;
    }
    return null;
  }

  /** Rough centre of mass of the base, used where the old hub was a landmark. */
  get anchor() {
    const live = this.liveStructures;
    if (!live.length) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const s of live) {
      x += s.pos.x;
      y += s.pos.y;
    }
    return { x: x / live.length, y: y / live.length };
  }

  // ------------------------------------------------------------------ combat

  spawnEnemy(type, x, y) {
    const def = this.data.enemies?.[type];
    const Cls = ENEMY_CLASSES[type];
    if (!def || !Cls) return null;
    const e = new Cls(x, y, def);
    // Exploders need a world handle so dying to gunfire still detonates them.
    e._world = this;
    this.enemies.push(e);
    return e;
  }

  /** Splash damage against player structures, with linear falloff. */
  damageStructures(at, radius, damage) {
    for (const s of this.structures) {
      if (!s.alive) continue;
      const d = Vec2.dist(at, s.pos);
      if (d > radius + s.radius) continue;
      const f = 1 - Math.min(1, d / (radius + s.radius));
      s.damage(damage * Math.max(0.15, f));
    }
  }

  spawnProjectile(opts) {
    const p = new Projectile(opts);
    this.projectiles.push(p);
    // Cues are named after the projectile kind, so a new kind is silent until
    // it is given a sound rather than borrowing a wrong one.
    this.sound(p.team === 'enemy' ? `enemy-${p.kind}` : p.kind, p.pos.x, p.pos.y);
  }

  spawnBlast(x, y, radius) {
    this.effects.push({ kind: 'blast', x, y, radius, life: 0.35, maxLife: 0.35, delay: 0 });
  }

  /**
   * A structure coming apart: a shockwave ring plus a short burst of staggered
   * puffs around the footprint.
   *
   * Deliberately more than one `spawnBlast`: losing a building is a significant
   * event and needs to be noticeable at a glance across a busy field, without
   * being confused for an ordinary projectile hit.
   */
  spawnExplosion(x, y, size = 24) {
    this.effects.push({
      kind: 'ring', x, y, radius: size * 2.6,
      life: 0.55, maxLife: 0.55, delay: 0,
    });
    const puffs = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * size * 0.75;
      this.effects.push({
        kind: 'blast',
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        radius: size * (0.5 + Math.random() * 0.55),
        life: 0.4,
        maxLife: 0.4,
        // Staggered so the wreck keeps cooking off rather than flashing once.
        delay: i * 0.055 + Math.random() * 0.03,
        // Debris after the first puff; reduced effects skip it.
        minor: i > 0,
      });
    }
  }

  applyDamage(target, damage, splash, at) {
    target.damage?.(damage);
    if (splash > 0 && at) {
      for (const e of this.enemiesInRange(at.x, at.y, splash)) {
        if (e === target) continue;
        // Linear falloff from the centre of the blast.
        const f = 1 - Vec2.dist(at, e.pos) / splash;
        e.damage?.(damage * Math.max(0, f) * 0.6);
      }
    }
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;
    if (!this.gameOver) this.waves.update(dt);

    this.enemyHash.rebuild(this.enemies);
    this.grid.update(this.structures.filter((s) => s.alive), dt);

    for (const a of this.asteroids) a.update(dt);
    for (const s of this.structures) if (s.alive) s.update(dt, this);
    for (const b of this.bots) if (b.alive) b.update(dt, this);
    for (const e of this.enemies) if (e.alive) e.update(dt, this);
    for (const p of this.projectiles) if (p.alive) p.update(dt, this);

    for (const fx of this.effects) {
      // Staggered puffs wait their turn before they start ageing.
      if (fx.delay > 0) fx.delay -= dt;
      else fx.life -= dt;
    }
    this.effects = this.effects.filter((f) => f.life > 0);

    this.economy.update(dt);

    if (this.structures.some((s) => !s.alive)) {
      for (const s of this.structures) {
        if (!s.alive) {
          // Selling routes through sellStructure, which removes the structure
          // before this scan runs — so only combat losses reach here and blow up.
          this.spawnExplosion(s.pos.x, s.pos.y, s.radius * 1.15);
          this.sound('lost', s.pos.x, s.pos.y);
          this.structuresLost++;
          this.onStructureDestroyed?.(s);
        }
      }
      this._cleanupStructures();
    }

    // The run ends only when nothing is left standing.
    if (this.structures.length === 0) this.gameOver = true;

    // Pay bounties for anything that died this tick before clearing it out.
    for (const e of this.enemies) {
      if (!e.alive) {
        this.kills++;
        this.economy.refund(e.bounty ?? 0);
        this.spawnBlast(e.pos.x, e.pos.y, e.radius * 2.2);
        this.sound('kill', e.pos.x, e.pos.y);
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);
    this.projectiles = this.projectiles.filter((p) => p.alive);

    for (const b of this.bots) {
      if (!b.alive) {
        this.spawnBlast(b.pos.x, b.pos.y, 14);
        this.sound('impact', b.pos.x, b.pos.y);
      }
    }
    this.bots = this.bots.filter((b) => b.alive);
  }
}
