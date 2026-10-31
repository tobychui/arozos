import { Enemy } from '../Enemy.js';

/**
 * Fighter — the baseline hostile.
 *
 * Fast and fragile, dangerous only in numbers. Weaves slightly while closing so
 * a line of turrets does not simply mow down a rigid column.
 */
export class Fighter extends Enemy {
  constructor(x, y, def) {
    super(x, y, def, 'fighter');
    this._weave = Math.random() * Math.PI * 2;
  }

  moveToward(pt, dt) {
    this._weave += dt * 2.2;
    const dir = { x: pt.x - this.pos.x, y: pt.y - this.pos.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    dir.x /= len;
    dir.y /= len;
    // Small sideways drift, perpendicular to the approach vector.
    const px = -dir.y;
    const py = dir.x;
    const w = Math.sin(this._weave) * 0.35;
    this.pos.x += (dir.x + px * w) * this.speed * dt;
    this.pos.y += (dir.y + py * w) * this.speed * dt;
    this.angle = Math.atan2(dir.y, dir.x);
  }
}
