const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const gameStore = require('./gameStore');
const modStore = require('./modStore');
const modInstaller = require('./modInstaller');
const steam = require('./steam');
const { getStrategy } = require('./strategies');
const { isModMarker } = require('./strategies/rockstar');
const { getKnownGame } = require('./gameCatalog');
const { isAnyRunning } = require('./gameRunning');

// Modded / clean switching for games whose online mode bans modified files
// (GTA V, RDR2). In clean mode none of the app's mod files are in the game
// folder; modded mode puts every mod in the modded set there and launches the
// game in a way that keeps it offline where the game allows it.

function isSwitchable(game) {
  return Boolean(getStrategy(game.strategy).switchable);
}

// Lists anything in the root folder that isn't part of the clean game.
// `isMod` separates certain mods from unknown files (often new game files
// from an update, which the user can mark as trusted).
function checkFolder(game) {
  const snapshot = new Set((game.cleanSnapshot || []).map((n) => n.toLowerCase()));
  const unexpected = fs
    .readdirSync(game.modsPath)
    // Script Hook and ASI loaders leave .log files behind; a log can't load
    // anything, so it doesn't make the folder unsafe.
    .filter((name) => !/\.log$/i.test(name))
    .filter((name) => isModMarker(name) || (snapshot.size > 0 && !snapshot.has(name.toLowerCase())))
    .map((name) => ({ name, isMod: isModMarker(name) }));
  return { clean: unexpected.length === 0, unexpected };
}

// Adds files that appeared with a game update to the clean snapshot. Names
// that look like mods are never trusted.
function trustFiles(gameId, names) {
  const game = gameStore.getGame(gameId);
  const trusted = names.filter((n) => !isModMarker(n));
  const snapshot = new Set([...(game.cleanSnapshot || []), ...trusted]);
  gameStore.updateGame(gameId, { cleanSnapshot: [...snapshot] });
  return trusted;
}

function setMode(gameId, mode) {
  const game = gameStore.getGame(gameId);
  if (!isSwitchable(game)) throw new Error(`${game.name} doesn't have modded/clean modes.`);
  modInstaller.assertGameClosed(game);

  const mods = modStore.loadMods().filter((m) => m.gameId === gameId);
  const errors = [];
  for (const m of mods) {
    try {
      if (mode === 'modded' && m.enabled !== false && m.active === false) modInstaller.activateMod(m.id);
      if (mode === 'clean' && m.active !== false) modInstaller.deactivateMod(m.id);
    } catch (err) {
      errors.push(`${m.name}: ${err.message}`);
    }
  }
  gameStore.updateGame(gameId, { mode });
  return { errors };
}

function steamExe() {
  const root = steam.findSteamRoot();
  const exe = root && path.join(root, 'steam.exe');
  if (!exe || !fs.existsSync(exe)) throw new Error("Couldn't find Steam on this PC to start the game.");
  return exe;
}

// MOD_MANAGER_NO_LAUNCH=1 records the command instead of starting the game, for
// testing the switch against a stand-in game folder.
function startThroughSteam(appId, args) {
  const command = [steamExe(), '-applaunch', appId, ...args];
  if (process.env.MOD_MANAGER_NO_LAUNCH) {
    lastLaunch = command;
    return;
  }
  spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore' }).unref();
}
let lastLaunch = null;

// Switches the game to `mode` and starts it. Online is refused unless the
// folder checks clean afterwards; modded is refused if any mod failed to go in.
function launch(gameId, mode) {
  const game = gameStore.getGame(gameId);
  const known = getKnownGame(game.catalogId);
  if (!known || !game.steamAppId) throw new Error(`${game.name} can't be started from here.`);

  if (mode === 'online') {
    const { errors } = setMode(gameId, 'clean');
    const check = checkFolder(gameStore.getGame(gameId));
    if (errors.length || !check.clean) return { launched: false, errors, ...check };
    startThroughSteam(game.steamAppId, []);
    return { launched: true, errors: [], command: lastLaunch, ...check };
  }

  const { errors } = setMode(gameId, 'modded');
  if (errors.length) return { launched: false, errors };
  startThroughSteam(game.steamAppId, known.moddedLaunchArgs || []);
  return { launched: true, errors: [], command: lastLaunch };
}

// Mods should only be in the game folder while a modded session is running:
// if they stayed there afterwards, starting the game from Steam itself would
// run it with mod files present and the anti-cheat on. So after "Play modded"
// the game is watched, and the mods are taken out as soon as it has closed.
const watchers = new Map();
const POLL_MS = Number(process.env.MOD_MANAGER_WATCH_POLL_MS) || 5000;
const START_TIMEOUT_MS = Number(process.env.MOD_MANAGER_WATCH_START_MS) || 5 * 60 * 1000;

function isWatching() {
  return watchers.size > 0;
}

function stopWatching(gameId) {
  clearInterval(watchers.get(gameId));
  watchers.delete(gameId);
}

// `alreadyRunning`: the game was found running (app restarted mid-session).
// `onCleaned({ gameId, errors, started })` is called once the mods are out.
function watchModdedSession(gameId, onCleaned, alreadyRunning = false) {
  stopWatching(gameId);
  const known = getKnownGame(gameStore.getGame(gameId).catalogId);
  const processes = (known && known.processes) || [];
  const startedAt = Date.now();
  let seen = alreadyRunning;
  let misses = 0;

  const timer = setInterval(() => {
    try {
      // Switched back by hand in the meantime — nothing left to do.
      if (gameStore.getGame(gameId).mode !== 'modded') return stopWatching(gameId);

      if (isAnyRunning(processes)) {
        seen = true;
        misses = 0;
        return;
      }
      // The launcher exits before the game's own exe appears, so one quiet
      // check isn't proof the game has closed; two in a row is.
      if (seen) misses += 1;
      const neverStarted = !seen && Date.now() - startedAt > START_TIMEOUT_MS;
      if (misses < 2 && !neverStarted) return;

      stopWatching(gameId);
      const { errors } = setMode(gameId, 'clean');
      onCleaned({ gameId, errors, started: seen });
    } catch (err) {
      stopWatching(gameId);
      onCleaned({ gameId, errors: [err.message], started: seen });
    }
  }, POLL_MS);
  watchers.set(gameId, timer);
}

// At startup: a game left in modded mode (the app was closed during a
// session) is cleaned now, or watched if it's still running.
function recoverModdedGames(onCleaned) {
  for (const game of gameStore.loadGames()) {
    if (!isSwitchable(game) || game.mode !== 'modded') continue;
    const known = getKnownGame(game.catalogId);
    if (isAnyRunning((known && known.processes) || [])) {
      watchModdedSession(game.id, onCleaned, true);
      continue;
    }
    try {
      const { errors } = setMode(game.id, 'clean');
      onCleaned({ gameId: game.id, errors, started: true, atStartup: true });
    } catch (err) {
      onCleaned({ gameId: game.id, errors: [err.message], started: true, atStartup: true });
    }
  }
}

module.exports = {
  isSwitchable,
  checkFolder,
  trustFiles,
  setMode,
  launch,
  watchModdedSession,
  recoverModdedGames,
  isWatching,
};
