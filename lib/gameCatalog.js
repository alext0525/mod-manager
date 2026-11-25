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

// Script Hook, ASI loaders and .NET scripts write their .log files into the
// game folder (GTA V, RDR2).
function rootLogs(modsPath) {
  let logs = [];
  try {
    logs = fs
      .readdirSync(modsPath)
      .filter((n) => /\.log$/i.test(n))
      .map((n) => path.join(modsPath, n));
  } catch {
    // folder missing
  }
  return { crashDirs: [], logs };
}

function documents() {
  return path.join(os.homedir(), 'Documents');
}

function savedGames() {
  return path.join(os.homedir(), 'Saved Games');
}

// The newest `count` files in `dir` whose names match `pattern`.
function newestFiles(dir, pattern, count) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => pattern.test(n))
      .map((n) => path.join(dir, n))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, count);
  } catch {
    return [];
  }
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
    // The game keeps its .pak files open while running.
    processes: ['ReadyOrNot.exe', 'ReadyOrNotSteam-Win64-Shipping.exe', 'ReadyOrNot-Win64-Shipping.exe'],
    // Where UE4SS (loader + script mods) goes, worked out from the Paks folder:
    // ReadyOrNot\Content\Paks -> ReadyOrNot\Binaries\Win64.
    ue4ssBinaries: (modsPath) => path.resolve(modsPath, '..', '..', 'Binaries', 'Win64'),
    // Unreal writes crash reports to Saved\Crashes (one folder per crash).
    diagnostics: (modsPath) => ({
      crashDirs: [path.join(localAppData(), 'ReadyOrNot', 'Saved', 'Crashes')],
      logs: [
        path.join(localAppData(), 'ReadyOrNot', 'Saved', 'Logs', 'ReadyOrNot.log'),
        path.resolve(modsPath, '..', '..', 'Binaries', 'Win64', 'ue4ss', 'UE4SS.log'),
      ],
    }),
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
    processes: ['BeamNG.drive.exe', 'BeamNG.drive.x64.exe'],
    // beamng.log sits in the version folder, next to mods\.
    diagnostics: (modsPath) => ({ crashDirs: [], logs: [path.resolve(modsPath, '..', 'beamng.log')] }),
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
    diagnostics: rootLogs,
    modsPath: ({ installDir }) => installDir,
    processes: ['GTA5_Enhanced.exe', 'GTA5_Enhanced_BE.exe', 'PlayGTAV.exe'],
    lml: true,
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
    diagnostics: rootLogs,
    modsPath: ({ installDir }) => installDir,
    processes: ['GTA5.exe', 'GTA5_BE.exe', 'PlayGTAV.exe'],
    lml: true,
    moddedLaunchArgs: ['-nobattleye', '-scOfflineOnly'],
    moddedNote:
      'Modded mode starts the game with -nobattleye -scOfflineOnly, so it can\'t connect to GTA Online.',
  },
  {
    id: 'rdr2',
    name: 'Red Dead Redemption 2',
    steamAppId: '1174180',
    strategy: 'rockstar',
    diagnostics: rootLogs,
    modsPath: ({ installDir }) => installDir,
    processes: ['RDR2.exe', 'PlayRDR2.exe'],
    // Lenny's Mod Loader asset mods go into lml\<mod> in the game folder.
    lml: true,
    moddedLaunchArgs: [],
    moddedNote:
      'RDR2 has no offline-only switch: in modded mode, pick Story Mode from the menu and never ' +
      'Red Dead Online. Use "Play online" to remove the mods first.',
  },

  // Cars and tracks go to content\cars and content\tracks, apps to apps\python
  // or apps\lua, Custom Shaders Patch config to extension\ — all in the
  // install folder (strategies/assettocorsa.js).
  {
    id: 'assetto-corsa',
    name: 'Assetto Corsa',
    steamAppId: '244210',
    strategy: 'assettocorsa',
    modsPath: ({ installDir }) => installDir,
    processes: ['AssettoCorsa.exe', 'acs.exe', 'acs_x86.exe'],
    diagnostics: () => ({ crashDirs: [], logs: [path.join(documents(), 'Assetto Corsa', 'logs', 'log.txt')] }),
  },
  // Car mods are .kspkg packages in Saved Games\ACE\mods (EVO's own user
  // folder, created by the game on first launch).
  {
    id: 'assetto-corsa-evo',
    name: 'Assetto Corsa EVO',
    steamAppId: '3058630',
    strategy: 'kspkg',
    modsPath: () => {
      const ace = path.join(savedGames(), 'ACE');
      if (!fs.existsSync(ace)) return null;
      const mods = path.join(ace, 'mods');
      fs.mkdirSync(mods, { recursive: true });
      return mods;
    },
    processes: ['AssettoCorsaEVO.exe'],
    diagnostics: () => ({ crashDirs: [], logs: newestFiles(path.join(savedGames(), 'ACE', 'Logs'), /\.txt$/i, 2) }),
  },
  // Chrome Engine: mod paks are loaded from ph_ft\source as data2.pak ...
  // data7.pak (data0/data1 are the game's own) — strategies/chromepaks.js.
  {
    id: 'dying-light-the-beast',
    name: 'Dying Light: The Beast',
    steamAppId: '3008130',
    strategy: 'chromepaks',
    modsPath: ({ installDir }) => path.join(installDir, 'ph_ft', 'source'),
    processes: ['DyingLightGame_TheBeast_x64_rwdi.exe'],
    diagnostics: () => {
      const logs = path.join(documents(), 'Dying Light The Beast', 'out', 'logs');
      return {
        crashDirs: [],
        crashFiles: newestFiles(logs, /^crash_.*\.log$/i, 1),
        logs: newestFiles(logs, /\.(log|txt)$/i, 3),
      };
    },
  },
  // mod* folders go in <game>\mods, dlc* folders in <game>\dlc, bin\ merges
  // into <game>\bin — strategies/witcher3.js.
  {
    id: 'witcher-3',
    name: 'The Witcher 3: Wild Hunt',
    steamAppId: '292030',
    strategy: 'witcher3',
    modsPath: ({ installDir }) => installDir,
    processes: ['witcher3.exe'],
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
  2231380:
    'Not supported: Ghost Recon Breakpoint is always online with anti-cheat, so modified game ' +
    'files risk a ban.',
};

function unsupportedReason(appId) {
  return UNSUPPORTED_GAMES[appId] || null;
}

// Games whose mods are installed by something else, so there's nothing for
// this app to do.
const MODDED_ELSEWHERE = {
  667970:
    'Mods come from the Steam Workshop through VTOL VR Mod Loader (also on Steam): subscribe ' +
    'to them there and launch the game from the Mod Loader.',
  3018410: 'This is VTOL VR\'s mod loader. Its mods come from the Steam Workshop — nothing to install here.',
};

function moddedElsewhere(appId) {
  return MODDED_ELSEWHERE[appId] || null;
}

// Steam installs some non-games (runtimes, redistributables, VR) that show up
// as apps but have nothing to mod.
function isSteamTool(app) {
  return (
    app.appId === '228980' ||
    /steamworks|redistributable|proton|steam linux runtime|steamvr/i.test(app.name)
  );
}

module.exports = { KNOWN_GAMES, getKnownGame, unsupportedReason, moddedElsewhere, isSteamTool };
