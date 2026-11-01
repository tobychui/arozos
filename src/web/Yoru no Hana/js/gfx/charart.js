/**
 * Character art: the optional sprite sheet and the drawn fallbacks.
 *
 * assets/characters.png (layout in assets/sheet.json, see README.md) holds a
 * waist-up portrait and a small full-body sprite for each of the eight
 * characters. The image is generated outside the game, so nothing about it is
 * trusted to be exact: a flat background is keyed out by flood fill from the
 * border when the PNG has no transparency, rows and then the sprites inside
 * each row are split at the emptiest line near each nominal cell edge, and
 * every sprite is cropped to its own bounds. When the sheet is missing (or a cell comes out empty) the game
 * draws a chibi from the character's `look` instead, and portraits become
 * hanafuda-style cards around a large version of that chibi.
 */
import { TAU, rgba, mix, FONT_SERIF } from '../core/util.js';
import { CAST, SHEET_ORDER } from '../data/characters.js';

const DEFAULT_LAYOUT = {
  image: 'characters.png',
  rows: [
    { y0: 0, y1: 0.375, kind: 'portrait', ids: ['akari', 'shizuku', 'tomoe', 'minamo'] },
    { y0: 0.375, y1: 0.75, kind: 'portrait', ids: ['kohaku', 'itoha', 'seira', 'yoruka'] },
    { y0: 0.75, y1: 1, kind: 'chibi', ids: SHEET_ORDER },
  ],
  flipPortrait: [],
  flipChibi: [],
};

export class CharArt {
  constructor(art) {
    this.art = art;
    this.status = 'none';
    this.cuts = {}; // "portrait:akari" -> canvas
    this.flipped = new Set(); // "portrait:tomoe" when the sheet's art was mirrored
    this.message = '';
  }

  async load(base = 'assets/') {
    this.status = 'loading';
    let layout = DEFAULT_LAYOUT;
    try {
      const r = await fetch(base + 'sheet.json', { cache: 'no-cache' });
      if (r.ok) layout = { ...DEFAULT_LAYOUT, ...(await r.json()) };
    } catch {
      /* use defaults */
    }
    let img;
    try {
      img = await loadImage(base + layout.image + '?v=' + Date.now());
    } catch {
      this.status = 'missing';
      this.message = 'No sprite sheet found; using drawn characters.';
      return;
    }
    try {
      this._slice(img, layout);
      const n = Object.keys(this.cuts).length;
      this.status = n ? 'ok' : 'error';
      this.message = n ? `Sprite sheet loaded (${n} sprites).` : 'Sprite sheet found but no sprites were detected.';
      this.art.cache.clear();
    } catch (err) {
      console.error(err);
      this.status = 'error';
      this.message = 'Sprite sheet could not be read: ' + err.message;
    }
  }

