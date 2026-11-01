/**
 * Coroutines for danmaku scripting.
 *
 * Stage, enemy and boss scripts are generator functions. Whatever they yield
 * decides when they resume:
 *   yield 30            resume 30 frames later (yield / yield 0 = next frame)
 *   yield () => cond    resume on the first frame cond() is true
 *   yield* other()      run another script inline (plain JS delegation)
 * A script that throws is logged and stopped instead of freezing the game.
 */
export class Task {
  constructor(gen, owner = null) {
    this.gen = gen;
    this.owner = owner;
    this.wait = 0;
    this.until = null;
    this.done = false;
  }

  step() {
    if (this.done) return;
    if (this.wait > 0) {
      this.wait--;
      if (this.wait > 0) return;
    }
    if (this.until) {
      if (!this.until()) return;
      this.until = null;
    }
    let r;
    try {
      r = this.gen.next();
    } catch (err) {
      console.error('[Yoru no Hana] script error', err);
      this.done = true;
      return;
    }
    if (r.done) {
      this.done = true;
      return;
    }
    const v = r.value;
    if (typeof v === 'number') this.wait = v > 0 ? v : 0;
    else if (typeof v === 'function') this.until = v;
  }

  kill() {
    this.done = true;
    try {
      this.gen.return();
    } catch {
      /* already finished */
    }
  }
}

export class TaskList {
  constructor() {
    this.list = [];
  }

  run(gen, owner = null) {
    const t = new Task(gen, owner);
    this.list.push(t);
    return t;
  }

  step() {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const t = l[i];
      if (t.owner && t.owner.dead) t.kill();
      else t.step();
    }
    if (l.some((t) => t.done)) this.list = l.filter((t) => !t.done);
  }

  /** Stop every task belonging to `owner` (or all of them). */
  killOwned(owner) {
    for (const t of this.list) if (!owner || t.owner === owner) t.kill();
    this.list = this.list.filter((t) => !t.done);
  }

  clear() {
    for (const t of this.list) t.kill();
    this.list = [];
  }
}
