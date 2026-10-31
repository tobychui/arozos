import { Entity } from './Entity.js';

/**
 * A mineable rock.
 *
 * Asteroids are finite. That single rule is what stops the game becoming static:
 * as nearby rocks run dry you are pushed outward into less defensible ground,
 * which is where the tension between economy and defence comes from.
 */
export class Asteroid extends Entity {
  /**
   * @param {number} x @param {number} y
   * @param {number} ore total minerals held
   * @param {string} sprite one of asteroid-a|b|c
   */
  constructor(x, y, ore, sprite = 'asteroid-a') {
    super(x, y, 0);
    this.team = 'neutral';
    this.sprite = sprite;
    this.maxOre = ore;
    this.ore = ore;

    // Bigger rocks hold more; radius is derived so the field reads at a glance.
    // Clamped so the richest deposits stay a sane size on screen.
    this.radius = 14 + Math.min(1, ore / 3000) * 16;
    this.spin = (Math.random() - 0.5) * 0.12;
    this.angle = Math.random() * Math.PI * 2;
    this.minersInRange = 0; // refreshed by miners each tick, for the HUD
    this.selected = false;
    this.name = 'Asteroid';
  }

  /** Percentage of the original deposit still in the rock. */
  get percentLeft() {
    return Math.round(this.fraction * 100);
  }

  get depleted() {
    return this.ore <= 0;
  }

  get fraction() {
    return this.maxOre > 0 ? this.ore / this.maxOre : 0;
  }

  /**
   * Remove up to `amount` ore.
   * @returns {number} how much was actually extracted
   */
  extract(amount) {
    const taken = Math.min(this.ore, amount);
    this.ore -= taken;
    return taken;
  }

  update(dt) {
    this.angle += this.spin * dt;
    this.minersInRange = 0;
  }
}
