// Board 3D — visualiseur 3D de boards d'escalade
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {ROLES, TYPES, DIRS, fmt, nf} from './config.js';
import {holdGeometry, ringGeometry} from './holds/geometry.js';
import {mergeHolds, paintHold, commitPaint, holdMaterial, pickHold} from './holds/merge.js';
import {MAT, EYE, ROOM, buildRoom, finishTex, textSprite, matArea, faceBox, mergeStatic, steel, steelLight} from './scene/room.js';
import {store, loadManifest, loadBoard, openClimbs, climbsAt, hasClimbsAt, loadClimb, climbKey, boardList, importData} from './data.js';
import {GRADES, GMIN, GMAX, TYPE_ORDER, view, holdProfile, filterClimbs, defaultFilters, activeCount, SORTS} from './ui/filters.js';

const $ = id => document.getElementById(id);
const host = $('host');

/* ---------- Scène ---------- */
// Qualité graphique : réduite d'office sur téléphone et petite tablette (ou peu de mémoire), puis ajustée
// automatiquement si l'image saccade (voir adaptQuality)
const LOW = (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820) || (navigator.deviceMemory || 8) <= 4;
const renderer = new THREE.WebGLRenderer({antialias: !LOW, powerPreference: 'high-performance'});
let dpr = Math.min(devicePixelRatio || 1, LOW ? 1.5 : 2);
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 120);
camera.position.set(0, 2, 7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4; controls.maxDistance = 11;
controls.target.set(0, 1.8, 0.6);

scene.add(new THREE.HemisphereLight(0xfff8ee, 0x4a4540, 0.55));
const sun = new THREE.DirectionalLight(0xfff6ea, 0.75);   // éclairage principal venant du plafond, vers l'avant
sun.position.set(2.5, 9, 7); sun.castShadow = true;
sun.shadow.mapSize.setScalar(LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, {left: -9, right: 9, top: 9, bottom: -5, near: 1, far: 30});
sun.shadow.bias = -0.0005; sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
const fill = new THREE.DirectionalLight(0xe6eeff, 0.3); fill.position.set(-5, 4, 6); scene.add(fill);

/* ---------- État ---------- */
/* Préférences mémorisées dans le navigateur : board, angle et kicker par board, finition, affichage, favoris */
const PREFS_KEY = 'board3d:prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })();
prefs.boards = prefs.boards || {};
const favs = new Set(Array.isArray(prefs.favs) ? prefs.favs : []);
let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { prefs.favs = [...favs]; localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* stockage indisponible */ } }, 250);
}
const boardPrefs = id => (prefs.boards[id] = prefs.boards[id] || {});
// Favoris de la board courante, ramenés à ses ids (courts pour les blocs découpés ; anciens favoris = ids complets)
let boardFavs = new Set();
const syncFavs = () => { boardFavs = state.board ? new Set([...favs].map(f => climbKey(state.board.id, f))) : new Set(); };
const isFav = c => boardFavs.has(c.id);
function toggleFav(c) {
  if (isFav(c)) { for (const f of [...favs]) if (climbKey(c.board, f) === c.id) favs.delete(f); }
  else favs.add(c.id);
  syncFavs(); savePrefs();
}

const state = {finish: prefs.finish || 'noir', board: null, climb: null, angle: 40, kicker: 0.46, view: 'face',
  dim: prefs.dim !== false, byType: !!prefs.byType};
const F = defaultFilters();
let boardG = null, panelG = null, kickerG = null, kickBox = null, ruler = null, struts = [];
let holds = new Map(), holdLayers = [], litG = [], measureLine = null, lastPick = null;

/* ---------- Rendu à la demande ---------- */
// Une image n'est calculée que si la caméra bouge, pendant une transition de vue, ou après invalidate()
let dirty = true;
const invalidate = () => { dirty = true; };
for (const ev of ['input', 'change', 'click', 'keydown']) document.addEventListener(ev, invalidate, true);   // filet de sécurité

/* ---------- Prises ---------- */
// Toutes les prises d'un plan sont fusionnées (src/holds/merge.js) : couleur et surbrillance par sommet
const HOLD_LO = new THREE.Color(0x8d9096), HOLD_HI = new THREE.Color(0xf1efe9);   // prises blanc cassé (Kilter)
function holdColor(shade, dimmed, type, out) {
  const T = state.byType && TYPES[type];
  if (T) out.setHex(T.color); else out.copy(HOLD_LO).lerp(HOLD_HI, Math.max(0, Math.min(1, shade)));
  if (dimmed) out.multiplyScalar(0.42);
  return out;
}
const holdMatV = holdMaterial();
const fallbackGeo = new THREE.SphereGeometry(1, 16, 12);
const boltHoleGeo = new THREE.CircleGeometry(0.0055, 20), boltSinkGeo = new THREE.RingGeometry(0.0055, 0.0088, 20);
const boltHoleMat = new THREE.MeshBasicMaterial({color: 0x121316, polygonOffset: true, polygonOffsetFactor: -2});
const wellMat = new THREE.MeshStandardMaterial({color: 0x1b1c1f, roughness: 1, side: THREE.DoubleSide});
const ringMats = new Map();
const ringMat = c => ringMats.get(c) || ringMats.set(c, new THREE.MeshBasicMaterial({color: c, side: THREE.DoubleSide})).get(c);
const boltSinkMat = new THREE.MeshStandardMaterial({color: 0x8e9196, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2});

