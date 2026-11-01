const fs = require('fs');
const path = require('path');

const steam = require('./steam');
const gameStore = require('./gameStore');
const modStore = require('./modStore');
const { KNOWN_GAMES, getKnownGame } = require('./gameCatalog');

// The catalog entry behind a saved game. Games added before the catalog existed
// have no catalogId, but their id was made from the same name (e.g. "ready-or-not").
function knownGameFor(game) {
  return getKnownGame(game.catalogId || game.id);
}

function locate(known) {
  const app = steam.findApp(known.steamAppId);
  if (!app) return null;
  const modsPath = known.modsPath(app);
  return { ...app, modsPath: modsPath && fs.existsSync(modsPath) ? modsPath : null };
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

// Every known game installed on this PC, flagged if it's already been added.
function detectInstalled() {
  const saved = gameStore.loadGames();
  const results = [];
  for (const known of KNOWN_GAMES) {
    const found = locate(known);
    if (!found) continue;
    results.push({
      catalogId: known.id,
      name: known.name,
      modsPath: found.modsPath,
      added: saved.some((g) => knownGameFor(g) === known),
    });
  }
  return results;
}

function addDetected(catalogId) {
  const known = getKnownGame(catalogId);
  if (!known) throw new Error(`Unknown game: ${catalogId}`);
  const found = locate(known);
  if (!found) throw new Error(`${known.name} isn't installed through Steam on this PC.`);
  if (!found.modsPath) {
    throw new Error(
      `Found ${known.name}, but its mods folder doesn't exist yet. Launch the game once, then try again.`
    );
  }
  return gameStore.addGame({
    id: known.id,
    name: known.name,
    modsPath: found.modsPath,
    strategy: known.strategy,
    catalogId: known.id,
    steamAppId: known.steamAppId,
    buildId: found.buildId,
  });
}

// Run at startup: links older game entries to the catalog, re-finds a mods
// folder that has moved (Steam library moved, Documents moved...) and records
// the installed build the first time, so later game updates can be spotted.
function refreshKnownGames() {
  const games = gameStore.loadGames();
  let changed = false;
  for (const game of games) {
    const known = knownGameFor(game);
    if (!known) continue;
    const found = locate(known);
    if (!found) continue;

    const updates = {};
    if (!game.catalogId) updates.catalogId = known.id;
    if (!game.steamAppId) updates.steamAppId = known.steamAppId;
    if (!game.buildId && found.buildId) updates.buildId = found.buildId;
    // Only replace a stored folder that's gone, so a deliberate custom folder stays.
    if (found.modsPath && !fs.existsSync(game.modsPath)) updates.modsPath = found.modsPath;

    if (Object.keys(updates).length) {
      Object.assign(game, updates);
      changed = true;
    }
  }
  if (changed) gameStore.saveGames(games);
}

function currentBuildId(game) {
  const known = knownGameFor(game);
  if (!known) return null;
  const found = steam.findApp(known.steamAppId);
  return found ? found.buildId : null;
}

// Adds what's only known at runtime: the installed build, and whether the game
// has updated since the user last confirmed their mods still work.
function withLiveInfo(game) {
  const buildId = currentBuildId(game);
  return {
    ...game,
    currentBuildId: buildId,
    updatedSinceLastCheck: Boolean(game.buildId && buildId && game.buildId !== buildId),
  };
}

// The user has seen the "game updated" warning: take the new build as the
// baseline and stop flagging the mods that are currently in the game.
function acknowledgeUpdate(gameId) {
  const game = gameStore.getGame(gameId);
  const buildId = currentBuildId(game);
  if (!buildId) return;
  gameStore.updateGame(gameId, { buildId });
  for (const mod of modStore.loadMods()) {
    if (mod.gameId === gameId && mod.active !== false) {
      modStore.updateMod(mod.id, { installedOnBuild: buildId });
    }
  }
}

function findDir(root, test, maxDepth, depth = 0) {
  if (depth > maxDepth) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (test(full)) return full;
  }
  for (const entry of entries) {
    // Unreal's shared Engine folder never holds a game's mods.
    if (!entry.isDirectory() || entry.name.toLowerCase() === 'engine') continue;
    const hit = findDir(path.join(root, entry.name), test, maxDepth, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// For a game the app doesn't know: given its install folder, guess where mods
// go and how. Returns null when nothing recognisable is there.
function guessFromFolder(dir) {
  for (const known of KNOWN_GAMES) {
    const found = locate(known);
    if (found && samePath(found.installDir, dir)) {
      return { catalogId: known.id, name: known.name, strategy: known.strategy, modsPath: found.modsPath };
    }
  }

  const name = path.basename(dir);
  const isPaks = (p) =>
    path.basename(p).toLowerCase() === 'paks' &&
    path.basename(path.dirname(p)).toLowerCase() === 'content';

  if (isPaks(dir)) return { name: path.basename(path.resolve(dir, '..', '..')), strategy: 'paks', modsPath: dir };

  const paks = findDir(dir, isPaks, 3);
  if (paks) return { name, strategy: 'paks', modsPath: paks, reason: 'Unreal Engine game' };

  const bepinex = path.join(dir, 'BepInEx', 'plugins');
  if (fs.existsSync(bepinex)) return { name, strategy: 'loose', modsPath: bepinex, reason: 'BepInEx mod loader' };

  const mods = findDir(dir, (p) => path.basename(p).toLowerCase() === 'mods', 2);
  if (mods) return { name, strategy: 'loose', modsPath: mods, reason: 'has a Mods folder' };

  return null;
}

module.exports = {
  detectInstalled,
  addDetected,
  refreshKnownGames,
  withLiveInfo,
  currentBuildId,
  acknowledgeUpdate,
  guessFromFolder,
  knownGameFor,
};
