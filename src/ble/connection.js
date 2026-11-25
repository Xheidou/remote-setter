// Connexion Web Bluetooth à la board (Chrome, Edge, Opera sur ordinateur et Android ; ni Safari ni Firefox).
// Une seule connexion à la fois ; les envois sont mis en file et seul le dernier état demandé est envoyé.
import {AURORA_SERVICE, NUS_SERVICE, NUS_RX, REDBEAR_SERVICE, REDBEAR_WRITE, CHUNK, parseAuroraName, chunks} from './protocol.js';

export const bleSupported = () => typeof navigator !== 'undefined' && !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
export const bleAllowed = () => typeof window === 'undefined' || window.isSecureContext !== false;   // https ou localhost

const sleep = ms => new Promise(r => setTimeout(r, ms));

// protocol : 'aurora' | 'moon'. Ouvre le sélecteur du navigateur (doit suivre un geste de l'utilisateur).
export async function connectBoard(protocol, {onDisconnect} = {}) {
  const moon = protocol === 'moon';
  const device = await navigator.bluetooth.requestDevice(moon
    ? {filters: [{namePrefix: 'MoonBoard'}, {namePrefix: 'Moonboard'}], optionalServices: [NUS_SERVICE, REDBEAR_SERVICE]}
    : {filters: [{services: [AURORA_SERVICE]}], optionalServices: [NUS_SERVICE]});
  const server = await device.gatt.connect();
  let ch = null;
  for (const [svc, chr] of moon ? [[NUS_SERVICE, NUS_RX], [REDBEAR_SERVICE, REDBEAR_WRITE]] : [[NUS_SERVICE, NUS_RX]]) {
    try { ch = await (await server.getPrimaryService(svc)).getCharacteristic(chr); break; } catch { /* service suivant */ }
  }
  if (!ch) { device.gatt.disconnect(); throw new Error('service LED introuvable sur ce boîtier'); }

  const info = moon ? {display: device.name || 'MoonBoard', serial: null, api: null, bare: false} : parseAuroraName(device.name || '');
  // Écriture sans accusé si le boîtier l'annonce ; sinon (ou boîtier Kilter « nu », sans #série@API) avec accusé,
  // 100 ms entre paquets comme l'appli officielle. Repli automatique si l'écriture sans accusé échoue.
  let withResponse = !ch.properties.writeWithoutResponse || info.bare;
  const writeChunk = async c => {
    if (!withResponse) {
      try { await ch.writeValueWithoutResponse(c); return; } catch { withResponse = true; }
    }
    await (ch.writeValueWithResponse ? ch.writeValueWithResponse(c) : ch.writeValue(c));
    if (info.bare) await sleep(100);
  };

  let busy = false, pending = null, closed = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (pending && !closed) {
        const {bytes, done} = pending; pending = null;
        try { for (const c of chunks(bytes, CHUNK)) await writeChunk(c); done.resolve(); }
        catch (err) { done.reject(err); }
      }
    } finally { busy = false; }
  };
  const conn = {
    name: device.name || '', info, protocol,
    get connected() { return !closed && device.gatt.connected; },
    // envoie bytes ; un envoi plus récent remplace celui qui attend encore
    send(bytes) {
      if (pending) pending.done.resolve();
      let done; const p = new Promise((resolve, reject) => { done = {resolve, reject}; });
      pending = {bytes, done}; pump();
      return p;
    },
    disconnect() { closed = true; pending = null; try { device.gatt.disconnect(); } catch { /* déjà fermé */ } },
  };
  device.addEventListener('gattserverdisconnected', () => { closed = true; if (onDisconnect) onDisconnect(conn); });
  return conn;
}
