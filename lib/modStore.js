const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const MODS_FILE = path.join(DATA_DIR, 'installed-mods.json');

function loadMods() {
  if (!fs.existsSync(MODS_FILE)) return [];
  return JSON.parse(fs.readFileSync(MODS_FILE, 'utf-8'));
}

function saveMods(mods) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MODS_FILE, JSON.stringify(mods, null, 2));
}

function addMod(mod) {
  const mods = loadMods();
  mods.push(mod);
  saveMods(mods);
  return mod;
}

function removeMod(modId) {
  const mods = loadMods();
  const idx = mods.findIndex((m) => m.id === modId);
  if (idx === -1) throw new Error(`Unknown mod: ${modId}`);
  const [removed] = mods.splice(idx, 1);
  saveMods(mods);
  return removed;
}

function getMod(modId) {
  const mod = loadMods().find((m) => m.id === modId);
  if (!mod) throw new Error(`Unknown mod: ${modId}`);
  // Mods registered before activation existed are treated as active.
  if (mod.active === undefined) mod.active = true;
  return mod;
}

function updateMod(modId, changes) {
  const mods = loadMods();
  const idx = mods.findIndex((m) => m.id === modId);
  if (idx === -1) throw new Error(`Unknown mod: ${modId}`);
  mods[idx] = { ...mods[idx], ...changes };
  saveMods(mods);
  return mods[idx];
}

// Whether the user wants a mod in use. For most games that means its files are
// in the game folder (active). For GTA V / RDR2 it means it's in the modded
// set (enabled); its files are only in the folder while modded mode is on.
function isWanted(mod) {
  return (mod.enabled !== undefined ? mod.enabled : mod.active) !== false;
}

module.exports = { loadMods, saveMods, addMod, removeMod, getMod, updateMod, isWanted };
