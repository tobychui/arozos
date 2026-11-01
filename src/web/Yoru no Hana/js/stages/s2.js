/**
 * Stage 2 - Lake Kagami (鏡湖). Boss: Minamo Suiren.
 * Water: ripples, bubbles that pop into rings, koi leaping in arcs.
 */
import { G, d, rand, aim, shoot, ring, fan, line, flower, spawn, waitClear, fightBoss, sfx, chance, W, H, TAU } from '../game/danmaku.js';
import { stopAndFire, aimedBursts, ringBursts, drops } from './common.js';

const pop = (n, s, type, color, at = 60) => (b) => {
  if (b.t === at) {
    ring(b.x, b.y, n, rand(0, TAU), s, type, color, { silent: true });
    sfx('enemyShot2');
    b.dead = true;
  }
};

const MID = {
  id: 's2m',
  char: 'minamo',
  midboss: true,
  dropBomb: true,
  cards: [
    {
      hp: 650, time: 22,
      *run(b) {
        for (let k = 0; ; k++) {
          for (let i = 0; i < 5; i++) {
            fan(b.x, b.y, 5, k * 0.4 + (i * TAU) / 5, 0.5, 2.2, 'petal', 'pink', { silent: i > 0 });
          }
          yield d(30, 22, 18, 14);
          if (k % 3 === 2) {
            fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.8, 3, 'drop', 'cyan');
            b.wander(40);
          }
        }
      },
    },
    {
      name: 'Water Lily 「Ripples on a Sleeping Lake」', hp: 800, time: 32, id: 's2m:1',
      *run(b) {
        for (let k = 0; ; k++) {
          const x = rand(40, W - 40);
          const y = rand(60, 220);
          G.fx.ring(x, y, '#9fe8ff', 40, 30);
          yield 20;
          ring(x, y, d(16, 22, 30, 36), rand(0, TAU), d(1.2, 1.4, 1.6, 1.8), 'ring', k % 2 ? 'cyan' : 'blue');
          if (d(false, true, true, true)) ring(x, y, d(0, 12, 18, 24), rand(0, TAU), 0.9, 'pellet', 'white', { silent: true });
          yield d(40, 30, 24, 18);
          if (k % 4 === 3) b.wander(40);
        }
      },
    },
  ],
};

