import { Structure } from './Structure.js';

/**
 * Battery bank — stores surplus power and covers deficits.
 *
 * This is the buffer between "everything is fine" and the brownout rule. A
 * turret volley or a building site briefly overdrawing the grid should not
 * instantly slow the whole base; batteries absorb that spike and only once they
 * are flat does `supplyRatio` start dropping. It turns a hard cliff into a
 * warning you can act on.
 *
 * Charge and discharge for the tick are set by PowerGrid, which is the only
 * thing that can see the whole network's balance.
 */
export class Battery extends Structure {
  constructor(x, y, def) {
    super(x, y, def, 'battery');
    this.capacity = def.capacity ?? 240;
    this.stored = 0;
    this.chargeRate = def.chargeRate ?? 14;
    this.dischargeRate = def.dischargeRate ?? 30;

    // Set per tick by the grid.
    this._charging = 0;
    this._discharging = 0;
  }

  get fraction() {
    return this.capacity > 0 ? this.stored / this.capacity : 0;
  }

  /** Capacity and throughput are this class's own fields, so extend the base. */
  applyUpgradeStats(u) {
    super.applyUpgradeStats(u);
    if (u.capacity !== undefined) this.capacity = u.capacity;
    if (u.chargeRate !== undefined) this.chargeRate = u.chargeRate;
    if (u.dischargeRate !== undefined) this.dischargeRate = u.dischargeRate;
    // Existing charge is kept, not scaled: the bank gets bigger, not fuller.
    this.stored = Math.min(this.stored, this.capacity);
  }

  /** Power it can give this tick, limited by both rate and remaining charge. */
  availableOutput(dt) {
    if (!this.isBuilt || !this.connected) return 0;
    return Math.min(this.dischargeRate, dt > 0 ? this.stored / dt : 0);
  }

  /** Headroom it can absorb this tick. */
  availableIntake(dt) {
    if (!this.isBuilt || !this.connected) return 0;
    const room = this.capacity - this.stored;
    return Math.min(this.chargeRate, dt > 0 ? room / dt : 0);
  }

  charge(power, dt) {
    this.stored = Math.min(this.capacity, this.stored + power * dt);
    this._charging = power;
    this._discharging = 0;
  }

  discharge(power, dt) {
    this.stored = Math.max(0, this.stored - power * dt);
    this._discharging = power;
    this._charging = 0;
  }

  idle() {
    this._charging = 0;
    this._discharging = 0;
  }

  // A battery is a consumer while charging and a source while discharging, so
  // the grid's flow model reads it correctly in both directions.
  get currentDraw() {
    return this._charging;
  }

  get currentOutput() {
    return this._discharging;
  }

  update(dt, world) {
    super.update(dt, world);
    // Activity drives the link animation: a working battery should look busy.
    this.targetActivity = this._charging || this._discharging ? 1 : 0;
  }
}