  // --------------------------------------------------------------- slicing --
  _slice(img, layout) {
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, W, H);
    const px = data.data;
    if (!hasTransparency(px, W, H)) keyBackground(px, W, H);
    g.putImageData(data, 0, 0);
    const solid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) solid[i] = px[i * 4 + 3] > 40 ? 1 : 0;

    // Generated art rarely respects the nominal row lines (a portrait may run
    // a few pixels into the row below), so split the rows at the emptiest
    // horizontal line near each nominal boundary instead.
    const rowOcc = new Int32Array(H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rowOcc[y] += solid[y * W + x];
    const bounds = [0];
    for (let r = 1; r < layout.rows.length; r++) bounds.push(emptiestLine(rowOcc, Math.round(layout.rows[r].y0 * H), Math.round(H * 0.06)));
    bounds.push(H);
    this.report = [];

    layout.rows.forEach((row, r) => {
      const y0 = bounds[r];
      const y1 = bounds[r + 1];
      const n = row.ids.length;
      // the same for the sprites inside the row: cut at the emptiest column
      // near each nominal cell edge
      const cols = new Int32Array(W);
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) cols[x] += solid[y * W + x];
      const cuts = [0];
      for (let i = 1; i < n; i++) cuts.push(emptiestLine(cols, Math.round((i * W) / n), Math.round(W / n / 4)));
      cuts.push(W);
      const segs = [];
      for (let i = 0; i < n; i++) segs.push([cuts[i], cuts[i + 1] - 1]);
      const touching = cuts.slice(1, -1).filter((x) => cols[x] > 0).length;
      this.report.push({ kind: row.kind, y0, y1, rowEdges: [cols[0], cols[W - 1]], cuts: cuts.slice(1, -1), touching });
      segs.forEach(([x0, x1], i) => {
        const id = row.ids[i];
        const tight = tightBox(solid, W, x0, x1, y0, y1 - 1);
        if (!tight) return;
        const [bx0, by0, bx1, by1] = tight;
        const cw = bx1 - bx0 + 1;
        const chh = by1 - by0 + 1;
        if (cw < 12 || chh < 12) return;
        const cut = document.createElement('canvas');
        cut.width = cw;
        cut.height = chh;
        const cg = cut.getContext('2d');
        const flip = (row.kind === 'portrait' ? layout.flipPortrait : layout.flipChibi) || [];
        if (flip.includes(id)) {
          cg.translate(cw, 0);
          cg.scale(-1, 1);
          this.flipped.add(row.kind + ':' + id);
        }
        cg.drawImage(c, bx0, by0, cw, chh, 0, 0, cw, chh);
        this.cuts[row.kind + ':' + id] = cut;
      });
    });
  }

  has(kind, id) {
    return !!this.cuts[kind + ':' + id];
  }

  // -------------------------------------------------------------- sprites --
  /** In-game sprite, `h` logical px tall. */
  chibi(id, h) {
    const cut = this.cuts['chibi:' + id];
    if (cut) {
      const w = (cut.width / cut.height) * h;
      return this.art.sprite('cs:' + id + ':' + h, w, h, (g) => drawScaled(g, cut, w, h));
    }
    const s = h / 60;
    return this.art.sprite('cd:' + id + ':' + h, 46 * s, 62 * s, (g) => {
      g.scale(s, s);
      drawChibi(g, CAST[id]);
    });
  }

  /** Dialogue portrait, `h` logical px tall. */
  portrait(id, h) {
    const cut = this.cuts['portrait:' + id];
    if (cut) {
      const w = (cut.width / cut.height) * h;
      return this.art.sprite('ps:' + id + ':' + h, w, h, (g) => drawScaled(g, cut, w, h));
    }
    const w = h * 0.78;
    return this.art.sprite('pd:' + id + ':' + h, w, h, (g) => drawCard(g, CAST[id], w, h));
  }
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('load failed'));
    i.src = src;
  });
}

/**
 * A single generated image (the title logo) as a canvas cropped to its
 * artwork, with a flat backdrop keyed out first when it has no alpha.
 */
export function trimToContent(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, W, H);
  if (!hasTransparency(data.data, W, H)) keyBackground(data.data, W, H);
  g.putImageData(data, 0, 0);
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = data.data[i * 4 + 3] > 40 ? 1 : 0;
  const box = tightBox(solid, W, 0, W - 1, 0, H - 1);
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Downscale in halving steps for a clean result from a big source. */
function drawScaled(g, src, w, h) {
  const px = g.getTransform().a;
  let cur = src;
  let cw = src.width;
  let ch = src.height;
  const tw = Math.max(1, Math.round(w * px));
  const th = Math.max(1, Math.round(h * px));
  while (cw / 2 > tw) {
    const n = document.createElement('canvas');
    n.width = Math.round(cw / 2);
    n.height = Math.round(ch / 2);
    const ng = n.getContext('2d');
    ng.imageSmoothingQuality = 'high';
    ng.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
    cw = n.width;
    ch = n.height;
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, -w / 2, -h / 2, w, h);
}

function hasTransparency(px, W, H) {
  let clear = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(W, H) / 64));
  for (let x = 0; x < W; x += step) {
    for (const y of [0, 1, H - 2, H - 1]) {
      n++;
      if (px[(y * W + x) * 4 + 3] < 16) clear++;
    }
  }
  return clear / n > 0.5;
}