const BOSS = {
  id: 's2b',
  char: 'minamo',
  music: 'b2',
  cards: [
    {
      hp: 950, time: 32,
      *run(b) {
        let a = 0;
        for (let k = 0; ; k++) {
          for (let i = 0; i < 24; i++) {
            for (let arm = 0; arm < d(3, 4, 5, 6); arm++) shoot(b.x, b.y, a + (arm * TAU) / d(3, 4, 5, 6), 2.2, 'petal', 'pink');
            a += k % 2 ? 0.13 : -0.13;
            if (i % 3 === 0) sfx('enemyShot');
            yield 4;
          }
          line(b.x, b.y, d(3, 4, 5, 6), aim(b.x, b.y), 2, 4, 'drop', 'cyan');
          b.wander(50);
          yield 30;
        }
      },
    },
    {
      name: 'Water Lily 「Koi Climbing the Moonlight」', hp: 1100, time: 42, id: 's2b:1',
      *run(b) {
        b.moveTo(W / 2, 70, 40);
        yield 40;
        for (let k = 0; ; k++) {
          // koi leap from the water at the bottom, warned by a splash
          const n = d(3, 4, 5, 6);
          const xs = [];
          for (let i = 0; i < n; i++) xs.push(rand(20, W - 20));
          for (const x of xs) G.fx.ring(x, H - 4, '#9fe8ff', 30, 40);
          yield 36;
          for (const x of xs) {
            const dir = x < W / 2 ? 1 : -1;
            for (let j = 0; j < d(5, 7, 9, 11); j++) {
              shoot(x, H + 8, -Math.PI / 2, 0, 'drop', j % 2 ? 'cyan' : 'white', {
                vx: dir * rand(0.6, 1.6), vy: -rand(5.4, 7.2), gy: 0.09, margin: 60,
              });
            }
          }
          sfx('enemyShot2');
          yield 30;
          fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.6, 1.6, 'bubble', 'blue');
          yield d(60, 48, 40, 34);
          if (k % 2) b.wander(50, 70, 60, 100);
        }
      },
    },
    {
      hp: 1000, time: 32,
      *run(b) {
        for (let k = 0; ; k++) {
          const a = aim(b.x, b.y);
          for (const off of d([-0.5, 0.5], [-0.7, 0, 0.7], [-0.9, -0.3, 0.3, 0.9], [-1, -0.5, 0, 0.5, 1])) {
            shoot(b.x, b.y, a + off, 2.6, 'bubble', k % 2 ? 'pink' : 'cyan', { acc: -0.04, fn: pop(d(8, 12, 14, 18), 1.8, 'petal', k % 2 ? 'pink' : 'cyan', 65) });
          }
          sfx('enemyShot2');
          yield 30;
          ring(b.x, b.y, d(12, 18, 24, 30), rand(0, TAU), 2.2, 'drop', 'blue');
          yield d(40, 32, 26, 22);
          b.wander(40);
        }
      },
    },
    {
      name: 'Water Lily 「Lily Pads Adrift」', hp: 1250, time: 45, id: 's2b:3',
      *run(b) {
        b.moveTo(W / 2, 64, 40);
        yield 40;
        for (let k = 0; ; k++) {
          const x = rand(40, W - 40);
          const sway = rand(0, TAU);
          shoot(x, -24, Math.PI / 2, 0, 'bubble', 'green', {
            vx: 0, vy: d(0.6, 0.7, 0.8, 0.9), margin: 50,
            fn: (bl) => {
              bl.vx = Math.sin(bl.t * 0.02 + sway) * 0.6;
              const every = d(70, 55, 45, 38);
              if (bl.t > 30 && bl.t % every === 0) {
                flower(bl.x, bl.y, d(10, 15, 20, 25), 5, bl.t * 0.02, 1.3, 0.35, 'flower', 'pink', { silent: true });
                sfx('enemyShot');
              }
            },
          });
          for (let t = 0; t < d(110, 90, 75, 62); t += 18) {
            fan(b.x, b.y, 2, aim(b.x, b.y), 0.25 + (t % 36) * 0.01, d(2.4, 2.8, 3.2, 3.6), 'rice', 'cyan', { silent: t % 36 !== 0 });
            yield 18;
          }
        }
      },
    },
    {
      name: 'Water Lily 「Mandala That Never Closes」', hp: 1350, time: 50, id: 's2b:4',
      *run(b) {
        b.moveTo(W / 2, 120, 50);
        yield 60;
        let a = 0;
        for (let t = 0; ; t++) {
          if (t % d(8, 6, 5, 4) === 0) {
            const arms = d(6, 8, 8, 10);
            for (let i = 0; i < arms; i++) {
              shoot(b.x, b.y, a + (i * TAU) / arms, 1.8, 'petal', 'pink', { w: 0.006 });
              shoot(b.x, b.y, -a + (i * TAU) / arms, 1.8, 'petal', 'white', { w: -0.006 });
            }
            a += 0.07;
          }
          if (t % 90 === 45) flower(b.x, b.y, d(20, 30, 40, 48), 6, a, 1.1, 0.4, 'ball', 'cyan');
          if (t % 6 === 0 && t % 18 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
  ],
};

export default {
  no: 2,
  jp: '鏡湖',
  name: 'Lake Kagami',
  sub: 'A moon caught in the mirror',
  bg: 'lake',
  music: 's2',
  midboss: MID,
  boss: BOSS,
  *script() {
    yield 120;
    // koi leaping across
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 6; i++) {
        const left = (i + r) % 2 === 0;
        spawn('koi', left ? -20 : W + 20, 300 - i * 20, { color: i % 2 ? 'red' : 'orange', hp: 14, vx: left ? 2.6 : -2.6, vy: -3.4, drops: drops(1, 1) }, function* (e) {
          for (let t = 0; t < 200; t++) {
            e.vy += 0.035;
            if (t === 50) fan(e.x, e.y, d(1, 3, 3, 5), aim(e.x, e.y), 0.5, 2.4, 'drop', 'cyan');
            yield 1;
          }
        });
        yield 22;
      }
      yield 60;
    }
    // lily spirits with petal rings
    for (const x of [96, W / 2, W - 96]) {
      spawn('petal', x, -20, { color: 'pink', hp: 34, drops: drops(2, 2) }, function* (e) {
        yield* stopAndFire(e, 90 + (x === W / 2 ? 30 : 0), ringBursts(4, 30, d(10, 14, 18, 22), 1.7, 'petal', 'pink', 0.15));
      });
      yield 30;
    }
    yield 200;
    // wisp streams from the top corners
    for (let i = 0; i < 16; i++) {
      const left = i % 2 === 0;
      spawn('wisp', left ? 30 : W - 30, -16, { color: 'cyan', hp: 9, s: 2.6, a: left ? 1.2 : Math.PI - 1.2, w: left ? 0.004 : -0.004, drops: drops(1, 1) }, function* (e) {
        yield 40;
        fan(e.x, e.y, d(1, 1, 3, 3), aim(e.x, e.y), 0.3, 2.6, 'pellet', 'blue');
      });
      yield 10;
    }
    yield 120;
    // paper cranes floating down in a v
    for (let i = 0; i < 9; i++) {
      const x = W / 2 + (i - 4) * 36;
      spawn('crane', x, -20 - Math.abs(i - 4) * 18, { color: 'blue', hp: 18, vy: 1.4, drops: drops(1, 1) }, function* (e) {
        yield 70;
        e.vy = 0.4;
        ring(e.x, e.y, d(5, 8, 10, 12), aim(e.x, e.y), 1.6, 'drop', 'white');
        yield 40;
        e.vy = 1.8;
      });
    }
    yield* waitClear(360);
    yield 30;
    yield* fightBoss(MID);
    yield 60;

    for (let r = 0; r < 3; r++) {
      spawn('kokeshi', r % 2 ? W - 90 : 90, -20, { color: 'blue', hp: 120, drops: { power: 4, point: 4 } }, function* (e) {
        yield* stopAndFire(e, 100, function* () {
          for (let i = 0; i < d(16, 22, 28, 32); i++) {
            shoot(e.x, e.y, aim(e.x, e.y) + Math.sin(i * 0.5) * 0.5, 2.6, 'drop', 'cyan');
            if (i % 2 === 0) sfx('enemyShot');
            yield 6;
          }
        }, { leave: 'side' });
      });
      for (let i = 0; i < 6; i++) {
        spawn('koi', r % 2 ? -20 : W + 20, 330, { color: 'red', hp: 12, vx: r % 2 ? 2.2 : -2.2, vy: -4, drops: drops(1, 0) }, function* (e) {
          for (;;) {
            e.vy += 0.04;
            yield 1;
          }
        });
        yield 14;
      }
      yield 110;
    }
    for (let i = 0; i < 12; i++) {
      spawn('petal', rand(40, W - 40), -16, { color: chance(0.5) ? 'pink' : 'white', hp: 20, vy: 1.8, drops: drops(1, 1) }, function* (e) {
        yield 50;
        e.vy = 0.5;
        flower(e.x, e.y, d(6, 10, 12, 16), 3, aim(e.x, e.y), 1.6, 0.3, 'petal', 'pink');
        yield 30;
        e.vy = 2;
      });
      yield 18;
    }
    yield* waitClear(500);
    yield 60;
    yield* fightBoss(BOSS, { dialog: 'pre', post: 'post' });
  },
};