/* ---------- Construction de la board ---------- */
// Libère les géométries et textures d'une board remplacée ; les géométries et matériaux partagés restent
const SHARED_GEOS = new Set([fallbackGeo, boltHoleGeo, boltSinkGeo]);
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry && !o.isSprite && !SHARED_GEOS.has(o.geometry)) o.geometry.dispose();   // les sprites partagent une géométrie
    for (const m of [].concat(o.material || [])) if (m.map) { m.map.dispose(); m.dispose(); }
  });
}
function buildBoard(b) {
  if (boardG) { scene.remove(boardG); disposeTree(boardG); }     // plusieurs Mo par board sur le GPU
  boardG = new THREE.Group(); scene.add(boardG);
  const W = b.width, P = b.panel, T = 0.04;
  kickerG = new THREE.Group(); panelG = new THREE.Group(); boardG.add(kickerG, panelG);
  const edge = new THREE.MeshStandardMaterial({color: 0x1d2024, roughness: 0.6});
  const wood = (w, h) => new THREE.MeshStandardMaterial({map: finishTex(state.finish, w, h), roughness: state.finish === 'bois' ? 0.85 : 0.75});
  kickBox = faceBox(W, 1, T, edge, wood(W, 1));
  kickBox.castShadow = kickBox.receiveShadow = true; kickerG.add(kickBox);
  const pan = faceBox(W, P, T, edge, wood(W, P));
  pan.position.set(0, P / 2, -T / 2); pan.castShadow = pan.receiveShadow = true; panelG.add(pan);
  // Longerons acier de chaque côté du panneau et traverse haute
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, P, 0.14), steel);
    post.position.set(s * (W / 2 + 0.035), P / 2, -0.07); post.castShadow = true; panelG.add(post);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(W + 0.14, 0.08, 0.14), steel); head.position.set(0, P - 0.04, -0.11); panelG.add(head);
  // Châssis au sol derrière la board : deux poutres, une traverse, et les pieds des vérins
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.9), steel); rail.position.set(s * (W / 2 - 0.25), 0.05, -1.0); rail.castShadow = true; boardG.add(rail);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.1, 0.1), steel); cross.position.set(0, 0.05, -1.9); boardG.add(cross);
  // Vérins (corps + tige), recalculés à chaque changement d'angle
  struts = [];
  for (const s of [-1, 1]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 16), steel), rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 12), steelLight);
    body.castShadow = rod.castShadow = true; boardG.add(body, rod);
    struts.push({x: s * (W / 2 - 0.25), body, rod});
  }
  // Tapis devant la board (couvre la zone sous le dévers maximal)
  boardG.add(matArea(-W / 2 - 0.9, W / 2 + 0.9, 0.02, Math.max(4, P * 0.95 + 0.6), 0x243248));

  holds = new Map(); holdLayers = []; litG = []; const bolts = [], items = {kick: [], panel: []};
  for (const [id, x, y, shade, type, dir, foot] of b.holes) {
    const flat = b.outlines[id];
    const built = flat ? holdGeometry(flat, type, dir) : null;
    const onKick = y < 0, hx = x - W / 2;
    let re, depth;
    if (built) { re = built.re; depth = built.depth; if (built.bolt) bolts.push({b: built.bolt, x: hx, y, onKick}); }
    else { re = 0.035; depth = 0.035; }
    items[onKick ? 'kick' : 'panel'].push(built ? {id, geo: built.geo, x: hx, y, z: 0.001, hole: built.hole} : {id, geo: fallbackGeo, x: hx, y, z: 0.001, s: [re, re, re * 0.5]});
    if (built) built.geo.dispose();
    holds.set(id, {shade, type, dir, foot, flat, re, depth, onKick, x: hx, y});
  }
  // Un maillage par plan (le kicker et le panneau bougent séparément)
  for (const [k, parent] of [['kick', kickerG], ['panel', panelG]]) {
    if (!items[k].length) continue;
    const merged = mergeHolds(items[k]);
    const mesh = new THREE.Mesh(merged.geometry, [holdMatV, wellMat]);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); holdLayers.push({mesh, merged});
  }
  for (const L of holdLayers) for (const p of L.merged.parts) holds.get(p.id).merged = L.merged;
  // Trous de vis : fraisure claire + trou sombre, posés sur la surface de la prise, deux maillages instanciés par plan
  for (const onK of [true, false]) {
    const list = bolts.filter(v => v.onKick === onK); if (!list.length) continue;
    const hole = new THREE.InstancedMesh(boltHoleGeo, boltHoleMat, list.length), sink = new THREE.InstancedMesh(boltSinkGeo, boltSinkMat, list.length);
    const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 1);
    list.forEach((v, i) => {
      const nrm = new THREE.Vector3(v.b.nx, v.b.ny, v.b.nz); qn.setFromUnitVectors(Z, nrm);
      const p = new THREE.Vector3(v.x + v.b.x, v.y + v.b.y, 0.001 + v.b.z).addScaledVector(nrm, 0.0007);
      m4.compose(p, qn, one); hole.setMatrixAt(i, m4); sink.setMatrixAt(i, m4);
    });
    for (const im of [hole, sink]) { im.frustumCulled = false; (onK ? kickerG : panelG).add(im); }
  }
  buildRuler(b);
  paintClimb();
}

