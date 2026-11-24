import * as THREE from 'three';
import {TYPES, DEFAULT_PROFILE, DIRS} from '../config.js';

export function polyPoints(flat, scale = 1) {
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i] * scale, flat[i + 1] * scale));
  return pts;
}
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }

export function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
// Modelage par type (CruxCoach) : le contour est resserré en anneaux vers le centre ; la hauteur de chaque
// anneau dépend du type et de la position par rapport au côté utilisable (orientation de la prise).
//  - réglette, bac : le corps monte vers le côté utilisable ; la partie qui crochète est le BORD EXTÉRIEUR,
//    qui déborde de la base et revient vers le mur en dessous (arquée). Rien n'est creusé dans la prise.
//  - plat : dessus large et arrondi qui fuit vers le côté utilisable, sans lèvre
//  - trou : cuvette au centre ; pince et autres : dôme
// Modelage des prises (types et orientations CruxCoach), centré sur le boulon de la prise.
//  - dessus bombé ; flancs droits sur le dos et les côtés
//  - réglette / bac, côté utilisable : face inférieure creusée en arc qui part du mur et s'évase jusqu'à la
//    pointe de la lèvre (partie qui crochète), arête vive à la pointe, puis nez arrondi qui rejoint le dessus
//  - plat : flancs arrondis, dessus qui fuit ; trou : cuvette ; pince et autres : dôme à flancs droits
//  - trou de vis réel creusé dans la surface (fraisure puis puits sombre), à l'emplacement du boulon
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU_TIP = 0.45;
const FLANK_TAU = [0, 0.12, 0.24, 0.33, 0.40, TAU_TIP];            // face inférieure (jusqu'à la pointe)
const NOSE_TAU = [TAU_TIP, 0.55, 0.65, 0.75, 0.84, 0.92, 1];         // nez (pointe doublée -> arête vive)
const TOP_RINGS = 8, HOLE_R = 0.0055, SINK_R = 0.009, HOLE_DEPTH = 0.014;
function triAt(pos, idx, x, y) {                             // triangle sous (x, y) : hauteur et normale
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const x1 = pos[a], y1 = pos[a + 1], x2 = pos[b], y2 = pos[b + 1], x3 = pos[c], y3 = pos[c + 1];
    const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (Math.abs(den) < 1e-14) continue;
    const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / den, l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / den, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const z = l1 * pos[a + 2] + l2 * pos[b + 2] + l3 * pos[c + 2];
    const ux = x2 - x1, uy = y2 - y1, uz = pos[b + 2] - pos[a + 2], vx = x3 - x1, vy = y3 - y1, vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return {x, y, z, nx: nx / L, ny: ny / L, nz: nz / L};
  }
  return null;
}
export function holdGeometry(flat, type, dir) {
  let pts = polyPoints(flat);
  if (pts.length < 3) return null;
  let sa = 0, gx = 0, gy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], cr = p.x * q.y - q.x * p.y;
    sa += cr; gx += (p.x + q.x) * cr; gy += (p.y + q.y) * cr;
  }
  if (Math.abs(sa) < 1e-9) return null;
  gx /= 3 * sa; gy /= 3 * sa;
  if (sa < 0) pts = pts.slice().reverse();
  const re = Math.sqrt(Math.abs(sa) / 2 / Math.PI);
  const P = TYPES[type] || DEFAULT_PROFILE;
  const H = P.H[0] + (P.H[1] - P.H[0]) * Math.max(0, Math.min(1, (re - 0.03) / 0.05));
  const boltIn = inside(pts, 0, 0);
  const tries = [];
  if (boltIn && re > 0.022) tries.push([0, 0, true]);
  if (boltIn) tries.push([0, 0, false]);
  if (inside(pts, gx, gy)) tries.push([gx, gy, false]);
  for (const [cx, cy, hole] of tries) {
    const r = buildHold(pts, P, H, re, dir, cx, cy, hole);
    if (r) { r.bolt = r.hole ? null : (boltIn ? triAt(r.pos, r.idx, 0, 0) : null); return r; }
  }
  // Contour très concave : dalle simple
  const slab = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {depth: H * 0.85, bevelEnabled: false});
  slab.computeVertexNormals();
  return {geo: slab, re, depth: H * 0.85, hole: false, bolt: boltIn ? {x: 0, y: 0, z: H * 0.85, nx: 0, ny: 0, nz: 1} : null};
}
function buildHold(pts, P, H, re, dir, cx, cy, hole) {
  const sc = 1 - P.fw;
  const D = DIRS[dir], allRound = !D || (!D[0] && !D[1]);
  const dx = allRound ? 0 : D[0], dy = allRound ? 1 : D[1];
  const hook = P.kind === 'incut' || P.kind === 'scoop', jug = P.kind === 'scoop';
  let reach = 1e-6;
  for (const q of pts) reach = Math.max(reach, (q.x - cx) * dx + (q.y - cy) * dy);
  const lipOut = P.lip ? Math.min(P.lip[1], Math.max(P.lip[0], re * 0.25)) : 0;
  const n = pts.length;
  const sp = pts.map(q => {
    const L = Math.hypot(q.x - cx, q.y - cy) || 1e-6, ux = (q.x - cx) / L, uy = (q.y - cy) / L;
    const u = Math.max(-1, Math.min(1, ((q.x - cx) * dx + (q.y - cy) * dy) / reach));
    const w = !hook ? 0 : (allRound ? 1 : smooth(0.2, 0.8, u));
    return {q, L, ux, uy, u, w, ox: allRound ? ux : dx, oy: allRound ? uy : dy};
  });
  if (hole && sp.some(o => o.L * sc < SINK_R * 1.25)) return null;      // prise trop petite pour le trou
  // Hauteur du dessus : plan incliné (réglette, bac) ou plateau, bombé vers le centre
  const body = (o, s) => {
    const uv = o.u * s;
    if (P.kind === 'incut') return allRound ? 1 : 0.5 + 0.5 * Math.max(0, Math.min(1, (uv + 1) / 1.7));
    if (P.kind === 'scoop') return allRound ? 1 : 0.45 + 0.55 * Math.max(0, Math.min(1, (uv + 1) / 1.5));
    if (P.kind === 'flat') return allRound ? 1 : 1 - 0.35 * (uv + 1) / 2;
    return 1;
  };
  const topZ = (o, s) => H * body(o, s) * (0.74 + 0.26 * (1 - (s / sc) ** 2));
  // Surface du dessus : pour un trou (bidoigt), cuvette qui descend jusqu'au fond, où tombe le trou de vis
  const surfZ = (o, s) => P.kind === 'bowl' ? topZ(o, s) * (1 - 0.85 * Math.max(0, 1 - s / (sc * 0.55))) : topZ(o, s);
  const pos = [], base = [], idx = [], holeIdx = [];
  const push = (x, y, z, bx, by) => { pos.push(x, y, z); base.push(bx, by); };
  // Anneaux du flanc : tau 0 (mur) -> 1 (haut du flanc)
  const flankRing = tau => {
    const s = 1 - tau * (1 - sc);
    for (const o of sp) {
      const Z0 = topZ(o, sc);
      const bx = cx + (o.q.x - cx) * s, by = cy + (o.q.y - cy) * s;
      let zs = Z0 * (P.kind === 'flat' ? smooth(0, 1, tau) : P.kind === 'bowl' ? tau : tau);
      if (tau === 0) { push(o.q.x, o.q.y, 0, bx, by); continue; }
      if (!o.w) { push(bx, by, zs, bx, by); continue; }
      const R = Math.min(Z0 * (jug ? 0.42 : 0.36), jug ? 0.016 : 0.013), zTip = Z0 - R;
      let off, zh;
      if (tau <= TAU_TIP) { const t = tau / TAU_TIP; off = lipOut * Math.pow(t, 2.2); zh = zTip * t; }
      else { const ph = (tau - TAU_TIP) / (1 - TAU_TIP) * Math.PI / 2; off = lipOut - R + R * Math.cos(ph); zh = zTip + R * Math.sin(ph); }
      const hx = o.q.x + o.ox * off, hy = o.q.y + o.oy * off;
      push(bx + (hx - bx) * o.w, by + (hy - by) * o.w, zs + (zh - zs) * o.w, bx, by);
    }
  };
  // Anneaux du dessus : s de sc vers 0 (vers le trou ou le sommet)
  const topRing = s => {
    const lam = smooth(sc * 0.55, sc, s);
    for (const o of sp) {
      const rho = hole ? SINK_R + (o.L * sc - SINK_R) * (s / sc) : o.L * s;
      const bx = cx + o.ux * rho, by = cy + o.uy * rho;
      let x = bx, y = by;
      if (o.w) {
        const Z0 = topZ(o, sc), R = Math.min(Z0 * (jug ? 0.42 : 0.36), jug ? 0.016 : 0.013);
        const ex = o.q.x + o.ox * (lipOut - R) - (cx + (o.q.x - cx) * sc), ey = o.q.y + o.oy * (lipOut - R) - (cy + (o.q.y - cy) * sc);
        x += ex * o.w * lam; y += ey * o.w * lam;
      }
      push(x, y, surfZ(o, s), bx, by);
    }
  };
  const strip = (r0, count, out = idx) => {
    for (let k = 0; k < count - 1; k++) for (let i = 0; i < n; i++) {
      const a = (r0 + k) * n + i, b = (r0 + k) * n + (i + 1) % n, c = (r0 + k + 1) * n + i, d = (r0 + k + 1) * n + (i + 1) % n;
      out.push(a, b, d, a, d, c);
    }
  };
  FLANK_TAU.forEach(flankRing);                                       // anneaux 0..5
  const r1 = FLANK_TAU.length; NOSE_TAU.forEach(flankRing);           // pointe doublée : arête vive
  const topS = [];
  for (let j = 1; j <= TOP_RINGS; j++) topS.push(sc * (1 - j / TOP_RINGS));
  if (!hole) topS.pop();
  topS.forEach(topRing);
  const rings = r1 + NOSE_TAU.length + topS.length;
  strip(0, r1); strip(r1, NOSE_TAU.length + topS.length);
  if (hole) {
    // fraisure (anneau au rayon du trou, légèrement plus bas), puis puits sombre
    const zc = sp.map(o => surfZ(o, 0));
    sp.forEach((o, i) => push(cx + o.ux * HOLE_R, cy + o.uy * HOLE_R, zc[i] - 0.0018, cx + o.ux * HOLE_R, cy + o.uy * HOLE_R));
    strip(rings - 1, 2);
    const wall = rings + 1;
    sp.forEach((o, i) => push(cx + o.ux * HOLE_R, cy + o.uy * HOLE_R, zc[i] - 0.0018, cx + o.ux * HOLE_R, cy + o.uy * HOLE_R));
    sp.forEach((o, i) => push(cx + o.ux * HOLE_R, cy + o.uy * HOLE_R, Math.max(0.001, zc[i] - HOLE_DEPTH), cx + o.ux * HOLE_R, cy + o.uy * HOLE_R));
    strip(wall, 2, holeIdx);
    const bottom = (wall + 2) * n; push(cx, cy, Math.max(0.001, Math.min(...zc) - HOLE_DEPTH), cx, cy);
    for (let i = 0; i < n; i++) holeIdx.push((wall + 1) * n + i, (wall + 1) * n + (i + 1) % n, bottom);
  } else {
    let az = 0; for (const o of sp) az += surfZ(o, 0);
    const apex = rings * n; push(cx, cy, az / n, cx, cy);
    for (let i = 0; i < n; i++) idx.push((rings - 1) * n + i, (rings - 1) * n + (i + 1) % n, apex);
  }
  // Rejet si les anneaux se croisent (contour trop concave vu depuis ce centre)
  let folded = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
    if ((base[b] - base[a]) * (base[c + 1] - base[a + 1]) - (base[b + 1] - base[a + 1]) * (base[c] - base[a]) < -1e-12) folded++;
  }
  if (folded > idx.length / 3 * 0.02) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...idx, ...holeIdx]);
  geo.addGroup(0, idx.length, 0);
  if (holeIdx.length) geo.addGroup(idx.length, holeIdx.length, 1);
  geo.computeVertexNormals();
  return {geo, re, depth: H, hole, pos, idx};
}
export function ringGeometry(flat, re) {
  const grow = Math.max(1.12, 1 + 0.018 / Math.max(re, 0.01));
  const outer = new THREE.Shape(polyPoints(flat, grow));
  outer.holes.push(new THREE.Path(polyPoints(flat, 1.01)));
  return new THREE.ShapeGeometry(outer);
}
