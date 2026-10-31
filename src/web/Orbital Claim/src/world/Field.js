import { rng } from '../core/Vec2.js';
import { Asteroid } from '../entities/Asteroid.js';

/**
 * Asteroid field generation.
 *
 * Clustered rather than uniform, because a uniform scatter makes every spot
 * equally good and placement stops mattering. Clusters create genuinely
 * desirable ground, and richer clusters are pushed further from the hub so that
 * expanding is what exposes you.
 *
 * Seeded so a given seed always produces the same field — useful for sharing a
 * layout and for reproducing balance problems.
 */
export class Field {
  /**
   * @param {number} seed
   * @param {object} opts { radius, clusters, hubClearing }
   */
  static generate(seed = 1337, opts = {}) {
    const rand = rng(seed);
    const radius = opts.radius ?? 1600;
    const clusterCount = opts.clusters ?? 14;
    const clearing = opts.hubClearing ?? 260;

    const asteroids = [];
    const sprites = ['asteroid-a', 'asteroid-b', 'asteroid-c'];

    for (let c = 0; c < clusterCount; c++) {
      // Bias clusters outward: sqrt gives an even area distribution, and we
      // push past the hub clearing so the start is defensible but poor.
      const t = 0.25 + 0.75 * Math.sqrt(rand());
      const dist = clearing + t * (radius - clearing);
      const ang = rand() * Math.PI * 2;
      const cx = Math.cos(ang) * dist;
      const cy = Math.sin(ang) * dist;

      const spread = 90 + rand() * 130;
      const count = 3 + Math.floor(rand() * 6);
      // Richness scales with distance from home.
      const richness = 0.45 + 0.55 * (dist / radius);

      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * spread;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (Math.hypot(x, y) < clearing) continue;

        const ore = Math.round((900 + rand() * 2700) * richness);
        const sprite = sprites[Math.floor(rand() * sprites.length)];
        asteroids.push(new Asteroid(x, y, ore, sprite));
      }
    }

    // A few lean rocks near home so the opening has something to work.
    for (let i = 0; i < 7; i++) {
      const ang = rand() * Math.PI * 2;
      const r = clearing + rand() * 170;
      asteroids.push(
        new Asteroid(
          Math.cos(ang) * r,
          Math.sin(ang) * r,
          Math.round(660 + rand() * 780),
          sprites[Math.floor(rand() * sprites.length)]
        )
      );
    }

    return { asteroids, radius, seed };
  }
}
