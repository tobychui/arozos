import { Vec2 } from '../core/Vec2.js';

/**
 * The power network, modelled as independent islands.
 *
 * Structures link to neighbours within `linkRange`, subject to a per-structure
 * link cap (relays cap at 6, which is what forces trunk lines rather than a
 * blanket). Each connected component is then its own **island** with its own
 * supply, demand, batteries and brownout ratio — power never teleports between
 * separated halves of a base. Cut a trunk relay and the far side really does go
 * dark, which is the whole point of the link cap mattering.
 *
 * Within an island:
 *  1. A spanning tree is rooted once (preferring the hub, then any source) so
 *     other sources sit *inside* the tree and the edge above them carries what
 *     they export. Seeding from every source instead would leave each solar as
 *     a parentless root with nowhere to show its output.
 *  2. Flow on the edge above a node is the net of that node's whole subtree,
 *     signed: negative means the subtree consumes, positive means it produces.
 *  3. Batteries cover any deficit before `ratio` is allowed to fall, turning a
 *     brownout cliff into a warning.
 */
export class PowerGrid {
  constructor(linkRange = 170) {
    this.linkRange = linkRange;
    this.dirty = true;

    /** @type {Island[]} one per connected component */
    this.islands = [];

    // Totals across every island, for the top-level HUD readout.
    this.supply = 0;
    this.demand = 0;
    this.ratio = 1;
    this.maxLoad = 0;

    // Sandbox: any island with a finished source runs at full rate whatever
    // its demand. Connectivity still matters, so isolation can be debugged.
    this.unlimited = false;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Would a structure placed here reach the existing network? */
  wouldConnect(x, y, structures) {
    for (const s of structures) {
      if (!s.alive) continue;
      if (s.links.size >= s.maxLinks) continue;
      if (Vec2.within({ x, y }, s.pos, this.linkRange)) return true;
    }
    return false;
  }

  /** Structures a new node at (x,y) would link to, honouring link caps. */
  previewLinks(x, y, structures) {
    const near = structures
      .filter((s) => s.alive && Vec2.within({ x, y }, s.pos, this.linkRange))
      .sort((a, b) => Vec2.dist2({ x, y }, a.pos) - Vec2.dist2({ x, y }, b.pos));

    const out = [];
    for (const s of near) {
      if (s.links.size >= s.maxLinks) continue;
      out.push(s);
      if (out.length >= 6) break;
    }
    return out;
  }

  /** A node that can carry the network onward, rather than just hang off it. */
  static isCarrier(s) {
    return s.maxLinks > 1;
  }

  /**
   * Whether two structures may be wired together.
   *
   * Leaf-to-leaf is refused outright. Miners and weapons have a single link
   * each, so wiring two of them together burns both slots on a pair that can
   * never reach a generator — and since they are often placed side by side,
   * greedy closest-pair matching would do exactly that.
   */
  _canLink(a, b) {
    if (a === b || !a.alive || !b.alive) return false;
    if (a.links.has(b)) return false;
    if (a.links.size >= a.maxLinks || b.links.size >= b.maxLinks) return false;
    if (!PowerGrid.isCarrier(a) && !PowerGrid.isCarrier(b)) return false;
    return true;
  }

  /**
   * Relay-to-relay is the lowest-priority pairing.
   *
   * A relay exists to feed real buildings, so it should spend its slots on
   * miners, weapons and stations before chaining to another relay. Relay chains
   * still form freely once the useful neighbours are satisfied or capped, so the
   * grid can still be extended across open ground.
   */
  _pairPenalty(a, b) {
    return a.key === 'relay' && b.key === 'relay' ? 1 : 0;
  }

  /**
   * Top up the network without ever tearing it down.
   *
   * Rebuilding from scratch was the bug behind buildings going dark: clearing
   * every link and re-running a greedy match meant dropping one relay into a
   * crowded area reshuffled the whole neighbourhood, and any leaf that lost the
   * race for a capped slot was left stranded. Links are now only ever *added* —
   * existing ones are untouched except when the far end is gone.
   */
  rebuildTopology(structures) {
    // Drop links to destroyed structures; keep everything else exactly as is.
    for (const s of structures) {
      for (const n of [...s.links]) {
        if (!n.alive) s.links.delete(n);
      }
    }

    const pairs = [];
    for (let i = 0; i < structures.length; i++) {
      for (let j = i + 1; j < structures.length; j++) {
        const a = structures[i];
        const b = structures[j];
        if (!a.alive || !b.alive) continue;
        if (a.links.has(b)) continue;           // already wired
        const d2 = Vec2.dist2(a.pos, b.pos);
        if (d2 <= this.linkRange * this.linkRange) {
          pairs.push([this._pairPenalty(a, b), d2, a, b]);
        }
      }
    }

    // Useful pairings first, closest within each tier.
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

    for (const [, , a, b] of pairs) {
      if (!this._canLink(a, b)) continue;
      a.links.add(b);
      b.links.add(a);
    }
  }

  /**
   * Splice unpowered islands back onto a powered one wherever something is in
   * range with a spare link.
   *
   * This is what makes the grid self-healing: losing a relay mid-wave, or
   * dropping a fresh solar next to a stranded outpost, reconnects on its own
   * instead of leaving the player to spot the break and repair it by hand.
   *
   * @returns {boolean} true if any link was added
   */
  reconnectIslands() {
    const powered = [];
    const dark = [];
    for (const isle of this.islands) {
      const hasSource = isle.order.some((s) => s.isSource && s.isBuilt);
      (hasSource ? powered : dark).push(isle);
    }
    if (!powered.length || !dark.length) return false;

    const maxD2 = this.linkRange * this.linkRange;
    let added = false;

    for (const isle of dark) {
      let best = null;
      let bestPenalty = Infinity;
      let bestD2 = Infinity;
      for (const a of isle.order) {
        for (const p of powered) {
          for (const b of p.order) {
            const d2 = Vec2.dist2(a.pos, b.pos);
            if (d2 > maxD2) continue;
            // Same preference as the main pass: avoid burning a relay slot on
            // another relay when something more useful is reachable.
            const pen = this._pairPenalty(a, b);
            if (pen > bestPenalty || (pen === bestPenalty && d2 >= bestD2)) continue;
            if (!this._canLink(a, b)) continue;
            bestPenalty = pen;
            bestD2 = d2;
            best = [a, b];
          }
        }
      }
      if (best) {
        best[0].links.add(best[1]);
        best[1].links.add(best[0]);
        added = true;
      }
    }
    return added;
  }

  /** Partition into islands and build a spanning tree for each. */
  _findIslands(structures) {
    for (const s of structures) {
      s.gridParent = null;
      s.gridDepth = 0;
      s.gridId = null;
      s.island = null;
      s.flowToParent = 0;
      s.connected = false;
      s._seen = false;
    }

    this.islands = [];

    // Root at a generator where possible, so the tree flows outward from where
    // the power actually comes from.
    const starts = [...structures].sort(
      (a, b) => (b.isSource ? 1 : 0) - (a.isSource ? 1 : 0)
    );

    for (const start of starts) {
      if (start._seen || !start.alive) continue;

      const id = this.islands.length;
      const island = new Island(id);
      const order = [start];
      start._seen = true;
      start.gridId = id;
      start.island = island;

      for (let i = 0; i < order.length; i++) {
        const cur = order[i];
        for (const n of cur.links) {
          if (n._seen || !n.alive) continue;
          n._seen = true;
          n.gridParent = cur;
          n.gridDepth = cur.gridDepth + 1;
          n.gridId = id;
          n.island = island;
          order.push(n);
        }
      }

      island.order = order;
      this.islands.push(island);
    }
  }

  update(structures, dt = 1 / 60) {
    if (this.dirty) {
      this.rebuildTopology(structures);
      this.dirty = false;
    }
    this._findIslands(structures);

    // Self-heal: splice any stranded section back onto a powered one, then
    // re-partition so the merged result is what everything downstream sees.
    // Bounded in case a pathological layout keeps finding new links.
    for (let pass = 0; pass < 4 && this.reconnectIslands(); pass++) {
      this._findIslands(structures);
    }

    this.supply = 0;
    this.demand = 0;
    this.maxLoad = 0;

    for (const island of this.islands) {
      island.unlimited = this.unlimited;
      island.solve(dt);
      this.supply += island.supply;
      this.demand += island.demand;
      if (island.maxLoad > this.maxLoad) this.maxLoad = island.maxLoad;
    }

    this.ratio = this.unlimited || this.demand <= 0
      ? 1
      : Math.min(1, (this.supply + this.batteryOutput) / this.demand);
  }

  get batteryOutput() {
    return this.islands.reduce((a, i) => a + i.batteryOutput, 0);
  }

  get overdrawn() {
    return this.islands.some((i) => i.overdrawn);
  }

  get storedEnergy() {
    let stored = 0;
    let cap = 0;
    for (const island of this.islands) {
      stored += island.stored;
      cap += island.capacity;
    }
    return { stored, cap };
  }
}

/**
 * One electrically isolated section of the network.
 *
 * Everything about supply and brownout is scoped here rather than globally, so
 * a well-fed main base cannot prop up a severed outpost.
 */
export class Island {
  constructor(id) {
    this.id = id;
    /** @type {any[]} breadth-first, so children always follow their parent */
    this.order = [];
    this.supply = 0;
    this.demand = 0;
    this.batteryOutput = 0;
    this.batteryIntake = 0;
    this.stored = 0;
    this.capacity = 0;
    this.ratio = 1;
    this.hasSource = false;
    this.maxLoad = 0;
  }

