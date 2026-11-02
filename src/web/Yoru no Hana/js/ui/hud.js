/**
 * The frame around the playfield, the sidebar (score, lives, bombs, power)
 * and everything drawn over the playfield: boss bar, card name and timer,
 * cut-ins, the boss name card, stage title and clear banners, dialogue.
 */
import { PF, W, H } from '../core/view.js';
import { TAU, rgba, fmtScore, fmtInt, FONT_DISPLAY, FONT_SERIF, FONT_UI, clamp, ease } from '../core/util.js';
import { CAST } from '../data/characters.js';
import { flowerIcon } from '../gfx/art.js';
import { SONGS } from '../audio/songs.js';
import { t } from '../core/i18n.js';

let frameCache = null;
let frameCachePx = 0;

/** Forget the cached frame (fonts or the logo image arrived late). */
export function resetFrameCache() {
  frameCache = null;
}

/** fillText that shrinks the font (to 60%) and then squeezes so `str` fits `max`. */
function fitText(ctx, str, x, y, max, font, size, family) {
  ctx.font = `${font}${size}px ${family}`;
  const w = ctx.measureText(str).width;
  if (w > max) ctx.font = `${font}${Math.max(size * 0.6, (size * max) / w).toFixed(1)}px ${family}`;
  ctx.fillText(str, x, y, max);
}

