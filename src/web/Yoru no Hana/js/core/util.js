/**
 * Small math and formatting helpers shared by every module.
 */
export const TAU = Math.PI * 2;
export const PI = Math.PI;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}

/** Turn angle `a` toward `b` by at most `max` radians. */
export function turnToward(a, b, max) {
  const d = wrapAngle(b - a);
  return a + clamp(d, -max, max);
}

export const ease = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
};

/** "#rrggbb" -> "rgba(r,g,b,a)" */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Mix two "#rrggbb" colours. */
export function mix(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16);
  const b = parseInt(h2.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** Score style: 000,123,450 */
export function fmtScore(n, digits = 9) {
  let s = String(Math.max(0, Math.floor(n))).padStart(digits, '0');
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtInt(n) {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Bundled fonts (assets/fonts, loaded in main.js) come first; a missing
// glyph falls through to the next family, so Japanese inside a Cinzel
// string is drawn in Shippori Mincho. The Mincho subset also holds every
// character of the translations (locale/), Traditional Chinese included.
const MINCHO_FALLBACK = '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", "MS PMincho", "Noto Serif TC", "PMingLiU", serif';
/** Headings, menus, names, numbers: Cinzel for Latin, Shippori Mincho for Japanese. */
export const FONT_DISPLAY = `"YnH Cinzel", "YnH Mincho", ${MINCHO_FALLBACK}`;
/** Running text (dialogue, story pages, descriptions): Shippori Mincho. */
export const FONT_SERIF = `"YnH Mincho", ${MINCHO_FALLBACK}`;

const UI_FONTS = {
  'ja-jp': '"Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif',
  'zh-tw': '"Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Hiragino Sans", sans-serif',
};
/** Small hints and key labels: the system sans serif, picked for the language (a live binding). */
export let FONT_UI = UI_FONTS['ja-jp'];

export function setUiFont(lang) {
  FONT_UI = UI_FONTS[lang] || UI_FONTS['ja-jp'];
}
