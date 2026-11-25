// Board 3D — visualiseur 3D de boards d'escalade
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {ROLES, TYPES, DIRS, fmt, nf} from './config.js';
import {holdGeometry, ringGeometry} from './holds/geometry.js';
import {mergeHolds, paintHold, commitPaint, holdMaterial, pickHold} from './holds/merge.js';
import {MAT, ROOM, buildRoom, finishTex, textSprite, matArea, faceBox, mergeStatic, steel, steelLight} from './scene/room.js';
import {store, loadManifest, loadBoard, openClimbs, climbsAt, hasClimbsAt, loadClimb, climbKey, boardList, importData} from './data.js';
import {GMIN, GMAX, TYPE_ORDER, gradeFont, view, holdProfile, filterClimbs, defaultFilters, activeCount, SORTS} from './ui/filters.js';

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

const state = {finish: prefs.finish || 'noir', board: null, climb: null, angle: 40, kicker: 0.46, view: 'board',
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
  updateStruts(); updateBounds(); reframe();
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
  updateStruts(); updateBounds(); reframe(); invalidate();
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
// Style principal d'un bloc : le type de prise de main dominant (sans compte)
function styleBadge(prof) {
  if (!prof || !TYPES[prof.dom]) return null;
  const b = el('span', 'style'), i = el('i', 'dot'); i.style.background = dotColor(prof.dom);
  b.append(i, capital(TYPES[prof.dom].plural)); b.title = `Style principal : ${TYPES[prof.dom].plural}`;
  return b;
}

const STYLE_TYPES = TYPE_ORDER.filter(t => !['volume', 'foot_chip'].includes(t));
const ASC_STEPS = [[0, 'Toutes'], [10, '10+'], [100, '100+'], [1000, '1 000+']];
const Q_STEPS = [[0, 'Toutes'], [3, '★ 3+'], [4, '★ 4+'], [4.5, '★ 4,5+']];
const gradeOn = () => F.gmin > GMIN || F.gmax < GMAX;
const gradeRange = () => F.gmin === F.gmax ? gradeFont(F.gmin) : `${gradeFont(F.gmin)} – ${gradeFont(F.gmax)}`;
function buildFilterUI() {
  for (const id of ['gmin', 'gmax']) { const r = $(id); r.min = GMIN; r.max = GMAX; r.step = 1; }
  $('gmin').value = GMIN; $('gmax').value = GMAX;
  for (const d of [GMIN, 16, 22, 28, GMAX]) $('gScale').appendChild(el('span', null, gradeFont(d)));
  for (const [k, s] of Object.entries(SORTS)) { const o = el('option', null, s.label); o.value = k; $('sort').appendChild(o); }
  for (const t of STYLE_TYPES) {
    const b = el('button', 'chip'); b.type = 'button'; b.dataset.t = t; b.setAttribute('aria-pressed', 'false');
    const i = el('i'); i.style.background = dotColor(t); b.append(i, capital(TYPES[t].plural)); $('fTypes').appendChild(b);
  }
  for (const [box, steps] of [[$('fAsc'), ASC_STEPS], [$('fQ'), Q_STEPS]])
    for (const [v, label] of steps) { const b = el('button', null, label); b.type = 'button'; b.dataset.v = v; b.setAttribute('aria-pressed', 'false'); box.appendChild(b); }
}
// Filtres actifs en pastilles retirables (le filtre vérifiés/benchmarks a déjà son bouton à côté de « Filtres »)
function activeChips() {
  const out = [];
  if (gradeOn()) out.push([gradeRange(), () => { F.gmin = GMIN; F.gmax = GMAX; }]);
  if (F.types.size) out.push([STYLE_TYPES.filter(t => F.types.has(t)).map(t => capital(TYPES[t].plural)).join(', '), () => F.types.clear()]);
  if (F.minAsc) out.push([`${nf.format(F.minAsc)}+ répét.`, () => { F.minAsc = 0; }]);
  if (F.minQ) out.push([`★ ${fmt(F.minQ, F.minQ % 1 ? 1 : 0)}+`, () => { F.minQ = 0; }]);
  if (F.favOnly) out.push(['Favoris', () => { F.favOnly = false; }]);
  if (F.unclimbed) out.push([`Avec les jamais faits à ${state.angle}°`, () => { F.unclimbed = false; }]);
  return out;
}
function syncGrade() {
  $('gmin').value = F.gmin; $('gmax').value = F.gmax;
  $('gOut').textContent = gradeOn() ? gradeRange() : 'Toutes';
  const p0 = (F.gmin - GMIN) / (GMAX - GMIN), p1 = (F.gmax - GMIN) / (GMAX - GMIN), fill = $('gFill');
  fill.style.left = `calc(13px + (100% - 26px) * ${p0})`; fill.style.width = `calc((100% - 26px) * ${p1 - p0})`;
  $('gmin').style.zIndex = p0 > 0.5 ? 2 : '';          // les deux poignées au bout : celle du minimum reste attrapable
}
function syncFilterUI() {
  const [bw] = benchWord();
  $('fBenchQ').textContent = bw; $('fBenchQ').setAttribute('aria-pressed', String(F.bench));
  $('fBenchLab').textContent = `${bw} uniquement`; $('fBench').checked = F.bench;
  syncGrade();
  for (const b of $('fTypes').children) b.setAttribute('aria-pressed', String(F.types.has(b.dataset.t)));
  for (const b of $('fAsc').children) b.setAttribute('aria-pressed', String(+b.dataset.v === F.minAsc));
  for (const b of $('fQ').children) b.setAttribute('aria-pressed', String(+b.dataset.v === F.minQ));
  $('fFav').checked = F.favOnly; $('fUnclimbed').checked = F.unclimbed;
  const n = activeCount(F); $('fCount').hidden = !n; $('fCount').textContent = n;
  const box = $('fActive'), chips = activeChips(); box.textContent = '';
  for (const [label, clear] of chips) {
    const b = el('button', 'achip'); b.type = 'button'; b.setAttribute('aria-label', `Retirer le filtre ${label}`);
    b.append(label, el('span', null, '✕'));
    b.addEventListener('click', () => { clear(); applyFilters(); });
    box.appendChild(b);
  }
  if (chips.length > 1) { const r = el('button', 'linkbtn', 'Tout effacer'); r.type = 'button'; r.addEventListener('click', resetFilters); box.appendChild(r); }
}
const applyFilters = () => { syncFilterUI(); computeResults(); };
function resetFilters() { Object.assign(F, defaultFilters(), {sort: F.sort, q: F.q}); applyFilters(); }

const PAGE = 20;
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
  const n = results.length, word = `bloc${n > 1 ? 's' : ''}`;
  $('count').textContent = `${nf.format(n)} ${word} à ${state.angle}°`;
  $('fApply').textContent = n ? `Voir ${nf.format(n)} ${word}` : 'Aucun bloc';
  syncFilterUI();
  if (!n) {
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
    const meta = el('span', 'rmeta'), st = styleBadge(holdProfile(c, typeOf));
    if (st) meta.append(st);
    meta.append(el('span', 'txt', [v.here ? `${nf.format(v.asc)} répét.` : `jamais fait à ${state.angle}°`,
      v.q != null ? `★ ${fmt(v.q, 1)}` : '', c.setter, c.sample ? 'exemple' : ''].filter(Boolean).join(' · ')));
    row.append(name, grade, meta);
    row.addEventListener('click', () => selectClimb(c));
    row.addEventListener('pointerenter', () => { if (!c.holds) loadClimb(c.board, c.id).catch(() => {}); }, {once: true});   // détail préchargé au survol
    frag.appendChild(row);
  }
  shown += PAGE; $('list').appendChild(frag);
  const left = results.length - shown;
  $('moreRes').hidden = left <= 0;
  if (left > 0) $('moreRes').textContent = `Afficher plus · ${nf.format(left)} restant${left > 1 ? 's' : ''}`;
}
function markCurrent() {
  for (const r of $('list').children) if (r.dataset.id) r.setAttribute('aria-current', String(!!state.climb && r.dataset.id === state.climb.id));
}

