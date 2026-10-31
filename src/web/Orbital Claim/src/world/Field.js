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
   * @param {object} opts
   * @param {number} [opts.radius]
   * @param {number} [opts.clusters] number of outer clusters
   * @param {number} [opts.hubClearing] empty radius around the start
   * @param {number} [opts.richness] multiplier on every rock's ore
   * @param {number} [opts.homeRocks] lean rocks placed just outside the clearing
   * @param {number} [opts.minOre] the field is topped up with extra clusters
   *   until it holds at least this much ore in total
   */
  static generate(seed = 1337, opts = {}) {
    const rand = rng(seed);
    const radius = opts.radius ?? 1600;
    const clusterCount = opts.clusters ?? 14;
    const clearing = opts.hubClearing ?? 260;
    const richness = opts.richness ?? 1;
    const minOre = opts.minOre ?? 0;

    const asteroids = [];
    const sprites = ['asteroid-a', 'asteroid-b', 'asteroid-c'];
    let totalOre = 0;
    const add = (x, y, ore) => {
      asteroids.push(new Asteroid(x, y, ore, sprites[Math.floor(rand() * sprites.length)]));
      totalOre += ore;
    };

    const addCluster = () => {
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
      const depth = 0.45 + 0.55 * (dist / radius);

      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * spread;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (Math.hypot(x, y) < clearing) continue;
        add(x, y, Math.round((900 + rand() * 2700) * depth * richness));
      }
    };

    for (let c = 0; c < clusterCount; c++) addCluster();

    // A few lean rocks near home so the opening has something to work.
    const homeRocks = opts.homeRocks ?? 7;
    for (let i = 0; i < homeRocks; i++) {
      const ang = rand() * Math.PI * 2;
      const r = clearing + rand() * 170;
      add(Math.cos(ang) * r, Math.sin(ang) * r, Math.round((660 + rand() * 780) * richness));
    }

    // The guarantee: a mode that asks for a quota gets a field that can pay it,
    // whatever the seed rolled. Extra clusters rather than richer rocks, so a
    // short field still looks like every other one. The guard only matters for
    // absurd settings; one cluster is worth well over a thousand ore.
    let guard = 0;
    while (totalOre < minOre && guard++ < 200) addCluster();

    return { asteroids, radius, seed, totalOre };
  }
}
