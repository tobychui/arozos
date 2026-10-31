/**
 * Uniform-grid spatial hash for radius queries.
 *
 * Almost every system in this game asks "what is within R of here?" — mining,
 * turret targeting, repair, splash damage, power-grid links. Doing that by
 * scanning every entity is O(n^2) and is the usual reason browser RTS games
 * stutter once the field fills up. Bucketing by cell makes it near O(1).
 *
 * Rebuilt each tick for moving entities; static ones can live in their own
 * long-lived instance and simply never be cleared.
 */
export class SpatialHash {
  constructor(cellSize = 128) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  _key(cx, cy) {
    // Cantor-ish pairing into a single number: faster than string keys.
    return cx * 73856093 ^ cy * 19349663;
  }

  clear() {
    this.cells.clear();
  }

  insert(entity) {
    const cx = Math.floor(entity.pos.x / this.cellSize);
    const cy = Math.floor(entity.pos.y / this.cellSize);
    const k = this._key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(entity);
  }

  rebuild(entities) {
    this.clear();
    for (const e of entities) if (e.alive) this.insert(e);
  }

  /**
   * All entities whose centre lies within `radius` of (x,y).
   * @param {(e:any)=>boolean} [filter]
   */
  query(x, y, radius, filter) {
    const out = [];
    const cs = this.cellSize;
    const minX = Math.floor((x - radius) / cs);
    const maxX = Math.floor((x + radius) / cs);
    const minY = Math.floor((y - radius) / cs);
    const maxY = Math.floor((y + radius) / cs);
    const r2 = radius * radius;

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(this._key(cx, cy));
        if (!bucket) continue;
        for (const e of bucket) {
          if (!e.alive) continue;
          const dx = e.pos.x - x;
          const dy = e.pos.y - y;
          if (dx * dx + dy * dy > r2) continue;
          if (filter && !filter(e)) continue;
          out.push(e);
        }
      }
    }
    return out;
  }

  /** Nearest entity to (x,y) within radius, or null. */
  nearest(x, y, radius, filter) {
    let best = null;
    let bestD2 = Infinity;
    for (const e of this.query(x, y, radius, filter)) {
      const dx = e.pos.x - x;
      const dy = e.pos.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }
}