/* ---------- Fiche du bloc ---------- */
// Angles : seulement ceux où le bloc a des répétitions ; 30°, 40°, 50° (et l'angle courant) en accès direct,
// les autres dans « Tous les angles »
const MAIN_ANGLES = [30, 40, 50];
let allAnglesOpen = false;
function climbedAngles(c) { return (c.stats || []).filter(s => (s[2] || 0) > 0).sort((a, b) => a[0] - b[0]); }
function renderFiche() {
  const c = state.climb, box = $('fiche');
  $('vClimb').disabled = !(c && c.holds);
  if (!c || !state.board) { box.hidden = true; return; }
  box.hidden = false;
  const v = view(c, state.angle), [, bw] = benchWord();
  $('fName').textContent = c.name;
  const g = $('fGrade'); g.textContent = v.here ? `${shortGrade(v.grade)} à ${state.angle}°` : `pas fait à ${state.angle}°`;
  if (v.bench) g.append(el('span', 'bench', bw));
  $('fMeta').textContent = [c.setter ? `par ${c.setter}` : '', v.here && v.asc ? `${nf.format(v.asc)} répétitions` : '',
    v.q != null ? `★ ${fmt(v.q, 1)} / 5` : '', c.sample ? 'bloc d\'exemple' : ''].filter(Boolean).join(' · ');
  const st = $('fStyle'), sb = styleBadge(holdProfile(c, typeOf)); st.textContent = '';
  if (sb) st.append('Style', sb);
  const climbed = climbedAngles(c), pref = new Set([...MAIN_ANGLES, state.angle]);
  let main = climbed.filter(s => pref.has(s[0]));
  if (!main.length) main = [...climbed].sort((a, b) => b[2] - a[2]).slice(0, 3).sort((a, b) => a[0] - b[0]);
  const an = $('fAngles'); an.textContent = '';
  for (const s of main) {
    const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(s[0] === state.angle));
    b.append(`${s[0]}°`, el('small', null, (s[1] || '').split('/')[0]));
    b.title = `${shortGrade(s[1])} à ${s[0]}° · ${nf.format(s[2])} répétitions`;
    b.addEventListener('click', () => applyAngle(s[0])); an.appendChild(b);
  }
  const more = climbed.length > main.length;
  if (more) {
    const b = el('button', 'allbtn', `Tous les angles (${climbed.length})`); b.type = 'button';
    b.setAttribute('aria-expanded', String(allAnglesOpen)); b.setAttribute('aria-controls', 'fAllAngles');
    b.addEventListener('click', () => { allAnglesOpen = !allAnglesOpen; renderFiche(); });
    an.appendChild(b);
  }
  an.hidden = !climbed.length;
  const all = $('fAllAngles'); all.textContent = ''; all.hidden = !(more && allAnglesOpen);
  if (!all.hidden) for (const s of climbed) {
    const r = el('button', 'arow'); r.type = 'button'; r.setAttribute('aria-pressed', String(s[0] === state.angle));
    r.append(el('span', null, `${s[0]}°`), el('span', null, shortGrade(s[1])), el('span', 'm', `${nf.format(s[2])} répét.`), el('span', 'm', s[3] != null ? `★ ${fmt(s[3], 1)}` : ''));
    r.addEventListener('click', () => applyAngle(s[0])); all.appendChild(r);
  }
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
  if (state.climb !== c) allAnglesOpen = false;
  state.climb = c; paintClimb(); renderFiche(); markCurrent(); updateHash();
  if (state.view === 'climb') goView('climb');
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

