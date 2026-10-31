import { Enemy } from '../Enemy.js';

/**
 * Mothership — the wave boss.
 *
 * Tanky and slow, and it keeps launching swarmers while it closes. That turns
 * it into a soft time limit: ignore it and you drown in escorts, so it has to
 * be focused down even though it is the hardest thing to kill.
 */
export class Mothership extends Enemy {
  constructor(x, y, def) {
    super(x, y, def, 'mothership');
    const s = def.spawns ?? {};
    this.spawnType = s.type ?? 'swarmer';
    this.spawnEvery = s.every ?? 4;
    this.spawnCount = s.count ?? 2;
    this._spawnTimer = this.spawnEvery;
    this.pulse = 0;
  }

  update(dt, world) {
    super.update(dt, world);
    this.pulse = (this.pulse + dt * 0.9) % 1;

    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return;
    this._spawnTimer = this.spawnEvery;

    for (let i = 0; i < this.spawnCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.radius + 12;
      world.spawnEnemy(
        this.spawnType,
        this.pos.x + Math.cos(a) * r,
        this.pos.y + Math.sin(a) * r
      );
    }
  }
}
