const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Packaged builds live in a read-only folder, so keep mods and state in
// Documents\Mod Manager instead. Must be set before lib/ is loaded.
if (app.isPackaged && !process.env.MOD_MANAGER_HOME) {
  process.env.MOD_MANAGER_HOME = path.join(app.getPath('documents'), 'Mod Manager');
}

const { DATA_DIR } = require('./lib/paths');
const gameStore = require('./lib/gameStore');
const modStore = require('./lib/modStore');
const modInstaller = require('./lib/modInstaller');
const gameDetect = require('./lib/gameDetect');
const profileStore = require('./lib/profileStore');
const { getStrategy } = require('./lib/strategies');

const LOG_FILE = path.join(DATA_DIR, 'log.txt');
function log(message) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // logging must never take the app down
  }
}

// Like ipcMain.handle, but every failure is written to log.txt with its stack
// before the message goes back to the window.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log(`${channel} failed: ${err && err.stack ? err.stack : err}`);
      throw err;
    }
  });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

// Updates come from GitHub Releases. Only the installed (setup.exe) build can
// update itself; the portable exe and running from source skip this.
function checkForAppUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  const { autoUpdater } = require('electron-updater');
  // Errors only keep their first line: electron-updater appends the whole HTTP
  // response, headers and cookies included, which drowns the log.
  const firstLine = (msg) => String(msg && msg.stack ? msg.stack : msg).split('\n')[0];
  autoUpdater.logger = { info: log, warn: log, error: (msg) => log(firstLine(msg)), debug: () => {} };
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-ready', info.version);
  });
  autoUpdater.checkForUpdates().catch((err) => log(`update check failed: ${firstLine(err.message)}`));
}

app.whenReady().then(() => {
  try {
    gameDetect.refreshKnownGames();
  } catch (err) {
    log(`refreshing games failed: ${err.stack}`);
  }
  createWindow();
  checkForAppUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- Games ----------

handle('get-games', () =>
  gameStore
    .loadGames()
    .map((g) => ({ ...gameDetect.withLiveInfo(g), hint: getStrategy(g.strategy).hint }))
);

handle('detect-games', () => gameDetect.scanSteam());

handle('add-detected-game', (catalogId) => gameDetect.addDetected(catalogId));

handle('guess-game-folder', (folder) => gameDetect.guessFromFolder(folder));

handle('add-game', ({ name, modsPath, strategy, steamAppId }) =>
  gameDetect.addCustom({ name, modsPath, strategy, steamAppId })
);

handle('acknowledge-game-update', (gameId) => gameDetect.acknowledgeUpdate(gameId));

// ---------- Mods ----------

handle('get-mods', (gameId) => {
  const mods = modStore.loadMods();
  return gameId ? mods.filter((m) => m.gameId === gameId) : mods;
});

handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

handle('choose-zip', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mod archives', extensions: ['zip', 'rar', '7z'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

handle('log', (message) => log(message));

handle('install-mod', async ({ gameId, zipPath, customTargetDir }) => {
  log(`installing ${zipPath}`);
  const mod = await modInstaller.installMod({ gameId, zipPath, customTargetDir });
  log(`installed "${mod.name}": ${JSON.stringify(mod.placements)}`);

  // The archive is now safely stored in the game's zips/ folder, so clear away
  // the file the user dragged in. Recycle Bin, not permanent delete — a bad
  // download or a mis-drag should always be recoverable.
  let originalRemoved = false;
  let originalRemoveError = null;
  try {
    const original = path.resolve(zipPath);
    const stored = path.resolve(mod.zipPath);
    const insideManagedFolder = original
      .toLowerCase()
      .startsWith(path.resolve(mod.zipPath, '..').toLowerCase() + path.sep);

    if (original !== stored && !insideManagedFolder && fs.existsSync(original)) {
      await shell.trashItem(original);
      originalRemoved = true;
    }
  } catch (err) {
    originalRemoveError = err.message;
  }

  return { ...mod, originalRemoved, originalRemoveError };
});

handle('remove-mod', ({ modId }) =>
  modInstaller.removeMod({
    modId,
    trash: (target) => shell.trashItem(target),
  })
);

handle('set-mod-active', ({ modId, active }) =>
  active ? modInstaller.activateMod(modId) : modInstaller.deactivateMod(modId)
);

// ---------- Profiles ----------

handle('get-profiles', (gameId) => profileStore.listProfiles(gameId));

handle('save-profile', ({ gameId, name }) => profileStore.saveCurrentAs({ gameId, name }));

handle('delete-profile', (profileId) => profileStore.deleteProfile(profileId));

handle('apply-profile', (profileId) => {
  const profile = profileStore.getProfile(profileId);
  return modInstaller.applyProfile({ gameId: profile.gameId, modIds: profile.modIds });
});

// ---------- App updates ----------

handle('install-app-update', () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.quitAndInstall();
});
