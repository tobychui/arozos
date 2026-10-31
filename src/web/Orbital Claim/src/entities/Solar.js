import { Structure } from './Structure.js';

/**
 * Solar station — a power source and a grid anchor.
 *
 * Accepts many more links than a relay, so solars naturally become the hubs of
 * your network while relays are the cheap spokes between them.
 */
export class Solar extends Structure {
  constructor(x, y, def) {
    super(x, y, def, 'solar');
    this.isSource = true;
    this.spin = 0;
  }

  get maxLinks() {
    return this.def.maxLinks ?? 12;
  }

  /**
   * Nothing until it is finished, and nothing while being upgraded — the array
   * is stripped down during the work.
   *
   * That makes an upgrade a real decision rather than free: pulling a generator
   * offline can brown out the grid, and on an island where this is the only
   * source the upgrade would never finish. The panel therefore offers a cancel,
   * which is the escape hatch for exactly that case.
   */
  get currentOutput() {
    if (!this.isBuilt || this.disabled || this.upgrading) return 0;
    return this.powerOutput;
  }

  update(dt, world) {
    super.update(dt, world);
    if (this.isBuilt) this.spin += dt * 0.6;
  }
}
