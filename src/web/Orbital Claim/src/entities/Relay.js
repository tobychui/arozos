import { Structure } from './Structure.js';

/**
 * Energy relay — cheap grid extender with a hard link cap.
 *
 * The 6-link limit is the whole point: it turns "run power out to that far
 * cluster" into a real decision about trunk lines and chokepoints, and it makes
 * the grid something an attacker can meaningfully cut.
 */
export class Relay extends Structure {
  constructor(x, y, def) {
    super(x, y, def, 'relay');
  }

  get maxLinks() {
    return this.def.maxLinks ?? 6;
  }
}
