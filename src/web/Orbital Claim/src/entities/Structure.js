import { Entity } from './Entity.js';

/**
 * Base for every player-built structure.
 *
 * Owns the concerns shared by all buildings: hit points, build-out time, power
 * draw and grid membership. Two ideas from the design live here:
 *
 *  - `powered` / `supplyRatio`. Power is a live supply-vs-demand balance rather
 *    than a stockpile. When the grid is overdrawn every consumer runs at the
 *    same fraction, so a mistake shows up as everything slowing down together
 *    rather than as a sudden failure.
 *  - `buildProgress`. Structures are not instantly useful, which is what gives
 *    the telegraphed build window between waves its meaning.
 */
export class Structure extends Entity {
  /**
   * @param {number} x @param {number} y
   * @param {object} def entry from assets/entities.json → buildings
   * @param {string} key def key, e.g. 'miner'
   */
  constructor(x, y, def, key) {
    super(x, y, def.radius ?? 18);
    this.team = 'player';
    this.key = key;
    this.def = def;
    this.name = def.name;
    this.sprite = def.sprite;

    this.maxHp = def.hp ?? 100;
    this.hp = this.maxHp;

    // Power: positive `power` in the data means production, negative is draw.
    this.powerOutput = Math.max(0, def.power ?? 0);
    this.powerDraw = Math.max(0, -(def.power ?? 0));

    this.buildTime = def.buildTime ?? 0;
    this.buildProgress = this.buildTime > 0 ? 0 : 1;

    this.links = new Set();   // grid neighbours, maintained by PowerGrid
    this.connected = false;   // reachable from a power source?
    this.supplyRatio = 1;     // 0..1, set by PowerGrid each tick
    this.selected = false;

    // How hard this structure is working right now, 0..1. Subclasses set
    // `targetActivity`; the smoothing below is what `activity` follows.
    //
    // Draw is not constant: an idle turret trickles, a firing one spikes. That
    // makes the grid readable at a glance — but it also means demand feeds back
    // into supplyRatio, which feeds back into how hard things work. Smoothing
    // breaks that loop so the network settles instead of oscillating.
    this.activity = 0;
    this.targetActivity = 0;
    this.idleFactor = def.idleFactor ?? 0.35;

    // Assembling a structure consumes power in its own right, so a build site
    // is a real load on the grid rather than a free timer.
    this.buildPower = def.buildPower ?? 6;

    // Manually switched off by the player. Keeps the structure standing and on
    // the grid, but stops it working or drawing.
    this.disabled = false;
    // Sandbox switch, set by the world: damage is ignored.
    this.invulnerable = false;

    // Two shapes of upgrade track.
    //  `upgrades`     — a single linear ladder (solar, battery).
    //  `upgradePaths` — mutually exclusive branches, each with its own tiers.
    // Branching is a real commitment: the first upgrade picks a path and the
    // structure is locked to it, so a laser is either a brawler or a sniper and
    // never quietly becomes both.
    this.level = 1;
    this.upgrades = def.upgrades ?? [];
    this.upgradePaths = def.upgradePaths ?? null;
    this.upgradePath = null;
    this.upgrading = false;
    this.upgradeProgress = 0;
    // Total minerals sunk in, so a refund reflects upgrades too.
    this.invested = def.cost ?? 0;

    // Concentric rings drawn around the structure to show tier. Used where an
    // upgrade has no natural silhouette change — a faster beam or a faster
    // drill looks identical otherwise. Paths that *do* change shape (longer
    // barrels, extra tubes) swap the sprite instead and leave this at zero.
    this.rings = 0;
  }

  /**
   * What can be bought right now.
   * @returns {{pathKey:string|null, pathName:string, pathDesc:string, tier:object}[]}
   */
  get upgradeOptions() {
    if (this.upgradePaths) {
      if (!this.upgradePath) {
        // Nothing chosen yet: every branch's first tier is on the table.
        return Object.entries(this.upgradePaths)
          .map(([pathKey, p]) => ({
            pathKey, pathName: p.name, pathDesc: p.desc ?? '', tier: p.tiers?.[0],
          }))
          .filter((o) => o.tier);
      }
      const p = this.upgradePaths[this.upgradePath];
      const tier = p?.tiers?.[this.level - 1];
      return tier
        ? [{ pathKey: this.upgradePath, pathName: p.name, pathDesc: p.desc ?? '', tier }]
        : [];
    }
    const tier = this.upgrades[this.level - 1];
    return tier ? [{ pathKey: null, pathName: '', pathDesc: '', tier }] : [];
  }

  get canUpgrade() {
    return this.isBuilt && !this.upgrading && this.upgradeOptions.length > 0;
  }

  /** First available tier. Kept for callers that do not care about branches. */
  get nextUpgrade() {
    return this.upgradeOptions[0]?.tier ?? null;
  }

  get maxLevel() {
    if (this.upgradePaths) {
      const lens = Object.values(this.upgradePaths).map((p) => p.tiers?.length ?? 0);
      return 1 + Math.max(0, ...lens);
    }
    return this.upgrades.length + 1;
  }

  /** Human-readable branch name, for the inspect panel. */
  get pathName() {
    return this.upgradePath ? this.upgradePaths?.[this.upgradePath]?.name ?? '' : '';
  }

