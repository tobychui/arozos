/**
 * Languages. English lives in the code; `locale/<id>.json` holds a
 * translation: `ui` maps English interface strings (with `{name}`
 * placeholders) to translated ones, and the data tables (cast, stages,
 * cards, songs, story, manual) are laid over the English data by
 * data/locale.js. A missing string falls back to English.
 *
 * The "auto" setting follows the ArozOS system language (System Settings,
 * stored as localStorage global_language), else the browser's.
 */
export const LANGS = [
  { id: 'en-us', name: 'English' },
  { id: 'ja-jp', name: '日本語' },
  { id: 'zh-tw', name: '繁體中文' },
];

let lang = 'en-us';
let ui = {};

/** The closest supported language for an ArozOS / BCP 47 code. */
export function matchLang(code) {
  const c = String(code || '').toLowerCase();
  if (c.startsWith('ja')) return 'ja-jp';
  // zh-cn readers get Traditional Chinese rather than English
  if (c.startsWith('zh')) return 'zh-tw';
  return 'en-us';
}

export function systemLang() {
  let l = null;
  try {
    l = localStorage.getItem('global_language');
  } catch {
    /* storage blocked */
  }
  if (!l || l === 'default') l = navigator.language;
  return matchLang(l);
}

/** The language a setting value ('auto' or a language id) stands for. */
export function resolveLang(setting) {
  return !setting || setting === 'auto' ? systemLang() : matchLang(setting);
}

export function langName(id) {
  const l = LANGS.find((x) => x.id === id);
  return l ? l.name : id;
}

export function currentLang() {
  return lang;
}

/** Japanese and Chinese: no spaces between words, denser text. */
export function isCJK() {
  return lang !== 'en-us';
}

export function setUiStrings(id, table) {
  lang = id;
  ui = table || {};
}

/** Translate an interface string; `vars` fills `{name}` placeholders. */
export function t(en, vars) {
  let s = ui[en] || en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

/** Typing speed for dialogue and story pages: CJK text is about half as many characters. */
export function typeRate(base) {
  return isCJK() ? base * 0.55 : base;
}
