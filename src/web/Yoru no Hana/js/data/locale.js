/**
 * Lays a translation (locale/<id>.json) over the English data in place, so
 * every screen keeps reading CAST[id].name, card.name, song.title ... and
 * gets the current language. The English originals are kept the first time
 * a field is replaced; applying English (or a table without that entry)
 * puts them back.
 *
 * Table layout (every part optional):
 *   cast:   { akari: { name, sub, title, profile: [] } }   sub = secondary name line
 *   diff:   { easy: { name, jp, desc } }                  jp = the kanji emblem
 *   shots:  { akari: { shotName, shotDesc, bombName } }
 *   stages: { "1": { jp, name, sub } }
 *   cards:  { "s1m:1": "name" }
 *   songs:  { title: { title, comment } }
 *   story:  { prologue: [], prologueChar: { akari }, dialogue: { akari: { "1": { pre: [], post: [] } } },
 *             endings: { "akari/good": { title, pages: [], hint } }, credits: [[a, b]] }
 *   manual: [{ title, lines: [[term, text]] }]
 */
import { CAST, DIFFICULTIES } from './characters.js';
import { PROLOGUE, PROLOGUE_CHAR, DIALOGUE, ENDINGS, CREDITS } from './story.js';
import { MANUAL } from './manual.js';
import { SHOTS } from '../game/player.js';
import { STAGES } from '../stages/index.js';
import { SONGS } from '../audio/songs.js';

const ORIG = new Map();

/** obj[key] = value, or the English original when value is missing. */
function put(obj, key, value) {
  let o = ORIG.get(obj);
  if (!o) ORIG.set(obj, (o = {}));
  if (!(key in o)) o[key] = obj[key];
  obj[key] = value !== undefined && value !== null && value !== '' ? value : o[key];
}

function fields(obj, tr, keys) {
  for (const k of keys) put(obj, k, tr && tr[k]);
}

export function applyDataLocale(tr = {}) {
  for (const [id, c] of Object.entries(CAST)) fields(c, tr.cast && tr.cast[id], ['name', 'sub', 'title', 'profile']);
  for (const dd of DIFFICULTIES) fields(dd, tr.diff && tr.diff[dd.id], ['name', 'jp', 'desc']);
  for (const [id, s] of Object.entries(SHOTS)) fields(s, tr.shots && tr.shots[id], ['shotName', 'shotDesc', 'bombName']);
  for (const s of STAGES) {
    fields(s, tr.stages && tr.stages[s.no], ['jp', 'name', 'sub']);
    for (const def of [s.midboss, s.boss]) {
      if (!def) continue;
      def.cards.forEach((c, i) => {
        if (c.name) put(c, 'name', tr.cards && tr.cards[c.id || def.id + ':' + i]);
      });
    }
  }
  for (const s of SONGS) fields(s, tr.songs && tr.songs[s.id], ['title', 'comment']);

  const st = tr.story || {};
  PROLOGUE.forEach((_, i) => put(PROLOGUE, i, st.prologue && st.prologue[i]));
  for (const id of Object.keys(PROLOGUE_CHAR)) put(PROLOGUE_CHAR, id, st.prologueChar && st.prologueChar[id]);
  for (const [char, stages] of Object.entries(DIALOGUE)) {
    for (const [no, parts] of Object.entries(stages)) {
      for (const [key, lines] of Object.entries(parts)) {
        const tl = st.dialogue && st.dialogue[char] && st.dialogue[char][no] && st.dialogue[char][no][key];
        lines.forEach((l, i) => put(l, 'text', tl && tl[i]));
      }
    }
  }
  for (const [key, e] of Object.entries(ENDINGS)) fields(e, st.endings && st.endings[key], ['title', 'pages', 'hint']);
  CREDITS.forEach((_, i) => put(CREDITS, i, st.credits && st.credits[i]));

  MANUAL.forEach((p, i) => {
    const tp = tr.manual && tr.manual[i];
    put(p, 'title', tp && tp.title);
    p.lines.forEach((_, j) => put(p.lines, j, tp && tp.lines && tp.lines[j]));
  });
}