// Le kicker part du sol ; K est sa hauteur visible au-dessus des tapis
function setKicker(K) {
  state.kicker = K;
  const top = MAT + K;
  kickerG.position.y = top; panelG.position.y = top;
  kickBox.scale.y = top; kickBox.position.set(0, -top / 2, -0.02);
  updateStruts();
  if (state.board) { boardPrefs(state.board.id).kicker = K; savePrefs(); renderBoardSummary(); }
  $('kOut').textContent = fmt(K) + ' m';
  updateDims(); clearMeasure();
}

function buildRuler(b) {
  if (ruler) { scene.remove(ruler); disposeTree(ruler); }
  ruler = new THREE.Group();
  const x = -b.width / 2 - 0.55, top = Math.ceil(b.panel + b.kicker[2] + 0.3);
  const m = new THREE.MeshBasicMaterial({color: 0xe8ebed});
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.02, top, 0.02), m);
  pole.position.set(x, MAT + top / 2, 0.05); ruler.add(pole);
  for (let h = 0.5; h <= top + 0.001; h += 0.5) {
    const major = Number.isInteger(h);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(major ? 0.16 : 0.08, 0.012, 0.02), m);
    tick.position.set(x + (major ? 0.08 : 0.04), MAT + h, 0.05); ruler.add(tick);
    if (major) { const s = textSprite(h + ' m', 0.13); s.position.set(x - 0.2, MAT + h, 0.05); ruler.add(s); }
  }
  mergeStatic(ruler);
  scene.add(ruler);
}

/* ---------- Bloc sélectionné ---------- */
const _col = new THREE.Color(), _emi = new THREE.Color();
function paintClimb() {
  for (const o of litG) { o.parent && o.parent.remove(o); o.geometry.dispose(); }
  litG = [];
  const c = state.climb, inClimb = new Map(c && c.holds ? c.holds.map(([id, r]) => [id, r]) : []);
  const dim = state.dim && !!c;
  for (const [id, h] of holds) {
    const role = inClimb.get(id);
    if (role) {
      const R = ROLES[role] || ROLES.hand;
      paintHold(h.merged, id, holdColor(h.shade, false, h.type, _col), _emi.set(R.c).multiplyScalar(0.22));
      const geo = h.flat ? ringGeometry(h.flat, h.re) : new THREE.RingGeometry(h.re * 1.1, h.re * 1.45, 32);
      const ring = new THREE.Mesh(geo, ringMat(R.c));
      ring.position.set(h.x, h.y, 0.003);
      (h.onKick ? kickerG : panelG).add(ring); litG.push(ring);
    } else {
      paintHold(h.merged, id, holdColor(h.shade, dim, h.type, _col), null);
    }
  }
  for (const L of holdLayers) commitPaint(L.merged);
  invalidate();
}

/* ---------- Angle & mesures ---------- */
function updateDims() {
  const b = state.board, r = THREE.MathUtils.degToRad(state.angle);
  $('dTop').textContent = fmt(state.kicker + b.panel * Math.cos(r)) + ' m';
  $('dOver').textContent = fmt(b.panel * Math.sin(r)) + ' m';
  $('dSize').textContent = fmt(b.width, 2) + ' × ' + fmt(b.panel, 2) + ' m';
}
function clearMeasure() {
  if (measureLine) { scene.remove(measureLine); measureLine = null; }
  lastPick = null; $('info').textContent = '';
  invalidate();
}
function updateStruts() {
  if (!panelG || !struts.length) return;
  panelG.updateMatrixWorld(true);
  const P = state.board.panel;
  for (const st of struts) {
    const a = new THREE.Vector3(st.x, 0.1, -1.55);                                  // pied, au sol derrière
    const b = panelG.localToWorld(new THREE.Vector3(st.x, P * 0.55, -0.06));        // attache au dos du panneau
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const bodyL = Math.min(len * 0.55, 1.4);
    st.body.scale.set(1, bodyL, 1); st.body.quaternion.copy(q); st.body.position.copy(a).addScaledVector(dir, bodyL / 2);
    st.rod.scale.set(1, len - bodyL + 0.05, 1); st.rod.quaternion.copy(q); st.rod.position.copy(a).addScaledVector(dir, bodyL + (len - bodyL) / 2 - 0.025);
  }
}
function setAngle(a) {
  state.angle = a;
  panelG.rotation.x = THREE.MathUtils.degToRad(a);
  updateStruts(); invalidate();
  $('angleOut').textContent = a + '°';
  updateDims(); clearMeasure();
  boardPrefs(state.board.id).angle = a; savePrefs();
  scheduleResults(); renderFiche(); updateHash();
}
function angleUI(b) {
  const A = b.angles, seg = $('angleSeg'), rng = $('angle');
  if (A.list) {
    rng.hidden = true; seg.hidden = false; seg.textContent = '';
    for (const v of A.list) {
      const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = v + '°';
      bt.setAttribute('aria-pressed', 'false'); bt.dataset.a = v; seg.appendChild(bt);
    }
  } else {
    rng.hidden = false; seg.hidden = true;
    rng.min = A.min; rng.max = A.max; rng.step = A.step || 5;
  }
}
function applyAngle(a) {
  const A = state.board.angles;
  if (A.list) a = A.list.reduce((p, c) => Math.abs(c - a) < Math.abs(p - a) ? c : p);
  else a = Math.min(A.max, Math.max(A.min, Math.round(a / (A.step || 5)) * (A.step || 5)));
  $('angle').value = a;
  for (const bt of $('angleSeg').children) bt.setAttribute('aria-pressed', String(+bt.dataset.a === a));
  setAngle(a);
}
function kickerUI(b, K) {
  const [d, mn, mx] = b.kicker, r = $('kicker');
  const k = K == null ? d : Math.min(mx, Math.max(mn, K));
  r.min = mn; r.max = mx; r.value = k; r.disabled = mn === mx;
  $('kHint').textContent = mn === mx ? 'Hauteur standard fixe pour cette board.' : `Varie selon l'installation : ${fmt(mn)} à ${fmt(mx)} m.`;
  setKicker(k);
}