/* ---------- Cadrage ---------- */
// « Board » : toute la board, face au panneau ; « Bloc » : les prises du bloc. Face au panneau = perpendiculaire,
// relevée si la caméra passerait trop bas (fort dévers). Tant que l'utilisateur n'a pas bougé la vue, le cadrage
// suit l'angle, le kicker et la taille de la fenêtre.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const UP = new THREE.Vector3(0, 1, 0), MIN_EYE = 0.6, rad = THREE.MathUtils.degToRad;
let tween = null, userMoved = false, viewInset = 0;
function boardPoints() {
  const b = state.board, r = rad(state.angle), base = MAT + state.kicker, W = b.width / 2;
  const ty = base + b.panel * Math.cos(r), tz = b.panel * Math.sin(r);
  return [[-W, MAT, 0], [W, MAT, 0], [-W, base, 0], [W, base, 0], [-W, ty, tz], [W, ty, tz]].map(p => new THREE.Vector3(...p));
}
// Surface de la board : le panneau (incliné, à partir de la charnière) et le kicker (vertical, dessous).
// La cible de la caméra glisse sur cette surface et reste dans ses bords (plus une marge) : on ne se perd pas.
const surf = {o: new THREE.Vector3(), up: new THREE.Vector3(), n: new THREE.Vector3(), W: 0, P: 0, base: 0};
function updateBounds() {
  if (!state.board) return;
  const r = rad(state.angle);
  surf.base = MAT + state.kicker; surf.W = state.board.width / 2; surf.P = state.board.panel;
  surf.o.set(0, surf.base, 0); surf.up.set(0, Math.cos(r), Math.sin(r)); surf.n.set(0, -Math.sin(r), Math.cos(r));
}
const EDGE = 0.25;
// Point de la surface sur un rayon (origine o, direction d) ; null si le rayon ne la touche pas (marge comprise)
function surfaceHit(o, d, out, loose) {
  const m = loose ? 1.5 : EDGE;
  let den = d.dot(surf.n);
  if (Math.abs(den) > 1e-4) {
    const t = -_v.copy(o).sub(surf.o).dot(surf.n) / den;
    if (t > 0) {
      out.copy(o).addScaledVector(d, t);
      const v = _v.copy(out).sub(surf.o).dot(surf.up);
      if (v >= 0 && v <= surf.P + m && Math.abs(out.x) <= surf.W + m) return out;
    }
  }
  if (Math.abs(d.z) > 1e-4) {                                    // kicker : plan z = 0
    const t = -o.z / d.z;
    if (t > 0) {
      out.copy(o).addScaledVector(d, t);
      if (out.y >= MAT - m && out.y <= surf.base && Math.abs(out.x) <= surf.W + m) return out;
    }
  }
  return null;
}
function climbPoints(c) {
  if (!c || !c.holds) return null;
  kickerG.updateMatrixWorld(true); panelG.updateMatrixWorld(true);
  const pts = [];
  for (const [id] of c.holds) {
    const h = holds.get(id); if (!h) continue;
    const g = h.onKick ? kickerG : panelG, s = h.re * 1.6;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pts.push(g.localToWorld(new THREE.Vector3(h.x + dx * s, h.y + dy * s, 0)));
  }
  if (!pts.length) return null;
  // cadre d'au moins 1,2 m × 1 m dans le plan du panneau
  const c0 = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3()), r = rad(state.angle);
  const up = new THREE.Vector3(0, Math.cos(r), Math.sin(r));
  pts.push(c0.clone().addScaledVector(up, 0.6), c0.clone().addScaledVector(up, -0.6), c0.clone().setX(c0.x - 0.5), c0.clone().setX(c0.x + 0.5));
  return pts;
}
function frameOn(points, margin) {
  const c = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const tv = Math.tan(rad(camera.fov / 2)), H = host.clientHeight || 1, W = host.clientWidth || 1;
  const th = tv * Math.max(0.3, (W - viewInset) / H);
  for (let e = -rad(state.angle); ; e += rad(2)) {
    const dir = new THREE.Vector3(0, Math.sin(e), Math.cos(e));               // de la cible vers la caméra
    const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, UP).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
    let d = 0;
    for (const p of points) {
      const q = p.clone().sub(c), z = q.dot(fwd);
      d = Math.max(d, Math.abs(q.dot(up)) / tv - z, Math.abs(q.dot(right)) / th - z);
    }
    d = Math.max(controls.minDistance, d * margin);
    const pos = c.clone().addScaledVector(dir, d);
    if (pos.y >= MIN_EYE || e > 0.6) return {pos, tgt: c};
  }
}
function startTween(pos, tgt, instant) {
  if (instant || reduce) { camera.position.copy(pos); controls.target.copy(tgt); tween = null; invalidate(); }
  else tween = {p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt, s: performance.now(), d: 650};
}
function goView(v, instant) {
  state.view = v;
  for (const bt of document.querySelectorAll('[data-view]')) bt.setAttribute('aria-pressed', String(bt.dataset.view === v));
  if (!state.board) return;
  const pts = (v === 'climb' && climbPoints(state.climb)) || boardPoints();    // pas encore de bloc : toute la board
  const f = frameOn(pts, pts.length > 6 ? 1.1 : 1.05);
  userMoved = false;
  startTween(f.pos, f.tgt, instant);
}
const reframe = () => { if (!userMoved && state.board) goView(state.view, true); };
// Sur grand écran, la carte « Ma board » couvre le haut à gauche : le centre de l'image est décalé vers la droite
function applyViewOffset() {
  const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
  const card = document.querySelector('.boardcard');
  viewInset = innerWidth > 760 && card ? Math.min(W * 0.4, card.getBoundingClientRect().right - host.getBoundingClientRect().left + 8) : 0;
  camera.aspect = (W + viewInset) / H;
  if (viewInset) camera.setViewOffset(W + viewInset, H, 0, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

/* ---------- Navigation : comme une carte ---------- */
// Glisser = se déplacer (le long de la board), molette ou pincement = zoom vers le pointeur,
// clic droit / Maj + glisser / deux doigts = tourner (devant la board seulement), double-clic sur une prise = zoom dessus
controls.mouseButtons = {LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE};
controls.touches = {ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE};
controls.enableZoom = false;                         // zoom vers le pointeur, géré ici
controls.screenSpacePanning = true;
controls.minAzimuthAngle = -1.15; controls.maxAzimuthAngle = 1.15;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), _plane = new THREE.Plane(), _hitP = new THREE.Vector3(), _v = new THREE.Vector3();
function setRay(x, y) {
  const rc = renderer.domElement.getBoundingClientRect();
  ndc.set((x - rc.left) / rc.width * 2 - 1, -((y - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
// k < 1 rapproche : le point de la board sous le pointeur reste sous le pointeur
function zoomAt(x, y, k) {
  setRay(x, y);
  if (!surfaceHit(ray.ray.origin, ray.ray.direction, _hitP, true)) {
    _plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(_v), controls.target);
    if (!ray.ray.intersectPlane(_plane, _hitP)) return;
  }
  const dist = camera.position.distanceTo(controls.target);
  k = Math.min(controls.maxDistance / dist, Math.max(controls.minDistance / dist, k));
  camera.position.sub(_hitP).multiplyScalar(k).add(_hitP);
  controls.target.sub(_hitP).multiplyScalar(k).add(_hitP);
  tween = null; userMoved = true; hideNavHint(); invalidate();
}
// La cible est ramenée sur la surface le long de l'axe de vue (l'image ne change pas), puis bornée aux bords
// de la board : la caméra suit du même déplacement, sans tourner.
const _t = new THREE.Vector3(), _dir = new THREE.Vector3();
function clampTarget() {
  if (!state.board || tween) return;
  const t = controls.target;
  camera.getWorldDirection(_dir);
  if (!surfaceHit(_t.copy(t).addScaledVector(_dir, -50), _dir, _t, true)) _t.copy(t);
  let v = _v.copy(_t).sub(surf.o).dot(surf.up);
  _t.x = Math.max(-surf.W - EDGE, Math.min(surf.W + EDGE, _t.x));
  if (v >= 0) {                                                   // sur le panneau
    v = Math.min(surf.P + EDGE, v);
    _t.set(_t.x, 0, 0).add(_v.copy(surf.up).multiplyScalar(v)).add(surf.o).setX(_t.x);
  } else _t.set(_t.x, Math.max(MAT - EDGE, Math.min(surf.base, _t.y)), 0);   // sur le kicker
  if (_t.distanceToSquared(t) > 1e-10) { _v.subVectors(_t, t); t.add(_v); camera.position.add(_v); }
}
function pickAt(x, y) {
  setRay(x, y); scene.updateMatrixWorld();
  let hit = null;
  for (const L of holdLayers) { const r = pickHold(L.merged, L.mesh, ray.ray); if (r && (!hit || r.distance < hit.distance)) hit = r; }
  return hit;
}
const holdWorld = h => (h.onKick ? kickerG : panelG).localToWorld(new THREE.Vector3(h.x, h.y, 0));
function zoomToHold(id) {
  const h = holds.get(id); if (!h) return;
  const wp = holdWorld(h), dir = camera.position.clone().sub(controls.target).normalize();
  startTween(wp.clone().addScaledVector(dir, 0.8), wp); userMoved = true;
}
function hideNavHint() {
  if ($('navHint').hidden) return;
  $('navHint').hidden = true; prefs.navSeen = true; savePrefs();
}
const cv = renderer.domElement;
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const k = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015));   // ctrl = pincement sur pavé tactile
  zoomAt(e.clientX, e.clientY, k);
}, {passive: false});
// Pincement : zoom vers le milieu des deux doigts (la rotation à deux doigts reste à OrbitControls)
const touches = new Map(); let pinch = 0;
const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
let down = null, lastTap = null;
cv.addEventListener('pointerdown', e => {
  down = {x: e.clientX, y: e.clientY};
  if (e.pointerType === 'touch') { touches.set(e.pointerId, {x: e.clientX, y: e.clientY}); if (touches.size === 2) pinch = pinchDist(); }
});
cv.addEventListener('pointermove', e => {
  if (down && e.buttons && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { userMoved = true; tween = null; hideNavHint(); }
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (touches.size === 2) {
    const d = pinchDist(), [a, b] = [...touches.values()];
    if (pinch && d) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch / d);
    pinch = d;
  }
});
const endTouch = e => { touches.delete(e.pointerId); pinch = 0; };
cv.addEventListener('pointercancel', endTouch);

