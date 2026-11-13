// Module polish2 (main) : batterie de la manette affichée dans la barre du haut.
// Windows uniquement. Toutes les 30 s : XInput d'abord (manette sans fil / filaire), puis DualSense en USB
// via node-hid. Envoie 'x:polish2:battery' au renderer : { level: 0..100 | null, charging, wired }.
'use strict';

const INTERVAL = 30000;
const SONY = 0x054c, DUALSENSE = 0x0ce6;
// XInput ne donne que 4 niveaux : valeurs indicatives en pourcentage
const XI_LEVEL = [5, 10, 50, 100];

function readXInput(ctx) {
  const native = ctx.winNative?.();
  if (!native || typeof native.xinputBattery !== 'function') return null;
  for (let i = 0; i < 4; i++) {
    const b = native.xinputBattery(i);
    if (!b) continue;
    if (b.type === 1) return { level: null, charging: false, wired: true };
    return { level: XI_LEVEL[b.level] ?? null, charging: false, wired: false };
  }
  return null;
}

// DualSense USB : rapport d'entrée 0x01, octet 53 = niveau (bas 4 bits) et charge (haut 4 bits)
function readDualSense(log) {
  let HID;
  try { HID = require('node-hid'); } catch { return null; }
  let infos;
  try { infos = HID.devices().filter((d) => d.vendorId === SONY && d.productId === DUALSENSE); } catch { return null; }
  // Préfère l'interface « gamepad » (usage page 1, usage 5) quand Windows la fournit
  infos.sort((a, b) => (b.usage === 5 ? 1 : 0) - (a.usage === 5 ? 1 : 0));
  for (const info of infos) {
    let dev = null;
    try {
      dev = new HID.HID(info.path);
      for (let tries = 0; tries < 6; tries++) {
        const data = dev.readTimeout(400);
        if (!data || data.length < 54 || data[0] !== 0x01) continue;
        const b = data[53];
        return {
          level: Math.min(100, (b & 0x0f) * 10 + 5),
          charging: (b >> 4) === 1,
          wired: false,
        };
      }
    } catch (e) {
      log?.(`polish2 : DualSense illisible (${e.message})`);
    } finally {
      try { dev?.close(); } catch { /* déjà fermé */ }
    }
  }
  return null;
}

function init(ctx) {
  if (process.platform !== 'win32') return; // rien hors Windows
  const poll = () => {
    let r = null;
    try { r = readXInput(ctx); } catch { r = null; }
    if (!r) { try { r = readDualSense(ctx.log); } catch { r = null; } }
    ctx.send('x:polish2:battery', r || { level: null, charging: false, wired: false });
  };
  const t = setInterval(poll, INTERVAL);
  t.unref?.();
  setTimeout(poll, 4000).unref?.();
}

module.exports = { init };
