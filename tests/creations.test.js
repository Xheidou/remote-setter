// Blocs créés : lien, rôles, règles, brouillons (node --test tests/*.test.js)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeHolds, decodeHolds, parseCreatedKey, createdKey, isCreatedKey, cycleRole, setRole, checkClimb,
  upsertDraft, removeDraft, sanitizeDrafts} from '../src/editor/creations.js';

const H = [[1253, 'start'], [12, 'hand'], [1400, 'finish'], [36, 'foot']];

test('le code du lien se relit à l\'identique (prises triées)', () => {
  const code = encodeHolds(H);
  assert.equal(code, 'cM10PytD12wT');                                   // 12, 36, 1253, 1400 en base 36
  assert.deepEqual(decodeHolds(code), [[12, 'hand'], [36, 'foot'], [1253, 'start'], [1400, 'finish']]);
  assert.equal(encodeHolds([[35, 'hand'], [36, 'start']]), 'zM10D');
});

test('codes invalides refusés', () => {
  for (const bad of ['', 'zz', 'M', '12X', '12m', 'abcdefM', 12, null, '1M2']) assert.equal(decodeHolds(bad), null, String(bad));
  assert.deepEqual(decodeHolds('1M1T'), [[1, 'finish']]);              // doublon : dernier rôle
});

test('clé de bloc créé avec cotation proposée', () => {
  const k = createdKey(H, 18);
  assert.ok(isCreatedKey(k) && k.endsWith('.18'));
  assert.deepEqual(parseCreatedKey(k).grade, 18);
  assert.equal(parseCreatedKey(createdKey(H)).grade, null);
  assert.equal(parseCreatedKey('b:' + encodeHolds(H) + '.99').grade, null);
  assert.equal(parseCreatedKey('ABCDEF12'), null);
  assert.equal(parseCreatedKey('b:nope'), null);
});

test('toucher une prise fait défiler les rôles', () => {
  const seq = [undefined];
  for (let i = 0; i < 5; i++) seq.push(cycleRole(seq[seq.length - 1]));
  assert.deepEqual(seq.slice(1), ['start', 'hand', 'finish', 'foot', null]);
  let h = setRole([], 5, 'start');
  h = setRole(h, 2, 'hand');
  assert.deepEqual(h, [[2, 'hand'], [5, 'start']]);
  assert.deepEqual(setRole(h, 5, null), [[2, 'hand']]);
});

test('règles : départ et top', () => {
  assert.equal(checkClimb([]).ok, false);
  assert.deepEqual(checkClimb([[1, 'hand']]).issues, ['Ajoutez une prise de départ.', 'Ajoutez une prise de top.']);
  assert.equal(checkClimb(H).ok, true);
  const three = [[1, 'start'], [2, 'start'], [3, 'start'], [4, 'finish']];
  assert.deepEqual(checkClimb(three).issues, ['Deux prises de départ au plus.']);
  assert.deepEqual(checkClimb(H).n, {start: 1, hand: 1, finish: 1, foot: 1});
});

test('brouillons : ajout en tête, mise à jour, suppression, nettoyage', () => {
  let l = upsertDraft([], {id: 'a', board: 'k', name: 'A', holds: H});
  l = upsertDraft(l, {id: 'b', board: 'k', name: 'B', holds: []});
  l = upsertDraft(l, {id: 'a', board: 'k', name: 'A2', holds: H});
  assert.deepEqual(l.map(d => d.name), ['A2', 'B']);
  assert.deepEqual(removeDraft(l, 'a').map(d => d.id), ['b']);
  const clean = sanitizeDrafts([null, {id: 'x'}, {id: 'y', board: 'k', holds: [[1, 'hand'], ['2', 'hand'], [3, 'nope']]}]);
  assert.equal(clean.length, 1);
  assert.deepEqual(clean[0].holds, [[1, 'hand']]);
  assert.deepEqual(sanitizeDrafts('pas une liste'), []);
});
