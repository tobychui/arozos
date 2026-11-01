/**
 * Stage 5 - Hoshimi Observatory (星見台). Boss: Seira Yorugao.
 * Stars: constellations joined by lines, armillary rings orbiting the
 * boss, meteor showers, a star field that turns around her and lets go.
 */
import { G, d, rand, aim, shoot, ring, fan, line, laser, spawn, waitClear, fightBoss, sfx, chance, W, H, TAU } from '../game/danmaku.js';
import { stopAndFire, aimedBursts, glide, drops } from './common.js';

const MID = {
  id: 's5m',
  char: 'seira',
  midboss: true,
  dropLife: true,
  cards: [
    {
      hp: 800, time: 22,
      *run(b) {
        for (let k = 0; ; k++) {
          ring(b.x, b.y, d(10, 14, 18, 22), k * 0.21, 2, 'star', k % 2 ? 'yellow' : 'blue');
          yield d(24, 18, 14, 12);
          if (k % 4 === 3) {
            fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.6, 3.4, 'shard', 'white');
            b.wander(50);
          }
        }
      },
    },
    {
      name: 'Moonflower 「Constellation Sketch」', hp: 1000, time: 36, id: 's5m:1',
      *run(b) {
        for (let k = 0; ; k++) {
          // pick a handful of star points and join them with lines of rice
          const n = d(4, 5, 6, 7);
          const pts = [];
          for (let i = 0; i < n; i++) pts.push([rand(40, W - 40), rand(50, 240)]);
          const stars = pts.map(([x, y]) => shoot(b.x, b.y, 0, 0, 'star', 'yellow', { fn: glide(b.x, b.y, x, y, 40), noCancel: false }));
          sfx('enemyShot2');
          yield 50;
          for (let i = 0; i < n - 1; i++) {
            const [x0, y0] = pts[i];
            const [x1, y1] = pts[i + 1];
            const segs = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 14));
            for (let j = 1; j < segs; j++) {
              const x = x0 + ((x1 - x0) * j) / segs;
              const y = y0 + ((y1 - y0) * j) / segs;
              shoot(x, y, Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2 * (j % 2 ? 1 : -1), 0, 'rice', 'blue', {
                fn: (bl) => {
                  if (bl.t === 50) {
                    bl.acc = 0.02;
                    bl.sMax = d(1, 1.2, 1.5, 1.8);
                  }
                },
                silent: true,
              });
            }
            sfx('enemyShot');
            yield 8;
          }
          yield 40;
          for (const s of stars) {
            if (s.dead) continue;
            ring(s.x, s.y, d(6, 8, 10, 12), aim(s.x, s.y), 1.8, 'pellet', 'yellow', { silent: true });
            s.dead = true;
          }
          sfx('enemyShot2');
          yield d(80, 65, 55, 45);
          b.wander(50);
        }
      },
    },
  ],
};