  get overdrawn() {
    return this.ratio < 0.999;
  }

  solve(dt) {
    const batteries = [];
    this.supply = 0;
    this.demand = 0;
    this.stored = 0;
    this.capacity = 0;
    this.hasSource = false;

    for (const s of this.order) {
      // A source only counts once finished: a half-built solar generates
      // nothing, and neither does a half-built battery store anything.
      if (s.isSource && s.isBuilt) this.hasSource = true;
      if (s.key === 'battery') {
        batteries.push(s);
        if (s.isBuilt) {
          this.stored += s.stored;
          this.capacity += s.capacity;
        }
        continue; // its own draw is decided below
      }
      if (s.isSource) this.supply += s.currentOutput ?? 0;
      else this.demand += s.currentDraw;
    }

    // No finished source anywhere on this island means nothing here runs.
    for (const s of this.order) s.connected = this.hasSource;
    if (!this.hasSource) {
      for (const b of batteries) b.idle();
      for (const s of this.order) s.supplyRatio = 0;
      this.ratio = 0;
      this.batteryOutput = 0;
      this.batteryIntake = 0;
      this._computeFlow();
      return;
    }

    // Batteries stand between a spike and a brownout.
    this.batteryOutput = 0;
    this.batteryIntake = 0;

    if (this.unlimited) {
      for (const b of batteries) b.idle();
      this.ratio = 1;
      for (const s of this.order) s.supplyRatio = 1;
      this._computeFlow();
      return;
    }
    const deficit = this.demand - this.supply;

    if (deficit > 0.0001) {
      const avail = batteries.map((b) => b.availableOutput(dt));
      const total = avail.reduce((a, b) => a + b, 0);
      const drawn = Math.min(deficit, total);
      batteries.forEach((b, i) => {
        const share = total > 0 ? (avail[i] / total) * drawn : 0;
        if (share > 0) b.discharge(share, dt);
        else b.idle();
      });
      this.batteryOutput = drawn;
    } else {
      const room = batteries.map((b) => b.availableIntake(dt));
      const total = room.reduce((a, b) => a + b, 0);
      const used = Math.min(-deficit, total);
      batteries.forEach((b, i) => {
        const share = total > 0 ? (room[i] / total) * used : 0;
        if (share > 0) b.charge(share, dt);
        else b.idle();
      });
      this.batteryIntake = used;
    }

    this.ratio = this.demand > 0
      ? Math.min(1, (this.supply + this.batteryOutput) / this.demand)
      : 1;

    for (const s of this.order) s.supplyRatio = this.ratio;
    this._computeFlow();
  }

  /**
   * Tree flow: the edge above a node carries the net of its whole subtree.
   * Walking the breadth-first order backwards visits every child before its
   * parent, so the totals accumulate in one pass.
   */
  _computeFlow() {
    this.maxLoad = 0;
    for (const s of this.order) {
      s._sub = (s.currentOutput ?? 0) - s.currentDraw;
    }
    for (let i = this.order.length - 1; i >= 0; i--) {
      const s = this.order[i];
      s.flowToParent = s._sub;
      if (s.gridParent) {
        const mag = Math.abs(s._sub);
        if (mag > this.maxLoad) this.maxLoad = mag;
        s.gridParent._sub += s._sub;
      }
    }
  }
}
