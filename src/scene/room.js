import * as THREE from 'three';
import {mergeBufferGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Textures procédurales, salle d'escalade (sol, murs, plafond, murs de bloc voisins, tapis, accessoires)
export function woodTexture(W, H, seams, seamFromTop) {
  const ppm = 96, c = document.createElement('canvas');
  c.width = Math.max(64, Math.round(W * ppm)); c.height = Math.max(32, Math.round(H * ppm));
  const g = c.getContext('2d');
  g.fillStyle = '#c9a77c'; g.fillRect(0, 0, c.width, c.height);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < c.height * 0.9; i++) {
    const y = rnd() * c.height;
    g.strokeStyle = `rgba(${120 + rnd() * 40 | 0},${80 + rnd() * 30 | 0},${40 + rnd() * 20 | 0},${0.05 + rnd() * 0.08})`;
    g.lineWidth = 0.5 + rnd() * 1.8; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= c.width; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 2.5);
    g.stroke();
  }
  if (seams) {
    g.strokeStyle = 'rgba(60,40,20,.55)'; g.lineWidth = 2;
    for (let x = 1.22; x < W - 0.05; x += 1.22) { g.beginPath(); g.moveTo(x * ppm, 0); g.lineTo(x * ppm, c.height); g.stroke(); }
    for (let y = 1.22; y < H - 0.05; y += 1.22) { g.beginPath(); g.moveTo(0, c.height - y * ppm); g.lineTo(c.width, c.height - y * ppm); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}

export function textSprite(text, hM, color = '#e8ebed') {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = '600 44px Barlow, sans-serif';
  c.width = Math.ceil(g.measureText(text).width) + 24; c.height = 64;
  g.font = '600 44px Barlow, sans-serif';
  g.fillStyle = 'rgba(12,14,16,.72)'; g.beginPath();
  if (g.roundRect) g.roundRect(0, 0, c.width, c.height, 14); else g.rect(0, 0, c.width, c.height);
  g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 12, 34);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: t, depthWrite: false}));
  s.scale.set(hM * c.width / c.height, hM, 1);
  return s;
}


