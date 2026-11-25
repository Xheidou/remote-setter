// Recherche de blocs : statistiques à un angle, profil des prises, filtres et tri. Sans DOM (testable seul).
import {TYPES} from '../config.js';

// Échelle de difficulté Aurora/Boardsesh : [valeur, cotation Font, cotation V]
export const GRADES = [
  [10, '4a', 'V0'], [11, '4b', 'V0'], [12, '4c', 'V0'], [13, '5a', 'V1'], [14, '5b', 'V1'], [15, '5c', 'V2'],
  [16, '6a', 'V3'], [17, '6a+', 'V3'], [18, '6b', 'V4'], [19, '6b+', 'V4'], [20, '6c', 'V5'], [21, '6c+', 'V5'],
  [22, '7a', 'V6'], [23, '7a+', 'V7'], [24, '7b', 'V8'], [25, '7b+', 'V8'], [26, '7c', 'V9'], [27, '7c+', 'V10'],
  [28, '8a', 'V11'], [29, '8a+', 'V12'], [30, '8b', 'V13'], [31, '8b+', 'V14'], [32, '8c', 'V15'], [33, '8c+', 'V16']
];
export const GMIN = GRADES[0][0], GMAX = GRADES[GRADES.length - 1][0];
const LABEL_TO_D = new Map(GRADES.map(([d, f, v]) => [`${f}/${v}`, d]));
export const gradeFont = d => { const g = GRADES.find(x => x[0] === Math.round(d)); return g ? g[1] : ''; };

// Rôles qui comptent pour le profil d'un bloc : les mains (les pieds n'en disent pas le style)
const HAND_ROLES = new Set(['start', 'hand', 'finish']);
export const TYPE_ORDER = ['edge', 'jug', 'sloper', 'pinch', 'pocket', 'volume', 'foot_chip'];

export function statAt(c, a) { return c.stats ? c.stats.find(s => s[0] === a) || null : null; }

// Ce que vaut un bloc à l'angle a : grimpé ou non à cet angle, cotation, répétitions, note /5, benchmark
export function view(c, a) {
  const st = statAt(c, a);
  if (st) return {here: true, grade: st[1] || c.grade, asc: st[2] || 0, q: st[3] ?? null,
    diff: st[4] ?? LABEL_TO_D.get(st[1]) ?? null, bench: !!st[5]};
  if (!c.stats) return {here: true, grade: c.grade, asc: c.ascents || 0, q: null, diff: LABEL_TO_D.get(c.grade) ?? null, bench: false};
  return {here: false, grade: '', asc: 0, q: null, diff: null, bench: false};
}

// Profil des prises de main d'un bloc : {counts: {edge: 4, jug: 2…}, dom: 'edge'} (calculé une fois)
export function holdProfile(c, typeOf) {
  if (c._prof) return c._prof;
  const counts = {};
  for (const [id, role] of c.holds || []) {
    if (!HAND_ROLES.has(role)) continue;
    const t = typeOf(id);
    if (TYPES[t]) counts[t] = (counts[t] || 0) + 1;
  }
  return (c._prof = profileFromCounts(counts));
}
// Type dominant : le plus fréquent, à égalité le premier dans TYPE_ORDER
export function profileFromCounts(counts) {
  let dom = '', best = 0;
  for (const t of TYPE_ORDER) if ((counts[t] || 0) > best) { best = counts[t]; dom = t; }
  return {counts, dom};
}

// Tri « recommandés » : répétitions pondérées par la note (note absente comptée 3/5)
export const score = v => v.asc * ((v.q ?? 3) / 5);

export const SORTS = {
  rec:   {label: 'Recommandés', fn: (a, b) => (b.v.here - a.v.here) || score(b.v) - score(a.v)},
  asc:   {label: 'Les plus répétés', fn: (a, b) => b.v.asc - a.v.asc},
  q:     {label: 'Les mieux notés', fn: (a, b) => (b.v.q ?? -1) - (a.v.q ?? -1) || b.v.asc - a.v.asc},
  gup:   {label: 'Cotation croissante', fn: (a, b) => (a.v.diff ?? 99) - (b.v.diff ?? 99) || score(b.v) - score(a.v)},
  gdown: {label: 'Cotation décroissante', fn: (a, b) => (b.v.diff ?? -1) - (a.v.diff ?? -1) || score(b.v) - score(a.v)}
};

export const defaultFilters = () => ({q: '', gmin: GMIN, gmax: GMAX, bench: false, types: new Set(),
  minAsc: 0, minQ: 0, favOnly: false, unclimbed: false, sort: 'rec'});

export function activeCount(f) {
  return (f.gmin > GMIN || f.gmax < GMAX) + f.bench + (f.types.size > 0) + (f.minAsc > 0) + (f.minQ > 0) + f.favOnly + f.unclimbed;
}

// Filtre et trie les blocs d'une board à l'angle a. typeOf(id) donne le type d'une prise.
export function filterClimbs(list, a, f, typeOf, favs) {
  const q = f.q.trim().toLowerCase(), gradeOn = f.gmin > GMIN || f.gmax < GMAX, out = [];
  for (const c of list) {
    const v = view(c, a);
    if (!v.here && !f.unclimbed) continue;
    if (f.bench && !v.bench) continue;
    if (gradeOn) { if (v.diff == null) continue; const d = Math.round(v.diff); if (d < f.gmin || d > f.gmax) continue; }
    if (v.asc < f.minAsc) continue;
    if (f.minQ && (v.q ?? 0) < f.minQ) continue;
    if (f.types.size && !f.types.has(holdProfile(c, typeOf).dom)) continue;
    if (f.favOnly && !favs.has(c.id)) continue;
    if (q && !c.name.toLowerCase().includes(q) && !c.setter.toLowerCase().includes(q)) continue;
    out.push({c, v});
  }
  out.sort((SORTS[f.sort] || SORTS.rec).fn);
  return out;
}
