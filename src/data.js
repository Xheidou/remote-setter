// Données : manifeste, géométrie et blocs de chaque board, chargés à la demande depuis public/data/
// (fichiers produits par scripts/build_board_data.py), plus l'import d'un fichier JSON personnalisé.
import {ROLES, TYPES, DIRS} from './config.js';

const BASE = (import.meta.env?.BASE_URL ?? './') + 'data/';

export const store = {
  manifest: null,          // contenu de data/index.json (sources, date, liste des boards)
  meta: new Map(),         // id -> {id, name, maker, geometry, climbs, ...} dans l'ordre du manifeste
  boards: new Map(),       // id -> géométrie normalisée (chargée à la demande)
  climbs: new Map(),       // id -> liste de blocs (chargée à la demande)
  pending: new Map()       // requêtes en cours (évite les doublons)
};

async function getJSON(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
  return r.json();
}
function once(key, fn) {
  if (!store.pending.has(key)) store.pending.set(key, fn().finally(() => store.pending.delete(key)));
  return store.pending.get(key);
}

/* ---------- Manifeste ---------- */
export async function loadManifest() {
  try {
    const m = await getJSON('index.json');
    store.manifest = m;
    for (const b of m.boards || []) store.meta.set(b.id, b);
    if (!store.meta.size) throw new Error('aucune board dans le manifeste');
    return {ok: true};
  } catch (err) {
    // Pas de données générées (développement local sans `npm run data`) : board approximative de secours
    const b = fallbackBoard();
    store.meta.set(b.id, {id: b.id, name: b.name, maker: b.maker});
    store.boards.set(b.id, b);
    store.climbs.set(b.id, sampleClimbs(b));
    return {ok: false, error: err.message};
  }
}
export const boardList = () => [...store.meta.values()];

/* ---------- Géométrie et blocs d'une board ---------- */
export function loadBoard(id) {
  if (store.boards.has(id)) return Promise.resolve(store.boards.get(id));
  const meta = store.meta.get(id);
  if (!meta || !meta.geometry) return Promise.reject(new Error(`board inconnue : ${id}`));
  return once('b:' + id, async () => {
    const b = normBoard(await getJSON(meta.geometry));
    store.boards.set(id, b);
    return b;
  });
}
export function loadClimbs(id) {
  if (store.climbs.has(id)) return Promise.resolve(store.climbs.get(id));
  const meta = store.meta.get(id);
  return once('c:' + id, async () => {
    const b = await loadBoard(id);
    let list = [];
    if (meta && meta.climbs) {
      try { list = ((await getJSON(meta.climbs)).climbs || []).filter(c => Array.isArray(c.holds)).map(c => cleanClimb({...c, board: id})); }
      catch (err) { console.warn('Blocs indisponibles pour', id, err); }
    }
    if (!list.length) list = sampleClimbs(b);       // pas encore de blocs : exemples posés sur les vraies prises
    store.climbs.set(id, list);
    return list;
  });
}
export const climbsOf = id => store.climbs.get(id) || [];

/* ---------- Normalisation ---------- */
export function validBoard(b) {
  return b && typeof b.id === 'string' && typeof b.name === 'string' && b.width > 0 && (b.panel > 0 || b.height > 0) && Array.isArray(b.holes) && b.holes.length;
}
// Board au format 2 (format 1 de la toute première version du script converti au passage)
export function normBoard(b) {
  if (b.panel == null && b.height != null) {
    const K = +b.kicker || 0;
    return normBoard({...b, panel: b.height - K, kicker: [K || 0.3, K || 0.3, K || 0.3],
      holes: b.holes.map(([i, x, y, s]) => [i, x, y - K, s == null ? 0.5 : s]), outlines: b.outlines || {}});
  }
  const k = Array.isArray(b.kicker) ? b.kicker : [+b.kicker || 0.3, +b.kicker || 0.3, +b.kicker || 0.3];
  return {...b, kicker: k, angles: b.angles || {min: 0, max: 70, step: 5, def: 40}, outlines: b.outlines || {},
    holes: b.holes.map(([i, x, y, s, t, d, f]) => [+i, +x, +y, s == null ? 0.5 : +s, TYPES[t] ? t : '', DIRS[d] ? d : '', f ? 1 : 0])};
}
export function cleanClimb(c) {
  return {id: String(c.id), board: String(c.board), name: String(c.name || 'Sans nom'), setter: c.setter ? String(c.setter) : '',
    grade: c.grade ? String(c.grade) : '', angle: c.angle == null ? null : +c.angle, ascents: +c.ascents || 0,
    stats: Array.isArray(c.stats) ? c.stats.map(s => [+s[0], String(s[1] || ''), +s[2] || 0, s[3]]) : null,
    holds: c.holds.map(([i, r]) => [+i, ROLES[r] ? r : 'hand']), sample: !!c.sample};
}