/* ---------- Ma board : résumé ---------- */
const FINISH = {noir: 'panneau noir', bois: 'contreplaqué', blanc: 'panneau blanc'};
function renderBoardSummary() {
  const b = state.board; if (!b) return;
  $('bName').textContent = b.name;
  $('bMeta').textContent = `kicker ${fmt(state.kicker)} m · ${FINISH[state.finish] || ''}`;
}
function toggleBoardEdit(open) {
  const bt = $('boardSum'), box = $('boardEdit');
  const o = open == null ? box.hidden : open;
  box.hidden = !o; bt.setAttribute('aria-expanded', String(o));
}

/* ---------- Trouver un bloc : filtres, tri, liste ---------- */
const typeOf = id => { const h = holds.get(id); return h ? h.type : ''; };
const benchWord = () => state.board && state.board.maker === 'Kilter' ? ['Vérifiés', 'vérifié'] : ['Benchmarks', 'benchmark'];
const shortGrade = g => (g || '').replace('/', ' · ');
const dotColor = t => '#' + TYPES[t].color.toString(16).padStart(6, '0');
const capital = w => w.charAt(0).toUpperCase() + w.slice(1);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function typeBadges(prof, max) {
  return Object.entries(prof.counts).sort((a, b) => b[1] - a[1]).slice(0, max).map(([t, n]) => {
    const b = el('span', 'tbadge'), i = el('i'); i.style.background = dotColor(t);
    b.append(i, `${n} ${n > 1 ? TYPES[t].plural : TYPES[t].label}`); return b;
  });
}

function buildFilterUI() {
  const opt = (sel, d, f, v) => { const o = el('option', null, f); o.value = d; o.title = `${f} (${v})`; sel.appendChild(o); };
  for (const [d, f, v] of GRADES) { opt($('gmin'), d, f, v); opt($('gmax'), d, f, v); }
  $('gmin').value = GMIN; $('gmax').value = GMAX;
  for (const [k, s] of Object.entries(SORTS)) { const o = el('option', null, s.label); o.value = k; $('sort').appendChild(o); }
  const box = $('fTypes');
  for (const t of TYPE_ORDER.filter(t => !['volume', 'foot_chip'].includes(t))) {
    const b = el('button', 'chip'); b.type = 'button'; b.dataset.t = t; b.setAttribute('aria-pressed', 'false');
    b.title = `Blocs où les ${TYPES[t].plural} dominent`;
    const i = el('i'); i.style.background = dotColor(t); b.append(i, capital(TYPES[t].plural)); box.appendChild(b);
  }
}
function syncFilterUI() {
  $('fBench').textContent = benchWord()[0];
  $('fBench').setAttribute('aria-pressed', String(F.bench));
  for (const b of $('fTypes').children) b.setAttribute('aria-pressed', String(F.types.has(b.dataset.t)));
  const more = (F.minAsc > 0) + (F.minQ > 0) + F.favOnly + F.unclimbed;
  $('moreCount').textContent = more ? `(${more})` : '';
  $('fReset').hidden = !(activeCount(F) || F.q.trim());
}

