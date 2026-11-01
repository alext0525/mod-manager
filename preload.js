const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('modManager', {
  getGames: () => ipcRenderer.invoke('get-games'),
  detectGames: () => ipcRenderer.invoke('detect-games'),
  addDetectedGame: (catalogId) => ipcRenderer.invoke('add-detected-game', catalogId),
  guessGameFolder: (folder) => ipcRenderer.invoke('guess-game-folder', folder),
  addGame: (data) => ipcRenderer.invoke('add-game', data),
  acknowledgeGameUpdate: (gameId) => ipcRenderer.invoke('acknowledge-game-update', gameId),
  getMods: (gameId) => ipcRenderer.invoke('get-mods', gameId),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  chooseZips: () => ipcRenderer.invoke('choose-zip'),
  installMod: (data) => ipcRenderer.invoke('install-mod', data),
  removeMod: (data) => ipcRenderer.invoke('remove-mod', data),
  setModActive: (data) => ipcRenderer.invoke('set-mod-active', data),
  getProfiles: (gameId) => ipcRenderer.invoke('get-profiles', gameId),
  saveProfile: (data) => ipcRenderer.invoke('save-profile', data),
  deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),
  applyProfile: (profileId) => ipcRenderer.invoke('apply-profile', profileId),
  checkGameFolder: (gameId) => ipcRenderer.invoke('check-game-folder', gameId),
  setGameMode: (data) => ipcRenderer.invoke('set-game-mode', data),
  launchGame: (data) => ipcRenderer.invoke('launch-game', data),
  trustGameFiles: (data) => ipcRenderer.invoke('trust-game-files', data),
  openGameFolder: (gameId) => ipcRenderer.invoke('open-game-folder', gameId),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', (event, version) => callback(version)),
  log: (message) => ipcRenderer.invoke('log', message),

  // Resolves a dropped File to a real filesystem path.
  // webUtils is the supported API; file.path is the older fallback.
  getFilePath: (file) => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      try {
        const p = webUtils.getPathForFile(file);
        if (p) return p;
      } catch (e) {
        /* fall through to legacy property */
      }
    }
    return file.path || null;
  },
});
