/**
 * Minerals: income, spending and the storage cap.
 *
 * Keeps a short rolling history so the HUD can show income per second without
 * every miner having to report in. Overflow is tracked separately so the UI can
 * tell the player they are wasting yield and should build storage.
 */
export class Economy {
  constructor(cfg) {
    this.minerals = cfg?.start ?? 300;
    this.totalMined = 0;
    // Sandbox: everything is affordable and nothing is deducted.
    this.infinite = false;

    this._window = [];
    this._windowTime = 0;
    this.incomePerSec = 0;
  }

  addMinerals(amount) {
    if (amount <= 0) return 0;
    // Unbounded on purpose. A cap only ever produced busywork: rows of storage
    // depots placed to raise a number, with a nag when you forgot.
    this.minerals += amount;
    this.totalMined += amount;
    this._window.push(amount);
    return amount;
  }

  canAfford(cost) {
    return this.infinite || this.minerals >= cost;
  }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    if (this.infinite) return true;
    this.minerals -= cost;
    return true;
  }

  refund(amount) {
    this.minerals += amount;
  }

  update(dt) {
    this._windowTime += dt;
    if (this._windowTime >= 0.5) {
      const sum = this._window.reduce((a, b) => a + b, 0);
      this.incomePerSec = sum / this._windowTime;
      this._window.length = 0;
      this._windowTime = 0;
    }
  }
}