const PAGE = 60;
let results = [], shown = 0, resultsRaf = 0, resultsTimer = 0, resultsSeq = 0;
// Liste déjà en mémoire : au prochain affichage ; sinon on attend un peu (curseur d'angle qu'on fait glisser)
function scheduleResults() {
  cancelAnimationFrame(resultsRaf); clearTimeout(resultsTimer);
  if (!state.board) return;
  if (hasClimbsAt(state.board.id, state.angle, F.unclimbed)) resultsRaf = requestAnimationFrame(computeResults);
  else { $('count').textContent = 'Chargement…'; resultsTimer = setTimeout(computeResults, 200); }
}
async function computeResults() {
  cancelAnimationFrame(resultsRaf); clearTimeout(resultsTimer);
  if (!state.board) return;
  const seq = ++resultsSeq, id = state.board.id, a = state.angle;
  let list;
  if (!hasClimbsAt(id, a, F.unclimbed)) $('count').textContent = 'Chargement…';
  try { list = await climbsAt(id, a, F.unclimbed); }
  catch (err) {
    if (seq !== resultsSeq) return;
    results = []; $('list').textContent = ''; $('moreRes').hidden = true;
    $('count').textContent = 'Blocs indisponibles'; $('list').appendChild(el('p', 'empty', `Chargement impossible (${err.message}).`));
    return;
  }
  // une demande plus récente a pris le relais, ou l'angle / la board ont changé pendant le chargement
  if (seq !== resultsSeq || !state.board || state.board.id !== id || state.angle !== a) return;
  results = filterClimbs(list, a, F, typeOf, boardFavs);
  shown = 0; $('list').textContent = '';
  $('count').textContent = `${nf.format(results.length)} bloc${results.length > 1 ? 's' : ''} à ${state.angle}°`;
  syncFilterUI();
  if (!results.length) {
    const p = el('p', 'empty', activeCount(F) || F.q.trim() ? 'Aucun bloc ne correspond. Élargissez la cotation ou retirez un filtre.' : `Aucun bloc grimpé à ${state.angle}° sur cette board.`);
    $('list').appendChild(p); $('moreRes').hidden = true; return;
  }
  renderMore();
}
function renderMore() {
  const frag = document.createDocumentFragment(), [, bw] = benchWord();
  for (const {c, v} of results.slice(shown, shown + PAGE)) {
    const row = el('button', 'row'); row.type = 'button'; row.setAttribute('role', 'listitem'); row.dataset.id = c.id;
    row.setAttribute('aria-current', String(state.climb === c));
    const name = el('span', 'rname', c.name);
    if (v.bench) name.append(el('span', 'bench', bw));
    if (isFav(c)) name.append(el('span', 'fav', '♥'));
    const grade = el('span', 'rgrade', v.here ? shortGrade(v.grade) : '—');
    const meta = el('span', 'rmeta', [v.here ? `${nf.format(v.asc)} répét.` : `jamais fait à ${state.angle}°`,
      v.q != null ? `★ ${fmt(v.q, 1)}` : '', c.setter, c.sample ? 'exemple' : ''].filter(Boolean).join(' · '));
    const badges = el('span', 'rbadges'); badges.append(...typeBadges(holdProfile(c, typeOf), 3));
    row.append(name, grade, meta, badges);
    row.addEventListener('click', () => selectClimb(c));
    row.addEventListener('pointerenter', () => { if (!c.holds) loadClimb(c.board, c.id).catch(() => {}); }, {once: true});   // détail préchargé au survol
    frag.appendChild(row);
  }
  shown += PAGE; $('list').appendChild(frag);
  $('moreRes').hidden = shown >= results.length;
  if (!$('moreRes').hidden) $('moreRes').textContent = `Afficher plus (${nf.format(results.length - shown)} restants)`;
}
function markCurrent() {
  for (const r of $('list').children) if (r.dataset.id) r.setAttribute('aria-current', String(!!state.climb && r.dataset.id === state.climb.id));
}

/* ---------- Fiche du bloc ---------- */
function renderFiche() {
  const c = state.climb, box = $('fiche');
  if (!c || !state.board) { box.hidden = true; return; }
  box.hidden = false;
  const v = view(c, state.angle), [, bw] = benchWord();
  $('fName').textContent = c.name;
  const g = $('fGrade'); g.textContent = v.here ? `${shortGrade(v.grade)} à ${state.angle}°` : `pas fait à ${state.angle}°`;
  if (v.bench) g.append(el('span', 'bench', bw));
  $('fMeta').textContent = [c.setter ? `par ${c.setter}` : '', v.here && v.asc ? `${nf.format(v.asc)} répétitions` : '',
    v.q != null ? `★ ${fmt(v.q, 1)} / 5` : '', c.sample ? 'bloc d\'exemple' : ''].filter(Boolean).join(' · ');
  const t = $('fTypesOut'); t.textContent = '';
  const prof = holdProfile(c, typeOf);
  if (Object.keys(prof.counts).length) { t.append(el('span', 'rmeta', 'Mains :'), ...typeBadges(prof, 6)); }
  const an = $('fAngles'); an.textContent = '';
  for (const s of (c.stats || []).slice().sort((a, b) => a[0] - b[0])) {
    const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(s[0] === state.angle));
    b.append(`${s[0]}°`, el('small', null, (s[1] || '').split('/')[0]));
    b.title = `${s[1]} à ${s[0]}° · ${nf.format(s[2])} répétitions`;
    b.addEventListener('click', () => applyAngle(s[0])); an.appendChild(b);
  }
  an.hidden = !an.children.length;
  const fav = isFav(c);
  $('aFav').setAttribute('aria-pressed', String(fav)); $('aFav').textContent = fav ? '♥ Dans vos favoris' : '♡ Ajouter aux favoris';
}

