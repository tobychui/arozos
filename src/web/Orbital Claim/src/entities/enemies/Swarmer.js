import { Enemy } from '../Enemy.js';

/**
 * Swarmer — tiny, quick, and always in a pack.
 *
 * Individually trivial. The point of them is to punish defences built purely
 * from single-target turrets, since a laser can only kill one at a time no
 * matter how hard it hits.
 */
export class Swarmer extends Enemy {
  constructor(x, y, def) {
    super(x, y, def, 'swarmer');
    // Slight per-ship speed variance so a pack spreads into a cloud rather
    // than moving as one rigid block.
    this.speed *= 0.85 + Math.random() * 0.3;
  }
}