  /**
   * Begin an upgrade. The structure keeps operating throughout, deliberately:
   * taking a solar offline while it upgrades could cut the very power the
   * upgrade needs to finish, deadlocking a base with a single generator.
   */
  /**
   * @param {object} economy
   * @param {string|null} [pathKey] which branch to take; defaults to the only
   *   option when there is just one.
   */
  startUpgrade(economy, pathKey = null) {
    if (!this.canUpgrade) return false;
    const opts = this.upgradeOptions;
    const opt = pathKey ? opts.find((o) => o.pathKey === pathKey) : opts[0];
    if (!opt) return false;
    if (!economy.spend(opt.tier.cost ?? 0)) return false;

    this.invested += opt.tier.cost ?? 0;
    this.upgrading = true;
    this.upgradeProgress = 0;
    this._pendingUpgrade = opt.tier;
    this._pendingPath = opt.pathKey;
    return true;
  }

  /**
   * Apply an upgrade's stats. Subclasses extend this for the fields they own;
   * anything shared by every building is handled here.
   */
  applyUpgradeStats(u) {
    if (u.sprite) this.sprite = u.sprite;
    if (u.radius) this.radius = u.radius;
    if (u.hp) {
      // Preserve damage rather than free-healing on upgrade.
      const frac = this.hp / this.maxHp;
      this.maxHp = u.hp;
      this.hp = Math.max(1, u.hp * frac);
    }
    if (u.power !== undefined) {
      this.powerOutput = Math.max(0, u.power);
      this.powerDraw = Math.max(0, -u.power);
    }
    if (u.rings !== undefined) this.rings = u.rings;
    if (u.name) this.name = u.name;
    if (u.desc) this.def = { ...this.def, desc: u.desc };
  }

  /**
   * Abandon an in-progress upgrade, refunding the unspent portion.
   *
   * This is the way out of an otherwise unrecoverable state: a solar produces
   * nothing while upgrading, so upgrading the only generator on an island drops
   * its supply to zero, which stalls the very upgrade that caused it.
   */
  cancelUpgrade(economy) {
    if (!this.upgrading) return false;
    const u = this._pendingUpgrade;
    const cost = u?.cost ?? 0;
    const unspent = Math.floor(cost * (1 - this.upgradeProgress));
    economy?.refund(unspent);
    this.invested -= unspent;
    this.upgrading = false;
    this.upgradeProgress = 0;
    this._pendingUpgrade = null;
    this._pendingPath = null;
    return true;
  }

  _tickUpgrade(dt) {
    const u = this._pendingUpgrade;
    if (!u) {
      this.upgrading = false;
      return;
    }
    const rate = this.connected ? this.supplyRatio : 0;
    this.upgradeProgress += (dt * rate) / (u.time ?? 3);
    if (this.upgradeProgress < 1) return;
    this.finishUpgrade();
  }

  /**
   * Install the pending upgrade now. Normally reached when progress fills;
   * the sandbox calls it straight after purchase for instant upgrades.
   */
  finishUpgrade() {
    const u = this._pendingUpgrade;
    if (!u) return;
    this.applyUpgradeStats(u);
    // Committing to a branch happens on completion, not on purchase, so a
    // cancelled first upgrade leaves the choice open.
    if (this._pendingPath) this.upgradePath = this._pendingPath;
    this.level++;
    this.upgrading = false;
    this.upgradeProgress = 0;
    this._pendingUpgrade = null;
    this._pendingPath = null;
  }

  /** True for weapons that consume minerals per shot. */
  get isLauncher() {
    return (this.def.ammoCost ?? 0) > 0;
  }

  /**
   * Instantaneous power draw. `powerDraw` from the data is the *peak*; idle
   * structures pull `idleFactor` of it. Construction always draws in full,
   * which is what makes a building site light its supply line up.
   */
  get currentDraw() {
    // Construction draws even for structures that consume nothing once done: a
    // solar or a battery still has to be assembled.
    if (!this.isBuilt) return (this.powerDraw || 0) + this.buildPower;
    // Upgrading is the same deal — the work itself is a load on the grid.
    const work = this.upgrading ? this.buildPower : 0;
    if (this.disabled || !this.powerDraw) return work;
    return work +
      this.powerDraw * (this.idleFactor + (1 - this.idleFactor) * this.activity);
  }

  /** Power exported this tick. Sources and batteries override this. */
  get currentOutput() {
    return 0;
  }

  get isBuilt() {
    return this.buildProgress >= 1;
  }

  /** Structures only work when finished, on the grid, and receiving power. */
  get powered() {
    return this.isBuilt && !this.disabled && this.connected && this.supplyRatio > 0;
  }

  get maxLinks() {
    return this.def.maxLinks ?? 6;
  }

  update(dt, world) {
    if (!this.isBuilt) {
      // Gated on supply: an unpowered or browned-out site builds slowly or not
      // at all, rather than completing for free.
      const rate = this.connected ? this.supplyRatio : 0;
      this.buildProgress = Math.min(1, this.buildProgress + (dt * rate) / this.buildTime);
      this.targetActivity = 1;
      if (this.isBuilt) world.sound('built', this.pos.x, this.pos.y);
    } else if (this.upgrading) {
      const level = this.level;
      this._tickUpgrade(dt);
      this.targetActivity = 1;
      if (this.level !== level) world.sound('upgraded', this.pos.x, this.pos.y);
    }
    // Ease toward the target so draw changes are gradual and the grid animation
    // reads as a swell rather than a strobe.
    const k = 1 - Math.exp(-6 * dt);
    this.activity += (this.targetActivity - this.activity) * k;
  }

  damage(amount) {
    if (!this.alive || this.invulnerable) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy();
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * Minerals returned when sold. Based on total invested rather than the base
   * cost, so upgrading and then repositioning is not silently punished.
   * Lasers refund fully by design.
   */
  refundValue() {
    const ratio = this.def.refundRatio ?? 0.6;
    return Math.floor(this.invested * ratio * this.buildProgress);
  }
}
