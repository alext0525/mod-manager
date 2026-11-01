const fs = require('fs');
const path = require('path');
const os = require('os');

// Games the app knows how to set up by itself. Everything here is fixed per
// game, so nothing needs to be asked of the user — only where Steam put it.

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

function firstExisting(candidates) {
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const KNOWN_GAMES = [
  {
    id: 'ready-or-not',
    name: 'Ready or Not',
    steamAppId: '1144200',
    strategy: 'paks',
    modsPath: ({ installDir }) => path.join(installDir, 'ReadyOrNot', 'Content', 'Paks'),
    // Custom maps ship a pre-built WorldGen save. Without it the game spends
    // several minutes generating one the first time the map loads.
    sideFiles: [
      {
        label: 'WorldGen save',
        pattern: /worldgen.*\.sav$/i,
        dir: () => path.join(localAppData(), 'ReadyOrNot', 'Saved', 'SaveGames'),
      },
    ],
  },
  {
    id: 'beamng-drive',
    name: 'BeamNG.drive',
    steamAppId: '284160',
    strategy: 'beamng',
    // BeamNG reads mods from its user folder, not the install folder. The game
    // creates it on first launch.
    modsPath: () =>
      firstExisting([
        path.join(localAppData(), 'BeamNG', 'BeamNG.drive', 'current', 'mods'),
        path.join(localAppData(), 'BeamNG.drive', 'current', 'mods'),
      ]),
  },
];

function getKnownGame(id) {
  return KNOWN_GAMES.find((g) => g.id === id) || null;
}

module.exports = { KNOWN_GAMES, getKnownGame };
