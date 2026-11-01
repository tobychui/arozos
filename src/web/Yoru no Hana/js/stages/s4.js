/**
 * Stage 4 - The Threaded Cedar Steps (糸杉の石段). Boss: Itoha Karasuuri.
 * Silk: bullets that stop to form webs and lattices, then fall; spider
 * leg lasers; lace rings with fringes.
 */
import { G, d, rand, aim, shoot, ring, fan, line, laser, spawn, run, waitClear, fightBoss, sfx, chance, W, H, TAU } from '../game/danmaku.js';
import { stopAndFire, aimedBursts, glide, drops } from './common.js';

/** Bullet fn: stop at frame `at`, then fall with gravity after `drop`. */
const freezeFall = (at, drop, vMax) => (b) => {
  if (b.t === at) {
    b.s = 0;
    b.acc = 0;
  } else if (b.t === drop) {
    b.cart = true;
    b.vx = 0;
    b.vy = 0;
    b.gy = 0.03;
    b.vMax = vMax;
    b.gx = 0;
  }
};

const MID = {
  id: 's4m',
  char: 'itoha',
  midboss: true,
  dropLife: true,
  cards: [
    {
      name: 'Snake Gourd 「Silk Snare」', hp: 950, time: 34, id: 's4m:0',
      *run(b) {
        for (let k = 0; ; k++) {
          const n = d(10, 14, 18, 22);
          const off = rand(0, TAU);
          for (let j = 0; j < d(5, 6, 7, 8); j++) {
            ring(b.x, b.y, n, off + (k % 2 ? 0 : Math.PI / n), 1.2 + j * 0.45, 'rice', 'white', {
              acc: -0.02, sMin: 0,
              fn: (bl) => {
                if (bl.t === 110) {
                  bl.a = Math.PI / 2 + rand(-0.15, 0.15);
                  bl.acc = 0.015;
                  bl.sMax = d(1.2, 1.5, 1.8, 2.1);
                }
              },
              silent: j > 0,
            });
          }
          yield 50;
          fan(b.x, b.y, d(3, 5, 5, 7), aim(b.x, b.y), 0.4, 3, 'kunai', 'purple');
          yield d(70, 60, 50, 42);
          b.wander(50);
        }
      },
    },
  ],
};