/** Static decorated frame (cached per scale); `art` may supply the logo image. */
export function drawFrame(ctx, px, art = null) {
  if (!frameCache || frameCachePx !== px) {
    frameCachePx = px;
    frameCache = document.createElement('canvas');
    frameCache.width = Math.ceil(W * px);
    frameCache.height = Math.ceil(H * px);
    const g = frameCache.getContext('2d');
    g.setTransform(px, 0, 0, px, 0, 0);
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1a0f30');
    bg.addColorStop(1, '#0a0618');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // faint asanoha-like lattice
    g.strokeStyle = 'rgba(200,170,255,0.06)';
    g.lineWidth = 1;
    for (let y = 0; y < H + 20; y += 20) {
      for (let x = 0; x < W + 24; x += 24) {
        const ox = (y / 20) % 2 ? 12 : 0;
        g.beginPath();
        g.moveTo(x + ox, y - 10);
        g.lineTo(x + ox + 12, y);
        g.lineTo(x + ox, y + 10);
        g.lineTo(x + ox - 12, y);
        g.closePath();
        g.stroke();
      }
    }
    // big faint flower behind the sidebar
    g.save();
    g.translate(530, 380);
    g.globalAlpha = 0.08;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      g.beginPath();
      g.ellipse(Math.cos(a) * 60, Math.sin(a) * 60, 64, 12, a, 0, TAU);
      g.fill();
    }
    g.restore();
    g.strokeStyle = '#c8a860';
    g.lineWidth = 1.5;
    g.strokeRect(PF.x - 2, PF.y - 2, PF.w + 4, PF.h + 4);
    g.strokeStyle = 'rgba(200,168,96,0.4)';
    g.lineWidth = 1;
    g.strokeRect(PF.x - 5, PF.y - 5, PF.w + 10, PF.h + 10);
    // logo
    if (!(art && art.drawLogo(g, 528, 410, 196, 104))) {
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.shadowColor = '#b080ff';
      g.shadowBlur = 12 * px;
      g.font = `bold 40px ${FONT_SERIF}`;
      g.fillText('夜の花', 528, 420);
      g.shadowBlur = 0;
      g.fillStyle = '#c8b8f0';
      g.font = `12px ${FONT_DISPLAY}`;
      g.fillText('Yoru no Hana', 528, 442);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(frameCache, 0, 0);
}

export function drawHud(ctx, G, px, input, fps) {
  ctx.setTransform(px, 0, 0, px, 0, 0);
  const x0 = 436;
  const x1 = 620;
  ctx.textBaseline = 'alphabetic';
  // difficulty badge
  ctx.textAlign = 'center';
  const dcol = ['#7fe08a', '#7fc8ff', '#ffb04a', '#ff5a8a'][G.D];
  ctx.fillStyle = rgba(dcol, 0.2);
  ctx.beginPath();
  ctx.roundRect(x0 + 20, 22, x1 - x0 - 40, 22, 11);
  ctx.fill();
  ctx.fillStyle = dcol;
  fitText(ctx, `${G.diff.name}  ${G.diff.jp}`, (x0 + x1) / 2, 38, x1 - x0 - 60, 'bold ', 13, FONT_DISPLAY);
  if (G.cheated) {
    ctx.fillStyle = '#ff8ac8';
    fitText(ctx, t(G.mode === 'talk' ? 'Story viewer' : 'Cheats used - no score'), (x0 + x1) / 2, 57, x1 - x0, '', 9.5, FONT_UI);
  }

  const label = (y, text) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#b8a8e0';
    fitText(ctx, text, x0, y, 66, '', 12, FONT_DISPLAY);
  };
  const value = (y, text, color = '#ffffff') => {
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    fitText(ctx, text, x1, y, x1 - x0 - 72, 'bold ', 14, FONT_DISPLAY);
  };
  label(72, t('HiScore'));
  value(72, fmtScore(Math.max(G.hiScore, G.score)), '#c8c0e8');
  label(92, t('Score'));
  value(92, fmtScore(G.score));

  label(124, t('Player'));
  for (let i = 0; i < 8; i++) {
    ctx.setTransform(px, 0, 0, px, (x0 + 62 + i * 15) * px, 120 * px);
    ctx.globalAlpha = i < G.lives ? 1 : 0.18;
    flowerIcon(ctx, 7, '#ff6fb4', '#ffe4f2');
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(px, 0, 0, px, 0, 0);
  ctx.font = `10px ${FONT_UI}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e8a8c8';
  ctx.fillText(t('pieces {n}/3', { n: G.lifePieces }), x1, 137);

  label(156, t('Bomb'));
  for (let i = 0; i < 8; i++) {
    ctx.setTransform(px, 0, 0, px, (x0 + 62 + i * 15) * px, 152 * px);
    ctx.globalAlpha = i < G.bombs ? 1 : 0.18;
    ctx.fillStyle = '#2fcf6a';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.quadraticCurveTo(7, -1, 0, 7);
    ctx.quadraticCurveTo(-7, -1, 0, -7);
    ctx.fill();
    ctx.strokeStyle = '#eafff0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(px, 0, 0, px, 0, 0);
  ctx.font = `10px ${FONT_UI}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a8e8b8';
  ctx.fillText(t('pieces {n}/3', { n: G.bombPieces }), x1, 169);

  label(196, t('Power'));
  value(196, G.power >= 4 ? 'MAX' : `${G.power.toFixed(2)} / 4.00`, G.power >= 4 ? '#ffd86a' : '#ff8a9a');
  label(216, t('Value'));
  value(216, fmtInt(G.pointValue), '#8ab0ff');
  label(236, t('Graze'));
  value(236, fmtInt(G.grazeCount), '#e0e0ff');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9a8ac8';
  const st = G.stage;
  fitText(ctx, `${t('Stage {n}', { n: st.no })}  ${st.jp}`, x0, 266, x1 - x0, '', 11.5, FONT_DISPLAY);
  ctx.fillStyle = rgba(G.cast.color, 0.9);
  fitText(ctx, `${G.cast.name}  ·  ${G.player.def.shotName}`, x0, 282, x1 - x0, '', 11, FONT_SERIF);

  // touch controls
  input.touchButtons = [];
  if (input.usedTouch) {
    const btn = (x, y, w, h, text, action, on) => {
      ctx.fillStyle = on ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 13px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.fillText(text, x + w / 2, y + h / 2 + 5);
      input.touchButtons.push({ x, y, w, h, action });
    };
    btn(x0, 300, 88, 50, t('Bomb'), 'bomb', input.held('bomb'));
    btn(x0 + 96, 300, 88, 50, t('Focus'), 'focus', input.held('focus'));
    btn(x0, 358, 184, 30, t('Pause'), 'pause', false);
  }

  // boss position marker under the playfield
  if (G.boss && G.boss.fighting) {
    const bx = PF.x + clamp(G.boss.x, 0, PF.w);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.fillStyle = '#ff5a7a';
    ctx.beginPath();
    ctx.moveTo(bx, PF.y + PF.h + 3);
    ctx.lineTo(bx - 7, PF.y + PF.h + 13);
    ctx.lineTo(bx + 7, PF.y + PF.h + 13);
    ctx.closePath();
    ctx.fill();
    ctx.font = `bold 8px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.fillText('BOSS', bx + 9, PF.y + PF.h + 12);
  }

  ctx.font = `10px ${FONT_UI}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6a5a90';
  ctx.fillText(`${fps.toFixed(1)} fps`, W - 8, H - 6);
}

/** Everything drawn on top of the playfield (inside its clip). */
export function drawFieldOverlay(ctx, G, px) {
  ctx.setTransform(px, 0, 0, px, 0, 0);
  const L = PF.x;
  const T = PF.y;
  const R = PF.x + PF.w;

  // boss bar and timer
  const b = G.boss;
  if (b && b.fighting && b.card) {
    const frac = clamp(b.hp / b.maxHp, 0, 1);
    const bw = PF.w - 96;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(L + 52, T + 6, bw, 5);
    const gr = ctx.createLinearGradient(L + 52, 0, L + 52 + bw, 0);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, b.cast.color);
    ctx.fillStyle = b.card.survival ? '#9a9ab0' : gr;
    ctx.fillRect(L + 52, T + 6, bw * frac, 5);
    // cards left
    const left = b.def.cards.slice(b.def.cards.indexOf(b.card) + 1).filter((c) => c.name).length;
    for (let i = 0; i < left; i++) {
      ctx.setTransform(px, 0, 0, px, (L + 10 + i * 11) * px, (T + 9) * px);
      flowerIcon(ctx, 5, b.cast.color, '#ffffff');
    }
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, b.cast.name, L + 52, T + 22, bw, 'bold ', 9.5, FONT_DISPLAY);
    const sec = Math.max(0, G.cardTimer / 60);
    ctx.textAlign = 'right';
    ctx.font = `bold 16px ${FONT_DISPLAY}`;
    ctx.fillStyle = sec < 10 ? (sec < 5 ? '#ff6a6a' : '#ffb06a') : '#ffffff';
    const whole = Math.floor(sec);
    ctx.fillText(String(whole).padStart(2, '0'), R - 18, T + 18);
    ctx.font = `bold 9px ${FONT_DISPLAY}`;
    ctx.fillText('.' + String(Math.floor((sec - whole) * 100)).padStart(2, '0'), R - 4, T + 18);
  }

  // card name and bonus
  const ci = G.cardInfo;
  if (ci) {
    const k = ease.outCubic(Math.min(1, ci.t / 70));
    const y = PF.y + PF.h - 70 + (T + 42 - (PF.y + PF.h - 70)) * k;
    ctx.textAlign = 'right';
    // long names shrink to stay inside the playfield
    const nameMax = PF.w - 40;
    ctx.font = `bold 12px ${FONT_DISPLAY}`;
    const tw = Math.min(nameMax, ctx.measureText(ci.name).width);
    const gr = ctx.createLinearGradient(R - tw - 40, 0, R, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.3, rgba(b ? b.cast.color : '#ffffff', 0.45));
    gr.addColorStop(1, rgba(b ? b.cast.color : '#ffffff', 0.65));
    ctx.fillStyle = gr;
    ctx.fillRect(R - tw - 40, y - 13, tw + 40, 18);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3 * px;
    fitText(ctx, ci.name, R - 6, y, nameMax, 'bold ', 12, FONT_DISPLAY);
    ctx.shadowBlur = 0;
    ctx.fillStyle = G.capture ? '#ffe68a' : '#a0a0b0';
    const bonus = G.capture ? fmtInt(G.currentBonus()) : t('Failed');
    fitText(ctx, t('Bonus {v}    History {a}/{b}', { v: bonus, a: ci.hist[0], b: ci.hist[1] }), R - 6, y + 13, nameMax, '', 9, FONT_UI);
  }

  // cut-in portrait
  if (G.cutin) {
    const ct = G.cutin.t;
    const spr = G.charArt.portrait(G.cutin.char, 300);
    const k = ct / 110;
    const x = R + spr.w * 0.2 - k * (PF.w + spr.w * 0.6);
    const y = T + PF.h * 0.42 + (k - 0.5) * 80;
    ctx.setTransform(px, 0, 0, px, x * px, y * px);
    ctx.globalAlpha = Math.min(1, Math.min(ct, 110 - ct) / 20) * 0.75;
    ctx.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    ctx.globalAlpha = 1;
    ctx.setTransform(px, 0, 0, px, 0, 0);
  }

  // boss name card
  if (G.bossTitle) {
    const bt = G.bossTitle.t;
    const c = CAST[G.bossTitle.char];
    const a = Math.min(1, bt / 20) * Math.min(1, (200 - bt) / 30);
    ctx.globalAlpha = a;
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(c.accent, 1);
    fitText(ctx, c.title, L + 24 + (1 - a) * 20, T + 62, PF.w - 48, '', 11.5, FONT_SERIF);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 8 * px;
    fitText(ctx, c.name, L + 24 + (1 - a) * 30, T + 88, PF.w - 48, 'bold ', 22, FONT_DISPLAY);
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(c.color, 1);
    fitText(ctx, c.sub, L + 26 + (1 - a) * 40, T + 106, PF.w - 48, '', 13, FONT_SERIF);
    ctx.globalAlpha = 1;
  }

  // banners
  for (const bn of G.banners) drawBanner(ctx, G, bn, px);

  if (G.dialog) G.dialog.render(ctx, px);
}