/* ---------- Import d'un fichier personnalisé ---------- */
// Une board déjà connue garde sa géométrie si le fichier importé en a moins (pas de contours, ancien format) ;
// sinon on prend celle du fichier en complétant les types de prises manquants.
export async function importData(data) {
  const nOut = b => Object.keys(b.outlines || {}).length;
  let reused = 0;
  const nb = [];
  for (const raw of (data.boards || []).filter(validBoard)) {
    let b = normBoard(raw);
    const known = store.meta.has(b.id) ? await loadBoard(b.id).catch(() => null) : null;
    if (known) {
      if (nOut(b) < nOut(known)) {
        reused++;
        const ang = b.angles && (b.angles.list || b.angles.max > b.angles.min) ? b.angles : known.angles;
        b = {...known, angles: ang};
      } else {
        const types = new Map(known.holes.map(h => [h[0], h]));
        b = {...b, holes: b.holes.map(h => { const t = types.get(h[0]); return !h[4] && t && t[4] ? [h[0], h[1], h[2], h[3], t[4], t[5], t[6]] : h; })};
      }
    }
    store.boards.set(b.id, b);
    if (!store.meta.has(b.id)) store.meta.set(b.id, {id: b.id, name: b.name, maker: b.maker || 'Importées'});
    nb.push(b);
  }
  const climbs = (data.climbs || []).filter(c => c && store.meta.has(String(c.board)) && Array.isArray(c.holds)).map(cleanClimb);
  if (!nb.length && !climbs.length) throw new Error('aucune board ni aucun bloc reconnu');
  const byBoard = new Map();
  for (const c of climbs) { if (!byBoard.has(c.board)) byBoard.set(c.board, []); byBoard.get(c.board).push(c); }
  for (const id of byBoard.keys()) await loadBoard(id);
  for (const [id, list] of byBoard) store.climbs.set(id, list);
  for (const b of nb) if (!byBoard.has(b.id)) store.climbs.set(b.id, sampleClimbs(b));
  return {boards: nb.length, climbs: climbs.length, reused, noShape: nb.filter(b => !nOut(b)).map(b => b.name),
    first: nb.length ? nb[0].id : (climbs[0] ? climbs[0].board : null)};
}

/* ---------- Exemples et secours ---------- */
function fallbackBoard() {
  const holes = []; let id = 1; const IN = 0.0254;
  for (let r = 0, y = -8; y * IN < 3.6; r++, y += 4)
    for (let x = 4 + (r % 2) * 4; x * IN < 3.6; x += 8) holes.push([id++, +(x * IN).toFixed(3), +(y * IN).toFixed(3), 0.5, '', '', 0]);
  return {id: 'approx', name: 'Board 12×12 (géométrie approximative)', maker: 'Exemple', width: 3.66, panel: 3.66,
    kicker: [0.46, 0.3, 0.9], angles: {min: 0, max: 70, step: 5, def: 40}, holes, outlines: {}, sample: true};
}
const SHAPES = [
  {name: 'Ligne droite', grade: '6b/V4', angle: 40, pts: [['start',.45,.22],['start',.55,.22],['hand',.5,.38],['hand',.42,.52],['hand',.58,.66],['hand',.5,.8],['finish',.52,.95],['foot',.46,.02],['foot',.56,.1]]},
  {name: 'Traversée montante', grade: '6c+/V5', angle: 35, pts: [['start',.12,.3],['hand',.25,.36],['hand',.4,.33],['hand',.55,.42],['hand',.7,.38],['hand',.82,.52],['finish',.88,.66],['foot',.1,.02],['foot',.3,.1],['foot',.62,.08]]},
  {name: 'Grand jeté', grade: '7a+/V7', angle: 45, pts: [['start',.36,.24],['hand',.4,.46],['hand',.64,.72],['finish',.68,.96],['foot',.32,.03],['foot',.45,.13]]},
  {name: 'Compression', grade: '7b/V8', angle: 50, pts: [['start',.3,.3],['start',.7,.3],['hand',.24,.5],['hand',.76,.55],['hand',.35,.72],['hand',.66,.82],['finish',.5,.97],['foot',.4,.03],['foot',.6,.03]]}
];
export function sampleClimbs(b) {
  const moon = b.maker === 'Moon';
  return SHAPES.map((s, i) => {
    const used = new Set(), holds = [];
    for (const [role, u, v] of s.pts) {
      if (moon && role === 'foot') continue;
      let best = null, bd = 1e9;
      for (const [id, x, y] of b.holes) {
        if (used.has(id)) continue;
        const d = (x - u * b.width) ** 2 + (y - (v * b.panel - 0.12)) ** 2;
        if (d < bd) { bd = d; best = id; }
      }
      if (best != null) { used.add(best); holds.push([best, role]); }
    }
    let angle = s.angle;
    if (b.angles.list) angle = b.angles.list.reduce((a, c) => Math.abs(c - angle) < Math.abs(a - angle) ? c : a);
    return {id: b.id + '-ex' + i, board: b.id, name: s.name, setter: '', grade: s.grade, angle, holds, sample: true};
  });
}
