/**
 * Samples a run over time for the end-of-run report.
 *
 * Snapshot values (minerals, kill and loss counts, structures standing) are read
 * at each sample; power is averaged across the interval instead, because supply
 * and demand swing every tick with turret activity and a single reading would
 * be noise.
 *
 * Memory stays bounded on long runs: when the buffer fills, neighbouring
 * samples merge and the interval doubles, so an hour-long survival run keeps
 * the same resolution *per chart pixel* as a five-minute one.
 */
export class StatsRecorder {
  constructor(world, interval = 1, maxSamples = 600) {
    this.world = world;
    this.interval = interval;
    this.maxSamples = maxSamples;

    /** @type {{t:number, banked:number, mined:number, kills:number, lost:number,
     *          standing:number, supply:number, demand:number}[]} */
    this.samples = [];
    /** Wave launches, for markers on the charts. */
    this.waves = [];
    /** Seconds any powered island spent overdrawn. */
    this.overdrawnTime = 0;
    this.duration = 0;

    this._acc = 0;
    this._supply = 0;
    this._demand = 0;
    this._lastWave = world.waves?.waveIndex ?? 0;
    this._sample();
  }

  update(dt) {
    const w = this.world;
    this.duration += dt;
    this._acc += dt;
    this._supply += w.grid.supply * dt;
    this._demand += w.grid.demand * dt;
    // Only islands that have a generator: a cut-off structure sits at 0% too,
    // but that is isolation, not a supply shortfall.
    if (w.grid.islands.some((i) => i.hasSource && i.overdrawn)) this.overdrawnTime += dt;

    const wi = w.waves?.waveIndex ?? 0;
    if (wi !== this._lastWave) {
      this._lastWave = wi;
      this.waves.push({ t: w.time, n: wi });
    }
    if (this._acc >= this.interval) this._sample();
  }

  /** Take a closing sample so the charts end exactly where the run did. */
  finish() {
    if (this._acc > 0) this._sample();
  }

  _sample() {
    const w = this.world;
    const span = this._acc || 1;
    this.samples.push({
      t: w.time,
      banked: Math.floor(w.economy.minerals),
      mined: Math.floor(w.economy.totalMined),
      kills: w.kills,
      lost: w.structuresLost,
      standing: w.structures.filter((s) => s.alive).length,
      supply: this._acc ? this._supply / span : w.grid.supply,
      demand: this._acc ? this._demand / span : w.grid.demand,
    });
    this._acc = 0;
    this._supply = 0;
    this._demand = 0;
    if (this.samples.length > this.maxSamples) this._compress();
  }

  _compress() {
    const s = this.samples;
    // The opening sample is kept as-is so every chart still starts at zero.
    const out = [s[0]];
    for (let i = 1; i < s.length; i += 2) {
      const a = s[i];
      const b = s[i + 1];
      if (!b) { out.push(a); break; }
      // Counters and balances keep the later reading; power averages.
      out.push({ ...b, supply: (a.supply + b.supply) / 2, demand: (a.demand + b.demand) / 2 });
    }
    this.samples = out;
    this.interval *= 2;
  }
}