function drawBanner(ctx, G, bn, px) {
  const age = bn.t;
  const a = Math.min(1, age / 25) * Math.min(1, (bn.life - age) / 30);
  const cx = PF.x + PF.w / 2;
  ctx.setTransform(px, 0, 0, px, 0, 0);
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000';
  switch (bn.kind) {
    case 'stage': {
      const st = G.stage;
      const y = PF.y + 150;
      const max = PF.w - 24;
      ctx.fillStyle = '#d8c8ff';
      fitText(ctx, t('Stage {n}', { n: st.no }), cx, y - 36, max, 'bold ', 13, FONT_DISPLAY);
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 10 * px;
      fitText(ctx, st.jp, cx, y + (1 - a) * 10, max, 'bold ', 34, FONT_SERIF);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffe2b0';
      fitText(ctx, st.name, cx, y + 26, max, '', 15, FONT_DISPLAY);
      ctx.fillStyle = '#c8b8f0';
      fitText(ctx, st.sub, cx, y + 46, max, '', 12, FONT_SERIF);
      const song = SONGS.find((s) => s.id === st.music);
      if (song && age > 40) {
        ctx.globalAlpha = a * Math.min(1, (age - 40) / 20);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        fitText(ctx, 'BGM  ' + song.title, PF.x + PF.w - 8, PF.y + PF.h - 10, PF.w - 16, '', 11, FONT_SERIF);
      }
      break;
    }
    case 'clear':
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 8 * px;
      fitText(ctx, t('Stage Clear'), cx, PF.y + 170, PF.w - 24, 'bold ', 26, FONT_DISPLAY);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffe68a';
      fitText(ctx, t('Bonus  {n}', { n: fmtInt(bn.bonus) }), cx, PF.y + 200, PF.w - 24, 'bold ', 15, FONT_DISPLAY);
      break;
    case 'bonus':
      ctx.fillStyle = bn.value ? '#ffe68a' : '#b0b0c0';
      ctx.shadowBlur = 6 * px;
      fitText(ctx, t(bn.text) + (bn.value ? '!!' : ''), cx, PF.y + 120, PF.w - 24, 'bold ', 18, FONT_DISPLAY);
      ctx.shadowBlur = 0;
      if (bn.value) {
        ctx.fillStyle = '#ffffff';
        fitText(ctx, fmtInt(bn.value), cx, PF.y + 140, PF.w - 24, 'bold ', 15, FONT_DISPLAY);
      }
      break;
    case 'note':
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 6 * px;
      fitText(ctx, t(bn.text), cx, PF.y + 260 - bn.t * 0.2, PF.w - 24, 'bold ', 15, FONT_DISPLAY);
      ctx.shadowBlur = 0;
      break;
    default:
      break;
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}
