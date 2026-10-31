/**
 * Spawn director.
 *
 * Alternates between a build window and an active wave. The window is the whole
 * point of the pacing: waves are telegraphed with both their bearing and their
 * composition, so preparing is a decision rather than a guess. Nothing spawns
 * until you have had time to look at it.
 *
 * Once the scripted list runs out it scales endlessly, which is what the
 * survival mode runs on.
 */
export class WaveDirector {
  constructor(data, world) {
    this.data = data;
    this.world = world;
    const w = data.waves ?? {};
    this.list = w.list ?? [];
    this.buildWindow = w.buildWindow ?? 25;
    // The opening window is much longer: there is nothing built yet, and the
    // first minutes are where a base is actually established.
    this.firstWindow = w.firstWindow ?? this.buildWindow;
    this.endless = w.endless ?? { after: 10, hpScale: 1.12, countScale: 1.08 };

    this.waveIndex = 0;       // how many waves have been launched
    this.state = 'building';  // 'building' | 'active'
    this.timer = this.firstWindow;

    // Late waves arrive from several directions at once, so a single wall of
    // turrets stops being a complete answer.
    this.multiFrom = w.multiDirectionFrom ?? 12;
    this.maxDirections = w.maxDirections ?? 4;
    this.bearings = this._rollBearings(1);
    this.queue = [];          // pending spawns for the active wave
    this._spawnTimer = 0;
    this.onWaveStart = null;
    this.onWaveClear = null;
    // Sandbox: the build-window countdown is held, so waves arrive only when
    // called. An active wave still plays out normally.
    this.frozen = false;
  }

  /** Composition of wave n (1-based), scaling past the scripted list. */
  compositionFor(n) {
    if (n <= this.list.length) {
      return this._parse(this.list[n - 1].spawn);
    }
    // Beyond the script: replay the last entry with growing counts.
    const base = this._parse(this.list[this.list.length - 1].spawn);
    const over = n - this.list.length;
    const mult = Math.pow(this.endless.countScale ?? 1.08, over);
    return base.map((e) => ({ type: e.type, count: Math.ceil(e.count * mult) }));
  }

  /** Extra hit points multiplier applied to ships past the scripted list. */
  hpScaleFor(n) {
    if (n <= this.list.length) return 1;
    return Math.pow(this.endless.hpScale ?? 1.12, n - this.list.length);
  }

  _parse(spawn) {
    // Entries look like "fighter x4".
    return (spawn ?? []).map((s) => {
      const [type, count] = s.split(/\s*x\s*/i);
      return { type: type.trim(), count: parseInt(count, 10) || 1 };
    });
  }

  /** How many separate approach vectors wave `n` uses. */
  directionsFor(n) {
    if (n <= this.multiFrom) return 1;
    // One extra direction every six waves past the threshold.
    const extra = 1 + Math.floor((n - this.multiFrom - 1) / 6);
    return Math.min(this.maxDirections, 1 + extra);
  }

  /**
   * Pick `count` bearings spread around the field.
   *
   * Evenly spaced with jitter rather than fully random: two attacks arriving
   * from nearly the same angle would read as one, and the point of multiple
   * directions is to actually split the player's attention.
   */
  _rollBearings(count) {
    const base = Math.random() * Math.PI * 2;
    const step = (Math.PI * 2) / count;
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(base + i * step + (Math.random() - 0.5) * step * 0.35);
    }
    return out;
  }

  /** First bearing, for callers that only need a single representative angle. */
  get bearing() {
    return this.bearings[0] ?? 0;
  }

  get nextWaveNumber() {
    return this.waveIndex + 1;
  }

  get nextComposition() {
    return this.compositionFor(this.nextWaveNumber);
  }

  /** Skip the remaining build window — for players who are ready early. */
  callWaveNow() {
    if (this.state === 'building') this.timer = 0;
  }

  startWave() {
    this.waveIndex++;
    this.state = 'active';
    this.bearings = this._rollBearings(this.directionsFor(this.waveIndex));

    const comp = this.compositionFor(this.waveIndex);
    this.queue = [];
    for (const { type, count } of comp) {
      for (let i = 0; i < count; i++) this.queue.push(type);
    }
    // Interleave so each direction gets a mix of ship types rather than one
    // bearing delivering every exploder.
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this._spawnIndex = 0;
    this._spawnTimer = 0;
    this.onWaveStart?.(this.waveIndex, comp);
  }

  update(dt) {
    if (this.state === 'building') {
      if (!this.frozen) this.timer -= dt;
      if (this.timer <= 0) this.startWave();
      return;
    }

    // Trickle spawns in rather than dumping the whole wave at one point.
    if (this.queue.length) {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0) {
        this._spawnTimer = 0.28;
        this._spawnOne(this.queue.shift());
      }
      return;
    }

    if (this.world.enemies.length === 0) {
      this.state = 'building';
      this.timer = this.buildWindow;
      // Roll the next wave's bearings now, so the build window telegraphs the
      // directions the player is actually about to face.
      this.bearings = this._rollBearings(this.directionsFor(this.nextWaveNumber));
      this.onWaveClear?.(this.waveIndex);
    }
  }

  _spawnOne(type) {
    // Round-robin across the telegraphed bearings so every direction gets a
    // steady trickle rather than one arriving long after the others.
    const bearing = this.bearings[this._spawnIndex++ % this.bearings.length];
    const spread = 0.28;
    const a = bearing + (Math.random() - 0.5) * spread;
    const r = this.world.fieldRadius + 320;
    const e = this.world.spawnEnemy(type, Math.cos(a) * r, Math.sin(a) * r);
    if (e) {
      const scale = this.hpScaleFor(this.waveIndex);
      if (scale > 1) {
        e.maxHp = Math.round(e.maxHp * scale);
        e.hp = e.maxHp;
      }
    }
  }
}