/* ---------- Sélection de prise & mesure ---------- */
cv.addEventListener('pointerup', e => {
  endTouch(e);
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const hit = pickAt(e.clientX, e.clientY), now = performance.now();
  const dbl = lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
  lastTap = dbl ? null : {t: now, x: e.clientX, y: e.clientY};
  if (dbl) { hideNavHint(); if (hit) zoomToHold(hit.id); else zoomAt(e.clientX, e.clientY, 0.5); return; }
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
  renderer.setSize(w, h, false); applyViewOffset(); reframe(); invalidate();
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

let qTimer = null, gTimer = null;
$('q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = e.target.value; computeResults(); }, 150); });
// Feuille des filtres
const sheet = $('fSheet');
$('fOpen').addEventListener('click', () => { syncFilterUI(); sheet.showModal(); });
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });      // clic sur le fond
const gradeInput = which => {
  let lo = +$('gmin').value, hi = +$('gmax').value;
  if (lo > hi) { if (which === 'min') lo = hi; else hi = lo; }
  F.gmin = lo; F.gmax = hi; syncGrade();
  clearTimeout(gTimer); gTimer = setTimeout(applyFilters, 120);
};
$('gmin').addEventListener('input', () => gradeInput('min'));
$('gmax').addEventListener('input', () => gradeInput('max'));
$('fBenchQ').addEventListener('click', () => { F.bench = !F.bench; applyFilters(); });
$('fBench').addEventListener('change', e => { F.bench = e.target.checked; applyFilters(); });
$('fTypes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  F.types.has(b.dataset.t) ? F.types.delete(b.dataset.t) : F.types.add(b.dataset.t); applyFilters();
});
$('fAsc').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { F.minAsc = +b.dataset.v; applyFilters(); } });
$('fQ').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { F.minQ = +b.dataset.v; applyFilters(); } });
$('fFav').addEventListener('change', e => { F.favOnly = e.target.checked; applyFilters(); });
$('fUnclimbed').addEventListener('change', e => { F.unclimbed = e.target.checked; applyFilters(); });
$('sort').addEventListener('change', e => { F.sort = e.target.value; computeResults(); });
$('fReset').addEventListener('click', resetFilters);
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
  clampTarget();
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
  buildFilterUI(); syncFilterUI();
  if (matchMedia('(pointer: coarse)').matches) $('navHint').textContent = 'Glisser : se déplacer · Pincer : zoomer · Deux doigts : tourner · Double-tap sur une prise : zoomer dessus';
  if (!prefs.navSeen) $('navHint').hidden = false;
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