const BOSS = {
  id: 's4b',
  char: 'itoha',
  music: 'b4',
  cardStyle: 'web',
  cards: [
    {
      hp: 1150, time: 32,
      *run(b) {
        for (let k = 0; ; k++) {
          // two crossing streams make a diamond lattice
          for (let i = 0; i < 20; i++) {
            const sw = Math.sin(i * 0.3) * 0.9;
            shoot(b.x, b.y, Math.PI / 2 + sw, 2.4, 'rice', 'purple');
            shoot(b.x, b.y, Math.PI / 2 - sw, 2.4, 'rice', 'white');
            if (d(false, false, true, true)) shoot(b.x, b.y, Math.PI / 2 + sw * 1.6, 2, 'rice', 'pink');
            if (i % 3 === 0) sfx('enemyShot');
            yield 4;
          }
          fan(b.x, b.y, d(5, 7, 9, 11), aim(b.x, b.y), 1.2, 3, 'ball', 'purple');
          b.wander(50);
          yield d(36, 30, 24, 20);
        }
      },
    },
    {
      name: 'Snake Gourd 「Web Over the Cedar Steps」', hp: 1350, time: 46, id: 's4b:1',
      *run(b) {
        b.moveTo(W / 2, 90, 40);
        yield 45;
        for (let k = 0; ; k++) {
          const spokes = d(8, 10, 12, 14);
          const rings = d(4, 5, 6, 7);
          const a0 = rand(0, TAU);
          // spokes
          for (let i = 0; i < spokes; i++) {
            for (let j = 1; j <= 9; j++) {
              shoot(b.x, b.y, a0 + (i * TAU) / spokes, j * 0.55, 'pellet', 'white', { fn: freezeFall(40, 120 + j * 4, d(1.4, 1.7, 2, 2.3)), silent: true });
            }
          }
          // threads between spokes
          for (let r = 1; r <= rings; r++) {
            const n = spokes * r;
            ring(b.x, b.y, n, a0, (r * 9 * 0.55) / rings, 'rice', 'purple', { fn: freezeFall(40, 150 + r * 6, d(1.3, 1.6, 1.9, 2.2)), silent: true });
          }
          sfx('enemyShot2');
          yield 100;
          for (let i = 0; i < 4; i++) {
            fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.3, 3.2, 'kunai', 'pink');
            yield 20;
          }
          yield d(110, 90, 80, 70);
          b.moveTo(rand(100, W - 100), rand(70, 110), 40);
        }
      },
    },
    {
      hp: 1200, time: 32,
      *run(b) {
        let a = 0;
        for (let k = 0; ; k++) {
          for (let i = 0; i < 40; i++) {
            for (let arm = 0; arm < d(4, 5, 6, 7); arm++) shoot(b.x, b.y, a + (arm * TAU) / d(4, 5, 6, 7), 2.4, 'rice', 'white', { w: 0.004 });
            a += 0.17;
            if (i % 10 === 5) fan(b.x, b.y, d(3, 3, 5, 5), aim(b.x, b.y), 0.25, 3.4, 'kunai', 'purple');
            else if (i % 3 === 0) sfx('enemyShot');
            yield 4;
          }
          b.wander(50);
          yield 30;
        }
      },
    },
    {
      name: 'Snake Gourd 「Lace Flower Fringe」', hp: 1400, time: 46, id: 's4b:3',
      *run(b) {
        b.moveTo(W / 2, 100, 40);
        yield 40;
        for (let k = 0; ; k++) {
          const n = d(10, 12, 16, 18);
          const fr = d(2, 3, 3, 4);
          ring(b.x, b.y, n, k * 0.15, 1.6, 'flower', 'white', {
            fn: (bl) => {
              if (bl.t === 50 || (fr > 2 && bl.t === 90)) {
                fan(bl.x, bl.y, fr, bl.a, 1.6, 0.9, 'pellet', 'purple', { silent: true, life: 220 });
              }
            },
          });
          yield d(44, 36, 30, 26);
          if (k % 3 === 2) {
            line(b.x, b.y, d(4, 5, 6, 7), aim(b.x, b.y), 2.4, 4, 'ball', 'pink');
            b.wander(40);
          }
        }
      },
    },
    {
      hp: 1250, time: 32,
      *run(b) {
        for (let k = 0; ; k++) {
          // snake gourd fruit: red orbs that drop and split
          for (let i = 0; i < d(2, 3, 4, 5); i++) {
            shoot(b.x, b.y, rand(0.3, Math.PI - 0.3), 2.4, 'orb', 'red', {
              acc: -0.04,
              fn: (bl) => {
                if (bl.t === 60) {
                  ring(bl.x, bl.y, d(10, 12, 16, 20), aim(bl.x, bl.y), 2, 'ball', 'orange', { silent: true });
                  sfx('enemyShot2');
                  bl.dead = true;
                }
              },
            });
          }
          sfx('enemyShot2');
          yield 30;
          ring(b.x, b.y, d(16, 20, 28, 34), rand(0, TAU), 1.6, 'rice', 'white');
          yield d(46, 38, 30, 26);
          b.wander(50);
        }
      },
    },
    {
      name: 'Snake Gourd 「Eight Silver Legs」', hp: 1500, time: 52, id: 's4b:5',
      *run(b) {
        b.moveTo(W / 2, 110, 50);
        yield 55;
        for (let k = 0; ; k++) {
          const dir = k % 2 ? 1 : -1;
          const a0 = rand(0, TAU);
          const spin = dir * d(0.004, 0.005, 0.006, 0.007);
          for (let i = 0; i < 8; i++) {
            laser(b.x, b.y, a0 + (i * TAU) / 8, 520, {
              w: 14, warn: 50, dur: 200, color: i % 2 ? 'purple' : 'white', follow: b, sound: i === 0,
              fn: (l) => {
                if (l.t > l.warn) l.a += spin;
              },
            });
          }
          yield 50;
          for (let t = 0; t < 200; t += 10) {
            if (t % 30 === 0) ring(b.x, b.y, d(8, 8, 16, 16), a0 + (t / 10) * spin * 10 + Math.PI / 8, d(1.4, 1.6, 1.8, 2), 'pellet', 'pink');
            if (t % 50 === 0) fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.3, 2.6, 'ball', 'white');
            yield 10;
          }
          yield 40;
        }
      },
    },
  ],
};

