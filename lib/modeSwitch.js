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

module.exports = { isSwitchable, checkFolder, trustFiles, setMode, launch };
