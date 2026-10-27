const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('modManager', {
  getGames: () => ipcRenderer.invoke('get-games'),
  addGame: (data) => ipcRenderer.invoke('add-game', data),
  getMods: (gameId) => ipcRenderer.invoke('get-mods', gameId),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  chooseZip: () => ipcRenderer.invoke('choose-zip'),
  installMod: (data) => ipcRenderer.invoke('install-mod', data),
  removeMod: (data) => ipcRenderer.invoke('remove-mod', data),
  setModActive: (data) => ipcRenderer.invoke('set-mod-active', data),
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