/* ---------- Liens partageables : #board/bloc/angle ---------- */
function updateHash() {
  if (!state.board) return;
  const h = '#' + [state.board.id, state.climb ? encodeURIComponent(state.climb.id) : '', state.angle].join('/');
  if (location.hash !== h) history.replaceState(null, '', h);
}
function parseHash() {
  const [b, c, a] = location.hash.replace(/^#\/?/, '').split('/');
  return {board: b || null, climb: c ? decodeURIComponent(c) : null, angle: a && !isNaN(+a) ? +a : null};
}

// Le détail (prises) d'un bloc découpé est chargé avant de l'afficher ; une sélection plus récente annule celle-ci
let climbSeq = 0;
async function selectClimb(c) {
  const seq = ++climbSeq;
  if (c && !c.holds) {
    try { c = (await loadClimb(c.board, c.id)) || c; } catch (err) { console.warn('Détail du bloc indisponible', err); }
    if (seq !== climbSeq || !state.board || c.board !== state.board.id) return;   // autre bloc ou autre board entre-temps
    if (!c.holds) { $('msg').textContent = `Détail du bloc « ${c.name} » indisponible.`; return; }
  }
  state.climb = c; paintClimb(); renderFiche(); markCurrent(); updateHash();
}
const findClimb = (board, id) => loadClimb(board, id).catch(err => { console.warn('Bloc introuvable', id, err); return null; });

// Chargement à la demande de la géométrie et des blocs ; une sélection plus récente annule la précédente
let selectSeq = 0;
async function selectBoard(id, want = {}) {
  const seq = ++selectSeq;
  $('board').value = id;
  $('bName').textContent = 'Chargement…'; $('count').textContent = '—';
  let b;
  try { b = await loadBoard(id); await openClimbs(id); }
  catch (err) { if (seq === selectSeq) { $('bName').textContent = 'Board indisponible'; $('bMeta').textContent = err.message; } return; }
  if (seq !== selectSeq) return;
  state.board = b; state.climb = null; syncFavs();
  prefs.board = id; savePrefs();
  $('boardNote').textContent = [b.note, b.approx].filter(Boolean).join(' · ');
  buildBoard(b); angleUI(b);
  const bp = boardPrefs(id);
  kickerUI(b, bp.kicker);
  renderBoardSummary();
  applyAngle(want.angle ?? bp.angle ?? b.angles.def);
  goView(state.view, true);
  const [, wanted] = await Promise.all([computeResults(), want.climb ? findClimb(id, want.climb) : null]);
  if (seq !== selectSeq) return;
  await selectClimb(wanted || (results[0] && results[0].c) || null);
}

function renderDataInfo() {
  const m = store.manifest, el2 = $('dataInfo');
  if (!m) { el2.textContent = 'Aucune donnée générée : board approximative et blocs d\'exemple.'; return; }
  const d = m.generated ? new Date(m.generated) : null;
  const n = boardList().reduce((a, b) => a + (b.climbCount || 0), 0);
  el2.textContent = `${boardList().length} boards, ${nf.format(n)} blocs` + (d && !isNaN(d) ? `, données du ${d.toLocaleDateString('fr-FR')}` : '') + '.';
}

function renderBoards() {
  const sel = $('board'); sel.textContent = '';
  const groups = new Map();
  for (const b of boardList()) { const k = b.maker || 'Autres'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  for (const [k, list] of groups) {
    const og = document.createElement('optgroup'); og.label = k;
    for (const b of list) { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; og.appendChild(o); }
    sel.appendChild(og);
  }
}

/* ---------- Vues caméra ---------- */
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let tween = null;
function panelPoint(t) {
  const b = state.board, r = THREE.MathUtils.degToRad(state.angle);
  return new THREE.Vector3(0, MAT + state.kicker + b.panel * t * Math.cos(r), b.panel * t * Math.sin(r));
}
function goView(v, instant) {
  state.view = v;
  for (const bt of document.querySelectorAll('[data-view]')) bt.setAttribute('aria-pressed', String(bt.dataset.view === v));
  const b = state.board, mid = panelPoint(0.45); let pos, tgt;
  const fit = Math.max(b.width, b.panel + state.kicker);
  if (v === 'side') { pos = new THREE.Vector3(Math.min(ROOM.x - 1.6, b.width / 2 + fit * 1.3), 2.0, mid.z + 1.6); tgt = mid.clone().setX(0); }
  else if (v === 'climber') { pos = new THREE.Vector3(0, MAT + EYE, 1.9 + mid.z * 0.4); tgt = panelPoint(0.7); }   // vue depuis le tapis, à hauteur des yeux
  else { pos = new THREE.Vector3(0, 2.1, Math.min(ROOM.front - 1, fit * 1.5 + mid.z)); tgt = mid; }
  if (instant || reduce) { camera.position.copy(pos); controls.target.copy(tgt); tween = null; invalidate(); }
  else tween = {p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt, s: performance.now(), d: 650};
}

/* ---------- Sélection de prise & mesure ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY}; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const rc = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  let hit = null; scene.updateMatrixWorld();
  for (const L of holdLayers) { const r = pickHold(L.merged, L.mesh, ray.ray); if (r && (!hit || r.distance < hit.distance)) hit = r; }
  if (!hit) return;
  const id = hit.id, h = holds.get(id);
  const role = state.climb ? (state.climb.holds.find(x => x[0] === id) || [])[1] : null;
  const wp = new THREE.Vector3(h.x, h.y, 0); (h.onKick ? kickerG : panelG).localToWorld(wp);
  const T = TYPES[h.type], Dd = DIRS[h.dir];
  let txt = `Prise ${id}${role ? ' · ' + ROLES[role].label : ''}${T ? ' · ' + T.label + (Dd && h.type !== 'foot_chip' ? ', ' + Dd[2] : '') : ''} · ${fmt(wp.y - MAT)} m du tapis`;
  if (lastPick) {
    txt += ` · ${fmt(wp.distanceTo(lastPick))} m de la précédente`;
    if (measureLine) scene.remove(measureLine);
    measureLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([lastPick, wp]), new THREE.LineBasicMaterial({color: 0xffffff, depthTest: false}));
    measureLine.renderOrder = 10; scene.add(measureLine);
  }
  invalidate();
  lastPick = wp.clone();
  const info = $('info'); info.textContent = '';
  const card = document.createElement('div'); card.className = 'card'; card.textContent = txt; info.appendChild(card);
});

/* ---------- Thème & taille ---------- */
function syncTheme() {               // la scène est une salle intérieure : fond et brume fixes
  scene.background = new THREE.Color(0x1d1f22);
  scene.fog = new THREE.Fog(0x2a2b2e, 16, 34);
  invalidate();
}
new MutationObserver(syncTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
const ro = new ResizeObserver(() => {
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
});
ro.observe(host);

/* ---------- Import ---------- */
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const msg = $('msg'); msg.textContent = 'Lecture…';
  try {
    const r = await importData(JSON.parse(await f.text()));
    renderBoards();
    await selectBoard(r.first || state.board.id);
    msg.textContent = `${r.boards} board(s) et ${nf.format(r.climbs)} bloc(s) importés.`
      + (r.reused ? ` Géométrie réelle conservée pour ${r.reused} board(s) (le fichier n'avait pas les contours des prises).` : '')
      + (r.noShape.length ? ` Sans contours de prises : ${r.noShape.join(', ')}.` : '');
  } catch (err) { msg.textContent = 'Import impossible : ' + err.message; }
  e.target.value = '';
});

/* ---------- Événements ---------- */
$('boardSum').addEventListener('click', () => toggleBoardEdit());
$('board').addEventListener('change', e => selectBoard(e.target.value));
$('finish').addEventListener('change', e => {
  state.finish = e.target.value; prefs.finish = state.finish; savePrefs();
  const keepClimb = state.climb, keepAngle = state.angle, keepK = state.kicker;
  buildBoard(state.board); setKicker(keepK); state.climb = keepClimb; paintClimb(); applyAngle(keepAngle); renderBoardSummary();
});
$('angle').addEventListener('input', e => setAngle(+e.target.value));
$('angleSeg').addEventListener('click', e => { const bt = e.target.closest('button'); if (bt) applyAngle(+bt.dataset.a); });
$('kicker').addEventListener('input', e => setKicker(+e.target.value));

let qTimer = null;
$('q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = e.target.value; computeResults(); }, 150); });
const gradeChange = which => {
  let lo = +$('gmin').value, hi = +$('gmax').value;
  if (lo > hi) { if (which === 'min') hi = lo; else lo = hi; $('gmin').value = lo; $('gmax').value = hi; }
  F.gmin = lo; F.gmax = hi; computeResults();
};
$('gmin').addEventListener('change', () => gradeChange('min'));
$('gmax').addEventListener('change', () => gradeChange('max'));
$('fBench').addEventListener('click', () => { F.bench = !F.bench; computeResults(); });
$('fTypes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  F.types.has(b.dataset.t) ? F.types.delete(b.dataset.t) : F.types.add(b.dataset.t); computeResults();
});
$('fAsc').addEventListener('change', e => { F.minAsc = +e.target.value; computeResults(); });
$('fQ').addEventListener('change', e => { F.minQ = +e.target.value; computeResults(); });
$('fFav').addEventListener('change', e => { F.favOnly = e.target.checked; computeResults(); });
$('fUnclimbed').addEventListener('change', e => { F.unclimbed = e.target.checked; computeResults(); });
$('sort').addEventListener('change', e => { F.sort = e.target.value; computeResults(); });
$('fReset').addEventListener('click', () => {
  Object.assign(F, defaultFilters(), {sort: F.sort});
  $('q').value = ''; $('gmin').value = GMIN; $('gmax').value = GMAX; $('fAsc').value = 0; $('fQ').value = 0;
  $('fFav').checked = false; $('fUnclimbed').checked = false; computeResults();
});
$('moreRes').addEventListener('click', renderMore);

$('aFav').addEventListener('click', () => {
  const c = state.climb; if (!c) return;
  toggleFav(c); renderFiche();
  const row = [...$('list').children].find(r => r.dataset.id === c.id);
  if (row) { const n = row.querySelector('.rname'); const f = n.querySelector('.fav'); if (isFav(c) && !f) n.append(el('span', 'fav', '♥')); else if (!isFav(c) && f) f.remove(); }
  if (F.favOnly) computeResults();
});
$('aShare').addEventListener('click', async () => {
  updateHash();
  const bt = $('aShare');
  try { await navigator.clipboard.writeText(location.href); bt.textContent = 'Lien copié'; }
  catch { bt.textContent = 'Lien dans la barre d\'adresse'; }
  setTimeout(() => { bt.textContent = 'Copier le lien'; }, 2200);
});

const setToggle = (id, on) => $(id).setAttribute('aria-pressed', String(on));
$('tDim').addEventListener('click', () => { state.dim = !state.dim; prefs.dim = state.dim; savePrefs(); setToggle('tDim', state.dim); paintClimb(); });
$('tType').addEventListener('click', () => {
  state.byType = !state.byType; prefs.byType = state.byType; savePrefs();
  setToggle('tType', state.byType); $('typeLegend').hidden = !state.byType; paintClimb();
});
{
  const lg = $('typeLegend');
  for (const [, T] of Object.entries(TYPES)) {
    const sp = el('span'), i = el('i'); i.style.background = '#' + T.color.toString(16).padStart(6, '0'); sp.append(i, T.label); lg.appendChild(sp);
  }
}
for (const bt of document.querySelectorAll('[data-view]')) bt.addEventListener('click', () => goView(bt.dataset.view));
window.addEventListener('hashchange', async () => {
  const h = parseHash();
  if (h.board && h.board !== (state.board && state.board.id)) selectBoard(h.board, h);
  else if (state.board) {
    const id = state.board.id;
    if (h.angle != null && h.angle !== state.angle) applyAngle(h.angle);
    if (h.climb && (!state.climb || state.climb.id !== climbKey(id, h.climb))) {
      const c = await findClimb(id, h.climb);
      if (c && state.board && state.board.id === id) selectClimb(c);
    }
  }
});

/* ---------- Démarrage ---------- */
const ease = t => 1 - (1 - t) ** 3;
function loop(now) {
  if (tween) {
    const t = Math.min(1, (now - tween.s) / tween.d), k = ease(t);
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (t >= 1) tween = null;
  }
  const moved = controls.update();
  const cp = camera.position;                                    // la caméra reste dans la salle
  cp.x = Math.max(-ROOM.x + 0.4, Math.min(ROOM.x - 0.4, cp.x)); cp.z = Math.max(ROOM.back + 0.4, Math.min(ROOM.front - 0.4, cp.z)); cp.y = Math.max(0.5, Math.min(ROOM.h - 0.4, cp.y));
  if (moved || tween || dirty) {
    dirty = false;
    renderer.render(scene, camera);
    adaptQuality(now);
  } else lastFrame = 0;
  requestAnimationFrame(loop);
}
// Si l'image saccade pendant qu'on tourne autour de la board (médiane > 34 ms sur 45 images consécutives),
// on baisse la résolution par paliers jusqu'à 1, puis la taille de la carte d'ombres
let lastFrame = 0, frameTimes = [];
function adaptQuality(now) {
  if (lastFrame && document.visibilityState === 'visible') {
    const dt = now - lastFrame;
    if (dt < 250) frameTimes.push(dt);
    if (frameTimes.length >= 45) {
      const med = frameTimes.sort((a, b) => a - b)[frameTimes.length >> 1];
      frameTimes = [];
      if (med > 34) {
        if (dpr > 1) { dpr = Math.max(1, dpr - 0.5); renderer.setPixelRatio(dpr); dirty = true; }
        else if (sun.shadow.mapSize.x > 1024) { sun.shadow.mapSize.setScalar(1024); sun.shadow.map && sun.shadow.map.dispose(); sun.shadow.map = null; dirty = true; }
      }
    }
  }
  lastFrame = now;
}
syncTheme(); buildRoom(scene, {low: LOW});
if (import.meta.env && import.meta.env.DEV) window.__board3d = {renderer, scene, camera, state, LOW};   // vérifications (npm run dev)
requestAnimationFrame(loop);

async function start() {
  buildFilterUI();
  $('finish').value = state.finish; setToggle('tDim', state.dim); setToggle('tType', state.byType); $('typeLegend').hidden = !state.byType;
  const r = await loadManifest();
  if (!r.ok) $('msg').textContent = `Données absentes (${r.error}). Lancez « npm run data » pour générer les vraies boards.`;
  renderDataInfo(); renderBoards();
  const h = parseHash(), ids = new Set(boardList().map(b => b.id));
  const id = (h.board && ids.has(h.board) && h.board) || (prefs.board && ids.has(prefs.board) && prefs.board) || boardList()[0].id;
  if (!prefs.board && !h.board) toggleBoardEdit(true);       // première visite : choisir sa board
  await selectBoard(id, h.board === id ? h : {});
}
start();
