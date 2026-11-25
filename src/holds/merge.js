import * as THREE from 'three';

// Toutes les prises d'un plan (panneau ou kicker) en un seul maillage : 2 appels de dessin au lieu d'un ou deux
// par prise. Couleur et émission (surbrillance d'un bloc) portées par sommet ; les triangles d'une prise restent
// contigus : groupe 0 = la prise, groupe 1 = le puits du trou de vis.
//
// items : [{id, geo, x, y, z, s?: [sx, sy, sz], hole}] — géométrie locale de la prise, posée en (x, y, z), mise à
// l'échelle par s ; hole = la géométrie a un groupe 1 (puits). Sans hole, tous les triangles vont au groupe 0.
export function mergeHolds(items) {
  let V = 0, I0 = 0, I1 = 0;
  const src = items.map(it => {
    const g = it.geo, n = g.attributes.position.count;
    const idx = g.index ? g.index.array : null, count = idx ? idx.length : n;
    const ranges = [[], []];
    if (it.hole && g.groups.length) for (const gr of g.groups) ranges[gr.materialIndex === 1 ? 1 : 0].push([gr.start, Math.min(count, gr.start + gr.count)]);
    else ranges[0].push([0, count]);
    const len = r => r.reduce((a, [s, e]) => a + e - s, 0);
    const o = {it, n, idx, ranges, c0: len(ranges[0]), c1: len(ranges[1])};
    V += n; I0 += o.c0; I1 += o.c1;
    return o;
  });
  const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3), col = new Float32Array(V * 3).fill(1), emis = new Float32Array(V * 3);
  const index = V > 65535 ? new Uint32Array(I0 + I1) : new Uint16Array(I0 + I1);
  const parts = [], byId = new Map();
  let v = 0, t0 = 0, t1 = I0;
  for (const {it, n, idx, ranges, c0, c1} of src) {
    const P = it.geo.attributes.position, N = it.geo.attributes.normal;
    const [sx, sy, sz] = it.s || [1, 1, 1];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = (v + i) * 3;
      const x = P.getX(i) * sx + it.x, y = P.getY(i) * sy + it.y, z = P.getZ(i) * sz + (it.z || 0);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (N) {     // normale sous mise à l'échelle non uniforme : divisée par l'échelle puis renormalisée
        const a = N.getX(i) / sx, b = N.getY(i) / sy, c = N.getZ(i) / sz, L = Math.hypot(a, b, c) || 1;
        nrm[k] = a / L; nrm[k + 1] = b / L; nrm[k + 2] = c / L;
      }
    }
    const part = {id: it.id, v0: v, vn: n, t0, tn: c0, w0: t1, wn: c1, sphere: new THREE.Sphere()};
    for (const [s, e] of ranges[0]) for (let j = s; j < e; j++) index[t0++] = v + (idx ? idx[j] : j);
    for (const [s, e] of ranges[1]) for (let j = s; j < e; j++) index[t1++] = v + (idx ? idx[j] : j);
    const c = part.sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    let r2 = 0;
    for (let i = 0; i < n; i++) { const k = (v + i) * 3, dx = pos[k] - c.x, dy = pos[k + 1] - c.y, dz = pos[k + 2] - c.z; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
    part.sphere.radius = Math.sqrt(r2);
    parts.push(part); byId.set(it.id, part);
    v += n;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('emis', new THREE.BufferAttribute(emis, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.addGroup(0, I0, 0);
  if (I1) geometry.addGroup(I0, I1, 1);
  geometry.computeBoundingSphere();
  return {geometry, parts, byId};
}

// Couleur et émission d'une prise (THREE.Color ou {r, g, b}) ; appeler commitPaint ensuite pour envoyer au GPU
export function paintHold(merged, id, color, emissive) {
  const p = merged.byId.get(id); if (!p) return;
  const C = merged.geometry.attributes.color.array, E = merged.geometry.attributes.emis.array;
  const er = emissive ? emissive.r : 0, eg = emissive ? emissive.g : 0, eb = emissive ? emissive.b : 0;
  for (let k = p.v0 * 3, end = (p.v0 + p.vn) * 3; k < end; k += 3) {
    C[k] = color.r; C[k + 1] = color.g; C[k + 2] = color.b;
    E[k] = er; E[k + 1] = eg; E[k + 2] = eb;
  }
}
export function commitPaint(merged) {
  merged.geometry.attributes.color.needsUpdate = true;
  merged.geometry.attributes.emis.needsUpdate = true;
}

// Matériau des prises fusionnées : couleur par sommet + émission par sommet (attribut « emis »)
export function holdMaterial() {
  const m = new THREE.MeshStandardMaterial({color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.02});
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec3 emis;\nvarying vec3 vEmis;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n\tvEmis = emis;');
    sh.fragmentShader = 'varying vec3 vEmis;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vEmis;');
  };
  m.customProgramCacheKey = () => 'board3d-hold-emis';
  return m;
}

// Prise touchée par un rayon : test des sphères englobantes puis des triangles de ces prises seulement.
// Face avant seulement pour la prise (matériau FrontSide), les deux faces pour le puits (DoubleSide).
const _inv = new THREE.Matrix4(), _ray = new THREE.Ray(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();
export function pickHold(merged, mesh, ray) {
  _inv.copy(mesh.matrixWorld).invert();
  _ray.copy(ray).applyMatrix4(_inv);
  const P = merged.geometry.attributes.position.array, I = merged.geometry.index.array;
  let best = null;
  const tri = (j, cull, id) => {
    const a = I[j] * 3, b = I[j + 1] * 3, c = I[j + 2] * 3;
    _a.set(P[a], P[a + 1], P[a + 2]); _b.set(P[b], P[b + 1], P[b + 2]); _c.set(P[c], P[c + 1], P[c + 2]);
    if (!_ray.intersectTriangle(_a, _b, _c, cull, _p)) return;
    const pt = _p.clone().applyMatrix4(mesh.matrixWorld), d = ray.origin.distanceTo(pt);
    if (!best || d < best.distance) best = {id, distance: d, point: pt};
  };
  for (const p of merged.parts) {
    if (!_ray.intersectsSphere(p.sphere)) continue;
    for (let j = p.t0; j < p.t0 + p.tn; j += 3) tri(j, true, p.id);
    for (let j = p.w0; j < p.w0 + p.wn; j += 3) tri(j, false, p.id);
  }
  return best;
}
