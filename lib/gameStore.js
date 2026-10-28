const fs = require('fs');
const path = require('path');
const { HOME, DATA_DIR } = require('./paths');

const GAMES_FILE = path.join(DATA_DIR, 'games.json');

function loadGames() {
  if (!fs.existsSync(GAMES_FILE)) return [];
  return JSON.parse(fs.readFileSync(GAMES_FILE, 'utf-8')).map(normalize);
}

function saveGames(games) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));
}

function normalize(game) {
  return {
    strategy: 'paks',
    ...game,
    // `paksPath` was the original field name, from when Ready or Not was the
    // only game. Kept readable for anyone who opens games.json.
    modsPath: game.modsPath || game.paksPath,
  };
}

function getGame(gameId) {
  const game = loadGames().find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return normalize(game);
}

function addGame({ name, modsPath, strategy = 'paks' }) {
  const games = loadGames();
  const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (games.some((g) => g.id === id)) {
    throw new Error(`A game named "${name}" already exists.`);
  }
  const base = path.join(HOME, id);
  const zipsPath = path.join(base, 'zips');
  const unzippedPath = path.join(base, 'unzipped');
  fs.mkdirSync(zipsPath, { recursive: true });
  fs.mkdirSync(unzippedPath, { recursive: true });

  const game = { id, name, strategy, modsPath, zipsPath, unzippedPath };
  games.push(game);
  saveGames(games);
  return game;
}

module.exports = { loadGames, saveGames, getGame, addGame };
