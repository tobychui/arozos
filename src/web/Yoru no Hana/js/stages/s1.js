/**
 * Stage 1 - Lantern Lane (灯籠横丁). Boss: Tomoe Hozuki.
 * The tutorial stage: slow aimed shots, rings with wide gaps, one idea per
 * card.
 */
import { d, rand, aim, shoot, ring, fan, line, spawn, run, waitClear, fightBoss, sfx, chance, W, H, TAU } from '../game/danmaku.js';
import { stopAndFire, aimedBursts, ringBursts, glide, drops } from './common.js';

const MID = {
  id: 's1m',
  char: 'tomoe',
  midboss: true,
  dropBomb: true,
  cards: [
    {
      hp: 500, time: 20,
      *run(b) {
        for (let k = 0; ; k++) {
          fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.9, 2.6, 'ball', 'orange');
          yield 25;
          ring(b.x, b.y, d(10, 14, 20, 26), k * 0.2, 1.8, 'pellet', 'yellow');
          yield 35;
          if (k % 2) b.wander(50);
        }
      },
    },
    {
      name: 'Hozuki 「Paper Husk Lanterns」', hp: 650, time: 30, id: 's1m:1',
      *run(b) {
        for (;;) {
          const a = aim(b.x, b.y);
          for (const off of d([0], [-0.5, 0.5], [-0.6, 0, 0.6], [-0.8, -0.27, 0.27, 0.8])) {
            shoot(b.x, b.y, a + off, 2.4, 'lantern', 'orange', {
              acc: -0.034,
              fn: (bl) => {
                if (bl.t === 70) {
                  ring(bl.x, bl.y, d(8, 10, 14, 18), rand(0, TAU), 1.5, 'pellet', 'yellow', { silent: true });
                  if (bl.data) ring(bl.x, bl.y, d(0, 6, 8, 10), rand(0, TAU), 2.3, 'rice', 'orange', { silent: true });
                  sfx('enemyShot2');
                  bl.dead = true;
                }
              },
              data: true,
            });
          }
          sfx('enemyShot2');
          yield d(80, 60, 50, 42);
          b.wander(40);
        }
      },
    },
  ],
};

const BOSS = {
  id: 's1b',
  char: 'tomoe',
  music: 'b1',
  cards: [
    {
      hp: 850, time: 30,
      *run(b) {
        for (let k = 0; ; k++) {
          for (let i = 0; i < 5; i++) {
            ring(b.x, b.y, d(10, 14, 18, 22), k * 0.17 + i * 0.06 * (k % 2 ? 1 : -1), 2 + i * 0.18, 'rice', i % 2 ? 'orange' : 'yellow');
            yield 7;
          }
          b.wander(50);
          yield d(45, 36, 28, 22);
          fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.8, 3, 'ball', 'red');
          yield 25;
        }
      },
    },
    {
      name: 'Hozuki 「Festival Lantern Row」', hp: 1000, time: 40, id: 's1b:1',
      *run(b) {
        b.moveTo(W / 2, 64, 40);
        yield 45;
        for (let round = 0; ; round++) {
          const n = d(4, 5, 6, 7);
          const every = d(70, 52, 42, 34);
          for (let i = 0; i < n; i++) {
            const tx = 34 + (i * (W - 68)) / (n - 1);
            const ty = 92 + ((i + round) % 2) * 44;
            shoot(b.x, b.y, 0, 0, 'lantern', 'red', {
              fn: glide(b.x, b.y, tx, ty, 45, (bl) => {
                const t = bl.t - 45;
                if (t > 0 && t % every === 0) ring(bl.x, bl.y, d(5, 7, 9, 11), t * 0.07 + i, d(1.3, 1.5, 1.7, 1.9), 'pellet', 'orange', { silent: true });
                if (t === 300) {
                  bl.dead = true;
                  ring(bl.x, bl.y, d(6, 8, 10, 12), 0, 1.2, 'ball', 'red', { silent: true });
                }
              }),
            });
          }
          sfx('enemyShot2');
          for (let t = 0; t < 330; t += 50) {
            yield 50;
            fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.35, d(2.2, 2.6, 3, 3.4), 'kunai', 'red');
          }
          b.moveTo(rand(120, W - 120), 64, 50);
        }
      },
    },
    {
      hp: 950, time: 30,
      *run(b) {
        let a = 0;
        const arms = d(2, 3, 4, 5);
        for (;;) {
          for (let i = 0; i < 36; i++) {
            for (let k = 0; k < arms; k++) {
              shoot(b.x, b.y, a + (k * TAU) / arms, 2.3, 'ember', 'orange');
              shoot(b.x, b.y, -a + (k * TAU) / arms + 0.3, 1.7, 'ember', 'red');
            }
            if (i % 3 === 0) sfx('enemyShot');
            a += 0.16;
            yield d(6, 5, 4, 4);
          }
          fan(b.x, b.y, d(5, 7, 9, 11), aim(b.x, b.y), 1.2, 3.4, 'kunai', 'yellow');
          b.wander(45);
          yield 40;
        }
      },
    },
    {
      name: 'Hozuki 「Thousand Lantern Plant Rain」', hp: 1200, time: 45, id: 's1b:3',
      *run(b) {
        b.moveTo(W / 2, 80, 40);
        yield 40;
        const sway = (bl) => {
          bl.vx = Math.sin(bl.t * 0.04 + bl.data) * 0.7;
        };
        for (let t = 0; ; t++) {
          if (t % d(7, 5, 3, 2) === 0) {
            shoot(rand(0, W), -12, Math.PI / 2, 0, 'ember', chance(0.5) ? 'orange' : 'red', {
              vx: 0, vy: rand(0.8, 1.4), gy: 0.012, vMax: d(1.8, 2.2, 2.6, 3), margin: 40, fn: sway, data: rand(0, TAU),
            });
          }
          if (t % 100 === 50) {
            const a = aim(b.x, b.y);
            shoot(b.x, b.y, a, 3, 'orb', 'orange', {
              acc: -0.05,
              fn: (bl) => {
                if (bl.t === 50) {
                  fan(bl.x, bl.y, d(5, 7, 9, 11), aim(bl.x, bl.y), 1.1, d(2.4, 2.8, 3.2, 3.6), 'ball', 'yellow', { silent: true });
                  sfx('enemyShot2');
                  bl.dead = true;
                }
              },
            });
            b.wander(70, 60, 60, 110);
          }
          yield 1;
        }
      },
    },
  ],
};

