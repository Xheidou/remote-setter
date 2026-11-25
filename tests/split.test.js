// Blocs découpés : le script Python écrit de faux blocs, data.js les relit (node --test tests/*.test.js)
import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {store, openClimbs, climbsAt, hasClimbsAt, loadClimb, climbKey, chunkOf, decodeProf} from '../src/data.js';
import {filterClimbs, defaultFilters, view} from '../src/ui/filters.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), 'board3d-'));
const requests = [];

// Même jeu que tests/test_build_board_data.py
const GEN = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bbd", sys.argv[1] + "/scripts/build_board_data.py")
bbd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bbd)
c = lambda u, n, s, h, st: {"id": u, "board": "x", "name": n, "setter": s, "holds": h, "stats": st}
climbs = [
  c("ABCDEF0123456789", "Premier", "alice", [[1, "start"], [2, "hand"], [3, "finish"], [9, "foot"]],
    [[40, "6b/V4", 120, 2.9, 18.4, 1], [45, "6c/V5", 10, None, 20.0, 0]]),
  c("ABCDEF0199999999", "Deuxième", "bob", [[4, "start"], [3, "hand"]], [[40, "", 5, 3.0, None, 0]]),
  c("1234", "Court", "alice", [[1, "hand"]], [[30, "5a/V1", 3, 2.0, 13.0, 0]]),
]
files, fd = bbd.split_climbs(climbs, {1: "edge", 2: "edge", 3: "jug", 4: "sloper", 9: "foot_chip"})
desc = bbd.climbs_desc("x", fd, "2026-11-25T04:17:00Z", "snap")
bbd.write_climbs_dir(sys.argv[2], "x", files, desc)
print(json.dumps(desc))
`;

before(() => {
  const desc = JSON.parse(execFileSync('python3', ['-c', GEN, ROOT, out], {encoding: 'utf8'}).trim().split('\n').pop());
  mkdirSync(join(out, 'boards'), {recursive: true});
  writeFileSync(join(out, 'boards', 'x.json'), JSON.stringify({id: 'x', name: 'X', width: 1, panel: 1,
    holes: [[1, 0, 0, 0.5, 'edge'], [2, 0, 0.1, 0.5, 'edge'], [3, 0, 0.2, 0.5, 'jug'], [4, 0, 0.3, 0.5, 'sloper'], [9, 0, -0.1, 0.5, 'foot_chip']]}));
  globalThis.fetch = async url => {
    requests.push(url);
    const path = url.replace(/^\.\/data\//, '').replace(/\?.*$/, '');
    try { const txt = readFileSync(join(out, path), 'utf8'); return {ok: true, json: async () => JSON.parse(txt)}; }
    catch { return {ok: false, status: 404}; }
  };
  store.meta.set('x', {id: 'x', name: 'X', geometry: 'boards/x.json', climbs: desc});
});

test('FNV-1a identique au script', () => {
  assert.equal(chunkOf('', 2 ** 32), 0x811c9dc5);
  assert.equal(chunkOf('a', 2 ** 32), 0xe40c292c);
  assert.equal(chunkOf('foobar', 2 ** 32), 0xbf9cf968);
});

test('profil décodé', () => {
  assert.deepEqual(decodeProf('e2j1'), {counts: {edge: 2, jug: 1}, dom: 'edge'});
  assert.deepEqual(decodeProf('j3e3'), {counts: {jug: 3, edge: 3}, dom: 'edge'});   // égalité : ordre de TYPE_ORDER
});

test('ouvrir ne télécharge pas de blocs', async () => {
  assert.deepEqual(await openClimbs('x'), {mem: false, count: 3});
  assert.equal(requests.filter(r => r.includes('climbs/')).length, 0);
  assert.equal(climbKey('x', 'ABCDEF0123456789'), 'ABCDEF012');
});

test('liste à un angle : stats, filtres, tri', async () => {
  assert.equal(hasClimbsAt('x', 40), false);
  const list = await climbsAt('x', 40);
  assert.equal(hasClimbsAt('x', 40), true);
  assert.ok(requests.some(r => r.startsWith('./data/climbs/x/a40.json?v=20261125041700')));
  assert.deepEqual(list.map(c => c.id), ['ABCDEF012', 'ABCDEF019']);
  const v = view(list[0], 40);
  assert.deepEqual([v.here, v.grade, v.asc, v.q, v.diff, v.bench], [true, '6b/V4', 120, 2.9, 18.4, true]);
  assert.equal(view(list[1], 40).diff, null);
  assert.equal(list[0].holds, null);                                     // pas encore de prises
  const typeOf = () => { throw new Error('profil précalculé attendu'); };
  const f = {...defaultFilters(), types: new Set(['jug'])};
  assert.deepEqual(filterClimbs(list, 40, f, typeOf, new Set()).map(r => r.c.id), ['ABCDEF019']);
  assert.deepEqual(await climbsAt('x', 35), []);                         // angle sans blocs : pas de requête
  assert.ok(!requests.some(r => r.includes('a35.json')));
});

test('tous les blocs (« jamais faits à cet angle »)', async () => {
  const all = await climbsAt('x', 40, true);
  assert.equal(all.length, 3);
  const f = {...defaultFilters(), unclimbed: true};
  const res = filterClimbs(all, 40, f, () => '', new Set());
  assert.deepEqual(res.map(r => [r.c.id, r.v.here]), [['ABCDEF012', true], ['ABCDEF019', true], ['1234', false]]);
  assert.strictEqual(all[0], (await climbsAt('x', 40))[0]);             // un seul objet par bloc
});

test('détail : prises et stats de tous les angles, id complet ou court', async () => {
  const c = await loadClimb('x', 'ABCDEF0123456789');                  // ancien lien avec l'id complet
  assert.equal(c.id, 'ABCDEF012');
  assert.deepEqual(c.holds, [[1, 'start'], [2, 'hand'], [3, 'finish'], [9, 'foot']]);
  assert.deepEqual(c.stats.map(s => s[0]), [40, 45]);
  assert.equal(view(c, 45).grade, '6c/V5');
  assert.equal(c.ascents, 130);
  assert.equal((await loadClimb('x', '1234')).name, 'Court');
  assert.equal(await loadClimb('x', 'inconnu'), null);
});
