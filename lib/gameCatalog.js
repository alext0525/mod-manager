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

// BeamNG lets its user folder be moved through `UserPath` in startup.ini next
// to the exe (empty means the default under LOCALAPPDATA). Commented-out
// examples in that file start with ';' and are skipped by the ^\s* anchor.
function beamngUserFolder(installDir) {
  try {
    const ini = fs.readFileSync(path.join(installDir, 'startup.ini'), 'utf-8');
    const match = ini.match(/^\s*UserPath\s*=\s*(.*?)\s*$/im);
    if (match && match[1]) return path.resolve(installDir, match[1]);
  } catch {
    // no startup.ini — default location
  }
  return null;
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
    // creates it on first launch. `current` points at the active version's folder.
    modsPath: ({ installDir }) => {
      const custom = beamngUserFolder(installDir);
      return firstExisting(
        custom
          ? [path.join(custom, 'current', 'mods'), path.join(custom, 'mods')]
          : [
              path.join(localAppData(), 'BeamNG', 'BeamNG.drive', 'current', 'mods'),
              path.join(localAppData(), 'BeamNG.drive', 'current', 'mods'),
            ]
      );
    },
  },

  // Rockstar games: online modes ban for modified files, so mods only sit in
  // the game folder while the game is switched to modded (story) mode — see
  // lib/modeSwitch.js. Mods go in the install folder itself (Script Hook,
  // .asi loaders, scripts\, mods\, lml\).
  {
    id: 'gta-v-enhanced',
    name: 'GTA V Enhanced',
    steamAppId: '3240220',
    strategy: 'rockstar',
    modsPath: ({ installDir }) => installDir,
    processes: ['GTA5_Enhanced.exe', 'GTA5_Enhanced_BE.exe', 'PlayGTAV.exe'],
    // With BattlEye off the game can't reach GTA Online; -scOfflineOnly keeps
    // Social Club offline too. Two locks, so a mis-click can't go online modded.
    moddedLaunchArgs: ['-nobattleye', '-scOfflineOnly'],
    moddedNote:
      'Modded mode starts the game with -nobattleye -scOfflineOnly, so it can\'t connect to GTA Online.',
  },
  {
    id: 'gta-v-legacy',
    name: 'GTA V Legacy',
    steamAppId: '271590',
    strategy: 'rockstar',
    modsPath: ({ installDir }) => installDir,
    processes: ['GTA5.exe', 'GTA5_BE.exe', 'PlayGTAV.exe'],
    moddedLaunchArgs: ['-nobattleye', '-scOfflineOnly'],
    moddedNote:
      'Modded mode starts the game with -nobattleye -scOfflineOnly, so it can\'t connect to GTA Online.',
  },
  {
    id: 'rdr2',
    name: 'Red Dead Redemption 2',
    steamAppId: '1174180',
    strategy: 'rockstar',
    modsPath: ({ installDir }) => installDir,
    processes: ['RDR2.exe', 'PlayRDR2.exe'],
    moddedLaunchArgs: [],
    moddedNote:
      'RDR2 has no offline-only switch: in modded mode, pick Story Mode from the menu and never ' +
      'Red Dead Online. Use "Play online" to remove the mods first.',
  },
];

function getKnownGame(id) {
  return KNOWN_GAMES.find((g) => g.id === id) || null;
}

// Games this app deliberately won't manage. Copying files is the wrong tool for
// them, and getting it wrong costs more than a crash.
const UNSUPPORTED_GAMES = {
  2000950:
    'Not supported: Call of Duty\'s anti-cheat can ban accounts for modified game files.',
};

function unsupportedReason(appId) {
  return UNSUPPORTED_GAMES[appId] || null;
}

// Steam installs some non-games (runtimes, redistributables, VR) that show up
// as apps but have nothing to mod.
function isSteamTool(app) {
  return (
    app.appId === '228980' ||
    /steamworks|redistributable|proton|steam linux runtime|steamvr/i.test(app.name)
  );
}

module.exports = { KNOWN_GAMES, getKnownGame, unsupportedReason, isSteamTool };