export default {
  no: 1,
  jp: '灯籠横丁',
  name: 'Lantern Lane of Tsukimachi',
  sub: 'The festival that would not close',
  bg: 'street',
  music: 's1',
  midboss: MID,
  boss: BOSS,
  *script() {
    yield 120;
    // wisps curling in from each side
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const x = side < 0 ? 50 + i * 16 : W - 50 - i * 16;
        spawn('wisp', x, -16, { color: side < 0 ? 'red' : 'orange', hp: 9, s: 2.3, a: Math.PI / 2, w: side * 0.008, drops: drops(1, 0) }, function* (e) {
          yield 45;
          if (d(i % 2 === 0, true, true, true)) fan(e.x, e.y, d(1, 1, 3, 3), aim(e.x, e.y), 0.4, d(2, 2.3, 2.7, 3.1), 'pellet', 'red');
        });
        yield 10;
      }
      yield 70;
    }
    yield 40;
    // two lantern ghosts with rings
    for (const x of [110, W - 110]) {
      spawn('lantern', x, -20, { color: 'red', hp: 45, drops: drops(3, 2) }, function* (e) {
        yield* stopAndFire(e, 96, ringBursts(4, 32, d(8, 12, 16, 20), 1.8, 'ball', 'orange', 0.13));
      });
    }
    yield 220;
    // crossing streams
    for (let i = 0; i < 12; i++) {
      const left = i % 2 === 0;
      spawn('wisp', left ? -14 : W + 14, 50 + (i % 4) * 22, { color: 'yellow', hp: 8, vx: left ? 2.2 : -2.2, vy: 0.15, drops: drops(1, 1) }, function* (e) {
        yield 30;
        line(e.x, e.y, d(1, 2, 3, 3), aim(e.x, e.y), 2, 3, 'pellet', 'yellow');
      });
      yield 14;
    }
    yield 100;
    // kokeshi spinning out rice
    spawn('kokeshi', W / 2, -20, { color: 'red', hp: 110, drops: { power: 4, point: 4 } }, function* (e) {
      yield* stopAndFire(e, 110, function* () {
        for (let i = 0; i < d(30, 40, 50, 60); i++) {
          for (const s of [0, Math.PI]) shoot(e.x, e.y, i * 0.23 + s, 1.9, 'rice', 'orange');
          if (i % 3 === 0) sfx('enemyShot');
          yield 4;
        }
      });
    });
    yield 200;
    for (let i = 0; i < 8; i++) {
      spawn('wisp', rand(40, W - 40), -16, { color: 'orange', hp: 9, vy: 2.4, drops: drops(1, 1) }, function* (e) {
        yield 30;
        e.vy = 0.6;
        fan(e.x, e.y, d(1, 3, 3, 5), aim(e.x, e.y), 0.5, 2.4, 'pellet', 'orange');
        yield 30;
        e.vy = 2.6;
      });
      yield 16;
    }
    yield* waitClear(240);
    yield 30;

    yield* fightBoss(MID);
    yield 60;

    // second half
    for (let r = 0; r < 3; r++) {
      for (const x of [70, W - 70]) {
        spawn('lantern', x + (r % 2 ? 40 : 0) * (x < W / 2 ? 1 : -1), -20, { color: r % 2 ? 'orange' : 'red', hp: 40, drops: drops(2, 2) }, function* (e) {
          yield* stopAndFire(e, 80 + r * 20, aimedBursts(3, 40, d(3, 5, 5, 7), 0.6, 2.6, 'ball', 'red'), { leave: 'side' });
        });
      }
      for (let i = 0; i < 6; i++) {
        spawn('wisp', W / 2 + (i - 2.5) * 28, -16, { color: 'red', hp: 8, s: 2, a: Math.PI / 2 + (i - 2.5) * 0.12, drops: drops(1, 0) });
        yield 8;
      }
      yield 110;
    }
    spawn('bigLantern', W / 2, -40, { color: 'red', hp: 420, drops: { power: 8, point: 10 } }, function* (e) {
      yield* stopAndFire(e, 120, function* () {
        for (let i = 0; i < 10; i++) {
          ring(e.x, e.y + 10, d(14, 18, 24, 30), i * 0.15, 1.6, 'ball', i % 2 ? 'orange' : 'red');
          if (i % 2) fan(e.x, e.y + 10, d(3, 5, 7, 7), aim(e.x, e.y), 0.5, 3, 'kunai', 'yellow');
          yield 36;
        }
      }, { inFrames: 80, speed: 1 });
    });
    yield 120;
    for (let i = 0; i < 10; i++) {
      const left = i % 2 === 0;
      spawn('wisp', left ? -14 : W + 14, 40 + i * 6, { color: 'orange', hp: 8, vx: left ? 2 : -2, drops: drops(1, 1) });
      yield 20;
    }
    yield* waitClear(500);
    yield 60;
    yield* fightBoss(BOSS, { dialog: 'pre', post: 'post' });
  },
};
