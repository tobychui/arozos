/**
 * Stage 6 - The Garden Beneath the Moon (月下の庭). Boss: Yoruka Gekka.
 * The night flower herself: blooms that open into flower-shaped rings,
 * fragrance that drifts in waves, petals falling at dawn, and her last
 * card, which keeps blooming wider the closer she is to closing.
 */
import { G, d, rand, aim, shoot, ring, fan, line, flower, laser, spawn, waitClear, fightBoss, sfx, chance, W, H, TAU } from '../game/danmaku.js';
import { stopAndFire, aimedBursts, drops } from './common.js';

const MID = {
  id: 's6m',
  char: 'yoruka',
  midboss: true,
  dropBomb: true,
  cards: [
    {
      hp: 900, time: 24,
      *run(b) {
        for (let k = 0; ; k++) {
          flower(b.x, b.y, d(24, 32, 40, 48), 6, k * 0.2, 1.6, 0.35, 'petal', 'white');
          yield d(36, 28, 22, 18);
          if (k % 2) {
            fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.7, 3, 'rice', 'green');
            b.wander(50);
          }
        }
      },
    },
    {
      name: 'Queen of the Night 「Petals on the Garden Path」', hp: 1100, time: 36, id: 's6m:1',
      *run(b) {
        for (let t = 0; ; t++) {
          if (t % d(5, 4, 3, 2) === 0) {
            const ph = rand(0, TAU);
            shoot(rand(-20, W + 20), -12, Math.PI / 2, 0, 'petal', chance(0.8) ? 'white' : 'pink', {
              vx: 0, vy: rand(1, 1.5), margin: 40,
              fn: (bl) => {
                bl.vx = Math.sin(bl.t * 0.035 + ph) * 1.1;
              },
            });
          }
          if (t % 60 === 30) {
            fan(b.x, b.y, d(3, 3, 5, 5), aim(b.x, b.y), 0.3, 2.8, 'flower', 'green');
            if (t % 120 === 30) b.wander(50);
          }
          if (t % 10 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
  ],
};

const BOSS = {
  id: 's6b',
  char: 'yoruka',
  music: 'b6',
  cards: [
    {
      hp: 1400, time: 34,
      *run(b) {
        for (let k = 0; ; k++) {
          for (let i = 0; i < 3; i++) {
            flower(b.x, b.y, d(30, 40, 48, 56), 5, k * 0.31 + i * 0.1, 1.5 + i * 0.35, 0.3, 'petal', i % 2 ? 'pink' : 'white', { silent: i > 0 });
            yield 6;
          }
          yield d(30, 24, 18, 14);
          if (k % 2) {
            fan(b.x, b.y, d(5, 7, 9, 11), aim(b.x, b.y), 0.9, 3.2, 'rice', 'green');
            b.wander(50);
          }
        }
      },
    },
    {
      name: 'Queen of the Night 「Bud in Moonlight」', hp: 1650, time: 48, id: 's6b:1',
      *run(b) {
        b.moveTo(W / 2, 130, 50);
        yield 55;
        for (let k = 0; ; k++) {
          // a bud swells in front of her, then bursts into a layered bloom
          const bud = shoot(b.x, b.y + 20, 0, 0, 'bubble', 'white', { scale: 0.4, noCancel: true });
          for (let i = 0; i < 50; i++) {
            bud.scale = 0.4 + i * 0.016;
            bud.x = b.x;
            bud.y = b.y + 20;
            if (i % 10 === 0) ring(b.x, b.y, d(6, 8, 10, 12), rand(0, TAU), 2.6, 'pellet', 'green', { silent: true });
            yield 1;
          }
          bud.dead = true;
          G.fx.burst(b.x, b.y + 20, '#ffffff', 120, 24);
          for (let layer = 0; layer < d(3, 4, 5, 5); layer++) {
            flower(b.x, b.y + 20, d(36, 44, 52, 60), 8, layer * 0.2, 1.1 + layer * 0.35, 0.45, 'petal', layer % 2 ? 'pink' : 'white', { silent: layer > 0 });
          }
          sfx('enemyShot2');
          yield 40;
          for (let i = 0; i < 4; i++) {
            fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.35, 3, 'flower', 'green');
            yield 15;
          }
          yield d(40, 30, 24, 18);
        }
      },
    },
    {
      hp: 1450, time: 34,
      *run(b) {
        let a = 0;
        for (let k = 0; ; k++) {
          for (let i = 0; i < 40; i++) {
            const arms = d(4, 5, 6, 7);
            for (let arm = 0; arm < arms; arm++) shoot(b.x, b.y, a + (arm * TAU) / arms, 2.2, 'petal', 'white', { w: k % 2 ? 0.006 : -0.006 });
            a += 0.14;
            if (i % 8 === 0) line(b.x, b.y, d(3, 4, 5, 6), aim(b.x, b.y), 2.6, 4.4, 'rice', 'pink');
            else if (i % 3 === 0) sfx('enemyShot');
            yield 4;
          }
          b.wander(50);
          yield 26;
        }
      },
    },
    {
      name: 'Queen of the Night 「Fragrance of a Single Night」', hp: 1800, time: 50, id: 's6b:3',
      *run(b) {
        b.moveTo(W / 2, 80, 40);
        yield 40;
        for (let t = 0; ; t++) {
          if (t % d(5, 4, 3, 3) === 0) {
            const a = Math.PI / 2 + Math.sin(t * 0.021) * 1.3;
            const ph = rand(0, TAU);
            shoot(b.x, b.y, a, d(1.3, 1.5, 1.7, 1.9), 'pellet', t % 2 ? 'pink' : 'white', {
              fn: (bl) => {
                bl.w = Math.sin(bl.t * 0.03 + ph) * 0.012;
              },
            });
          }
          if (t % 45 === 0) ring(b.x, b.y, d(10, 14, 18, 22), t * 0.01, 1.8, 'flower', 'pink');
          if (t % 150 === 75) {
            fan(b.x, b.y, d(3, 5, 5, 7), aim(b.x, b.y), 0.5, 3.4, 'kunai', 'green');
            b.wander(60, 60, 60, 110);
          }
          if (t % 12 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
    {
      hp: 1500, time: 34,
      *run(b) {
        for (let k = 0; ; k++) {
          const a0 = aim(b.x, b.y);
          for (const off of [-0.5, 0.5]) laser(b.x, b.y, a0 + off, 520, { w: 12, warn: 40, dur: 60, color: 'green', sound: off < 0 });
          yield 40;
          for (let i = 0; i < 6; i++) {
            flower(b.x, b.y, d(16, 20, 24, 28), 4, i * 0.2 + a0, 2, 0.25, 'petal', 'white', { silent: i > 0 });
            yield 10;
          }
          yield d(50, 40, 32, 26);
          b.wander(60);
        }
      },
    },
    {
      name: 'Queen of the Night 「Petals That Fall at Dawn」', hp: 1900, time: 52, id: 's6b:5',
      *run(b) {
        b.moveTo(W / 2, 70, 40);
        yield 40;
        for (let t = 0; ; t++) {
          if (t % d(4, 3, 2, 2) === 0) {
            const ph = rand(0, TAU);
            shoot(rand(-30, W + 30), -12, Math.PI / 2, 0, 'petal', chance(0.85) ? 'white' : 'pink', {
              vx: rand(-0.6, 0.2), vy: rand(1.1, 1.6), margin: 40,
              fn: (bl) => {
                bl.vx += Math.sin(bl.t * 0.04 + ph) * 0.02;
              },
            });
          }
          // the dawn: warm orbs rising from below, slowly
          if (t % d(100, 80, 64, 52) === 0) {
            shoot(rand(40, W - 40), H + 20, -Math.PI / 2, d(0.8, 0.9, 1, 1.1), 'orb', 'orange', {
              margin: 60,
              fn: (bl) => {
                if (bl.t % 60 === 30 && bl.y < H - 40) ring(bl.x, bl.y, d(6, 8, 10, 12), bl.t * 0.1, 1.4, 'pellet', 'yellow', { silent: true });
              },
            });
            G.fx.ring(rand(40, W - 40), H - 2, '#ffb060', 30, 20);
          }
          if (t % 90 === 45) fan(b.x, b.y, d(3, 5, 7, 9), aim(b.x, b.y), 0.8, 2.6, 'flower', 'green');
          if (t % 10 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
    {
      hp: 1550, time: 34,
      *run(b) {
        for (let k = 0; ; k++) {
          const a = aim(b.x, b.y);
          for (let j = 0; j < 6; j++) {
            ring(b.x, b.y, d(14, 18, 22, 26), a + j * 0.05, 1.6 + j * 0.4, j % 2 ? 'rice' : 'ball', j % 2 ? 'white' : 'pink', { silent: j > 0 });
            yield 3;
          }
          yield d(44, 36, 30, 24);
          fan(b.x, b.y, d(5, 7, 9, 11), a + Math.PI / d(5, 7, 9, 11), 1.4, 3, 'kunai', 'green');
          b.wander(60);
          yield 20;
        }
      },
    },
    {
      name: 'Queen of the Night 「Moon Garden Mandala」', hp: 2000, time: 55, id: 's6b:7',
      *run(b) {
        b.moveTo(W / 2, 140, 50);
        yield 55;
        let a = 0;
        for (let t = 0; ; t++) {
          if (t % d(9, 7, 6, 5) === 0) {
            const n = d(5, 6, 7, 8);
            for (let i = 0; i < n; i++) {
              shoot(b.x, b.y, a + (i * TAU) / n, 1.6, 'flower', 'white', { w: 0.008 });
              shoot(b.x, b.y, -a + (i * TAU) / n, 1.6, 'flower', 'pink', { w: -0.008 });
            }
            a += 0.09;
          }
          if (t % 80 === 0) flower(b.x, b.y, d(24, 32, 40, 48), 8, a, 1, 0.5, 'petal', 'green');
          if (t % 18 === 0) sfx('enemyShot');
          yield 1;
        }
      },
    },
    {
      name: '「Yoru no Hana」', hp: 2600, time: 70, id: 's6b:8',
      bonus: 30000000,
      *run(b) {
        b.moveTo(W / 2, 140, 60);
        yield 70;
        let a = 0;
        for (let t = 0; ; t++) {
          const k = 1 - b.hp / b.maxHp; // 0 at full health, 1 at the end
          // always: the bloom keeps opening
          if (t % Math.max(26, Math.round(d(64, 54, 46, 40) - k * 14)) === 0) {
            const layers = 1 + Math.floor(k * 2.4);
            for (let l = 0; l < layers; l++) {
              flower(b.x, b.y, d(26, 32, 38, 44), 7, a + l * 0.2, 1.2 + l * 0.35, 0.45, 'petal', l % 2 ? 'pink' : 'white', { silent: l > 0 });
            }
            a += 0.37;
          }
          // past a third: turning moonbeams
          if (k > 0.33 && t % 260 === 0) {
            const n = d(3, 4, 5, 6);
            const a0 = rand(0, TAU);
            const spin = (chance(0.5) ? 1 : -1) * 0.006;
            for (let i = 0; i < n; i++) {
              laser(b.x, b.y, a0 + (i * TAU) / n, 520, { w: 12, warn: 50, dur: 160, color: 'white', follow: b, sound: i === 0, fn: (l) => { if (l.t > l.warn) l.a += spin; } });
            }
          }
          // past two thirds: petals fall from the sky as dawn comes
          if (k > 0.66 && t % d(9, 7, 5, 4) === 0) {
            shoot(rand(0, W), -12, Math.PI / 2, 0, 'petal', 'yellow', { vx: rand(-0.4, 0.4), vy: rand(1.2, 1.7), margin: 40 });
          }
          if (t % 120 === 60) fan(b.x, b.y, d(1, 3, 3, 5), aim(b.x, b.y), 0.3, 3, 'flower', 'green');
          yield 1;
        }
      },
    },
  ],
};

export default {
  no: 6,
  jp: '月下の庭',
  name: 'The Garden Beneath the Moon',
  sub: 'One night, one bloom',
  bg: 'garden',
  music: 's6',
  midboss: MID,
  boss: BOSS,
  *script() {
    yield 120;
    // white wisps drifting like petals
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 8; i++) {
        const x = r === 1 ? W - 40 - i * 30 : 40 + i * 30;
        spawn('wisp', x, -16, { color: 'white', hp: 12, vy: 1.8, drops: drops(1, 1) }, function* (e) {
          const ph = rand(0, TAU);
          for (let t = 0; ; t++) {
            e.vx = Math.sin(t * 0.05 + ph) * 1.2;
            if (t === 45) fan(e.x, e.y, d(1, 3, 3, 5), aim(e.x, e.y), 0.4, 2.6, 'petal', 'white');
            yield 1;
          }
        });
        yield 8;
      }
      yield 80;
    }
    // moonflower spirits blooming in place
    for (let i = 0; i < 4; i++) {
      spawn('petal', 60 + i * 88, -20, { color: 'white', hp: 50, drops: drops(3, 3) }, function* (e) {
        yield* stopAndFire(e, 90 + (i % 2) * 40, function* () {
          for (let k = 0; k < 3; k++) {
            flower(e.x, e.y, d(12, 16, 20, 24), 5, k * 0.3, 1.5, 0.35, 'petal', k % 2 ? 'pink' : 'white');
            yield 34;
          }
        });
      });
      yield 26;
    }
    yield 180;
    for (let i = 0; i < 12; i++) {
      const left = i % 2 === 0;
      spawn('star', left ? -16 : W + 16, 50 + (i % 4) * 26, { color: 'yellow', hp: 24, vx: left ? 2 : -2, drops: drops(1, 2) }, function* (e) {
        for (;;) {
          yield 36;
          shoot(e.x, e.y, aim(e.x, e.y), 2.8, 'star', 'yellow');
        }
      });
      yield 16;
    }
    yield* waitClear(400);
    yield 30;
    yield* fightBoss(MID);
    yield 60;

    for (let r = 0; r < 2; r++) {
      spawn('bigLantern', r ? W - 110 : 110, -40, { color: 'white', hp: 520, drops: { power: 6, point: 10 } }, function* (e) {
        yield* stopAndFire(e, 110, function* () {
          for (let i = 0; i < 8; i++) {
            flower(e.x, e.y + 10, d(18, 24, 30, 36), 6, i * 0.2, 1.6, 0.4, 'petal', 'white');
            if (i % 2) fan(e.x, e.y, d(3, 5, 5, 7), aim(e.x, e.y), 0.5, 3, 'rice', 'green');
            yield 36;
          }
        }, { inFrames: 80, speed: 1, leave: 'side' });
      });
      for (let i = 0; i < 10; i++) {
        spawn('wisp', rand(30, W - 30), -16, { color: chance(0.5) ? 'white' : 'pink', hp: 10, vy: 2.4, drops: drops(1, 1) });
        yield 18;
      }
      yield 140;
    }
    yield* waitClear(600);
    yield 90;
    yield* fightBoss(BOSS, { dialog: 'pre', post: 'post' });
  },
};
