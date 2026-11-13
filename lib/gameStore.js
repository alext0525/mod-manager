const fs = require('fs');
const path = require('path');
const { HOME, DATA_DIR } = require('./paths');
const { readJson, writeJson } = require('./jsonFile');

const GAMES_FILE = path.join(DATA_DIR, 'games.json');

function loadGames() {
  return readJson(GAMES_FILE, []).map(normalize);
}

function saveGames(games) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Derived folders are dropped so they can't go stale on disk (see normalize).
  const stored = games.map(({ zipsPath, unzippedPath, ...rest }) => rest);
  writeJson(GAMES_FILE, stored);
}

function normalize(game) {
  return {
    strategy: 'paks',
    ...game,
    // `paksPath` was the original field name, from when Ready or Not was the
    // only game. Kept readable for anyone who opens games.json.
    modsPath: game.modsPath || game.paksPath,
    // Always derived from HOME rather than trusted from games.json: the stored
    // absolute paths go stale when Documents moves (e.g. OneDrive backup off).
    zipsPath: path.join(HOME, game.id, 'zips'),
    unzippedPath: path.join(HOME, game.id, 'unzipped'),
  };
}

function getGame(gameId) {
  const game = loadGames().find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return normalize(game);
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// `extra` carries catalog fields (catalogId, steamAppId, buildId) for games
// the app detected itself.
function addGame({ id, name, modsPath, strategy = 'paks', ...extra }) {
  const games = loadGames();
  const gameId = id || slugify(name);
  if (games.some((g) => g.id === gameId)) {
    throw new Error(`"${name}" has already been added.`);
  }
  const game = normalize({ id: gameId, name, strategy, modsPath, ...extra });
  fs.mkdirSync(game.zipsPath, { recursive: true });
  fs.mkdirSync(game.unzippedPath, { recursive: true });

  // zips/ and unzipped/ are derived on load, so they aren't stored.
  games.push({ id: gameId, name, strategy, modsPath, ...extra });
  saveGames(games);
  return game;
}

function updateGame(gameId, changes) {
  const games = loadGames();
  const idx = games.findIndex((g) => g.id === gameId);
  if (idx === -1) throw new Error(`Unknown game: ${gameId}`);
  games[idx] = { ...games[idx], ...changes };
  saveGames(games);
  return games[idx];
}

module.exports = { loadGames, saveGames, getGame, addGame, updateGame };
