let nextId = 1;

/**
 * Base for anything that exists in the world and can be queried by position.
 *
 * Kept intentionally thin: a position, a radius, a liveness flag and an update
 * hook. Everything domain-specific belongs in a subclass so systems can stay
 * generic (the spatial hash only needs `pos` and `alive`).
 */
export class Entity {
  constructor(x, y, radius = 16) {
    this.id = nextId++;
    this.pos = { x, y };
    this.radius = radius;
    this.alive = true;
    this.team = 'neutral'; // 'player' | 'enemy' | 'neutral'
  }

  /** @param {number} dt seconds — always the loop's fixed step */
  update(dt, world) {}

  destroy() {
    this.alive = false;
  }

  /** Circle hit test in world space, used for selection and collisions. */
  contains(x, y, slack = 0) {
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    const r = this.radius + slack;
    return dx * dx + dy * dy <= r * r;
  }
}
