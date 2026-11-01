const fs = require('fs');
const path = require('path');

// What a mod needs in order to work, and what it provides to others, judged
// from its files (paths relative to the game folder). Only GTA V / RDR2 mods
// have requirements the app can check this way; Ready or Not's UE4SS mods are
// refused outright when UE4SS is missing (strategies/paks.js).

const PROVIDERS = [
  { name: 'Script Hook V', test: (f) => /(^|[\\/])scripthookv\.dll$/i.test(f) },
  { name: 'Script Hook V .NET', test: (f) => /(^|[\\/])scripthookvdotnet\.asi$/i.test(f) },
  { name: 'Script Hook RDR2', test: (f) => /(^|[\\/])scripthookrdr2\.dll$/i.test(f) },
  // An ASI loader is a DLL the game loads by name from its own folder.
  { name: 'an ASI loader', test: (f) => /^(dinput8|version|dsound|winmm)\.dll$/i.test(f) },
  { name: 'OpenIV.asi', test: (f) => /^openiv\.asi$/i.test(f) },
];

function providesOf(files) {
  return PROVIDERS.filter((p) => files.some(p.test)).map((p) => p.name);
}

// .asi plugins that don't run on Script Hook.
const STANDALONE_ASI = /^(openiv|scripthookvdotnet)\.asi$/i;

function requiresOf(files, game) {
  if (game.strategy !== 'rockstar') return [];
  const isRdr2 = game.catalogId === 'rdr2';
  const needs = new Set();
  const rootAsi = files.filter((f) => !/[\\/]/.test(f) && /\.asi$/i.test(f));
  const dotnetScripts = files.some((f) => /^scripts[\\/].+\.(dll|cs|vb)$/i.test(f));

  if (rootAsi.length) needs.add('an ASI loader');
  if (rootAsi.some((f) => !STANDALONE_ASI.test(f))) needs.add(isRdr2 ? 'Script Hook RDR2' : 'Script Hook V');
  if (!isRdr2 && dotnetScripts) {
    needs.add('Script Hook V .NET');
    needs.add('Script Hook V');
    needs.add('an ASI loader');
  }
  if (!isRdr2 && files.some((f) => /^mods[\\/]/i.test(f))) {
    needs.add('OpenIV.asi');
    needs.add('an ASI loader');
  }
  // A mod never needs what it brings itself (Script Hook V ships its own
  // ASI loader, for example).
  for (const provided of providesOf(files)) needs.delete(provided);
  return [...needs];
}

function listFiles(dir, base = dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

// The files a mod would put in the game folder, relative to it.
function filesOfMod(mod) {
  const placements = mod.placements || [{ from: '' }];
  return placements
    .filter((p) => !p.to)
    .flatMap((p) => listFiles(path.join(mod.unzippedPath, p.from || '')));
}

// Everything already available to a game's mods: what the other mods in use
// provide, plus anything in the game folder itself (installed by hand).
function availableFor(game, mods, exceptModId) {
  const available = new Set();
  for (const mod of mods) {
    if (mod.id === exceptModId || mod.gameId !== game.id) continue;
    if ((mod.enabled !== undefined ? mod.enabled : mod.active) === false) continue;
    for (const name of mod.provides || providesOf(filesOfMod(mod))) available.add(name);
  }
  let rootFiles = [];
  try {
    rootFiles = fs.readdirSync(game.modsPath);
  } catch {
    // folder missing — nothing extra available
  }
  for (const name of providesOf(rootFiles)) available.add(name);
  return available;
}

function missingFor(mod, game, mods) {
  const requires = mod.requires || [];
  if (!requires.length) return [];
  const available = availableFor(game, mods, mod.id);
  return requires.filter((r) => !available.has(r));
}

module.exports = { providesOf, requiresOf, filesOfMod, availableFor, missingFor };
