// Protocoles Bluetooth : exemples de la spécification Aurora de Boardsesh (§17) et format MoonBoard
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAuroraName, checksum, wrap, auroraBytes, v2Scale, moonText, chunks, climbLeds, boardBytes} from '../src/ble/protocol.js';

const hex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join(' ');

test('nom annoncé par le boîtier Aurora', () => {
  assert.deepEqual(parseAuroraName('Kilter Board#abc123@3'), {display: 'Kilter Board', serial: 'abc123', api: 3, bare: false});
  assert.deepEqual(parseAuroraName('Kilter Board@2'), {display: 'Kilter Board', serial: null, api: 2, bare: false});
  assert.deepEqual(parseAuroraName('Kilter Board'), {display: 'Kilter Board', serial: null, api: 2, bare: true});
});

test('trame : somme de contrôle et encadrement', () => {
  assert.equal(checksum([0x54, 0x2a, 0x00, 0x1c]), 0x65);
  assert.deepEqual(wrap([0x54, 0x2a, 0x00, 0x1c]), [0x01, 0x04, 0x65, 0x02, 0x54, 0x2a, 0x00, 0x1c, 0x03]);
  assert.throws(() => wrap(new Array(256).fill(0)));
});

test('exemple 1 de la spec : une LED en API v3', () => {
  assert.equal(hex(auroraBytes([{pos: 42, color: '00FF00'}], 3)), '01 04 65 02 54 2a 00 1c 03');
});

test('exemple 2 de la spec : trois LED en API v2', () => {
  const leds = [{pos: 10, color: '00FF00'}, {pos: 256, color: '0000FF'}, {pos: 500, color: 'FF0000'}];
  assert.equal(hex(auroraBytes(leds, 2)), '01 07 b3 02 50 0a 30 00 0d f4 c1 03');
});

test('API v2 : budget de 18 W, positions au-delà de 1023 ignorées', () => {
  const white = new Array(200).fill('FFFFFF');
  // blanc 255 : 3 unités par canal à 1 et 0,8 (60 W), 2 à 0,6 (40 W), 1 à 0,4 (20 W), 0 à 0,2 -> 0,2
  assert.equal(v2Scale(white, 1), 0.2);
  assert.equal(v2Scale(new Array(50).fill('FFFFFF'), 1), 1);     // 50 × 9/30 = 15 W : tient à pleine luminosité
  assert.equal(v2Scale(new Array(50).fill('FFFFFF'), 2), 0.4);   // 2 LED par prise : 30 W, 30 W, 20 W, puis 10 W à 0,4
  assert.equal(hex(auroraBytes([{pos: 2000, color: 'FF0000'}], 2)), hex(wrap([80])));
});

test('plusieurs trames : début, suite, fin (API v3, 200 LED)', () => {
  const leds = Array.from({length: 200}, (_, i) => ({pos: i, color: 'FFFFFF'}));
  const b = auroraBytes(leds, 3), frames = [];
  for (let i = 0; i < b.length;) { const len = b[i + 1]; frames.push(b.slice(i, i + len + 5)); i += len + 5; }
  assert.deepEqual(frames.map(f => [f[4], (f[1] - 1) / 3]), [[82, 84], [81, 84], [83, 32]]);    // R, Q, S
  for (const f of frames) assert.equal(f[2], checksum([...f.slice(4, f.length - 1)]));
});

test('liste vide = une trame sans LED (éteindre)', () => {
  assert.equal(hex(auroraBytes([], 3)), '01 01 ab 02 54 03');
});

test('MoonBoard : texte ASCII', () => {
  assert.equal(moonText([{pos: 0, role: 'start'}, {pos: 35, role: 'hand'}, {pos: 197, role: 'finish'}, {pos: 3, role: 'foot'}]), 'l#S0,P35,E197,P3#');
  assert.equal(moonText([]), 'l##');
});

test('découpage en paquets de 20 octets', () => {
  const c = chunks(new Uint8Array(45));
  assert.deepEqual(c.map(x => x.length), [20, 20, 5]);
});

test('prises d\'un bloc -> LED et couleurs de la board', () => {
  const board = {leds: {12: 100, 13: 7}, ble: {protocol: 'aurora', ledsPerHold: 2, colors: {start: '00FF00', hand: '00FFFF'}}};
  assert.deepEqual(climbLeds(board, [[12, 'start'], [13, 'hand'], [99, 'hand'], [13, 'finish']]),
    [{pos: 100, role: 'start', color: '00FF00'}, {pos: 7, role: 'hand', color: '00FFFF'}, {pos: 7, role: 'finish', color: 'FFFFFF'}]);
  const moon = {leds: {1: 0}, ble: {protocol: 'moon'}};
  assert.equal(new TextDecoder().decode(boardBytes(moon, climbLeds(moon, [[1, 'start']]))), 'l#S0#');
});
