// Protocoles Bluetooth des boards à LED, sans DOM (testable dans Node). D'après les spécifications publiées par
// Boardsesh (Apache-2.0) : docs/boards/AURORA_BLUETOOTH_PROTOCOL_SPEC.md et MOONBOARD_BLUETOOTH_PROTOCOL_SPEC.md.
//
// Aurora (Kilter, Tension, Decoy, Grasshopper) : trames SOH LEN CHK STX <commande + LED> ETX, envoyées sur le
// service Nordic UART par paquets de 20 octets. API v2 = 2 octets par LED (position 10 bits, couleur 2 bits par
// canal, budget de puissance) ; API v3 = 3 octets (position 16 bits, couleur RGB 3-3-2).
// MoonBoard : texte ASCII « l#S0,P35,E197# » (S départ, P main, E top), « l## » éteint tout.

export const AURORA_SERVICE = '4488b571-7806-4df6-bcff-a2897e4953ff';
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const REDBEAR_SERVICE = '713d0000-503e-4c75-ba94-3148f18d941e';      // anciens boîtiers MoonBoard
export const REDBEAR_WRITE = '713d0003-503e-4c75-ba94-3148f18d941e';
export const CHUNK = 20;

// « Kilter Board#abc123@3 » -> {display: 'Kilter Board', serial: 'abc123', api: 3} ; API 2 par défaut
export function parseAuroraName(name = '') {
  const cut = name.search(/[#@]/);
  const serial = (name.match(/#([a-z0-9]+)/i) || [])[1] || null, api = (name.match(/@(\d+)/) || [])[1];
  return {display: (cut < 0 ? name : name.slice(0, cut)).trim(), serial, api: api ? +api : 2, bare: cut < 0};
}

export const checksum = bytes => ~bytes.reduce((s, b) => (s + b) & 0xff, 0) & 0xff;
export function wrap(payload) {
  if (payload.length > 255) throw new RangeError('trame Aurora trop longue');
  return [0x01, payload.length, checksum(payload), 0x02, ...payload, 0x03];
}
const rgb = hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) || 0);
const v2c = (v, scale) => Math.floor(Math.floor(v * scale) / 64);           // 0..3
// API v2 : plus grand facteur de luminosité qui tient dans 18 W (0,1 W par LED et par unité de couleur)
export function v2Scale(colors, ledsPerHold = 1) {
  for (const s of [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05]) {
    let w = 0;
    for (const c of colors) { const [r, g, b] = rgb(c); w += (v2c(r, s) + v2c(g, s) + v2c(b, s)) / 30; }
    if (ledsPerHold * w <= 18) return s;
  }
  return 0;
}
const CMD = {2: {single: 80, start: 78, cont: 77, end: 79}, 3: {single: 84, start: 82, cont: 81, end: 83}};
// leds : [{pos, color: 'RRGGBB'}] -> octets à écrire (toutes les trames à la suite). Liste vide = tout éteindre.
export function auroraBytes(leds, api = 3, ledsPerHold = 1) {
  const v = api >= 3 ? 3 : 2, per = v, max = v === 3 ? 0xffff : 1023;
  const scale = v === 2 ? v2Scale(leds.map(l => l.color), ledsPerHold) : 1;
  const parts = [[]];
  for (const {pos, color} of leds) {
    if (!(pos >= 0 && pos <= max)) continue;
    const [r, g, b] = rgb(color);
    const bytes = v === 3
      ? [pos & 0xff, (pos >> 8) & 0xff, ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6)]
      : [pos & 0xff, (v2c(r, scale) << 6) | (v2c(g, scale) << 4) | (v2c(b, scale) << 2) | ((pos >> 8) & 0x03)];
    if (1 + (parts[parts.length - 1].length + per) > 255) parts.push([]);
    parts[parts.length - 1].push(...bytes);
  }
  const c = CMD[v];
  const out = parts.map((p, i) => wrap([parts.length === 1 ? c.single : i === 0 ? c.start : i === parts.length - 1 ? c.end : c.cont, ...p]));
  return Uint8Array.from(out.flat());
}

// MoonBoard : prises [{pos, role}] -> « l#S0,P35,E197# » (les pieds sont allumés comme des mains)
const MOON_MARK = {start: 'S', hand: 'P', finish: 'E', foot: 'P'};
export function moonText(leds) {
  return 'l#' + leds.filter(l => l.pos >= 0).map(l => (MOON_MARK[l.role] || 'P') + l.pos).join(',') + '#';
}
export const moonBytes = leds => new TextEncoder().encode(moonText(leds));

export function chunks(bytes, size = CHUNK) {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

// Prises d'un bloc -> LED de la board : board.leds {prise: position}, board.ble.colors {rôle: couleur}
export function climbLeds(board, holds) {
  const out = [], ble = board.ble || {};
  for (const [id, role] of holds) {
    const pos = board.leds && board.leds[id];
    if (pos == null) continue;
    out.push({pos, role, color: (ble.colors && ble.colors[role]) || 'FFFFFF'});
  }
  return out;
}
export const boardBytes = (board, leds, api) => board.ble && board.ble.protocol === 'moon'
  ? moonBytes(leds) : auroraBytes(leds, api, (board.ble && board.ble.ledsPerHold) || 1);