/** Flood fill the flat background from the image border and clear it. */
function keyBackground(px, W, H) {
  const samples = [];
  const step = Math.max(1, Math.floor(W / 48));
  for (let x = 0; x < W; x += step) samples.push((0 * W + x) * 4, ((H - 1) * W + x) * 4);
  for (let y = 0; y < H; y += step) samples.push((y * W) * 4, (y * W + W - 1) * 4);
  // median colour of the border
  const ch = [0, 1, 2].map((k) => samples.map((i) => px[i + k]).sort((a, b) => a - b)[samples.length >> 1]);
  // A neutral (white / grey) backdrop sits right next to white hair and
  // dresses, so it is keyed tightly; a saturated chroma colour (the green
  // the README asks for) can be keyed loosely to swallow its noise.
  const chroma = Math.max(...ch) - Math.min(...ch);
  const tol = chroma < 60 ? 18 : 70;
  const near = (i) => {
    const dr = px[i] - ch[0];
    const dg = px[i + 1] - ch[1];
    const db = px[i + 2] - ch[2];
    return dr * dr + dg * dg + db * db;
  };
  const seen = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let qh = 0;
  let qt = 0;
  const push = (p) => {
    if (!seen[p] && near(p * 4) < tol * tol) {
      seen[p] = 1;
      q[qt++] = p;
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (qh < qt) {
    const p = q[qh++];
    const x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < W * (H - 1)) push(p + W);
  }
  // Pockets of a chroma backdrop enclosed by the art (between an arm and
  // the body) are not reached by the fill; no character is drawn in pure
  // screen green, so key those globally. Never for neutral backdrops.
  if (chroma >= 60) {
    const t2 = (tol * 0.6) ** 2;
    for (let p = 0; p < W * H; p++) if (!seen[p] && near(p * 4) < t2) seen[p] = 1;
  }
  // band[p] = distance (1..6) from the keyed area, by a breadth first walk
  const BAND = 6;
  const band = new Uint8Array(W * H);
  qh = 0;
  qt = 0;
  const visit = (p, d) => {
    if (!seen[p] && !band[p]) {
      band[p] = d;
      q[qt++] = p;
    }
  };
  for (let p = 0; p < W * H; p++) {
    if (seen[p]) continue;
    const x = p % W;
    if ((x > 0 && seen[p - 1]) || (x < W - 1 && seen[p + 1]) || (p >= W && seen[p - W]) || (p < W * (H - 1) && seen[p + W])) visit(p, 1);
  }
  while (qh < qt) {
    const p = q[qh++];
    const d = band[p];
    if (d >= BAND) continue;
    const x = p % W;
    if (x > 0) visit(p - 1, d + 1);
    if (x < W - 1) visit(p + 1, d + 1);
    if (p >= W) visit(p - W, d + 1);
    if (p < W * (H - 1)) visit(p + W, d + 1);
  }
  // a green (or blue) screen bleeds into antialiased edges: pull that
  // channel back down to the others there
  const spill = ch[1] > ch[0] + 60 && ch[1] > ch[2] + 60 ? 1 : ch[2] > ch[0] + 60 && ch[2] > ch[1] + 60 ? 2 : -1;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (seen[p]) {
      px[i + 3] = 0;
      continue;
    }
    if (!band[p]) continue;
    if (band[p] === 1) {
      const d = Math.sqrt(near(i));
      px[i + 3] = Math.min(px[i + 3], Math.max(0, Math.min(255, ((d - tol) / tol) * 255 + 90)));
    }
    if (spill >= 0) {
      const others = spill === 1 ? Math.max(px[i], px[i + 2]) : Math.max(px[i], px[i + 1]);
      if (px[i + spill] > others) px[i + spill] = others;
    }
  }
}

/**
 * The line within `range` of `nominal` with the fewest solid pixels; inside
 * a run of equally empty lines, the middle of the run nearest `nominal`.
 */
function emptiestLine(occ, nominal, range) {
  const lo = Math.max(1, nominal - range);
  const hi = Math.min(occ.length - 2, nominal + range);
  let min = Infinity;
  for (let y = lo; y <= hi; y++) if (occ[y] < min) min = occ[y];
  let best = nominal;
  let bestDist = Infinity;
  for (let y = lo; y <= hi; y++) {
    if (occ[y] !== min) continue;
    let a = y;
    while (a > lo && occ[a - 1] === min) a--;
    let b = y;
    while (b < hi && occ[b + 1] === min) b++;
    const mid = Math.round((a + b) / 2);
    const dist = Math.abs(mid - nominal);
    if (dist < bestDist) {
      bestDist = dist;
      best = mid;
    }
    y = b;
  }
  return best;
}

function tightBox(solid, W, x0, x1, y0, y1) {
  let bx0 = Infinity;
  let bx1 = -1;
  let by0 = Infinity;
  let by1 = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (solid[y * W + x]) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  return bx1 < 0 ? null : [bx0, by0, bx1, by1];
}

