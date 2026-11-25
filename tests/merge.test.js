// Prises fusionnées : un maillage par plan, peinture par prise, clic sur une prise (node --test tests/*.test.js)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {holdGeometry} from '../src/holds/geometry.js';
import {mergeHolds, paintHold, pickHold} from '../src/holds/merge.js';
import {faceBox, mergeStatic} from '../src/scene/room.js';

// Contour en unités du fichier de board : cercle de rayon r (m) autour du boulon
const circle = (r, n = 24) => Array.from({length: n}, (_, i) => [r * Math.cos(i / n * 2 * Math.PI), r * Math.sin(i / n * 2 * Math.PI)]).flat();

function fixture() {
  const a = holdGeometry(circle(0.04), 'edge', 'up'), b = holdGeometry(circle(0.05), 'jug', 'down');
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  const items = [
    {id: 'A', geo: a.geo, x: 0, y: 0, z: 0.001, hole: a.hole},
    {id: 'B', geo: b.geo, x: 0.5, y: 0.2, z: 0.001, hole: b.hole},
    {id: 'C', geo: sphere, x: -0.5, y: 0.4, z: 0.001, s: [0.035, 0.035, 0.0175]}
  ];
  return {items, a, b, sphere, merged: mergeHolds(items)};
}
const tris = g => (g.index ? g.index.count : g.attributes.position.count);

test('les sommets et triangles de toutes les prises sont repris, puits dans le groupe 1', () => {
  const {a, b, sphere, merged} = fixture();
  const g = merged.geometry;
  assert.equal(g.attributes.position.count, a.geo.attributes.position.count + b.geo.attributes.position.count + sphere.attributes.position.count);
  assert.equal(g.index.count, tris(a.geo) + tris(b.geo) + tris(sphere));
  const well = [a, b].reduce((s, h) => s + (h.hole ? h.geo.groups.filter(x => x.materialIndex === 1).reduce((t, x) => t + x.count, 0) : 0), 0);
  assert.equal(g.groups[0].start, 0);
  assert.equal(g.groups[0].count, g.index.count - well);
  assert.ok(well > 0);
  assert.deepEqual([g.groups[1].start, g.groups[1].count, g.groups[1].materialIndex], [g.index.count - well, well, 1]);
  // positions posées, et normales unitaires malgré l'échelle non uniforme de la sphère
  const P = g.attributes.position, N = g.attributes.normal, pc = merged.byId.get('C');
  for (let i = pc.v0; i < pc.v0 + pc.vn; i++) {
    assert.ok(Math.abs(P.getX(i) + 0.5) <= 0.0351 && Math.abs(P.getZ(i) - 0.001) <= 0.0176);
    assert.ok(Math.abs(Math.hypot(N.getX(i), N.getY(i), N.getZ(i)) - 1) < 1e-5);
  }
});

test('peindre une prise ne touche que ses sommets', () => {
  const {merged} = fixture();
  paintHold(merged, 'B', {r: 0.1, g: 0.2, b: 0.3}, {r: 0.5, g: 0, b: 0});
  const C = merged.geometry.attributes.color, E = merged.geometry.attributes.emis, pb = merged.byId.get('B');
  for (let i = 0; i < C.count; i++) {
    const inB = i >= pb.v0 && i < pb.v0 + pb.vn;
    assert.equal(C.getX(i), inB ? Math.fround(0.1) : 1);
    assert.equal(E.getX(i), inB ? 0.5 : 0);
  }
});

test('le clic trouve la prise visée, même sur un plan incliné', () => {
  const {merged} = fixture();
  const parent = new THREE.Group(), mesh = new THREE.Mesh(merged.geometry);
  parent.add(mesh); parent.position.set(0, 1.3, 0); parent.rotation.x = THREE.MathUtils.degToRad(40);
  parent.updateMatrixWorld(true);
  const shoot = (x, y) => {
    const target = mesh.localToWorld(new THREE.Vector3(x, y, 0)), dir = mesh.localToWorld(new THREE.Vector3(x, y, 1)).sub(target).normalize();
    return pickHold(merged, mesh, new THREE.Ray(target.clone().addScaledVector(dir, 3), dir.negate()));
  };
  assert.equal(shoot(0.5, 0.2).id, 'B');
  assert.equal(shoot(0, 0).id, 'A');
  assert.equal(shoot(-0.5, 0.4).id, 'C');
  assert.equal(shoot(0.25, -0.3), null);
  // même résultat que le lancer de rayon de Three.js sur la prise seule
  const {b} = fixture(), solo = new THREE.Mesh(b.geo, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial({side: THREE.DoubleSide})]);
  solo.position.set(0.5, 0.2, 0.001); parent.add(solo); parent.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(); const hit = shoot(0.5, 0.2);
  const o = mesh.localToWorld(new THREE.Vector3(0.5, 0.2, 3));
  ray.set(o, mesh.localToWorld(new THREE.Vector3(0.5, 0.2, 0)).sub(o).normalize());
  assert.ok(Math.abs(ray.intersectObject(solo)[0].distance - hit.distance) < 1e-6);
});

test('faceBox : face avant seule dans le groupe 1, et mergeStatic regroupe par matériau', () => {
  const edge = new THREE.MeshBasicMaterial(), face = new THREE.MeshBasicMaterial();
  const box = faceBox(2, 1, 0.04, edge, face), g = box.geometry, N = g.attributes.normal, I = g.index.array;
  assert.deepEqual(g.groups.map(x => [x.start, x.count, x.materialIndex]), [[0, 30, 0], [30, 6, 1]]);
  for (let j = 30; j < 36; j++) assert.equal(N.getZ(I[j]), 1);
  const root = new THREE.Group(), sub = new THREE.Group(); sub.rotation.x = 0.5; root.add(sub);
  const m = new THREE.MeshBasicMaterial(), other = new THREE.MeshBasicMaterial();
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), m); b.position.x = i; sub.add(b); }
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), other), box);
  mergeStatic(root);
  const meshes = []; root.traverse(o => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 3);                       // 3 cubes fusionnés + le cube seul + faceBox (multi-matériaux, gardé)
  const fused = meshes.find(o => o.material === m);
  assert.equal(fused.geometry.attributes.position.count, 3 * 36);
  fused.geometry.computeBoundingBox();
  assert.ok(Math.abs(fused.geometry.boundingBox.max.x - 2.05) < 1e-6);
});
