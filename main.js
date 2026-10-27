const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const gameStore = require('./lib/gameStore');
const modStore = require('./lib/modStore');
const modInstaller = require('./lib/modInstaller');
const { getStrategy } = require('./lib/strategies');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-games', () => {
  return gameStore.loadGames().map((g) => ({ ...g, hint: getStrategy(g.strategy).hint }));
});

ipcMain.handle('add-game', (event, { name, modsPath, strategy }) =>
  gameStore.addGame({ name, modsPath, strategy })
);

ipcMain.handle('get-mods', (event, gameId) => {
  const mods = modStore.loadMods();
  return gameId ? mods.filter((m) => m.gameId === gameId) : mods;
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('choose-zip', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Mod archives', extensions: ['zip', 'rar', '7z'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

const LOG_FILE = path.join(__dirname, 'data', 'log.txt');
ipcMain.handle('log', (event, message) => {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
});

ipcMain.handle('install-mod', async (event, { gameId, zipPath, customTargetDir }) => {
  const mod = await modInstaller.installMod({ gameId, zipPath, customTargetDir });

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

ipcMain.handle('remove-mod', (event, { modId }) => {
  return modInstaller.removeMod({
    modId,
    trash: (target) => shell.trashItem(target),
  });
});

ipcMain.handle('set-mod-active', (event, { modId, active }) => {
  return active ? modInstaller.activateMod(modId) : modInstaller.deactivateMod(modId);
});
