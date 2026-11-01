const fs = require('fs');
const path = require('path');

const steam = require('./steam');
const gameStore = require('./gameStore');
const modStore = require('./modStore');
const { KNOWN_GAMES, getKnownGame, unsupportedReason, isSteamTool } = require('./gameCatalog');

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

function steamAppIdOf(game) {
  const known = knownGameFor(game);
  return game.steamAppId || (known && known.steamAppId) || null;
}

const STATUS_ORDER = { known: 0, guessed: 1, unknown: 2, unsupported: 3 };

// Every game in every Steam library, each with how sure the app is about it:
//   known       — in the catalog; folder and install type are certain
//   guessed     — recognised from the folder layout; the user should check it
//   unknown     — nothing recognisable; the user sets it up by hand
//   unsupported — deliberately not handled, with the reason
function scanSteam() {
  const savedAppIds = new Set(gameStore.loadGames().map(steamAppIdOf).filter(Boolean));

  return steam
    .listInstalledApps()
    .filter((app) => !isSteamTool(app))
    .map((app) => {
      const base = {
        steamAppId: app.appId,
        name: app.name,
        installDir: app.installDir,
        added: savedAppIds.has(app.appId),
      };

      const known = KNOWN_GAMES.find((k) => k.steamAppId === app.appId);
      if (known) {
        const modsPath = known.modsPath(app);
        return {
          ...base,
          status: 'known',
          catalogId: known.id,
          name: known.name,
          strategy: known.strategy,
          modsPath: modsPath && fs.existsSync(modsPath) ? modsPath : null,
        };
      }

      const reason = unsupportedReason(app.appId);
      if (reason) return { ...base, status: 'unsupported', reason };

      const guess = guessLayout(app.installDir);
      if (guess) return { ...base, status: 'guessed', ...guess };

      return { ...base, status: 'unknown' };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}

// A game the catalog doesn't know, set up by the user (usually from a guess).
// Its Steam app id, when there is one, lets game updates be spotted too.
function addCustom({ name, modsPath, strategy, steamAppId }) {
  if (steamAppId && unsupportedReason(steamAppId)) throw new Error(unsupportedReason(steamAppId));
  const app = steamAppId ? steam.findApp(steamAppId) : null;
  return gameStore.addGame({
    name,
    modsPath,
    strategy,
    ...(app ? { steamAppId, buildId: app.buildId } : {}),
  });
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
  const appId = steamAppIdOf(game);
  if (!appId) return null;
  const found = steam.findApp(appId);
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

const isPaks = (p) =>
  path.basename(p).toLowerCase() === 'paks' &&
  path.basename(path.dirname(p)).toLowerCase() === 'content';

// Where mods probably go, judged only from the folder layout:
// { strategy, modsPath, reason } or null when nothing recognisable is there.
function guessLayout(dir) {
  if (isPaks(dir)) return { strategy: 'paks', modsPath: dir, reason: 'Unreal Engine game' };

  const paks = findDir(dir, isPaks, 3);
  if (paks) return { strategy: 'paks', modsPath: paks, reason: 'Unreal Engine game' };

  const bepinex = path.join(dir, 'BepInEx', 'plugins');
  if (fs.existsSync(bepinex)) return { strategy: 'loose', modsPath: bepinex, reason: 'BepInEx mod loader' };

  const mods = findDir(dir, (p) => path.basename(p).toLowerCase() === 'mods', 2);
  if (mods) return { strategy: 'loose', modsPath: mods, reason: 'has a Mods folder' };

  return null;
}

// For a game picked by folder (e.g. one not on Steam). A Steam game's own
// folder is matched first so known and unsupported games are recognised.
function guessFromFolder(dir) {
  const app = steam.listInstalledApps().find((a) => samePath(a.installDir, dir));
  if (app) {
    const known = KNOWN_GAMES.find((k) => k.steamAppId === app.appId);
    if (known) {
      const modsPath = known.modsPath(app);
      return { catalogId: known.id, name: known.name, strategy: known.strategy, modsPath };
    }
    const reason = unsupportedReason(app.appId);
    if (reason) return { name: app.name, unsupported: reason };
  }

  const name = app ? app.name : isPaks(dir) ? path.basename(path.resolve(dir, '..', '..')) : path.basename(dir);
  const guess = guessLayout(dir);
  return guess ? { name, steamAppId: app && app.appId, ...guess } : null;
}

module.exports = {
  scanSteam,
  addDetected,
  addCustom,
  refreshKnownGames,
  withLiveInfo,
  currentBuildId,
  acknowledgeUpdate,
  guessFromFolder,
  knownGameFor,
};