/* ---------- Salle d'escalade ---------- */
// Repère : x = largeur, y = hauteur, z = vers le grimpeur. Board centrée en x = 0, charnière du kicker en z = 0.
export const MAT = 0.30;                                     // épaisseur des tapis : les hauteurs affichées partent du tapis
export const ROOM = {x: 9, back: -2.4, front: 10, h: 6.2};
let rngSeed = 11;
const rnd = () => (rngSeed = (rngSeed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function concreteTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#77736d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 95 + rnd() * 50 | 0; g.fillStyle = `rgba(${v},${v - 3},${v - 6},${0.08 + rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(60,58,55,${0.04 + rnd() * 0.05})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 90, 20 + rnd() * 60, rnd() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(40,38,36,.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);   // joints de dalle
  }, [10, 10]);
}
// Panneau de mur de bloc peint, avec la grille d'inserts (T-nuts) tous les 20 cm
function paintedTex(color, W, H, tnuts) {
  const ppm = 80;
  return canvasTex(Math.max(64, W * ppm | 0), Math.max(64, H * ppm | 0), (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.035})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1.5;
    for (let x = 1.22; x < W; x += 1.22) { g.beginPath(); g.moveTo(x * ppm, 0); g.lineTo(x * ppm, h); g.stroke(); }
    for (let y = 1.22; y < H; y += 1.22) { g.beginPath(); g.moveTo(0, h - y * ppm); g.lineTo(w, h - y * ppm); g.stroke(); }
    if (tnuts) { g.fillStyle = 'rgba(20,20,22,.55)'; for (let x = 0.1; x < W; x += 0.2) for (let y = 0.1; y < H; y += 0.2) { g.beginPath(); g.arc(x * ppm + (Math.round(y / 0.2) % 2) * 8, h - y * ppm, 1.6, 0, 7); g.fill(); } }
  });
}
// Panneau de la board selon la finition choisie
export function finishTex(finish, W, H) {
  if (finish === 'bois') return woodTexture(W, H, true);
  const base = finish === 'blanc' ? '#e4e3df' : '#18191b';
  return paintedTex(base, W, H, false);
}
// Panneau épais : face avant texturée, tranches et dos d'une autre matière ; 2 appels de dessin au lieu de 6
// (faces de BoxGeometry dans l'ordre +x, -x, +y, -y, +z, -z : la face avant +z est mise en dernier)
export function faceBox(w, h, t, edgeMat, faceMat) {
  const g = new THREE.BoxGeometry(w, h, t), I = g.index.array;
  g.setIndex([...I.slice(0, 24), ...I.slice(30, 36), ...I.slice(24, 30)]);
  g.clearGroups(); g.addGroup(0, 30, 0); g.addGroup(30, 6, 1);
  return new THREE.Mesh(g, [edgeMat, faceMat]);
}
// Fusionne les maillages statiques d'un groupe qui partagent un matériau (et les mêmes réglages d'ombre) :
// un appel de dessin par matériau. Les maillages instanciés, multi-matériaux ou marqués userData.keep restent.
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), buckets = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep) return;
    const k = o.material.uuid + (o.castShadow ? ':c' : '') + (o.receiveShadow ? ':r' : '');
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map(o => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    });
    const names = Object.keys(geos[0].attributes).filter(n => geos.every(g => g.attributes[n]));
    for (const g of geos) { for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n); g.clearGroups(); }
    const merged = mergeBufferGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
    for (const o of list) { o.removeFromParent(); o.geometry.dispose(); }
    root.add(m);
  }
  return root;
}
// Tapis de réception : blocs de mousse aux bords arrondis, housse vinyle, joints entre modules
const matMats = new Map();
function matSlab(w, d, color) {
  const r = 0.06, sh = new THREE.Shape();
  sh.moveTo(-w / 2 + r, -d / 2); sh.lineTo(w / 2 - r, -d / 2); sh.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  sh.lineTo(w / 2, d / 2 - r); sh.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2); sh.lineTo(-w / 2 + r, d / 2);
  sh.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); sh.lineTo(-w / 2, -d / 2 + r); sh.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const geo = new THREE.ExtrudeGeometry(sh, {depth: MAT - 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 4});
  geo.rotateX(-Math.PI / 2); geo.translate(0, 0.025, 0);
  if (!matMats.has(color)) matMats.set(color, new THREE.MeshStandardMaterial({color, roughness: 0.55, metalness: 0}));
  return {geo, mat: matMats.get(color)};
}
export function matArea(x0, x1, z0, z1, color) {         // zone de tapis découpée en modules de ~2 × 1,5 m, un seul maillage instancié
  const nx = Math.max(1, Math.round((x1 - x0) / 2)), nz = Math.max(1, Math.round((z1 - z0) / 1.5));
  const w = (x1 - x0) / nx, d = (z1 - z0) / nz, {geo, mat} = matSlab(w - 0.015, d - 0.015, color);
  const im = new THREE.InstancedMesh(geo, mat, nx * nz), m4 = new THREE.Matrix4();
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) im.setMatrixAt(i * nz + j, m4.makeTranslation(x0 + w * (i + 0.5), 0, z0 + d * (j + 0.5)));
  im.receiveShadow = true; im.castShadow = false;
  return im;
}
// Prises génériques des murs de bloc voisins (une géométrie irrégulière, instanciée en couleurs)
const GYM_COLORS = [0xf2c230, 0x2fa84f, 0x2b6fd6, 0xd83a3a, 0x8a4fd1, 0x1c1c1c, 0xf4f4f2, 0xf08a24, 0xe85a9c, 0x30b5c8];
const gymHoldGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.75 + rnd() * 0.45; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, Math.max(-0.15, p.getZ(i)) * k); }
  g.computeVertexNormals(); return g;
})();
const volMats = new Map();
const volMat = c => volMats.get(c) || volMats.set(c, new THREE.MeshStandardMaterial({color: c, roughness: 0.8, flatShading: true})).get(c);
function gymWall(W, H, color, kickH, overhangDeg, lowQ) {
  // Mur de bloc : partie basse verticale (kickH), puis pan incliné vers l'avant de overhangDeg
  const g = new THREE.Group(), T = 0.05;
  const mk = (w, h, tex) => { const m = faceBox(w, h, T, wallEdge, new THREE.MeshStandardMaterial({map: tex, roughness: 0.9})); m.receiveShadow = true; return m; };
  const low = mk(W, kickH, paintedTex(color, W, kickH, true)); low.position.set(0, kickH / 2, -T / 2); g.add(low);
  const up = new THREE.Group(); up.position.y = kickH; up.rotation.x = THREE.MathUtils.degToRad(overhangDeg); g.add(up);
  const L = (H - kickH) / Math.cos(THREE.MathUtils.degToRad(Math.max(0, overhangDeg)));
  const hi = mk(W, L, paintedTex(color, W, L, true)); hi.position.set(0, L / 2, -T / 2); up.add(hi);
  // prises et volumes
  const add = (parent, w, h, n) => {
    const im = new THREE.InstancedMesh(gymHoldGeo, new THREE.MeshStandardMaterial({roughness: 0.7}), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = 0.035 + rnd() ** 2 * 0.11;
      e.set(0, 0, rnd() * 6.28); q.setFromEuler(e);
      m4.compose(new THREE.Vector3((rnd() - 0.5) * (w - 0.3), 0.15 + rnd() * (h - 0.3), 0), q, new THREE.Vector3(r * (0.8 + rnd() * 0.6), r, r * 0.55));
      im.setMatrixAt(i, m4); im.setColorAt(i, c.setHex(pick(GYM_COLORS)));
    }
    im.castShadow = !lowQ; im.receiveShadow = true; parent.add(im);
  };
  const dens = lowQ ? 2.5 : 5;                                         // moins de prises sur téléphone
  add(g, W, kickH, Math.round(W * kickH * dens)); add(up, W, L, Math.round(W * L * dens));
  for (let i = 0; i < Math.round(W / 1.5); i++) {                      // volumes triangulaires
    const v = new THREE.Mesh(new THREE.ConeGeometry(0.3 + rnd() * 0.35, 0.25 + rnd() * 0.2, 3), volMat(pick([0x3a3d42, 0xe9e6df, 0x2e6f73, 0x6a4a8c])));
    v.rotation.x = Math.PI / 2; v.rotation.y = rnd() * 6.28; v.position.set((rnd() - 0.5) * (W - 1), 0.6 + rnd() * (L - 1.2), 0.1);
    v.castShadow = !lowQ; v.receiveShadow = true; up.add(v);
  }
  return g;
}
const wallEdge = new THREE.MeshStandardMaterial({color: 0x2b2d31, roughness: 0.8});
export const steel = new THREE.MeshStandardMaterial({color: 0x3b3e43, roughness: 0.45, metalness: 0.6});
export const steelLight = new THREE.MeshStandardMaterial({color: 0xb9bdc2, roughness: 0.3, metalness: 0.8});