// ------------------------------------------------------- drawn fallbacks --
function drawCard(g, ch, w, h) {
  const L = ch.look;
  const hw = w / 2;
  const hh = h / 2;
  const bg = g.createLinearGradient(0, -hh, 0, hh);
  bg.addColorStop(0, mix(ch.color, '#0a0618', 0.55));
  bg.addColorStop(1, mix(ch.color, '#0a0618', 0.85));
  g.fillStyle = '#120a1e';
  g.beginPath();
  g.roundRect(-hw, -hh, w, h, 8);
  g.fill();
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-hw + 4, -hh + 4, w - 8, h - 8, 6);
  g.fill();
  // flower emblem
  g.save();
  g.translate(0, -h * 0.12);
  g.globalAlpha = 0.28;
  g.fillStyle = ch.accent;
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    g.beginPath();
    g.ellipse(Math.cos(a) * w * 0.25, Math.sin(a) * w * 0.25, w * 0.22, w * 0.09, a, 0, TAU);
    g.fill();
  }
  g.restore();
  // chibi, waist up
  g.save();
  g.beginPath();
  g.roundRect(-hw + 4, -hh + 4, w - 8, h - 8, 6);
  g.clip();
  const s = (h * 0.95) / 60;
  g.translate(-w * 0.04, h * 0.2);
  g.scale(s, s);
  drawChibi(g, ch);
  g.restore();
  g.strokeStyle = rgba(ch.accent, 0.9);
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(-hw + 4, -hh + 4, w - 8, h - 8, 6);
  g.stroke();
  // vertical name
  g.fillStyle = '#ffffff';
  g.font = `bold ${Math.round(h * 0.075)}px ${FONT_SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#000';
  g.shadowBlur = 4 * g.getTransform().a;
  const chars = [...ch.jp.replace(' ', '')];
  const fs = h * 0.082;
  chars.forEach((c, i) => g.fillText(c, hw - fs * 0.85, -hh + fs * 1.1 + i * fs));
  g.shadowBlur = 0;
  void L;
}

const blur = (g, n) => (g.shadowBlur = n * 0.3 * g.getTransform().a);

/** A 46 x 62 chibi centred on 0,0 (head around y = -12). */
export function drawChibi(g, ch) {
  const L = ch.look;
  const id = ch.id;
  const hairHi = mix(L.hair, '#ffffff', 0.35);

  // ---------------------------------------------------------- behind body
  if (L.prop === 'wings') {
    for (const sx of [-1, 1]) {
      g.fillStyle = mix(ch.accent, '#5a3010', 0.2);
      g.beginPath();
      g.moveTo(0, -2);
      g.bezierCurveTo(sx * 18, -22, sx * 26, -10, sx * 22, 2);
      g.bezierCurveTo(sx * 18, 6, sx * 8, 4, 0, 2);
      g.fill();
      g.fillStyle = '#e8c890';
      g.beginPath();
      g.moveTo(0, 3);
      g.bezierCurveTo(sx * 16, 6, sx * 18, 16, sx * 12, 18);
      g.bezierCurveTo(sx * 6, 16, sx * 3, 9, 0, 5);
      g.fill();
      g.fillStyle = '#fff6e0';
      g.beginPath();
      g.arc(sx * 15, -8, 3.4, 0, TAU);
      g.fill();
      g.fillStyle = '#5a2c10';
      g.beginPath();
      g.arc(sx * 15, -8, 1.8, 0, TAU);
      g.fill();
    }
  }
  if (L.prop === 'crescent') {
    g.save();
    g.shadowColor = '#fffbe0';
    blur(g, 10);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      g.fillStyle = i % 2 ? '#ffffff' : '#eef8ff';
      g.beginPath();
      g.ellipse(Math.cos(a) * 17, -4 + Math.sin(a) * 17, 11, 3.2, a, 0, TAU);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#ff9fbf';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(sx * 16, 8, 7, 2, sx * 0.6, 0, TAU);
      g.fill();
    }
  }

  // hair, back layer
  g.fillStyle = L.hairDark;
  switch (L.style) {
    case 'long':
      g.beginPath();
      g.roundRect(-13, -20, 26, 42, [12, 12, 3, 3]);
      g.fill();
      break;
    case 'wavy':
      g.beginPath();
      g.moveTo(-13, -16);
      for (let y = -12; y <= 18; y += 6) g.quadraticCurveTo(-17 + (y % 12 ? 0 : 3), y - 3, -14, y);
      g.lineTo(14, 18);
      for (let y = 18; y >= -12; y -= 6) g.quadraticCurveTo(17 - (y % 12 ? 0 : 3), y - 3, 14, y - 6);
      g.closePath();
      g.fill();
      break;
    case 'flowing': {
      const gr = g.createLinearGradient(0, -20, 0, 30);
      gr.addColorStop(0, L.hair);
      gr.addColorStop(0.75, L.hair);
      gr.addColorStop(1, L.hairDark);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-12, -18);
      g.bezierCurveTo(-20, 0, -14, 16, -19, 29);
      g.lineTo(19, 29);
      g.bezierCurveTo(14, 16, 20, 0, 12, -18);
      g.closePath();
      g.fill();
      break;
    }
    case 'fluffy':
      for (const [x, y, r] of [[-11, -8, 6], [11, -8, 6], [-9, -1, 5], [9, -1, 5], [0, -16, 12]]) {
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
      break;
    case 'buns':
      g.fillStyle = L.hair;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.arc(sx * 10, -23, 5.5, 0, TAU);
        g.fill();
      }
      g.fillStyle = L.hairDark;
      g.beginPath();
      g.arc(0, -12, 12.5, 0, TAU);
      g.fill();
      break;
    case 'updo':
      g.beginPath();
      g.arc(0, -25, 6.5, 0, TAU);
      g.arc(0, -12, 12.5, 0, TAU);
      g.fill();
      break;
    default:
      g.beginPath();
      g.arc(0, -11, 12.8, 0, TAU);
      g.fill();
      if (L.style === 'bob') {
        g.fillStyle = L.hair;
        g.beginPath();
        g.moveTo(9, -18);
        g.quadraticCurveTo(20, -14, 17, 2);
        g.quadraticCurveTo(13, -6, 8, -12);
        g.fill();
      }
  }

  // legs
  g.fillStyle = L.skin;
  g.fillRect(-4.5, 19, 3.2, 8);
  g.fillRect(1.3, 19, 3.2, 8);
  g.fillStyle = id === 'yoruka' || id === 'shizuku' ? '#f4f4ff' : '#2a1a20';
  g.beginPath();
  g.ellipse(-3, 28, 2.6, 1.6, 0, 0, TAU);
  g.ellipse(3, 28, 2.6, 1.6, 0, 0, TAU);
  g.fill();

  // dress
  g.fillStyle = L.dress;
  g.beginPath();
  g.moveTo(-6.5, -1);
  g.lineTo(6.5, -1);
  g.lineTo(13, 21);
  g.quadraticCurveTo(0, 23.5, -13, 21);
  g.closePath();
  g.fill();
  dressDetail(g, ch);
  // collar and obi
  g.strokeStyle = L.dress2;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-4.5, -1);
  g.lineTo(0, 6);
  g.lineTo(4.5, -1);
  g.stroke();
  g.fillStyle = L.obi;
  g.beginPath();
  g.moveTo(-8.2, 6);
  g.lineTo(8.2, 6);
  g.lineTo(8.8, 9.6);
  g.lineTo(-8.8, 9.6);
  g.closePath();
  g.fill();

  // sleeves and hands
  for (const sx of [-1, 1]) {
    g.fillStyle = L.dress;
    g.beginPath();
    g.moveTo(sx * 6, -1);
    g.quadraticCurveTo(sx * 15, 1, sx * 15, 12);
    g.lineTo(sx * 9, 14);
    g.quadraticCurveTo(sx * 8, 6, sx * 5, 3);
    g.closePath();
    g.fill();
    g.strokeStyle = L.dress2;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(sx * 15, 12);
    g.lineTo(sx * 9, 14);
    g.stroke();
    g.fillStyle = L.skin;
    g.beginPath();
    g.arc(sx * 11.5, 14.2, 1.9, 0, TAU);
    g.fill();
  }

  // head
  g.fillStyle = L.skin;
  g.fillRect(-2, -3, 4, 3);
  g.beginPath();
  g.arc(0, -12, 11.2, 0, TAU);
  g.fill();
  // eyes
  for (const sx of [-1, 1]) {
    const ex = sx * 4.3;
    const ey = -10;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(ex, ey, 2.6, 3.4, 0, 0, TAU);
    g.fill();
    const ir = g.createLinearGradient(0, ey - 3, 0, ey + 3);
    ir.addColorStop(0, mix(L.eyes, '#000000', 0.45));
    ir.addColorStop(1, L.eyes);
    g.fillStyle = ir;
    g.beginPath();
    g.ellipse(ex, ey + 0.3, 2.1, 3, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#1a0c18';
    g.beginPath();
    g.ellipse(ex, ey + 0.2, 0.9, 1.5, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(ex - 0.8, ey - 1.2, 0.8, 0, TAU);
    g.fill();
    g.strokeStyle = '#2a1420';
    g.lineWidth = 0.9;
    g.beginPath();
    g.ellipse(ex, ey, 2.7, 3.5, 0, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,110,140,0.35)';
  g.beginPath();
  g.ellipse(-7, -6.2, 2, 1.1, 0, 0, TAU);
  g.ellipse(7, -6.2, 2, 1.1, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#a04050';
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(0, -5.6, 1.4, 0.2, Math.PI - 0.2);
  g.stroke();

  // hair, front layer (bangs and side locks)
  g.fillStyle = L.hair;
  g.beginPath();
  g.moveTo(-11.6, -9);
  g.quadraticCurveTo(-12.5, -24, 0, -24.2);
  g.quadraticCurveTo(12.5, -24, 11.6, -9);
  g.lineTo(9.5, -14);
  g.lineTo(7.5, -11.5);
  g.lineTo(5.5, -16);
  g.lineTo(2.5, -13);
  g.lineTo(0, -17);
  g.lineTo(-2.5, -13);
  g.lineTo(-5.5, -16);
  g.lineTo(-7.5, -11.5);
  g.lineTo(-9.5, -14);
  g.closePath();
  g.fill();
  const lockLen = L.style === 'long' || L.style === 'flowing' || L.style === 'wavy' ? 6 : L.style === 'braid' ? 2 : -2;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(sx * 11.6, -14);
    g.quadraticCurveTo(sx * 13.5, -4, sx * 11, lockLen);
    g.lineTo(sx * 9.4, -8);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = hairHi;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, -15, 8.5, Math.PI * 1.15, Math.PI * 1.45);
  g.stroke();
  if (L.style === 'braid') {
    g.fillStyle = L.hair;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.ellipse(-9 - i * 0.6, -1 + i * 4.5, 2.6, 2.6, 0.3, 0, TAU);
      g.fill();
    }
    g.fillStyle = L.obi;
    g.fillRect(-12.5, 15, 4, 2);
  }

  accessories(g, ch);
}

function dressDetail(g, ch) {
  const L = ch.look;
  g.save();
  g.beginPath();
  g.moveTo(-6.5, -1);
  g.lineTo(6.5, -1);
  g.lineTo(13, 21);
  g.quadraticCurveTo(0, 23.5, -13, 21);
  g.closePath();
  g.clip();
  switch (ch.id) {
    case 'akari':
      g.fillStyle = L.dress2;
      g.fillRect(-14, 17, 28, 2);
      g.fillStyle = '#ffb040';
      for (const [x, y] of [[-6, 13], [5, 15], [0, 11]]) {
        g.beginPath();
        g.ellipse(x, y, 1.5, 2, 0, 0, TAU);
        g.fill();
      }
      break;
    case 'shizuku':
      g.strokeStyle = 'rgba(200,230,255,0.75)';
      g.lineWidth = 0.8;
      for (let x = -14; x < 14; x += 4) {
        for (const y of [16, 20]) {
          g.beginPath();
          g.arc(x + (y === 20 ? 2 : 0), y, 2, Math.PI, 0);
          g.stroke();
        }
      }
      break;
    case 'tomoe':
      g.strokeStyle = 'rgba(80,30,0,0.45)';
      g.lineWidth = 0.9;
      for (let y = 12; y < 22; y += 3) {
        g.beginPath();
        g.moveTo(-14, y);
        g.quadraticCurveTo(0, y + 2, 14, y);
        g.stroke();
      }
      break;
    case 'minamo':
      g.fillStyle = L.dress2;
      for (let x = -14; x < 14; x += 5) {
        g.beginPath();
        g.arc(x + 2.5, 22, 3, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ff7a8a';
      g.beginPath();
      g.arc(-5, 14, 1.5, 0, TAU);
      g.arc(4, 12, 1.2, 0, TAU);
      g.fill();
      break;
    case 'kohaku':
      g.fillStyle = '#fff6e6';
      for (let x = -7; x <= 7; x += 3.5) {
        g.beginPath();
        g.arc(x, -0.5, 2.6, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffd23a';
      for (const [x, y] of [[-6, 15], [6, 13], [0, 18]]) flowerDot(g, x, y, 2, '#ffd23a');
      break;
    case 'itoha':
      g.fillStyle = '#ffffff';
      for (let x = -14; x < 14; x += 3) {
        g.beginPath();
        g.arc(x + 1.5, 21, 1.8, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 0.5;
      for (let x = -12; x < 12; x += 3) {
        g.beginPath();
        g.moveTo(x, 19);
        g.lineTo(x + 1.5, 15);
        g.lineTo(x + 3, 19);
        g.stroke();
      }
      break;
    case 'seira':
      g.fillStyle = '#ffd76a';
      for (const [x, y] of [[-6, 13], [4, 16], [7, 12], [-2, 18], [0, 11]]) {
        g.beginPath();
        g.arc(x, y, 0.7, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,215,106,0.6)';
      g.lineWidth = 0.4;
      g.beginPath();
      g.moveTo(-6, 13);
      g.lineTo(0, 11);
      g.lineTo(7, 12);
      g.lineTo(4, 16);
      g.stroke();
      break;
    case 'yoruka':
      g.fillStyle = L.dress2;
      for (let x = -14; x < 14; x += 4) {
        g.beginPath();
        g.ellipse(x + 2, 19, 1.8, 5, 0, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffffff';
      for (let x = -14; x < 14; x += 4) {
        g.beginPath();
        g.ellipse(x, 17, 1.8, 6, 0, 0, TAU);
        g.fill();
      }
      break;
    default:
      break;
  }
  g.restore();
}

function flowerDot(g, x, y, r, hex) {
  g.fillStyle = hex;
  for (let i = 0; i < 4; i++) {
    const a = (i * TAU) / 4;
    g.beginPath();
    g.arc(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.55, 0, TAU);
    g.fill();
  }
}

function accessories(g, ch) {
  switch (ch.id) {
    case 'akari': {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(11.5, -19, 2.4, 1.4, 0.5, 0, TAU);
      g.fill();
      g.fillStyle = '#e8303a';
      g.beginPath();
      g.ellipse(13.5, -17.5, 2.2, 1.2, -0.4, 0, TAU);
      g.fill();
      // lantern on a stick
      g.strokeStyle = '#5a3520';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(11.5, 14);
      g.lineTo(18, -4);
      g.stroke();
      g.save();
      g.shadowColor = '#ffb040';
      blur(g, 14);
      g.fillStyle = '#ff4030';
      g.beginPath();
      g.ellipse(18.5, 2, 4.2, 5.2, 0, 0, TAU);
      g.fill();
      g.restore();
      g.fillStyle = '#ffe8a0';
      g.beginPath();
      g.ellipse(18.5, 2.4, 2.4, 3.4, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#2a1410';
      g.fillRect(16.5, -3.6, 4, 1.4);
      g.fillRect(16.5, 6.6, 4, 1.4);
      break;
    }
    case 'shizuku': {
      g.fillStyle = '#9fe4ff';
      g.beginPath();
      g.arc(-8, -19, 1.8, 0, Math.PI);
      g.lineTo(-8, -23);
      g.closePath();
      g.fill();
      g.save();
      g.shadowColor = '#c8f0ff';
      blur(g, 10);
      g.fillStyle = '#b07a3a';
      g.beginPath();
      g.arc(-15, 9, 5, 0, TAU);
      g.fill();
      g.restore();
      g.fillStyle = '#e8f6ff';
      g.beginPath();
      g.arc(-15, 9, 3.7, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(-16.2, 7.6, 1.4, 0.8, -0.6, 0, TAU);
      g.fill();
      g.fillStyle = '#8a5a2a';
      g.fillRect(-14.2, 13.5, 1.6, 3);
      break;
    }
    case 'tomoe':
      for (const sx of [-1, 1]) husk(g, sx * 13.5, -26, 0.8);
      husk(g, 16, 6, 1.1);
      break;
    case 'minamo': {
      g.save();
      g.translate(-6, -23);
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        g.fillStyle = i % 2 ? '#ffffff' : '#ffb6d6';
        g.beginPath();
        g.ellipse(Math.cos(a) * 3.6, Math.sin(a) * 2.6, 3.4, 1.5, a, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffe070';
      g.beginPath();
      g.arc(0, 0, 1.6, 0, TAU);
      g.fill();
      g.restore();
      g.fillStyle = '#ff6a5a';
      g.beginPath();
      g.moveTo(10, -16);
      g.lineTo(16, -20);
      g.lineTo(15, -12);
      g.closePath();
      g.fill();
      break;
    }
    case 'kohaku':
      g.strokeStyle = '#7a4a1a';
      g.lineWidth = 0.9;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(sx * 3, -23);
        g.quadraticCurveTo(sx * 6, -31, sx * 11, -31);
        g.stroke();
        for (let k = 0; k < 4; k++) {
          const t = 0.35 + k * 0.17;
          const x = sx * (3 + 8 * t);
          const y = -23 - 8 * Math.sin(t * Math.PI * 0.6);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + sx * 1.6, y - 1.8);
          g.stroke();
        }
      }
      break;
    case 'itoha': {
      g.strokeStyle = '#d8c8a8';
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(3, -24);
      g.lineTo(12, -31);
      g.moveTo(-2, -25);
      g.lineTo(-9, -32);
      g.stroke();
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        g.beginPath();
        g.arc(8 + Math.cos(a) * 2.4, -25 + Math.sin(a) * 2.4, 1.5, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ff5a2a';
      g.beginPath();
      g.ellipse(13, 18, 1.8, 2.6, 0, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(230,230,255,0.75)';
      g.lineWidth = 0.4;
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.moveTo(sx * 11.5, 14);
          g.lineTo(sx * (16 + k * 3), 26 - k * 6);
          g.stroke();
        }
      }
      break;
    }
    case 'seira': {
      g.strokeStyle = '#d8b050';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(-4.3, -10, 3.7, 0, TAU);
      g.moveTo(7.99, -10);
      g.arc(4.3, -10, 3.7, 0, TAU);
      g.moveTo(-0.6, -10.5);
      g.lineTo(0.6, -10.5);
      g.stroke();
      g.fillStyle = '#ffd76a';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 1.2 : 2.8;
        g.lineTo(8 + Math.cos(a) * rr, -21 + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = '#e8c060';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(16, 8, 4.5, 0, TAU);
      g.stroke();
      g.beginPath();
      g.ellipse(16, 8, 4.5, 1.6, 0.4, 0, TAU);
      g.stroke();
      g.beginPath();
      g.ellipse(16, 8, 1.6, 4.5, 0.4, 0, TAU);
      g.stroke();
      g.fillStyle = '#ffe9a0';
      g.beginPath();
      g.arc(16, 8, 1, 0, TAU);
      g.fill();
      break;
    }
    case 'yoruka':
      g.save();
      g.shadowColor = '#fff4b0';
      blur(g, 12);
      // crescent: the disc minus an offset disc, clipped to the first one
      g.beginPath();
      g.arc(0, -26, 4.4, 0, TAU);
      g.clip();
      g.fillStyle = '#ffe9a0';
      g.beginPath();
      g.rect(-6, -32, 12, 12);
      g.arc(1.8, -27, 3.8, 0, TAU, true);
      g.fill('evenodd');
      g.restore();
      for (const [x, y, a] of [[-17, 12, 0.4], [18, 4, -0.6], [15, 18, 0.9]]) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.ellipse(x, y, 3, 1.3, a, 0, TAU);
        g.fill();
      }
      break;
    default:
      break;
  }
}

function husk(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.shadowColor = '#ffa030';
  blur(g, 8);
  g.fillStyle = '#ff8a1a';
  g.beginPath();
  g.moveTo(0, -5);
  g.bezierCurveTo(5, -3, 4, 4, 0, 6);
  g.bezierCurveTo(-4, 4, -5, -3, 0, -5);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(120,40,0,0.6)';
  g.lineWidth = 0.5;
  g.beginPath();
  g.moveTo(0, -5);
  g.lineTo(0, 6);
  g.moveTo(0, -5);
  g.quadraticCurveTo(2.5, 0, 0, 6);
  g.moveTo(0, -5);
  g.quadraticCurveTo(-2.5, 0, 0, 6);
  g.stroke();
  g.fillStyle = '#5a3a10';
  g.fillRect(-0.5, -7, 1, 2);
  g.restore();
}