const BOSS = {
  id: 's5b',
  char: 'seira',
  music: 'b5',
  cardStyle: 'stars',
  cards: [
    {
      hp: 1250, time: 32,
      *run(b) {
        for (let k = 0; ; k++) {
          const dir = k % 2 ? 1 : -1;
          for (let i = 0; i < 4; i++) {
            ring(b.x, b.y, d(12, 16, 20, 24), i * 0.08 * dir, 1.8 + i * 0.3, 'star', i % 2 ? 'blue' : 'yellow', { w: dir * 0.008 });
            yield 10;
          }
          fan(b.x, b.y, d(3, 5, 7, 7), aim(b.x, b.y), 0.5, 3.4, 'shard', 'white');
          b.wander(50);
          yield d(42, 34, 28, 22);
        }
      },
    },
    {
      name: 'Moonflower 「Armillary Rings」', hp: 1450, time: 46, id: 's5b:1',
      *run(b) {
        b.moveTo(W / 2, 140, 50);
        yield 55;
        const tilts = [0.4, -0.5, 1.4];
        const n = d(14, 18, 22, 26);
        const rings = d(2, 3, 3, 3);
        for (let r = 0; r < rings; r++) {
          for (let i = 0; i < n; i++) {
            const ph = (i * TAU) / n;
            const R = 70 + r * 26;
            const tilt = tilts[r];
            shoot(b.x, b.y, 0, 0, 'ball', ['yellow', 'blue', 'white'][r], {
              noCancel: false, margin: 400,
              data: { ph, R, tilt, sp: (r % 2 ? -1 : 1) * 0.014 },
              fn: (bl) => {
                const q = bl.data;
                q.ph += q.sp;
                const k = Math.min(1, bl.t / 40);
                const ex = Math.cos(q.ph) * q.R * k;
                const ey = Math.sin(q.ph) * q.R * 0.35 * k;
                bl.x = b.x + ex * Math.cos(q.tilt) - ey * Math.sin(q.tilt);
                bl.y = b.y + ex * Math.sin(q.tilt) + ey * Math.cos(q.tilt);
                bl.s = 0;
              },
            });
          }
        }
        sfx('charge');
        for (let t = 0; ; t++) {
          // the rings shed bullets tangentially
          if (t % d(26, 20, 16, 13) === 0) {
            const list = G.bullets.list.filter((bl) => bl.data && bl.data.R && !bl.dead);
            for (const bl of list) {
              if (chance(d(0.12, 0.16, 0.2, 0.24))) {
                const q = bl.data;
                shoot(bl.x, bl.y, q.ph + (q.sp > 0 ? Math.PI / 2 : -Math.PI / 2) + q.tilt, d(1.4, 1.6, 1.8, 2), 'pellet', 'white', { silent: true });
              }
            }
            sfx('enemyShot');
          }
          if (t % 100 === 50) fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.3, 2.6, 'star', 'yellow');
          yield 1;
        }
      },
    },
    {
      hp: 1300, time: 32,
      *run(b) {
        let a = 0;
        for (let k = 0; ; k++) {
          for (let i = 0; i < 36; i++) {
            for (let arm = 0; arm < d(3, 4, 5, 6); arm++) {
              shoot(b.x, b.y, a + (arm * TAU) / d(3, 4, 5, 6), 3, 'shard', 'blue', { acc: -0.03, sMin: 1.4 });
            }
            a += 0.19 + Math.sin(k) * 0.03;
            if (i % 3 === 0) sfx('enemyShot');
            yield 4;
          }
          b.wander(60);
          yield 26;
        }
      },
    },
    {
      name: 'Moonflower 「Meteor Shower Over the Clouds」', hp: 1550, time: 48, id: 's5b:3',
      *run(b) {
        b.moveTo(W / 2, 70, 40);
        yield 40;
        for (let t = 0; ; t++) {
          if (t % d(9, 7, 5, 4) === 0) {
            const x = rand(-40, W + 80);
            const a = Math.PI / 2 + 0.45 + rand(-0.06, 0.06);
            const sp = rand(3.2, 4.2) * d(0.8, 0.9, 1, 1.1);
            line(x, -16, d(3, 4, 4, 5), a, sp, sp * 0.82, 'shard', chance(0.3) ? 'yellow' : 'white', { silent: true, margin: 60 });
          }
          if (t % 70 === 35) {
            fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.8, 2.4, 'star', 'yellow');
            if (t % 140 === 35) b.wander(50, 60, 60, 100);
          }
          if (t % 8 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
    {
      hp: 1350, time: 32,
      *run(b) {
        for (let k = 0; ; k++) {
          const a = aim(b.x, b.y);
          for (let j = 0; j < 5; j++) fan(b.x, b.y, d(5, 7, 9, 11), a, 1.6, 2 + j * 0.4, 'star', j % 2 ? 'blue' : 'white', { silent: j > 0 });
          yield 40;
          ring(b.x, b.y, d(20, 26, 32, 40), rand(0, TAU), 1.4, 'pellet', 'yellow');
          yield d(36, 30, 24, 20);
          b.wander(50);
        }
      },
    },
    {
      name: 'Moonflower 「The Sky Stands Still」', hp: 1700, time: 55, id: 's5b:5',
      *run(b) {
        b.moveTo(W / 2, 130, 50);
        yield 55;
        for (let k = 0; ; k++) {
          // a star field forms and turns around her like the night sky
          const field = [];
          const layers = d(3, 4, 5, 5);
          const spin = (k % 2 ? 1 : -1) * 0.012;
          for (let r = 0; r < layers; r++) {
            const n = 8 + r * d(3, 4, 4, 5);
            for (let i = 0; i < n; i++) {
              const ph = (i * TAU) / n + r * 0.3;
              const R = 40 + r * 34;
              field.push(shoot(b.x, b.y, 0, 0, r % 2 ? 'star' : 'ball', r % 2 ? 'yellow' : 'blue', {
                margin: 400,
                data: { ph, R },
                fn: (bl) => {
                  const q = bl.data;
                  if (q.free) return;
                  q.ph += spin;
                  const kk = Math.min(1, bl.t / 50);
                  bl.x = b.x + Math.cos(q.ph) * q.R * kk;
                  bl.y = b.y + Math.sin(q.ph) * q.R * kk;
                  bl.s = 0;
                },
                silent: true,
              }));
            }
          }
          sfx('charge');
          for (let t = 0; t < d(150, 130, 120, 110); t += 10) {
            if (t % 40 === 0) fan(b.x, b.y, d(1, 1, 3, 3), aim(b.x, b.y), 0.2, 2.8, 'shard', 'white');
            yield 10;
          }
          // the sky stops turning: every star flies off along its orbit
          for (const bl of field) {
            if (bl.dead) continue;
            const q = bl.data;
            q.free = true;
            bl.a = q.ph + (spin > 0 ? Math.PI / 2 : -Math.PI / 2);
            bl.s = 0.2;
            bl.acc = 0.02;
            bl.sMax = d(1.4, 1.7, 2, 2.3) + q.R * 0.004;
          }
          G.fx.flash('#c8d8ff', 0.25);
          sfx('enemyShot2');
          yield d(110, 95, 85, 75);
          b.moveTo(rand(120, W - 120), rand(110, 150), 50);
          yield 50;
        }
      },
    },
  ],
};

export default {
  no: 5,
  jp: '星見台',
  name: 'Hoshimi Observatory',
  sub: 'The sky stands still',
  bg: 'clouds',
  music: 's5',
  midboss: MID,
  boss: BOSS,
  *script() {
    yield 120;
    // paper hitogata gliding in formation
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 6; i++) {
        const left = r % 2 === 0;
        spawn('doll', left ? -16 : W + 16, 60 + i * 18, { color: 'blue', hp: 22, s: 2.2, a: left ? 0.25 : Math.PI - 0.25, w: left ? 0.004 : -0.004, drops: drops(1, 1) }, function* (e) {
          yield 40 + i * 4;
          fan(e.x, e.y, d(1, 3, 3, 5), aim(e.x, e.y), 0.5, 2.6, 'shard', 'blue');
          yield 50;
          ring(e.x, e.y, d(0, 4, 6, 8), aim(e.x, e.y), 1.8, 'star', 'yellow', { silent: true });
        });
        yield 10;
      }
      yield 90;
    }
    // star spirits
    for (let i = 0; i < 5; i++) {
      spawn('star', 50 + i * 71, -20, { color: 'yellow', hp: 40, drops: drops(2, 3) }, function* (e) {
        yield* stopAndFire(e, 80 + (i % 2) * 50, function* () {
          for (let k = 0; k < 4; k++) {
            ring(e.x, e.y, d(5, 6, 8, 10), k * 0.3, 1.8, 'star', 'yellow');
            yield 28;
          }
        });
      });
      yield 24;
    }
    yield 200;
    // cranes streaming down the sides
    for (let i = 0; i < 16; i++) {
      const left = i % 2 === 0;
      spawn('crane', left ? 40 : W - 40, -20, { color: 'white', hp: 14, vy: 2.6, drops: drops(1, 1) }, function* (e) {
        yield 30;
        e.vx = left ? 1 : -1;
        line(e.x, e.y, d(2, 3, 4, 5), aim(e.x, e.y), 2.2, 3.6, 'shard', 'white');
      });
      yield 12;
    }
    yield* waitClear(360);
    yield 30;
    yield* fightBoss(MID);
    yield 60;

    for (let r = 0; r < 3; r++) {
      spawn('star', r % 2 ? W - 80 : 80, -20, { color: 'blue', hp: 130, scale: 1.6, drops: { power: 4, point: 6 } }, function* (e) {
        yield* stopAndFire(e, 100, function* () {
          let a = 0;
          for (let i = 0; i < d(24, 30, 36, 40); i++) {
            for (let arm = 0; arm < 4; arm++) shoot(e.x, e.y, a + (arm * TAU) / 4, 2.2, 'shard', 'blue');
            a += 0.13;
            if (i % 3 === 0) sfx('enemyShot');
            yield 5;
          }
        }, { leave: 'side' });
      });
      for (let i = 0; i < 7; i++) {
        spawn('doll', rand(30, W - 30), -16, { color: 'yellow', hp: 16, vy: 2.4, drops: drops(1, 1) }, function* (e) {
          yield 40;
          e.vy = 0.8;
          fan(e.x, e.y, d(1, 3, 3, 5), aim(e.x, e.y), 0.4, 2.6, 'star', 'yellow');
          yield 30;
          e.vy = 2.6;
        });
        yield 16;
      }
      yield 110;
    }
    yield* waitClear(500);
    yield 60;
    yield* fightBoss(BOSS, { dialog: 'pre', post: 'post' });
  },
};
