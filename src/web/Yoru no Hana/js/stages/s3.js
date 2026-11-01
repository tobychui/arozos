/**
 * Stage 3 - Matsuyoi Meadow (待宵ヶ原). Boss: Kohaku Matsuyoi.
 * Moths: wing-shaped spreads, drifting scale powder, bullets that curve
 * toward a moving light.
 */
import { G, d, rand, aim, shoot, ring, fan, line, flower, spawn, waitClear, fightBoss, sfx, chance, W, H, TAU } from '../game/danmaku.js';
import { turnToward } from '../core/util.js';
import { stopAndFire, aimedBursts, drops } from './common.js';

/** Wing-shaped double fan: two fans either side of `a`. */
function wings(x, y, a, n, s, color, o) {
  fan(x, y, n, a - 0.55, 0.7, s, 'moth', color, o);
  fan(x, y, n, a + 0.55, 0.7, s, 'moth', color, { ...(o || {}), silent: true });
}

const MID = {
  id: 's3m',
  char: 'kohaku',
  midboss: true,
  dropBomb: true,
  cards: [
    {
      hp: 700, time: 22,
      *run(b) {
        for (let k = 0; ; k++) {
          wings(b.x, b.y, aim(b.x, b.y), d(3, 4, 5, 6), 2.4, 'yellow');
          yield d(36, 28, 22, 18);
          ring(b.x, b.y, d(10, 14, 18, 22), k * 0.3, 1.5, 'pellet', 'orange', { silent: true });
          if (k % 2) b.wander(50);
        }
      },
    },
    {
      name: 'Evening Primrose 「Scale Powder Drift」', hp: 850, time: 32, id: 's3m:1',
      *run(b) {
        for (let t = 0; ; t++) {
          if (t % d(4, 3, 2, 2) === 0) {
            const side = t % 2 ? 1 : -1;
            const seed = rand(0, TAU);
            shoot(b.x + side * 20, b.y, Math.PI / 2 + side * rand(0.3, 1.4), rand(0.6, 1.2), 'pellet', chance(0.5) ? 'yellow' : 'orange', {
              acc: 0.004, sMax: d(1.4, 1.7, 2, 2.3),
              fn: (bl) => {
                bl.a = turnToward(bl.a, Math.PI / 2, 0.006) + Math.sin(bl.t * 0.06 + seed) * 0.02;
              },
            });
          }
          if (t % 80 === 40) {
            wings(b.x, b.y, aim(b.x, b.y), d(2, 3, 4, 5), 2.8, 'white');
            b.wander(60);
          }
          if (t % 12 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
  ],
};

const BOSS = {
  id: 's3b',
  char: 'kohaku',
  music: 'b3',
  cards: [
    {
      hp: 1050, time: 32,
      *run(b) {
        for (let k = 0; ; k++) {
          const dir = k % 2 ? 1 : -1;
          for (let i = 0; i < 6; i++) {
            ring(b.x, b.y, d(8, 10, 12, 16), i * 0.1 * dir, 2 + i * 0.1, 'moth', i % 2 ? 'yellow' : 'orange', { w: dir * 0.01 });
            yield 8;
          }
          fan(b.x, b.y, d(3, 5, 7, 7), aim(b.x, b.y), 0.5, 3.2, 'kunai', 'yellow');
          b.wander(45);
          yield d(40, 32, 26, 22);
        }
      },
    },
    {
      name: 'Evening Primrose 「Drawn to the Lantern」', hp: 1200, time: 44, id: 's3b:1',
      *run(b) {
        b.moveTo(W / 2, 80, 40);
        yield 40;
        // a festival lantern drifts about; every moth turns toward it
        const lantern = shoot(W / 2, 200, 0, 0, 'lantern', 'orange', { noCancel: true, margin: 200, harmless: true });
        let lx = W / 2;
        let ly = 220;
        for (let t = 0; ; t++) {
          const p = G.player;
          lx += (p.x - lx) * 0.008;
          ly += (Math.min(p.y - 120, 260) - ly) * 0.008;
          lantern.x = lx + Math.sin(t * 0.02) * 40;
          lantern.y = ly;
          lantern.s = 0;
          lantern.t = 10;
          if (t % d(10, 8, 6, 5) === 0) {
            const a = rand(0, TAU);
            shoot(b.x, b.y, a, 2.2, 'moth', chance(0.5) ? 'yellow' : 'white', {
              fn: (bl) => {
                if (bl.t < 120) bl.a = turnToward(bl.a, Math.atan2(lantern.y - bl.y, lantern.x - bl.x), 0.03);
              },
            });
          }
          if (t % 120 === 60) fan(b.x, b.y, d(3, 5, 5, 7), aim(b.x, b.y), 0.6, 2.4, 'ball', 'orange');
          if (t % 10 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
    {
      hp: 1150, time: 32,
      *run(b) {
        let a = 0;
        for (let k = 0; ; k++) {
          for (let i = 0; i < 30; i++) {
            for (let arm = 0; arm < 3; arm++) shoot(b.x, b.y, a + (arm * TAU) / 3, 2.6, 'moth', 'orange');
            if (d(false, true, true, true)) for (let arm = 0; arm < 3; arm++) shoot(b.x, b.y, -a * 1.3 + (arm * TAU) / 3, 1.8, 'pellet', 'yellow');
            a += 0.11;
            if (i % 3 === 0) sfx('enemyShot');
            yield d(5, 4, 3, 3);
          }
          b.wander(50);
          yield 30;
        }
      },
    },
    {
      name: 'Evening Primrose 「Eyespot Glare」', hp: 1300, time: 44, id: 's3b:3',
      *run(b) {
        b.moveTo(W / 2, 70, 40);
        yield 40;
        for (let k = 0; ; k++) {
          // two eyespots open at the sides and stare
          const eyes = [[70, 150], [W - 70, 150]];
          for (const [ex, ey] of eyes) {
            ring(ex, ey, d(14, 18, 22, 26), 0, 0.01, 'ball', 'orange', { life: 140, silent: true });
            ring(ex, ey, 1, 0, 0, 'orb', 'yellow', { life: 140, silent: true });
            G.fx.ring(ex, ey, '#ffd060', 50, 30);
          }
          sfx('charge');
          yield 30;
          for (let i = 0; i < d(4, 5, 6, 7); i++) {
            for (const [ex, ey] of eyes) line(ex, ey, d(4, 5, 6, 7), aim(ex, ey), 2.2, 4.2, 'kunai', 'yellow', { silent: true });
            sfx('enemyShot2');
            yield 18;
          }
          wings(b.x, b.y, Math.PI / 2, d(4, 5, 6, 8), 1.8, 'orange');
          yield d(50, 40, 32, 26);
          b.wander(40, 50, 60, 90);
        }
      },
    },
    {
      name: 'Evening Primrose 「Waiting for the Dusk」', hp: 1400, time: 50, id: 's3b:4',
      *run(b) {
        b.moveTo(W / 2, 90, 40);
        yield 40;
        for (let k = 0; ; k++) {
          // primroses open across the meadow: four petals of bullets each
          const n = d(2, 3, 3, 4);
          for (let j = 0; j < n; j++) {
            const cx = rand(50, W - 50);
            const cy = rand(80, 230);
            const per = d(5, 6, 7, 8);
            const rot = rand(0, TAU);
            G.fx.ring(cx, cy, '#ffe45a', 30, 20);
            for (let p = 0; p < 4; p++) {
              for (let i = 0; i < per; i++) {
                const a = rot + (p * TAU) / 4 + (i - (per - 1) / 2) * 0.12;
                shoot(cx, cy, a, 0.4 + i * 0.03, 'ball', p % 2 ? 'yellow' : 'orange', {
                  acc: -0.004,
                  fn: (bl) => {
                    if (bl.t === 70) {
                      bl.a += 0.6;
                      bl.s = 0;
                      bl.acc = 0.03;
                      bl.sMax = d(1.6, 1.9, 2.2, 2.5);
                    }
                  },
                });
              }
            }
          }
          sfx('enemyShot2');
          yield 40;
          fan(b.x, b.y, d(5, 7, 9, 11), aim(b.x, b.y), 1, 2.6, 'moth', 'white');
          yield d(50, 40, 34, 28);
        }
      },
    },
  ],
};

export default {
  no: 3,
  jp: '待宵ヶ原',
  name: 'Matsuyoi Meadow',
  sub: 'Wings around the last light',
  bg: 'meadow',
  music: 's3',
  midboss: MID,
  boss: BOSS,
  *script() {
    yield 120;
    // moth swarms fluttering down
    for (let r = 0; r < 3; r++) {
      const cx = [100, W - 100, W / 2][r];
      for (let i = 0; i < 10; i++) {
        spawn('moth', cx + rand(-40, 40), -14, { color: 'yellow', hp: 6, vy: rand(1.4, 2), drops: drops(1, 0) }, function* (e) {
          const ph = rand(0, TAU);
          for (let t = 0; ; t++) {
            e.vx = Math.sin(t * 0.08 + ph) * 1.4;
            if (t === 50 && chance(d(0.3, 0.5, 0.8, 1))) shoot(e.x, e.y, aim(e.x, e.y), 2.4, 'pellet', 'orange');
            yield 1;
          }
        });
        yield 6;
      }
      yield 80;
    }
    // primrose spirits
    for (let i = 0; i < 4; i++) {
      spawn('petal', 70 + i * 82, -20, { color: 'yellow', hp: 30, drops: drops(2, 2) }, function* (e) {
        yield* stopAndFire(e, 80 + (i % 2) * 40, function* () {
          for (let k = 0; k < 3; k++) {
            flower(e.x, e.y, d(8, 12, 16, 20), 4, k * 0.4, 1.6, 0.3, 'ball', 'yellow');
            yield 35;
          }
        });
      });
      yield 26;
    }
    yield 160;
    // big moths sweeping sideways
    for (let i = 0; i < 8; i++) {
      const left = i % 2 === 0;
      spawn('moth', left ? -14 : W + 14, 60 + i * 12, { color: 'orange', hp: 22, scale: 1.5, vx: left ? 1.8 : -1.8, drops: drops(2, 1) }, function* (e) {
        for (let t = 0; ; t += 40) {
          yield 40;
          wings(e.x, e.y, aim(e.x, e.y), d(1, 2, 2, 3), 2.4, 'yellow');
        }
      });
      yield 34;
    }
    yield* waitClear(400);
    yield 30;
    yield* fightBoss(MID);
    yield 60;

    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 8; i++) {
        spawn('moth', rand(30, W - 30), -14, { color: r % 2 ? 'white' : 'yellow', hp: 7, vy: 2.2, drops: drops(1, 0) }, function* (e) {
          const ph = rand(0, TAU);
          for (let t = 0; ; t++) {
            e.vx = Math.sin(t * 0.1 + ph) * 1.6;
            yield 1;
          }
        });
        yield 5;
      }
      spawn('wisp', r % 2 ? W - 60 : 60, -16, { color: 'orange', hp: 40, drops: drops(3, 2) }, function* (e) {
        yield* stopAndFire(e, 100, aimedBursts(4, 26, d(3, 5, 7, 7), 0.7, 2.8, 'moth', 'orange'), { leave: 'side' });
      });
      yield 90;
    }
    spawn('bigLantern', W / 2, -40, { color: 'orange', hp: 480, drops: { power: 6, point: 10, bigPower: 1 } }, function* (e) {
      yield* stopAndFire(e, 120, function* () {
        for (let i = 0; i < 12; i++) {
          wings(e.x, e.y + 10, Math.PI / 2 + Math.sin(i) * 0.5, d(4, 5, 6, 7), 1.8, 'yellow');
          if (i % 3 === 2) ring(e.x, e.y, d(16, 20, 26, 32), i, 2.2, 'pellet', 'orange');
          yield 30;
        }
      }, { inFrames: 80, speed: 1 });
    });
    yield* waitClear(600);
    yield 60;
    yield* fightBoss(BOSS, { dialog: 'pre', post: 'post' });
  },
};
