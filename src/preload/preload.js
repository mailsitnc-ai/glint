const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Every method here maps 1:1 to an ipcMain handler in main.js.
 */
contextBridge.exposeInMainWorld('glint', {
  /* settings */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettingsChanged: (cb) => {
    const listener = (_e, settings) => cb(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },

  /* workspace */
  openFolder: () => ipcRenderer.invoke('workspace:open-folder'),
  openFile: () => ipcRenderer.invoke('workspace:open-file'),
  getTree: (dir) => ipcRenderer.invoke('workspace:tree', dir),
  getRecent: () => ipcRenderer.invoke('workspace:recent'),
  onWorkspaceOpened: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('workspace:opened', listener);
    return () => ipcRenderer.removeListener('workspace:opened', listener);
  },
  onFileOpened: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('file:opened', listener);
    return () => ipcRenderer.removeListener('file:opened', listener);
  },

  /* files */
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  writeFile: (path, content) => ipcRenderer.invoke('file:write', path, content),
  saveFileAs: (name, content) => ipcRenderer.invoke('file:save-as', name, content),
  fileExists: (path) => ipcRenderer.invoke('file:exists', path),
  watchFile: (path) => ipcRenderer.invoke('file:watch', path),
  unwatchFile: (path) => ipcRenderer.invoke('file:unwatch', path),
  onFileChanged: (cb) => {
    const listener = (_e, path) => cb(path);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },

  /* window */
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),

  /* menu commands from main process */
  onMenuCommand: (cb) => {
    const listener = (_e, command) => cb(command);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
});