// low : téléphone — moins de prises sur les murs voisins, et ni elles ni les accessoires ne projettent d'ombre
export function buildRoom(scene, {low = false} = {}) {
  const g = new THREE.Group();
  // Sol béton
  const floorT = concreteTex();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.front - ROOM.back), new THREE.MeshStandardMaterial({map: floorT, roughness: 0.85}));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (ROOM.front + ROOM.back) / 2; floor.receiveShadow = true; g.add(floor);
  // Murs du bâtiment (fond, côtés, avant) et plafond
  const wallMat = new THREE.MeshStandardMaterial({color: 0xc9c4bb, roughness: 0.95});
  const plane = (w, h, mat, pos, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.copy(pos); m.rotation.y = rotY; m.receiveShadow = true; g.add(m); return m; };
  const D = ROOM.front - ROOM.back, zc = (ROOM.front + ROOM.back) / 2;
  plane(ROOM.x * 2, ROOM.h, wallMat, new THREE.Vector3(0, ROOM.h / 2, ROOM.back), 0);
  plane(D, ROOM.h, wallMat, new THREE.Vector3(-ROOM.x, ROOM.h / 2, zc), Math.PI / 2);
  plane(D, ROOM.h, wallMat, new THREE.Vector3(ROOM.x, ROOM.h / 2, zc), -Math.PI / 2);
  plane(ROOM.x * 2, ROOM.h, wallMat, new THREE.Vector3(0, ROOM.h / 2, ROOM.front), Math.PI);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, D), new THREE.MeshStandardMaterial({color: 0x2a2c30, roughness: 1}));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, ROOM.h, zc); g.add(ceil);
  // Charpente métallique, gaine de ventilation et rampes LED
  for (let x = -ROOM.x + 1.5; x < ROOM.x; x += 3) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.45, D), steel); b.position.set(x, ROOM.h - 0.23, zc); g.add(b); }
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, ROOM.x * 2, 24, 1, true), steelLight);
  duct.rotation.z = Math.PI / 2; duct.position.set(0, ROOM.h - 0.75, 4.5); g.add(duct);
  const ledMat = new THREE.MeshBasicMaterial({color: 0xfffaf0});
  for (let z = -0.5; z < ROOM.front - 1; z += 2.6) for (const x of [-6, -2, 2, 6]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.12), ledMat); led.position.set(x, ROOM.h - 0.5, z); g.add(led);
    const hang = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.45, 0.01), steel); hang.position.set(x, ROOM.h - 0.27, z); g.add(hang);
  }
  for (const [x, z] of [[-4, 2], [4, 2], [0, 6]]) { const pl = new THREE.PointLight(0xfff4e4, 0.32, 16, 1.6); pl.position.set(x, ROOM.h - 0.7, z); g.add(pl); }
  // Murs de bloc voisins : à gauche et à droite de la board, sur le mur du fond, et le long des murs latéraux
  const walls = [
    {x: -6.0, w: 5.4, color: '#e9e7e2', kick: 1.0, deg: 15},
    {x: 6.0, w: 5.4, color: '#2f6f76', kick: 1.2, deg: 30}
  ];
  for (const wd of walls) { const w = gymWall(wd.w, 4.6, wd.color, wd.kick, wd.deg, low); w.position.set(wd.x, 0, ROOM.back + 0.06); g.add(w); }
  for (const [side, color, deg] of [[-1, '#3d4f8c', 5], [1, '#d9d3c4', 10]]) {
    const w = gymWall(7.5, 4.4, color, 0.9, deg, low);
    w.rotation.y = -side * Math.PI / 2; w.position.set(side * (ROOM.x - 0.06), 0, 3.6); g.add(w);
  }
  // Tapis le long des murs de bloc voisins
  g.add(matArea(-ROOM.x + 0.05, -3.4, ROOM.back + 0.05, ROOM.back + 3.4, 0x2f3d52));
  g.add(matArea(3.4, ROOM.x - 0.05, ROOM.back + 0.05, ROOM.back + 3.4, 0x2f3d52));
  g.add(matArea(-ROOM.x + 0.05, -ROOM.x + 2.9, ROOM.back + 3.45, 7.5, 0x2f3d52));
  g.add(matArea(ROOM.x - 2.9, ROOM.x - 0.05, ROOM.back + 3.45, 7.5, 0x2f3d52));
  // Accessoires : banc, seau à magnésie, gourde, brosse
  const benchX = -3.1, benchZ = 6.2;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.42), new THREE.MeshStandardMaterial({map: woodTexture(1.8, 0.42, false), roughness: 0.7}));
  seat.position.set(benchX, 0.45, benchZ); seat.castShadow = !low; seat.receiveShadow = true; g.add(seat);
  for (const dx of [-0.8, 0.8]) for (const dz of [-0.16, 0.16]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.43, 0.04), steel); leg.position.set(benchX + dx, 0.215, benchZ + dz); g.add(leg); }
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.2, 24), new THREE.MeshStandardMaterial({color: 0x9a3d2a, roughness: 0.8}));
  bucket.position.set(benchX - 0.5, 0.575, benchZ); bucket.castShadow = !low; g.add(bucket);
  const chalk = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshStandardMaterial({color: 0xf4f3ef, roughness: 1}));
  chalk.rotation.x = -Math.PI / 2; chalk.position.set(benchX - 0.5, 0.66, benchZ); g.add(chalk);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 16), new THREE.MeshStandardMaterial({color: 0x2b8fd6, roughness: 0.3, metalness: 0.4}));
  bottle.position.set(benchX + 0.4, 0.595, benchZ + 0.05); bottle.castShadow = !low; g.add(bottle);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.3), new THREE.MeshStandardMaterial({color: 0x3c4a3a, roughness: 0.9}));
  bag.position.set(benchX + 1.3, 0.14, benchZ + 0.5); bag.rotation.y = 0.4; bag.castShadow = !low; g.add(bag);
  scene.add(mergeStatic(g));
}
