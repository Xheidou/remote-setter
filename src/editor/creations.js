// Blocs créés : codage dans l'adresse, rôles, règles, brouillons. Sans DOM (testable dans Node).
//
// Lien partageable : #<board>/b:<code>[.<cotation>]/<angle>[/<nom>]
//   code = prises triées, chacune « id en base 36 + lettre du rôle » : D départ, M main, T top, P pied
//   (lettres majuscules : la base 36 n'utilise que des minuscules), ex. « z8D1a2M2bbT » ;
//   cotation proposée = difficulté Aurora (10 = 4a … 33 = 8c+).

export const ROLE_ORDER = ['start', 'hand', 'finish', 'foot'];
const LETTER = {start: 'D', hand: 'M', finish: 'T', foot: 'P'};
const FROM_LETTER = {D: 'start', M: 'hand', T: 'finish', P: 'foot'};
export const MAX_HOLDS = 60;

export function encodeHolds(holds) {
  return holds.slice().sort((a, b) => a[0] - b[0]).map(([id, r]) => id.toString(36) + (LETTER[r] || 'M')).join('');
}
// null si le code est invalide ; les doublons gardent le dernier rôle
export function decodeHolds(code) {
  if (typeof code !== 'string' || !code || code.length > MAX_HOLDS * 6) return null;
  const re = /([0-9a-z]{1,5})([DMTP])/g, byId = new Map();
  let m, pos = 0;
  while ((m = re.exec(code))) {
    if (m.index !== pos) return null;
    pos = re.lastIndex;
    byId.set(parseInt(m[1], 36), FROM_LETTER[m[2]]);
  }
  if (pos !== code.length || !byId.size) return null;
  return [...byId].sort((a, b) => a[0] - b[0]);
}
export const isCreatedKey = s => typeof s === 'string' && s.startsWith('b:');
// « b:<code>.<cotation> » -> {holds, grade} ; null si invalide
export function parseCreatedKey(s) {
  if (!isCreatedKey(s)) return null;
  const [code, g] = s.slice(2).split('.');
  const holds = decodeHolds(code);
  if (!holds) return null;
  const grade = g && /^\d{2}$/.test(g) && +g >= 10 && +g <= 33 ? +g : null;
  return {holds, grade};
}
export const createdKey = (holds, grade) => 'b:' + encodeHolds(holds) + (grade ? '.' + grade : '');

// Rôle suivant au toucher d'une prise : départ → main → top → pied → retirée (null)
export function cycleRole(role) {
  const i = ROLE_ORDER.indexOf(role);
  return i < 0 ? 'start' : ROLE_ORDER[i + 1] || null;
}
// Nouvelle liste de prises avec le rôle de id changé (null = retirée), triée par id
export function setRole(holds, id, role) {
  const out = holds.filter(h => h[0] !== id);
  if (role) out.push([id, role]);
  return out.sort((a, b) => a[0] - b[0]);
}
export function roleCounts(holds) {
  const n = {start: 0, hand: 0, finish: 0, foot: 0};
  for (const [, r] of holds) if (r in n) n[r]++;
  return n;
}
// Règles des boards à LED (Kilter, Tension…) : 1 ou 2 départs, 1 ou 2 tops. Conseils, pas des blocages.
export function checkClimb(holds) {
  const n = roleCounts(holds), issues = [];
  if (!holds.length) return {ok: false, n, issues: ['Touchez des prises pour composer le bloc.']};
  if (!n.start) issues.push('Ajoutez une prise de départ.');
  else if (n.start > 2) issues.push('Deux prises de départ au plus.');
  if (!n.finish) issues.push('Ajoutez une prise de top.');
  else if (n.finish > 2) issues.push('Deux prises de top au plus.');
  if (holds.length > MAX_HOLDS) issues.push(`${MAX_HOLDS} prises au plus.`);
  return {ok: !issues.length, n, issues};
}

// Brouillons gardés dans le navigateur : [{id, board, name, holds, grade, from, updated}]
export const newDraftId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export function upsertDraft(list, d) {
  const out = list.filter(x => x.id !== d.id);
  out.unshift({...d, updated: Date.now()});
  return out;
}
export const removeDraft = (list, id) => list.filter(x => x.id !== id);
export function sanitizeDrafts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(d => d && typeof d.id === 'string' && typeof d.board === 'string' && Array.isArray(d.holds))
    .map(d => ({id: d.id, board: d.board, name: String(d.name || ''), grade: d.grade || null, from: d.from || null,
      updated: +d.updated || 0, holds: d.holds.filter(h => Array.isArray(h) && Number.isInteger(h[0]) && ROLE_ORDER.includes(h[1]))}));
}