export default {
  no: 4,
  jp: '糸杉の石段',
  name: 'The Threaded Cedar Steps',
  sub: 'A net cast over the moon',
  bg: 'steps',
  music: 's4',
  midboss: MID,
  boss: BOSS,
  *script() {
    yield 120;
    // spiders drop on threads, fire, climb back up
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 5; i++) {
        const x = 50 + i * 71 + (r % 2) * 30;
        spawn('spider', x, -20, { color: 'purple', hp: 16, thread: true, drops: drops(1, 1) }, function* (e) {
          yield* stopAndFire(e, 70 + ((i + r) % 3) * 40, function* () {
            yield 20;
            fan(e.x, e.y, d(3, 3, 5, 5), aim(e.x, e.y), 0.4, 2.6, 'rice', 'white');
            yield 40;
          }, { leave: 'up', speed: 2.4 });
        });
        yield 12;
      }
      yield 100;
    }
    // lantern pair weaving a lattice
    for (const x of [90, W - 90]) {
      spawn('lantern', x, -20, { color: 'red', hp: 70, drops: drops(3, 3) }, function* (e) {
        yield* stopAndFire(e, 110, function* () {
          for (let i = 0; i < d(18, 24, 30, 36); i++) {
            const sw = Math.sin(i * 0.25) * 1.1;
            shoot(e.x, e.y, Math.PI / 2 + sw, 2, 'rice', 'purple');
            if (i % 3 === 0) sfx('enemyShot');
            yield 5;
          }
        }, { leave: 'side' });
      });
    }
    yield 260;
    for (let i = 0; i < 14; i++) {
      const left = i % 2 === 0;
      spawn('wisp', left ? -14 : W + 14, 40 + (i % 5) * 20, { color: 'purple', hp: 10, vx: left ? 2.4 : -2.4, drops: drops(1, 1) }, function* (e) {
        yield 30;
        shoot(e.x, e.y, aim(e.x, e.y), 2.8, 'kunai', 'purple');
      });
      yield 12;
    }
    yield* waitClear(360);
    yield 30;
    yield* fightBoss(MID);
    yield 60;

    for (let r = 0; r < 2; r++) {
      spawn('kokeshi', W / 2, -24, { color: 'purple', hp: 160, drops: { power: 5, point: 5 } }, function* (e) {
        yield* stopAndFire(e, 100, function* () {
          for (let i = 0; i < 5; i++) {
            ring(e.x, e.y, d(16, 20, 26, 32), i * 0.1, 1.2, 'rice', 'white', { fn: freezeFall(45, 90, 2) });
            yield 40;
          }
        });
      });
      for (let i = 0; i < 8; i++) {
        spawn('spider', rand(30, W - 30), -20, { color: 'pink', hp: 14, thread: true, drops: drops(1, 1) }, function* (e) {
          yield* stopAndFire(e, rand(60, 200), function* () {
            yield 30;
            shoot(e.x, e.y, aim(e.x, e.y), 2.6, 'ball', 'pink');
            yield 30;
          }, { leave: 'up', speed: 3 });
        });
        yield 22;
      }
      yield 120;
    }
    for (let i = 0; i < 10; i++) {
      spawn('wisp', 40 + i * 34, -16, { color: i % 2 ? 'white' : 'purple', hp: 10, vy: 2.2, drops: drops(1, 1) }, function* (e) {
        yield 50;
        e.vy = 0.6;
        fan(e.x, e.y, d(1, 3, 3, 5), aim(e.x, e.y), 0.4, 2.6, 'rice', 'purple');
        yield 30;
        e.vy = 2.4;
      });
      yield 14;
    }
    yield* waitClear(500);
    yield 60;
    yield* fightBoss(BOSS, { dialog: 'pre', post: 'post' });
  },
};
